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

// Mapeamento unificado baseado nos typeCodes reais do RPC do NotebookLM
// Fonte: análise do gArtLc/cFji9 — typeCodes 3,5,7,8 são sempre visuais
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

// typeCodes do payload de conteúdo (cFji9/gArtLc) — esses têm prioridade absoluta
const CONTENT_TYPE_LABELS: Record<number, string> = {
  1: "Audio Overview",
  2: "Blog Post",
  3: "Video Overview",
  4: "Quiz",
  5: "Mind Map",
  7: "Infographic",
  8: "Slides",
  9: "Blog Post"
}

// typeCodes que SEMPRE indicam visual — inquebrável
const VISUAL_TYPE_CODES = new Set([1, 3, 5, 6, 7, 8, 10, 12, 14])

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

const LIST_TITLE_NOISE_RE =
  /informational article|answer key|glossary|you are a highly capable|com base nas interacoes|based on interactions|escreva|write|use this guide|responda/i

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

function scoreListTitleCandidate(title: string, typeId?: number): number {
  const raw = normalizeString(title)
  if (!raw) return Number.NEGATIVE_INFINITY

  const normalized = normalizeToken(raw)
  const wordCount = raw.split(/\s+/u).filter(Boolean).length
  let score = 0

  if (raw.length >= 6 && raw.length <= 90) score += 24
  else if (raw.length > 120 || raw.length < 4) score -= 40

  if (wordCount >= 2 && wordCount <= 12) score += 16
  else if (wordCount > 15) score -= 28

  if (/\p{L}/u.test(raw)) score += 10
  if (/^[a-z]{2}[_-][a-z]{2}$/i.test(raw)) score -= 70
  if (/[.!?]\s/u.test(raw)) score -= 22
  if (/[#*_`]/u.test(raw)) score -= 24
  if (looksLikeUrl(raw)) score -= 80
  if (/^[\d\s).:;,-]+$/u.test(raw)) score -= 35
  if (LIST_TITLE_NOISE_RE.test(normalized)) score -= 55
  if (/quiz|flashcard|data table|tabela de dados/i.test(normalized)) score -= 10

  if (typeof typeId === "number") {
    if (typeId >= 1 && typeId <= 14) score += 6
    if (VISUAL_TYPE_CODES.has(typeId)) score += 4
  }

  return score
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

function collectNumbersOwned(
  node: unknown,
  ownerId: string,
  out: number[],
  ownerCtx: string | null = null,
  depth = 0
): void {
  if (depth > 6 || node == null) return

  if (Array.isArray(node)) {
    let ctx = ownerCtx
    if (typeof node[0] === "string" && UUID_RE.test(node[0])) {
      ctx = node[0]
    }
    if (ctx !== null && ctx !== ownerId) return
    node.forEach((child) => collectNumbersOwned(child, ownerId, out, ctx, depth + 1))
    return
  }

  if (typeof node === "number" && Number.isFinite(node)) {
    out.push(node)
    return
  }

  if (typeof node === "object") {
    Object.values(node as Record<string, unknown>).forEach((child) =>
      collectNumbersOwned(child, ownerId, out, ownerCtx, depth + 1)
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
  if (!/\p{L}/u.test(normalized)) return false
  if (/\n/.test(normalized) && normalized.length > 120) return false
  return true
}

function looksLikeContent(value: string): boolean {
  const normalized = normalizeString(value)
  if (normalized.length < 40) return false
  if (looksLikeUrl(normalized)) return false
  if (looksLikeMimeType(normalized)) return false
  if (looksLikeMeta(normalized)) return false
  if (!/\p{L}/u.test(normalized)) return false
  if (UUID_RE.test(normalized.trim())) return false
  return true
}

function isContentish(value: string, titleNorm: string): boolean {
  const v = normalizeString(value)
  if (v.length < 12) return false
  if (looksLikeUrl(v)) return false
  if (looksLikeMimeType(v)) return false
  if (looksLikeMeta(v)) return false
  if (!/\p{L}/u.test(v)) return false
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
  const lower = normalized.toLowerCase()

  return (
    ASSET_EXT_RE.test(lower) ||
    lower.includes("googleusercontent") ||
    lower.includes("googlevideo.com") ||
    lower.includes("videoplayback") ||
    lower.includes("alt=media") ||
    lower.includes("=m22") ||
    lower.includes("=m140") ||
    /\/(video|audio|image)\//i.test(lower) ||
    /(?:^|[?&])mime=(video|audio|image)\//i.test(lower)
  )
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

function extractOwnedMedia(
  node: unknown,
  ownerId: string,
  mimePrefix: string,
  ownerCtx: string | null = null
): Array<{ url: string; mime: string }> {
  if (!Array.isArray(node)) return []
  let ctx = ownerCtx
  if (typeof node[0] === "string" && UUID_RE.test(node[0])) {
    ctx = node[0]
  }
  if (ctx && ctx !== ownerId) return []
  const results: Array<{ url: string; mime: string }> = []
  const url =
    node.find((value) => typeof value === "string" && looksLikeUrl(value)) as string | undefined
  const mime =
    node.find((value) => typeof value === "string" && looksLikeMimeType(value)) as string | undefined
  if (ctx === ownerId && url && mime && mime.toLowerCase().startsWith(mimePrefix)) {
    results.push({ url: url.startsWith("//") ? `https:${url}` : url, mime })
  }
  for (const child of node) {
    results.push(...extractOwnedMedia(child, ownerId, mimePrefix, ctx))
  }
  return results
}

function isSlidesType(type?: string): boolean {
  const token = normalizeToken(type ?? "")
  return token === "slides" || token === "8" || token === "12" || token === "tablet"
}

function isPdfUrl(value?: string | null): boolean {
  const url = normalizeUrl(value)
  if (!url) return false
  return /\.pdf(?:[?#]|$)/i.test(url) || /(?:^|[?&])mime=application\/pdf/i.test(url)
}

function chooseOwnedMediaForType(
  type: string | undefined,
  mediaGroups: {
    pdf: Array<{ url: string; mime: string }>
    video: Array<{ url: string; mime: string }>
    audio: Array<{ url: string; mime: string }>
    image: Array<{ url: string; mime: string }>
  }
): { url: string; mime: string } | null {
  const token = normalizeToken(type ?? "")
  const slidesLike = token === "slides" || token === "8" || token === "12" || token === "tablet"
  const videoLike =
    token === "video overview" || token === "3" || token.includes("video") || token === "briefing"
  const audioLike = token === "audio overview" || token === "1" || token.includes("audio")
  const imageLike =
    token === "infographic" ||
    token === "mind map" ||
    token === "5" ||
    token === "6" ||
    token === "7" ||
    token === "10"

  const ordered =
    slidesLike
      ? [...mediaGroups.pdf, ...mediaGroups.image, ...mediaGroups.video, ...mediaGroups.audio]
      : videoLike
        ? [...mediaGroups.video, ...mediaGroups.audio, ...mediaGroups.image, ...mediaGroups.pdf]
        : audioLike
          ? [...mediaGroups.audio, ...mediaGroups.video, ...mediaGroups.image, ...mediaGroups.pdf]
          : imageLike
            ? [...mediaGroups.image, ...mediaGroups.pdf, ...mediaGroups.video, ...mediaGroups.audio]
            : [...mediaGroups.video, ...mediaGroups.audio, ...mediaGroups.image, ...mediaGroups.pdf]

  if (ordered.length === 0) return null
  if (isSlidesType(type)) {
    const pdfFirst = ordered.find((media) => media.mime.toLowerCase() === "application/pdf" || isPdfUrl(media.url))
    if (pdfFirst) return pdfFirst
  }
  return ordered[0]
}

function isVisualTypeCode(numericCandidates: number[]): boolean {
  return numericCandidates.some((v) => VISUAL_TYPE_CODES.has(Math.round(v)))
}

function isVisualTypeToken(value?: string): boolean {
  const raw = normalizeString(value)
  if (!raw) return false
  if (/^\d+$/u.test(raw)) return VISUAL_TYPE_CODES.has(Number(raw))

  const token = normalizeToken(raw)
  return (
    token === "video overview" ||
    token === "audio overview" ||
    token === "slides" ||
    token === "infographic" ||
    token === "mind map"
  )
}

function isMediaUrl(value?: string | null): boolean {
  const normalized = normalizeUrl(value)
  if (!normalized) return false
  if (!looksLikeUrl(normalized)) return false
  return looksLikeAssetUrl(normalized)
}

const URL_TEXT_RE = /^(https?:)?\/\//i
const MIME_PREFIX_RE = /^(video|audio|image)\//i

function scoreOwnedText(value: string): number {
  let points = 0
  if (value.length > 80) points += 3
  if (value.length > 200) points += 3
  if (/[#*_\-|]/u.test(value)) points += 1
  if (/[.!?]/u.test(value)) points += 1
  return points
}

function extractOwnedText(node: unknown, ownerId: string): string {
  const blocks: string[] = []
  const seen = new Set<string>()

  const visit = (current: unknown, ownerCtx: string | null = null) => {
    if (!Array.isArray(current)) return
    let ctx = ownerCtx
    if (typeof current[0] === "string" && UUID_RE.test(current[0])) {
      ctx = current[0]
    }
    if (ctx && ctx !== ownerId) return

    for (const value of current) {
      if (typeof value === "string") {
        const text = normalizeString(value)
        if (!text) continue
        if (UUID_RE.test(text)) continue
        if (URL_TEXT_RE.test(text)) continue
        if (MIME_PREFIX_RE.test(text)) continue
        if (looksLikeMimeType(text)) continue
        if (looksLikeMeta(text)) continue
        if (text.length < 30) continue
        if (seen.has(text)) continue
        seen.add(text)
        blocks.push(text)
        continue
      }
      if (Array.isArray(value)) {
        visit(value, ctx)
      }
    }
  }

  visit(node)
  if (!blocks.length) return ""
  blocks.sort((a, b) => scoreOwnedText(b) - scoreOwnedText(a) || b.length - a.length)
  return blocks[0]
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
    if (context === "content" && VISUAL_TYPE_CODES.has(asInt) && CONTENT_TYPE_LABELS[asInt]) {
      return CONTENT_TYPE_LABELS[asInt]
    }
    if (lookup[asInt]) return lookup[asInt]
  }
  const haystack = `${title} ${content}`.toLowerCase()
  if (/blog\s*post|postagem no blog|informational article/i.test(haystack)) return "Blog Post"
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

function looksLikeDataTableContent(value?: string): boolean {
  const text = normalizeString(value)
  if (!text || text.length < 220) return false

  if (/<table[\s>][\s\S]*<\/table>/iu.test(text)) {
    return true
  }

  const markdownTableHeader =
    /\n\|\s*[^|\n]+(\|\s*[^|\n]+){2,}\s*\|\n\|\s*:?-{3,}:?(\s*\|\s*:?-{3,}:?){2,}\s*\|/u
  if (markdownTableHeader.test(`\n${text}`)) {
    return true
  }

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 120)
  if (lines.length < 6) return false

  let structuredLines = 0
  let pipeStructuredLines = 0
  for (const line of lines) {
    const pipeCells = line.split("|").map((part) => part.trim()).filter(Boolean).length
    if (pipeCells >= 4) {
      structuredLines += 1
      pipeStructuredLines += 1
      continue
    }
    const tabCells = line.split("\t").map((part) => part.trim()).filter(Boolean).length
    if (tabCells >= 4) {
      structuredLines += 1
      continue
    }
  }

  if (structuredLines < 4) return false
  if (pipeStructuredLines >= 3) return true

  const normalized = normalizeToken(text)
  const tableKeywords = [
    "pilar",
    "etapa",
    "descricao",
    "ferramentas",
    "visualizacao",
    "fonte",
    "categoria",
    "indicador",
    "metrica",
    "coluna",
    "linha",
    "recomendadas",
    "criterio"
  ]
  const keywordHits = tableKeywords.reduce(
    (count, keyword) => count + (normalized.includes(keyword) ? 1 : 0),
    0
  )
  return keywordHits >= 3
}

function reclassifyDataTableItem(item: StudioArtifactItem): StudioArtifactItem {
  const typeToken = normalizeToken(item.type ?? "")
  if (typeToken && typeToken !== "blog post") {
    return item
  }

  const content = typeof item.content === "string" ? item.content : ""
  if (!looksLikeDataTableContent(content)) {
    return item
  }

  return {
    ...item,
    type: "Data Table"
  }
}

function deriveKind(item: StudioArtifactItem): "text" | "asset" {
  if (!isVisualTypeToken(item.type)) return "text"
  const url = normalizeUrl(item.url)
  const contentUrl = typeof item.content === "string" ? normalizeUrl(item.content) : ""
  const hasMediaUrl = (url && isMediaUrl(url)) || (contentUrl && isMediaUrl(contentUrl))
  if (hasMediaUrl) return "asset"

  const mime = normalizeString(item.mimeType).toLowerCase()
  if (mime === "application/pdf" || /^(video|audio|image)\//i.test(mime)) return "asset"

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
  if (strings.length === 0) return null
  if (context === "list") {
    const listHit = findListIdTitle(node)
    if (listHit) {
      const typeCandidate =
        typeof listHit.type === "number" ? LIST_TYPE_LABELS[listHit.type] ?? String(listHit.type) : undefined
      const item: StudioArtifactItem = {
        id: listHit.id,
        title: listHit.title,
        type: typeCandidate || undefined,
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
    if (preferredHits.length === 0) {
      const hasAssetUrl = strings.some((value) => looksLikeAssetUrl(value))
      const hasLongContent = strings.some(
        (value) => value.length > 200 && !looksLikeUrl(value) && !looksLikeMimeType(value)
      )
      if (!hasAssetUrl && !hasLongContent) return null
    }
  }

  // Prioridade 1: UUID em node[0] — é sempre o dono direto do nó
  const nodeOwnerUuid =
    Array.isArray(node) && typeof node[0] === "string" && UUID_RE.test(node[0])
      ? node[0]
      : null

  // Prioridade 2: preferredHits — mas só se bate com o dono do nó
  const idCandidate =
    nodeOwnerUuid && (!preferredIds || preferredIds.has(nodeOwnerUuid))
      ? nodeOwnerUuid
      : hasPreferred
        ? preferredHits[0]
        : pickBestId(strings, preferredIds)
  if (!UUID_RE.test(String(idCandidate))) {
    return null
  }
  const titleCandidate =
    (preferredTitles && preferredTitles.get(idCandidate)) || pickBestTitle(strings)
  let contentCandidate = pickBestContent(strings, titleCandidate)
  if (!contentCandidate || contentCandidate.trim().length === 0) {
    contentCandidate = extractOwnedText(node, idCandidate)
  }
  const metaCandidate = strings.find((value) => looksLikeMeta(value)) ?? ""
  const sourceCount = pickSourceCount(strings)

  const numericCandidates: number[] = []
  if (UUID_RE.test(String(idCandidate))) {
    collectNumbersOwned(node, String(idCandidate), numericCandidates)
  } else {
    collectNumbers(node, numericCandidates)
  }
  let typeCandidate: string | undefined
  typeCandidate = inferTypeLabel(titleCandidate ?? "", "", numericCandidates, context)

  // só buscar url/mime se o typeCode indica visual — evita contaminação de vizinhos
  const nodeIsVisual = isVisualTypeCode(numericCandidates)
  let urlCandidate: string | null = null
  let mimeCandidate = ""
  if (nodeIsVisual) {
    const ownedVideo = extractOwnedMedia(node, idCandidate, "video/")
    const ownedAudio = extractOwnedMedia(node, idCandidate, "audio/")
    const ownedImage = extractOwnedMedia(node, idCandidate, "image/")
    const ownedPdf = extractOwnedMedia(node, idCandidate, "application/pdf")
    const selectedOwned = chooseOwnedMediaForType(typeCandidate, {
      video: ownedVideo,
      audio: ownedAudio,
      image: ownedImage,
      pdf: ownedPdf
    })
    if (selectedOwned) {
      urlCandidate = selectedOwned.url
      mimeCandidate = selectedOwned.mime
    }
  } else {
    urlCandidate = null
    mimeCandidate = ""
  }

  if (!urlCandidate) {
    const fallbackUrl = isSlidesType(typeCandidate)
      ? strings.map(normalizeUrl).find((value) => isPdfUrl(value)) ?? pickBestUrl(strings)
      : pickBestUrl(strings)
    if (fallbackUrl && looksLikeAssetUrl(fallbackUrl)) {
      urlCandidate = fallbackUrl
      const fallbackMime = strings
        .map((value) => normalizeString(value).toLowerCase())
        .find((value) =>
          isSlidesType(typeCandidate)
            ? value === "application/pdf"
            : looksLikeMimeType(value) && !value.startsWith("text/")
        )
      if (fallbackMime) mimeCandidate = fallbackMime
      if (!mimeCandidate && isSlidesType(typeCandidate) && isPdfUrl(fallbackUrl)) {
        mimeCandidate = "application/pdf"
      }
    }
  }

  const hasLongTextContent = typeof contentCandidate === "string" && contentCandidate.length > 100
  if (!typeCandidate && urlCandidate && !hasLongTextContent) {
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
  const isConfirmedVisual = typeCandidate ? VISUAL_TYPES.has(typeCandidate) : false
  let content =
    contentCandidate && urlCandidate && contentCandidate === urlCandidate ? undefined : contentCandidate ?? undefined
  if (!content && textFallback) {
    content = textFallback
  }
  const hasContent = typeof content === "string" && content.trim().length > 0
  if (!hasContent && urlCandidate && isAsset && isConfirmedVisual) {
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
  if (item.kind === "asset" && isConfirmedVisual) {
    item.content = item.url ?? item.content
  }
  if (item.url && isMediaUrl(item.url) && isConfirmedVisual) {
    item.kind = "asset"
    item.content = item.url
  }
  const visualSignal = isVisualTypeToken(item.type)

  if (item.kind === "text") {
    if (visualSignal && (item.url || item.mimeType)) {
      item.kind = "asset"
      item.content = item.url ?? item.content
    } else {
      const ownedText = extractOwnedText(node, id)
      const fallbackText =
        typeof item.content === "string" && !URL_TEXT_RE.test(item.content.trim())
          ? item.content.trim()
          : ""
      item.content = ownedText || fallbackText || undefined
      item.url = undefined
      item.mimeType = undefined
    }
  }
  return reclassifyDataTableItem(item)
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
  const items = new Map<string, { item: StudioArtifactItem; score: number }>()

  const visit = (node: unknown) => {
    if (!Array.isArray(node)) return

    if (
      node.length >= 2 &&
      typeof node[0] === "string" &&
      typeof node[1] === "string" &&
      UUID_RE.test(node[0])
    ) {
      const id = node[0]
      const title = normalizeString(node[1])
      const typeId = typeof node[2] === "number" ? node[2] : undefined
      const typeLabel = typeId !== undefined ? LIST_TYPE_LABELS[typeId] ?? String(typeId) : undefined
      const score = scoreListTitleCandidate(title, typeId)
      if (score <= -40) {
        for (const child of node) visit(child)
        return
      }

      const prev = items.get(id)
      if (!prev || score > prev.score || (score === prev.score && title.length > prev.item.title.length)) {
        const nextItem: StudioArtifactItem = {
          id,
          title,
          meta: prev?.item.meta,
          type: typeLabel ?? prev?.item.type
        }
        items.set(id, { item: nextItem, score })
      } else if (prev && !prev.item.type && typeLabel) {
        prev.item.type = typeLabel
      }
    }

    for (const child of node) visit(child)
  }

  visit(payload)
  return Array.from(items.values())
    .map((entry) => entry.item)
    .filter((item) => normalizeString(item.title).length >= 3)
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
    if (context === "list") {
      items.push(...extractListItemsFromPayload(payload))
      continue
    }
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

function isSafeOverflowBlogPost(item: StudioArtifactItem): boolean {
  if (normalizeToken(item.type ?? "") !== "blog post") return false

  const title = normalizeString(item.title)
  if (title.length < 4 || title.length > 120) return false
  if (/^[a-z]{2}[_-][a-z]{2}$/i.test(title)) return false
  if (!/\p{L}/u.test(title)) return false

  const words = title.split(/\s+/u).filter(Boolean).length
  if (words > 14) return false
  if (/[.!?]\s/u.test(title)) return false
  if (looksLikeUrl(title)) return false
  if (isAssetLike(item.type, item.mimeType, item.url)) return false

  const signals = normalizeToken(`${title} ${item.meta ?? ""} ${item.content ?? ""}`)
  if (/quiz|answer key|glossary|flashcard|cartao|data table|tabela de dados/i.test(signals)) return false
  if (LIST_TITLE_NOISE_RE.test(signals)) return false

  return true
}

function scoreDedupCandidate(item: StudioArtifactItem): number {
  const contentScore = item.content ? Math.min(String(item.content).length, 500) : 0
  const textBias = item.kind === "text" ? 40 : 0
  const visual = VISUAL_TYPES.has(item.type ?? "")
  const consistentKind =
    (visual && item.kind === "asset") || (!visual && item.kind === "text")
  const consistencyScore = consistentKind ? 80 : 0
  return contentScore + textBias + consistencyScore
}

function dedupeByNormalizedTitle(items: StudioArtifactItem[]): StudioArtifactItem[] {
  const byTitle = new Map<string, StudioArtifactItem>()
  for (const item of items) {
    const titleKey = normalizeTitleKey(item.title)
    const key = titleKey || item.id
    const prev = byTitle.get(key)
    if (!prev) {
      byTitle.set(key, item)
      continue
    }
    byTitle.set(key, scoreDedupCandidate(item) >= scoreDedupCandidate(prev) ? item : prev)
  }
  return Array.from(byTitle.values())
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
  const VISUAL_MIME_RE = /^(video|audio|image)\//i
  const MEDIA_EXT_RE = /\.(mp4|m4a|mp3|wav|ogg|pdf|png|jpe?g|webp)(?:[?#]|$)/i
  const MEDIA_HINT_RE = /googleusercontent\.com|=m22\b|\/video\/|\/audio\/|\/image\//i

  const normalizeMediaUrl = (v: unknown): string | undefined => {
    if (typeof v !== "string") return undefined
    const s = v.trim()
    if (!s) return undefined
    const u = s.startsWith("//") ? `https:${s}` : s
    if (!/^https?:\/\//i.test(u)) return undefined
    if (MEDIA_EXT_RE.test(u) || MEDIA_HINT_RE.test(u)) return u
    return undefined
  }

  const isVisualMime = (mime?: string) =>
    !!mime && (VISUAL_MIME_RE.test(mime) || mime === "application/pdf")

  const stitchedItems = listItems.map((item) => {
    const ci = contentById.get(item.id)
    if (!ci) return item

    const mimeType = ci.mimeType ?? item.mimeType
    const url =
      normalizeMediaUrl(ci.url) ??
      normalizeMediaUrl(item.url) ??
      normalizeMediaUrl(ci.content) ??
      normalizeMediaUrl(item.content)

    const kind =
      ci.kind ??
      item.kind ??
      (url || isVisualMime(mimeType) ? "asset" : "text")

    const content =
      ci.content ??
      item.content ??
      (kind === "asset" ? url : undefined)

    return {
      ...item,
      ...ci,
      title: item.title || ci.title,
      type: ci.type ?? item.type,
      content,
      url,
      mimeType,
      kind
    }
  })

  const contentOnly = contentItems.filter((item) => !listIds.has(item.id))
  const mergedItems = [...stitchedItems, ...contentOnly].map(reclassifyDataTableItem)
  console.log(
    "[studioArtifacts] list",
    listItems.length,
    "content",
    contentItems.length,
    "merged",
    mergedItems.length
  )
  const filteredItems = filterBySignal(mergedItems, ids)
  const dedupedByTitle = dedupeByNormalizedTitle(filteredItems)
  console.log(
    "[studioArtifacts] contentCount",
    dedupedByTitle.filter((item) => typeof item.content === "string" && item.content.trim().length > 0).length,
    "total",
    dedupedByTitle.length
  )
  const finalItems = dedupedByTitle.map(reclassifyDataTableItem)
  const contentCount = finalItems.filter(
    (item) => typeof item.content === "string" && item.content.trim().length > 0
  ).length
  const urlCount = finalItems.filter((item) => typeof item.url === "string" && item.url.trim().length > 0).length
  void contentCount
  void urlCount
  if (finalItems.length > 0) {
    await persistStudioCache(finalItems)
  }

  if (idSet.size === 0) return finalItems
  const finalById = new Map(finalItems.map((item) => [item.id, item] as const))
  const listById = new Map(listItems.map((item) => [item.id, item] as const))
  const requestedItems: StudioArtifactItem[] = []

  for (const id of idSet) {
    const fromFinal = finalById.get(id)
    const fromList = listById.get(id)
    const base = fromFinal ?? fromList
    if (!base) continue

    const canonicalTitle = normalizeString(fromList?.title ?? "") || normalizeString(base.title) || "Studio"
    const canonicalType = fromFinal?.type ?? fromList?.type ?? base.type

    const canonical: StudioArtifactItem = {
      ...base,
      id,
      title: canonicalTitle,
      type: canonicalType
    }
    canonical.kind = deriveKind(canonical)
    requestedItems.push(canonical)
  }

  const droppedByRequestedIds = finalItems.filter((item) => !idSet.has(item.id))
  if (droppedByRequestedIds.length > 0) {
    console.log(
      "[studioArtifacts] droppedByRequestedIds",
      droppedByRequestedIds.length,
      droppedByRequestedIds.map((item) => ({ id: item.id, title: item.title, type: item.type }))
    )
  }
  const overflowBlogPosts = droppedByRequestedIds.filter(isSafeOverflowBlogPost)
  return [...requestedItems, ...overflowBlogPosts]
}
