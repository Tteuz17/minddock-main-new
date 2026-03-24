import { authManager } from "../auth-manager"

const NOTION_CLIENT_ID = "321d872b-594c-81e6-b469-00375ccd1eac"
const NOTION_OAUTH_EXCHANGE_ENDPOINT = process.env.PLASMO_PUBLIC_NOTION_OAUTH_EXCHANGE_ENDPOINT
const SUPABASE_URL = process.env.PLASMO_PUBLIC_SUPABASE_URL
const NOTION_TOKEN_STORAGE_KEY = "minddock_notion_access_token"
const LEGACY_NOTION_TOKEN_STORAGE_KEY = "workspaceNotionToken"
const TARGET_PARENT_PAGE_STORAGE_KEY = "targetNotionPageId"

interface NotionTokenExchangeResponse {
  access_token?: string
  accessToken?: string
}

interface NotionLoginResult {
  success: boolean
}

function resolveExchangeEndpoint(): string {
  const endpoint = String(NOTION_OAUTH_EXCHANGE_ENDPOINT ?? "").trim()
  if (!endpoint) {
    const supabaseUrl = String(SUPABASE_URL ?? "").trim().replace(/\/+$/u, "")
    if (!supabaseUrl) {
      throw new Error(
        "Notion OAuth indisponivel: configure PLASMO_PUBLIC_NOTION_OAUTH_EXCHANGE_ENDPOINT ou PLASMO_PUBLIC_SUPABASE_URL."
      )
    }
    return `${supabaseUrl}/functions/v1/notion-oauth-exchange`
  }
  return endpoint
}

function parseCodeFromRedirectUrl(redirectUrl: string): string {
  const redirect = new URL(redirectUrl)
  return String(redirect.searchParams.get("code") ?? "").trim()
}

function normalizeJwt(token: string | null | undefined): string | null {
  let normalized = String(token ?? "").trim()
  if (!normalized) {
    return null
  }

  if (/^bearer\s+/i.test(normalized)) {
    normalized = normalized.replace(/^bearer\s+/i, "").trim()
  }

  const parts = normalized.split(".")
  if (parts.length !== 3 || parts.some((part) => !part.trim())) {
    return null
  }

  return normalized
}

async function resolveNotionExchangeAccessToken(): Promise<string> {
  const token = normalizeJwt(await authManager.getVerifiedAccessToken())
  if (!token || token === "dev-bypass-token") {
    throw new Error("Login real no MindDock e obrigatorio para conectar com Notion.")
  }
  return token
}

function launchAuthFlow(authUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirectUrl) => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) {
        reject(new Error(runtimeError.message || "Notion OAuth flow failed."))
        return
      }

      const normalizedRedirect = String(redirectUrl ?? "").trim()
      if (!normalizedRedirect) {
        reject(new Error("Notion OAuth redirect URL was not returned."))
        return
      }

      resolve(normalizedRedirect)
    })
  })
}

export async function exchangeAuthCodeForToken(authCode: string): Promise<string> {
  const normalizedCode = String(authCode ?? "").trim()
  if (!normalizedCode) {
    throw new Error("Notion authorization code is empty.")
  }

  const accessToken = await resolveNotionExchangeAccessToken()
  const redirectUri = chrome.identity.getRedirectURL()

  const oauthResponse = await fetch(resolveExchangeEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      provider: "notion",
      code: normalizedCode,
      redirectUri,
      extensionId: chrome.runtime.id
    })
  })

  if (!oauthResponse.ok) {
    const details = await oauthResponse.text().catch(() => "")
    throw new Error(`Notion OAuth exchange failed (${oauthResponse.status}): ${details || oauthResponse.statusText}`)
  }

  const exchangeResult = (await oauthResponse.json()) as NotionTokenExchangeResponse
  const notionAccessToken = String(exchangeResult?.access_token ?? exchangeResult?.accessToken ?? "").trim()
  if (!notionAccessToken) {
    throw new Error("Notion OAuth response did not include access_token.")
  }

  await chrome.storage.local.set({
    [NOTION_TOKEN_STORAGE_KEY]: notionAccessToken,
    [LEGACY_NOTION_TOKEN_STORAGE_KEY]: notionAccessToken
  })
  await chrome.storage.local.remove(TARGET_PARENT_PAGE_STORAGE_KEY)

  return notionAccessToken
}

export async function initiateNotionLogin(): Promise<NotionLoginResult> {
  const redirectUri = chrome.identity.getRedirectURL()
  const authUrl = `https://api.notion.com/v1/oauth/authorize?client_id=${NOTION_CLIENT_ID}&response_type=code&owner=user&redirect_uri=${encodeURIComponent(redirectUri)}`
  console.log("Iniciando login com a URL:", authUrl)

  const redirectUrl = await launchAuthFlow(authUrl)
  const authCode = parseCodeFromRedirectUrl(redirectUrl)
  if (!authCode) {
    throw new Error("Notion OAuth code was not returned in redirect URL.")
  }

  await exchangeAuthCodeForToken(authCode)
  return { success: true }
}
