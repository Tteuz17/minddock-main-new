import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["https://notebooklm.google.com/*"],
  world: "MAIN",
  run_at: "document_start"
}

const TARGET_ENDPOINT_FRAGMENT = "batchexecute"
const TARGET_RPC_ID = "wXbhsf"
const MESSAGE_SOURCE = "MINDDOCK_HOOK"
const MESSAGE_TYPE = "NOTEBOOK_LIST_UPDATED"
const STUDIO_MESSAGE_TYPE = "STUDIO_RESULTS_UPDATED"
const INTERCEPTOR_GUARD_KEY = "__MINDDOCK_NETWORK_TRAFFIC_INTERCEPTOR__"
const XHR_URL_KEY = "__minddockTrackedRequestUrl__"
const RPC_CONTEXT_KEY = "__minddock_rpc_context"
const STUDIO_ARM_SOURCE = "minddock"
const STUDIO_ARM_SOURCE_FALLBACK = "MINDDOCK_UI"
const STUDIO_ARM_TYPE = "STUDIO_ARM"
const STUDIO_ARM_WINDOW_MS = 8000
let studioArmUntil = 0
const BLOCKED_NOTEBOOK_TITLE_KEYS = new Set([
  "conversa",
  "conversas",
  "conversation",
  "conversations"
])

export interface NotebookEntry {
  id: string
  title: string
}

export interface StudioItem {
  id: string
  title: string
  type?: string
  meta?: string
  content?: string
  url?: string
  mimeType?: string
  sourceCount?: number
  updatedAt?: string
  kind?: "text" | "asset"
}

console.log("🚀 MindDock: Interceptor carregado no MAIN world")

function rememberRpcContextFromUrlAndBody(requestUrl: string, requestBody?: string): void {
  try {
    const url = new URL(requestUrl)
    const params = new URLSearchParams(requestBody ?? "")

    const ctx = {
      fSid: url.searchParams.get("f.sid") ?? undefined,
      bl: url.searchParams.get("bl") ?? undefined,
      hl: url.searchParams.get("hl") ?? undefined,
      socApp: url.searchParams.get("soc-app") ?? undefined,
      socPlatform: url.searchParams.get("soc-platform") ?? undefined,
      socDevice: url.searchParams.get("soc-device") ?? undefined,
      sourcePath: url.searchParams.get("source-path") ?? undefined,
      at: params.get("at") ?? undefined,
      updatedAt: Date.now()
    }

    const prev = (window as unknown as Record<string, unknown>)[RPC_CONTEXT_KEY] ?? {}
    ;(window as unknown as Record<string, unknown>)[RPC_CONTEXT_KEY] = { ...(prev as object), ...ctx }
  } catch {}
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeAccountEmail(value: unknown): string {
  const normalizedValue = normalizeString(value).toLowerCase()
  if (!normalizedValue) {
    return ""
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalizedValue) ? normalizedValue : ""
}

function extractAccountEmail(value: unknown): string {
  const normalizedValue = String(value ?? "")
  if (!normalizedValue) {
    return ""
  }

  const directEmail = normalizeAccountEmail(normalizedValue)
  if (directEmail) {
    return directEmail
  }

  const match = normalizedValue.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)
  return normalizeAccountEmail(match?.[0] ?? "")
}

function resolveAuthUserFromUrl(rawUrl: string): string {
  try {
    const resolvedUrl = new URL(rawUrl, window.location.origin)
    return normalizeString(resolvedUrl.searchParams.get("authuser"))
  } catch {
    return ""
  }
}

function resolveAccountEmailFromWizGlobalData(): string {
  const globalWindow = window as typeof window & Record<string, unknown>
  const rawWizGlobalData = globalWindow.WIZ_global_data
  if (!rawWizGlobalData || typeof rawWizGlobalData !== "object") {
    return ""
  }

  const wizGlobalData = rawWizGlobalData as Record<string, unknown>
  for (const [key, value] of Object.entries(wizGlobalData)) {
    const normalizedKey = normalizeString(key).toLowerCase()
    if (!/(mail|email|account)/u.test(normalizedKey)) {
      continue
    }

    const directEmail = extractAccountEmail(value)
    if (directEmail) {
      return directEmail
    }
  }

  return ""
}

function resolveAccountEmailFromDom(): string {
  const accountElement = document.querySelector("a[aria-label*='@'], button[aria-label*='@']")
  if (!(accountElement instanceof HTMLElement)) {
    return ""
  }

  return extractAccountEmail(accountElement.getAttribute("aria-label"))
}

function resolveNotebookAccountHints(requestUrl: string): { accountEmail?: string; authUser?: string } {
  const authUser = resolveAuthUserFromUrl(requestUrl) || resolveAuthUserFromUrl(window.location.href)
  const accountEmail = resolveAccountEmailFromDom() || resolveAccountEmailFromWizGlobalData()

  return {
    accountEmail: accountEmail || undefined,
    authUser: authUser || undefined
  }
}

function normalizeNotebookTitleKey(value: string): string {
  return normalizeString(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function isTargetRequestUrl(requestUrl: string): boolean {
  return String(requestUrl ?? "").includes(TARGET_ENDPOINT_FRAGMENT)
}

function doesRequestTargetNotebookList(requestUrl: string): boolean {
  try {
    const resolvedUrl = new URL(requestUrl, window.location.origin)
    const rpcIds = String(resolvedUrl.searchParams.get("rpcids") ?? "")

    return rpcIds
      .split(",")
      .map((item) => item.trim())
      .includes(TARGET_RPC_ID)
  } catch {
    return false
  }
}

function scoreNotebookTitle(value: string): number {
  const normalizedValue = normalizeString(value)
  let score = normalizedValue.length

  if (/\s/.test(normalizedValue)) {
    score += 8
  }

  if (/[A-Z]/.test(normalizedValue)) {
    score += 2
  }

  if (/[._:=]/.test(normalizedValue)) {
    score -= 6
  }

  return score
}

function upsertNotebook(output: Map<string, NotebookEntry>, notebook: NotebookEntry): void {
  const existingNotebook = output.get(notebook.id)
  if (!existingNotebook) {
    output.set(notebook.id, notebook)
    return
  }

  if (scoreNotebookTitle(notebook.title) > scoreNotebookTitle(existingNotebook.title)) {
    output.set(notebook.id, notebook)
  }
}

function extractNotebookFromArray(candidate: readonly unknown[]): NotebookEntry | null {
  if (!Array.isArray(candidate) || candidate.length < 3) {
    return null
  }

  const potentialTitle = candidate[0]
  const potentialId = candidate[2]

  if (typeof potentialTitle !== "string") {
    return null
  }

  const notebookTitle = potentialTitle.trim()
  const notebookTitleKey = normalizeNotebookTitleKey(notebookTitle)
  if (!notebookTitle) {
    return null
  }

  if (notebookTitle === "generic") {
    return null
  }

  if (BLOCKED_NOTEBOOK_TITLE_KEYS.has(notebookTitleKey)) {
    return null
  }

  if (typeof potentialId !== "string") {
    return null
  }

  const notebookId = potentialId.trim()
  const normalizedNotebookId = notebookId.toLowerCase()

  if (notebookId.length < 10) {
    return null
  }

  if (
    normalizedNotebookId.includes("http") ||
    normalizedNotebookId.includes("/") ||
    normalizedNotebookId.includes("www.")
  ) {
    return null
  }

  if (notebookId.includes(" ")) {
    return null
  }

  if (notebookTitle.includes(".") && notebookTitle.length < 10) {
    return null
  }

  if (notebookId.startsWith("-")) {
    return null
  }

  if (/^\d+$/u.test(notebookId)) {
    return null
  }

  return {
    id: notebookId,
    title: notebookTitle
  }
}

function resolveRowsFromPayload(payload: unknown): unknown[][] {
  const queue: unknown[] = [payload]
  const seen = new Set<unknown>()

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || typeof current !== "object") {
      continue
    }

    if (seen.has(current)) {
      continue
    }
    seen.add(current)

    if (Array.isArray(current)) {
      const isRows = current.length > 0 && current.every((entry) => Array.isArray(entry))
      if (isRows) {
        return current as unknown[][]
      }
      queue.push(...current)
      continue
    }

    queue.push(...Object.values(current))
  }

  return []
}

function resolveNotebookRows(payload: unknown): unknown[][] {
  const byContract = (payload as { 0?: { 1?: unknown } } | undefined)?.[0]?.[1]
  if (Array.isArray(byContract) && byContract.every((entry) => Array.isArray(entry))) {
    return byContract as unknown[][]
  }

  return resolveRowsFromPayload(payload)
}

function extractNotebookPathHints(rawResponseText: string): Set<string> {
  const hints = new Set<string>()
  const normalizedResponseText = String(rawResponseText ?? "")
  if (!normalizedResponseText) {
    return hints
  }

  const pathPatterns = [
    /(?:\/notebook\/)([A-Za-z0-9_-]{10,})/gu,
    /(?:%2Fnotebook%2F)([A-Za-z0-9_-]{10,})/giu,
    /(?:\\u002fnotebook\\u002f)([A-Za-z0-9_-]{10,})/giu
  ]
  for (const pattern of pathPatterns) {
    for (const match of normalizedResponseText.matchAll(pattern)) {
      const candidateId = normalizeString(match[1])
      if (candidateId) {
        hints.add(candidateId)
      }
    }
  }

  return hints
}

export function findNotebooksInObject(
  obj: unknown,
  rawResponseText?: string
): Array<{ id: string; title: string }> {
  const notebooks = new Map<string, NotebookEntry>()
  const notebookPathHints = extractNotebookPathHints(String(rawResponseText ?? ""))
  const notebookRows = resolveNotebookRows(obj)

  for (const row of notebookRows) {
    const notebook = extractNotebookFromArray(row)
    if (!notebook) {
      continue
    }

    if (notebookPathHints.size > 0 && !notebookPathHints.has(notebook.id)) {
      continue
    }

    upsertNotebook(notebooks, notebook)
  }

  if (notebooks.size > 0) {
    return Array.from(notebooks.values())
  }

  const seenObjects = new WeakSet<object>()
  const parsedStrings = new Set<string>()

  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      const normalizedValue = normalizeString(node)
      if (!normalizedValue || parsedStrings.has(normalizedValue)) {
        return
      }

      const looksLikeJson =
        (normalizedValue.startsWith("[") && normalizedValue.endsWith("]")) ||
        (normalizedValue.startsWith("{") && normalizedValue.endsWith("}"))
      if (!looksLikeJson) {
        return
      }

      parsedStrings.add(normalizedValue)
      try {
        visit(JSON.parse(normalizedValue))
      } catch {
        // no-op
      }
      return
    }

    if (!node || typeof node !== "object") {
      return
    }

    if (seenObjects.has(node)) {
      return
    }
    seenObjects.add(node)

    if (Array.isArray(node)) {
      const notebook = extractNotebookFromArray(node)
      if (notebook) {
        if (notebookPathHints.size === 0 || notebookPathHints.has(notebook.id)) {
          upsertNotebook(notebooks, notebook)
        }
      }

      for (const item of node) {
        visit(item)
      }
      return
    }

    for (const value of Object.values(node)) {
      visit(value)
    }
  }

  visit(obj)
  return Array.from(notebooks.values())
}

const STUDIO_SIGNAL_TOKENS = [
  "studio",
  "estudio",
  "estúdio",
  "audio overview",
  "audio_overview",
  "visao geral de audio",
  "visão geral de áudio",
  "visao geral do video",
  "visão geral do vídeo",
  "video_overview",
  "apresentacao de slides",
  "apresentação de slides",
  "slides",
  "slide",
  "mind map",
  "mapa mental",
  "mind_map",
  "infografico",
  "infográfico",
  "infographic",
  "quiz",
  "relatorios",
  "relatórios",
  "tabela de dados",
  "cartoes de memorizacao",
  "cartões de memorização",
  "flashcards",
  "flashcard",
  "flashcards",
  "visao geral de video",
  "video overview",
  "audio overview",
  "guia de estudo",
  "postagem no blog",
  "blog post"
]

const STUDIO_ICON_TOKEN_PATTERN = /^[a-z0-9_]+$/u
const BLOCKED_RPC_IDS = new Set(["wXbhsf", "rLM1Ne", "hizoJc", "izAoDd", "FLmJqe"])
const STUDIO_BLOCKED_TITLES = new Set([
  "studio",
  "estudio",
  "estúdio",
  "resultado do studio",
  "exportar resultado do studio"
])
const CHAT_SIGNAL_PHRASES = [
  "create a detailed briefing document",
  "include quotes from the original sources",
  "designed to address this topic",
  "inclua citacoes",
  "inclua citações",
  "crie um briefing detalhado",
  "responda a esta pergunta"
]

const STUDIO_REQUEST_HINTS = [
  "studio",
  "estudio",
  "estúdio",
  "audio overview",
  "audio_overview",
  "visao geral de audio",
  "visão geral de áudio",
  "visao geral do video",
  "visão geral do vídeo",
  "video overview",
  "video_overview",
  "apresentacao de slides",
  "apresentação de slides",
  "slides",
  "mind map",
  "mapa mental",
  "mind_map",
  "infografico",
  "infográfico",
  "infographic",
  "quiz",
  "relatorios",
  "relatórios",
  "tabela de dados",
  "cartoes de memorizacao",
  "cartões de memorização",
  "flashcards",
  "flashcard",
  "guia de estudo"
]
const STUDIO_RPC_TTL_MS = 120_000
const trackedStudioRpcIds = new Map<string, { ts: number; studioHint: boolean }>()

function resolveRpcIdsFromUrl(requestUrl: string): string[] {
  try {
    const resolved = new URL(requestUrl, window.location.origin)
    const rpcids = String(resolved.searchParams.get("rpcids") ?? "")
    return rpcids
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function normalizeRequestBody(value: unknown): string {
  if (!value) {
    return ""
  }
  if (typeof value === "string") {
    return value
  }
  if (value instanceof URLSearchParams) {
    return value.toString()
  }
  if (value instanceof FormData) {
    const params = new URLSearchParams()
    value.forEach((entryValue, key) => {
      params.append(key, String(entryValue))
    })
    return params.toString()
  }
  try {
    return String(value)
  } catch {
    return ""
  }
}

function looksLikeStudioRequestPayload(raw: string): boolean {
  const normalized = normalizeStudioToken(raw)
  if (!normalized) {
    return false
  }
  return STUDIO_REQUEST_HINTS.some((token) => normalized.includes(normalizeStudioToken(token)))
}

function extractRpcIdsFromRequestBody(body: unknown): { ids: string[]; studioHint: boolean } {
  const rawBody = normalizeRequestBody(body)
  if (!rawBody) {
    return { ids: [], studioHint: false }
  }

  let studioHint = looksLikeStudioRequestPayload(rawBody)
  const params = new URLSearchParams(rawBody)
  const fReq = params.get("f.req")
  if (!fReq) {
    return { ids: [], studioHint }
  }

  studioHint = studioHint || looksLikeStudioRequestPayload(fReq)

  try {
    const parsed = JSON.parse(fReq)
    const calls = Array.isArray(parsed?.[0]) ? parsed[0] : []
    const ids = calls
      .map((call: unknown) => (Array.isArray(call) ? String(call[0] ?? "") : ""))
      .filter(Boolean)
    return { ids, studioHint }
  } catch {
    return { ids: [], studioHint }
  }
}

function pruneTrackedRpcIds(now = Date.now()): void {
  for (const [rpcId, entry] of trackedStudioRpcIds.entries()) {
    if (now - entry.ts > STUDIO_RPC_TTL_MS) {
      trackedStudioRpcIds.delete(rpcId)
    }
  }
}

function rememberRpcIds(ids: string[], studioHint: boolean): void {
  const now = Date.now()
  if (!ids.length) {
    pruneTrackedRpcIds(now)
    return
  }
  ids.forEach((rpcId) => {
    if (!rpcId) {
      return
    }
    const existing = trackedStudioRpcIds.get(rpcId)
    trackedStudioRpcIds.set(rpcId, {
      ts: now,
      studioHint: existing?.studioHint || studioHint
    })
  })
  pruneTrackedRpcIds(now)
}

function getTrackedRpcIdSet(preferStudioHint: boolean): Set<string> {
  pruneTrackedRpcIds()
  if (preferStudioHint) {
    const studioOnly = new Set(
      Array.from(trackedStudioRpcIds.entries())
        .filter(([, entry]) => entry.studioHint)
        .map(([rpcId]) => rpcId)
    )
    if (studioOnly.size > 0) {
      return studioOnly
    }
  }
  return new Set(trackedStudioRpcIds.keys())
}

function looksLikeJsonPayloadString(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 20) {
    return false
  }
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return false
  }
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

function extractNameFromJsonPayload(value: string): string | null {
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === "object" && "name" in (parsed as Record<string, unknown>)) {
      const name = String((parsed as Record<string, unknown>).name ?? "").trim()
      return name || null
    }
  } catch {
    return null
  }
  return null
}

function isStructuredJsonContent(value: string): boolean {
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== "object") {
      return false
    }
    if ("name" in (parsed as Record<string, unknown>) && "children" in (parsed as Record<string, unknown>)) {
      return true
    }
  } catch {
    return false
  }
  return false
}

function normalizeStudioToken(value: string): string {
  return normalizeString(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function rawResponseSeemsStudio(rawResponseText: string): boolean {
  const normalized = normalizeStudioToken(rawResponseText)
  if (!normalized) {
    return false
  }
  return STUDIO_SIGNAL_TOKENS.some((token) => normalized.includes(token))
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//iu.test(value) || /^www\./iu.test(value)
}

function looksLikeId(value: string): boolean {
  const normalized = normalizeString(value)
  if (!normalized) {
    return false
  }
  if (normalized.length < 8 || normalized.length > 120) {
    return false
  }
  if (BLOCKED_RPC_IDS.has(normalized)) {
    return false
  }
  if (normalized.includes(" ") || normalized.includes("/")) {
    return false
  }
  if (/^https?:/iu.test(normalized)) {
    return false
  }
  return /[A-Za-z0-9_-]/u.test(normalized)
}

function looksLikeMeta(value: string): boolean {
  const normalized = normalizeStudioToken(value)
  if (!normalized) {
    return false
  }
  return (
    /\b\d+\s*(fontes?|sources?)\b/u.test(normalized) ||
    /\bha\s+\d+\b/u.test(normalized) ||
    /\b\d+\s*(hours?|horas?|mins?|minutes?|dias?)\b/u.test(normalized)
  )
}

function looksLikeType(value: string): boolean {
  const normalized = normalizeStudioToken(value)
  if (!normalized) {
    return false
  }
  return STUDIO_SIGNAL_TOKENS.some((token) => normalized.includes(normalizeStudioToken(token)))
}

function isIconLikeTitle(value: string): boolean {
  const normalized = normalizeString(value)
  if (!normalized) {
    return true
  }
  if (STUDIO_ICON_TOKEN_PATTERN.test(normalized) && !/\s/u.test(normalized)) {
    return true
  }
  return false
}

function looksLikeTitle(value: string): boolean {
  const normalized = normalizeString(value)
  if (!normalized) {
    return false
  }
  if (looksLikeUrl(normalized)) {
    return false
  }
  if (BLOCKED_RPC_IDS.has(normalized)) {
    return false
  }
  const normalizedKey = normalizeStudioToken(normalized)
  if (STUDIO_BLOCKED_TITLES.has(normalizedKey)) {
    return false
  }
  if (isIconLikeTitle(normalized)) {
    return false
  }
  if (normalized.length < 6 || normalized.length > 140) {
    return false
  }
  const wordCount = normalized.split(/\s+/u).filter(Boolean).length
  if (wordCount > 20) {
    return false
  }
  if (normalized.includes(".") && normalized.length > 90) {
    return false
  }
  if (!/\s/u.test(normalized) && normalized.length < 10) {
    return false
  }
  if (!/[A-Za-z\u00c0-\u00ff]/u.test(normalized)) {
    return false
  }
  return true
}

function looksLikeContent(value: string): boolean {
  const normalized = normalizeString(value)
  if (normalized.length < 160) {
    return false
  }
  if (!/[A-Za-z\u00c0-\u00ff]/u.test(normalized)) {
    return false
  }
  if (!/[.!?]/u.test(normalized)) {
    return false
  }
  const bracketCount = (normalized.match(/[\[\]]/g) ?? []).length
  if (bracketCount > 12) {
    return false
  }
  const jsonish = normalized.startsWith("[[") || normalized.includes('","') || normalized.includes("\\u00")
  if (jsonish) {
    return false
  }
  return true
}

function isChatLikeStudioItem(item: StudioItem): boolean {
  const title = normalizeStudioToken(item.title ?? "")
  const meta = normalizeStudioToken(item.meta ?? "")
  const content = normalizeStudioToken(item.content ?? "")
  const isQuestion = title.endsWith("?")
  if (isQuestion) {
    return true
  }
  const wordCount = title.split(/\s+/u).filter(Boolean).length
  if (wordCount > 20 || title.length > 120) {
    return true
  }
  if (title.includes(".") && title.length > 90) {
    return true
  }
  return CHAT_SIGNAL_PHRASES.some((phrase) => meta.includes(phrase) || content.includes(phrase))
}

function isDownloadableAssetUrl(value: string): boolean {
  if (!looksLikeUrl(value)) {
    return false
  }
  const lower = value.toLowerCase()
  if (/\.(png|jpe?g|gif|webp|svg|mp3|wav|ogg|m4a|aac|flac|mp4|mkv|webm|mov|avi|pdf)(\?|#|$)/u.test(lower)) {
    return true
  }
  if (lower.includes("alt=media") || lower.includes("download=")) {
    return true
  }
  return false
}

function hashString(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash.toString(36)
}

function normalizeStudioId(candidate: string, fallbackSeed: string): string {
  const normalized = normalizeString(candidate)
  if (normalized && looksLikeId(normalized)) {
    return normalized
  }
  return `studio_${hashString(fallbackSeed)}`
}

function deriveStudioKind(item: StudioItem): "text" | "asset" {
  const url = normalizeString(item.url)
  const mime = normalizeString(item.mimeType).toLowerCase()
  const type = normalizeStudioToken(item.type ?? "")
  if (url && isDownloadableAssetUrl(url)) {
    return "asset"
  }
  if (mime && /(audio|video|image|pdf)/u.test(mime)) {
    return "asset"
  }
  if (/(audio|video|slide|infograf|mapa|mind map|quiz)/u.test(type)) {
    return "asset"
  }
  return "text"
}

function scoreStudioTitle(value: string): number {
  const normalized = normalizeString(value)
  let score = normalized.length
  if (/\s/u.test(normalized)) {
    score += 6
  }
  if (/[A-Z\u00c0-\u00ff]/u.test(normalized)) {
    score += 2
  }
  if (isIconLikeTitle(normalized)) {
    score -= 12
  }
  return score
}

function extractStudioCandidateFromObject(candidate: Record<string, unknown>): StudioItem | null {
  const stringEntries = Object.entries(candidate).filter(
    ([, value]) => typeof value === "string"
  ) as Array<[string, string]>

  let title = ""
  let id = ""
  let type = ""
  let meta = ""
  let content = ""
  let url = ""
  let mimeType = ""
  let sourceCount: number | undefined
  let updatedAt = ""

  for (const [key, value] of stringEntries) {
    const normalizedKey = normalizeStudioToken(key)
    const trimmedValue = normalizeString(value)
    if (!trimmedValue) {
      continue
    }

    if (!title && /(title|name|label|heading|displayname)/u.test(normalizedKey) && looksLikeTitle(trimmedValue)) {
      title = trimmedValue
      continue
    }

    if (
      !id &&
      /(id|uid|guid|artifact|result|item|resource)/u.test(normalizedKey) &&
      looksLikeId(trimmedValue)
    ) {
      id = trimmedValue
      continue
    }

    if (!type && /(type|kind|category|format)/u.test(normalizedKey)) {
      if (looksLikeJsonPayloadString(trimmedValue)) {
        if (!content) {
          content = trimmedValue
        }
        const extractedName = extractNameFromJsonPayload(trimmedValue)
        if (extractedName && looksLikeTitle(extractedName)) {
          type = extractedName
        }
        continue
      }
      if (looksLikeType(trimmedValue)) {
        type = trimmedValue
        continue
      }
    }

    if (!url && /(url|link|download|media)/u.test(normalizedKey) && looksLikeUrl(trimmedValue)) {
      url = trimmedValue
      continue
    }

    if (!mimeType && /(mime|contenttype)/u.test(normalizedKey)) {
      mimeType = trimmedValue
      continue
    }

    if (!content && /(content|text|body|markdown|plaintext|html)/u.test(normalizedKey) && looksLikeContent(trimmedValue)) {
      content = trimmedValue
      continue
    }

    if (!meta && /(meta|subtitle|summary|description)/u.test(normalizedKey)) {
      if (looksLikeJsonPayloadString(trimmedValue)) {
        if (!content) {
          content = trimmedValue
        }
        continue
      }
      if (looksLikeMeta(trimmedValue)) {
        meta = trimmedValue
        continue
      }
    }
  }

  for (const [, value] of stringEntries) {
    if (!title && looksLikeTitle(value)) {
      title = value
      continue
    }
    if (!type) {
      if (looksLikeJsonPayloadString(value)) {
        if (!content) {
          content = value
        }
        const extractedName = extractNameFromJsonPayload(value)
        if (extractedName && looksLikeTitle(extractedName)) {
          type = extractedName
        }
        continue
      }
      if (looksLikeType(value)) {
        type = value
        continue
      }
    }
    if (!meta) {
      if (looksLikeJsonPayloadString(value)) {
        if (!content) {
          content = value
        }
        continue
      }
      if (looksLikeMeta(value)) {
        meta = value
        continue
      }
    }
    if (!content && looksLikeContent(value)) {
      content = value
      continue
    }
    if (!url && looksLikeUrl(value)) {
      url = value
      continue
    }
  }

  for (const [key, value] of Object.entries(candidate)) {
    if (typeof value === "number" && /(count|sources)/u.test(normalizeStudioToken(key))) {
      sourceCount = value
    }
    if (typeof value === "string" && /(date|time|updated|created)/u.test(normalizeStudioToken(key))) {
      if (!updatedAt && Date.parse(value)) {
        updatedAt = value
      }
    }
  }

  if (!title && content && looksLikeJsonPayloadString(content)) {
    const extractedName = extractNameFromJsonPayload(content)
    if (extractedName && looksLikeTitle(extractedName)) {
      title = extractedName
    }
  }

  if (!title || isIconLikeTitle(title)) {
    return null
  }

  const score =
    (title ? 10 : 0) +
    (id ? 6 : 0) +
    (type ? 4 : 0) +
    (meta ? 2 : 0) +
    (content ? 4 : 0) +
    (url ? 4 : 0) +
    (sourceCount ? 2 : 0) +
    (updatedAt ? 1 : 0)

  if (score < 12) {
    return null
  }

  const resolvedId = normalizeStudioId(id, `${title}|${type}|${meta}`)
  const resolvedMeta =
    meta ||
    (sourceCount ? `${sourceCount} fontes` : "") ||
    (type ? type : "")

  const item: StudioItem = {
    id: resolvedId,
    title,
    type: type || undefined,
    meta: resolvedMeta || undefined,
    content: content || undefined,
    url: url || undefined,
    mimeType: mimeType || undefined,
    sourceCount,
    updatedAt: updatedAt || undefined
  }
  item.kind = deriveStudioKind(item)
  return item
}

function extractStudioCandidateFromArray(candidate: readonly unknown[]): StudioItem | null {
  const stringValues = candidate.filter((value) => typeof value === "string") as string[]
  if (stringValues.length === 0) {
    return null
  }

  const titleCandidate = [...stringValues]
    .filter((value) => looksLikeTitle(value))
    .sort((a, b) => scoreStudioTitle(b) - scoreStudioTitle(a))[0]

  if (!titleCandidate) {
    return null
  }

  const idCandidate = stringValues.find((value) => looksLikeId(value) && value !== titleCandidate) ?? ""
  const typeCandidate = stringValues.find((value) => looksLikeType(value) && value !== titleCandidate) ?? ""
  const metaCandidate = stringValues.find((value) => looksLikeMeta(value) && value !== titleCandidate) ?? ""
  const urlCandidate = stringValues.find((value) => looksLikeUrl(value)) ?? ""
  const contentCandidate = stringValues.find((value) => looksLikeContent(value)) ?? ""

  const score =
    10 +
    (idCandidate ? 6 : 0) +
    (typeCandidate ? 4 : 0) +
    (metaCandidate ? 2 : 0) +
    (contentCandidate ? 4 : 0) +
    (urlCandidate ? 4 : 0)

  if (score < 12) {
    return null
  }

  const resolvedId = normalizeStudioId(idCandidate, `${titleCandidate}|${typeCandidate}|${metaCandidate}`)
  const item: StudioItem = {
    id: resolvedId,
    title: titleCandidate,
    type: typeCandidate || undefined,
    meta: metaCandidate || undefined,
    content: contentCandidate || undefined,
    url: urlCandidate || undefined
  }
  item.kind = deriveStudioKind(item)
  return item
}

function mergeStudioItems(existing: StudioItem, incoming: StudioItem): StudioItem {
  const merged: StudioItem = { ...existing, ...incoming }

  if (!existing.content && incoming.content) {
    merged.content = incoming.content
  }

  if (!existing.url && incoming.url) {
    merged.url = incoming.url
  }

  if (!existing.type && incoming.type) {
    merged.type = incoming.type
  }

  if (!existing.meta && incoming.meta) {
    merged.meta = incoming.meta
  }

  merged.kind = deriveStudioKind(merged)
  return merged
}

function extractStudioArtifacts(payload: unknown): StudioItem[] {
  const items: StudioItem[] = []
  const seen = new Set<string>()
  const seenObjects = new WeakSet<object>()

  const visit = (node: unknown): void => {
    if (!node) {
      return
    }
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (typeof node !== "object") {
      return
    }
    if (seenObjects.has(node as object)) {
      return
    }
    seenObjects.add(node as object)

    const obj = node as Record<string, unknown>
    const title = typeof obj.title === "string" ? obj.title : ""
    const id = typeof obj.id === "string" ? obj.id : ""
    const content = typeof obj.content === "string" ? obj.content : ""
    const url = typeof obj.url === "string" ? obj.url : ""
    const mimeType = typeof obj.mimeType === "string" ? obj.mimeType : ""
    const type = typeof obj.type === "string" ? obj.type : ""

    const hasAsset = Boolean(url) && /(audio|video|image|pdf)/i.test(mimeType)
    const hasContent = content.length > 50

    if (id && title && (hasContent || hasAsset)) {
      const key = `${id}::${title}`
      if (!seen.has(key)) {
        seen.add(key)
        items.push({
          id,
          title,
          content: hasContent ? content : undefined,
          url: hasAsset ? url : undefined,
          mimeType: hasAsset ? mimeType : undefined,
          type: type || undefined,
          kind: hasAsset ? "asset" : "text"
        })
      }
    }

    Object.values(obj).forEach(visit)
  }

  visit(payload)
  return items
}

const STUDIO_RPC_ALLOWLIST = new Set(["cFji9", "Fxmvse", "u1B5j"])

function looksLikeJsonTreeString(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return false
  }
  return trimmed.includes("\"children\"") || trimmed.includes("\"name\"")
}

function extractTitleAndSources(info: unknown): { title?: string; sourceCount?: number } {
  if (!Array.isArray(info)) {
    return {}
  }
  let titleCandidate = ""
  let sourceCount: number | undefined

  // title: prefer longest human-readable string
  const stringCandidates = info
    .filter((value) => typeof value === "string")
    .map((value) => String(value).trim())
    .filter((value) => value.length >= 6 && /\s/u.test(value))
  if (stringCandidates.length > 0) {
    titleCandidate = stringCandidates.sort((a, b) => b.length - a.length)[0]
  }

  // source count: prefer array-of-arrays position
  if (Array.isArray(info[4])) {
    sourceCount = info[4].length
  } else {
    const arrayCandidates = info.filter((value) => Array.isArray(value)) as unknown[][]
    const listCandidate = arrayCandidates.find(
      (value) => value.length > 0 && Array.isArray(value[0])
    )
    if (listCandidate) {
      sourceCount = listCandidate.length
    }
  }

  return {
    title: titleCandidate || undefined,
    sourceCount
  }
}

function extractStudioItemsFromCji9Payload(payload: unknown): StudioItem[] {
  const items: StudioItem[] = []
  const seen = new Set<string>()
  const seenObjects = new WeakSet<object>()

  const visit = (node: unknown): void => {
    if (!node) {
      return
    }
    if (Array.isArray(node)) {
      if (node.length >= 2 && typeof node[0] === "string" && typeof node[1] === "string") {
        const id = String(node[0])
        const json = String(node[1])
        if (looksLikeJsonTreeString(json)) {
          const info = node.find((value) => Array.isArray(value)) ?? node[2]
          const { title, sourceCount } = extractTitleAndSources(info)
          let parsedTitle = title
          if (!parsedTitle) {
            try {
              const parsed = JSON.parse(json)
              if (parsed && typeof parsed === "object" && "name" in parsed) {
                parsedTitle = String((parsed as Record<string, unknown>).name ?? "").trim() || undefined
              }
            } catch {
              // ignore
            }
          }
          if (parsedTitle) {
            const key = `${id}::${parsedTitle}`
            if (!seen.has(key)) {
              seen.add(key)
              items.push({
                id,
                title: parsedTitle,
                content: json,
                meta: sourceCount ? `${sourceCount} fontes` : undefined,
                kind: "text"
              })
            }
          }
        }
      }
      node.forEach(visit)
      return
    }
    if (typeof node !== "object") {
      return
    }
    if (seenObjects.has(node as object)) {
      return
    }
    seenObjects.add(node as object)
    Object.values(node as Record<string, unknown>).forEach(visit)
  }

  visit(payload)
  return items
}

function findStudioItemsInObject(obj: unknown): StudioItem[] {
  const items = new Map<string, StudioItem>()
  const queue: unknown[] = [obj]
  const seenObjects = new WeakSet<object>()
  const parsedStrings = new Set<string>()

  const pushItem = (item: StudioItem | null) => {
    if (!item) {
      return
    }
    const key = item.id || normalizeStudioToken(item.title)
    const existing = items.get(key)
    if (!existing) {
      items.set(key, item)
      return
    }
    items.set(key, mergeStudioItems(existing, item))
  }

  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      const normalizedValue = normalizeString(node)
      if (!normalizedValue || parsedStrings.has(normalizedValue)) {
        return
      }
      const looksLikeJson =
        (normalizedValue.startsWith("[") && normalizedValue.endsWith("]")) ||
        (normalizedValue.startsWith("{") && normalizedValue.endsWith("}"))
      if (!looksLikeJson) {
        return
      }
      parsedStrings.add(normalizedValue)
      try {
        visit(JSON.parse(normalizedValue))
      } catch {
        return
      }
      return
    }

    if (!node || typeof node !== "object") {
      return
    }

    if (seenObjects.has(node)) {
      return
    }
    seenObjects.add(node)

    if (Array.isArray(node)) {
      pushItem(extractStudioCandidateFromArray(node))
      for (const item of node) {
        visit(item)
      }
      return
    }

    pushItem(extractStudioCandidateFromObject(node as Record<string, unknown>))
    for (const value of Object.values(node as Record<string, unknown>)) {
      visit(value)
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()
    visit(current)
  }

  return Array.from(items.values())
}

function splitJsonFrames(raw: string): string[] {
  const frames: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === "\\") {
        escaped = true
        continue
      }
      if (ch === "\"") {
        inString = false
      }
      continue
    }

    if (ch === "\"") {
      inString = true
      continue
    }
    if (ch === "[" || ch === "{") {
      if (depth === 0) {
        start = i
      }
      depth += 1
      continue
    }
    if (ch === "]" || ch === "}") {
      depth -= 1
      if (depth === 0 && start >= 0) {
        frames.push(raw.slice(start, i + 1))
        start = -1
      }
    }
  }

  return frames
}

function parseGoogleRpcResponse(rawData: string): unknown[] {
  try {
    const normalizedRawData = String(rawData ?? "")
      .replace(/^\)\]\}'\s*/, "")
      .trim()

    if (!normalizedRawData) {
      return []
    }

    try {
      return [JSON.parse(normalizedRawData)]
    } catch {
      const parsedNodes: unknown[] = []
      const frames = splitJsonFrames(normalizedRawData)
      for (const frame of frames) {
        try {
          parsedNodes.push(JSON.parse(frame))
        } catch {
          continue
        }
      }
      return parsedNodes
    }
  } catch {
    return []
  }
}

const MAX_JSON_DEPTH = 3

function tryParseJsonDeep(value: unknown, depth = 0): unknown {
  if (depth >= MAX_JSON_DEPTH) {
    return value
  }
  if (typeof value !== "string") {
    return value
  }

  const trimmed = value.replace(/^\)\]\}'\s*/, "").trim()
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
    return value
  }

  try {
    const parsed = JSON.parse(trimmed)
    return tryParseJsonDeep(parsed, depth + 1)
  } catch {
    return value
  }
}

function extractRpcPayloadNodes(node: unknown): unknown[] {
  const out: unknown[] = []

  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      if (value.length >= 2 && typeof value[0] === "string" && typeof value[1] === "string") {
        const parsed = tryParseJsonDeep(value[1])
        if (parsed !== value[1]) {
          out.push(parsed)
        }
      }
      value.forEach(visit)
      return
    }

    if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(visit)
    }
  }

  visit(node)
  return out
}

function parseBatchexecuteCalls(rawNetworkResponse: string): Array<{ rpcId: string; payload: unknown }> {
  const parsedNodes = parseGoogleRpcResponse(rawNetworkResponse)
  if (parsedNodes.length === 0) {
    console.warn("[MindDock][Studio][RPC] parsedNodes: 0, raw length:", rawNetworkResponse.length)
    return []
  }

  const calls: Array<{ rpcId: string; payload: unknown }> = []
  const seen = new Set<string>()

  const pushCall = (rpcId: string, payloadRaw: unknown) => {
    const key = `${rpcId}::${typeof payloadRaw}`
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    const payload = typeof payloadRaw === "string" ? tryParseJsonDeep(payloadRaw) : payloadRaw
    calls.push({ rpcId, payload })
  }

  const visit = (node: unknown, depth = 0) => {
    if (depth > 6) {
      return
    }
    if (Array.isArray(node)) {
      if (node.length >= 2 && typeof node[0] === "string") {
        pushCall(node[0], node[1])
      }
      node.forEach((child) => visit(child, depth + 1))
      return
    }
    if (node && typeof node === "object") {
      Object.values(node as Record<string, unknown>).forEach((child) => visit(child, depth + 1))
    }
  }

  for (const node of parsedNodes) {
    visit(node, 0)
  }

  return calls
}

function broadcastStudioItems(
  items: StudioItem[],
  accountHints?: { accountEmail?: string; authUser?: string }
): void {
  try {
    window.postMessage(
      {
        source: MESSAGE_SOURCE,
        type: STUDIO_MESSAGE_TYPE,
        payload: {
          items,
          authUser: accountHints?.authUser,
          accountEmail: accountHints?.accountEmail
        }
      },
      window.location.origin
    )
  } catch {
    // Silent by design: parsing failures must not affect the page.
  }
}

function broadcastNotebookList(
  notebooks: NotebookEntry[],
  accountHints?: { accountEmail?: string; authUser?: string }
): void {
  try {
    window.postMessage(
      {
        source: MESSAGE_SOURCE,
        type: MESSAGE_TYPE,
        payload: {
          notebooks,
          authUser: accountHints?.authUser,
          accountEmail: accountHints?.accountEmail
        }
      },
      window.location.origin
    )
  } catch {
    // Silent by design: parsing failures must not affect the page.
  }
}

function processStudioNetworkResponse(rawNetworkResponse: string, requestUrl: string): void {
  try {
    const now = Date.now()
    if (now > studioArmUntil) {
      return
    }
    console.warn("[MindDock][Studio][ARMED] janela ms:", studioArmUntil - now)
    const calls = parseBatchexecuteCalls(rawNetworkResponse)
    if (calls.length === 0) {
      const snippet = rawNetworkResponse.slice(0, 220).replace(/\s+/g, " ")
      console.warn("[MindDock][Studio][RPC] calls: 0, raw head:", snippet)
      return
    }

    const items = new Map<string, StudioItem>()

    const callRpcIds = calls.map((call) => call.rpcId)
    const preferredCalls = calls.filter((call) => STUDIO_RPC_ALLOWLIST.has(call.rpcId))
    const callsToProcess = preferredCalls.length > 0 ? preferredCalls : calls

    console.warn("[MindDock][Studio][RPC] calls:", calls.length)
    console.warn("[MindDock][Studio][RPC] rpcids sample:", callRpcIds.slice(0, 6))

    for (const call of callsToProcess) {
      const payloadCandidates = [call.payload, ...extractRpcPayloadNodes(call.payload)]
      for (const candidate of payloadCandidates) {
        const extractedItems = STUDIO_RPC_ALLOWLIST.has(call.rpcId)
          ? extractStudioItemsFromCji9Payload(candidate)
          : extractStudioArtifacts(candidate)
        for (const item of extractedItems) {
          const key = item.id || normalizeStudioToken(item.title)
          const existing = items.get(key)
          if (!existing) {
            items.set(key, item)
            continue
          }
          items.set(key, mergeStudioItems(existing, item))
        }
      }
    }

    const filteredItems = Array.from(items.values()).filter((item) => {
      const hasAsset =
        Boolean(item.mimeType && /(audio|video|image|pdf)/u.test(String(item.mimeType).toLowerCase())) ||
        Boolean(item.url && isDownloadableAssetUrl(item.url))
      const hasContent = typeof item.content === "string" && item.content.trim().length > 50
      const hasMeta = Boolean(item.meta && item.meta.trim().length > 0)
      return hasContent || hasAsset || hasMeta
    })

    if (filteredItems.length === 0) {
      return
    }

    const accountHints = resolveNotebookAccountHints(requestUrl)
    broadcastStudioItems(filteredItems, accountHints)
    const requestRpcIds = resolveRpcIdsFromUrl(requestUrl)
    console.group("[MindDock][Studio][RPC]")
    console.log("rpcids:", requestRpcIds.join(",") || "n/a")
    console.log("calls:", calls.length)
    console.log("items:", filteredItems.length)
    console.table(
      filteredItems.slice(0, 5).map((item) => ({
        title: item.title,
        type: item.type,
        meta: item.meta,
        url: item.url,
        mimeType: item.mimeType,
        kind: item.kind
      }))
    )
    console.groupEnd()
  } catch {
    // Silent by design: parsing failures must not affect the page.
  }
}

function processRawNetworkResponse(rawNetworkResponse: string, requestUrl: string): void {
  try {
    const parsedNodes = parseGoogleRpcResponse(rawNetworkResponse)
    if (parsedNodes.length === 0) {
      return
    }

    const notebooks = new Map<string, NotebookEntry>()
    for (const parsedNode of parsedNodes) {
      const extractedNotebooks = findNotebooksInObject(parsedNode, rawNetworkResponse)
      for (const notebook of extractedNotebooks) {
        upsertNotebook(notebooks, notebook)
      }
    }

    const accountHints = resolveNotebookAccountHints(requestUrl)
    broadcastNotebookList(Array.from(notebooks.values()), accountHints)
  } catch {
    // Silent by design: parsing failures must not affect the page.
  }
}

function interceptGoogleCloudRpc(requestUrl: string, rawNetworkResponse: string): void {
  if (!isTargetRequestUrl(requestUrl)) {
    return
  }

  rememberRpcContextFromUrlAndBody(requestUrl)

  if (Date.now() <= studioArmUntil) {
    const head = String(rawNetworkResponse ?? "").slice(0, 180).replace(/\s+/g, " ")
    console.warn("[MindDock][Studio][RAW]", "len:", rawNetworkResponse.length, "head:", head)
  }

  if (doesRequestTargetNotebookList(requestUrl)) {
    processRawNetworkResponse(rawNetworkResponse, requestUrl)
  }

  processStudioNetworkResponse(rawNetworkResponse, requestUrl)
}

function resolveRequestUrl(requestInput: RequestInfo | URL): string {
  if (requestInput instanceof Request) {
    return requestInput.url
  }

  return String(requestInput ?? "")
}

function patchFetch(): void {
  const originalFetch = window.fetch

  window.fetch = new Proxy(originalFetch, {
    apply(target, thisArg, argArray: [RequestInfo | URL, RequestInit | undefined]) {
      const [requestInput, requestInit] = argArray
      console.log("📡 Fetch detectado:", requestInput?.toString())

      const requestUrl = resolveRequestUrl(requestInput)
      const isBatchExecuteTarget = isTargetRequestUrl(requestUrl)
      if (isBatchExecuteTarget) {
        const bodyText =
          typeof requestInit?.body === "string"
            ? requestInit.body
            : requestInit?.body instanceof URLSearchParams
            ? requestInit.body.toString()
            : undefined
        rememberRpcContextFromUrlAndBody(requestUrl, bodyText)
        console.log("🎯 Alvo batchexecute identificado na URL:", requestUrl)
        const urlRpcIds = resolveRpcIdsFromUrl(requestUrl)
        const { ids: bodyRpcIds, studioHint } = extractRpcIdsFromRequestBody(requestInit?.body)
        rememberRpcIds([...urlRpcIds, ...bodyRpcIds], studioHint)
        if (requestInput instanceof Request && bodyRpcIds.length === 0) {
          try {
            void requestInput
              .clone()
              .text()
              .then((text) => {
                const { ids, studioHint: hint } = extractRpcIdsFromRequestBody(text)
                rememberRpcIds([...urlRpcIds, ...ids], hint)
              })
              .catch(() => {
                // Silent by design: never break the page.
              })
          } catch {
            // Silent by design: never break the page.
          }
        }
      }

      const responsePromise = Reflect.apply(target, thisArg, argArray) as Promise<Response>

      if (!isBatchExecuteTarget) {
        return responsePromise
      }

      return responsePromise.then((response) => {
        try {
          void response
            .clone()
            .text()
            .then((rawNetworkResponse) => {
              interceptGoogleCloudRpc(requestUrl, rawNetworkResponse)
            })
            .catch(() => {
              // Silent by design: never break the page.
            })
        } catch {
          // Silent by design: never break the page.
        }

        return response
      })
    }
  })
}

function patchXmlHttpRequest(): void {
  const originalOpen = XMLHttpRequest.prototype.open

  XMLHttpRequest.prototype.open = new Proxy(originalOpen, {
    apply(target, thisArg, argArray: [string, string | URL, ...unknown[]]) {
      const [, requestInput] = argArray
      const requestUrl = String(requestInput ?? "")

      try {
        Object.defineProperty(thisArg, XHR_URL_KEY, {
          configurable: true,
          value: requestUrl,
          writable: true
        })
      } catch {
        ;(thisArg as XMLHttpRequest & Record<string, unknown>)[XHR_URL_KEY] = requestUrl
      }

      if (isTargetRequestUrl(requestUrl)) {
        thisArg.addEventListener(
          "loadend",
          function onLoadEnd(this: XMLHttpRequest) {
            try {
              const trackedRequestUrl = String(
                (this as XMLHttpRequest & Record<string, unknown>)[XHR_URL_KEY] ?? ""
              )
              const rawNetworkResponse =
                typeof this.responseText === "string" ? this.responseText : ""

              interceptGoogleCloudRpc(trackedRequestUrl, rawNetworkResponse)
            } catch {
              // Silent by design: never break the page.
            }
          },
          { once: true }
        )
      }

      return Reflect.apply(target, thisArg, argArray)
    }
  })
}

function patchXmlHttpRequestSend(): void {
  const originalSend = XMLHttpRequest.prototype.send
  if ((originalSend as typeof XMLHttpRequest.prototype.send & { __minddock_patched?: boolean }).__minddock_patched) {
    return
  }

  const patchedSend = new Proxy(originalSend, {
    apply(target, thisArg, argArray: [Document | BodyInit | null]) {
      try {
        const requestUrl = String(
          (thisArg as XMLHttpRequest & Record<string, unknown>)[XHR_URL_KEY] ?? ""
        )
        if (isTargetRequestUrl(requestUrl)) {
          const body = argArray?.[0]
          const bodyText =
            typeof body === "string"
              ? body
              : body instanceof URLSearchParams
              ? body.toString()
              : undefined
          rememberRpcContextFromUrlAndBody(requestUrl, bodyText)
          const urlRpcIds = resolveRpcIdsFromUrl(requestUrl)
          const { ids, studioHint } = extractRpcIdsFromRequestBody(argArray[0] ?? "")
          rememberRpcIds([...urlRpcIds, ...ids], studioHint)
        }
      } catch {
        // Silent by design: never break the page.
      }

      return Reflect.apply(target, thisArg, argArray)
    }
  }) as typeof originalSend

  ;(patchedSend as typeof XMLHttpRequest.prototype.send & { __minddock_patched?: boolean }).__minddock_patched = true
  XMLHttpRequest.prototype.send = patchedSend
}

function installStudioArmListener(): void {
  window.addEventListener("message", (event) => {
    const data = (event as MessageEvent).data as { source?: string; type?: string } | null
    if (
      !data ||
      (data.source !== STUDIO_ARM_SOURCE && data.source !== STUDIO_ARM_SOURCE_FALLBACK) ||
      data.type !== STUDIO_ARM_TYPE
    ) {
      return
    }
    studioArmUntil = Date.now() + STUDIO_ARM_WINDOW_MS
    console.warn("[MindDock][Studio][ARM] armado por 8s")
  })
}

function bootstrapNetworkTrafficInterceptor(): void {
  const globalRecord = window as typeof window & Record<string, unknown>
  if (globalRecord[INTERCEPTOR_GUARD_KEY]) {
    return
  }

  globalRecord[INTERCEPTOR_GUARD_KEY] = true
  installStudioArmListener()
  patchFetch()
  patchXmlHttpRequest()
  patchXmlHttpRequestSend()
}

bootstrapNetworkTrafficInterceptor()

