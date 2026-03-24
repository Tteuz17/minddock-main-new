import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { PlanLimits, SubscriptionCycle, SubscriptionTier } from "./types"
import { resolvePlanLimits } from "./constants"

// ─── Tailwind class merge ────────────────────────────────────────────────────

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Plan helpers ────────────────────────────────────────────────────────────

export function getPlanLimits(
  tier: SubscriptionTier,
  cycle: SubscriptionCycle = "none"
): PlanLimits {
  return resolvePlanLimits(tier, cycle)
}

export function canUseFeature(
  tier: SubscriptionTier,
  feature: keyof PlanLimits,
  cycle: SubscriptionCycle = "none"
): boolean {
  const limits = getPlanLimits(tier, cycle)
  const val = limits[feature]
  if (typeof val === "boolean") return val
  if (val === "unlimited") return true
  return (val as number) > 0
}

export function isUnlimited(val: number | "unlimited"): val is "unlimited" {
  return val === "unlimited"
}

// ─── Date helpers ────────────────────────────────────────────────────────────

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return "agora"
  if (diffMins < 60) return `${diffMins}m atrás`
  if (diffHours < 24) return `${diffHours}h atrás`
  if (diffDays < 7) return `${diffDays}d atrás`
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
}

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  })
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

// ─── Text helpers ────────────────────────────────────────────────────────────

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + "..."
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function extractTitle(text: string, maxLength = 60): string {
  const firstLine = text.split("\n")[0].replace(/^#+\s*/, "").trim()
  return truncate(firstLine || "Sem título", maxLength)
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function normalizeChatPlatformLabel(platform: string): string {
  const rawValue = String(platform ?? "").trim()
  if (!rawValue) {
    return "CHAT"
  }

  const normalizedValue = rawValue
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")

  if (normalizedValue.includes("gemini") || normalizedValue.includes("gemeos")) {
    return "GEMINI"
  }

  if (normalizedValue.includes("chatgpt")) {
    return "CHATGPT"
  }

  if (normalizedValue.includes("claude")) {
    return "CLAUDE"
  }

  if (normalizedValue.includes("perplexity")) {
    return "PERPLEXITY"
  }

  if (normalizedValue.includes("youtube")) {
    return "Youtube"
  }

  return rawValue.toUpperCase()
}

// ─── Chat capture helpers ────────────────────────────────────────────────────

export function formatChatAsMarkdown(
  platform: string,
  messages: Array<{ role: string; content: string }>,
  title?: string
): string {
  const header = title ? `# ${title}\n\n` : `# Conversa — ${platform}\n\n`
  const meta = `> Importado do ${platform} via MindDock em ${new Date().toLocaleString("pt-BR")}\n\n---\n\n`
  const body = messages
    .map((m) => {
      const roleLabel = m.role === "user" ? "**Você:**" : `**${platform}:**`
      return `${roleLabel}\n\n${m.content}`
    })
    .join("\n\n---\n\n")
  return header + meta + body
}

export function formatChatAsReadableMarkdown(
  platform: string,
  messages: Array<{ role: string; content: string }>,
  title?: string
): string {
  const normalizedPlatform = normalizeChatPlatformLabel(platform)
  const normalizedTitle = String(title ?? "").trim()
  const divider = "------------------------------------------------------------"
  const header = normalizedTitle
    ? `# ${normalizedTitle}\n\n`
    : `# Conversa - ${normalizedPlatform}\n\n`
  const meta = `> Importado do ${normalizedPlatform} via MindDock em ${new Date().toLocaleString("pt-BR")}\n\n${divider}\n\n`
  const body = messages
    .map((message) => {
      const roleLabel = message.role === "user" ? "Voce:" : `${normalizedPlatform}:`
      return `${roleLabel}\n\n${String(message.content ?? "").trim()}`
    })
    .join(`\n\n${divider}\n\n`)

  return `${header}${meta}${body}`
}

export function formatChatAsReadableMarkdownV2(
  platform: string,
  messages: Array<{ role: string; content: string }>,
  title?: string
): string {
  const normalizedPlatform = normalizeChatPlatformLabel(platform)
  const normalizedTitle = String(title ?? "").trim()
  const divider = "------------------------------------------------------------"
  const header = normalizedTitle
    ? `# ${normalizedTitle}\n\n`
    : `# Conversa - ${normalizedPlatform}\n\n`
  const meta = `> Importado do ${normalizedPlatform} via MindDock em ${new Date().toLocaleString("pt-BR")}\n\n${divider}\n\n`
  const body = messages
    .map((message) => {
      const roleLabel = message.role === "user" ? "Usuario:" : `${normalizedPlatform}:`
      return `${roleLabel}\n\n${String(message.content ?? "").trim()}`
    })
    .join(`\n\n${divider}\n\n`)

  return `${header}${meta}${body}`
}

// ─── RPC helpers ────────────────────────────────────────────────────────────

export function parseRPCResponse(responseText: string): unknown {
  try {
    const lines = responseText.split("\n").filter((l) => l.trim())
    // A resposta útil costuma estar em índices variáveis; procuramos o primeiro JSON válido de array
    for (const line of lines) {
      if (line.startsWith("[")) {
        try {
          return JSON.parse(line)
        } catch {
          continue
        }
      }
    }
    return null
  } catch {
    return null
  }
}

export function buildRPCEnvelope(rpcId: string, payload: unknown[]): string {
  const inner = JSON.stringify([[rpcId, JSON.stringify(payload), null, "generic"]])
  return `f.req=${encodeURIComponent(`[[${inner}]]`)}`
}

// ─── Storage helpers ─────────────────────────────────────────────────────────

export async function getFromStorage<T>(key: string): Promise<T | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      resolve((result[key] as T) ?? null)
    })
  })
}

export async function setInStorage<T>(key: string, value: T): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve)
  })
}

export async function removeFromStorage(key: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(key, resolve)
  })
}

const LOCAL_PERSISTED_SECURE_KEYS = new Set<string>([
  // Supabase session must survive extension reloads.
  "minddock_supabase_session"
])

function getSessionStorageArea(): chrome.storage.StorageArea | null {
  const storageWithSession = chrome.storage as typeof chrome.storage & {
    session?: chrome.storage.StorageArea
  }
  return storageWithSession.session ?? null
}

function shouldPersistSecureKeyInLocal(key: string): boolean {
  const normalizedKey = String(key ?? "").trim()
  return LOCAL_PERSISTED_SECURE_KEYS.has(normalizedKey)
}

function getSecureStorageArea(key: string): chrome.storage.StorageArea {
  if (shouldPersistSecureKeyInLocal(key)) {
    return chrome.storage.local
  }
  return getSessionStorageArea() ?? chrome.storage.local
}

async function getFromArea<T>(
  area: chrome.storage.StorageArea,
  key: string
): Promise<T | null> {
  return new Promise((resolve) => {
    area.get(key, (result) => {
      resolve((result[key] as T) ?? null)
    })
  })
}

async function setInArea<T>(
  area: chrome.storage.StorageArea,
  key: string,
  value: T
): Promise<void> {
  return new Promise((resolve) => {
    area.set({ [key]: value }, resolve)
  })
}

async function removeFromArea(area: chrome.storage.StorageArea, key: string): Promise<void> {
  return new Promise((resolve) => {
    area.remove(key, resolve)
  })
}

export async function getFromSecureStorage<T>(key: string): Promise<T | null> {
  const secureArea = getSecureStorageArea(key)
  const secureValue = await getFromArea<T>(secureArea, key)
  if (secureValue !== null) {
    return secureValue
  }

  const sessionArea = getSessionStorageArea()

  if (secureArea === chrome.storage.local) {
    if (!sessionArea) {
      return null
    }

    const sessionValue = await getFromArea<T>(sessionArea, key)
    if (sessionValue === null) {
      return null
    }

    // One-time migration from session-backed storage to persisted local storage.
    await setInArea(chrome.storage.local, key, sessionValue)
    await removeFromArea(sessionArea, key)
    return sessionValue
  }

  if (!sessionArea || secureArea !== sessionArea) {
    return null
  }

  const localValue = await getFromArea<T>(chrome.storage.local, key)
  if (localValue === null) {
    return null
  }

  // One-time migration from local to session-backed storage.
  await setInArea(secureArea, key, localValue)
  await removeFromArea(chrome.storage.local, key)
  return localValue
}

export async function setInSecureStorage<T>(key: string, value: T): Promise<void> {
  const secureArea = getSecureStorageArea(key)
  await setInArea(secureArea, key, value)
  const sessionArea = getSessionStorageArea()

  if (secureArea !== chrome.storage.local) {
    // Ensure sensitive entries are not persisted in local storage.
    await removeFromArea(chrome.storage.local, key)
    return
  }

  if (sessionArea) {
    // Ensure persisted keys are not shadowed by stale session values.
    await removeFromArea(sessionArea, key)
  }
}

export async function removeFromSecureStorage(key: string): Promise<void> {
  const secureArea = getSecureStorageArea(key)
  await removeFromArea(secureArea, key)
  const sessionArea = getSessionStorageArea()

  if (secureArea !== chrome.storage.local) {
    await removeFromArea(chrome.storage.local, key)
    return
  }

  if (sessionArea) {
    await removeFromArea(sessionArea, key)
  }
}

// ─── Debounce ────────────────────────────────────────────────────────────────

export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => unknown,
  delay: number
): (...args: TArgs) => void {
  let timer: ReturnType<typeof setTimeout>
  return (...args: TArgs) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

// ─── Color helpers (tags) ────────────────────────────────────────────────────

export const TAG_COLORS = [
  "#facc15", // yellow (action)
  "#22c55e", // green
  "#3b82f6", // blue
  "#a855f7", // purple
  "#f97316", // orange
  "#ec4899", // pink
  "#14b8a6", // teal
  "#ef4444"  // red
] as const

export function getTagColor(index: number): string {
  return TAG_COLORS[index % TAG_COLORS.length]
}

// ─── Wikilink parser ─────────────────────────────────────────────────────────

export function extractWikilinks(content: string): string[] {
  const regex = /\[\[([^\]]+)\]\]/g
  const matches: string[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    matches.push(match[1].trim())
  }
  return [...new Set(matches)]
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

export function renderWikilinks(
  content: string,
  noteMap: Record<string, string>
): string {
  return content.replace(/\[\[([^\]]+)\]\]/g, (_, title) => {
    const safe = escapeHtml(String(title))
    const id = noteMap[title.trim()]
    if (id) return `<span class="wikilink" data-note-id="${escapeHtml(id)}">${safe}</span>`
    return `<span class="wikilink wikilink--broken">${safe}</span>`
  })
}
