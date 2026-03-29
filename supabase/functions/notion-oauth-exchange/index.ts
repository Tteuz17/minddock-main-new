/**
 * MindDock - Notion OAuth Exchange Edge Function
 *
 * Exchanges authorization_code for access_token using Notion client secret.
 * Keep NOTION_CLIENT_SECRET only on server-side (never in extension bundle).
 *
 * Deploy:
 *   supabase functions deploy notion-oauth-exchange --no-verify-jwt
 *
 * Required secrets:
 *   supabase secrets set SUPABASE_URL=https://<project-ref>.supabase.co
 *   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
 *   supabase secrets set NOTION_CLIENT_SECRET=secret_xxx
 *
 * Optional:
 *   supabase secrets set NOTION_CLIENT_ID=321d872b-594c-81e6-b469-00375ccd1eac
 *   supabase secrets set ALLOWED_ORIGINS=https://minddocklm.digital,https://app.minddocklm.digital
 *   supabase secrets set NOTION_ALLOWED_EXTENSION_IDS=<ext_id_1>,<ext_id_2>
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const DEFAULT_NOTION_CLIENT_ID = "321d872b-594c-81e6-b469-00375ccd1eac"
const NOTION_OAUTH_TOKEN_ENDPOINT = "https://api.notion.com/v1/oauth/token"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
}

const CHROME_EXTENSION_ORIGIN_REGEX = /^chrome-extension:\/\/[a-z]{32}$/i
const MOZ_EXTENSION_ORIGIN_REGEX = /^moz-extension:\/\/[a-z0-9-]+$/i
const LOCALHOST_ORIGIN_REGEX = /^https?:\/\/localhost(?::\d{1,5})?$/i
const CHROMIUM_REDIRECT_HOST_REGEX = /^([a-p]{32})\.chromiumapp\.org$/i

interface ExchangeRequestBody {
  provider?: unknown
  code?: unknown
  redirectUri?: unknown
  redirect_uri?: unknown
  extensionId?: unknown
}

interface NotionTokenResponse {
  access_token?: string
  token_type?: string
}

function parseCsvSet(value: string | null | undefined): Set<string> {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  )
}

const allowedOrigins = parseCsvSet(Deno.env.get("ALLOWED_ORIGINS"))
const allowedExtensionIds = parseCsvSet(Deno.env.get("NOTION_ALLOWED_EXTENSION_IDS"))

function isAllowedOrigin(origin: string): boolean {
  const normalized = String(origin ?? "").trim()
  if (!normalized) {
    return true
  }

  if (
    CHROME_EXTENSION_ORIGIN_REGEX.test(normalized) ||
    MOZ_EXTENSION_ORIGIN_REGEX.test(normalized) ||
    LOCALHOST_ORIGIN_REGEX.test(normalized)
  ) {
    return true
  }

  return allowedOrigins.has(normalized.toLowerCase())
}

function isBrowserOriginAllowed(request: Request): boolean {
  const origin = String(request.headers.get("origin") ?? "").trim()
  if (!origin) {
    return true
  }
  return isAllowedOrigin(origin)
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(headers ?? {})
    }
  })
}

function extractChromiumRedirectExtensionId(value: string): string | null {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "https:" || parsed.pathname.length === 0) {
      return null
    }

    const hostMatch = parsed.hostname.match(CHROMIUM_REDIRECT_HOST_REGEX)
    if (!hostMatch?.[1]) {
      return null
    }

    return hostMatch[1].toLowerCase()
  } catch {
    return null
  }
}

Deno.serve(async (request: Request) => {
  if (!isBrowserOriginAllowed(request)) {
    return jsonResponse({ error: "Origin not allowed" }, 403)
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS })
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const authHeader = String(request.headers.get("Authorization") ?? "").trim()
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse({ error: "Missing authorization" }, 401)
  }

  const token = authHeader.slice(7).trim()
  if (!token) {
    return jsonResponse({ error: "Missing authorization token" }, 401)
  }

  const supabaseUrl = String(Deno.env.get("SUPABASE_URL") ?? "").trim()
  const supabaseServiceKey = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim()
  const notionClientSecret = String(Deno.env.get("NOTION_CLIENT_SECRET") ?? "").trim()
  const notionClientId = String(Deno.env.get("NOTION_CLIENT_ID") ?? DEFAULT_NOTION_CLIENT_ID).trim()

  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({ error: "Supabase auth not configured on server" }, 503)
  }

  if (!notionClientSecret) {
    return jsonResponse({ error: "NOTION_CLIENT_SECRET is not configured on server" }, 503)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser(token)

  if (authError || !user) {
    return jsonResponse({ error: "Invalid or expired session" }, 401)
  }

  let body: ExchangeRequestBody
  try {
    body = (await request.json()) as ExchangeRequestBody
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400)
  }

  const provider = String(body.provider ?? "notion").trim().toLowerCase()
  if (provider !== "notion") {
    return jsonResponse({ error: "Unsupported provider" }, 400)
  }

  const code = String(body.code ?? "").trim()
  const redirectUri = String(body.redirectUri ?? body.redirect_uri ?? "").trim()
  const extensionId = String(body.extensionId ?? "").trim().toLowerCase()

  if (!code) {
    return jsonResponse({ error: "Missing authorization code" }, 400)
  }

  if (code.length > 4096) {
    return jsonResponse({ error: "Invalid authorization code" }, 400)
  }

  const redirectExtensionId = extractChromiumRedirectExtensionId(redirectUri)
  if (!redirectExtensionId) {
    return jsonResponse({ error: "Invalid redirectUri" }, 400)
  }

  if (extensionId && extensionId !== redirectExtensionId) {
    return jsonResponse({ error: "redirectUri/extensionId mismatch" }, 400)
  }

  if (allowedExtensionIds.size > 0 && !allowedExtensionIds.has(redirectExtensionId)) {
    return jsonResponse({ error: "Extension is not allowed for Notion OAuth" }, 403)
  }

  const notionResponse = await fetch(NOTION_OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${notionClientId}:${notionClientSecret}`)}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri
    })
  })

  const rawPayload = await notionResponse.text().catch(() => "")

  if (!notionResponse.ok) {
    return jsonResponse(
      {
        error: "Notion OAuth exchange failed",
        status: notionResponse.status
      },
      notionResponse.status >= 500 ? 502 : 400
    )
  }

  let notionPayload: NotionTokenResponse = {}
  try {
    notionPayload = JSON.parse(rawPayload) as NotionTokenResponse
  } catch {
    return jsonResponse({ error: "Invalid response from Notion OAuth API" }, 502)
  }

  const accessToken = String(notionPayload.access_token ?? "").trim()
  if (!accessToken) {
    return jsonResponse({ error: "Notion OAuth response missing access_token" }, 502)
  }

  return jsonResponse({
    access_token: accessToken,
    token_type: notionPayload.token_type ?? "bearer"
  })
})
