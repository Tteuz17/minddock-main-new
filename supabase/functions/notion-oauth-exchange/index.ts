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
 *   supabase secrets set NOTION_CLIENT_SECRET=secret_xxx
 *
 * Optional:
 *   supabase secrets set NOTION_CLIENT_ID=321d872b-594c-81e6-b469-00375ccd1eac
 */

const DEFAULT_NOTION_CLIENT_ID = "321d872b-594c-81e6-b469-00375ccd1eac"
const NOTION_OAUTH_TOKEN_ENDPOINT = "https://api.notion.com/v1/oauth/token"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
}

interface ExchangeRequestBody {
  provider?: unknown
  code?: unknown
  redirectUri?: unknown
  redirect_uri?: unknown
}

interface NotionTokenResponse {
  access_token?: string
  token_type?: string
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json"
    }
  })
}

function isAllowedRedirectUri(value: string): boolean {
  try {
    const parsed = new URL(value)
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.endsWith(".chromiumapp.org") &&
      parsed.pathname.length > 0
    )
  } catch {
    return false
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS })
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const notionClientSecret = String(Deno.env.get("NOTION_CLIENT_SECRET") ?? "").trim()
  const notionClientId = String(Deno.env.get("NOTION_CLIENT_ID") ?? DEFAULT_NOTION_CLIENT_ID).trim()

  if (!notionClientSecret) {
    return jsonResponse({ error: "NOTION_CLIENT_SECRET is not configured on server" }, 503)
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

  if (!code) {
    return jsonResponse({ error: "Missing authorization code" }, 400)
  }

  if (!redirectUri || !isAllowedRedirectUri(redirectUri)) {
    return jsonResponse({ error: "Invalid redirectUri" }, 400)
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
        status: notionResponse.status,
        details: rawPayload || notionResponse.statusText
      },
      notionResponse.status
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
