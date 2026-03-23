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

function isDevBypassToken(token: string): boolean {
  return String(token ?? "").trim() === "dev-bypass-token"
}

async function resolveAiAccessToken(): Promise<string> {
  const token = String((await authManager.getAccessToken()) ?? "").trim()
  if (!token) {
    throw new Error("Sessao MindDock ausente. Faca login para usar recursos de IA.")
  }

  if (isDevBypassToken(token)) {
    throw new Error(
      "Modo dev bypass detectado. Brain Merge exige login real no MindDock para autenticar no AI proxy."
    )
  }

  return token
}

async function readAiProxyResponse<T>(res: Response): Promise<AiProxyResponse<T>> {
  try {
    return (await res.json()) as AiProxyResponse<T>
  } catch {
    return {}
  }
}

async function postAiProxy<T>(
  supabaseUrl: string,
  token: string,
  action: string,
  payload: Record<string, unknown>
): Promise<{ res: Response; json: AiProxyResponse<T> }> {
  const res = await fetch(`${supabaseUrl}/functions/v1/ai-proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ action, payload })
  })
  const json = await readAiProxyResponse<T>(res)
  return { res, json }
}

async function callAiProxy<T>(
  action: string,
  payload: Record<string, unknown>
): Promise<T> {
  const supabaseUrl =
    (await getFromStorage<string>(FIXED_STORAGE_KEYS.PROJECT_URL)) ??
    process.env.PLASMO_PUBLIC_SUPABASE_URL

  if (!supabaseUrl) {
    throw new Error("Supabase URL not configured")
  }

  let token = await resolveAiAccessToken()
  let { res, json } = await postAiProxy<T>(supabaseUrl, token, action, payload)

  if (res.status === 401) {
    await authManager.initializeSession().catch(() => null)
    const refreshedToken = await resolveAiAccessToken()
    if (refreshedToken !== token) {
      token = refreshedToken
      const retried = await postAiProxy<T>(supabaseUrl, token, action, payload)
      res = retried.res
      json = retried.json
    }
  }

  if (!res.ok || !json.success) {
    if (res.status === 401) {
      throw new Error("Sessao invalida no AI proxy. Faca login novamente no MindDock.")
    }
    if (res.status === 403 && json.tier) {
      throw new Error(`AI features require Thinker plan. Current plan: ${json.tier}`)
    }
    throw new Error(json.error ?? `AI proxy error (${res.status})`)
  }

  return json.result as T
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
