export interface ConversationResyncIdentity {
  normalizedUrl: string
  platform: string
  conversationId: string | null
  primaryKey: string
  aliases: string[]
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim()
}

function normalizeUrlPath(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    const normalizedPath = parsed.pathname.replace(/\/+$/u, "") || "/"
    return `${parsed.origin}${normalizedPath}`
  } catch {
    return normalizeString(rawUrl).split("#")[0].split("?")[0].trim()
  }
}

function inferPlatform(rawUrl: string): string {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase()

    if (host.includes("chat.openai.com") || host.includes("chatgpt.com")) {
      return "ChatGPT"
    }
    if (host.includes("claude.ai")) {
      return "Claude"
    }
    if (host.includes("gemini.google.com")) {
      return "Gemini"
    }
    if (host.includes("perplexity.ai")) {
      return "Perplexity"
    }
    if (host.includes("grok.com")) {
      return "Grok"
    }
    if (host.includes("x.com") || host.includes("twitter.com")) {
      return "X"
    }
    if (host.includes("kimi.com") || host.includes("moonshot.cn")) {
      return "Kimi"
    }
    if (host.includes("genspark.ai") || host.includes("genspark.im")) {
      return "Genspark"
    }
    if (host.includes("linkedin.com")) {
      return "LinkedIn"
    }
    if (host.includes("reddit.com")) {
      return "Reddit"
    }

    const hostParts = host.split(".").filter(Boolean)
    const bestGuess = hostParts.length >= 2 ? hostParts[hostParts.length - 2] : hostParts[0] ?? "Web"
    return bestGuess ? bestGuess.charAt(0).toUpperCase() + bestGuess.slice(1) : "Web"
  } catch {
    return "Web"
  }
}

function pickFirstMatch(rawUrl: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = rawUrl.match(pattern)
    const candidate = normalizeString(match?.[1])
    if (candidate) {
      return candidate
    }
  }
  return null
}

function extractConversationId(rawUrl: string, platform: string): string | null {
  const normalizedPlatform = platform.toLowerCase()

  if (normalizedPlatform === "chatgpt") {
    return pickFirstMatch(rawUrl, [/\/c\/([A-Za-z0-9-]+)/u])
  }

  if (normalizedPlatform === "claude") {
    return pickFirstMatch(rawUrl, [/\/(?:chat|conversations)\/([A-Za-z0-9-]+)/u])
  }

  if (normalizedPlatform === "gemini") {
    return pickFirstMatch(rawUrl, [/\/app\/([A-Za-z0-9-]+)/u])
  }

  if (normalizedPlatform === "perplexity") {
    const fromThreadQuery = pickFirstMatch(rawUrl, [/[?&]thread=([A-Za-z0-9-]+)/u])
    if (fromThreadQuery) {
      return fromThreadQuery
    }
    return pickFirstMatch(rawUrl, [/\/(?:search|thread)\/([A-Za-z0-9-]+)/u, /\/([A-Za-z0-9-]{10,})$/u])
  }

  const fromCanonicalParams = pickFirstMatch(rawUrl, [
    /[?&](?:conversationId|conversation_id|chatId|chat_id|threadId|thread_id)=([A-Za-z0-9_-]+)/u
  ])
  if (fromCanonicalParams) {
    return fromCanonicalParams
  }

  return pickFirstMatch(rawUrl, [
    /\/(?:chat|conversation|thread|c|app)\/([A-Za-z0-9-]{8,})/u,
    /\/([A-Za-z0-9-]{12,})$/u
  ])
}

export function buildConversationResyncIdentity(rawUrl: unknown): ConversationResyncIdentity {
  const normalizedRawUrl = normalizeString(rawUrl)
  const normalizedUrl = normalizeUrlPath(normalizedRawUrl)
  const platform = inferPlatform(normalizedRawUrl || normalizedUrl)
  const conversationId = extractConversationId(normalizedRawUrl || normalizedUrl, platform)
  const platformScopedKey = conversationId ? `${platform}:${conversationId}` : ""
  const primaryKey = platformScopedKey || normalizedUrl

  const aliases = Array.from(
    new Set([primaryKey, normalizedUrl, platformScopedKey].map((entry) => normalizeString(entry)).filter(Boolean))
  )

  return {
    normalizedUrl,
    platform,
    conversationId,
    primaryKey,
    aliases
  }
}

export function resolveConversationPrimaryKey(rawUrl: unknown): string {
  return buildConversationResyncIdentity(rawUrl).primaryKey
}

export function resolveConversationAliasKeys(rawUrl: unknown): string[] {
  return buildConversationResyncIdentity(rawUrl).aliases
}
