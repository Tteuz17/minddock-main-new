/**
 * MindDock AI Service
 * All AI calls are proxied through the Supabase Edge Function `ai-proxy`.
 * The Claude API key is stored only as a Supabase secret, never in the extension bundle.
 */

import { getFromStorage } from "~/lib/utils"
import { FIXED_STORAGE_KEYS } from "~/lib/contracts"
import { authManager } from "~/background/auth-manager"
import type { Note, SubscriptionTier } from "~/lib/types"

type AtomicNote = Omit<
  Note,
  "id" | "userId" | "notebookId" | "linkedNoteIds" | "backlinks" | "createdAt" | "updatedAt"
>

interface AiProxyResponse<T> {
  success?: boolean
  result?: T
  error?: string
  tier?: string
}

interface AiProxyAttemptResult<T> {
  res: Response
  json: AiProxyResponse<T>
  rawBody: string
}

type AiFeatureContext = Record<string, unknown>

function mergeContext(
  baseContext: AiFeatureContext,
  extraContext?: AiFeatureContext
): AiFeatureContext {
  return {
    ...baseContext,
    ...(extraContext ?? {})
  }
}

function isLikelyJwt(token: string): boolean {
  const parts = String(token ?? "").trim().split(".")
  return parts.length === 3 && parts.every((part) => part.trim().length > 0)
}

async function resolveAiAccessToken(): Promise<string> {
  const token = String((await authManager.getVerifiedAccessToken()) ?? "").trim()
  if (!token) {
    throw new Error("Sessao MindDock invalida para IA. Faca logout e login para renovar a autenticacao.")
  }

  if (!isLikelyJwt(token)) {
    throw new Error("Token de IA invalido. Faca logout e login novamente no MindDock.")
  }

  return token
}

function decodeJwtPayload(jwt: string | null | undefined): Record<string, unknown> | null {
  const raw = String(jwt ?? "").trim()
  if (!raw) {
    return null
  }

  const parts = raw.split(".")
  if (parts.length < 2) {
    return null
  }

  const payloadPart = parts[1].replace(/-/g, "+").replace(/_/g, "/")
  const padded = payloadPart.padEnd(Math.ceil(payloadPart.length / 4) * 4, "=")

  try {
    const decoded = atob(padded)
    return JSON.parse(decoded) as Record<string, unknown>
  } catch {
    return null
  }
}

function extractJwtRef(jwt: string | null | undefined): string | null {
  const payload = decodeJwtPayload(jwt)
  if (!payload) {
    return null
  }

  const directRef = String(payload.ref ?? "").trim()
  if (directRef) {
    return directRef
  }

  const issuer = String(payload.iss ?? "").trim()
  if (!issuer) {
    return null
  }

  try {
    const host = new URL(issuer).hostname
    const ref = String(host.split(".")[0] ?? "").trim()
    return ref || null
  } catch {
    return null
  }
}

function extractProjectRefFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname
    const ref = String(host.split(".")[0] ?? "").trim()
    return ref || null
  } catch {
    return null
  }
}

function buildAiProxyTargets(
  supabaseUrl: string,
  token: string,
  anonKey: string
): Array<{ baseUrl: string; apiKey: string }> {
  const normalizedBaseUrl = String(supabaseUrl ?? "").trim()
  if (!normalizedBaseUrl) {
    return []
  }

  const normalizedAnonKey = String(anonKey ?? "").trim()
  const tokenRef = extractJwtRef(token)
  const baseRef = extractProjectRefFromUrl(normalizedBaseUrl)
  const anonIsJwt = isLikelyJwt(normalizedAnonKey)
  const anonRef = anonIsJwt ? extractJwtRef(normalizedAnonKey) : null

  const resolveApiKeyForTarget = (targetUrl: string): string => {
    if (!normalizedAnonKey) {
      return ""
    }

    const targetRef = extractProjectRefFromUrl(targetUrl)
    if (!anonIsJwt) {
      // New publishable keys (sb_publishable_*) cannot expose project ref.
      // Use only on the configured project URL.
      if (!baseRef || !targetRef || targetRef === baseRef) {
        return normalizedAnonKey
      }
      return ""
    }

    if (!anonRef) {
      return ""
    }

    if (!targetRef || anonRef === targetRef) {
      return normalizedAnonKey
    }

    return ""
  }

  const candidates: Array<{ baseUrl: string; apiKey: string }> = []
  if (tokenRef && tokenRef !== baseRef) {
    candidates.push({
      baseUrl: `https://${tokenRef}.supabase.co`,
      apiKey: resolveApiKeyForTarget(`https://${tokenRef}.supabase.co`)
    })
  }
  candidates.push({
    baseUrl: normalizedBaseUrl,
    apiKey: resolveApiKeyForTarget(normalizedBaseUrl)
  })

  const deduped = new Map<string, { baseUrl: string; apiKey: string }>()
  for (const candidate of candidates) {
    if (!deduped.has(candidate.baseUrl)) {
      deduped.set(candidate.baseUrl, candidate)
    }
  }

  return Array.from(deduped.values())
}

async function postAiProxy<T>(
  supabaseUrl: string,
  token: string,
  action: string,
  payload: Record<string, unknown>,
  apiKey = "",
  projectUrlHint = ""
): Promise<AiProxyAttemptResult<T>> {
  const normalizedApiKey = String(apiKey ?? "").trim()
  const useApiKeyAsGatewayJwt = isLikelyJwt(normalizedApiKey)
  const authorizationToken = useApiKeyAsGatewayJwt ? normalizedApiKey : token

  const res = await fetch(`${supabaseUrl}/functions/v1/ai-proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authorizationToken}`,
      ...(apiKey ? { apikey: apiKey } : {}),
      ...(useApiKeyAsGatewayJwt ? { "x-minddock-user-jwt": token } : {}),
    },
    body: JSON.stringify({ action, payload })
  })
  const rawBody = await res.text()
  let json: AiProxyResponse<T> = {}
  if (rawBody) {
    try {
      json = JSON.parse(rawBody) as AiProxyResponse<T>
    } catch {
      json = {}
    }
  }

  return { res, json, rawBody }
}

async function callAiProxy<T>(
  action: string,
  payload: Record<string, unknown>
): Promise<T> {
  let supabaseUrl = ""
  let supabaseAnonKey = ""
  try {
    const config = await authManager.getSupabaseConfig()
    supabaseUrl = String(config.url ?? "").trim()
    supabaseAnonKey = String(config.anonKey ?? "").trim()
  } catch {
    supabaseUrl = ""
    supabaseAnonKey = ""
  }

  if (!supabaseUrl) {
    supabaseUrl =
      (await getFromStorage<string>(FIXED_STORAGE_KEYS.PROJECT_URL)) ??
      process.env.PLASMO_PUBLIC_SUPABASE_URL ??
      ""
  }
  if (!supabaseAnonKey) {
    supabaseAnonKey =
      (await getFromStorage<string>(FIXED_STORAGE_KEYS.ANON_KEY)) ??
      process.env.PLASMO_PUBLIC_SUPABASE_ANON_KEY ??
      ""
  }

  if (!supabaseUrl) {
    throw new Error("Supabase URL not configured")
  }

  let token = await resolveAiAccessToken()
  const requestTargets = buildAiProxyTargets(supabaseUrl, token, supabaseAnonKey)
  if (requestTargets.length === 0) {
    throw new Error("Supabase URL not configured")
  }

  let res: Response | null = null
  let json: AiProxyResponse<T> = {}
  let rawBody = ""
  let attemptedTokenRecovery = false

  for (const target of requestTargets) {
    const firstTry = await postAiProxy<T>(
      target.baseUrl,
      token,
      action,
      payload,
      target.apiKey,
      target.baseUrl,
      target.apiKey
    )
    res = firstTry.res
    json = firstTry.json
    rawBody = firstTry.rawBody

    if (res.status === 401 && !attemptedTokenRecovery) {
      attemptedTokenRecovery = true
      await authManager.initializeSession().catch(() => null)

      // Try to recover a valid token before failing hard.
      let recoveredToken = String((await authManager.getVerifiedAccessToken()) ?? "").trim()
      if (!recoveredToken) {
        await authManager.refreshAccessToken(null)
        recoveredToken = String((await authManager.getVerifiedAccessToken()) ?? "").trim()
      }

      if (
        recoveredToken &&
        recoveredToken !== token &&
        isLikelyJwt(recoveredToken)
      ) {
        token = recoveredToken
        const retry = await postAiProxy<T>(
          target.baseUrl,
          recoveredToken,
          action,
          payload,
          target.apiKey,
          target.baseUrl,
          target.apiKey
        )
        res = retry.res
        json = retry.json
        rawBody = retry.rawBody
      }
    }

    if (res.ok && json.success) {
      break
    }

    // If auth failed on this project target, try the next possible project URL.
    if (res.status === 401) {
      continue
    }

    // For non-401 failures, stop and surface the error.
    break
  }

  if (!res) {
    throw new Error("AI proxy request failed before response")
  }

  if (!res.ok || !json.success) {
    if (res.status === 401) {
      const serverError = String(json.error ?? "").trim()
      const configuredRef = extractProjectRefFromUrl(supabaseUrl) ?? "n/a"
      const tokenRef = extractJwtRef(token) ?? "n/a"
      const triedRefs = requestTargets
        .map((target) => extractProjectRefFromUrl(target.baseUrl) ?? "n/a")
        .join(",")
      const jwtParts = String(token ?? "").trim().split(".").length
      const responseHint =
        normalizeResponseHint(rawBody) ||
        normalizeResponseHint(res.headers.get("www-authenticate")) ||
        "n/a"
      const serverDetails = serverError || responseHint
      throw new Error(
        `Sessao invalida no AI proxy. Faca logout e login novamente no MindDock para renovar a autenticacao. [AI-AUTH-V4 cfg=${configuredRef} token=${tokenRef} tried=${triedRefs} parts=${jwtParts} server=${serverDetails}]`
      )
    }
    if (res.status === 403 && json.tier) {
      throw new Error(`AI features require Thinker plan. Current plan: ${json.tier}`)
    }
    const responseHint = normalizeResponseHint(rawBody)
    throw new Error(json.error ?? (responseHint || `AI proxy error (${res.status})`))
  }

  return json.result as T
}

function normalizeResponseHint(value: string | null | undefined): string {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220)
  return normalized || ""
}

class AIService {
  async improvePrompt(
    userPrompt: string,
    context?: AiFeatureContext
  ): Promise<string> {
    return callAiProxy<string>("improvePrompt", {
      userPrompt,
      context: mergeContext(
        {
          surface: "agile_prompts",
          operation: "improve_prompt"
        },
        context
      )
    })
  }

  async atomizeContent(
    content: string,
    context?: AiFeatureContext
  ): Promise<AtomicNote[]> {
    return callAiProxy<AtomicNote[]>("atomizeContent", {
      content,
      context: mergeContext(
        {
          surface: "focus_docks",
          operation: "atomize_content"
        },
        context
      )
    })
  }

  async generatePromptOptions(
    userPrompt: string,
    context?: AiFeatureContext
  ): Promise<Array<{ title: string; prompt: string }>> {
    return callAiProxy<Array<{ title: string; prompt: string }>>("generatePromptOptions", {
      userPrompt,
      context: mergeContext(
        {
          surface: "agile_prompts",
          operation: "generate_prompt_options"
        },
        context
      )
    })
  }

  async suggestLinks(
    noteContent: string,
    existingNotes: Array<{ id: string; title: string; content: string }>
  ): Promise<Array<{ noteId: string; noteTitle: string; relevance: number }>> {
    return callAiProxy<Array<{ noteId: string; noteTitle: string; relevance: number }>>(
      "suggestLinks",
      { noteContent, existingNotes }
    )
  }

  async brainMerge(
    sources: Array<{ notebookTitle: string; sourceTitle: string; content: string }>,
    goal: string,
    context?: AiFeatureContext
  ): Promise<string> {
    return callAiProxy<string>("brainMerge", {
      sources,
      goal,
      context: mergeContext(
        {
          surface: "brain_merge",
          operation: "synthesize_sources"
        },
        context
      )
    })
  }
}

export const aiService = new AIService()

// Kept for backwards compat. Tier enforcement is server-side.
export type { SubscriptionTier }
