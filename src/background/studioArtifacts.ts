import { buildNotebookAccountKey, buildScopedStorageKey } from "~/lib/notebook-account-scope"
import { GoogleRPC } from "./api/GoogleRPC"
import { tokenStorage } from "./storage/TokenStorage"

const STUDIO_LIST_RPC_ID = "gArtLc"
const STUDIO_CONTENT_RPC_ID = "cFji9"
const STUDIO_LIST_FILTER = 'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"'
const STUDIO_CACHE_KEY_BASE = "minddock_cached_studio_items"
const STUDIO_CACHE_SYNC_KEY_BASE = "minddock_cached_studio_items_synced_at"
const STUDIO_ITEM_KEY_BASE = "minddock_studio_item"
const STUDIO_RAW_KEY_BASE = "minddock_rpc_raw"
const RAW_RPC_MAX_CHARS = 350_000

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const MIME_RE = /^[a-z]+\/[a-z0-9.+-]+$/i
const ASSET_EXT_RE =
  /\.(png|jpe?g|gif|webp|svg|pdf|mp3|wav|ogg|m4a|aac|flac|mp4|mkv|webm|mov|avi)(\?|#|$)/i

const LIST_TYPE_LABELS: Record<number, string> = {
  1: "Audio Overview",
  2: "Study Guide",
  3: "Briefing",
  4: "Quiz",
  5: "Summary",
  6: "Mind Map",
  7: "FAQ",
  8: "Timeline",
  9: "Blog Post",
  10: "Infographic",
  11: "Data Table",
  12: "Slides",
  13: "Flashcards",
  14: "Video Overview"
}

const CONTENT_TYPE_LABELS: Record<number, string> = {
  3: "Video Overview",
  4: "Quiz",
  5: "Mind Map",
  7: "Infographic",
  8: "Slides",
  9: "Data Table"
}

export const VISUAL_TYPES = new Set(["Slides", "Infographic", "Mind Map", "Video Overview", "Audio Overview"])

export const EXCLUDED_FROM_EXPORT = new Set(["Quiz", "Data Table", "Flashcards"])

const TYPE_KEYWORDS: Array<{ match: RegExp; label: string }> = [
  { match: /flashcard|cartao|cards?/i, label: "Flashcards" },
  { match: /cart\u00f5es de estudo|cartao de estudo/i, label: "Flashcards" },
  { match: /quiz/i, label: "Quiz" },
  { match: /question\u00e1rio design|design de question/i, label: "Quiz" },
  { match: /mind\s*map|mapa mental/i, label: "Mind Map" },
  { match: /infograph|infograf/i, label: "Infographic" },
  { match: /t\u00edtulo principal|infogr\u00e1fico/i, label: "Infographic" },
  { match: /slides?|apresenta/i, label: "Slides" },
  { match: /video/i, label: "Video Overview" },
  { match: /audio/i, label: "Audio Overview" },
  { match: /faq/i, label: "FAQ" },
  { match: /study guide|guia de estudo/i, label: "Study Guide" },
  { match: /briefing/i, label: "Briefing" },
  { match: /timeline|linha do tempo/i, label: "Timeline" },
  { match: /data table|tabela de dados/i, label: "Data Table" }
]

export type StudioArtifactItem = {
  id: string
  title: string
  meta?: string
  type?: string
  content?: string
  url?: string
  mimeType?: string
  sourceCount?: number
  updatedAt?: string
  kind?: "text" | "asset"
}

function buildListPayload(notebookId: string): unknown[] {
  return [
    [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]], [[2, 1, 3]]],
    notebookId,
    STUDIO_LIST_FILTER
  ]
}

function buildContentPayload(notebookId: string): unknown[] {
  return [notebookId]
}

function buildAltContentPayload(notebookId: string): unknown[] {
  return [[2], notebookId, STUDIO_LIST_FILTER]
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim()
}

function normalizeToken(value: string): string {
  return normalizeString(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function hashString(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash.toString(36)
}

function parseBatchexecuteFrames(rawText: string): unknown[][] {
  const text = String(rawText ?? "").replace(/^\)\]\}'\s*/, "").trim()
  const frames: unknown[][] = []

  const visit = (node: unknown) => {
    if (!Array.isArray(node)) return
    if (node.length >= 3 && node[0] === "wrb.fr") frames.push(node)
    for (const child of node) visit(child)
  }

  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) continue
    try {
      const parsed = JSON.parse(trimmed)
      visit(parsed)
    } catch {}
  }

  return frames
}

const JSON_LIKE_RE = /^[\[{].*[\]}]$/s
const JSON_MAX_LEN = 200_000
const UNESCAPE_RE = /\\[nrt"\\/]/g

function tryParseJsonString(value: string): unknown | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > JSON_MAX_LEN) return null
  if (!JSON_LIKE_RE.test(trimmed)) return null

  try {
    return JSON.parse(trimmed)
  } catch {}

  if (UNESCAPE_RE.test(trimmed)) {
    const unescaped = trimmed
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
    try {
      return JSON.parse(unescaped)
    } catch {}
  }

  return null
}

function collectStrings(node: unknown, out: string[], depth = 0): void {
  if (depth > 6 || node == null) return

  if (typeof node === "string") {
    out.push(node)

    const parsed = tryParseJsonString(node)
    if (parsed) collectStrings(parsed, out, depth + 1)
    return
  }

  if (Array.isArray(node)) {
    node.forEach((child) => collectStrings(child, out, depth + 1))
    return
  }

  if (typeof node === "object") {
    Object.values(node as Record<string, unknown>).forEach((child) =>
      collectStrings(child, out, depth + 1)
    )
  }
}

function collectNumbers(node: unknown, out: number[], depth = 0): void {
  if (depth > 6) return
  if (typeof node === "number" && Number.isFinite(node)) {
    out.push(node)
    return
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectNumbers(child, out, depth + 1))
    return
  }
  if (node && typeof node === "object") {
    Object.values(node as Record<string, unknown>).forEach((child) =>
      collectNumbers(child, out, depth + 1)
    )
  }
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//iu.test(value) || /^\/\//iu.test(value)
}

function normalizeUrl(value: string): string {
  const trimmed = normalizeString(value)
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`
  }
  return trimmed
}

function looksLikeMimeType(value: string): boolean {
  return MIME_RE.test(value)
}

function looksLikeTitle(value: string): boolean {
  const normalized = normalizeString(value)
  if (!normalized) return false
  if (looksLikeMimeType(normalized)) return false
  if (/^[a-z]+\/[a-z0-9]+$/i.test(normalized)) return false
  if (looksLikeUrl(normalized)) return false
  if (UUID_RE.test(normalized)) return false
  if (normalized.length < 4 || normalized.length > 160) return false
  if (!/[A-Za-z\u00c0-\u00ff]/u.test(normalized)) return false
  if (/\n/.test(normalized) && normalized.length > 120) return false
  return true
}

function looksLikeContent(value: string): boolean {
  const normalized = normalizeString(value)
  if (normalized.length < 40) return false
  if (looksLikeUrl(normalized)) return false
  if (looksLikeMimeType(normalized)) return false
  if (looksLikeMeta(normalized)) return false
  if (!/[A-Za-z\u00c0-\u00ff]/u.test(normalized)) return false
  if (UUID_RE.test(normalized.trim())) return false
  return true
}

function isContentish(value: string, titleNorm: string): boolean {
  const v = normalizeString(value)
  if (v.length < 12) return false
  if (looksLikeUrl(v)) return false
  if (looksLikeMimeType(v)) return false
  if (looksLikeMeta(v)) return false
  if (!/[A-Za-z\u00c0-\u00ff]/u.test(v)) return false
  if (titleNorm && v.toLowerCase() === titleNorm.toLowerCase()) return false
  if (UUID_RE.test(v.trim())) return false
  const tokens = v.split(/[\s\-]+/).filter(Boolean)
  const hexTokens = tokens.filter((token) => /^[0-9a-f]{4,}$/i.test(token))
  if (hexTokens.length > 0 && hexTokens.length / tokens.length > 0.5) return false
  return true
}

function scoreContent(value: string): number {
  let score = value.length
  if (value.includes("\n")) score += 200
  if (value.includes("##")) score += 120
  if (value.includes("- ")) score += 60
  if (value.includes("* ")) score += 40
  if (value.length > 200 && !value.includes("\n")) score += 100
  return score
}

function looksLikeMeta(value: string): boolean {
  const normalized = normalizeToken(value)
  if (!normalized) return false
  return (
    /\b\d+\s*(fontes?|sources?)\b/u.test(normalized) ||
    /\bha\s+\d+\b/u.test(normalized) ||
    /\b\d+\s*(hours?|horas?|mins?|minutes?|dias?)\b/u.test(normalized)
  )
}

function findListIdTitle(node: unknown): { id: string; title: string; type?: number } | null {
  if (!Array.isArray(node)) return null

  if (
    node.length >= 2 &&
    typeof node[0] === "string" &&
    typeof node[1] === "string" &&
    UUID_RE.test(node[0])
  ) {
    const title = node[1].trim()
    if (title.length > 1) {
      const type = typeof node[2] === "number" ? node[2] : undefined
      return { id: node[0], title, type }
    }
  }

  for (const child of node) {
    const hit = findListIdTitle(child)
    if (hit) return hit
  }

  return null
}

function stripUuidLines(text: string): string {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false
      if (UUID_RE.test(line) && line.length <= 40) return false

      const tokens = line.split(/[\s,;]+/).filter(Boolean)
      const uuidTokens = tokens.filter((token) => UUID_RE.test(token))
      if (uuidTokens.length >= 2 && uuidTokens.length === tokens.length) return false

      return true
    })
    .join("\n")
    .trim()
}

function isMostlyUuids(text: string): boolean {
  const tokens = String(text || "").split(/[\s,;]+/).filter(Boolean)
  if (tokens.length === 0) return false
  const uuidTokens = tokens.filter((token) => UUID_RE.test(token))
  return uuidTokens.length >= 3 && uuidTokens.length / tokens.length > 0.4
}

function toExcerpt(text: string, max = 160): string {
  const clean = String(text || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
  return clean.length > max ? `${clean.slice(0, max).trim()}…` : clean
}

function looksLikeAssetUrl(value: string): boolean {
  const normalized = normalizeString(value)
  if (!looksLikeUrl(normalized)) return false
  return ASSET_EXT_RE.test(normalized) || normalized.includes("googleusercontent")
}

function scoreTitle(value: string): number {
  const normalized = normalizeString(value)
  let score = normalized.length
  if (/\s/u.test(normalized)) score += 6
  if (/[A-Z\u00c0-\u00ff]/u.test(normalized)) score += 2
  return score
}

function pickBestTitle(strings: string[]): string | null {
  const candidates = strings.filter(looksLikeTitle)
  if (candidates.length === 0) return null
  return candidates.sort((a, b) => scoreTitle(b) - scoreTitle(a))[0]
}

function pickBestContent(strings: string[], title?: string | null): string | null {
  const titleNorm = normalizeString(title ?? "")
  const contentish = strings.filter((value) => isContentish(value, titleNorm))

  if (contentish.length === 0) return null

  const longCandidates = contentish.filter((value) => looksLikeContent(value))
  if (longCandidates.length > 0) {
    return longCandidates.sort((a, b) => scoreContent(b) - scoreContent(a))[0]
  }

  const block = contentish.slice(0, 12).join("\n")
  if (block.length >= 120) return block

  return contentish.sort((a, b) => b.length - a.length)[0] ?? null
}

function pickBestUrl(strings: string[]): string | null {
  const urls = strings.map(normalizeUrl).filter(looksLikeUrl)
  if (urls.length === 0) return null
  const assetUrls = urls.filter(looksLikeAssetUrl)
  if (assetUrls.length > 0) return assetUrls[0]
  return urls[0]
}

function pickBestId(strings: string[], preferredIds?: Set<string>): string {
  if (preferredIds && preferredIds.size > 0) {
    const hit = strings.find((value) => preferredIds.has(value))
    if (hit) return hit
  }
  return strings.find((value) => UUID_RE.test(value)) ?? ""
}

function isAssetLike(type?: string, mime?: string, url?: string): boolean {
  const t = (type ?? "").toLowerCase()
  if (
    t.includes("audio") ||
    t.includes("video") ||
    t.includes("slides") ||
    t.includes("mind map") ||
    t.includes("infographic")
  ) {
    return true
  }
  const normalizedMime = (mime ?? "").toLowerCase()
  if (normalizedMime && MIME_RE.test(normalizedMime) && !normalizedMime.startsWith("text/")) return true
  const normalizedUrl = String(url ?? "")
  if (normalizedUrl && ASSET_EXT_RE.test(normalizedUrl)) return true
  return false
}

function pickSourceCount(strings: string[]): number | undefined {
  for (const value of strings) {
    const match = value.match(/(\d+)\s*(fontes?|sources?)/iu)
    if (match) {
      const parsed = Number.parseInt(match[1], 10)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return undefined
}

function inferTypeLabel(
  title: string,
  content: string,
  numericCandidates: number[],
  context: "list" | "content"
): string | undefined {
  const lookup = context === "list" ? LIST_TYPE_LABELS : CONTENT_TYPE_LABELS
  for (const value of numericCandidates) {
    const asInt = Math.round(value)
    if (context === "list" && CONTENT_TYPE_LABELS[asInt] && VISUAL_TYPES.has(CONTENT_TYPE_LABELS[asInt])) {
      return CONTENT_TYPE_LABELS[asInt]
    }
    if (lookup[asInt]) return lookup[asInt]
  }
  const haystack = `${title} ${content}`.toLowerCase()
  if (/quiz/i.test(haystack)) return "Quiz"
  if (/flashcard|cart\u00e3o|cart\u00f5es de estudo/i.test(haystack)) return "Flashcards"
  if (/faq/i.test(haystack)) return "FAQ"
  if (/study guide|guia de estudo/i.test(haystack)) return "Study Guide"
  if (/briefing/i.test(haystack)) return "Briefing"
  if (/timeline|linha do tempo/i.test(haystack)) return "Timeline"
  if (/infograph|infogr\u00e1f/i.test(haystack)) return "Infographic"
  if (/slides?|apresenta/i.test(haystack)) return "Slides"
  if (/mind\s*map|mapa mental/i.test(haystack)) return "Mind Map"
  if (/data table|tabela de dados/i.test(haystack)) return "Data Table"
  if (/audio/i.test(haystack)) return "Audio Overview"
  if (/video/i.test(haystack)) return "Video Overview"
  if (/## quiz|answer key/i.test(content)) return "Quiz"
  if (/comprehensive briefing|briefing doc/i.test(content)) return "Briefing"
  if (/study guide/i.test(content)) return "Study Guide"
  if (/## glossary.*## faq/is.test(content)) return "FAQ"
  return undefined
}

function deriveKind(item: StudioArtifactItem): "text" | "asset" {
  const type = item.type ?? ""
  const url = normalizeString(item.url)
  const mime = normalizeString(item.mimeType).toLowerCase()
  if (VISUAL_TYPES.has(type)) return "asset"
  if (url && looksLikeAssetUrl(url)) return "asset"
  if (mime && /(audio|video|image|pdf)/u.test(mime)) return "asset"
  return "text"
}

export function resolveFileExtension(type: string, url?: string): string {
  if (["Infographic", "Mind Map"].includes(type)) return "png"
  if (type === "Slides") return "pdf"
  if (["Video Overview", "Audio Overview"].includes(type)) return "mp4"
  return "md"
}

function buildId(idCandidate: string | null, seed: string): string {
  const normalizedId = normalizeString(idCandidate)
  if (normalizedId && UUID_RE.test(normalizedId)) {
    return normalizedId
  }
  return `studio_${hashString(seed)}`
}

function prefer<T>(a?: T, b?: T): T | undefined {
  if (a && String(a).trim?.()) return a
  if (b && String(b).trim?.()) return b
  return a ?? b
}

function mergeStudioItems(existing: StudioArtifactItem, incoming: StudioArtifactItem): StudioArtifactItem {
  const merged: StudioArtifactItem = {
    ...existing,
    ...incoming,
    title: prefer(existing.title, incoming.title) ?? "Studio",
    content: prefer(existing.content, incoming.content),
    url: prefer(existing.url, incoming.url),
    mimeType: prefer(existing.mimeType, incoming.mimeType),
    meta: prefer(existing.meta, incoming.meta),
    type: prefer(existing.type, incoming.type),
    sourceCount: typeof existing.sourceCount === "number" ? existing.sourceCount : incoming.sourceCount,
    updatedAt: existing.updatedAt ?? incoming.updatedAt
  }
  merged.kind = deriveKind(merged)
  return merged
}

function extractStudioItemFromNode(
  node: unknown,
  context: "list" | "content",
  preferredIds?: Set<string>,
  preferredTitles?: Map<string, string>
): StudioArtifactItem | null {
  const strings: string[] = []
  collectStrings(node, strings)
  console.log("[studioArtifacts][dbg] strings", {
    count: strings.length,
    top10: strings.slice(0, 10)
  })
  if (strings.length === 0) return null
  if (context === "list") {
    const listHit = findListIdTitle(node)
    if (listHit) {
      let typeCandidate = inferTypeLabel(
        listHit.title,
        "",
        typeof listHit.type === "number" ? [listHit.type] : [],
        "list"
      )
      if (typeof listHit.type === "number") {
        const contentTypeOverride = CONTENT_TYPE_LABELS[listHit.type]
        if (contentTypeOverride && VISUAL_TYPES.has(contentTypeOverride)) {
          typeCandidate = contentTypeOverride
        }
      }
      const urlInNode = pickBestUrl(strings)
      if (urlInNode) {
        if (/\.pdf/i.test(urlInNode)) typeCandidate = "Slides"
        else if (/\.png|\.jpg|\.jpeg|\.webp/i.test(urlInNode)) typeCandidate = "Infographic"
        else if (/=mp2|=m22|=m140/i.test(urlInNode)) typeCandidate = "Video Overview"
        else if (/\.mp3|\.m4a/i.test(urlInNode)) typeCandidate = "Audio Overview"
        else if (/googleusercontent/i.test(urlInNode) && !typeCandidate) typeCandidate = "Infographic"
      }
      const item: StudioArtifactItem = {
        id: listHit.id,
        title: listHit.title,
        type: typeCandidate || undefined,
        url: urlInNode || undefined,
        content: urlInNode || undefined,
        updatedAt: new Date().toISOString()
      }
      item.kind = deriveKind(item)
      return item
    }
  }

  const idsInNode = strings.filter((value) => UUID_RE.test(value))
  const uniqueIds = Array.from(new Set(idsInNode))
  const preferredHits = preferredIds ? uniqueIds.filter((value) => preferredIds.has(value)) : []
  const hasPreferred = preferredHits.length > 0
  if (context === "content" && preferredIds) {
    if (preferredHits.length !== 1) {
      const hasAssetUrl = strings.some((value) => looksLikeAssetUrl(value))
      if (!hasAssetUrl) return null
    }
  }

  const idCandidate = hasPreferred ? preferredHits[0] : pickBestId(strings, preferredIds)
  if (!UUID_RE.test(String(idCandidate))) {
    return null
  }
  const titleCandidate =
    (preferredTitles && preferredTitles.get(idCandidate)) || pickBestTitle(strings)
  let contentCandidate = pickBestContent(strings, titleCandidate)
  console.log("[studioArtifacts][dbg] candidates", {
    title: titleCandidate,
    content: contentCandidate?.slice?.(0, 120),
    url: pickBestUrl(strings)
  })
  const urlCandidate = pickBestUrl(strings)
  const mimeCandidate = strings.find((value) => looksLikeMimeType(value)) ?? ""
  const metaCandidate = strings.find((value) => looksLikeMeta(value)) ?? ""
  const sourceCount = pickSourceCount(strings)

  const numericCandidates: number[] = []
  collectNumbers(node, numericCandidates)
  let typeCandidate: string | undefined
  typeCandidate = inferTypeLabel(titleCandidate ?? "", "", numericCandidates, context)
  if (!typeCandidate && urlCandidate) {
    if (/\.pdf/i.test(urlCandidate)) typeCandidate = "Slides"
    else if (/\.png|\.jpg|\.jpeg|\.webp/i.test(urlCandidate)) typeCandidate = "Infographic"
    else if (/=mp2|=m22|=m140/i.test(urlCandidate)) typeCandidate = "Video Overview"
    else if (/\.mp3|\.m4a/i.test(urlCandidate)) typeCandidate = "Audio Overview"
    else if (/googleusercontent/i.test(urlCandidate)) typeCandidate = "Infographic"
  }
  if (!typeCandidate) {
    typeCandidate = inferTypeLabel(titleCandidate ?? "", contentCandidate ?? "", numericCandidates, context)
  }

  let cleanedContent = ""
  if (typeof contentCandidate === "string" && contentCandidate.trim().length > 0) {
    cleanedContent = stripUuidLines(contentCandidate)
    if (!cleanedContent || isMostlyUuids(cleanedContent)) {
      if (!urlCandidate) {
        return null
      }
      contentCandidate = null
    } else {
      contentCandidate = cleanedContent
    }
  }

  const score =
    (titleCandidate ? 10 : 0) +
    (idCandidate ? 6 : 0) +
    (contentCandidate ? 4 : 0) +
    (urlCandidate ? 4 : 0) +
    (typeCandidate ? 2 : 0) +
    (metaCandidate ? 1 : 0) +
    (hasPreferred ? 20 : 0)

  const minScore = context === "content" ? (hasPreferred ? 0 : 8) : 12
  if (score < minScore) return null

  const seed = `${titleCandidate ?? ""}|${contentCandidate ?? ""}|${urlCandidate ?? ""}`
  const id = UUID_RE.test(String(idCandidate)) ? String(idCandidate) : buildId(idCandidate, seed)
  const title = titleCandidate ?? "Studio"
  const textFallback = strings
    .filter((value) => {
      if (value.length <= 80) return false
      if (looksLikeUrl(value)) return false
      if (looksLikeMimeType(value)) return false
      if (looksLikeMeta(value)) return false
      if (titleCandidate && value.includes(titleCandidate)) return false
      return true
    })
    .sort((a, b) => b.length - a.length)[0]

  const isAsset =
    isAssetLike(typeCandidate, mimeCandidate, urlCandidate) ||
    (typeof urlCandidate === "string" && ASSET_EXT_RE.test(urlCandidate))
  let content =
    contentCandidate && urlCandidate && contentCandidate === urlCandidate ? undefined : contentCandidate ?? undefined
  if (!content && textFallback) {
    content = textFallback
  }
  const hasContent = typeof content === "string" && content.trim().length > 0
  if (!hasContent && urlCandidate && isAsset) {
    content = urlCandidate
  }

  const metaExcerpt =
    typeof contentCandidate === "string" && contentCandidate.trim().length > 0
      ? toExcerpt(contentCandidate, 140)
      : ""
  const item: StudioArtifactItem = {
    id,
    title,
    meta: metaExcerpt || metaCandidate || undefined,
    type: typeCandidate || undefined,
    content,
    url: urlCandidate || undefined,
    mimeType: mimeCandidate || undefined,
    sourceCount,
    updatedAt: new Date().toISOString()
  }
  item.kind = deriveKind(item)
  if (item.kind === "asset") {
    item.content = item.url ?? item.content
  }
  if (item.url && looksLikeAssetUrl(item.url)) {
    item.kind = "asset"
    item.content = item.url
  }
  return item
}

function extractStudioItemsFromPayload(
  payload: unknown,
  context: "list" | "content",
  preferredIds?: Set<string>,
  preferredTitles?: Map<string, string>
): StudioArtifactItem[] {
  const items = new Map<string, StudioArtifactItem>()
  const seen = new WeakSet<object>()

  const visit = (node: unknown) => {
    if (!node) return
    if (Array.isArray(node)) {
      const candidate = extractStudioItemFromNode(node, context, preferredIds, preferredTitles)
      if (candidate) {
        const existing = items.get(candidate.id)
        if (!existing) {
          items.set(candidate.id, candidate)
        } else if (context !== "list") {
          items.set(candidate.id, mergeStudioItems(existing, candidate))
        }
      }
      node.forEach(visit)
      return
    }
    if (typeof node !== "object") return
    if (seen.has(node as object)) return
    seen.add(node as object)
    const candidate = extractStudioItemFromNode(node, context, preferredIds, preferredTitles)
    if (candidate) {
      const existing = items.get(candidate.id)
      if (!existing) {
        items.set(candidate.id, candidate)
      } else if (context !== "list") {
        items.set(candidate.id, mergeStudioItems(existing, candidate))
      }
    }
    Object.values(node as Record<string, unknown>).forEach(visit)
  }

  visit(payload)
  return Array.from(items.values())
}

function extractListItemsFromPayload(payload: unknown): StudioArtifactItem[] {
  const items = new Map<string, StudioArtifactItem>()

  const visit = (node: unknown) => {
    if (!Array.isArray(node)) return

    if (
      node.length >= 2 &&
      typeof node[0] === "string" &&
      typeof node[1] === "string" &&
      UUID_RE.test(node[0])
    ) {
      const id = node[0]
      const title = node[1]
      const typeId = typeof node[2] === "number" ? node[2] : undefined
      const typeLabel = typeId !== undefined ? LIST_TYPE_LABELS[typeId] ?? String(typeId) : undefined

      items.set(id, {
        id,
        title,
        meta: undefined,
        type: typeLabel
      })
      return
    }

    for (const child of node) visit(child)
  }

  visit(payload)
  return Array.from(items.values())
}

function extractPayloadsFromRawText(rawText: string, rpcId: string): unknown[] {
  const sanitized = String(rawText ?? "").replace(/^\)\]\}'\s*/, "").trim()
  const frames = parseBatchexecuteFrames(sanitized)
  if (frames.length === 0) {
    const fallback = safeJsonParse(sanitized)
    return fallback ? [fallback] : []
  }

  const payloads: unknown[] = []
  for (const frame of frames) {
    if (String(frame[1]) !== rpcId) continue
    const payloadRaw = frame[2]
    if (typeof payloadRaw === "string") {
      payloads.push(safeJsonParse(payloadRaw) ?? payloadRaw)
    } else {
      payloads.push(payloadRaw)
    }
  }
  return payloads
}

function extractStudioItemsFromRawText(
  rawText: string,
  rpcId: string,
  context: "list" | "content",
  preferredIds?: Set<string>,
  preferredTitles?: Map<string, string>
): StudioArtifactItem[] {
  const payloads = extractPayloadsFromRawText(rawText, rpcId)
  const items: StudioArtifactItem[] = []
  for (const payload of payloads) {
    items.push(...extractStudioItemsFromPayload(payload, context, preferredIds, preferredTitles))
  }
  return items
}

function extractListItemsFromRawText(rawText: string): StudioArtifactItem[] {
  const payloads = extractPayloadsFromRawText(rawText, STUDIO_LIST_RPC_ID)
  const items: StudioArtifactItem[] = []
  for (const payload of payloads) {
    items.push(...extractListItemsFromPayload(payload))
  }
  return items
}

function buildRpcOptions(
  notebookId: string,
  ctx?: Record<string, unknown>
): {
  sourcePath: string
  fSid?: string
  hl?: string
  socApp?: string
  socPlatform?: string
  socDevice?: string
  bl?: string
  at?: string
} {
  const context = ctx ?? {}
  return {
    sourcePath:
      typeof context.sourcePath === "string" ? context.sourcePath : `/notebook/${notebookId}`,
    fSid: typeof context.fSid === "string" ? context.fSid : undefined,
    hl: typeof context.hl === "string" ? context.hl : undefined,
    socApp: typeof context.socApp === "string" ? context.socApp : undefined,
    socPlatform: typeof context.socPlatform === "string" ? context.socPlatform : undefined,
    socDevice: typeof context.socDevice === "string" ? context.socDevice : undefined,
    bl: typeof context.bl === "string" ? context.bl : undefined,
    at: typeof context.at === "string" ? context.at : undefined
  }
}

async function loadStudioCache(): Promise<StudioArtifactItem[] | null> {
  if (!chrome?.storage?.local) return null
  const tokens = await tokenStorage.getTokens().catch(() => null)
  const accountKey = buildNotebookAccountKey({
    accountEmail: tokens?.accountEmail ?? undefined,
    authUser: tokens?.authUser ?? undefined
  })
  const storageKey = buildScopedStorageKey(STUDIO_CACHE_KEY_BASE, accountKey)
  return new Promise((resolve) => {
    chrome.storage.local.get([storageKey], (snapshot) => {
      const value = snapshot?.[storageKey]
      resolve(Array.isArray(value) ? (value as StudioArtifactItem[]) : null)
    })
  })
}

async function persistStudioCache(items: StudioArtifactItem[]): Promise<void> {
  if (!chrome?.storage?.local || items.length === 0) return
  const tokens = await tokenStorage.getTokens().catch(() => null)
  const accountKey = buildNotebookAccountKey({
    accountEmail: tokens?.accountEmail ?? undefined,
    authUser: tokens?.authUser ?? undefined
  })
  const storageKey = buildScopedStorageKey(STUDIO_CACHE_KEY_BASE, accountKey)
  const syncKey = buildScopedStorageKey(STUDIO_CACHE_SYNC_KEY_BASE, accountKey)
  const now = new Date().toISOString()
  const payload = items.map((item) => ({ ...item, updatedAt: item.updatedAt ?? now }))
  chrome.storage.local.set(
    {
      [storageKey]: payload,
      [syncKey]: now
    },
    () => {
      void chrome.runtime.lastError
    }
  )
}

function persistStudioItemsById(items: StudioArtifactItem[], rpcId: string): void {
  if (!chrome?.storage?.local || items.length === 0) return
  const patch: Record<string, unknown> = {}
  const capturedAt = Date.now()
  for (const item of items) {
    patch[`${STUDIO_ITEM_KEY_BASE}_${item.id}`] = { rpcId, item, capturedAt }
  }
  chrome.storage.local.set(patch, () => {
    void chrome.runtime.lastError
  })
}

function persistRawRpc(rpcId: string, rawText: string): void {
  if (!chrome?.storage?.local) return
  const capped =
    rawText.length > RAW_RPC_MAX_CHARS ? rawText.slice(0, RAW_RPC_MAX_CHARS) : rawText
  const key = `${STUDIO_RAW_KEY_BASE}_${rpcId}`
  chrome.storage.local.set(
    {
      [key]: {
        capturedAt: new Date().toISOString(),
        payload: capped
      }
    },
    () => {
      void chrome.runtime.lastError
    }
  )
}

function mergeStudioItemLists(lists: StudioArtifactItem[][]): StudioArtifactItem[] {
  const merged = new Map<string, StudioArtifactItem>()
  for (const list of lists) {
    for (const item of list) {
      const existing = merged.get(item.id)
      merged.set(item.id, existing ? mergeStudioItems(existing, item) : item)
    }
  }
  return Array.from(merged.values())
}

function normalizeTitleKey(title?: string): string {
  return (title ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function scoreItemContent(item: StudioArtifactItem): number {
  let score = 0
  if (item.content && String(item.content).trim().length > 0) score += 2
  if (item.url && String(item.url).trim().length > 0) score += 1
  return score
}

function attachContentByTitle(
  listItems: StudioArtifactItem[],
  contentItems: StudioArtifactItem[]
): StudioArtifactItem[] {
  const contentByKey = new Map<string, StudioArtifactItem>()
  for (const item of contentItems) {
    const key = normalizeTitleKey(item.title)
    if (!key) continue
    const prev = contentByKey.get(key)
    if (!prev || scoreItemContent(item) > scoreItemContent(prev)) {
      contentByKey.set(key, item)
    }
  }

  return listItems.map((li) => {
    if ((li.content && String(li.content).trim().length > 0) || li.url) return li
    const key = normalizeTitleKey(li.title)
    const ci = key ? contentByKey.get(key) : undefined
    if (!ci) return li
    return mergeStudioItems({ ...li, id: li.id }, { ...ci, id: li.id })
  })
}

function hasSignal(item: StudioArtifactItem): boolean {
  if (!item) return false
  if (typeof item.title === "string" && item.title.trim().length > 0) return true
  if (typeof item.content === "string" && item.content.trim().length > 0) return true
  if (typeof item.url === "string" && item.url.trim().length > 0) return true
  if (typeof item.type === "string" && item.type.trim().length > 0) return true
  if (typeof item.meta === "string" && item.meta.trim().length > 0) return true
  if (typeof item.sourceCount === "number" && item.sourceCount > 0) return true
  return false
}

function filterBySignal(items: StudioArtifactItem[], ids?: string[]): StudioArtifactItem[] {
  const requestedIds = new Set((ids ?? []).filter(Boolean))
  const filtered = items.filter((it) => {
    if (requestedIds.size > 0 && it?.id && requestedIds.has(it.id)) return true
    return hasSignal(it)
  })
  const finalItems = filtered.length > 0 ? filtered : items
  console.log("[studioArtifacts] filtered", filtered.length, "final", finalItems.length)
  return finalItems
}

function resolveNotebookId(
  notebookId: string | undefined,
  rpcContext?: Record<string, unknown>
): string | undefined {
  if (typeof notebookId === "string" && notebookId.trim().length > 0) {
    return notebookId
  }
  const sourcePath = typeof rpcContext?.sourcePath === "string" ? rpcContext.sourcePath : ""
  const match = sourcePath.match(UUID_RE)
  return match ? match[0] : undefined
}

export async function fetchStudioArtifactsByIds(
  ids: string[],
  notebookId?: string,
  options?: { forceRefresh?: boolean; rpcContext?: Record<string, unknown> }
): Promise<StudioArtifactItem[]> {
  if (!ids || ids.length === 0) {
    return []
  }
  const resolvedNotebookId = resolveNotebookId(notebookId, options?.rpcContext)
  if (!resolvedNotebookId) {
    console.warn("[studioArtifacts] missing notebookId", {
      notebookId,
      sourcePath:
        typeof options?.rpcContext?.sourcePath === "string" ? options?.rpcContext?.sourcePath : undefined
    })
    return []
  }

  const idSet = new Set(ids.filter((id) => typeof id === "string" && id.trim().length > 0))
  const preferredIds = idSet.size > 0 ? new Set(idSet) : undefined
  const forceRefresh = Boolean(options?.forceRefresh)

  if (!forceRefresh) {
    const cached = await loadStudioCache()
    if (cached && cached.length > 0) {
      const cachedFiltered = idSet.size > 0 ? cached.filter((item) => idSet.has(item.id)) : cached
      if (idSet.size === 0 || cachedFiltered.length >= idSet.size) {
        console.log("[studioArtifacts] using cache", cachedFiltered.length)
        return cachedFiltered
      }
      console.log(
        "[studioArtifacts] cache incomplete, refetching",
        cachedFiltered.length,
        idSet.size
      )
    }
  }

  const rpc = new GoogleRPC()
  const rpcOptions = buildRpcOptions(resolvedNotebookId, options?.rpcContext)

  const requests = [
    {
      rpcId: STUDIO_LIST_RPC_ID,
      payload: buildListPayload(resolvedNotebookId),
      context: "list" as const
    },
    {
      rpcId: STUDIO_CONTENT_RPC_ID,
      payload: buildContentPayload(resolvedNotebookId),
      context: "content" as const
    },
    {
      rpcId: STUDIO_LIST_RPC_ID,
      payload: buildAltContentPayload(resolvedNotebookId),
      context: "content" as const
    }
  ]

  const responses = await Promise.allSettled(
    requests.map((req) => rpc.execute(req.rpcId, req.payload, rpcOptions))
  )

  let listItems: StudioArtifactItem[] = []
  let contentItems: StudioArtifactItem[] = []
  let preferredTitles: Map<string, string> | undefined

  for (const [index, result] of responses.entries()) {
    const req = requests[index]
    if (result.status !== "fulfilled") {
      console.warn("[MindDock][BG] Studio RPC failed:", req.rpcId, result.reason)
      continue
    }
    const response = result.value
    const rawText = response.sanitizedText ?? response.rawText ?? ""
    if (rawText) {
      persistRawRpc(req.rpcId, rawText)
    }
    let items: StudioArtifactItem[] = []
    if (req.context === "list") {
      items = extractStudioItemsFromRawText(rawText, STUDIO_LIST_RPC_ID, "list", preferredIds)
      if (items.length > 0) {
        listItems = listItems.concat(items)
        preferredTitles = new Map(listItems.map((item) => [item.id, item.title]))
      }
    } else {
      const titlesMap = preferredTitles ?? new Map(listItems.map((item) => [item.id, item.title]))
      items = extractStudioItemsFromRawText(rawText, req.rpcId, "content", preferredIds, titlesMap)
      if (items.length > 0) {
        contentItems = contentItems.concat(items)
      }
    }
    const artifacts = items
    console.log("[studioArtifacts] count", artifacts.length)
    console.log(
      "[studioArtifacts] sampleWithContent",
      artifacts.find(
        (artifact) => typeof artifact.content === "string" && artifact.content.trim().length > 0
      )
    )
    console.log("[studioArtifacts] sampleAny", artifacts[0])

    if (items.length > 0) {
      persistStudioItemsById(items, req.rpcId)
    }
  }

  const contentById = new Map(contentItems.map((item) => [item.id, item]))
  const listIds = new Set(listItems.map((item) => item.id))

  const stitchedItems = listItems.map((item) => {
    const content = contentById.get(item.id)
    if (!content) return item
    return { ...content, ...item, title: item.title }
  })

  const contentOnly = contentItems.filter((item) => !listIds.has(item.id))
  const mergedItems = [...stitchedItems, ...contentOnly]
  console.log(
    "[studioArtifacts] list",
    listItems.length,
    "content",
    contentItems.length,
    "merged",
    mergedItems.length
  )
  const filteredItems = filterBySignal(mergedItems, ids)
  console.log(
    "[studioArtifacts] contentCount",
    filteredItems.filter((item) => typeof item.content === "string" && item.content.trim().length > 0).length,
    "total",
    filteredItems.length
  )
  const finalItems = filteredItems
  const contentCount = finalItems.filter(
    (item) => typeof item.content === "string" && item.content.trim().length > 0
  ).length
  const urlCount = finalItems.filter((item) => typeof item.url === "string" && item.url.trim().length > 0).length
  console.warn("[BG_LOG][studio-final]", {
    total: finalItems.length,
    contentCount,
    urlCount,
    sample: finalItems.slice(0, 3).map((item) => ({
      id: item.id,
      title: item.title,
      hasContent: Boolean(typeof item.content === "string" && item.content.trim().length > 0),
      hasUrl: Boolean(typeof item.url === "string" && item.url.trim().length > 0),
      type: item.type
    }))
  })
  if (filteredItems.length > 0) {
    await persistStudioCache(filteredItems)
  }

  if (idSet.size === 0) return finalItems
  return finalItems.filter((item) => idSet.has(item.id))
}
