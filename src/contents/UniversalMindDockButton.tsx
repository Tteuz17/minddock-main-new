import type { PlasmoCSConfig } from "plasmo"
import shadowCssText from "data-text:~/styles/globals.css"
import clsx from "clsx"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowLeft, Book, BookOpen, Check, FolderOpen, Loader2, Plus, RefreshCw, Search } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { createRoot, type Root } from "react-dom/client"

import { SniperUI } from "~/features/youtube-sniper/components/SniperUI"
import type { AIChatMessage, AIChatPlatform, ChromeMessageResponse } from "~/lib/types"
import { useNotebookList } from "~/hooks/useNotebookList"
import { InjectionManager } from "~/content-strategies/InjectionManager"
import { resolveContentStrategy, type ContentStrategy } from "~/content-strategies"
import { initLinkedInInlineTriggers } from "~/contents/platforms/linkedin-inline-trigger"
import { initRedditInlineTriggers } from "~/contents/platforms/reddit-inline-trigger"
import { canonicalizeConversationTurns } from "~/contents/platforms/conversation-canonicalizer"
import { captureRedditPostOrThread } from "~/contents/platforms/reddit-capture"
import {
  buildNotebookAccountKey,
  buildScopedStorageKey,
  isConfirmedNotebookAccountKey,
  normalizeAccountEmail,
  normalizeAuthUser
} from "~/lib/notebook-account-scope"
import {
  buildConversationResyncIdentity,
  resolveConversationAliasKeys,
  resolveConversationPrimaryKey
} from "~/lib/conversation-resync-identity"
import { buildDomChatCaptureInputAsync } from "../../contents/common/chat-capture"
import { showMindDockToast } from "../../contents/common/minddock-ui"

export const config: PlasmoCSConfig = {
  matches: [
    "https://youtube.com/*",
    "https://*.youtube.com/*",
    "https://chat.openai.com/*",
    "https://chatgpt.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*",
    "https://perplexity.ai/*",
    "https://www.perplexity.ai/*",
    "https://docs.google.com/document/d/*",
    "https://linkedin.com/*",
    "https://www.linkedin.com/*",
    "https://reddit.com/*",
    "https://www.reddit.com/*",
    "https://x.com/*",
    "https://www.x.com/*",
    "https://twitter.com/*",
    "https://www.twitter.com/*",
    "https://grok.com/*",
    "https://www.grok.com/*",
    "https://genspark.ai/*",
    "https://www.genspark.ai/*",
    "https://genspark.im/*",
    "https://www.genspark.im/*",
    "https://kimi.moonshot.cn/*",
    "https://www.kimi.moonshot.cn/*",
    "https://kimi.com/*",
    "https://www.kimi.com/*",
    "https://*.kimi.com/*",
    "https://openevidence.com/*",
    "https://www.openevidence.com/*",
    "https://*.openevidence.com/*"
  ],
  run_at: "document_idle"
}

type StorageSnapshot = Record<string, unknown>
type CaptureState = "idle" | "checking" | "capturing" | "success" | "error"
type CaptureSourceKind = "chat" | "doc"
type CaptureConversationRole = "assistant" | "user" | "document"

interface NotebookOption {
  id: string
  title: string
}

interface ChatResyncBinding {
  notebookId: string
  notebookTitle: string
  sourceId?: string
  lastHash?: string
  updatedAt: string
}

interface ChatSourceBindingStorageRecord {
  sourceId: string
  lastSyncHash?: string
  updatedAt: string
}

interface CaptureConfig {
  containerSelectors: string[]
  messageSelectors: string[]
  platform: AIChatPlatform
  platformLabel: string
  resolveRole: (element: Element) => "assistant" | "user"
}

interface DomCaptureProfile extends CaptureConfig {
  matchesHost: (host: string) => boolean
}

type FloatingButtonPlacement = {
  style: CSSProperties
  menuAlign: "left" | "right"
  menuVertical?: "above" | "below"
}

interface UseNotebookRepositoryResult {
  notebooks: NotebookOption[]
  activeNotebookId: string
  syncedAt: string
  isLoading: boolean
  refresh: () => Promise<void>
}

interface UseSmartCaptureResult {
  linkedNotebookId: string | null
  linkedSourceId: string | null
  linkedSyncInfo: SyncedConversationRecord | null
  captureState: CaptureState
  handleCapture: (
    notebookId: string,
    isResync: boolean,
    preparedCapture?: PreparedCapturePayload
  ) => Promise<ChromeMessageResponse<Record<string, unknown>>>
}

interface PreparedCapturePayload {
  sourceKind?: CaptureSourceKind
  sourcePlatform: string
  sourceTitle: string
  conversation: Array<{ role: CaptureConversationRole; content: string }>
}

interface SyncedConversationRecord {
  url: string
  conversationId: string | null
  platform: string
  notebookId: string | null
  title: string | null
  sourceId: string | null
  syncedAt: number
}

interface CaptureResolutionOptions {
  linkedInPostUrn?: string | null
  linkedInPostRoot?: HTMLElement | null
  linkedInSnapshot?: LinkedInCaptureSnapshot | null
  redditPostRoot?: HTMLElement | null
}

interface LinkedInCaptureSnapshot {
  postContent: string
  authorName: string
  sourceUrl: string
  sourceTitle: string
}

interface NotebookAccountScope {
  accountKey: string
  accountEmail: string | null
  authUser: string | null
  confirmed: boolean
}

const SETTINGS_KEY = "minddock_settings"
const DEFAULT_NOTEBOOK_KEY = "nexus_default_notebook_id"
const LEGACY_DEFAULT_NOTEBOOK_KEY = "minddock_default_notebook"
const AUTH_USER_KEY = "nexus_auth_user"
const ACCOUNT_EMAIL_KEY = "nexus_notebook_account_email"
const TOKEN_STORAGE_KEY = "notebooklm_session"
const NOTEBOOK_CACHE_KEY_BASE = "minddock_cached_notebooks"
const NOTEBOOK_CACHE_SYNC_KEY_BASE = "minddock_cached_notebooks_synced_at"
const SYNCED_CONVERSATIONS_KEY = "minddock_synced_conversations"
const RESYNC_BINDINGS_KEY = "minddock_chat_resync_bindings"
const CHAT_SOURCE_BINDINGS_KEY = "minddock_chat_source_bindings"
const NOTEBOOK_CACHE_UPDATED_COMMAND = "MINDDOCK_NOTEBOOK_CACHE_UPDATED"
const GET_NOTEBOOKS_COMMAND = "MINDDOCK_CMD_GET_NOTEBOOKS"
const PAGE_METADATA_COMMAND = "GET_PAGE_METADATA"
const CREATE_NOTEBOOK_COMMAND = "MINDDOCK_CMD_CREATE_NOTEBOOK"
const RESYNC_PROGRESS_EVENT = "MINDDOCK_RESYNC_PROGRESS"
const RESYNC_SUCCESS_EVENT = "MINDDOCK_RESYNC_SUCCESS"
const URL_CHANGE_EVENT = "minddock-url-change"
const MAX_RESYNC_BINDINGS = 80
const DEFAULT_NOTEBOOK_TITLE = "Sem Titulo"
const LEGACY_CHAT_LINK_PREFIX = "minddock_link_"
const NO_CHANGES_DETECTED_ERROR = "NO_CHANGES_DETECTED"
const RESYNC_FLOW_LIMIT_SECONDS = 90
const RESYNC_RUNTIME_TIMEOUT_MS = 100_000
const GEMINI_CONTENT_GRACE_MS = 6000
const STRICT_NOTEBOOK_ACCOUNT_MODE = true
const LINKEDIN_INLINE_TRIGGER_ATTRIBUTE = "data-minddock-linkedin-inline-trigger"
const REDDIT_INLINE_TRIGGER_ATTRIBUTE = "data-minddock-reddit-inline-trigger"
const LINKEDIN_ACTION_BAR_SELECTORS = [".feed-shared-social-action-bar", ".feed-action-bar"] as const
const LINKEDIN_SEND_BUTTON_SELECTORS = [
  "button.send-privately-button",
  "button[aria-label*='Send']",
  "button[aria-label*='send']",
  "button[aria-label*='Enviar']",
  "button[aria-label*='enviar']"
] as const
const LINKEDIN_ACTION_LABEL_TOKENS = [
  "gost",
  "gostar",
  "like",
  "curtir",
  "comentar",
  "comment",
  "coment",
  "compartil",
  "compartilhar",
  "share",
  "repost",
  "republicar",
  "envi",
  "enviar",
  "send"
] as const
const YOUTUBE_SNIPER_BUTTON_ATTRIBUTE = "data-minddock-youtube-sniper-button"
const YOUTUBE_SNIPER_FALLBACK_ATTRIBUTE = "data-minddock-youtube-sniper-fallback"
const YOUTUBE_SNIPER_BUTTON_ID = "minddock-youtube-sniper-button"
const YOUTUBE_SNIPER_OVERLAY_HOST_ID = "minddock-youtube-sniper-overlay-host"
const YOUTUBE_SNIPER_OVERLAY_MOUNT_ID = "minddock-youtube-sniper-overlay-root"
const YOUTUBE_ACTION_BAR_SELECTORS = [
  "ytd-watch-metadata ytd-menu-renderer",
  "ytd-watch-flexy ytd-menu-renderer",
  "ytd-watch-grid ytd-menu-renderer",
  "#actions ytd-menu-renderer",
  "ytd-watch-metadata #menu",
  "ytd-watch-metadata #menu-container",
  "ytd-watch-metadata #top-level-buttons-computed",
  "ytd-watch-metadata #top-level-buttons",
  "#actions #top-level-buttons-computed",
  "#actions #top-level-buttons",
  "ytd-video-primary-info-renderer #top-level-buttons-computed",
  "ytd-video-primary-info-renderer #top-level-buttons"
] as const
const YOUTUBE_SHARE_BUTTON_SELECTORS = [
  "ytd-button-renderer button[aria-label*='Share']",
  "ytd-button-renderer a[aria-label*='Share']",
  "ytd-button-renderer button[aria-label*='Compartilhar']",
  "ytd-button-renderer a[aria-label*='Compartilhar']",
  "button[aria-label*='Share']",
  "a[aria-label*='Share']",
  "button[aria-label*='Compartilhar']",
  "a[aria-label*='Compartilhar']"
] as const
const YOUTUBE_DISLIKE_BUTTON_SELECTORS = [
  "#dislike-button button",
  "#dislike-button",
  "button[aria-label*='dislike']",
  "button[aria-label*='NÃ£o gostei']",
  "button[aria-label*='Nao gostei']"
] as const
const YOUTUBE_SNIPER_ICON_VERTICAL_OFFSET_PX = 1
const HOST_ID = "minddock-universal-button-host"
const MOUNT_ID = "minddock-universal-button-root"
const STYLE_ID = "minddock-universal-button-style"
const CLEANUP_KEY = "__MINDDOCK_UNIVERSAL_BUTTON_CLEANUP__"
const HISTORY_PATCH_KEY = "__MINDDOCK_HISTORY_PATCHED__"
const MINDDOCK_BUTTON_LOGO_SRC = new URL(
  "../../public/images/logo/logotipo minddock.png",
  import.meta.url
).href
const BLOCKED_NOTEBOOK_TITLE_KEYS = new Set([
  "conversa",
  "conversas",
  "conversation",
  "conversations"
])

let mountedRoot: Root | null = null
let mountedHost: HTMLElement | null = null
let sniperOverlayRoot: Root | null = null
let sniperOverlayHost: HTMLElement | null = null
let bootstrapPromise: Promise<void> | null = null
let injectionManager: InjectionManager | null = null
let rebootstrapTimer: number | null = null
let sniperDefaultNotebookId = ""
let youtubeSniperHardGuardStop: (() => void) | null = null
let youtubeTranscriptSuppressorStop: (() => void) | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim()
}

function normalizeCaptureSourceKind(value: unknown): CaptureSourceKind {
  const normalized = normalizeString(value).toLowerCase()
  if (normalized === "doc" || normalized === "document") {
    return "doc"
  }
  return "chat"
}

async function generateContentHash(text: string): Promise<string> {
  const normalizedText = String(text ?? "")
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizedText))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function normalizeSourcePlatformLabel(value: string): string {
  const rawValue = normalizeString(value)
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

  return rawValue.toUpperCase()
}

function buildTaggedSourceTitle(platformLabel: string, rawTitle: string): string {
  const platformTag = normalizeSourcePlatformLabel(platformLabel)
  const cleanTitle = normalizeString(rawTitle).replace(/^\[[^\]]+\]\s*/u, "").trim()
  return `[${platformTag}] ${cleanTitle || "Novo Chat"}`
}

function normalizeTitleComparisonKey(value: string): string {
  return normalizeString(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function stripTrailingContextSnippet(value: string): string {
  const normalizedValue = normalizeString(value)
  if (!normalizedValue) {
    return ""
  }

  const parentheticalMatch = normalizedValue.match(/\s*\(([^()]{1,140})\)\s*$/u)
  if (!parentheticalMatch) {
    return normalizedValue
  }

  const [fullMatch, innerRaw] = parentheticalMatch
  const inner = normalizeString(innerRaw)
  const words = inner.split(/\s+/u).filter(Boolean)
  const hasLetters = /[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]/u.test(inner)
  const looksLikeContextSnippet = hasLetters && (words.length >= 3 || inner.length >= 22)

  if (!looksLikeContextSnippet) {
    return normalizedValue
  }

  return normalizedValue.slice(0, normalizedValue.length - fullMatch.length).trim()
}

function sanitizeSourceTitleCandidate(value: string): string {
  return stripTrailingContextSnippet(
    normalizeString(value)
    .replace(/^\[[^\]]+\]\s*/u, "")
    .replace(/\s*-\s*(Gemini|Google Gemini|ChatGPT|Claude|Perplexity|LinkedIn|Reddit|Twitter|X|Grok|Genspark|Kimi|OpenEvidence|NotebookLM)\s*$/gi, "")
    .replace(/^\s*(Gemini|Google Gemini|ChatGPT|Claude|Perplexity|LinkedIn|Reddit|Twitter|X|Grok|Genspark|Kimi|OpenEvidence)\s*[-:]\s*/i, "")
    .trim()
  )
}

function isGenericSourceTitle(value: string): boolean {
  const normalized = normalizeTitleComparisonKey(value)
  if (!normalized) {
    return true
  }

  return (
    normalized === "gemini" ||
    normalized === "google gemini" ||
    normalized === "chatgpt" ||
    normalized === "claude" ||
    normalized === "perplexity" ||
    normalized === "linkedin" ||
    normalized === "reddit" ||
    normalized === "twitter" ||
    normalized === "x" ||
    normalized === "grok" ||
    normalized === "genspark" ||
    normalized === "kimi" ||
    normalized === "openevidence" ||
    normalized === "notebooklm" ||
    normalized === "novo chat" ||
    normalized === "new chat" ||
    normalized === "sem titulo" ||
    normalized === "untitled chat"
  )
}

function resolveBestSourceTitle(candidates: string[]): string {
  for (const candidate of candidates) {
    const sanitized = sanitizeSourceTitleCandidate(candidate)
    if (!sanitized) {
      continue
    }
    if (!isGenericSourceTitle(sanitized)) {
      return sanitized.slice(0, 120)
    }
  }

  for (const candidate of candidates) {
    const sanitized = sanitizeSourceTitleCandidate(candidate)
    if (sanitized) {
      return sanitized.slice(0, 120)
    }
  }

  return `Chat ${new Date().toLocaleTimeString()}`
}

function resolveGeminiDomTitle(): string {
  const selectors = [
    "div.conversation-title.gds-label",
    "div.conversation-title",
    "navigation-drawer .conversation-title",
    "mat-list-item .conversation-title",
    "[data-testid='conversation-title']",
    "nav [aria-current='page']"
  ] as const

  for (const selector of selectors) {
    const candidate = normalizeString(document.querySelector(selector)?.textContent ?? "")
    if (candidate) {
      return candidate
    }
  }

  return ""
}

function resolveSafeCaptureTitle(): string {
  const hostname = window.location.hostname.toLowerCase()
  const rawGeminiDomTitle = hostname.includes("gemini.google.com") ? resolveGeminiDomTitle() : ""
  const rawTitle = rawGeminiDomTitle || document.title || "Sem titulo"
  const cleanTitle = stripTrailingContextSnippet(
    rawTitle
    .replace(/\s*-\s*Gemini$/i, "")
    .replace(/\s*-\s*ChatGPT$/i, "")
    .replace(/\s*-\s*Claude$/i, "")
    .replace(/\s*-\s*Perplexity$/i, "")
    .replace(/\s*\|\s*Perplexity$/i, "")
    .replace(/\s*-\s*LinkedIn$/i, "")
    .replace(/\s*\|\s*LinkedIn$/i, "")
    .replace(/\s*-\s*Reddit$/i, "")
    .replace(/\s*\|\s*Reddit$/i, "")
    .replace(/\s*-\s*X$/i, "")
    .replace(/\s*\/\s*X$/i, "")
    .replace(/\s*-\s*Twitter$/i, "")
    .replace(/\s*-\s*Grok$/i, "")
    .replace(/\s*-\s*Genspark$/i, "")
    .replace(/\s*-\s*Kimi$/i, "")
    .replace(/\s*-\s*OpenEvidence$/i, "")
    .replace(/\s*-\s*Google Docs$/i, "")
    .replace(/\s*\|\s*Google Docs$/i, "")
    .replace(/\s*NotebookLM$/i, "")
    .trim()
  )

  return cleanTitle || "Novo Chat"
}

const GENERIC_CAPTURE_MAX_CHARS = 24_000
const GENERIC_CAPTURE_MAX_BLOCKS = 6
const GENERIC_CAPTURE_MIN_BLOCK_LENGTH = 40
const X_THREAD_MAX_SEGMENTS = 12
const GROK_MAX_CAPTURE_TURNS = 24

function isVisibleElement(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected) {
    return false
  }

  if (element.hidden || element.getAttribute("aria-hidden") === "true") {
    return false
  }

  const style = window.getComputedStyle(element)
  return style.display !== "none" && style.visibility !== "hidden"
}

function isRenderableElement(element: Element | null | undefined): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !isVisibleElement(element)) {
    return false
  }

  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function normalizeGenericCaptureText(value: unknown): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/\t+/g, " ")
    .replace(/[ \f\v]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function stripMarkdownBoldFormatting(value: string): string {
  if (!value) {
    return ""
  }

  let output = value
  for (let pass = 0; pass < 3; pass += 1) {
    const next = output
      .replace(/\*\*([^\n*][^*\n]*?)\*\*/g, "$1")
      .replace(/__([^\n_][^_\n]*?)__/g, "$1")
    if (next === output) {
      break
    }
    output = next
  }

  return output
}

function resolveGenericPlatformLabel(host: string): string {
  if (host.includes("docs.google.com")) {
    return "Google Docs"
  }

  if (host.includes("notebooklm.google.com")) {
    return "NotebookLM"
  }

  if (host.includes("linkedin.com")) {
    return "LinkedIn"
  }

  if (host.includes("reddit.com")) {
    return "Reddit"
  }

  if (host.includes("x.com") || host.includes("twitter.com")) {
    return "X"
  }

  if (host.includes("grok.com")) {
    return "Grok"
  }

  if (host.includes("genspark.ai") || host.includes("genspark.im")) {
    return "Genspark"
  }

  if (host.includes("kimi.com") || host.includes("moonshot.cn")) {
    return "Kimi"
  }

  if (host.includes("openevidence.com")) {
    return "OpenEvidence"
  }

  return "Web"
}

function resolveGenericCaptureSelectors(host: string): string[] {
  if (host.includes("docs.google.com")) {
    return ["div[role='textbox']", ".kix-page-content-wrapper", "#docs-editor", "main"]
  }

  if (host.includes("notebooklm.google.com")) {
    return [
      "main [class*='conversation'] [class*='message']",
      "main [class*='conversation'] [class*='response']",
      "main [class*='model-response']",
      "main article",
      "main"
    ]
  }

  if (host.includes("linkedin.com")) {
    return ["main [data-test-id='main-feed-activity-card']", "main .feed-shared-update-v2__description", "main article", "main"]
  }

  if (host.includes("reddit.com")) {
    return ["main shreddit-post", "main [data-testid='post-content']", "main article", "main"]
  }

  if (host.includes("x.com") || host.includes("twitter.com")) {
    return ["main article [data-testid='tweetText']", "main article", "main [data-testid='primaryColumn']", "main"]
  }

  if (host.includes("grok.com")) {
    return ["main [data-testid='message']", "main [class*='message']", "main article", "main"]
  }

  if (host.includes("genspark.ai") || host.includes("genspark.im")) {
    return ["main [class*='message']", "main article", "main [role='main']", "main"]
  }

  if (host.includes("kimi.com") || host.includes("moonshot.cn")) {
    return ["main [class*='message']", "main article", "main [role='main']", "main"]
  }

  if (host.includes("openevidence.com")) {
    return ["main [class*='answer']", "main article", "main [role='main']", "main"]
  }

  return ["main article", "main [role='main']", "main"]
}

function collectGenericCaptureBlocks(host: string): string[] {
  const selectors = resolveGenericCaptureSelectors(host)
  const blocks: string[] = []
  const seen = new Set<string>()

  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll(selector)).slice(0, 12)
    for (const element of elements) {
      if (!isVisibleElement(element)) {
        continue
      }

      const rawText = element.innerText || element.textContent || ""
      const normalizedText = normalizeGenericCaptureText(rawText)
      if (normalizedText.length < GENERIC_CAPTURE_MIN_BLOCK_LENGTH) {
        continue
      }

      const dedupeKey = normalizeTitleComparisonKey(normalizedText.slice(0, 180))
      if (!dedupeKey || seen.has(dedupeKey)) {
        continue
      }

      seen.add(dedupeKey)
      blocks.push(normalizedText)
      if (blocks.length >= GENERIC_CAPTURE_MAX_BLOCKS) {
        return blocks
      }
    }
  }

  if (blocks.length === 0) {
    const fallbackBodyText = normalizeGenericCaptureText(document.body?.innerText || document.body?.textContent || "")
    if (fallbackBodyText.length > GENERIC_CAPTURE_MIN_BLOCK_LENGTH) {
      blocks.push(fallbackBodyText)
    }
  }

  return blocks
}

async function buildGenericPagePreparedCapture(
  currentUrl: string,
  options: CaptureResolutionOptions = {}
): Promise<PreparedCapturePayload> {
  const siteSpecificCapture = await buildSiteSpecificPreparedCapture(currentUrl, options)
  if (siteSpecificCapture) {
    return siteSpecificCapture
  }

  const host = window.location.hostname.toLowerCase()
  if (host.includes("linkedin.com")) {
    const snapshotCapture = buildLinkedInPreparedCaptureFromSnapshot(options.linkedInSnapshot ?? null, currentUrl)
    if (snapshotCapture) {
      return snapshotCapture
    }

    const fallbackSnapshot = buildLinkedInCaptureSnapshotFromRoot(
      options.linkedInPostRoot ?? null,
      currentUrl,
      normalizeString(options.linkedInPostUrn) || null
    )
    const fallbackSnapshotCapture = buildLinkedInPreparedCaptureFromSnapshot(fallbackSnapshot, currentUrl)
    if (fallbackSnapshotCapture) {
      return fallbackSnapshotCapture
    }

    const viewportSnapshot = buildLinkedInCaptureSnapshotFromRoot(
      resolveLinkedInCaptureRootNearViewport(),
      currentUrl,
      normalizeString(options.linkedInPostUrn) || null
    )
    const viewportSnapshotCapture = buildLinkedInPreparedCaptureFromSnapshot(viewportSnapshot, currentUrl)
    if (viewportSnapshotCapture) {
      return viewportSnapshotCapture
    }

    const fallbackUrn = normalizeString(options.linkedInPostUrn)
    if (fallbackUrn) {
      const fallbackSourceUrl = resolveLinkedInSourceUrlFromPostUrn(fallbackUrn, currentUrl)
      const fallbackContent = normalizeGenericCaptureText(
        `Post by Desconhecido\nSource: ${fallbackSourceUrl}\nPublicacao do LinkedIn sem texto visivel no momento da captura.`
      )
      return {
        sourceKind: "chat",
        sourcePlatform: "LinkedIn",
        sourceTitle: resolveBestSourceTitle([resolveSafeCaptureTitle(), "Post do LinkedIn"]),
        conversation: [
          {
            role: "user",
            content: fallbackContent
          }
        ]
      }
    }

    return {
      sourceKind: "chat",
      sourcePlatform: "LinkedIn",
      sourceTitle: resolveBestSourceTitle([resolveSafeCaptureTitle(), "Post do LinkedIn"]),
      conversation: [
        {
          role: "user",
          content: normalizeGenericCaptureText(
            `Post by Desconhecido\nSource: ${currentUrl}\nPublicacao do LinkedIn sem texto visivel no momento da captura.`
          )
        }
      ]
    }
  }

  const sourcePlatform = resolveGenericPlatformLabel(host)
  const sourceTitle = resolveSafeCaptureTitle()
  const selectedText = normalizeGenericCaptureText(window.getSelection?.()?.toString() || "")
  const extractedBlocks = collectGenericCaptureBlocks(host)

  const contentSections: string[] = []
  if (selectedText) {
    contentSections.push(`Selecao do usuario:\n${selectedText}`)
  }
  if (extractedBlocks.length > 0) {
    contentSections.push(extractedBlocks.join("\n\n---\n\n"))
  }

  const baseContent = normalizeGenericCaptureText(contentSections.join("\n\n"))
  if (!baseContent) {
    throw new Error("Nao foi possivel capturar conteudo textual desta pagina.")
  }

  const truncatedContent =
    baseContent.length > GENERIC_CAPTURE_MAX_CHARS
      ? `${baseContent.slice(0, GENERIC_CAPTURE_MAX_CHARS)}\n\n[Conteudo truncado para envio ao NotebookLM]`
      : baseContent

  return {
    sourceKind: "chat",
    sourcePlatform,
    sourceTitle,
    conversation: [
      {
        role: "assistant",
        content: `URL: ${currentUrl}\nTitulo: ${sourceTitle}\n\n${truncatedContent}`
      }
    ]
  }
}

function truncateLabel(value: string, maxLength = 42): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value
}

function normalizeNotebookTitleKey(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function resolveConversationResyncKey(rawUrl = window.location.href): string {
  return resolveConversationPrimaryKey(rawUrl)
}

function resolveConversationResyncKeys(rawUrl = window.location.href): string[] {
  const resolved = resolveConversationAliasKeys(rawUrl).map((entry) => normalizeString(entry)).filter(Boolean)
  if (resolved.length > 0) {
    return resolved
  }
  const fallback = resolveConversationResyncKey(rawUrl)
  return fallback ? [fallback] : []
}

function isSameConversationResyncScope(leftUrl: string, rightUrl: string): boolean {
  const leftKeys = new Set(resolveConversationResyncKeys(leftUrl))
  if (leftKeys.size === 0) {
    return false
  }

  for (const key of resolveConversationResyncKeys(rightUrl)) {
    if (leftKeys.has(key)) {
      return true
    }
  }

  return false
}

function isGenericConversationUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.toLowerCase()
    const pathname = parsed.pathname.replace(/\/+$/u, "") || "/"

    if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) {
      return !/\/c\/[^/]+/u.test(pathname)
    }

    if (host.includes("claude.ai")) {
      return !/^\/chat\/[^/]+/u.test(pathname)
    }

    if (host.includes("gemini.google.com")) {
      return pathname === "/" || pathname === "/app"
    }

    if (host.includes("perplexity.ai")) {
      return !/^\/(search|thread)\/[^/]+/u.test(pathname)
    }

    if (
      host.includes("docs.google.com") ||
      host.includes("notebooklm.google.com") ||
      host.includes("linkedin.com") ||
      host.includes("reddit.com") ||
      host.includes("x.com") ||
      host.includes("twitter.com") ||
      host.includes("grok.com") ||
      host.includes("genspark.ai") ||
      host.includes("genspark.im") ||
      host.includes("kimi.com") ||
      host.includes("moonshot.cn") ||
      host.includes("openevidence.com")
    ) {
      return true
    }

    return false
  } catch {
    return true
  }
}

function detectGeminiConversationContent(): boolean {
  const candidates = Array.from(
    document.querySelectorAll(
      [
        "conversational-turn user-query",
        "conversational-turn model-response",
        "user-query",
        "model-response",
        "conversational-turn",
        "[data-turn-id]",
        "[class*='conversation-turn']",
        "[class*='model-response']",
        "[class*='user-query']"
      ].join(",")
    )
  )

  for (const candidate of candidates) {
    if (!isVisibleElement(candidate)) {
      continue
    }

    const text = normalizeString((candidate as HTMLElement).innerText || candidate.textContent || "")
    if (text.length > 0) {
      return true
    }
  }

  const actionControls = Array.from(
    document.querySelectorAll<HTMLElement>(
      "conversational-turn button[aria-label], model-response button[aria-label], user-query button[aria-label]"
    )
  )
  for (const actionControl of actionControls) {
    if (!isVisibleElement(actionControl)) {
      continue
    }

    const label = normalizeString(
      [
        actionControl.getAttribute("aria-label") ?? "",
        actionControl.getAttribute("title") ?? "",
        actionControl.textContent ?? ""
      ].join(" ")
    ).toLowerCase()

    if (
      label.includes("like") ||
      label.includes("gostei") ||
      label.includes("nao gostei") ||
      label.includes("dislike") ||
      label.includes("copiar") ||
      label.includes("copy")
    ) {
      return true
    }
  }

  return false
}

function detectGeminiComposerSurface(): boolean {
  const composerCandidates = Array.from(
    document.querySelectorAll(
      [
        "div[class*='text-input-field']",
        "textarea[aria-label*='gemini' i]",
        "textarea[placeholder*='gemini' i]",
        "div[contenteditable='true'][aria-label*='gemini' i]",
        "div[contenteditable='true'][data-placeholder*='gemini' i]",
        "button[class*='toolbox-drawer-button']",
        "button[aria-label*='ferramentas' i]",
        "button[aria-label*='tools' i]"
      ].join(",")
    )
  )

  for (const candidate of composerCandidates) {
    if (isVisibleElement(candidate)) {
      return true
    }
  }

  return false
}

function formatNotebooksSyncLabel(syncedAt: string): string {
  const normalizedSyncedAt = normalizeString(syncedAt)
  if (!normalizedSyncedAt) {
    return "Syncing notebooks..."
  }

  const syncDate = new Date(normalizedSyncedAt)
  if (Number.isNaN(syncDate.getTime())) {
    return "Syncing notebooks..."
  }

  const diffMinutes = Math.max(0, Math.floor((Date.now() - syncDate.getTime()) / 60000))
  if (diffMinutes < 1) {
    return "Synced just now"
  }

  return diffMinutes === 1 ? "Synced 1 min ago" : `Synced ${diffMinutes} mins ago`
}

function normalizeSyncedAt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }

  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed)
  }

  return 0
}

function parseSyncedConversations(
  value: unknown
): Record<string, SyncedConversationRecord> {
  if (!isRecord(value)) {
    return {}
  }

  const output: Record<string, SyncedConversationRecord> = {}
  for (const [storageKey, rawEntry] of Object.entries(value)) {
    if (!isRecord(rawEntry)) {
      continue
    }

    const syncedAt = normalizeSyncedAt(rawEntry.syncedAt)
    if (!syncedAt) {
      continue
    }

    const normalizedStorageKey = normalizeString(storageKey)
    const normalizedUrl =
      normalizeString(rawEntry.url) || normalizeString(resolveConversationPrimaryKey(normalizedStorageKey))
    const normalizedPlatform = normalizeString(rawEntry.platform)
    const normalizedConversationId = normalizeString(rawEntry.conversationId)
    const normalizedNotebookId = normalizeString(rawEntry.notebookId)
    const normalizedTitle = normalizeString(rawEntry.title)
    const normalizedSourceId = normalizeString(rawEntry.sourceId)

    output[normalizedStorageKey] = {
      url: normalizedUrl || normalizedStorageKey,
      conversationId: normalizedConversationId || null,
      platform: normalizedPlatform || buildConversationResyncIdentity(normalizedUrl || normalizedStorageKey).platform,
      notebookId: normalizedNotebookId || null,
      title: normalizedTitle || null,
      sourceId: normalizedSourceId || null,
      syncedAt
    }
  }

  return output
}

function resolveSyncedConversationInfo(
  value: unknown,
  rawUrl: string
): SyncedConversationRecord | null {
  const store = parseSyncedConversations(value)
  const identity = buildConversationResyncIdentity(rawUrl)
  const keyCandidates = Array.from(
    new Set(
      [
        identity.normalizedUrl,
        identity.primaryKey,
        ...identity.aliases,
        identity.conversationId ? `${identity.platform}:${identity.conversationId}` : ""
      ]
        .map((entry) => normalizeString(entry))
        .filter(Boolean)
    )
  )

  for (const key of keyCandidates) {
    const matched = store[key]
    if (matched) {
      return matched
    }
  }

  const normalizedUrl = normalizeString(identity.normalizedUrl)
  if (!normalizedUrl) {
    return null
  }

  for (const entry of Object.values(store)) {
    if (normalizeString(entry.url) === normalizedUrl) {
      return entry
    }
  }

  return null
}

function formatConversationSyncLabel(syncInfo: SyncedConversationRecord | null): string {
  const syncedAt = normalizeSyncedAt(syncInfo?.syncedAt)
  if (!syncedAt) {
    return "Not synced"
  }

  const diffMs = Math.max(0, Date.now() - syncedAt)
  const mins = Math.floor(diffMs / 60_000)
  const hours = Math.floor(diffMs / 3_600_000)
  const days = Math.floor(diffMs / 86_400_000)

  if (mins < 1) {
    return "Synced: Just now"
  }
  if (mins < 60) {
    return `Synced: ${mins} min${mins === 1 ? "" : "s"} ago`
  }
  if (hours < 24) {
    return `Synced: ${hours} hour${hours === 1 ? "" : "s"} ago`
  }
  if (days < 7) {
    return `Synced: ${days} day${days === 1 ? "" : "s"} ago`
  }

  return `Synced: ${new Date(syncedAt).toLocaleDateString()}`
}

function normalizeNotebookEntries(value: unknown): NotebookOption[] {
  if (!Array.isArray(value)) {
    return []
  }

  const output = new Map<string, NotebookOption>()

  for (const candidate of value) {
    if (!isRecord(candidate)) {
      continue
    }

    const id = normalizeString(candidate.id)
    const title = normalizeString(candidate.title)
    if (!id || !title) {
      continue
    }

    if (BLOCKED_NOTEBOOK_TITLE_KEYS.has(normalizeNotebookTitleKey(title))) {
      continue
    }

    output.set(id, { id, title })
  }

  return Array.from(output.values())
}

function mergeNotebookOptions(primary: NotebookOption[], secondary: NotebookOption[]): NotebookOption[] {
  const output = new Map<string, NotebookOption>()

  for (const notebook of secondary) {
    output.set(notebook.id, notebook)
  }

  for (const notebook of primary) {
    output.set(notebook.id, notebook)
  }

  return Array.from(output.values())
}

function parseResyncBindings(value: unknown): Record<string, ChatResyncBinding> {
  if (!isRecord(value)) {
    return {}
  }

  const output: Record<string, ChatResyncBinding> = {}
  for (const [key, rawBinding] of Object.entries(value)) {
    if (!isRecord(rawBinding)) {
      continue
    }

    const notebookId = normalizeString(rawBinding.notebookId)
    if (!notebookId) {
      continue
    }

    output[key] = {
      notebookId,
      notebookTitle: normalizeString(rawBinding.notebookTitle) || DEFAULT_NOTEBOOK_TITLE,
      sourceId: normalizeString(rawBinding.sourceId) || undefined,
      lastHash:
        normalizeString(rawBinding.lastHash) || normalizeString(rawBinding.lastSyncHash) || undefined,
      updatedAt: normalizeString(rawBinding.updatedAt) || new Date(0).toISOString()
    }
  }

  return output
}

function parseChatSourceBindings(value: unknown): Record<string, ChatSourceBindingStorageRecord> {
  if (!isRecord(value)) {
    return {}
  }

  const output: Record<string, ChatSourceBindingStorageRecord> = {}
  for (const [key, rawBinding] of Object.entries(value)) {
    if (!isRecord(rawBinding)) {
      continue
    }

    const sourceId = normalizeString(rawBinding.sourceId)
    if (!sourceId) {
      continue
    }

    output[key] = {
      sourceId,
      lastSyncHash: normalizeString(rawBinding.lastSyncHash) || undefined,
      updatedAt: normalizeString(rawBinding.updatedAt) || new Date(0).toISOString()
    }
  }

  return output
}

function resolveLinkedFromChatSourceBindings(
  value: unknown,
  resyncKeys: string | string[]
): { notebookId: string; sourceId: string | null; lastSyncHash?: string } | null {
  const keys = Array.isArray(resyncKeys) ? resyncKeys : [resyncKeys]
  const keySet = new Set(keys.map((entry) => normalizeString(entry)).filter(Boolean))
  if (keySet.size === 0) {
    return null
  }

  const bindings = parseChatSourceBindings(value)
  let bestNotebookId = ""
  let bestSourceId = ""
  let bestLastSyncHash = ""
  let bestUpdatedAt = -1

  for (const [compositeKey, binding] of Object.entries(bindings)) {
    const separatorIndex = compositeKey.lastIndexOf("::")
    if (separatorIndex <= 0) {
      continue
    }

    const normalizedKey = compositeKey.slice(0, separatorIndex)
    if (!keySet.has(normalizedKey)) {
      continue
    }

    const notebookId = normalizeString(compositeKey.slice(separatorIndex + 2))
    if (!notebookId) {
      continue
    }

    const updatedAt = Date.parse(binding.updatedAt)
    const updatedAtScore = Number.isFinite(updatedAt) ? updatedAt : 0
    if (updatedAtScore >= bestUpdatedAt) {
      bestUpdatedAt = updatedAtScore
      bestNotebookId = notebookId
      bestSourceId = normalizeString(binding.sourceId)
      bestLastSyncHash = normalizeString(binding.lastSyncHash)
    }
  }

  if (!bestNotebookId) {
    return null
  }

  return {
    notebookId: bestNotebookId,
    sourceId: bestSourceId || null,
    lastSyncHash: bestLastSyncHash || undefined
  }
}

function resolveBestResyncBinding(
  bindings: Record<string, ChatResyncBinding>,
  resyncKeys: string[]
): ChatResyncBinding | null {
  const keySet = new Set(resyncKeys.map((entry) => normalizeString(entry)).filter(Boolean))
  if (keySet.size === 0) {
    return null
  }

  let selectedBinding: ChatResyncBinding | null = null
  let selectedTime = -1

  for (const [key, binding] of Object.entries(bindings)) {
    if (!keySet.has(normalizeString(key))) {
      continue
    }
    const parsedTime = Date.parse(binding.updatedAt)
    const timeScore = Number.isFinite(parsedTime) ? parsedTime : 0
    if (!selectedBinding || timeScore >= selectedTime) {
      selectedBinding = binding
      selectedTime = timeScore
    }
  }

  return selectedBinding
}

function resolveLegacyLinkedNotebookId(value: unknown): string {
  if (typeof value === "string") {
    return normalizeString(value)
  }

  if (!isRecord(value)) {
    return ""
  }

  return normalizeString(value.notebookId ?? value.id)
}

function resolveNotebookAccountScopeFromSnapshot(snapshot: StorageSnapshot): NotebookAccountScope {
  const settings = isRecord(snapshot[SETTINGS_KEY]) ? snapshot[SETTINGS_KEY] : {}
  const session = isRecord(snapshot[TOKEN_STORAGE_KEY]) ? snapshot[TOKEN_STORAGE_KEY] : {}
  const accountEmail = normalizeAccountEmail(
    settings.notebookAccountEmail ??
      snapshot[ACCOUNT_EMAIL_KEY] ??
      session.accountEmail
  )

  const authUserFromUrl = (() => {
    try {
      return normalizeAuthUser(new URL(window.location.href).searchParams.get("authuser"))
    } catch {
      return null
    }
  })()

  const authUser = normalizeAuthUser(
    settings.authUser ??
      settings.notebookAuthUser ??
      snapshot[AUTH_USER_KEY] ??
      session.authUser ??
      authUserFromUrl
  )

  const accountKey = buildNotebookAccountKey({ accountEmail, authUser })
  return {
    accountKey,
    accountEmail,
    authUser,
    confirmed: isConfirmedNotebookAccountKey(accountKey)
  }
}

function resolvePreferredNotebookId(snapshot: StorageSnapshot, accountScope: NotebookAccountScope): string {
  if (!accountScope.confirmed) {
    return ""
  }

  const accountKey = accountScope.accountKey
  const settings = isRecord(snapshot[SETTINGS_KEY]) ? snapshot[SETTINGS_KEY] : {}
  const defaultByAccount = isRecord(settings.defaultNotebookByAccount)
    ? (settings.defaultNotebookByAccount as Record<string, unknown>)
    : {}

  const fromScopedSettings = normalizeString(defaultByAccount[accountKey])
  if (fromScopedSettings) {
    return fromScopedSettings
  }

  const scopedDefaultKey = buildScopedStorageKey(DEFAULT_NOTEBOOK_KEY, accountKey)
  const scopedLegacyDefaultKey = buildScopedStorageKey(LEGACY_DEFAULT_NOTEBOOK_KEY, accountKey)

  const fromScopedCanonical = normalizeString(snapshot[scopedDefaultKey])
  if (fromScopedCanonical) {
    return fromScopedCanonical
  }

  const fromScopedLegacy = normalizeString(snapshot[scopedLegacyDefaultKey])
  if (fromScopedLegacy) {
    return fromScopedLegacy
  }

  return ""
}

function resolveGenericChatCaptureLabel(host: string): string | null {
  if (host.includes("notebooklm.google.com")) {
    return "NotebookLM"
  }

  return null
}

function resolveGenericChatMessageSelectors(host: string): string[] {
  if (host.includes("notebooklm.google.com")) {
    return [
      "main [class*='conversation'] [class*='message']",
      "main [class*='conversation'] [class*='response']",
      "main [class*='model-response']",
      "main article"
    ]
  }

  if (host.includes("openevidence.com")) {
    return [
      "main [class*='message']",
      "main [class*='answer']",
      "main [data-testid*='message']",
      "main article"
    ]
  }

  if (host.includes("grok.com")) {
    return [
      "main [data-testid*='message']",
      "main [class*='message']",
      "main [class*='response']",
      "main article"
    ]
  }

  if (host.includes("genspark.ai") || host.includes("genspark.im") || host.includes("kimi.com") || host.includes("moonshot.cn")) {
    return [
      "main [class*='message']",
      "main [class*='bubble']",
      "main [class*='response']",
      "main [data-testid*='message']",
      "main article"
    ]
  }

  return [
    "main [data-message-author-role]",
    "main [data-testid*='message']",
    "main [class*='message']",
    "main article"
  ]
}

function resolveGenericChatContainerSelectors(host: string): string[] {
  if (host.includes("notebooklm.google.com")) {
    return ["main", "div[role='main']", "body"]
  }

  return ["main", "div[role='main']", "#__next", "body"]
}

function resolveGenericChatRole(element: Element): "assistant" | "user" {
  const directRole = normalizeTitleComparisonKey(
    (element as HTMLElement).getAttribute?.("data-message-author-role") || ""
  )
  if (directRole === "assistant") {
    return "assistant"
  }
  if (directRole === "user") {
    return "user"
  }

  const tokenSource = [
    (element as HTMLElement).getAttribute?.("data-role"),
    (element as HTMLElement).getAttribute?.("data-testid"),
    (element as HTMLElement).getAttribute?.("aria-label"),
    (element as HTMLElement).className,
    (element as HTMLElement).id
  ]
    .map((value) => normalizeTitleComparisonKey(String(value ?? "")))
    .join(" ")

  if (
    /(assistant|model|bot|ai|answer|response|output|result|grok|gemini|claude|kimi|openevidence)/u.test(
      tokenSource
    )
  ) {
    return "assistant"
  }

  if (/(user|human|prompt|query|question|input|author)/u.test(tokenSource)) {
    return "user"
  }

  return "assistant"
}

const DOM_CAPTURE_PROFILES: DomCaptureProfile[] = [
  {
    matchesHost: (host) => host.includes("claude.ai"),
    platform: "claude",
    platformLabel: "Claude",
    messageSelectors: ["[data-testid='user-message']", "[data-testid='assistant-message']"],
    containerSelectors: ["main", "div[role='main']", "[data-testid='chat-messages']"],
    resolveRole: (element) =>
      element.getAttribute("data-testid")?.includes("assistant") ? "assistant" : "user"
  },
  {
    matchesHost: (host) => host.includes("gemini.google.com"),
    platform: "gemini",
    platformLabel: "GEMINI",
    messageSelectors: [
      "user-query .query-content",
      "user-query .query-text",
      "user-query markdown-renderer",
      "user-query .markdown",
      "model-response .model-response-text",
      "model-response .response-content",
      "model-response message-content",
      "model-response markdown-renderer"
    ],
    containerSelectors: ["main", "chat-window", "div[role='main']"],
    resolveRole: (element) => (element.closest("model-response") !== null ? "assistant" : "user")
  },
  {
    matchesHost: (host) => host.includes("chatgpt.com") || host.includes("chat.openai.com"),
    platform: "chatgpt",
    platformLabel: "ChatGPT",
    messageSelectors: ["[data-message-author-role]"],
    containerSelectors: ["main", "[data-testid='conversation-turns']", "div[role='main']"],
    resolveRole: (element) =>
      element.getAttribute("data-message-author-role") === "assistant" ? "assistant" : "user"
  }
]

function resolveCaptureConfig(currentUrl: string): CaptureConfig | null {
  let host = ""
  try {
    host = new URL(currentUrl).hostname.toLowerCase()
  } catch {
    host = window.location.hostname.toLowerCase()
  }

  const matchedProfile = DOM_CAPTURE_PROFILES.find((profile) => profile.matchesHost(host))
  if (matchedProfile) {
    const { matchesHost, ...captureConfig } = matchedProfile
    void matchesHost
    return captureConfig
  }

  const genericChatLabel = resolveGenericChatCaptureLabel(host)
  if (genericChatLabel) {
    return {
      platform: "perplexity",
      platformLabel: genericChatLabel,
      messageSelectors: resolveGenericChatMessageSelectors(host),
      containerSelectors: resolveGenericChatContainerSelectors(host),
      resolveRole: resolveGenericChatRole
    }
  }

  return null
}

function isGrokRouteUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.toLowerCase()
    const pathname = parsed.pathname.toLowerCase()

    if (host.includes("grok.com")) {
      return true
    }

    if (
      (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com")) &&
      /^\/i\/grok(?:\/|$)/u.test(pathname)
    ) {
      return true
    }

    return false
  } catch {
    return false
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function queryFirstVisibleElement(selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    let candidates: Element[] = []
    try {
      candidates = Array.from(document.querySelectorAll(selector))
    } catch {
      continue
    }
    for (const candidate of candidates) {
      if (isVisibleElement(candidate)) {
        return candidate
      }
    }
  }

  return null
}

function queryFirstVisibleDescendant(root: ParentNode, selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    let candidates: Element[] = []
    try {
      candidates = Array.from(root.querySelectorAll(selector))
    } catch {
      continue
    }
    for (const candidate of candidates) {
      if (isVisibleElement(candidate)) {
        return candidate
      }
    }
  }

  return null
}

function isYouTubeWatchUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.toLowerCase()
    if (!host.endsWith("youtube.com")) {
      return false
    }
    return parsed.pathname.toLowerCase().startsWith("/watch")
  } catch {
    const host = window.location.hostname.toLowerCase()
    if (!host.endsWith("youtube.com")) {
      return false
    }
    return window.location.pathname.toLowerCase().startsWith("/watch")
  }
}

function resolveYouTubeActionBar(): HTMLElement | null {
  const directActionBar = queryFirstVisibleElement(YOUTUBE_ACTION_BAR_SELECTORS)
  if (directActionBar) {
    return directActionBar
  }

  const globalShareWrapper = resolveYouTubeShareButtonWrapperGlobal()
  if (globalShareWrapper?.parentElement instanceof HTMLElement) {
    return globalShareWrapper.parentElement
  }

  const fallbackVisibleActionBar = queryFirstVisibleElement([
    "ytd-watch-flexy #menu",
    "ytd-watch-flexy #menu-container",
    "ytd-watch-flexy #actions",
    "ytd-watch-grid #menu",
    "ytd-watch-grid #actions"
  ])
  if (fallbackVisibleActionBar) {
    return fallbackVisibleActionBar
  }

  const strictSelectors = [
    "ytd-watch-metadata ytd-menu-renderer",
    "ytd-watch-metadata #menu",
    "ytd-watch-flexy #menu",
    "ytd-watch-grid #menu",
    "ytd-watch-flexy #actions"
  ]
  for (const selector of strictSelectors) {
    const candidate = document.querySelector(selector)
    if (candidate instanceof HTMLElement && candidate.isConnected) {
      return candidate
    }
  }

  return null
}

function resolveYouTubeWatchRoot(): ParentNode {
  return (
    queryFirstVisibleElement(["ytd-watch-flexy", "ytd-watch-grid", "#primary-inner"]) ??
    document
  )
}

function resolveYouTubeButtonWrapper(button: HTMLElement | null): HTMLElement | null {
  if (!button) {
    return null
  }
  return (
    (button.closest("ytd-button-renderer") as HTMLElement | null) ||
    (button.closest("ytd-toggle-button-renderer") as HTMLElement | null) ||
    button
  )
}

function normalizeYouTubeActionLabel(value: string): string {
  return normalizeString(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function isYouTubeShareLikeLabel(value: string): boolean {
  const normalized = normalizeYouTubeActionLabel(value)
  return (
    normalized.includes("share") ||
    normalized.includes("compartilh") ||
    normalized.includes("compartilhar") ||
    normalized.includes("compartilhar com") ||
    normalized.includes("partilhar")
  )
}

function isYouTubeDislikeLikeLabel(value: string): boolean {
  const normalized = normalizeYouTubeActionLabel(value)
  return (
    normalized.includes("dislike") ||
    normalized.includes("nao gostei") ||
    normalized.includes("nÃ£o gostei")
  )
}

function resolveYouTubeShareButtonWrapper(actionBar: ParentNode): HTMLElement | null {
  const shareButton = queryFirstVisibleDescendant(actionBar, YOUTUBE_SHARE_BUTTON_SELECTORS)
  const shareWrapper = resolveYouTubeButtonWrapper(shareButton)
  if (shareWrapper) {
    return shareWrapper
  }

  const fallbackButtons = Array.from(actionBar.querySelectorAll<HTMLElement>("button, a, [role='button']"))
  for (const candidate of fallbackButtons) {
    if (!isRenderableElement(candidate)) {
      continue
    }
    const label = [
      candidate.getAttribute("aria-label") || "",
      candidate.getAttribute("title") || "",
      candidate.textContent || ""
    ].join(" ")
    if (!isYouTubeShareLikeLabel(label)) {
      continue
    }
    const wrapper = resolveYouTubeButtonWrapper(candidate)
    if (wrapper) {
      return wrapper
    }
  }

  const fallbackWrappers = Array.from(
    actionBar.querySelectorAll<HTMLElement>("ytd-button-renderer, ytd-toggle-button-renderer")
  )
  for (const wrapper of fallbackWrappers) {
    if (!isRenderableElement(wrapper)) {
      continue
    }
    const label = [
      wrapper.getAttribute("aria-label") || "",
      wrapper.getAttribute("title") || "",
      wrapper.textContent || ""
    ].join(" ")
    if (isYouTubeShareLikeLabel(label)) {
      return wrapper
    }
  }

  return null
}

function resolveYouTubeShareAnchor(root: ParentNode): HTMLElement | null {
  const strictSelectors = [
    "button[aria-label*='Share']",
    "button[aria-label*='Compartilhar']",
    "a[aria-label*='Share']",
    "a[aria-label*='Compartilhar']",
    "button[title*='Share']",
    "button[title*='Compartilhar']"
  ] as const

  for (const selector of strictSelectors) {
    let matches: HTMLElement[] = []
    try {
      matches = Array.from(root.querySelectorAll<HTMLElement>(selector))
    } catch {
      continue
    }

    for (const candidate of matches) {
      if (!isRenderableElement(candidate)) {
        continue
      }
      const label = [
        candidate.getAttribute("aria-label") || "",
        candidate.getAttribute("title") || "",
        candidate.textContent || ""
      ].join(" ")
      if (isYouTubeShareLikeLabel(label)) {
        return candidate
      }
    }
  }

  const genericCandidates = Array.from(root.querySelectorAll<HTMLElement>("button, a, [role='button']"))
  for (const candidate of genericCandidates) {
    if (!isRenderableElement(candidate)) {
      continue
    }
    const label = [
      candidate.getAttribute("aria-label") || "",
      candidate.getAttribute("title") || "",
      candidate.textContent || ""
    ].join(" ")
    if (isYouTubeShareLikeLabel(label)) {
      return candidate
    }
  }

  return null
}

function resolveYouTubeShareButtonWrapperGlobal(): HTMLElement | null {
  const watchRoot = resolveYouTubeWatchRoot()
  const globalShareWrapper = resolveYouTubeShareButtonWrapper(watchRoot)
  if (isRenderableElement(globalShareWrapper)) {
    return globalShareWrapper
  }
  return null
}

function resolveYouTubeDislikeButtonWrapper(actionBar: ParentNode): HTMLElement | null {
  const dislikeButton = queryFirstVisibleDescendant(actionBar, YOUTUBE_DISLIKE_BUTTON_SELECTORS)
  const dislikeWrapper = resolveYouTubeButtonWrapper(dislikeButton)
  if (dislikeWrapper) {
    return dislikeWrapper
  }

  const fallbackButtons = Array.from(actionBar.querySelectorAll<HTMLElement>("button, a, [role='button']"))
  for (const candidate of fallbackButtons) {
    if (!isVisibleElement(candidate)) {
      continue
    }
    const label = [
      candidate.getAttribute("aria-label") || "",
      candidate.getAttribute("title") || "",
      candidate.textContent || ""
    ].join(" ")
    if (!isYouTubeDislikeLikeLabel(label)) {
      continue
    }
    const wrapper = resolveYouTubeButtonWrapper(candidate)
    if (wrapper) {
      return wrapper
    }
  }

  return null
}

function resolveYouTubeTemplateWrapperGlobal(): HTMLElement | null {
  const watchRoot = resolveYouTubeWatchRoot()
  const wrappers = Array.from(
    watchRoot.querySelectorAll<HTMLElement>("ytd-button-renderer, ytd-toggle-button-renderer")
  )
  for (const wrapper of wrappers) {
    if (!isVisibleElement(wrapper)) {
      continue
    }
    if (wrapper.querySelector("button, a, [role='button']")) {
      return wrapper
    }
  }
  return null
}

function resolveYouTubeTemplateWrapperInActionBar(actionBar: ParentNode): HTMLElement | null {
  const wrappers = Array.from(
    actionBar.querySelectorAll<HTMLElement>("ytd-button-renderer, ytd-toggle-button-renderer")
  )
  for (const wrapper of wrappers) {
    if (!isRenderableElement(wrapper)) {
      continue
    }
    if (wrapper.hasAttribute(YOUTUBE_SNIPER_BUTTON_ATTRIBUTE)) {
      continue
    }
    if (wrapper.querySelector("button, a, [role='button']")) {
      return wrapper
    }
  }
  return null
}

function updateYouTubeButtonLabel(root: HTMLElement, label: string): void {
  const labelNodes = root.querySelectorAll(
    "#text, .yt-spec-button-shape-next__button-text-content, .yt-core-attributed-string"
  )
  if (labelNodes.length === 0) {
    return
  }
  labelNodes.forEach((node) => {
    node.textContent = label
  })
}

function updateYouTubeButtonIcon(root: HTMLElement): void {
  const iconCandidate =
    root.querySelector("yt-icon") ??
    root.querySelector(".yt-icon-container") ??
    root.querySelector("svg") ??
    root.querySelector("img")

  if (!iconCandidate) {
    return
  }

  const logo = document.createElement("img")
  logo.src = MINDDOCK_BUTTON_LOGO_SRC
  logo.alt = "MindDock"
  logo.style.width = "18px"
  logo.style.height = "18px"
  logo.style.objectFit = "contain"
  logo.style.display = "inline-block"
  logo.style.verticalAlign = "middle"
  logo.style.position = "relative"
  logo.style.top = `${YOUTUBE_SNIPER_ICON_VERTICAL_OFFSET_PX}px`

  if (iconCandidate instanceof SVGElement) {
    iconCandidate.replaceWith(logo)
    return
  }

  if (iconCandidate instanceof HTMLElement) {
    iconCandidate.innerHTML = ""
    iconCandidate.appendChild(logo)
    return
  }

  iconCandidate.replaceWith(logo as unknown as Node)
}

function attachYouTubeSniperOpenHandler(clickTarget: HTMLElement): void {
  clickTarget.addEventListener(
    "click",
    (event) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      openSniperOverlay()
    },
    true
  )
}

function buildYouTubeSniperFallbackButton(): HTMLElement {
  const wrapper = document.createElement("div")
  wrapper.id = YOUTUBE_SNIPER_BUTTON_ID
  wrapper.setAttribute(YOUTUBE_SNIPER_BUTTON_ATTRIBUTE, "true")
  wrapper.setAttribute(YOUTUBE_SNIPER_FALLBACK_ATTRIBUTE, "true")
  wrapper.style.display = "inline-flex"
  wrapper.style.alignItems = "center"
  wrapper.style.marginRight = "8px"

  const button = document.createElement("button")
  button.type = "button"
  button.setAttribute("aria-label", "NotebookLM")
  button.setAttribute("title", "NotebookLM")
  button.style.display = "inline-flex"
  button.style.alignItems = "center"
  button.style.justifyContent = "center"
  button.style.gap = "8px"
  button.style.height = "36px"
  button.style.padding = "0 14px"
  button.style.borderRadius = "9999px"
  button.style.border = "1px solid rgba(255,255,255,0.18)"
  button.style.background = "rgba(255,255,255,0.08)"
  button.style.color = "#f1f5f9"
  button.style.fontSize = "14px"
  button.style.fontWeight = "500"
  button.style.cursor = "pointer"
  button.style.lineHeight = "1"

  const logo = document.createElement("img")
  logo.src = MINDDOCK_BUTTON_LOGO_SRC
  logo.alt = "MindDock"
  logo.style.width = "18px"
  logo.style.height = "18px"
  logo.style.objectFit = "contain"
  logo.style.display = "inline-block"
  logo.style.verticalAlign = "middle"
  logo.style.position = "relative"
  logo.style.top = `${YOUTUBE_SNIPER_ICON_VERTICAL_OFFSET_PX}px`

  const label = document.createElement("span")
  label.textContent = "NotebookLM"
  label.style.display = "inline-flex"
  label.style.alignItems = "center"
  label.style.lineHeight = "1"

  button.append(logo, label)
  attachYouTubeSniperOpenHandler(button)
  wrapper.appendChild(button)

  return wrapper
}

function normalizeYouTubeSniperButtonAlignment(root: HTMLElement, clickTarget: HTMLElement): void {
  clickTarget.style.alignItems = "center"
  clickTarget.style.verticalAlign = "middle"

  const iconContainer = root.querySelector<HTMLElement>(
    "yt-icon, .yt-icon-container, .yt-spec-button-shape-next__icon"
  )
  if (iconContainer) {
    iconContainer.style.display = "inline-flex"
    iconContainer.style.alignItems = "center"
    iconContainer.style.justifyContent = "center"
    iconContainer.style.lineHeight = "0"
    iconContainer.style.verticalAlign = "middle"
  }

  const labelNodes = root.querySelectorAll<HTMLElement>(
    "#text, .yt-spec-button-shape-next__button-text-content, .yt-core-attributed-string"
  )
  labelNodes.forEach((node) => {
    node.style.display = "inline-flex"
    node.style.alignItems = "center"
    node.style.lineHeight = "1"
    node.style.verticalAlign = "middle"
  })
}

function ensureYouTubeButtonGap(
  sniperButton: HTMLElement,
  actionBar: HTMLElement,
  shareWrapper: HTMLElement | null
): void {
  const actionStyles = window.getComputedStyle(actionBar)
  const gapValue = actionStyles.columnGap || actionStyles.gap || "0"
  const parsedGap = Number.parseFloat(gapValue)

  const shareStyles = shareWrapper ? window.getComputedStyle(shareWrapper) : null
  const shareMarginLeft = Number.parseFloat(
    shareStyles?.marginLeft || shareStyles?.marginInlineStart || "0"
  )

  const existingMarginRight = Number.parseFloat(
    window.getComputedStyle(sniperButton).marginRight || "0"
  )

  if (parsedGap > 0 || shareMarginLeft > 0 || existingMarginRight > 0) {
    return
  }

  sniperButton.style.marginRight = "8px"
}

function ensureSniperOverlayMount(): HTMLElement {
  if (sniperOverlayHost?.isConnected) {
    const existingMount = sniperOverlayHost.shadowRoot?.querySelector<HTMLElement>(
      `#${YOUTUBE_SNIPER_OVERLAY_MOUNT_ID}`
    )
    if (existingMount) {
      return existingMount
    }
  }

  const host = document.createElement("div")
  host.id = YOUTUBE_SNIPER_OVERLAY_HOST_ID
  host.style.position = "fixed"
  host.style.inset = "0"
  host.style.zIndex = "2147483647"
  host.style.pointerEvents = "auto"

  const shadowRoot = host.attachShadow({ mode: "open" })
  const style = document.createElement("style")
  style.textContent = shadowCssText
  shadowRoot.appendChild(style)
  const mount = document.createElement("div")
  mount.id = YOUTUBE_SNIPER_OVERLAY_MOUNT_ID
  shadowRoot.appendChild(mount)

  const parent = document.body ?? document.documentElement
  parent.appendChild(host)

  sniperOverlayHost = host
  return mount
}

function closeYouTubeTranscriptPanelsInPage(): void {
  const transcriptPanelSelectors = [
    'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
    "ytd-transcript-search-panel-renderer",
    "ytd-transcript-renderer"
  ] as const

  for (const selector of transcriptPanelSelectors) {
    let panels: HTMLElement[] = []
    try {
      panels = Array.from(document.querySelectorAll<HTMLElement>(selector))
    } catch {
      continue
    }

    for (const panel of panels) {
      const panelRoot =
        (panel.closest("ytd-engagement-panel-section-list-renderer") as HTMLElement | null) ?? panel
      panelRoot.dataset.minddockTranscriptSuppressed = "true"
      panelRoot.style.position = "fixed"
      panelRoot.style.top = "-10000px"
      panelRoot.style.left = "-10000px"
      panelRoot.style.opacity = "0"
      panelRoot.style.pointerEvents = "none"
      panelRoot.style.zIndex = "-1"
    }
  }
}

function restoreYouTubeTranscriptPanelsInPage(): void {
  const suppressedPanels = Array.from(
    document.querySelectorAll<HTMLElement>('[data-minddock-transcript-suppressed="true"]')
  )
  for (const panel of suppressedPanels) {
    delete panel.dataset.minddockTranscriptSuppressed
    panel.style.position = ""
    panel.style.top = ""
    panel.style.left = ""
    panel.style.opacity = ""
    panel.style.pointerEvents = ""
    panel.style.zIndex = ""
  }
}

function startYouTubeTranscriptSuppressor(): void {
  if (youtubeTranscriptSuppressorStop) {
    return
  }

  let disposed = false
  let frameId: number | null = null
  const runClose = (): void => {
    if (disposed || frameId !== null) {
      return
    }
    frameId = window.requestAnimationFrame(() => {
      frameId = null
      if (disposed) {
        return
      }
      closeYouTubeTranscriptPanelsInPage()
    })
  }

  runClose()

  const observer = new MutationObserver(() => {
    runClose()
  })
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true })
  }

  const intervalId = window.setInterval(runClose, 250)

  youtubeTranscriptSuppressorStop = () => {
    disposed = true
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId)
      frameId = null
    }
    observer.disconnect()
    window.clearInterval(intervalId)
    youtubeTranscriptSuppressorStop = null
  }
}

function closeSniperOverlay(): void {
  youtubeTranscriptSuppressorStop?.()
  restoreYouTubeTranscriptPanelsInPage()
  if (sniperOverlayRoot) {
    sniperOverlayRoot.unmount()
    sniperOverlayRoot = null
  }
  if (sniperOverlayHost) {
    sniperOverlayHost.remove()
    sniperOverlayHost = null
  }
}

function openSniperOverlay(): void {
  closeYouTubeTranscriptPanelsInPage()
  startYouTubeTranscriptSuppressor()
  const mount = ensureSniperOverlayMount()
  if (!sniperOverlayRoot) {
    sniperOverlayRoot = createRoot(mount)
  }

  sniperOverlayRoot.render(
    <SniperOverlay onClose={closeSniperOverlay} getDefaultNotebookId={() => sniperDefaultNotebookId} />
  )
}

function buildYouTubeSniperButton(template: HTMLElement): HTMLElement {
  const clone = template.cloneNode(true) as HTMLElement
  clone.id = YOUTUBE_SNIPER_BUTTON_ID
  clone.setAttribute(YOUTUBE_SNIPER_BUTTON_ATTRIBUTE, "true")
  clone.removeAttribute("data-command")
  clone.removeAttribute("data-tooltip-target-id")
  clone.setAttribute("aria-label", "NotebookLM")
  clone.setAttribute("title", "NotebookLM")

  const button = clone.querySelector("button, a") as HTMLElement | null
  const clickTarget = button ?? clone
  if (button) {
    button.setAttribute("aria-label", "NotebookLM")
    button.setAttribute("title", "NotebookLM")
    button.removeAttribute("aria-pressed")
    if (button instanceof HTMLButtonElement) {
      button.type = "button"
      button.disabled = false
    }
    if (button instanceof HTMLAnchorElement) {
      button.removeAttribute("href")
      button.removeAttribute("target")
    }
  }

  updateYouTubeButtonLabel(clone, "NotebookLM")
  updateYouTubeButtonIcon(clone)
  normalizeYouTubeSniperButtonAlignment(clone, clickTarget)
  attachYouTubeSniperOpenHandler(clickTarget)

  return clone
}

function injectYouTubeSniperButton(): void {
  let actionBar = resolveYouTubeActionBar()
  let shareAnchor = actionBar ? resolveYouTubeShareAnchor(actionBar) : null
  if (!shareAnchor) {
    const globalWatchRoot = resolveYouTubeWatchRoot()
    shareAnchor = resolveYouTubeShareAnchor(globalWatchRoot)
  }

  const insertionAnchor = shareAnchor ? resolveYouTubeButtonWrapper(shareAnchor) ?? shareAnchor : null

  if (!actionBar && insertionAnchor?.parentElement instanceof HTMLElement) {
    actionBar = insertionAnchor.parentElement
  }

  if (!actionBar) {
    return
  }

  const allSniperButtons = Array.from(document.querySelectorAll<HTMLElement>(`[${YOUTUBE_SNIPER_BUTTON_ATTRIBUTE}]`))
  const existingSniperInActionBar =
    allSniperButtons.find((button) => actionBar.contains(button)) ??
    allSniperButtons.find((button) => button.isConnected) ??
    null

  let usableExistingSniper = existingSniperInActionBar
  if (usableExistingSniper && !usableExistingSniper.hasAttribute(YOUTUBE_SNIPER_FALLBACK_ATTRIBUTE)) {
    usableExistingSniper.remove()
    usableExistingSniper = null
  }

  for (const button of allSniperButtons) {
    if (button !== usableExistingSniper) {
      button.remove()
    }
  }

  const sniperButton = usableExistingSniper ?? buildYouTubeSniperFallbackButton()
  ensureYouTubeButtonGap(sniperButton, actionBar, insertionAnchor)

  if (insertionAnchor?.parentElement) {
    if (sniperButton.parentElement !== insertionAnchor.parentElement || sniperButton.nextElementSibling !== insertionAnchor) {
      insertionAnchor.parentElement.insertBefore(sniperButton, insertionAnchor)
    }
    return
  }

  if (sniperButton.parentElement !== actionBar) {
    actionBar.appendChild(sniperButton)
  }
}

function removeYouTubeSniperButton(): void {
  document.querySelectorAll(`[${YOUTUBE_SNIPER_BUTTON_ATTRIBUTE}]`).forEach((element) => {
    element.remove()
  })
}

function isYouTubeHostUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).hostname.toLowerCase().endsWith("youtube.com")
  } catch {
    return window.location.hostname.toLowerCase().endsWith("youtube.com")
  }
}

function startYouTubeSniperHardGuard(): void {
  if (youtubeSniperHardGuardStop || !isYouTubeHostUrl(window.location.href)) {
    return
  }

  let disposed = false
  let frameId: number | null = null

  const ensureSniperForCurrentRoute = (): void => {
    if (disposed || frameId !== null) {
      return
    }

    frameId = window.requestAnimationFrame(() => {
      frameId = null
      if (disposed) {
        return
      }

      if (!isYouTubeWatchUrl(window.location.href)) {
        removeYouTubeSniperButton()
        closeSniperOverlay()
        return
      }

      try {
        injectYouTubeSniperButton()
      } catch {
        // no-op
      }
    })
  }

  ensureSniperForCurrentRoute()

  const observer = new MutationObserver(() => {
    ensureSniperForCurrentRoute()
  })
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true })
  }

  const intervalId = window.setInterval(ensureSniperForCurrentRoute, 900)
  const navigationEvents = ["yt-navigate-finish", "yt-page-data-fetched", URL_CHANGE_EVENT, "popstate"]
  const navigationHandler = (): void => {
    ensureSniperForCurrentRoute()
  }
  navigationEvents.forEach((eventName) => {
    window.addEventListener(eventName, navigationHandler as EventListener)
  })

  youtubeSniperHardGuardStop = () => {
    disposed = true
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId)
      frameId = null
    }
    observer.disconnect()
    window.clearInterval(intervalId)
    navigationEvents.forEach((eventName) => {
      window.removeEventListener(eventName, navigationHandler as EventListener)
    })
    youtubeSniperHardGuardStop = null
  }
}

function isLinkedInSuggestionsHeadingText(value: string): boolean {
  const key = normalizeTitleComparisonKey(value)
  if (!key) {
    return false
  }

  return (
    key.includes("sugestoes") ||
    key.includes("sugestoes para voce") ||
    key.includes("add to your feed") ||
    key.includes("recommended for you") ||
    key.includes("recomendacoes para voce") ||
    key.includes("people you may know") ||
    key.includes("pessoas que talvez voce conheca")
  )
}

function resolveLinkedInSuggestionsAnchor(): HTMLElement | null {
  const rightRail = queryFirstVisibleElement([
    "div[data-view-name='feed-main-feed-right-rail']",
    "aside.scaffold-layout__aside",
    "div.scaffold-layout__aside",
    "aside[aria-label*='Sugest']",
    "aside[aria-label*='feed']",
    "aside[aria-label*='Add to your feed']"
  ])

  if (!rightRail) {
    return null
  }

  let candidates: Element[] = []
  try {
    candidates = Array.from(
      rightRail.querySelectorAll("h1, h2, h3, h4, [role='heading'], [aria-level], span, div")
    ).slice(0, 220)
  } catch {
    candidates = []
  }

  for (const candidate of candidates) {
    if (!isVisibleElement(candidate)) {
      continue
    }

    const candidateText = normalizeString(candidate.textContent ?? "")
    if (!candidateText || candidateText.length > 64) {
      continue
    }

    if (!isLinkedInSuggestionsHeadingText(candidateText)) {
      continue
    }

    const headerContainer =
      (candidate.closest("header") as HTMLElement | null) ||
      (candidate.parentElement as HTMLElement | null) ||
      (candidate as HTMLElement)

    if (headerContainer && isVisibleElement(headerContainer)) {
      return headerContainer
    }
  }

  return rightRail
}

function resolveFallbackFloatingButtonPlacement(): FloatingButtonPlacement {
  return {
    style: {
      top: "24px",
      right: "24px"
    },
    menuAlign: "right"
  }
}

function resolveLeftOfAnchorPlacement(rect: DOMRect, gapPx: number): FloatingButtonPlacement {
  const minTop = 8
  const maxTop = Math.max(minTop, window.innerHeight - 52)
  const top = clampNumber(Math.round(rect.top), minTop, maxTop)
  const minLeft = 8
  const maxLeft = Math.max(minLeft, window.innerWidth - 8)
  const left = clampNumber(Math.round(rect.left), minLeft, maxLeft)

  if (left < 180) {
    const rightSideLeft = clampNumber(Math.round(rect.right + gapPx), minLeft, Math.max(minLeft, window.innerWidth - 220))
    return {
      style: {
        top: `${top}px`,
        left: `${rightSideLeft}px`
      },
      menuAlign: "left"
    }
  }

  return {
    style: {
      top: `${top}px`,
      left: `${left}px`,
      transform: `translateX(calc(-100% - ${gapPx}px))`
    },
    menuAlign: left < 440 ? "left" : "right"
  }
}

function resolveRightOfAnchorPlacement(rect: DOMRect, gapPx: number): FloatingButtonPlacement {
  const minTop = 8
  const maxTop = Math.max(minTop, window.innerHeight - 52)
  const top = clampNumber(Math.round(rect.top), minTop, maxTop)
  const minLeft = 8
  const maxLeft = Math.max(minLeft, window.innerWidth - 220)
  const left = clampNumber(Math.round(rect.right + gapPx), minLeft, maxLeft)

  return {
    style: {
      top: `${top}px`,
      left: `${left}px`
    },
    menuAlign: left < 440 ? "left" : "right"
  }
}

function resolveInlineAnchorPlacement(rect: DOMRect): FloatingButtonPlacement {
  const menuWidth = 352
  const menuHeight = 420
  const minLeft = 8
  const maxLeft = Math.max(minLeft, window.innerWidth - menuWidth - 8)
  const left = clampNumber(Math.round(rect.left), minLeft, maxLeft)
  const spaceBelow = window.innerHeight - rect.bottom
  const canOpenAbove = rect.top - 12 >= menuHeight
  const openAbove = spaceBelow < menuHeight && canOpenAbove
  const top = openAbove
    ? Math.max(8, Math.round(rect.top - 8))
    : Math.max(8, Math.round(rect.bottom + 8))

  return {
    style: {
      top: `${top}px`,
      left: `${left}px`
    },
    menuAlign: "left",
    menuVertical: openAbove ? "above" : "below"
  }
}

function resolvePlacementFromStrategy(strategy: ContentStrategy): FloatingButtonPlacement {
  return {
    style: strategy.getStyles(),
    menuAlign: strategy.getMenuAlign()
  }
}

function resolveFloatingButtonPlacement(currentUrl: string): FloatingButtonPlacement {
  try {
    const host = (() => {
      try {
        return new URL(currentUrl).hostname.toLowerCase()
      } catch {
        return window.location.hostname.toLowerCase()
      }
    })()

  if (host.includes("chat.openai.com") || host.includes("chatgpt.com")) {
    const anchor = queryFirstVisibleElement(["#conversation-header-actions"])
    if (anchor) {
      return resolveLeftOfAnchorPlacement(anchor.getBoundingClientRect(), 8)
    }
    return resolveFallbackFloatingButtonPlacement()
  }

  if (host.includes("gemini.google.com")) {
    const anchor = queryFirstVisibleElement([
      "div.right-section > div.buttons-container",
      "div.buttons-container"
    ])
    if (anchor) {
      const rect = anchor.getBoundingClientRect()
      const top = clampNumber(Math.round(rect.top), 8, Math.max(8, window.innerHeight - 52))
      const left = clampNumber(Math.round(rect.left), 8, Math.max(8, window.innerWidth - 220))
      return {
        style: {
          top: `${top}px`,
          left: `${left}px`
        },
        menuAlign: "left"
      }
    }
    return resolveFallbackFloatingButtonPlacement()
  }

  if (host.includes("claude.ai")) {
    const anchor = queryFirstVisibleElement(["header .right-3", "header [class*='right']"])
    if (anchor) {
      return resolveLeftOfAnchorPlacement(anchor.getBoundingClientRect(), 8)
    }
    return resolveFallbackFloatingButtonPlacement()
  }

  if (host.includes("perplexity.ai")) {
    const threadActionsButton = queryFirstVisibleElement([
      "button[aria-label='Thread actions']",
      "button[aria-label='AÃ§Ãµes da thread']"
    ])
    if (threadActionsButton) {
      const anchor = (threadActionsButton.closest("div[class*='gap-x-sm']") as HTMLElement | null) || threadActionsButton
      return resolveLeftOfAnchorPlacement(anchor.getBoundingClientRect(), 4)
    }
    return resolveFallbackFloatingButtonPlacement()
  }

  if (host.includes("docs.google.com")) {
    const shareButton = queryFirstVisibleElement(["#docs-titlebar-share-client-button"])
    if (shareButton) {
      return resolveLeftOfAnchorPlacement(shareButton.getBoundingClientRect(), 8)
    }
    return resolveFallbackFloatingButtonPlacement()
  }

  if (host.includes("linkedin.com")) {
    const suggestionsAnchor = resolveLinkedInSuggestionsAnchor()
    if (suggestionsAnchor) {
      const headerActionButton = queryFirstVisibleDescendant(suggestionsAnchor, [
        "button[aria-label*='Fechar']",
        "button[aria-label*='Close']",
        "button[aria-label*='Ocultar']",
        "button[aria-label*='Dismiss']",
        "button[aria-label*='Mais']",
        "button[aria-label*='More']",
        "button"
      ])

      if (headerActionButton) {
        return resolveLeftOfAnchorPlacement(headerActionButton.getBoundingClientRect(), 6)
      }

      const anchorRect = suggestionsAnchor.getBoundingClientRect()
      return resolveLeftOfAnchorPlacement(
        new DOMRect(anchorRect.right - 6, anchorRect.top, 1, Math.max(20, anchorRect.height)),
        6
      )
    }

    const actionBar = queryFirstVisibleElement([
      ".feed-shared-social-action-bar",
      ".feed-action-bar"
    ])
    if (actionBar) {
      const sendButton = queryFirstVisibleDescendant(actionBar, [
        "button.send-privately-button",
        "button[aria-label*='Send']",
        "button[aria-label*='send']",
        "button[aria-label*='Enviar']",
        "button[aria-label*='enviar']"
      ])
      if (sendButton) {
        return resolveLeftOfAnchorPlacement(sendButton.getBoundingClientRect(), 6)
      }

      const rect = actionBar.getBoundingClientRect()
      return resolveLeftOfAnchorPlacement(
        new DOMRect(rect.right - 8, rect.top, 1, rect.height),
        6
      )
    }
    return resolveFallbackFloatingButtonPlacement()
  }

  if (host.includes("reddit.com")) {
    const actionRow = queryFirstVisibleElement([
      "shreddit-post div[data-testid='action-row']",
      "div[data-testid='action-row']",
      ".shreddit-post-container",
      "[aria-label*='Actions available']"
    ])
    if (actionRow) {
      const awardButton = queryFirstVisibleDescendant(actionRow, [
        "award-button",
        "[slot='award-button']"
      ])
      if (awardButton) {
        return resolveRightOfAnchorPlacement(awardButton.getBoundingClientRect(), 6)
      }

      const shareButton = queryFirstVisibleDescendant(actionRow, [
        "[slot='share-button']",
        "button[aria-label*='Share']",
        "button[aria-label*='share']",
        "button[aria-label*='Compart']",
        "button[aria-label*='compart']"
      ])
      if (shareButton) {
        return resolveLeftOfAnchorPlacement(shareButton.getBoundingClientRect(), 6)
      }

      return resolveLeftOfAnchorPlacement(actionRow.getBoundingClientRect(), 6)
    }
    return resolveFallbackFloatingButtonPlacement()
  }

  if (host.includes("x.com") || host.includes("twitter.com")) {
    const backButton = queryFirstVisibleElement(["button[data-testid='app-bar-back']"])
    if (backButton) {
      const anchor =
        backButton.parentElement instanceof HTMLElement
          ? backButton.parentElement
          : backButton
      return resolveRightOfAnchorPlacement(anchor.getBoundingClientRect(), 8)
    }
    return resolveFallbackFloatingButtonPlacement()
  }

    return resolveFallbackFloatingButtonPlacement()
  } catch {
    return resolveFallbackFloatingButtonPlacement()
  }
}

function parseStatusIdFromUrl(value: string): string {
  const normalized = normalizeString(value)
  if (!normalized) {
    return ""
  }

  const match = normalized.match(/\/status\/(\d+)/i)
  return normalizeString(match?.[1])
}

function isXHostUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase()
    return host.includes("x.com") || host.includes("twitter.com")
  } catch {
    const host = window.location.hostname.toLowerCase()
    return host.includes("x.com") || host.includes("twitter.com")
  }
}

function shouldShowMindDockOnChatGptRoute(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.toLowerCase()
    const pathname = parsed.pathname || "/"

    const isChatGptHost = host === "chatgpt.com" || host.endsWith(".chatgpt.com")
    if (!isChatGptHost) {
      if (host.includes("chat.openai.com")) {
        return false
      }
      return true
    }

    return /^\/(?:c|g)(?:\/|$)/u.test(pathname)
  } catch {
    return true
  }
}

function shouldShowMindDockOnGeminiRoute(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.toLowerCase()

    if (!host.includes("gemini.google.com")) {
      return true
    }

    const pathname = parsed.pathname || "/"
    return /^\/(?:app|gem)\/[^/?#]+/u.test(pathname)
  } catch {
    return true
  }
}

function shouldShowMindDockOnGrokRoute(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.toLowerCase()

    const isGrokHost = host === "grok.com" || host.endsWith(".grok.com")
    if (!isGrokHost) {
      return true
    }

    const pathname = parsed.pathname || "/"
    return /^\/c\/[^/?#]+/u.test(pathname)
  } catch {
    return true
  }
}

function shouldShowMindDockOnGensparkRoute(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.toLowerCase()

    const isGensparkHost = host === "www.genspark.ai" || host === "genspark.ai"
    if (!isGensparkHost) {
      return true
    }

    const pathname = parsed.pathname || "/"
    const hasAgentId = normalizeString(parsed.searchParams.get("id"))

    return /^\/agents\/?$/u.test(pathname) && Boolean(hasAgentId)
  } catch {
    return true
  }
}

function shouldShowMindDockOnKimiRoute(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.toLowerCase()

    const isKimiHost = host === "www.kimi.com" || host === "kimi.com"
    if (!isKimiHost) {
      return true
    }

    const pathname = parsed.pathname || "/"
    return /^\/chat(?:\/|$)/u.test(pathname)
  } catch {
    return true
  }
}

function shouldShowMindDockOnOpenEvidenceRoute(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.toLowerCase()

    const isOpenEvidenceHost = host === "www.openevidence.com" || host === "openevidence.com"
    if (!isOpenEvidenceHost) {
      return true
    }

    const pathname = parsed.pathname || "/"
    return /^\/ask(?:\/|$)/u.test(pathname)
  } catch {
    return true
  }
}

function shouldShowMindDockOnXRoute(rawUrl: string): boolean {
  if (!shouldShowMindDockOnChatGptRoute(rawUrl)) {
    return false
  }

  if (!shouldShowMindDockOnGeminiRoute(rawUrl)) {
    return false
  }

  if (!shouldShowMindDockOnGrokRoute(rawUrl)) {
    return false
  }

  if (!shouldShowMindDockOnGensparkRoute(rawUrl)) {
    return false
  }

  if (!shouldShowMindDockOnKimiRoute(rawUrl)) {
    return false
  }

  if (!shouldShowMindDockOnOpenEvidenceRoute(rawUrl)) {
    return false
  }

  if (!isXHostUrl(rawUrl)) {
    return true
  }

  // No X/Twitter: mostrar somente em URL de post (/status/{id}).
  return Boolean(parseStatusIdFromUrl(rawUrl))
}

function isResyncDisabledForUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase()
    return (
      host.includes("linkedin.com") ||
      host.includes("reddit.com") ||
      host.includes("x.com") ||
      host.includes("twitter.com")
    )
  } catch {
    const host = window.location.hostname.toLowerCase()
    return (
      host.includes("linkedin.com") ||
      host.includes("reddit.com") ||
      host.includes("x.com") ||
      host.includes("twitter.com")
    )
  }
}

function parseXHandleFromUserText(value: string): string {
  const normalized = normalizeString(value)
  if (!normalized) {
    return ""
  }

  const handleMatch = normalized.match(/@([a-z0-9_]{1,15})/iu)
  return normalizeString(handleMatch?.[1]).toLowerCase()
}

function extractXHandleFromUserBlock(userBlock: Element | null): string {
  if (!userBlock) {
    return ""
  }

  const fromText = parseXHandleFromUserText((userBlock as HTMLElement).innerText || userBlock.textContent || "")
  if (fromText) {
    return fromText
  }

  const links = Array.from(userBlock.querySelectorAll("a[href^='/']"))
  for (const link of links) {
    const href = normalizeString((link as HTMLAnchorElement).getAttribute("href"))
    const match = href.match(/^\/([A-Za-z0-9_]{1,15})(?:\/|$)/u)
    const candidate = normalizeString(match?.[1]).toLowerCase()
    if (candidate && candidate !== "i" && candidate !== "home") {
      return candidate
    }
  }

  return ""
}

function extractXDisplayNameFromUserBlock(userBlock: Element | null): string {
  if (!userBlock) {
    return ""
  }

  const rawText = normalizeGenericCaptureText((userBlock as HTMLElement).innerText || userBlock.textContent || "")
  if (!rawText) {
    return ""
  }

  const lines = rawText
    .split("\n")
    .map((line) => normalizeString(line))
    .filter(Boolean)

  const nameLine = lines.find((line) => !line.startsWith("@"))
  return normalizeString(nameLine)
}

function extractXPermalinkFromTweet(tweet: Element): string {
  const links = Array.from(tweet.querySelectorAll("a[href*='/status/']"))

  for (const link of links) {
    const href = normalizeString((link as HTMLAnchorElement).href || (link as HTMLAnchorElement).getAttribute("href"))
    if (!href || !parseStatusIdFromUrl(href)) {
      continue
    }
    return href
  }

  return ""
}

function extractXTweetText(tweet: Element): string {
  const textFromNode = normalizeGenericCaptureText(
    (tweet.querySelector("div[data-testid='tweetText']") as HTMLElement | null)?.innerText || ""
  )
  if (textFromNode) {
    return textFromNode
  }

  const mediaHints = Array.from(tweet.querySelectorAll("img[alt]"))
    .map((imageNode) => normalizeString((imageNode as HTMLImageElement).alt))
    .filter(Boolean)

  const uniqueMediaHints = Array.from(new Set(mediaHints))
  if (tweet.querySelector("video")) {
    uniqueMediaHints.push("[Video]")
  }

  if (uniqueMediaHints.length > 0) {
    return normalizeGenericCaptureText(uniqueMediaHints.join("\n"))
  }

  return ""
}


function resolveXConversationTitleCandidate(text: string): string {
  const normalizedText = normalizeGenericCaptureText(text)
  if (!normalizedText) {
    return ""
  }

  const firstLine = normalizeString(normalizedText.split("\n")[0] || "")
  return firstLine.slice(0, 120)
}

function resolveXSourceTitleFromTweet(
  tweetText: string,
  displayName: string,
  handle: string,
  fallbackTitle = ""
): string {
  const normalizedHandle = normalizeString(handle).replace(/^@+/u, "").toLowerCase()
  const handleLabel = normalizedHandle ? `@${normalizedHandle}` : ""
  const authorTitle = normalizeString([normalizeString(displayName), handleLabel].filter(Boolean).join(" "))

  return resolveBestSourceTitle([
    resolveXConversationTitleCandidate(tweetText),
    authorTitle,
    handleLabel,
    normalizeString(fallbackTitle),
    resolveSafeCaptureTitle(),
    normalizeString(document.title),
    "Post do X"
  ])
}

function resolveXTitleFromConversation(conversation: Array<{ content: string }>): string {
  for (const message of conversation) {
    const normalizedContent = normalizeGenericCaptureText(stripMarkdownBoldFormatting(normalizeString(message?.content)))
    if (!normalizedContent) {
      continue
    }

    const lines = normalizedContent.split("\n")
    for (const rawLine of lines) {
      const line = normalizeString(stripMarkdownBoldFormatting(rawLine))
      if (!line) {
        continue
      }

      const comparison = normalizeTitleComparisonKey(line)
      if (!comparison) {
        continue
      }

      if (
        comparison.startsWith("source:") ||
        comparison.startsWith("author:") ||
        comparison.startsWith("post by") ||
        comparison.startsWith("usuario:") ||
        /^\[\d+\/\d+\]$/u.test(comparison) ||
        /^https?:\/\//u.test(comparison)
      ) {
        continue
      }

      return line.slice(0, 120)
    }
  }

  return ""
}

function resolveXTitleFromUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    const pathname = normalizeString(parsed.pathname || "")
    const statusMatch = pathname.match(/^\/?([A-Za-z0-9_]{1,15})\/status\/\d+/u)
    if (statusMatch?.[1]) {
      return `Post de @${statusMatch[1].toLowerCase()}`
    }

    const profileMatch = pathname.match(/^\/?([A-Za-z0-9_]{1,15})\/?$/u)
    if (profileMatch?.[1]) {
      return `Perfil @${profileMatch[1].toLowerCase()}`
    }
  } catch {
    // no-op
  }

  return ""
}

function findPrimaryXTweetArticle(root: ParentNode = document): Element | null {
  const statusIdFromUrl = parseStatusIdFromUrl(window.location.href)
  const tweets = Array.from(root.querySelectorAll("article[data-testid='tweet']")).filter(isVisibleElement)
  if (tweets.length === 0) {
    return null
  }

  if (statusIdFromUrl) {
    for (const tweet of tweets) {
      const permalink = extractXPermalinkFromTweet(tweet)
      if (parseStatusIdFromUrl(permalink) === statusIdFromUrl) {
        return tweet
      }
    }
  }

  return tweets[0] || null
}

function isXSideConversationReply(tweet: Element, opHandle: string): boolean {
  const normalizedOpHandle = normalizeString(opHandle).toLowerCase()
  if (!normalizedOpHandle) {
    return false
  }

  const text = normalizeGenericCaptureText((tweet as HTMLElement).innerText || tweet.textContent || "").toLowerCase()
  if (!text) {
    return false
  }

  const hasReplyContext =
    text.includes("replying to") ||
    text.includes("respondendo a") ||
    text.includes("em resposta a") ||
    text.includes("respondiendo a")

  if (!hasReplyContext) {
    return false
  }

  const mentions = Array.from(text.matchAll(/@([a-z0-9_]{1,15})/giu))
    .map((match) => normalizeString(match[1]).toLowerCase())
    .filter(Boolean)

  return mentions.some((mention) => mention !== normalizedOpHandle)
}

function extractGoogleDocIdFromValue(value: string): string {
  const normalized = normalizeString(value)
  if (!normalized) {
    return ""
  }

  const urlMatch = normalized.match(/\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/u)
  if (urlMatch?.[1]) {
    return normalizeString(urlMatch[1])
  }

  if (/^[A-Za-z0-9_-]{20,}$/u.test(normalized)) {
    return normalized
  }

  return ""
}

function resolveGoogleDocsSourceTitle(): string {
  const titleCandidates: string[] = [
    normalizeString((document.querySelector("input.docs-title-input") as HTMLInputElement | null)?.value),
    normalizeString(document.querySelector("meta[property='og:title']")?.getAttribute("content")),
    normalizeString(document.title)
  ]

  for (const candidate of titleCandidates) {
    const sanitized = sanitizeSourceTitleCandidate(
      candidate
        .replace(/\s*-\s*Google Docs$/i, "")
        .replace(/\s*\|\s*Google Docs$/i, "")
        .trim()
    )
    if (sanitized && !isGenericSourceTitle(sanitized)) {
      return sanitized.slice(0, 120)
    }
  }

  for (const candidate of titleCandidates) {
    const sanitized = sanitizeSourceTitleCandidate(
      candidate
        .replace(/\s*-\s*Google Docs$/i, "")
        .replace(/\s*\|\s*Google Docs$/i, "")
        .trim()
    )
    if (sanitized) {
      return sanitized.slice(0, 120)
    }
  }

  return `Documento ${new Date().toLocaleDateString("pt-BR")}`
}

function isLikelyGoogleDocsUiNoiseLine(value: string): boolean {
  const normalized = normalizeString(value)
  if (!normalized) {
    return true
  }

  if (/^\d{1,4}$/u.test(normalized) || /^\d{1,3}%$/u.test(normalized)) {
    return true
  }

  return /^(menus?|arquivo|editar|exibir|inserir|formatar|ferramentas|extensoes|ajuda|file|edit|view|insert|format|tools|extensions|help)$/iu.test(
    normalized
  )
}

function sanitizeGoogleDocsBodyText(rawValue: string): string {
  const normalized = normalizeGenericCaptureText(rawValue)
  if (!normalized) {
    return ""
  }

  const lines = normalized.split("\n")
  const output: string[] = []
  let previousLineKey = ""

  for (const rawLine of lines) {
    const line = normalizeGenericCaptureText(rawLine)
    if (!line || isLikelyGoogleDocsUiNoiseLine(line)) {
      continue
    }

    const lineKey = normalizeTitleComparisonKey(line)
    if (!lineKey || lineKey === previousLineKey) {
      continue
    }

    previousLineKey = lineKey
    output.push(line)
  }

  return normalizeGenericCaptureText(output.join("\n"))
}

function resolveGoogleDocsBodyText(): string {
  const lineSelectors = [
    ".kix-page-paginated .kix-lineview-content",
    ".kix-page-paginated .kix-lineview-text-block",
    ".kix-page-content-wrapper .kix-lineview-content",
    ".kix-page-content-wrapper .kix-lineview-text-block",
    ".kix-appview-editor .kix-lineview-content"
  ] as const
  const fallbackSelectors = [
    "div[role='textbox']",
    ".kix-page-content-wrapper",
    ".kix-appview-editor",
    "#docs-editor"
  ] as const
  const collectedLines: string[] = []
  const seenLines = new Set<string>()

  for (const selector of lineSelectors) {
    let nodes: Element[] = []
    try {
      nodes = Array.from(document.querySelectorAll(selector))
    } catch {
      continue
    }

    for (const node of nodes) {
      if (!isVisibleElement(node)) {
        continue
      }
      const text = sanitizeGoogleDocsBodyText((node as HTMLElement).innerText || node.textContent || "")
      if (!text) {
        continue
      }
      const lineKey = normalizeTitleComparisonKey(text)
      if (!lineKey || seenLines.has(lineKey)) {
        continue
      }
      seenLines.add(lineKey)
      collectedLines.push(text)
    }
  }

  const lineText = sanitizeGoogleDocsBodyText(collectedLines.join("\n"))
  if (lineText.length >= 120) {
    return lineText
  }

  const fallbackCandidates: string[] = []
  for (const selector of fallbackSelectors) {
    let nodes: Element[] = []
    try {
      nodes = Array.from(document.querySelectorAll(selector)).slice(0, 3)
    } catch {
      continue
    }
    for (const node of nodes) {
      if (!isVisibleElement(node)) {
        continue
      }
      const text = sanitizeGoogleDocsBodyText((node as HTMLElement).innerText || node.textContent || "")
      if (text.length > 0) {
        fallbackCandidates.push(text)
      }
    }
  }

  const bestFallback = fallbackCandidates.sort((left, right) => right.length - left.length)[0] || ""
  return bestFallback || lineText
}

function buildGoogleDocsPreparedCapture(currentUrl: string): PreparedCapturePayload {
  const documentIdCandidates = [
    extractGoogleDocIdFromValue(currentUrl),
    extractGoogleDocIdFromValue(
      normalizeString(document.querySelector("meta[property='og:url']")?.getAttribute("content"))
    ),
    extractGoogleDocIdFromValue(
      normalizeString(document.querySelector("meta[itemprop='url']")?.getAttribute("content"))
    ),
    extractGoogleDocIdFromValue(
      normalizeString(document.querySelector("meta[itemprop='embedURL']")?.getAttribute("content"))
    ),
    extractGoogleDocIdFromValue(
      normalizeString(document.querySelector("link[rel='canonical']")?.getAttribute("href"))
    )
  ]
  const documentId = documentIdCandidates.find((candidate) => candidate.length > 0) || ""
  const sourceTitle = resolveGoogleDocsSourceTitle()
  if (!documentId) {
    throw new Error("Nao foi possivel identificar o ID do Google Docs nesta URL.")
  }

  return {
    sourceKind: "doc",
    sourcePlatform: "doc",
    sourceTitle,
    conversation: [
      {
        role: "document",
        content: documentId
      }
    ]
  }
}

function decodeURIComponentSafely(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function resolveLinkedInUrnFromUrl(rawUrl: string): string {
  const normalizedUrl = normalizeString(rawUrl)
  if (!normalizedUrl) {
    return ""
  }

  try {
    const parsed = new URL(normalizedUrl, window.location.origin)
    const pathMatch = parsed.pathname.match(/\/feed\/update\/([^/?#]+)/iu)
    if (pathMatch?.[1]) {
      return normalizeString(decodeURIComponentSafely(pathMatch[1]))
    }

    const queryCandidates = [
      parsed.searchParams.get("updateUrn"),
      parsed.searchParams.get("activityUrn"),
      parsed.searchParams.get("miniProfileUrn")
    ]
    for (const candidate of queryCandidates) {
      const decodedCandidate = normalizeString(decodeURIComponentSafely(normalizeString(candidate)))
      if (decodedCandidate) {
        return decodedCandidate
      }
    }
  } catch {
    return ""
  }

  return ""
}

function resolveLinkedInAbsoluteUrl(rawHref: string, fallbackUrl: string): string {
  const normalizedHref = normalizeString(rawHref)
  if (!normalizedHref) {
    return fallbackUrl
  }

  try {
    const absoluteUrl = new URL(normalizedHref, "https://www.linkedin.com")
    absoluteUrl.hash = ""
    return absoluteUrl.toString()
  } catch {
    return fallbackUrl
  }
}

function resolveLinkedInPostUrn(postRoot: Element): string {
  const attributeCandidates = [
    postRoot.getAttribute("data-urn"),
    postRoot.getAttribute("data-id"),
    postRoot.getAttribute("id")
  ]
  for (const attributeCandidate of attributeCandidates) {
    const normalizedCandidate = normalizeString(attributeCandidate)
    if (!normalizedCandidate) {
      continue
    }

    const decodedCandidate = decodeURIComponentSafely(normalizedCandidate)
    if (decodedCandidate.includes("urn:li:")) {
      return decodedCandidate
    }

    const numericMatch = decodedCandidate.match(/(\d{8,})/u)
    if (numericMatch?.[1]) {
      return normalizeString(numericMatch[1])
    }
  }

  const postPermalink = normalizeString(
    postRoot.querySelector("a[href*='/feed/update/'], a[href*='/posts/'], a[href*='/activity-']")?.getAttribute("href")
  )
  const urnFromPermalink = resolveLinkedInUrnFromUrl(postPermalink)
  return urnFromPermalink
}

function isLinkedInSponsoredPost(postRoot: Element): boolean {
  const markerSelectors = [
    "[data-test-id='social-sponsored-label']",
    ".update-components-actor__sub-description",
    ".feed-shared-actor__sub-description",
    "span[aria-label*='Promoted']",
    "span[aria-label*='Patrocinado']"
  ] as const

  const markerText = normalizeGenericCaptureText(
    markerSelectors
      .map((selector) => normalizeString(postRoot.querySelector(selector)?.textContent ?? ""))
      .join("\n")
  ).toLowerCase()

  if (/\b(promoted|patrocinado)\b/iu.test(markerText)) {
    return true
  }

  return false
}

function sanitizeLinkedInPostText(rawValue: string): string {
  const normalized = normalizeGenericCaptureText(rawValue)
  if (!normalized) {
    return ""
  }

  const noiseLinePatterns = [
    /^(like|curtir|comment|comentar|repost|republicar|share|compartilhar|send|enviar|follow|seguir)$/iu,
    /^[0-9.,]+\s*(reactions?|reacoes?|comments?|comentarios?|reposts?)$/iu,
    /^(promoted|patrocinado)$/iu,
    /^(\.\.\.|â€¦)\s*(more|mais)$/iu,
    /^(ver|mostrar)\s+mais$/iu,
    /^see\s+more$/iu
  ]

  const rawLines = normalized
    .split("\n")
    .map((line) => normalizeString(line))
    .filter((line) => line.length > 0 && !noiseLinePatterns.some((pattern) => pattern.test(line)))

  const hasLongHashtagLine = rawLines.some((line) => /^#\S+(?:\s+#\S+)+$/u.test(line))
  const lines = hasLongHashtagLine
    ? rawLines.filter((line) => !/^#\S+$/u.test(line))
    : rawLines

  const deduped: string[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const lineKey = normalizeTitleComparisonKey(line)
    if (!lineKey || seen.has(lineKey)) {
      continue
    }
    seen.add(lineKey)
    deduped.push(line)
  }

  return normalizeGenericCaptureText(deduped.join("\n"))
}

function sanitizeLinkedInCaptureText(rawValue: string): string {
  const normalized = normalizeGenericCaptureText(rawValue)
  if (!normalized) {
    return ""
  }

  const noiseLinePatterns = [
    /^(like|curtir|gostar|comment|comentar|repost|republicar|share|compartilhar|send|enviar|follow|seguir)$/iu,
    /^(gostar|comentar|compartilhar|enviar)(\s+(gostar|comentar|compartilhar|enviar))*$/iu,
    /^[0-9.,]+\s*(reactions?|reacoes?|comments?|comentarios?|reposts?|compartilhamentos?)$/iu,
    /^(promoted|patrocinado)$/iu
  ]

  const cleanedLines = normalized
    .split("\n")
    .map((line) => normalizeString(line))
    .filter((line) => line.length > 0 && !noiseLinePatterns.some((pattern) => pattern.test(line)))

  const joinedText = normalizeGenericCaptureText(cleanedLines.join("\n"))
  if (!joinedText) {
    return ""
  }

  let formattedText = joinedText
  formattedText = formattedText.replace(/([^\n])\s+(ðŸ”¹|ðŸ”¸|âœ…|âœ”ï¸|â˜‘ï¸|ðŸ‘‰|â€¢)\s+/gu, "$1\n$2 ")
  formattedText = formattedText.replace(/([^\n])\s+(ðŸ’¡|ðŸ› ï¸|âš ï¸|ðŸ“Œ|ðŸ“)\s+/gu, "$1\n\n$2 ")
  formattedText = formattedText.replace(/([^\n])\s+(#(?:[\p{L}\p{N}_]+))/gu, "$1\n$2")
  formattedText = formattedText.replace(/\n{3,}/g, "\n\n")

  return normalizeGenericCaptureText(formattedText)
}

function sanitizeLinkedInAuthorCandidate(rawValue: string): string {
  const normalizedValue = sanitizeLinkedInPostText(rawValue)
  if (!normalizedValue) {
    return ""
  }

  const firstLine = normalizeString(normalizedValue.split("\n")[0] || "")
  if (!firstLine) {
    return ""
  }

  const withoutMetaTail = normalizeString(firstLine.replace(/\s*[Â·â€¢|].*$/u, ""))
  const withoutFollow = normalizeString(withoutMetaTail.replace(/\b(seguir|follow)\b/giu, ""))
  if (!withoutFollow) {
    return ""
  }

  if (/^(like|curtir|comment|comentar|share|compartilhar|send|enviar|repost|republicar)$/iu.test(withoutFollow)) {
    return ""
  }

  return withoutFollow.slice(0, 120)
}

function resolveLinkedInAuthorName(postRoot: Element): string {
  const authorSelectors = [
    ".update-components-actor__title span[aria-hidden='true']",
    ".update-components-actor__title",
    ".update-components-actor__name span[aria-hidden='true']",
    ".update-components-actor__name span[aria-hidden='true']",
    ".feed-shared-actor__title span[aria-hidden='true']",
    ".feed-shared-actor__title",
    ".feed-shared-actor__name span[aria-hidden='true']",
    "[data-view-name='feed-header'] a[href*='/in/'] span[aria-hidden='true']",
    "[data-view-name='feed-header'] a[href*='/company/'] span[aria-hidden='true']",
    "[data-view-name='feed-header-text'] strong",
    "a[href*='/in/'] span[aria-hidden='true']",
    "a[href*='/in/']",
    "a[href*='/company/'] span[aria-hidden='true']",
    "a[href*='/company/']"
  ] as const

  for (const selector of authorSelectors) {
    const authorName = sanitizeLinkedInAuthorCandidate(
      normalizeString((postRoot.querySelector(selector) as HTMLElement | null)?.innerText || "")
    )
    if (authorName) {
      return authorName
    }
  }

  const fallbackLinks = Array.from(
    postRoot.querySelectorAll<HTMLAnchorElement>("a[href*='/in/'], a[href*='/company/']")
  ).slice(0, 8)
  for (const link of fallbackLinks) {
    const candidate = sanitizeLinkedInAuthorCandidate(link.innerText || link.textContent || "")
    if (candidate) {
      return candidate
    }
  }

  return ""
}

function resolveLinkedInPostBody(postRoot: Element): string {
  const contentSelectors = [
    "[data-view-name='feed-commentary']",
    "[data-test-id='main-feed-activity-card__commentary']",
    ".update-components-update-v2__commentary",
    ".update-components-text",
    ".feed-shared-inline-show-more-text",
    ".feed-shared-text",
    ".feed-shared-update-v2__commentary",
    "[data-testid='expandable-text-box']",
    ".feed-shared-update-v2__description"
  ] as const

  const contentCandidates: string[] = []
  const seen = new Set<string>()
  for (const selector of contentSelectors) {
    let nodes: Element[] = []
    try {
      nodes = Array.from(postRoot.querySelectorAll(selector)).slice(0, 4)
    } catch {
      continue
    }

    for (const node of nodes) {
      const content = sanitizeLinkedInPostText((node as HTMLElement).innerText || node.textContent || "")
      const contentKey = normalizeTitleComparisonKey(content)
      if (content.length >= 8 && contentKey && !seen.has(contentKey)) {
        seen.add(contentKey)
        contentCandidates.push(content)
      }
    }
  }

  const mergedContent = sanitizeLinkedInPostText(contentCandidates.join("\n\n"))
  if (mergedContent.length >= 8) {
    return mergedContent
  }

  const clonedRoot = postRoot.cloneNode(true) as HTMLElement
  const discardSelectors = [
    ".feed-shared-social-action-bar",
    ".feed-action-bar",
    "[data-test-id='social-actions']",
    "[role='toolbar']",
    "button",
    "svg",
    "script",
    "style"
  ] as const
  for (const discardSelector of discardSelectors) {
    clonedRoot.querySelectorAll(discardSelector).forEach((node) => node.remove())
  }

  return sanitizeLinkedInPostText(clonedRoot.innerText || clonedRoot.textContent || "")
}

function resolveLinkedInFallbackPostContent(postRoot: Element): string {
  const rootText = sanitizeLinkedInCaptureText((postRoot as HTMLElement).innerText || postRoot.textContent || "")
  if (rootText.length > 0) {
    return rootText
  }

  const imageDescriptions = Array.from(postRoot.querySelectorAll<HTMLImageElement>("img[alt]"))
    .map((image) => normalizeString(image.getAttribute("alt") || ""))
    .filter((value) => value.length > 0)
  const normalizedImageDescriptions = sanitizeLinkedInCaptureText(imageDescriptions.join("\n"))
  if (normalizedImageDescriptions.length > 0) {
    return normalizedImageDescriptions
  }

  return ""
}

function resolveLinkedInSourceUrl(postRoot: Element, currentUrl: string): string {
  const permalinkSelectors = [
    "a[href*='/feed/update/urn:li:activity:']",
    "a[href*='updateUrn=urn:li:activity:']",
    "a[href*='activityUrn=urn:li:activity:']",
    "a[href*='/feed/update/']",
    "a[href*='/posts/']",
    "a[href*='/activity-']",
    "a.update-components-actor__meta-link",
    "a.feed-shared-actor__container-link"
  ] as const

  for (const selector of permalinkSelectors) {
    const anchor = postRoot.querySelector(selector)
    const href = normalizeString(anchor?.getAttribute("href") || "")
    if (!href) {
      continue
    }

    const absoluteUrl = resolveLinkedInAbsoluteUrl(href, currentUrl)
    if (absoluteUrl.includes("/feed/update/") || absoluteUrl.includes("/posts/") || absoluteUrl.includes("/activity-")) {
      return absoluteUrl
    }
  }

  const postUrn = resolveLinkedInPostUrn(postRoot)
  if (postUrn) {
    const activityIdMatch = postUrn.match(/(\d{8,})/u)
    const normalizedUrn = postUrn.includes("urn:li:activity:")
      ? postUrn
      : activityIdMatch?.[1]
      ? `urn:li:activity:${activityIdMatch[1]}`
      : postUrn
    return `https://www.linkedin.com/feed/update/${normalizedUrn}/`
  }

  return currentUrl
}

const LINKEDIN_CAPTURE_ROOT_FALLBACK_SELECTORS = [
  "div[data-finite-scroll-hotkey-item]",
  ".fie-impression-container",
  "div[data-view-name='feed-full-update']",
  "article"
] as const

const LINKEDIN_CAPTURE_AUTHOR_SELECTORS = ["[data-view-name='feed-header-text']"] as const

const LINKEDIN_CAPTURE_CONTENT_SELECTORS = [
  "[data-view-name='feed-commentary']",
  "[data-testid='expandable-text-box']",
  ".update-components-update-v2__commentary",
  ".update-components-text",
  ".feed-shared-inline-show-more-text",
  ".feed-shared-text",
  ".feed-shared-update-v2__commentary",
  ".feed-shared-update-v2__description"
] as const

function extractLinkedInVisibleText(element: Element | null): string {
  if (!element) {
    return ""
  }

  return sanitizeLinkedInCaptureText((element as HTMLElement).innerText || element.textContent || "")
}

function resolveLinkedInCaptureAuthor(postRoot: Element): string {
  for (const selector of LINKEDIN_CAPTURE_AUTHOR_SELECTORS) {
    const direct = extractLinkedInVisibleText(postRoot.querySelector(selector))
    if (direct) {
      return direct.split("\n")[0] || direct
    }
  }

  const fallbackAuthor = resolveLinkedInAuthorName(postRoot)
  return fallbackAuthor || "Desconhecido"
}

function resolveLinkedInCapturePostContent(postRoot: Element): string {
  for (const selector of LINKEDIN_CAPTURE_CONTENT_SELECTORS) {
    const nodes = Array.from(postRoot.querySelectorAll(selector)).slice(0, 3)
    for (const node of nodes) {
      const content = extractLinkedInVisibleText(node)
      if (content) {
        return content
      }
    }
  }

  return (
    extractLinkedInVisibleText(postRoot) ||
    sanitizeLinkedInCaptureText(resolveLinkedInPostBody(postRoot)) ||
    resolveLinkedInFallbackPostContent(postRoot)
  )
}

function resolveLinkedInCaptureRootNearViewport(): HTMLElement | null {
  let bestCandidate: HTMLElement | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  const viewportCenter = window.innerHeight / 2

  for (const selector of LINKEDIN_CAPTURE_ROOT_FALLBACK_SELECTORS) {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((node) => isVisibleElement(node))
    for (const node of nodes.slice(0, 120)) {
      const text = resolveLinkedInCapturePostContent(node)
      if (!text) {
        continue
      }

      const rect = node.getBoundingClientRect()
      const distance = Math.abs(rect.top + rect.height / 2 - viewportCenter)
      if (distance < bestDistance) {
        bestDistance = distance
        bestCandidate = node
      }
    }

    if (bestCandidate) {
      return bestCandidate
    }
  }

  return null
}

function resolveLinkedInPostRootFromTriggerElement(triggerElement: HTMLElement | null): HTMLElement | null {
  if (!triggerElement || !triggerElement.isConnected) {
    return null
  }

  const strictSelectors = [
    "div[data-urn*='activity']",
    "div[data-id*='activity']",
    "article[data-urn*='activity']",
    "article[data-id*='activity']",
    "div[data-finite-scroll-hotkey-item]",
    "article[data-finite-scroll-hotkey-item]",
    "div.fie-impression-container",
    "article.fie-impression-container",
    ".feed-shared-update-v2",
    ".occludable-update",
    "article[data-view-name='feed-full-update']",
    "article[data-view-name='feed-reshare']",
    "article[class*='feed-shared-update']"
  ] as const

  for (const selector of strictSelectors) {
    const candidate = triggerElement.closest(selector) as HTMLElement | null
    if (!candidate || !candidate.isConnected || !isVisibleElement(candidate)) {
      continue
    }

    const rect = candidate.getBoundingClientRect()
    if (rect.width < 220 || rect.height < 100) {
      continue
    }

    return candidate
  }

  const broadSelectors = ["article[role='article']", "div[role='article']", ...LINKEDIN_CAPTURE_ROOT_FALLBACK_SELECTORS, "section"] as const
  for (const selector of broadSelectors) {
    const candidate = triggerElement.closest(selector) as HTMLElement | null
    if (!candidate || !candidate.isConnected || !isVisibleElement(candidate)) {
      continue
    }

    const rect = candidate.getBoundingClientRect()
    if (rect.width < 220 || rect.height < 100) {
      continue
    }

    const text = sanitizeLinkedInPostText(candidate.innerText || candidate.textContent || "")
    if (text.length < 30) {
      continue
    }

    return candidate
  }

  let cursor: HTMLElement | null = triggerElement.parentElement
  for (let depth = 0; depth < 14 && cursor; depth += 1) {
    if (!cursor.isConnected || !isVisibleElement(cursor)) {
      cursor = cursor.parentElement
      continue
    }

    const rect = cursor.getBoundingClientRect()
    if (rect.width < 220 || rect.height < 100 || rect.width > 1600 || rect.height > 5000) {
      cursor = cursor.parentElement
      continue
    }

    const hasPostSignals = Boolean(
      cursor.querySelector(
        [
          "[data-view-name='feed-commentary']",
          "[data-testid='expandable-text-box']",
          "a[href*='/feed/update/']",
          "a[href*='/posts/']",
          "img[alt]"
        ].join(",")
      )
    )
    const text = sanitizeLinkedInPostText(cursor.innerText || cursor.textContent || "")
    if (hasPostSignals && text.length >= 20) {
      return cursor
    }

    cursor = cursor.parentElement
  }

  return null
}

function resolveLinkedInSourceUrlFromPostUrn(postUrn: string, fallbackUrl: string): string {
  const normalizedUrn = normalizeString(postUrn)
  if (!normalizedUrn) {
    return fallbackUrl
  }

  if (normalizedUrn.includes("urn:li:activity:")) {
    return `https://www.linkedin.com/feed/update/${normalizedUrn}/`
  }

  const numericMatch = normalizedUrn.match(/(\d{8,})/u)
  if (numericMatch?.[1]) {
    return `https://www.linkedin.com/feed/update/urn:li:activity:${numericMatch[1]}/`
  }

  return fallbackUrl
}

function buildLinkedInCaptureSnapshotFromRoot(
  postRoot: HTMLElement | null,
  currentUrl: string,
  fallbackPostUrn: string | null = null
): LinkedInCaptureSnapshot | null {
  const targetPostRoot = postRoot?.isConnected ? postRoot : resolveLinkedInCaptureRootNearViewport()
  if (!targetPostRoot || !targetPostRoot.isConnected) {
    return null
  }

  const resolvedPostContent = resolveLinkedInCapturePostContent(targetPostRoot)
  const postContent =
    resolvedPostContent.length > 0
      ? resolvedPostContent
      : "Publicacao do LinkedIn sem texto visivel."

  const authorName = resolveLinkedInCaptureAuthor(targetPostRoot)
  const sourceUrlFromRoot = resolveLinkedInSourceUrl(targetPostRoot, currentUrl)
  const sourceUrl =
    normalizeString(sourceUrlFromRoot) ||
    resolveLinkedInSourceUrlFromPostUrn(
      normalizeString(resolveLinkedInPostUrn(targetPostRoot) || fallbackPostUrn),
      currentUrl
    )

  const sourceTitle = resolveBestSourceTitle([
    postContent.split("\n")[0] || "",
    authorName ? `${authorName} - LinkedIn` : "",
    resolveSafeCaptureTitle(),
    "Post do LinkedIn"
  ])

  return {
    postContent,
    authorName,
    sourceUrl: normalizeString(sourceUrl) || currentUrl,
    sourceTitle
  }
}

const LINKEDIN_POST_ROOT_MARKER_SELECTOR =
  "div[data-urn*='activity'], div[data-id*='activity'], article[data-urn*='activity'], article[data-id*='activity'], div[data-finite-scroll-hotkey-item], div.fie-impression-container, article.fie-impression-container, .feed-shared-update-v2, .occludable-update, article[data-view-name='feed-full-update'], article[data-view-name='feed-reshare'], article[class*='feed-shared-update']"

function hasLinkedInPermalink(postRoot: Element): boolean {
  const permalinkAnchor = postRoot.querySelector(
    "a[href*='/feed/update/'], a[href*='/posts/'], a[href*='/activity-']"
  )
  const permalinkHref = normalizeString(permalinkAnchor?.getAttribute("href") || "")
  return Boolean(permalinkHref)
}

function hasLinkedInPostIdentity(postRoot: Element): boolean {
  const urnKey = resolveLinkedInUrnKey(resolveLinkedInPostUrn(postRoot))
  if (urnKey) {
    return true
  }

  return hasLinkedInPermalink(postRoot)
}

function isLikelyLinkedInSinglePostRoot(postRoot: HTMLElement): boolean {
  if (!postRoot.isConnected || !isVisibleElement(postRoot)) {
    return false
  }

  const rect = postRoot.getBoundingClientRect()
  if (rect.width < 260 || rect.height < 120) {
    return false
  }

  const maxExpectedHeight = Math.max(window.innerHeight * 7, 4200)
  if (rect.height > maxExpectedHeight) {
    return false
  }

  const nestedMarkers = Array.from(postRoot.querySelectorAll<HTMLElement>(LINKEDIN_POST_ROOT_MARKER_SELECTOR)).filter(
    (candidate) => candidate !== postRoot && isVisibleElement(candidate)
  )
  if (nestedMarkers.length > 8) {
    return false
  }

  const actionBars = Array.from(
    postRoot.querySelectorAll<HTMLElement>(LINKEDIN_ACTION_BAR_SELECTORS.join(","))
  ).filter((candidate) => isVisibleElement(candidate))
  if (actionBars.length > 3) {
    return false
  }

  const permalinkCount = postRoot.querySelectorAll("a[href*='/feed/update/'], a[href*='/posts/'], a[href*='/activity-']").length
  if (permalinkCount > 6) {
    return false
  }

  const socialActionCount = postRoot.querySelectorAll("button[aria-label*='comment' i], button[aria-label*='comentar' i], button[aria-label*='share' i], button[aria-label*='compartilhar' i], button[aria-label*='send' i], button[aria-label*='enviar' i]").length
  if (socialActionCount > 32) {
    return false
  }

  const textSnapshot = sanitizeLinkedInPostText(
    (postRoot as HTMLElement).innerText || postRoot.textContent || ""
  )
  if (textSnapshot.length > 22000) {
    return false
  }

  if (textSnapshot.length < 20 && actionBars.length === 0 && !hasLinkedInPostIdentity(postRoot)) {
    return false
  }

  return true
}

function collectLinkedInPostCandidates(): HTMLElement[] {
  const candidateSelectors = [
    "main div[data-urn^='urn:li:activity:']",
    "main div[data-urn*='urn:li:activity:']",
    "main div[data-id^='urn:li:activity:']",
    "main div[data-id*='urn:li:activity:']",
    "main article[data-urn^='urn:li:activity:']",
    "main article[data-urn*='urn:li:activity:']",
    "main article[data-id^='urn:li:activity:']",
    "main article[data-id*='urn:li:activity:']",
    "main div[data-finite-scroll-hotkey-item]",
    "main article[data-finite-scroll-hotkey-item]",
    "main div.fie-impression-container",
    "main article.fie-impression-container",
    "main div[data-view-name='feed-full-update']",
    "main div[data-view-name='feed-reshare']",
    "main article[data-view-name='feed-full-update']",
    "main article[data-view-name='feed-reshare']",
    "main .feed-shared-update-v2",
    "main .occludable-update",
    "main article[class*='feed-shared-update']"
  ] as const

  const candidates: HTMLElement[] = []
  const seen = new Set<HTMLElement>()

  for (const selector of candidateSelectors) {
    let nodes: Element[] = []
    try {
      nodes = Array.from(document.querySelectorAll(selector))
    } catch {
      continue
    }

    for (const node of nodes) {
      const postRoot =
        (node.closest(
          "div[data-urn], div[data-id], article[data-urn], article[data-id], div[data-finite-scroll-hotkey-item], article[data-finite-scroll-hotkey-item], div.fie-impression-container, article.fie-impression-container, .feed-shared-update-v2, .occludable-update, article[data-view-name='feed-full-update'], article[data-view-name='feed-reshare'], article[class*='feed-shared-update']"
        ) as HTMLElement | null) || (node as HTMLElement)

      if (!postRoot.isConnected || seen.has(postRoot)) {
        continue
      }

      seen.add(postRoot)
      candidates.push(postRoot)
    }
  }

  return candidates
}

function resolveLinkedInUrnKey(value: unknown): string {
  const normalizedValue = decodeURIComponentSafely(normalizeString(value))
  if (!normalizedValue) {
    return ""
  }

  const numericMatch = normalizedValue.match(/(\d{8,})/u)
  if (numericMatch?.[1]) {
    return normalizeString(numericMatch[1])
  }

  return normalizeTitleComparisonKey(normalizedValue)
}

function normalizeLinkedInActionLabel(value: string): string {
  return normalizeTitleComparisonKey(value).replace(/[^a-z0-9 ]+/g, " ").trim()
}

function isLinkedInActionLabel(value: string): boolean {
  const normalizedValue = normalizeLinkedInActionLabel(value)
  if (!normalizedValue) {
    return false
  }

  return LINKEDIN_ACTION_LABEL_TOKENS.some((token) => normalizedValue.includes(token))
}

function isLinkedInLikeLabel(value: string): boolean {
  const normalizedValue = normalizeLinkedInActionLabel(value)
  if (!normalizedValue) {
    return false
  }

  return normalizedValue.includes("gost") || normalizedValue.includes("like") || normalizedValue.includes("curtir")
}

function collectLinkedInLikeButtons(): HTMLElement[] {
  let candidates: HTMLElement[] = []
  try {
    candidates = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button']")).slice(0, 1200)
  } catch {
    candidates = []
  }

  return candidates.filter((candidate) => {
    if (!isVisibleElement(candidate)) {
      return false
    }

    const label = normalizeString(candidate.getAttribute("aria-label") || candidate.textContent || "")
    return isLinkedInLikeLabel(label)
  })
}

function findLinkedInActionRowFromButton(button: HTMLElement): HTMLElement | null {
  let cursor: HTMLElement | null = button
  for (let depth = 0; depth < 9 && cursor; depth += 1) {
    cursor = cursor.parentElement
    if (!cursor || !isVisibleElement(cursor)) {
      continue
    }

    let actionButtons: HTMLElement[] = []
    try {
      actionButtons = Array.from(cursor.querySelectorAll<HTMLElement>("button, [role='button']")).slice(0, 20)
    } catch {
      actionButtons = []
    }

    if (actionButtons.length < 3 || actionButtons.length > 12) {
      continue
    }

    let hasLike = false
    let hasComment = false
    let hasShare = false
    let hasSend = false

    for (const actionButton of actionButtons) {
      const label = normalizeLinkedInActionLabel(
        normalizeString(actionButton.getAttribute("aria-label") || actionButton.textContent || "")
      )
      if (!label) {
        continue
      }
      if (label.includes("gost") || label.includes("like") || label.includes("curtir")) {
        hasLike = true
      }
      if (label.includes("coment") || label.includes("comment")) {
        hasComment = true
      }
      if (label.includes("compart") || label.includes("share") || label.includes("repost")) {
        hasShare = true
      }
      if (label.includes("envi") || label.includes("send")) {
        hasSend = true
      }
    }

    const signalCount = Number(hasLike) + Number(hasComment) + Number(hasShare) + Number(hasSend)
    if (signalCount >= 3 && hasLike) {
      return cursor
    }
  }

  return null
}

function isLikelyLinkedInActionBar(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !isVisibleElement(element)) {
    return false
  }

  const rect = element.getBoundingClientRect()
  if (rect.height < 24 || rect.height > 120) {
    return false
  }

  let actionButtons: HTMLElement[] = []
  try {
    actionButtons = Array.from(element.querySelectorAll<HTMLElement>("button, [role='button']")).slice(0, 12)
  } catch {
    actionButtons = []
  }

  if (actionButtons.length < 3 || actionButtons.length > 10) {
    return false
  }

  const matchedLabels = actionButtons
    .map((button) => normalizeString(button.getAttribute("aria-label") || button.textContent || ""))
    .filter((label) => label.length > 0)
    .filter((label) => isLinkedInActionLabel(label))

  const uniqueMatches = new Set(matchedLabels.map((label) => normalizeLinkedInActionLabel(label)))
  return uniqueMatches.size >= 2
}

function findLinkedInActionBarInPost(postRoot: HTMLElement): HTMLElement | null {
  const strictSelectors = [
    ...LINKEDIN_ACTION_BAR_SELECTORS,
    "div[data-testid*='social-actions']",
    "div[role='toolbar']",
    "div[aria-label*='Post actions']",
    "div[aria-label*='Acoes da publicacao']",
    "div[aria-label*='AÃ§Ãµes da publicaÃ§Ã£o']"
  ] as const

  for (const selector of strictSelectors) {
    let candidates: Element[] = []
    try {
      candidates = Array.from(postRoot.querySelectorAll(selector))
    } catch {
      candidates = []
    }

    for (const candidate of candidates) {
      if (isLikelyLinkedInActionBar(candidate)) {
        return candidate
      }
    }
  }

  let looseCandidates: Element[] = []
  try {
    looseCandidates = Array.from(postRoot.querySelectorAll("div, ul, footer")).slice(0, 220)
  } catch {
    looseCandidates = []
  }

  let bestCandidate: HTMLElement | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  const postRect = postRoot.getBoundingClientRect()

  for (const candidate of looseCandidates) {
    if (!isLikelyLinkedInActionBar(candidate)) {
      continue
    }

    const rect = candidate.getBoundingClientRect()
    const isLowerHalf = rect.top >= postRect.top + postRect.height * 0.35
    const score = (isLowerHalf ? 2 : 0) + rect.top / 1000
    if (score > bestScore) {
      bestScore = score
      bestCandidate = candidate
    }
  }

  return bestCandidate
}

function resolveDirectLinkedInActionChild(
  actionBar: HTMLElement,
  actionElement: HTMLElement | null
): HTMLElement | null {
  let current: HTMLElement | null = actionElement
  while (current && current.parentElement && current.parentElement !== actionBar) {
    current = current.parentElement
  }

  if (current && current.parentElement === actionBar) {
    return current
  }

  return null
}

function collectLinkedInActionBarsRobust(): HTMLElement[] {
  const bars: HTMLElement[] = []
  const seen = new Set<HTMLElement>()

  const pushIfValid = (candidate: HTMLElement | null): void => {
    if (!candidate || seen.has(candidate)) {
      return
    }
    if (!isLikelyLinkedInActionBar(candidate)) {
      return
    }
    seen.add(candidate)
    bars.push(candidate)
  }

  for (const selector of LINKEDIN_ACTION_BAR_SELECTORS) {
    let nodes: Element[] = []
    try {
      nodes = Array.from(document.querySelectorAll(selector))
    } catch {
      nodes = []
    }
    for (const node of nodes) {
      pushIfValid(node as HTMLElement)
    }
  }

  const actionButtonSelector = [
    "button[aria-label*='Gost']",
    "button[aria-label*='gost']",
    "button[aria-label*='Like']",
    "button[aria-label*='like']",
    "button[aria-label*='Coment']",
    "button[aria-label*='coment']",
    "button[aria-label*='Share']",
    "button[aria-label*='share']",
    "button[aria-label*='Compart']",
    "button[aria-label*='compart']",
    "button[aria-label*='Enviar']",
    "button[aria-label*='enviar']",
    "button[aria-label*='Send']",
    "button[aria-label*='send']"
  ].join(", ")

  let actionButtons: HTMLElement[] = []
  try {
    actionButtons = Array.from(document.querySelectorAll<HTMLElement>(actionButtonSelector)).slice(0, 450)
  } catch {
    actionButtons = []
  }

  for (const actionButton of actionButtons) {
    if (!isVisibleElement(actionButton)) {
      continue
    }

    let cursor: HTMLElement | null = actionButton
    for (let depth = 0; depth < 8 && cursor; depth += 1) {
      cursor = cursor.parentElement
      if (!cursor) {
        break
      }
      if (isLikelyLinkedInActionBar(cursor)) {
        pushIfValid(cursor)
        break
      }
    }
  }

  return bars
}

function resolveLinkedInPostRootFromActionBar(actionBar: Element): HTMLElement | null {
  const postRoot = actionBar.closest(
    "div[data-urn], div[data-id], article[data-urn], article[data-id], div[data-finite-scroll-hotkey-item], article[data-finite-scroll-hotkey-item], div.fie-impression-container, article.fie-impression-container, .feed-shared-update-v2, .occludable-update, article[data-view-name='feed-full-update'], article[data-view-name='feed-reshare'], article[class*='feed-shared-update']"
  ) as HTMLElement | null

  if (!postRoot || !isVisibleElement(postRoot)) {
    return null
  }

  return postRoot
}

function resolveLinkedInPostRoot(
  currentUrl: string,
  preferredPostUrn: string | null = null,
  preferredPostRoot: HTMLElement | null = null
): HTMLElement | null {
  if (preferredPostRoot?.isConnected) {
    const directPostRoot =
      (preferredPostRoot.closest(
        "div[data-urn], div[data-id], article[data-urn], article[data-id], div[data-finite-scroll-hotkey-item], article[data-finite-scroll-hotkey-item], div.fie-impression-container, article.fie-impression-container, .feed-shared-update-v2, .occludable-update, article[data-view-name='feed-full-update'], article[data-view-name='feed-reshare'], article[class*='feed-shared-update']"
      ) as HTMLElement | null) || preferredPostRoot

    if (
      directPostRoot?.isConnected &&
      !isLinkedInSponsoredPost(directPostRoot) &&
      isLikelyLinkedInSinglePostRoot(directPostRoot)
    ) {
      const directContent = resolveLinkedInPostBody(directPostRoot)
      if (directContent.length >= 8) {
        return directPostRoot
      }
    }
  }

  const candidates = collectLinkedInPostCandidates()
    .filter((postRoot) => postRoot.isConnected)
    .filter((postRoot) => !isLinkedInSponsoredPost(postRoot))
    .filter((postRoot) => isLikelyLinkedInSinglePostRoot(postRoot))
  if (candidates.length === 0) {
    return null
  }

  const targetUrn =
    normalizeString(preferredPostUrn) ||
    resolveLinkedInUrnFromUrl(currentUrl) ||
    normalizeString(preferredPostRoot?.getAttribute("data-minddock-linkedin-post-urn"))
  const targetUrnKey = resolveLinkedInUrnKey(targetUrn)
  if (targetUrnKey) {
    for (const postRoot of candidates) {
      const postUrnKey = resolveLinkedInUrnKey(resolveLinkedInPostUrn(postRoot))
      if (postUrnKey && postUrnKey === targetUrnKey) {
        return postRoot
      }

      const permalinkKey = resolveLinkedInUrnKey(resolveLinkedInSourceUrl(postRoot, currentUrl))
      if (permalinkKey && permalinkKey === targetUrnKey) {
        return postRoot
      }
    }
  }

  const actionBarRoots = collectLinkedInActionBarsRobust()
    .map((actionBar) => resolveLinkedInPostRootFromActionBar(actionBar))
    .filter((postRoot): postRoot is HTMLElement => Boolean(postRoot))
    .filter((postRoot) => !isLinkedInSponsoredPost(postRoot))
    .filter((postRoot) => isLikelyLinkedInSinglePostRoot(postRoot))
  if (actionBarRoots.length > 0) {
    const actionRootByUrn = targetUrnKey
      ? actionBarRoots.find((postRoot) => resolveLinkedInUrnKey(resolveLinkedInPostUrn(postRoot)) === targetUrnKey)
      : null
    if (actionRootByUrn) {
      return actionRootByUrn
    }
  }

  const viewportCenter = window.innerHeight / 3
  let bestCandidate: HTMLElement | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const postRoot of candidates) {
    const postBody = resolveLinkedInPostBody(postRoot)
    if (postBody.length < 8) {
      continue
    }

    const rect = postRoot.getBoundingClientRect()
    const distance = Math.abs(rect.top + rect.height / 2 - viewportCenter)
    if (distance < bestDistance) {
      bestDistance = distance
      bestCandidate = postRoot
    }
  }

  return bestCandidate || candidates[0] || null
}

function buildLinkedInPreparedCaptureFromSnapshot(
  snapshot: LinkedInCaptureSnapshot | null,
  fallbackUrl: string
): PreparedCapturePayload | null {
  if (!snapshot) {
    return null
  }

  const sanitizedSnapshotContent = sanitizeLinkedInCaptureText(snapshot.postContent)
  const postContent =
    sanitizedSnapshotContent.length > 0
      ? sanitizedSnapshotContent
      : "Publicacao do LinkedIn sem texto visivel."

  const authorName = sanitizeLinkedInAuthorCandidate(snapshot.authorName)
  const sourceUrl = normalizeString(snapshot.sourceUrl) || fallbackUrl
  const sourceTitle = resolveBestSourceTitle([
    normalizeString(snapshot.sourceTitle),
    postContent.split("\n")[0] || "",
    authorName ? `${authorName} - LinkedIn` : "",
    resolveSafeCaptureTitle(),
    "Post do LinkedIn"
  ])

  const linkedInHeader = [`Post by ${authorName || "Desconhecido"}`, `Source: ${sourceUrl}`].join("\n")
  const formattedContent = normalizeGenericCaptureText(`${linkedInHeader}\n\n${postContent}`)

  if (!formattedContent) {
    return null
  }

  return {
    sourceKind: "chat",
    sourcePlatform: "LinkedIn",
    sourceTitle,
    conversation: [
      {
        role: "user",
        content: formattedContent
      }
    ]
  }
}

function buildLinkedInPreparedCapture(
  currentUrl: string,
  preferredPostUrn: string | null = null,
  preferredPostRoot: HTMLElement | null = null,
  preferredSnapshot: LinkedInCaptureSnapshot | null = null
): PreparedCapturePayload | null {
  const snapshotCapture = buildLinkedInPreparedCaptureFromSnapshot(preferredSnapshot, currentUrl)
  if (snapshotCapture) {
    return snapshotCapture
  }

  const postRoot = resolveLinkedInPostRoot(currentUrl, preferredPostUrn, preferredPostRoot)
  if (!postRoot) {
    return null
  }

  if (!isLikelyLinkedInSinglePostRoot(postRoot)) {
    return null
  }

  const authorName = resolveLinkedInAuthorName(postRoot)
  const resolvedPostContent =
    resolveLinkedInCapturePostContent(postRoot) ||
    resolveLinkedInPostBody(postRoot) ||
    resolveLinkedInFallbackPostContent(postRoot)
  const postContent = sanitizeLinkedInCaptureText(resolvedPostContent) || "Publicacao do LinkedIn sem texto visivel."
  const sourceUrl = resolveLinkedInSourceUrl(postRoot, currentUrl)

  const sourceTitle = resolveBestSourceTitle([
    postContent.split("\n")[0] || "",
    authorName ? `${authorName} - LinkedIn` : "",
    resolveSafeCaptureTitle(),
    "Post do LinkedIn"
  ])

  const linkedInHeader = [`Post by ${authorName || "Desconhecido"}`, `Source: ${sourceUrl}`].join("\n")
  const formattedContent = normalizeGenericCaptureText(`${linkedInHeader}\n\n${postContent}`)

  return {
    sourceKind: "chat",
    sourcePlatform: "LinkedIn",
    sourceTitle,
    conversation: [
      {
        role: "user",
        content: formattedContent
      }
    ]
  }
}

function resolveKimiConversationTitle(): string {
  const titleSelectors = [
    "header.chat-header-content [class*='title']",
    "header.chat-header-content h1",
    "div.layout-header [class*='title']",
    "div.chat-header-actions [class*='title']"
  ] as const

  const titleCandidates = [
    ...titleSelectors.map((selector) =>
      normalizeString((document.querySelector(selector) as HTMLElement | null)?.innerText || "")
    ),
    resolveSafeCaptureTitle(),
    normalizeString(document.title)
  ]

  return resolveBestSourceTitle([...titleCandidates, "Chat Kimi"])
}

function buildEmptyChatPreparedCapture(
  sourcePlatform: string,
  sourceTitle: string
): PreparedCapturePayload {
  return {
    sourceKind: "chat",
    sourcePlatform,
    sourceTitle,
    conversation: []
  }
}

function buildKimiPreparedCapture(_currentUrl: string): PreparedCapturePayload | null {
  const sourceTitle = resolveKimiConversationTitle()
  const emptyCapture = buildEmptyChatPreparedCapture("Kimi", sourceTitle)
  const timeline =
    queryFirstVisibleElement(["div.chat-content-list", "main div.chat-content-list", "main"]) ||
    (document.body as HTMLElement | null)
  if (!timeline) {
    return emptyCapture
  }

  let rawItems = Array.from(timeline.querySelectorAll<HTMLElement>("div.chat-content-item"))
  if (rawItems.length === 0) {
    rawItems = Array.from(document.querySelectorAll<HTMLElement>("div.chat-content-item"))
  }
  if (rawItems.length === 0) {
    return emptyCapture
  }

  const conversation: Array<{ role: CaptureConversationRole; content: string }> = []
  const seen = new Set<string>()

  for (const item of rawItems) {
    const userNode = item.querySelector<HTMLElement>("div.user-content, [class*='user-content']")
    const assistantNode = item.querySelector<HTMLElement>(
      "div.markdown, div.markdown-body, [class*='markdown']"
    )

    const isUserItem =
      item.classList.contains("chat-content-item-user") || Boolean(userNode && !assistantNode)
    const isAssistantItem =
      item.classList.contains("chat-content-item-assistant") || Boolean(assistantNode)
    if (!isUserItem && !isAssistantItem) {
      continue
    }

    const role: CaptureConversationRole = isUserItem ? "user" : "assistant"
    const textSource =
      role === "user"
        ? userNode?.innerText || userNode?.textContent || item.textContent || ""
        : assistantNode?.innerText || assistantNode?.textContent || item.textContent || ""
    const content = normalizeGenericCaptureText(textSource)
    if (content.length < 2) {
      continue
    }

    const dedupeKey = `${role}:${normalizeTitleComparisonKey(content)}`
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue
    }

    seen.add(dedupeKey)
    conversation.push({ role, content })
  }

  const hasUserTurn = conversation.some((turn) => turn.role === "user")
  const hasAssistantTurn = conversation.some((turn) => turn.role === "assistant")
  if (conversation.length === 0 || !hasUserTurn || !hasAssistantTurn) {
    return emptyCapture
  }

  return {
    sourceKind: "chat",
    sourcePlatform: "Kimi",
    sourceTitle,
    conversation
  }
}

function resolveOpenEvidenceConversationTitle(): string {
  const titleSelectors = [
    "main h1",
    "header h1",
    "[data-testid='thread-title']",
    "[data-testid*='title']"
  ] as const

  const titleCandidates = [
    ...titleSelectors.map((selector) =>
      normalizeString((document.querySelector(selector) as HTMLElement | null)?.innerText || "")
    ),
    resolveSafeCaptureTitle(),
    normalizeString(document.title)
  ]

  return resolveBestSourceTitle([...titleCandidates, "Chat OpenEvidence"])
}

function extractOpenEvidenceReferences(root: ParentNode): string[] {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>(
      ".ArticleReferences_references__Mtdmr, [class*='ArticleReferences_references'], .brandable--references"
    )
  )

  const references: string[] = []
  const seen = new Set<string>()
  let fallbackIndex = 1

  for (const block of blocks) {
    const entries = Array.from(
      block.querySelectorAll<HTMLElement>("li, article, [role='listitem'], a[href], p")
    ).filter((entry) => normalizeGenericCaptureText(entry.innerText || entry.textContent || "").length > 1)

    if (entries.length === 0) {
      const fallback = normalizeGenericCaptureText(block.innerText || block.textContent || "")
      if (fallback) {
        const dedupeKey = normalizeTitleComparisonKey(fallback)
        if (dedupeKey && !seen.has(dedupeKey)) {
          seen.add(dedupeKey)
          references.push(`${fallbackIndex}. ${fallback}`)
          fallbackIndex += 1
        }
      }
      continue
    }

    for (const entry of entries) {
      const entryText = normalizeGenericCaptureText(entry.innerText || entry.textContent || "")
      if (!entryText) {
        continue
      }

      const linkEl = entry.querySelector<HTMLAnchorElement>("a[href]") || (entry.matches("a[href]") ? (entry as HTMLAnchorElement) : null)
      const href = normalizeString(linkEl?.href)
      const textWithoutUrl = entryText.replace(/https?:\/\/\S+/giu, "").trim()
      const compactText = normalizeGenericCaptureText(textWithoutUrl || entryText)
      if (!compactText) {
        continue
      }

      const candidate = href ? `${compactText} (${href})` : compactText
      const dedupeKey = normalizeTitleComparisonKey(candidate)
      if (!dedupeKey || seen.has(dedupeKey)) {
        continue
      }

      seen.add(dedupeKey)
      references.push(`${fallbackIndex}. ${candidate}`)
      fallbackIndex += 1
    }
  }

  return references
}

function formatOpenEvidenceAnswer(article: HTMLElement): string {
  const clonedArticle = article.cloneNode(true) as HTMLElement
  const references = extractOpenEvidenceReferences(clonedArticle)

  const removableSelectors = [
    "button",
    "svg",
    "script",
    "style",
    "noscript",
    "textarea",
    "input",
    "[role='button']",
    "[aria-hidden='true']",
    ".brandable--references",
    ".ArticleReferences_references__Mtdmr",
    "[class*='ArticleReferences_references']",
    "[data-testid*='reference']",
    "[data-testid*='citation']"
  ] as const

  for (const selector of removableSelectors) {
    for (const element of Array.from(clonedArticle.querySelectorAll(selector))) {
      element.remove()
    }
  }

  const rawText = normalizeGenericCaptureText(clonedArticle.innerText || clonedArticle.textContent || "")
  if (!rawText) {
    if (references.length > 0) {
      return `References:\n${references.join("\n")}`
    }
    return ""
  }

  const cleanedText = normalizeGenericCaptureText(
    rawText
      .replace(/[ \t]+\n/gu, "\n")
      .replace(/\n{3,}/gu, "\n\n")
      .replace(/[ \t]{2,}/gu, " ")
  )

  if (!cleanedText) {
    if (references.length > 0) {
      return `References:\n${references.join("\n")}`
    }
    return ""
  }

  if (references.length === 0) {
    return cleanedText
  }

  return `${cleanedText}\n\nReferences:\n${references.join("\n")}`
}

function buildOpenEvidencePreparedCapture(_currentUrl: string): PreparedCapturePayload | null {
  const sourceTitle = resolveOpenEvidenceConversationTitle()
  const emptyCapture = buildEmptyChatPreparedCapture("OpenEvidence", sourceTitle)

  const questionSelectors = [
    'textarea[aria-label="Ask a question"]',
    'textarea[aria-label="Ask a follow-up question"]'
  ] as const

  const questionValues = queryVisibleElementsBySelectors(document, questionSelectors)
    .map((node) => normalizeGenericCaptureText((node as HTMLTextAreaElement).value || node.textContent || ""))
    .filter((value) => value.length > 1)

  const articleNodes = queryVisibleElementsBySelectors(document, ["article"])
  const answerValues = articleNodes
    .map((article) => formatOpenEvidenceAnswer(article))
    .filter((value) => value.length > 1)

  if (questionValues.length === 0 && answerValues.length === 0) {
    return emptyCapture
  }

  const conversation: Array<{ role: CaptureConversationRole; content: string }> = []
  const seen = new Set<string>()
  const totalTurns = Math.max(questionValues.length, answerValues.length)

  for (let index = 0; index < totalTurns; index += 1) {
    const question = normalizeGenericCaptureText(questionValues[index] || "")
    if (question) {
      const userDedupeKey = `user:${normalizeTitleComparisonKey(question)}`
      if (userDedupeKey && !seen.has(userDedupeKey)) {
        seen.add(userDedupeKey)
        conversation.push({ role: "user", content: question })
      }
    }

    const answer = normalizeGenericCaptureText(answerValues[index] || "")
    if (answer) {
      const assistantDedupeKey = `assistant:${normalizeTitleComparisonKey(answer)}`
      if (assistantDedupeKey && !seen.has(assistantDedupeKey)) {
        seen.add(assistantDedupeKey)
        conversation.push({ role: "assistant", content: answer })
      }
    }
  }

  const hasUserTurn = conversation.some((turn) => turn.role === "user")
  const hasAssistantTurn = conversation.some((turn) => turn.role === "assistant")
  if (!hasUserTurn && !hasAssistantTurn) {
    return emptyCapture
  }

  return {
    sourceKind: "chat",
    sourcePlatform: "OpenEvidence",
    sourceTitle,
    conversation
  }
}

function resolveGensparkConversationTitle(): string {
  const titleSelectors = [
    "main h1",
    "header h1",
    "[data-testid='conversation-title']",
    "[class*='conversation-title']"
  ] as const

  const titleCandidates = [
    ...titleSelectors.map((selector) =>
      normalizeString((document.querySelector(selector) as HTMLElement | null)?.innerText || "")
    ),
    resolveSafeCaptureTitle(),
    normalizeString(document.title)
  ]

  return resolveBestSourceTitle([...titleCandidates, "Chat Genspark"])
}

function isLikelyGensparkSuggestionLine(value: string): boolean {
  const normalized = normalizeString(value)
  if (!normalized) {
    return false
  }

  if (/^(?:[-*â€¢]|\d+[.)])\s*/u.test(normalized)) {
    return false
  }

  const tokenCount = normalized.split(/\s+/u).filter(Boolean).length
  if (tokenCount < 3 || tokenCount > 18) {
    return false
  }

  const lower = normalized.toLowerCase()
  return /^(pesquise|pesquisar|crie|criar|mostre(?:-me)?|mostrar|gere|gerar|resuma|resumir|compare|comparar|escreva|escrever|explique|explicar|show|create|generate|summarize|compare|write|draft)\b/iu.test(
    lower
  )
}

function sanitizeGensparkTurnContent(rawValue: string): string {
  const normalized = normalizeGenericCaptureText(rawValue)
  if (!normalized) {
    return ""
  }

  const lines = normalized.split("\n").map((line) => normalizeString(line))
  let lastIndex = lines.length - 1

  while (lastIndex >= 0 && !lines[lastIndex]) {
    lastIndex -= 1
  }

  if (lastIndex < 0) {
    return ""
  }

  let suggestionLineCount = 0
  while (lastIndex >= 0 && isLikelyGensparkSuggestionLine(lines[lastIndex])) {
    suggestionLineCount += 1
    lastIndex -= 1
  }

  if (suggestionLineCount >= 3) {
    while (lastIndex >= 0 && !lines[lastIndex]) {
      lastIndex -= 1
    }
    return normalizeGenericCaptureText(lines.slice(0, lastIndex + 1).join("\n"))
  }

  return normalized
}

function formatGensparkTurnContent(statementNode: HTMLElement): string {
  try {
    const clonedNode = statementNode.cloneNode(true) as HTMLElement
    const removableSelectors = [
      ".message-actions-user",
      ".buttons",
      "[class*='suggest']",
      "[class*='prompt']",
      "[class*='recommend']",
      "[class*='quick']",
      "[class*='starter']",
      "[class*='follow']",
      "[data-testid*='suggest']",
      "[data-testid*='prompt']",
      "[data-testid*='recommend']",
      "[data-testid*='quick']",
      "button",
      "svg",
      "script",
      "style",
      "noscript"
    ] as const

    for (const selector of removableSelectors) {
      for (const element of Array.from(clonedNode.querySelectorAll(selector))) {
        element.remove()
      }
    }

    const cleaned = sanitizeGensparkTurnContent(clonedNode.innerText || clonedNode.textContent || "")
    if (cleaned) {
      return cleaned
    }
  } catch {
    // fallback below
  }

  return sanitizeGensparkTurnContent(statementNode.innerText || statementNode.textContent || "")
}

function buildGensparkPreparedCapture(_currentUrl: string): PreparedCapturePayload | null {
  const sourceTitle = resolveGensparkConversationTitle()
  const emptyCapture = buildEmptyChatPreparedCapture("Genspark", sourceTitle)

  const statementNodes = queryVisibleElementsBySelectors(document, [
    ".conversation-statement.user, .conversation-statement.assistant"
  ])

  if (statementNodes.length === 0) {
    return emptyCapture
  }

  const conversation: Array<{ role: CaptureConversationRole; content: string }> = []
  const seen = new Set<string>()

  for (const statementNode of statementNodes) {
    let role: CaptureConversationRole | null = null
    if (statementNode.matches(".conversation-statement.user")) {
      role = "user"
    } else if (statementNode.matches(".conversation-statement.assistant")) {
      role = "assistant"
    }

    if (!role) {
      continue
    }

    const content = formatGensparkTurnContent(statementNode)
    if (content.length < 2) {
      continue
    }

    const dedupeKey = `${role}:${normalizeTitleComparisonKey(content)}`
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue
    }

    seen.add(dedupeKey)
    conversation.push({ role, content })
  }

  if (conversation.length === 0) {
    return emptyCapture
  }

  return {
    sourceKind: "chat",
    sourcePlatform: "Genspark",
    sourceTitle,
    conversation
  }
}

function resolvePerplexityConversationTitle(): string {
  const titleSelectors = [
    "main [data-testid='thread-title']",
    "main [data-testid*='thread-title']",
    "main h1",
    "header h1"
  ] as const

  const titleCandidates = [
    ...titleSelectors.map((selector) =>
      normalizeString((document.querySelector(selector) as HTMLElement | null)?.innerText || "")
    ),
    resolveSafeCaptureTitle(),
    normalizeString(document.title)
  ]

  return resolveBestSourceTitle([...titleCandidates, "Chat Perplexity"])
}

function resolvePerplexityMessageRole(messageElement: HTMLElement): CaptureConversationRole {
  const tokenSource = [
    messageElement.getAttribute("data-testid"),
    messageElement.getAttribute("data-role"),
    messageElement.getAttribute("aria-label"),
    messageElement.className,
    messageElement.id
  ]
    .map((value) => normalizeTitleComparisonKey(String(value ?? "")))
    .join(" ")

  if (/(query|prompt|question|ask|user|human)/u.test(tokenSource)) {
    return "user"
  }

  if (/(answer|response|assistant|model|bot|perplexity)/u.test(tokenSource)) {
    return "assistant"
  }

  if (messageElement.closest("[data-testid='query'], [data-testid*='query']")) {
    return "user"
  }

  if (messageElement.closest("[data-testid='answer'], [data-testid*='answer']")) {
    return "assistant"
  }

  return "assistant"
}

function isPerplexitySourceCounterLine(value: string): boolean {
  return /^\+\d{1,3}$/u.test(normalizeString(value))
}

function isPerplexityCitationMarkerLine(value: string): boolean {
  const normalized = normalizeString(value)
  return /^\[(?:\d+\s*,?\s*)+\]$/u.test(normalized)
}

function isPerplexitySourceLabelLikeLine(value: string): boolean {
  const normalized = normalizeString(value).toLowerCase()
  if (!normalized || normalized.includes(" ")) {
    return false
  }

  if (/^[a-z0-9]+(?:\.[a-z0-9-]+){1,4}$/u.test(normalized)) {
    return true
  }

  if (/^[a-z0-9]+(?:[-_][a-z0-9]+){1,4}$/u.test(normalized)) {
    return true
  }

  return false
}

function sanitizePerplexityAnswerContent(value: string): string {
  const normalized = normalizeGenericCaptureText(value)
  if (!normalized) {
    return ""
  }

  const lines = normalized.split("\n").map((line) => normalizeGenericCaptureText(line))
  const output: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const nextLine = index + 1 < lines.length ? lines[index + 1] : ""

    if (!line) {
      output.push("")
      continue
    }

    if (isPerplexityCitationMarkerLine(line)) {
      continue
    }

    const looksLikeSourceLabel =
      isPerplexitySourceLabelLikeLine(line) ||
      (/^[A-Z]{2,10}$/u.test(line) && isPerplexitySourceCounterLine(nextLine))

    if (looksLikeSourceLabel && isPerplexitySourceCounterLine(nextLine)) {
      index += 1
      continue
    }

    if (isPerplexitySourceCounterLine(line)) {
      continue
    }

    output.push(line)
  }

  const compactOutput: string[] = []
  for (const line of output) {
    if (line || compactOutput[compactOutput.length - 1] !== "") {
      compactOutput.push(line)
    }
  }

  return normalizeGenericCaptureText(compactOutput.join("\n"))
}

function resolvePerplexityMessageContent(messageElement: HTMLElement): string {
  const contentSelectors = [
    "[data-testid='query-text']",
    "[data-testid*='query-text']",
    "[data-testid='answer-content']",
    "[data-testid*='answer-content']",
    "[class*='prose']",
    "[class*='markdown']",
    "[class*='content']"
  ] as const

  for (const selector of contentSelectors) {
    const candidate = messageElement.querySelector<HTMLElement>(selector)
    const content = sanitizePerplexityAnswerContent(candidate?.innerText || candidate?.textContent || "")
    if (content.length > 1) {
      return content
    }
  }

  return sanitizePerplexityAnswerContent(messageElement.innerText || messageElement.textContent || "")
}

function queryVisibleElementsBySelectors(root: ParentNode, selectors: readonly string[]): HTMLElement[] {
  const elements: HTMLElement[] = []

  for (const selector of selectors) {
    let matches: Element[] = []
    try {
      matches = Array.from(root.querySelectorAll(selector))
    } catch {
      continue
    }

    for (const match of matches) {
      if (isVisibleElement(match)) {
        elements.push(match)
      }
    }
  }

  if (elements.length === 0) {
    return []
  }

  const unique = Array.from(new Set(elements))
  return unique.filter(
    (element, elementIndex) =>
      !unique.some(
        (otherElement, otherIndex) =>
          otherIndex !== elementIndex && otherElement !== element && otherElement.contains(element)
      )
  )
}

function buildPerplexityPreparedCapture(_currentUrl: string): PreparedCapturePayload | null {
  const sourceTitle = resolvePerplexityConversationTitle()
  const emptyCapture = buildEmptyChatPreparedCapture("Perplexity", sourceTitle)
  const timeline =
    queryFirstVisibleElement(["main", "div[role='main']", "#__next"]) ||
    (document.body as HTMLElement | null)
  if (!timeline) {
    return emptyCapture
  }

  const questionSelectors = [
    ".group\\\\/query",
    ".group\\/query",
    "[data-testid='query']",
    "[data-testid*='query']",
    "[data-testid*='prompt']"
  ] as const
  const answerSelectors = [
    "div.prose",
    "[data-testid='answer']",
    "[data-testid*='answer']",
    "[data-testid*='response']"
  ] as const

  let questionNodes = queryVisibleElementsBySelectors(timeline, questionSelectors)
  let answerNodes = queryVisibleElementsBySelectors(timeline, answerSelectors)

  if (questionNodes.length === 0) {
    questionNodes = queryVisibleElementsBySelectors(document, questionSelectors)
  }

  if (answerNodes.length === 0) {
    answerNodes = queryVisibleElementsBySelectors(document, answerSelectors)
  }

  if (questionNodes.length === 0 && answerNodes.length === 0) {
    return emptyCapture
  }

  const conversation: Array<{ role: CaptureConversationRole; content: string }> = []
  const seen = new Set<string>()
  const totalTurns = Math.max(questionNodes.length, answerNodes.length)

  for (let index = 0; index < totalTurns; index += 1) {
    const questionContent = normalizeGenericCaptureText(
      questionNodes[index]?.innerText || questionNodes[index]?.textContent || ""
    )
    if (questionContent.length > 1) {
      const userDedupeKey = `user:${normalizeTitleComparisonKey(questionContent)}`
      if (userDedupeKey && !seen.has(userDedupeKey)) {
        seen.add(userDedupeKey)
        conversation.push({ role: "user", content: questionContent })
      }
    }

    const answerNode = answerNodes[index]
    const answerContent = answerNode ? resolvePerplexityMessageContent(answerNode) : ""
    if (answerContent.length > 1) {
      const assistantDedupeKey = `assistant:${normalizeTitleComparisonKey(answerContent)}`
      if (assistantDedupeKey && !seen.has(assistantDedupeKey)) {
        seen.add(assistantDedupeKey)
        conversation.push({ role: "assistant", content: answerContent })
      }
    }
  }

  const compactConversation = conversation.filter((turn, index, list) => {
    const currentKey = normalizeTitleComparisonKey(turn.content)
    if (!currentKey) {
      return false
    }

    if (index === 0) {
      return true
    }

    const previousKey = normalizeTitleComparisonKey(list[index - 1]?.content ?? "")
    return currentKey !== previousKey
  })

  const hasUserTurn = compactConversation.some((turn) => turn.role === "user")
  const hasAssistantTurn = compactConversation.some((turn) => turn.role === "assistant")
  const totalContentLength = compactConversation.reduce((sum, turn) => sum + turn.content.length, 0)
  if (compactConversation.length === 0 || !hasUserTurn || !hasAssistantTurn || totalContentLength < 12) {
    return emptyCapture
  }

  return {
    sourceKind: "chat",
    sourcePlatform: "Perplexity",
    sourceTitle,
    conversation: compactConversation
  }
}

function resolveGrokConversationTitle(): string {
  const titleSelectors = [
    "header [data-testid*='title']",
    "header [class*='title']",
    "main [data-testid*='chat-title']",
    "main [class*='conversation-title']",
    "main h1"
  ] as const

  const titleCandidates = [
    ...titleSelectors.map((selector) =>
      normalizeString((document.querySelector(selector) as HTMLElement | null)?.innerText || "")
    ),
    resolveSafeCaptureTitle(),
    normalizeString(document.title)
  ]

  return resolveBestSourceTitle([...titleCandidates, "Chat Grok"])
}

function resolveGrokMessageRole(messageElement: HTMLElement): CaptureConversationRole {
  const tokenSource = [
    messageElement.getAttribute("data-testid"),
    messageElement.getAttribute("data-role"),
    messageElement.getAttribute("aria-label"),
    messageElement.className,
    messageElement.id
  ]
    .map((value) => normalizeTitleComparisonKey(String(value ?? "")))
    .join(" ")

  if (/(user|human|prompt|query|question|input|author)/u.test(tokenSource)) {
    return "user"
  }

  if (/(assistant|model|bot|grok|answer|response|output|result)/u.test(tokenSource)) {
    return "assistant"
  }

  const mainRect = (messageElement.closest("main") as HTMLElement | null)?.getBoundingClientRect()
  const messageRect = messageElement.getBoundingClientRect()
  if (mainRect && messageRect.width > 0) {
    const centerX = messageRect.left + messageRect.width / 2
    const userThreshold = mainRect.left + mainRect.width * 0.6
    if (centerX >= userThreshold) {
      return "user"
    }
  }

  return "assistant"
}

function isLikelyGrokUiNoiseText(value: string): boolean {
  const normalized = normalizeTitleComparisonKey(value)
  if (!normalized) {
    return true
  }

  if (normalized.length <= 2) {
    return true
  }

  if (normalized.length <= 80) {
    const uiNoisePattern =
      /\b(history|private|upgrade|explore|auto|grok|new chat|ask|fazer login|log in|search|pesquisar|share|copy|copiar|like|dislike)\b/u
    if (uiNoisePattern.test(normalized)) {
      return true
    }
  }

  const feedNoisePattern =
    /\b(veja as novas publicacoes|novas publicacoes|new posts|latest posts|for you|para voce|recommended)\b/u
  if (feedNoisePattern.test(normalized)) {
    return true
  }

  return false
}

function hasDominantGrokChildText(node: HTMLElement, parentTextLength: number): boolean {
  if (parentTextLength < 16 || node.children.length === 0) {
    return false
  }

  for (const child of Array.from(node.children)) {
    if (!(child instanceof HTMLElement) || !isVisibleElement(child)) {
      continue
    }

    const childText = normalizeGenericCaptureText(child.innerText || child.textContent || "")
    if (!childText) {
      continue
    }

    if (childText.length >= parentTextLength * 0.9) {
      return true
    }
  }

  return false
}

function resolveGrokComposerRect(root: ParentNode): DOMRect | null {
  const composer = queryFirstVisibleDescendant(root, [
    "textarea",
    "[contenteditable='true']",
    "div[contenteditable='true']",
    "input[type='text']"
  ])

  if (!composer) {
    return null
  }

  return composer.getBoundingClientRect()
}

function isXTwitterHostForGrok(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase()
    return host.includes("x.com") || host.includes("twitter.com")
  } catch {
    return false
  }
}

function isViewportIntersectingRect(rect: DOMRect): boolean {
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth
}

function intersectRects(baseRect: DOMRect, clipRect: DOMRect): DOMRect | null {
  const left = Math.max(baseRect.left, clipRect.left)
  const top = Math.max(baseRect.top, clipRect.top)
  const right = Math.min(baseRect.right, clipRect.right)
  const bottom = Math.min(baseRect.bottom, clipRect.bottom)

  if (right <= left || bottom <= top) {
    return null
  }

  return new DOMRect(left, top, right - left, bottom - top)
}

function isElementClippedOutByAncestors(element: HTMLElement): boolean {
  let visibleRect: DOMRect | null = element.getBoundingClientRect()
  if (!visibleRect || !isViewportIntersectingRect(visibleRect)) {
    return true
  }

  let ancestor: HTMLElement | null = element.parentElement
  while (ancestor && ancestor !== document.body) {
    const ancestorStyle = window.getComputedStyle(ancestor)
    if (
      ancestorStyle.display === "none" ||
      ancestorStyle.visibility === "hidden" ||
      Number.parseFloat(ancestorStyle.opacity || "1") <= 0
    ) {
      return true
    }

    const overflowY = ancestorStyle.overflowY.toLowerCase()
    const overflowX = ancestorStyle.overflowX.toLowerCase()
    const clipsContent =
      overflowY === "hidden" ||
      overflowY === "clip" ||
      overflowY === "scroll" ||
      overflowY === "auto" ||
      overflowX === "hidden" ||
      overflowX === "clip" ||
      overflowX === "scroll" ||
      overflowX === "auto"

    if (clipsContent) {
      const ancestorRect = ancestor.getBoundingClientRect()
      visibleRect = intersectRects(visibleRect, ancestorRect)
      if (!visibleRect) {
        return true
      }
    }

    ancestor = ancestor.parentElement
  }

  return !visibleRect || !isViewportIntersectingRect(visibleRect)
}

function isViewportVisibleElement(element: HTMLElement): boolean {
  if (!isVisibleElement(element)) {
    return false
  }

  const style = window.getComputedStyle(element)
  if (Number.parseFloat(style.opacity || "1") <= 0) {
    return false
  }

  if (isElementClippedOutByAncestors(element)) {
    return false
  }

  return isViewportIntersectingRect(element.getBoundingClientRect())
}

function isLikelyMindDockEchoContent(value: string): boolean {
  const normalized = normalizeTitleComparisonKey(value)
  if (!normalized) {
    return false
  }

  return (
    normalized.includes("importado do grok via minddock") ||
    normalized.includes("[grok]") ||
    normalized.includes("guia de fontes")
  )
}

function countGrokMessageCandidates(root: ParentNode): number {
  const selectors = [
    "[data-testid*='conversation-turn']",
    "[data-testid*='message']",
    "[data-testid*='response']",
    "[data-role='user']",
    "[data-role='assistant']",
    "div[class*='chat-item']",
    "div[class*='message-bubble']"
  ] as const

  let count = 0
  for (const selector of selectors) {
    let nodes: Element[] = []
    try {
      nodes = Array.from(root.querySelectorAll(selector))
    } catch {
      continue
    }
    count += nodes.filter((node): node is HTMLElement => node instanceof HTMLElement && isViewportVisibleElement(node)).length
    if (count >= 2) {
      return count
    }
  }

  return count
}

function resolveActiveGrokTimelineRoot(): HTMLElement | null {
  const mainRoot =
    queryFirstVisibleElement(["main[role='main']", "main", "div[role='main']"]) ||
    (document.body as HTMLElement | null)
  if (!mainRoot) {
    return null
  }

  const composer = queryFirstVisibleDescendant(mainRoot, [
    "textarea",
    "[contenteditable='true']",
    "div[contenteditable='true']"
  ])

  if (!composer) {
    return mainRoot
  }

  let cursor: HTMLElement | null = composer
  let bestRoot: HTMLElement | null = null

  while (cursor && cursor !== document.body) {
    const cursorStyle = window.getComputedStyle(cursor)
    if (
      cursor.hidden ||
      cursor.getAttribute("aria-hidden") === "true" ||
      cursorStyle.display === "none" ||
      cursorStyle.visibility === "hidden"
    ) {
      cursor = cursor.parentElement
      continue
    }

    const rect = cursor.getBoundingClientRect()
    if (rect.width < 340 || rect.height < 220) {
      cursor = cursor.parentElement
      continue
    }

    if (!isViewportIntersectingRect(rect)) {
      cursor = cursor.parentElement
      continue
    }

    const messageCount = countGrokMessageCandidates(cursor)
    if (messageCount > 0) {
      bestRoot = cursor
      if (messageCount >= 2) {
        break
      }
    }

    cursor = cursor.parentElement
  }

  return bestRoot || mainRoot
}

function collectGrokVisibleBlockConversation(root: HTMLElement): Array<{ role: CaptureConversationRole; content: string }> {
  const composerRect = resolveGrokComposerRect(root)
  const rootRect = root.getBoundingClientRect()
  const nodeSelectors = ["article", "div", "p", "span", "pre", "li"] as const

  const candidateNodes: HTMLElement[] = []
  for (const selector of nodeSelectors) {
    let nodes: Element[] = []
    try {
      nodes = Array.from(root.querySelectorAll(selector))
    } catch {
      continue
    }

    for (const node of nodes) {
      if (node instanceof HTMLElement) {
        candidateNodes.push(node)
      }
    }
  }

  const output: Array<{ role: CaptureConversationRole; content: string; top: number; left: number }> = []
  const seen = new Set<string>()

  for (const node of candidateNodes.slice(0, 2200)) {
    if (!isViewportVisibleElement(node)) {
      continue
    }

    if (node.id === HOST_ID || node.closest(`#${HOST_ID}`)) {
      continue
    }

    if (node.closest("header, nav, footer, aside, form, [role='menu'], [role='menuitem'], [role='toolbar']")) {
      continue
    }

    if (node.closest("button, a, [role='button']")) {
      continue
    }

    const rect = node.getBoundingClientRect()
    if (rect.width < 26 || rect.height < 12) {
      continue
    }

    if (rect.top < rootRect.top + 22 || rect.left < rootRect.left - 24 || rect.right > rootRect.right + 24) {
      continue
    }

    if (composerRect && rect.bottom >= composerRect.top - 8) {
      continue
    }

    if (composerRect) {
      const maxSideDistance = Math.max(220, composerRect.width * 0.9)
      if (
        rect.right < composerRect.left - maxSideDistance ||
        rect.left > composerRect.right + maxSideDistance
      ) {
        continue
      }
    }

    const content = normalizeGenericCaptureText(node.innerText || node.textContent || "")
    if (content.length < 3 || content.length > 1200) {
      continue
    }

    if (isLikelyGrokUiNoiseText(content) || isLikelyMindDockEchoContent(content)) {
      continue
    }

    if (hasDominantGrokChildText(node, content.length)) {
      continue
    }

    const role: CaptureConversationRole =
      rect.left + rect.width / 2 >= rootRect.left + rootRect.width * 0.58 ? "user" : "assistant"
    const dedupeKey = `${role}:${normalizeTitleComparisonKey(content)}`
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue
    }

    seen.add(dedupeKey)
    output.push({
      role,
      content,
      top: rect.top,
      left: rect.left
    })
  }

  return output
    .sort((left, right) => (left.top === right.top ? left.left - right.left : left.top - right.top))
    .map((item) => ({ role: item.role, content: item.content }))
}

function collectGrokScopedTextTurns(
  root: HTMLElement,
  selectors: readonly string[]
): Array<{ role: CaptureConversationRole; content: string }> {
  const composerRect = resolveGrokComposerRect(root)
  const rootRect = root.getBoundingClientRect()
  const messageCandidates: Array<{ role: CaptureConversationRole; content: string; top: number; left: number }> = []
  const seen = new Set<string>()

  const candidateNodes: HTMLElement[] = []
  for (const selector of selectors) {
    let nodes: Element[] = []
    try {
      nodes = Array.from(root.querySelectorAll(selector))
    } catch {
      continue
    }

    for (const node of nodes) {
      if (node instanceof HTMLElement) {
        candidateNodes.push(node)
      }
    }
  }

  for (const node of candidateNodes) {
    if (!isViewportVisibleElement(node)) {
      continue
    }

    if (node.closest("header, nav, footer, aside")) {
      continue
    }

    if (node.closest("button, a, [role='button'], [role='menu'], [role='menuitem']")) {
      continue
    }

    const rect = node.getBoundingClientRect()
    if (rect.width < 20 || rect.height < 10) {
      continue
    }

    if (composerRect && rect.bottom >= composerRect.top - 8) {
      continue
    }

    const minTop = rootRect.top + 36
    if (rect.top < minTop) {
      continue
    }

    if (rect.left < rootRect.left - 24 || rect.right > rootRect.right + 24) {
      continue
    }

    if (composerRect) {
      const maxSideDistance = Math.max(180, composerRect.width * 0.75)
      if (
        rect.right < composerRect.left - maxSideDistance ||
        rect.left > composerRect.right + maxSideDistance
      ) {
        continue
      }
    }

    const content = normalizeGenericCaptureText(node.innerText || node.textContent || "")
    if (
      content.length < 2 ||
      content.length > 2400 ||
      isLikelyGrokUiNoiseText(content) ||
      isLikelyMindDockEchoContent(content)
    ) {
      continue
    }

    const centerX = rect.left + rect.width / 2
    const userThreshold = rootRect.left + rootRect.width * 0.6
    const role: CaptureConversationRole = centerX >= userThreshold ? "user" : "assistant"
    const dedupeKey = `${role}:${normalizeTitleComparisonKey(content)}`
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue
    }

    seen.add(dedupeKey)
    messageCandidates.push({
      role,
      content,
      top: rect.top,
      left: rect.left
    })
  }

  return messageCandidates
    .sort((left, right) => (left.top === right.top ? left.left - right.left : left.top - right.top))
    .map((item) => ({ role: item.role, content: item.content }))
}

function collectGrokLayoutConversation(root: HTMLElement): Array<{ role: CaptureConversationRole; content: string }> {
  const fromScopedDirNodes = collectGrokScopedTextTurns(root, ["[dir='auto']", "div[lang]"])
  if (fromScopedDirNodes.length > 0) {
    return fromScopedDirNodes
  }

  const fromVisibleBlocks = collectGrokVisibleBlockConversation(root)
  if (fromVisibleBlocks.length > 0) {
    return fromVisibleBlocks
  }

  const composerRect = resolveGrokComposerRect(root)
  const rootRect = root.getBoundingClientRect()
  const selectors = [
    "article",
    "[data-testid*='message']",
    "[data-testid*='conversation']",
    "[data-testid*='response']",
    "[data-testid*='prompt']",
    "div[class*='message-bubble']",
    "div[class*='chat-item']",
    "div[class*='message']",
    "div[class*='assistant']",
    "div[class*='user']",
    "[dir='auto']",
    "p"
  ] as const

  const candidateNodes: HTMLElement[] = []
  for (const selector of selectors) {
    let nodes: Element[] = []
    try {
      nodes = Array.from(root.querySelectorAll(selector))
    } catch {
      continue
    }

    for (const node of nodes) {
      if (node instanceof HTMLElement) {
        candidateNodes.push(node)
      }
    }
  }

  const dedupeNodeSet = new Set<HTMLElement>()
  const scopedNodes = candidateNodes.filter((node) => {
    if (dedupeNodeSet.has(node) || !isViewportVisibleElement(node)) {
      return false
    }
    dedupeNodeSet.add(node)
    return true
  })

  const messageCandidates: Array<{ role: CaptureConversationRole; content: string; top: number; left: number }> = []
  const seen = new Set<string>()

  for (const node of scopedNodes) {
    const rect = node.getBoundingClientRect()
    if (rect.width < 40 || rect.height < 14) {
      continue
    }

    if (node.closest("header, nav, footer, aside")) {
      continue
    }

    if (node.closest("button, a, [role='button'], [role='menu'], [role='menuitem']")) {
      continue
    }

    if (composerRect && rect.bottom >= composerRect.top - 8) {
      continue
    }

    if (composerRect) {
      const maxSideDistance = Math.max(180, composerRect.width * 0.75)
      if (rect.right < composerRect.left - maxSideDistance || rect.left > composerRect.right + maxSideDistance) {
        continue
      }
    }

    if (rect.top < rootRect.top - 12 || rect.left < rootRect.left - 40 || rect.right > rootRect.right + 40) {
      continue
    }

    const content = normalizeGenericCaptureText(node.innerText || node.textContent || "")
    if (content.length < 2 || content.length > 12000 || isLikelyGrokUiNoiseText(content)) {
      continue
    }

    if (hasDominantGrokChildText(node, content.length)) {
      continue
    }

    const centerX = rect.left + rect.width / 2
    const userThreshold = rootRect.left + rootRect.width * 0.6
    const role: CaptureConversationRole = centerX >= userThreshold ? "user" : "assistant"
    const dedupeKey = `${role}:${normalizeTitleComparisonKey(content)}`
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue
    }

    seen.add(dedupeKey)
    messageCandidates.push({
      role,
      content,
      top: rect.top,
      left: rect.left
    })
  }

  return messageCandidates
    .sort((left, right) => (left.top === right.top ? left.left - right.left : left.top - right.top))
    .map((item) => ({ role: item.role, content: item.content }))
}

function resolveGrokMessageContent(messageElement: HTMLElement): string {
  const contentSelectors = [
    "[data-testid*='message-content']",
    "[data-testid*='response']",
    "[data-testid*='answer']",
    "div.markdown",
    "div.markdown-body",
    "[class*='markdown']",
    "[class*='content']"
  ] as const

  for (const selector of contentSelectors) {
    const candidate = messageElement.querySelector<HTMLElement>(selector)
    const content = normalizeGenericCaptureText(candidate?.innerText || candidate?.textContent || "")
    if (content.length > 1 && !isLikelyGrokUiNoiseText(content)) {
      return content
    }
  }

  const rawFallbackContent = normalizeGenericCaptureText(messageElement.innerText || messageElement.textContent || "")
  if (isLikelyGrokUiNoiseText(rawFallbackContent)) {
    return ""
  }

  return rawFallbackContent
}

function normalizeGrokConversationTurns(
  turns: Array<{ role: CaptureConversationRole; content: string }>
): Array<{ role: CaptureConversationRole; content: string }> {
  return canonicalizeConversationTurns(turns, {
    normalizeText: (value) => normalizeGenericCaptureText(value),
    buildContentKey: (value) => normalizeTitleComparisonKey(value),
    isNoise: (value) => isLikelyGrokUiNoiseText(value) || isLikelyMindDockEchoContent(value),
    minLength: 2,
    dropAggregateWrappers: true,
    aggregateMinChars: 90,
    aggregateMinLines: 3,
    maxEmbeddedFragments: 1
  }).map((turn) => ({
    role: turn.role as CaptureConversationRole,
    content: turn.content
  }))
}

function buildGrokPreparedCapture(_currentUrl: string): PreparedCapturePayload | null {
  const sourceTitle = resolveGrokConversationTitle()
  const emptyCapture = buildEmptyChatPreparedCapture("Grok", sourceTitle)
  const timeline = resolveActiveGrokTimelineRoot()
  if (!timeline) {
    return emptyCapture
  }

  const preferScopedLayoutCapture = isXTwitterHostForGrok(_currentUrl)
  if (preferScopedLayoutCapture) {
    const scopedConversation = collectGrokLayoutConversation(timeline)
    if (scopedConversation.length > 0) {
      const normalizedScopedConversation = normalizeGrokConversationTurns(scopedConversation).slice(-GROK_MAX_CAPTURE_TURNS)
      const scopedLength = normalizedScopedConversation.reduce((sum, turn) => sum + turn.content.length, 0)
      if (normalizedScopedConversation.length > 0 && scopedLength >= 6) {
        return {
          sourceKind: "chat",
          sourcePlatform: "Grok",
          sourceTitle,
          conversation: normalizedScopedConversation
        }
      }
    }
  }

  const composerRect = resolveGrokComposerRect(timeline)

  let rawItems = Array.from(
    timeline.querySelectorAll<HTMLElement>(
      "[data-testid*='conversation-turn'], [data-testid*='message'], [data-testid*='response'], [data-role='user'], [data-role='assistant'], div[class*='message-bubble'], div[class*='chat-item'], div[class*='message']"
    )
  )

  if (rawItems.length === 0) {
    rawItems = Array.from(timeline.querySelectorAll<HTMLElement>("article, [dir='auto'], p"))
  }

  if (rawItems.length === 0) {
    const layoutFallbackConversation = collectGrokLayoutConversation(timeline)
    if (layoutFallbackConversation.length === 0) {
      return emptyCapture
    }

    const normalizedFallbackConversation = normalizeGrokConversationTurns(layoutFallbackConversation)
    if (normalizedFallbackConversation.length === 0) {
      return emptyCapture
    }

    return {
      sourceKind: "chat",
      sourcePlatform: "Grok",
      sourceTitle,
      conversation: normalizedFallbackConversation.slice(-GROK_MAX_CAPTURE_TURNS)
    }
  }

  // Keep only outer candidates to avoid duplicated nested captures.
  rawItems = rawItems.filter(
    (item, itemIndex) =>
      !rawItems.some(
        (otherItem, otherIndex) => otherIndex !== itemIndex && otherItem !== item && otherItem.contains(item)
      )
  )

  const conversation: Array<{ role: CaptureConversationRole; content: string }> = []
  const seen = new Set<string>()

  for (const item of rawItems) {
    if (!isViewportVisibleElement(item)) {
      continue
    }

    const itemRect = item.getBoundingClientRect()
    if (composerRect) {
      if (itemRect.bottom >= composerRect.top - 8) {
        continue
      }

      const maxSideDistance = Math.max(180, composerRect.width * 0.75)
      if (
        itemRect.right < composerRect.left - maxSideDistance ||
        itemRect.left > composerRect.right + maxSideDistance
      ) {
        continue
      }
    }

    const content = resolveGrokMessageContent(item)
    if (content.length < 2) {
      continue
    }

    if (isLikelyMindDockEchoContent(content)) {
      continue
    }

    const role = resolveGrokMessageRole(item)
    const dedupeKey = `${role}:${normalizeTitleComparisonKey(content)}`
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue
    }

    seen.add(dedupeKey)
    conversation.push({ role, content })
  }

  if (conversation.length === 0) {
    const layoutFallbackConversation = collectGrokLayoutConversation(timeline)
    if (layoutFallbackConversation.length > 0) {
      conversation.push(...layoutFallbackConversation)
    }
  } else {
    const layoutFallbackConversation = collectGrokLayoutConversation(timeline)
    if (layoutFallbackConversation.length > 0) {
      for (const candidate of layoutFallbackConversation) {
        const dedupeKey = `${candidate.role}:${normalizeTitleComparisonKey(candidate.content)}`
        if (!dedupeKey || seen.has(dedupeKey)) {
          continue
        }

        seen.add(dedupeKey)
        conversation.push(candidate)
      }
    }
  }

  const compactConversation = conversation.filter((turn, index, list) => {
    const currentKey = normalizeTitleComparisonKey(turn.content)
    if (!currentKey) {
      return false
    }

    if (index === 0) {
      return true
    }

    const previousKey = normalizeTitleComparisonKey(list[index - 1]?.content ?? "")
    return currentKey !== previousKey
  })

  const normalizedConversation = normalizeGrokConversationTurns(compactConversation).slice(-GROK_MAX_CAPTURE_TURNS)
  const totalContentLength = normalizedConversation.reduce((sum, turn) => sum + turn.content.length, 0)
  if (normalizedConversation.length === 0 || totalContentLength < 6) {
    return emptyCapture
  }

  return {
    sourceKind: "chat",
    sourcePlatform: "Grok",
    sourceTitle,
    conversation: normalizedConversation
  }
}

function buildRedditLegacyPreparedCapture(currentUrl: string): PreparedCapturePayload | null {
  const postRoot = queryFirstVisibleElement([
    "shreddit-post",
    "article[data-testid='post-container']",
    "main article"
  ])
  if (!postRoot) {
    return null
  }

  const title = normalizeGenericCaptureText(
    postRoot.getAttribute("post-title") || postRoot.querySelector("h1[id^='post-title-']")?.textContent || ""
  )
  const author = normalizeString(postRoot.getAttribute("author") || "")
  const createdAt = normalizeString(postRoot.getAttribute("created-timestamp") || "")
  const subreddit = normalizeString(postRoot.getAttribute("subreddit-prefixed-name") || "")
  const rawPermalink = normalizeString(postRoot.getAttribute("permalink") || "")

  let normalizedPermalink = currentUrl
  if (rawPermalink) {
    if (/^https?:\/\//i.test(rawPermalink)) {
      normalizedPermalink = rawPermalink
    } else {
      normalizedPermalink = `https://www.reddit.com${rawPermalink.startsWith("/") ? "" : "/"}${rawPermalink}`
    }
  }

  const contentCandidates = [
    normalizeGenericCaptureText(
      stripMarkdownBoldFormatting(
        postRoot.getAttribute("data-full-content") ||
        postRoot.getAttribute("data-content") ||
        postRoot.getAttribute("content") ||
        ""
      )
    ),
    normalizeGenericCaptureText(stripMarkdownBoldFormatting(postRoot.querySelector(".md.text-14-scalable")?.textContent || "")),
    normalizeGenericCaptureText(
      stripMarkdownBoldFormatting(
        postRoot.querySelector("[data-full-content], [data-expanded-content], .expanded-content")?.textContent || ""
      )
    ),
    normalizeGenericCaptureText(stripMarkdownBoldFormatting(postRoot.querySelector("shreddit-post-text-body")?.textContent || ""))
  ]

  const body =
    contentCandidates.find((candidate) => candidate.length > 0) ||
    normalizeGenericCaptureText(
      Array.from(postRoot.querySelectorAll("p, div, span, li"))
        .map((element) => normalizeGenericCaptureText(stripMarkdownBoldFormatting(element.textContent || "")))
        .filter(Boolean)
        .slice(0, 80)
        .join("\n")
    )

  const lines = [
    title ? `Title: ${title}` : "",
    author ? `Author: ${author}` : "",
    [subreddit ? `Subreddit: ${subreddit}` : "", createdAt ? `Posted: ${createdAt}` : "", `Link: ${normalizedPermalink}`]
      .filter(Boolean)
      .join(" | "),
    "",
    body || "Sem conteudo textual detectado."
  ].filter(Boolean)

  const formattedContent = normalizeGenericCaptureText(lines.join("\n"))
  if (!formattedContent) {
    return null
  }

  return {
    sourceKind: "chat",
    sourcePlatform: "Reddit",
    sourceTitle,
    conversation: [
      {
        role: "user",
        content: formattedContent
      }
    ]
  }
}

async function buildRedditPreparedCapture(
  currentUrl: string,
  preferredPostRoot: HTMLElement | null = null
): Promise<PreparedCapturePayload | null> {
  try {
    const captured = await captureRedditPostOrThread(preferredPostRoot, {
      includeComments: true,
      expandComments: true,
      maxComments: 180,
      maxCharsPerMessage: 12_000,
      skipDeletedComments: true
    })

    if (captured && captured.messages.length > 0) {
      const conversation = captured.messages
        .map((message): { role: CaptureConversationRole; content: string } => ({
          role: "user",
          content: normalizeGenericCaptureText(stripMarkdownBoldFormatting(message.content))
        }))
        .filter((message) => message.content.length > 0)

      if (conversation.length > 0) {
        const sourceTitle = resolveBestSourceTitle([
          normalizeString(captured.postTitle),
          resolveSafeCaptureTitle(),
          document.title,
          "Post do Reddit"
        ])

        return {
          sourceKind: "chat",
          sourcePlatform: "Reddit",
          sourceTitle,
          conversation
        }
      }
    }
  } catch {
    // silent fallback
  }

  return buildRedditLegacyPreparedCapture(currentUrl)
}

function buildXSingleTweetPreparedCapture(currentUrl: string, root: ParentNode = document): PreparedCapturePayload | null {
  const tweet = findPrimaryXTweetArticle(root)
  if (!tweet) {
    return null
  }

  const tweetText = extractXTweetText(tweet)

  const userBlock = tweet.querySelector("div[data-testid='User-Name']")
  const handle = extractXHandleFromUserBlock(userBlock)
  const displayName = extractXDisplayNameFromUserBlock(userBlock)
  const permalink = extractXPermalinkFromTweet(tweet) || currentUrl
  const statusId = parseStatusIdFromUrl(permalink)

  const authorLabel =
    displayName || handle ? `Author: ${displayName || handle}${handle ? ` (@${handle})` : ""}` : ""

  const fallbackTweetText = normalizeGenericCaptureText(
    [
      displayName || handle ? `Post de ${displayName || `@${handle}`}` : "",
      statusId ? `Status ID: ${statusId}` : ""
    ]
      .filter(Boolean)
      .join(" - ")
  )
  const captureBodyText = tweetText || fallbackTweetText || "Post do X sem texto visivel."

  const sourceTitle = resolveXSourceTitleFromTweet(captureBodyText, displayName, handle, permalink)

  const singleContent = normalizeGenericCaptureText(
    [normalizeString(permalink) ? `Source: ${permalink}` : "", authorLabel, "", captureBodyText]
      .filter(Boolean)
      .join("\n")
  )

  if (!singleContent) {
    return null
  }

  return {
    sourceKind: "chat",
    sourcePlatform: "X",
    sourceTitle,
    conversation: [
      {
        role: "user",
        content: singleContent
      }
    ]
  }
}

function buildXThreadPreparedCapture(currentUrl: string): PreparedCapturePayload | null {
  const timeline = queryFirstVisibleElement([
    "div[aria-label='Timeline: Conversation']",
    "section[aria-label='Timeline: Conversation']",
    "main"
  ])

  if (!timeline) {
    return buildXSingleTweetPreparedCapture(currentUrl)
  }

  const primaryTweet = findPrimaryXTweetArticle(timeline)
  if (!primaryTweet) {
    return buildXSingleTweetPreparedCapture(currentUrl)
  }

  const primaryUserBlock = primaryTweet.querySelector("div[data-testid='User-Name']")
  const opHandle = extractXHandleFromUserBlock(primaryUserBlock)
  const opDisplayName = extractXDisplayNameFromUserBlock(primaryUserBlock)
  if (!opHandle) {
    return buildXSingleTweetPreparedCapture(currentUrl, timeline)
  }

  const showMoreLinks = Array.from(
    timeline.querySelectorAll("[data-testid='tweet-text-show-more-link']")
  ).slice(0, 10)

  for (const link of showMoreLinks) {
    if (!(link instanceof HTMLElement)) {
      continue
    }

    const tweet = link.closest("article[data-testid='tweet']")
    if (!tweet) {
      continue
    }

    const tweetHandle = extractXHandleFromUserBlock(tweet.querySelector("div[data-testid='User-Name']"))
    if (tweetHandle && tweetHandle !== opHandle) {
      continue
    }

    try {
      link.click()
    } catch {
      // best effort
    }
  }

  const tweets = Array.from(timeline.querySelectorAll("article[data-testid='tweet']")).filter(isVisibleElement)
  if (tweets.length === 0) {
    return buildXSingleTweetPreparedCapture(currentUrl, timeline)
  }

  const dedupeByStatusId = new Set<string>()
  const dedupeByText = new Set<string>()
  const segments: Array<{ text: string; url: string }> = []

  for (const tweet of tweets) {
    const tweetHandle = extractXHandleFromUserBlock(tweet.querySelector("div[data-testid='User-Name']"))
    if (tweetHandle && tweetHandle !== opHandle) {
      continue
    }

    if (isXSideConversationReply(tweet, opHandle)) {
      continue
    }

    const tweetText = extractXTweetText(tweet)
    if (!tweetText) {
      continue
    }

    const textKey = normalizeTitleComparisonKey(tweetText)
    if (!textKey || dedupeByText.has(textKey)) {
      continue
    }

    const statusUrl = extractXPermalinkFromTweet(tweet) || currentUrl
    const statusId = parseStatusIdFromUrl(statusUrl)
    if (statusId && dedupeByStatusId.has(statusId)) {
      continue
    }

    if (statusId) {
      dedupeByStatusId.add(statusId)
    }

    dedupeByText.add(textKey)
    segments.push({ text: tweetText, url: statusUrl })

    if (segments.length >= X_THREAD_MAX_SEGMENTS) {
      break
    }
  }

  if (segments.length === 0) {
    return buildXSingleTweetPreparedCapture(currentUrl, timeline)
  }

  const sourceUrl = normalizeString(segments[0]?.url) || currentUrl
  const sourceTitle = resolveXSourceTitleFromTweet(
    normalizeString(segments[0]?.text || ""),
    opDisplayName,
    opHandle,
    normalizeString(sourceUrl)
  )
  const total = segments.length
  const conversation = segments.map((segment, index) => ({
    role: "user" as const,
    content:
      index === 0
        ? `Source: ${sourceUrl}\n\n[${index + 1}/${total}]\n${segment.text}`
        : `[${index + 1}/${total}]\n${segment.text}`
  }))

  try {
    window.scrollTo({ top: 0 })
  } catch {
    // no-op
  }

  return {
    sourceKind: "chat",
    sourcePlatform: "X",
    sourceTitle,
    conversation
  }
}

interface SiteCaptureProfile {
  id: string
  matches: (params: { currentUrl: string; host: string }) => boolean
  build: (
    currentUrl: string,
    options: CaptureResolutionOptions
  ) => PreparedCapturePayload | null | Promise<PreparedCapturePayload | null>
}

function resolveCaptureHost(currentUrl: string): string {
  try {
    return new URL(currentUrl).hostname.toLowerCase()
  } catch {
    return window.location.hostname.toLowerCase()
  }
}

const SITE_CAPTURE_PROFILES: SiteCaptureProfile[] = [
  {
    id: "google-docs",
    matches: ({ host }) => host.includes("docs.google.com"),
    build: (currentUrl) => buildGoogleDocsPreparedCapture(currentUrl)
  },
  {
    id: "linkedin",
    matches: ({ host }) => host.includes("linkedin.com"),
    build: (currentUrl, options) =>
      buildLinkedInPreparedCapture(
        currentUrl,
        normalizeString(options.linkedInPostUrn) || null,
        options.linkedInPostRoot ?? null,
        options.linkedInSnapshot ?? null
      )
  },
  {
    id: "genspark",
    matches: ({ host }) => host.includes("genspark.ai") || host.includes("genspark.im"),
    build: (currentUrl) => buildGensparkPreparedCapture(currentUrl)
  },
  {
    id: "openevidence",
    matches: ({ host }) => host.includes("openevidence.com"),
    build: (currentUrl) => buildOpenEvidencePreparedCapture(currentUrl)
  },
  {
    id: "perplexity",
    matches: ({ host }) => host.includes("perplexity.ai"),
    build: (currentUrl) => buildPerplexityPreparedCapture(currentUrl)
  },
  {
    id: "grok",
    matches: ({ currentUrl, host }) => isGrokRouteUrl(currentUrl) || host.includes("grok.com"),
    build: (currentUrl) => buildGrokPreparedCapture(currentUrl)
  },
  {
    id: "kimi",
    matches: ({ host }) => host.includes("kimi.com") || host.includes("moonshot.cn"),
    build: (currentUrl) => buildKimiPreparedCapture(currentUrl)
  },
  {
    id: "reddit",
    matches: ({ host }) => host.includes("reddit.com"),
    build: (currentUrl, options) => buildRedditPreparedCapture(currentUrl, options.redditPostRoot ?? null)
  },
  {
    id: "x-thread",
    matches: ({ host }) => host.includes("x.com") || host.includes("twitter.com"),
    build: (currentUrl) => buildXThreadPreparedCapture(currentUrl)
  }
]

async function buildSiteSpecificPreparedCapture(
  currentUrl: string,
  options: CaptureResolutionOptions = {}
): Promise<PreparedCapturePayload | null> {
  const host = resolveCaptureHost(currentUrl)

  for (const profile of SITE_CAPTURE_PROFILES) {
    if (!profile.matches({ currentUrl, host })) {
      continue
    }

    const capture = await profile.build(currentUrl, options)
    if (capture) {
      return capture
    }
  }

  return null
}

async function resolvePreparedCaptureForCurrentPage(
  currentUrl: string,
  preferredNotebookId?: string,
  options: CaptureResolutionOptions = {}
): Promise<PreparedCapturePayload> {
  const captureConfig = resolveCaptureConfig(currentUrl)

  if (captureConfig) {
    const captureInput = await buildDomChatCaptureInputAsync({
      platform: captureConfig.platform,
      platformLabel: captureConfig.platformLabel,
      title: resolveSafeCaptureTitle(),
      messageSelectors: captureConfig.messageSelectors,
      containerSelectors: captureConfig.containerSelectors,
      resolveRole: captureConfig.resolveRole,
      capturedFromUrl: currentUrl,
      preferredNotebookId
    })

    return {
      sourceKind: "chat",
      sourcePlatform: normalizeString(captureInput.platformLabel) || captureConfig.platformLabel,
      sourceTitle: normalizeString(captureInput.title),
      conversation: normalizeConversation(captureInput.messages)
    }
  }

  return await buildGenericPagePreparedCapture(currentUrl, options)
}

function normalizeConversation(
  messages: Array<{ role?: string; content?: unknown }>
): Array<{ role: CaptureConversationRole; content: string }> {
  return messages
    .map((message): { role: CaptureConversationRole; content: string } => ({
      role:
        message.role === "document"
          ? "document"
          : message.role === "assistant"
          ? "assistant"
          : "user",
      content: normalizeString(message.content)
    }))
    .filter((message) => message.content.length > 0)
}

async function readLocalStorage(keys: string[]): Promise<StorageSnapshot> {
  const localApi = typeof chrome !== "undefined" ? chrome.storage?.local : undefined

  if (!localApi?.get) {
    return {}
  }

  return new Promise((resolve) => {
    try {
      localApi.get(keys, (snapshot) => {
        if (chrome.runtime?.lastError) {
          resolve({})
          return
        }
        resolve((snapshot as StorageSnapshot) ?? {})
      })
    } catch {
      resolve({})
    }
  })
}

async function writeLocalStorage(values: Record<string, unknown>): Promise<void> {
  const localApi = typeof chrome !== "undefined" ? chrome.storage?.local : undefined

  if (!localApi?.set) {
    return
  }

  await new Promise<void>((resolve) => {
    try {
      localApi.set(values, () => {
        void chrome.runtime?.lastError
        resolve()
      })
    } catch {
      resolve()
    }
  })
}

function resolveRequestTimeoutSeconds(errorCode: string): number | null {
  const match = String(errorCode ?? "").match(/^REQUEST_TIMEOUT_(\d+)MS$/i)
  if (!match?.[1]) {
    return null
  }

  const parsedMs = Number(match[1])
  if (!Number.isFinite(parsedMs) || parsedMs <= 0) {
    return null
  }

  return Math.ceil(parsedMs / 1000)
}

async function sendRuntimeMessage<T = Record<string, unknown>>(
  command: string,
  payload: unknown,
  options?: { timeoutMs?: number }
): Promise<ChromeMessageResponse<T>> {
  const runtimeApi = typeof chrome !== "undefined" ? chrome.runtime : undefined
  const timeoutMs = Math.max(500, options?.timeoutMs ?? 15_000)

  if (!runtimeApi?.sendMessage) {
    return {
      success: false,
      error: "CHROME_RUNTIME_UNAVAILABLE"
    }
  }

  return new Promise((resolve) => {
    let settled = false
    const timeoutId = window.setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      resolve({
        success: false,
        error: `REQUEST_TIMEOUT_${timeoutMs}MS`
      })
    }, timeoutMs)

    const settle = (response: ChromeMessageResponse<T>): void => {
      if (settled) {
        return
      }

      settled = true
      window.clearTimeout(timeoutId)
      resolve(response)
    }

    try {
      runtimeApi.sendMessage({ command, payload }, (response) => {
        const runtimeError = normalizeString(runtimeApi.lastError?.message)
        if (runtimeError) {
          settle({
            success: false,
            error: runtimeError
          })
          return
        }

        settle(
          (response as ChromeMessageResponse<T> | undefined) ?? {
            success: false,
            error: "NO_RESPONSE"
          }
        )
      })
    } catch (error) {
      settle({
        success: false,
        error: error instanceof Error ? error.message : "SEND_MESSAGE_FAILED"
      })
    }
  })
}

async function readResyncBindings(): Promise<Record<string, ChatResyncBinding>> {
  const snapshot = await readLocalStorage([RESYNC_BINDINGS_KEY])
  return parseResyncBindings(snapshot[RESYNC_BINDINGS_KEY])
}

async function persistConversationResyncBinding(
  currentUrl: string,
  notebookId: string,
  notebookTitle: string,
  sourceId?: string,
  lastHash?: string
): Promise<void> {
  const normalizedNotebookId = normalizeString(notebookId)
  if (!normalizedNotebookId) {
    return
  }

  const resyncKeys = resolveConversationResyncKeys(currentUrl)
  if (resyncKeys.length === 0) {
    return
  }

  const bindings = await readResyncBindings()
  const existingBinding = resolveBestResyncBinding(bindings, resyncKeys)
  const normalizedSourceId = normalizeString(sourceId)
  const normalizedLastHash = normalizeString(lastHash)
  const nextBinding: ChatResyncBinding = {
    notebookId: normalizedNotebookId,
    notebookTitle:
      normalizeString(notebookTitle) || existingBinding?.notebookTitle || DEFAULT_NOTEBOOK_TITLE,
    sourceId: normalizedSourceId || existingBinding?.sourceId,
    lastHash: normalizedLastHash || existingBinding?.lastHash,
    updatedAt: new Date().toISOString()
  }
  for (const resyncKey of resyncKeys) {
    bindings[resyncKey] = nextBinding
  }

  const trimmed = Object.fromEntries(
    Object.entries(bindings)
      .sort((left, right) => {
        const l = Date.parse(left[1].updatedAt)
        const r = Date.parse(right[1].updatedAt)
        if (!Number.isFinite(l) || !Number.isFinite(r)) {
          return 0
        }
        return r - l
      })
      .slice(0, MAX_RESYNC_BINDINGS)
  )

  await writeLocalStorage({
    [RESYNC_BINDINGS_KEY]: trimmed
  })
}

async function persistSyncedConversationInfo(
  currentUrl: string,
  notebookId: string,
  sourceTitle: string,
  sourceId?: string,
  syncedAtMs = Date.now()
): Promise<SyncedConversationRecord | null> {
  const normalizedNotebookId = normalizeString(notebookId)
  if (!normalizedNotebookId) {
    return null
  }

  const identity = buildConversationResyncIdentity(currentUrl)
  const normalizedSourceId = normalizeString(sourceId)
  const normalizedSourceTitle = normalizeString(sourceTitle)
  const normalizedSyncedAt = normalizeSyncedAt(syncedAtMs) || Date.now()
  const conversationScopedKey = identity.conversationId ? `${identity.platform}:${identity.conversationId}` : ""

  const snapshot = await readLocalStorage([SYNCED_CONVERSATIONS_KEY])
  const existingStore = parseSyncedConversations(snapshot[SYNCED_CONVERSATIONS_KEY])
  const existingRecord = resolveSyncedConversationInfo(existingStore, currentUrl)

  const nextRecord: SyncedConversationRecord = {
    url: identity.normalizedUrl,
    conversationId: identity.conversationId,
    platform: identity.platform,
    notebookId: normalizedNotebookId,
    title: normalizedSourceTitle || existingRecord?.title || null,
    sourceId: normalizedSourceId || existingRecord?.sourceId || null,
    syncedAt: normalizedSyncedAt
  }

  existingStore[identity.normalizedUrl] = nextRecord
  if (identity.primaryKey) {
    existingStore[identity.primaryKey] = nextRecord
  }
  if (conversationScopedKey) {
    existingStore[conversationScopedKey] = nextRecord
  }

  await writeLocalStorage({
    [SYNCED_CONVERSATIONS_KEY]: existingStore
  })

  return nextRecord
}

async function persistPreferredNotebookId(notebookId: string): Promise<void> {
  const normalizedNotebookId = normalizeString(notebookId)
  if (!normalizedNotebookId) {
    return
  }

  const snapshot = await readLocalStorage([
    SETTINGS_KEY,
    AUTH_USER_KEY,
    ACCOUNT_EMAIL_KEY,
    TOKEN_STORAGE_KEY
  ])
  const settings = isRecord(snapshot[SETTINGS_KEY]) ? snapshot[SETTINGS_KEY] : {}
  const accountScope = resolveNotebookAccountScopeFromSnapshot(snapshot)
  if (!accountScope.confirmed) {
    return
  }

  const accountKey = accountScope.accountKey

  const defaultByAccount = isRecord(settings.defaultNotebookByAccount)
    ? (settings.defaultNotebookByAccount as Record<string, unknown>)
    : {}

  const scopedDefaultKey = buildScopedStorageKey(DEFAULT_NOTEBOOK_KEY, accountKey)
  const scopedLegacyDefaultKey = buildScopedStorageKey(LEGACY_DEFAULT_NOTEBOOK_KEY, accountKey)

  const nextSettings: Record<string, unknown> = {
    ...settings,
    defaultNotebookByAccount: {
      ...defaultByAccount,
      [accountKey]: normalizedNotebookId
    }
  }

  const storagePatch: StorageSnapshot = {
    [scopedDefaultKey]: normalizedNotebookId,
    [scopedLegacyDefaultKey]: normalizedNotebookId,
    [SETTINGS_KEY]: nextSettings
  }

  await writeLocalStorage(storagePatch)
}

function useUrlWatcher(): string {
  const [currentUrl, setCurrentUrl] = useState(() => window.location.href)

  useEffect(() => {
    const globalRecord = window as typeof window & Record<string, unknown>

    if (!globalRecord[HISTORY_PATCH_KEY]) {
      const originalPushState = history.pushState.bind(history)
      const originalReplaceState = history.replaceState.bind(history)

      history.pushState = function patchedPushState(...args: Parameters<History["pushState"]>) {
        const result = originalPushState(...args)
        window.dispatchEvent(new CustomEvent(URL_CHANGE_EVENT))
        return result
      }

      history.replaceState = function patchedReplaceState(...args: Parameters<History["replaceState"]>) {
        const result = originalReplaceState(...args)
        window.dispatchEvent(new CustomEvent(URL_CHANGE_EVENT))
        return result
      }

      globalRecord[HISTORY_PATCH_KEY] = true
    }

    let lastUrl = window.location.href
    let frameId = 0
    let domObserver: MutationObserver | null = null
    let bodyObserver: MutationObserver | null = null

    const syncUrlIfChanged = (): void => {
      const nextUrl = window.location.href
      if (nextUrl === lastUrl) {
        return
      }

      lastUrl = nextUrl
      setCurrentUrl(nextUrl)
    }

    const scheduleSyncUrl = (): void => {
      if (frameId !== 0) {
        return
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = 0
        syncUrlIfChanged()
      })
    }

    const startDomObserver = (): void => {
      if (!(document.body instanceof HTMLBodyElement) || domObserver) {
        return
      }

      domObserver = new MutationObserver(() => {
        scheduleSyncUrl()
      })

      domObserver.observe(document.body, { childList: true, subtree: true })
    }

    startDomObserver()

    if (!domObserver) {
      bodyObserver = new MutationObserver(() => {
        if (document.body instanceof HTMLBodyElement) {
          startDomObserver()
          bodyObserver?.disconnect()
          bodyObserver = null
        }
      })

      bodyObserver.observe(document.documentElement, { childList: true, subtree: true })
    }

    window.addEventListener("popstate", syncUrlIfChanged)
    window.addEventListener("hashchange", syncUrlIfChanged)
    window.addEventListener(URL_CHANGE_EVENT, syncUrlIfChanged as EventListener)

    return () => {
      window.removeEventListener("popstate", syncUrlIfChanged)
      window.removeEventListener("hashchange", syncUrlIfChanged)
      window.removeEventListener(URL_CHANGE_EVENT, syncUrlIfChanged as EventListener)

      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId)
      }

      domObserver?.disconnect()
      bodyObserver?.disconnect()
    }
  }, [])

  return currentUrl
}

function useNotebookRepository(): UseNotebookRepositoryResult {
  const [notebooks, setNotebooks] = useState<NotebookOption[]>([])
  const [activeNotebookId, setActiveNotebookId] = useState("")
  const [syncedAt, setSyncedAt] = useState("")
  const [isLoading, setIsLoading] = useState(true)

  const refresh = useCallback(async () => {
    setIsLoading(true)

    try {
      const notebooksResponse = await sendRuntimeMessage<NotebookOption[]>(GET_NOTEBOOKS_COMMAND, {})
      const responsePayload = Array.isArray(notebooksResponse.payload)
        ? notebooksResponse.payload
        : Array.isArray(notebooksResponse.data)
        ? notebooksResponse.data
        : []

      const baseSnapshot = await readLocalStorage([
        SETTINGS_KEY,
        AUTH_USER_KEY,
        ACCOUNT_EMAIL_KEY,
        TOKEN_STORAGE_KEY,
        DEFAULT_NOTEBOOK_KEY,
        LEGACY_DEFAULT_NOTEBOOK_KEY,
        NOTEBOOK_CACHE_KEY_BASE,
        NOTEBOOK_CACHE_SYNC_KEY_BASE
      ])

      const accountScope = resolveNotebookAccountScopeFromSnapshot(baseSnapshot)
      if (!accountScope.confirmed) {
        setNotebooks([])
        setSyncedAt("")
        setActiveNotebookId("")
        console.warn(
          "[MindDock] Conta do NotebookLM nao confirmada. Lista/sync locais bloqueados no modo estrito."
        )
        return
      }

      const accountKey = accountScope.accountKey
      const scopedCacheKey = buildScopedStorageKey(NOTEBOOK_CACHE_KEY_BASE, accountKey)
      const scopedCacheSyncKey = buildScopedStorageKey(NOTEBOOK_CACHE_SYNC_KEY_BASE, accountKey)
      const scopedDefaultKey = buildScopedStorageKey(DEFAULT_NOTEBOOK_KEY, accountKey)
      const scopedLegacyDefaultKey = buildScopedStorageKey(LEGACY_DEFAULT_NOTEBOOK_KEY, accountKey)

      const scopedSnapshot = await readLocalStorage([
        scopedCacheKey,
        scopedCacheSyncKey,
        scopedDefaultKey,
        scopedLegacyDefaultKey
      ])

      const snapshot: StorageSnapshot = { ...baseSnapshot, ...scopedSnapshot }

      const cachedNotebooks = normalizeNotebookEntries(snapshot[scopedCacheKey])

      let resolvedNotebooks = normalizeNotebookEntries(responsePayload)
      let resolvedSyncedAt = new Date().toISOString()

      if (!STRICT_NOTEBOOK_ACCOUNT_MODE) {
        if (resolvedNotebooks.length === 0) {
          if (cachedNotebooks.length > 0) {
            resolvedNotebooks = cachedNotebooks
            resolvedSyncedAt = normalizeString(snapshot[scopedCacheSyncKey]) || resolvedSyncedAt
          }
        } else if (resolvedNotebooks.length <= 1 && cachedNotebooks.length > resolvedNotebooks.length) {
          const mergedNotebooks = mergeNotebookOptions(resolvedNotebooks, cachedNotebooks)
          if (mergedNotebooks.length > resolvedNotebooks.length) {
            resolvedNotebooks = mergedNotebooks
            resolvedSyncedAt = normalizeString(snapshot[scopedCacheSyncKey]) || resolvedSyncedAt
            console.warn("[MindDock] Lista parcial detectada no live. Merge no escopo da conta atual.")
          }
        }
      } else if (!notebooksResponse.success && resolvedNotebooks.length === 0 && cachedNotebooks.length > 0) {
        console.warn(
          "[MindDock] Modo estrito ativo: lista live falhou e cache local foi ignorado para evitar mistura de conta."
        )
      } else if (resolvedNotebooks.length === 0 && cachedNotebooks.length > 0) {
        // Keep sync label when live is empty to avoid stale UI hints.
        if (!notebooksResponse.success) {
          resolvedSyncedAt = normalizeString(snapshot[scopedCacheSyncKey]) || resolvedSyncedAt
        }
      }

      setNotebooks(resolvedNotebooks)
      setSyncedAt(resolvedNotebooks.length > 0 ? resolvedSyncedAt : "")

      if (!notebooksResponse.success && resolvedNotebooks.length === 0) {
        console.warn("[MindDock] Falha ao carregar notebooks e nenhum cache local disponivel.", {
          error: normalizeString(notebooksResponse.error) || "UNKNOWN"
        })
      }

      setActiveNotebookId(resolvePreferredNotebookId(snapshot, accountScope))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const runtimeApi = typeof chrome !== "undefined" ? chrome.runtime : undefined
    if (!runtimeApi?.onMessage) {
      return
    }

    const handleMessage = (
      message: { command?: unknown },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: ChromeMessageResponse<Record<string, unknown>>) => void
    ): void => {
      const command = normalizeString(message?.command)

      if (command === NOTEBOOK_CACHE_UPDATED_COMMAND) {
        void refresh()
        return
      }

      if (command === PAGE_METADATA_COMMAND) {
        sendResponse({
          success: true,
          payload: {
            title: resolveSafeCaptureTitle(),
            url: window.location.href
          }
        })
      }
    }

    runtimeApi.onMessage.addListener(handleMessage)

    return () => {
      runtimeApi.onMessage.removeListener(handleMessage)
    }
  }, [refresh])

  return { notebooks, activeNotebookId, syncedAt, isLoading, refresh }
}

function useSmartCapture(
  currentUrl: string,
  activeNotebookId: string,
  captureOptions: CaptureResolutionOptions = {}
): UseSmartCaptureResult {
  const [linkedNotebookId, setLinkedNotebookId] = useState<string | null>(null)
  const [linkedSourceId, setLinkedSourceId] = useState<string | null>(null)
  const [linkedSyncInfo, setLinkedSyncInfo] = useState<SyncedConversationRecord | null>(null)
  const [captureState, setCaptureState] = useState<CaptureState>("idle")
  const resetTimerRef = useRef<number | null>(null)

  const scheduleIdleReset = useCallback(() => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current)
    }

    resetTimerRef.current = window.setTimeout(() => {
      setCaptureState("idle")
      resetTimerRef.current = null
    }, 1800)
  }, [])

  useEffect(() => {
    let isActive = true

    const checkLinkedNotebook = async () => {
      if (isGenericConversationUrl(currentUrl)) {
        return
      }

      const resyncKeys = resolveConversationResyncKeys(currentUrl)
      const primaryResyncKey = resyncKeys[0] || resolveConversationResyncKey(currentUrl)
      const legacyExactKey = `${LEGACY_CHAT_LINK_PREFIX}${currentUrl}`
      const legacyNormalizedKey = `${LEGACY_CHAT_LINK_PREFIX}${primaryResyncKey}`
      const snapshot = await readLocalStorage([
        RESYNC_BINDINGS_KEY,
        SYNCED_CONVERSATIONS_KEY,
        CHAT_SOURCE_BINDINGS_KEY,
        legacyExactKey,
        legacyNormalizedKey
      ])

      const bindings = parseResyncBindings(snapshot[RESYNC_BINDINGS_KEY])
      const selectedBinding = resolveBestResyncBinding(bindings, resyncKeys)
      const syncedInfo = resolveSyncedConversationInfo(
        snapshot[SYNCED_CONVERSATIONS_KEY],
        currentUrl
      )
      let linkedId = normalizeString(selectedBinding?.notebookId)
      let sourceId = normalizeString(selectedBinding?.sourceId)

      if (!linkedId && normalizeString(syncedInfo?.notebookId)) {
        linkedId = normalizeString(syncedInfo?.notebookId)
      }
      if (!sourceId && normalizeString(syncedInfo?.sourceId)) {
        sourceId = normalizeString(syncedInfo?.sourceId)
      }

      const fallbackSourceBinding = resolveLinkedFromChatSourceBindings(
        snapshot[CHAT_SOURCE_BINDINGS_KEY],
        resyncKeys
      )
      if (!linkedId && fallbackSourceBinding?.notebookId) {
        linkedId = fallbackSourceBinding.notebookId
      }
      if (!sourceId && fallbackSourceBinding?.sourceId) {
        sourceId = fallbackSourceBinding.sourceId
      }

      if (!linkedId) {
        linkedId =
          resolveLegacyLinkedNotebookId(snapshot[legacyExactKey]) ||
          resolveLegacyLinkedNotebookId(snapshot[legacyNormalizedKey])
      }

      if (linkedId && !selectedBinding) {
        await persistConversationResyncBinding(
          currentUrl,
          linkedId,
          "",
          sourceId || undefined,
          fallbackSourceBinding?.lastSyncHash
        )
      }

      if (!isActive) {
        return
      }

      setLinkedNotebookId(linkedId || null)
      setLinkedSourceId(sourceId || null)
      setLinkedSyncInfo(syncedInfo)
    }

    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }

    setLinkedNotebookId(null)
    setLinkedSourceId(null)
    setLinkedSyncInfo(null)
    setCaptureState("idle")

    void checkLinkedNotebook()

    return () => {
      isActive = false
    }
  }, [currentUrl])

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const runtimeApi = typeof chrome !== "undefined" ? chrome.runtime : undefined
    if (!runtimeApi?.onMessage?.addListener) {
      return
    }

    const handleRuntimeMessage = (message: unknown): void => {
      if (!isRecord(message)) {
        return
      }

      const command = normalizeString(message.command)
      if (command !== RESYNC_SUCCESS_EVENT) {
        return
      }

      const payload = isRecord(message.payload) ? message.payload : {}
      const payloadUrl = normalizeString(payload.url)
      if (!payloadUrl || !isSameConversationResyncScope(payloadUrl, currentUrl)) {
        return
      }

      const payloadNotebookId = normalizeString(payload.notebookId)
      const payloadSourceId = normalizeString(payload.sourceId)
      const payloadHash = normalizeString(payload.lastHash ?? payload.currentHash ?? payload.contentHash)
      const notebookIdForBinding =
        payloadNotebookId || normalizeString(linkedNotebookId) || normalizeString(activeNotebookId)
      if (!notebookIdForBinding) {
        return
      }

      void persistConversationResyncBinding(
        payloadUrl,
        notebookIdForBinding,
        "",
        payloadSourceId || undefined,
        payloadHash || undefined
      )
      void (async () => {
        const persistedSyncInfo = await persistSyncedConversationInfo(
          payloadUrl,
          notebookIdForBinding,
          "",
          payloadSourceId || undefined
        )
        if (persistedSyncInfo) {
          setLinkedSyncInfo(persistedSyncInfo)
        }
      })()

      if (payloadNotebookId) {
        setLinkedNotebookId(payloadNotebookId)
      }
      if (payloadSourceId) {
        setLinkedSourceId(payloadSourceId)
      }
    }

    runtimeApi.onMessage.addListener(handleRuntimeMessage)
    return () => {
      runtimeApi.onMessage.removeListener(handleRuntimeMessage)
    }
  }, [activeNotebookId, currentUrl, linkedNotebookId])

  const handleCapture = useCallback(
    async (
      notebookId: string,
      isResync: boolean,
      preparedCapture?: PreparedCapturePayload
    ): Promise<ChromeMessageResponse<Record<string, unknown>>> => {
      const explicitNotebookId = normalizeString(notebookId)
      const fallbackNotebookId = isResync ? linkedNotebookId : activeNotebookId
      const targetNotebookId = explicitNotebookId || normalizeString(fallbackNotebookId)

      if (!targetNotebookId) {
        setCaptureState("error")
        scheduleIdleReset()
        return {
          success: false,
          error: "Nenhum notebook selecionado para captura."
        }
      }

      setCaptureState("capturing")

      try {
        const preparedConversation = Array.isArray(preparedCapture?.conversation)
          ? preparedCapture.conversation
          : []

        let sourcePlatform = normalizeString(preparedCapture?.sourcePlatform)
        let extractedSourceTitle = normalizeString(preparedCapture?.sourceTitle)
        let sourceKind = normalizeCaptureSourceKind(preparedCapture?.sourceKind)
        let conversation: Array<{ role: CaptureConversationRole; content: string }> = []

        if (preparedConversation.length > 0) {
          conversation = normalizeConversation(
            preparedConversation.map((message) => ({
              role: message.role,
              content: normalizeString(message.content)
            }))
          )
        } else {
          const pageCapture = await resolvePreparedCaptureForCurrentPage(
            currentUrl,
            targetNotebookId,
            captureOptions
          )
          sourcePlatform = normalizeString(pageCapture.sourcePlatform)
          extractedSourceTitle = normalizeString(pageCapture.sourceTitle)
          sourceKind = normalizeCaptureSourceKind(pageCapture.sourceKind)
          conversation = normalizeConversation(pageCapture.conversation)
        }

        if (!sourcePlatform) {
          sourcePlatform = resolveGenericPlatformLabel(window.location.hostname.toLowerCase())
        }

        const normalizedPlatformKey = normalizeTitleComparisonKey(sourcePlatform)
        let resolvedSourceTitle = resolveBestSourceTitle([
          extractedSourceTitle,
          resolveSafeCaptureTitle(),
          document.title
        ])

        if (normalizedPlatformKey === "x" || normalizedPlatformKey === "twitter") {
          resolvedSourceTitle = resolveBestSourceTitle([
            resolvedSourceTitle,
            extractedSourceTitle,
            resolveXTitleFromConversation(conversation),
            resolveXTitleFromUrl(currentUrl),
            "Post do X"
          ])
        }

        const sourceTitle =
          sourceKind === "doc"
            ? sanitizeSourceTitleCandidate(resolvedSourceTitle).replace(/^\[[^\]]+\]\s*/u, "").trim() ||
              resolveGoogleDocsSourceTitle()
            : buildTaggedSourceTitle(sourcePlatform, resolvedSourceTitle)
        console.log(`[MindDock Fix] Titulo Final para Envio: "${sourceTitle}"`)

        if (conversation.length === 0) {
          setCaptureState("error")
          scheduleIdleReset()
          return {
            success: false,
            error: "Nenhuma mensagem valida foi encontrada para captura."
          }
        }

        console.log("ðŸš€ [MINDDOCK DEBUG] Enviando Captura:", {
          mode: isResync ? "RE-SYNC (SWAP)" : "NEW CAPTURE",
          notebookId: targetNotebookId,
          overwriteSourceId: isResync ? normalizeString(linkedSourceId) || "UNDEFINED (ERRO)" : "N/A"
        })

        const currentHash = await generateContentHash(
          JSON.stringify(
            conversation.map((message) => ({
              role: message.role,
              content: message.content
            }))
          )
        )

        const resyncBindings = await readResyncBindings()
        const currentResyncKeys = resolveConversationResyncKeys(currentUrl)
        const currentBinding = resolveBestResyncBinding(resyncBindings, currentResyncKeys)
        const lastSyncedHash = normalizeString(currentBinding?.lastHash)
        const lastSyncedNotebookId = normalizeString(currentBinding?.notebookId)
        const lastCapturedMessage =
          conversation.length > 0
            ? normalizeString(conversation[conversation.length - 1]?.content).slice(0, 180)
            : ""
        console.log("[MINDDOCK DEBUG] Capture summary:", {
          isResync,
          messageCount: conversation.length,
          currentHash,
          lastSyncedHash,
          targetNotebookId,
          lastSyncedNotebookId,
          lastCapturedMessage
        })
        if (
          !isResync &&
          lastSyncedHash &&
          lastSyncedHash === currentHash &&
          lastSyncedNotebookId === targetNotebookId
        ) {
          setCaptureState("idle")
          return {
            success: false,
            error: NO_CHANGES_DETECTED_ERROR
          }
        }

        const captureTimeoutMs =
          isResync ? RESYNC_RUNTIME_TIMEOUT_MS : sourceKind === "doc" ? 60_000 : 20_000

        const response = await sendRuntimeMessage<Record<string, unknown>>("PROTOCOL_APPEND_SOURCE", {
          notebookId: targetNotebookId,
          sourceTitle,
          sourcePlatform,
          sourceKind,
          conversation,
          capturedFromUrl: currentUrl,
          isResync,
          overwriteSourceId: isResync ? normalizeString(linkedSourceId) || undefined : undefined,
          currentHash
        }, { timeoutMs: captureTimeoutMs })

        const payloadRecord = isRecord(response.payload)
          ? response.payload
          : isRecord(response.data)
          ? response.data
          : {}
        const returnedSourceId = normalizeString(payloadRecord.sourceId)

        if (response.success && !returnedSourceId) {
          setCaptureState("error")
          scheduleIdleReset()
          return {
            success: false,
            error: "NotebookLM nao confirmou a captura (sourceId ausente). Tente novamente."
          }
        }

        if (response.success) {
          const nextSourceId = returnedSourceId || normalizeString(linkedSourceId)

          await persistConversationResyncBinding(
            currentUrl,
            targetNotebookId,
            "",
            nextSourceId,
            currentHash
          )
          const persistedSyncInfo = await persistSyncedConversationInfo(
            currentUrl,
            targetNotebookId,
            sourceTitle,
            nextSourceId,
            Date.now()
          )
          setLinkedNotebookId(targetNotebookId)
          setLinkedSourceId(nextSourceId || null)
          setLinkedSyncInfo(persistedSyncInfo)
          setCaptureState("success")
        } else {
          setCaptureState("error")
        }

        scheduleIdleReset()
        return response
      } catch (error) {
        setCaptureState("error")
        scheduleIdleReset()

        return {
          success: false,
          error: error instanceof Error ? error.message : "Falha inesperada na captura."
        }
      }
    },
    [
      activeNotebookId,
      captureOptions.linkedInPostUrn,
      captureOptions.linkedInPostRoot,
      captureOptions.linkedInSnapshot,
      captureOptions.redditPostRoot,
      currentUrl,
      linkedNotebookId,
      linkedSourceId,
      scheduleIdleReset
    ]
  )

  return { linkedNotebookId, linkedSourceId, linkedSyncInfo, captureState, handleCapture }
}

interface MenuPanelProps {
  activeNotebookId: string
  canShowResync: boolean
  filteredNotebooks: NotebookOption[]
  isBusy: boolean
  isCreatingNotebook: boolean
  isLoadError: boolean
  isLoadingNotebooks: boolean
  isOpen: boolean
  menuAlign: "left" | "right"
  menuVertical?: "above" | "below"
  menuMode: "existing" | "root"
  notebookSyncLabel: string
  onBackToMain: () => void
  onCreateNotebook: () => void
  onNotebookSelect: (notebook: NotebookOption) => void
  onOpenExisting: () => void
  onResync: () => void
  onSearchChange: (value: string) => void
  search: string
}

function MenuPanel(props: MenuPanelProps): JSX.Element {
  return (
    <AnimatePresence mode="wait">
      {props.isOpen ? (
        <motion.div
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className={clsx(
            "absolute z-[2147483647] w-[26rem] max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/90 shadow-[0_30px_80px_rgba(0,0,0,0.6)] backdrop-blur-2xl",
            props.menuVertical === "above" ? "bottom-full mb-3" : "top-full mt-3",
            props.menuAlign === "left" ? "left-0" : "right-0"
          )}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={{ duration: 0.16, ease: "easeOut" }}>
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
            <div className="flex items-center gap-2">
              <img
                alt="MindDock"
                className="h-5 w-auto object-contain"
                src={MINDDOCK_BUTTON_LOGO_SRC}
              />
              <span className="text-sm font-semibold text-white">MindDock</span>
            </div>
            <span className="rounded-full border border-[#facc15]/30 bg-[#facc15]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#facc15]">
              NotebookLM
            </span>
          </div>

          <div className="max-h-[32rem] overflow-y-auto px-3 pb-3 pt-3 [scrollbar-color:rgba(148,163,184,0.35)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar]:w-2 hover:[&::-webkit-scrollbar-thumb]:bg-white/25">
            {props.menuMode === "root" ? (
              <div className="flex flex-col gap-2">
                {/* Status row */}
                <div className="flex items-center justify-between rounded-lg border border-white/8 bg-white/4 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <BookOpen className="size-3.5 text-zinc-400" />
                    <span className="text-xs text-zinc-400">{props.notebookSyncLabel}</span>
                  </div>
                  {props.canShowResync && (
                    <button
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[#facc15] transition hover:bg-[#facc15]/10 disabled:opacity-50"
                      disabled={props.isBusy}
                      onClick={props.onResync}
                      type="button">
                      <RefreshCw className="size-3" />
                      Re-sync
                    </button>
                  )}
                </div>

                {/* New Notebook */}
                <button
                  className="flex w-full items-center gap-3 rounded-xl border border-[#facc15]/25 bg-[#facc15]/8 px-4 py-3.5 text-left transition hover:border-[#facc15]/50 hover:bg-[#facc15]/15 disabled:opacity-60"
                  disabled={props.isBusy}
                  onClick={props.onCreateNotebook}
                  type="button">
                  <div className="flex size-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#facc15]/15">
                    {props.isCreatingNotebook ? (
                      <Loader2 className="size-4 animate-spin text-[#facc15]" />
                    ) : (
                      <Plus className="size-4 text-white" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">New Notebook</p>
                    <p className="text-xs text-zinc-400">Create and save this content</p>
                  </div>
                </button>

                {/* Save to existing */}
                <button
                  className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/4 px-4 py-3.5 text-left transition hover:border-white/20 hover:bg-white/8 disabled:opacity-60"
                  disabled={props.isBusy}
                  onClick={props.onOpenExisting}
                  type="button">
                  <div className="flex size-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/8">
                    <FolderOpen className="size-4 text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">Save to Notebook</p>
                    <p className="text-xs text-zinc-400">Pick an existing notebook</p>
                  </div>
                </button>
              </div>
            ) : (
              <>
                {/* Back + title */}
                <div className="mb-3 flex items-center gap-2 px-1">
                  <button
                    className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition hover:text-white"
                    onClick={props.onBackToMain}
                    type="button">
                    <ArrowLeft className="size-3.5" />
                    Back
                  </button>
                  <span className="text-xs text-zinc-600">/</span>
                  <span className="text-xs font-medium text-zinc-300">Choose a notebook</span>
                </div>

                {/* Search */}
                <div className="relative mb-3">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
                  <input
                    className="h-9 w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-[#facc15]/50 focus:bg-white/8"
                    onChange={(event) => props.onSearchChange(event.currentTarget.value)}
                    placeholder="Search notebooks..."
                    type="text"
                    value={props.search}
                  />
                </div>

                {/* Notebook list */}
                {props.isLoadingNotebooks ? (
                  <div className="flex items-center gap-2.5 px-2 py-6 text-sm text-zinc-500">
                    <Loader2 className="size-4 animate-spin" />
                    <span>Loading notebooks...</span>
                  </div>
                ) : props.isLoadError ? (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/8 px-3 py-4 text-sm text-zinc-400">
                    Failed to load. Make sure you're logged in to NotebookLM.
                  </div>
                ) : props.filteredNotebooks.length === 0 ? (
                  <div className="px-2 py-6 text-center text-sm text-zinc-500">
                    No notebooks found. Create one first.
                  </div>
                ) : (
                  props.filteredNotebooks.map((notebook) => {
                    const isActive = notebook.id === props.activeNotebookId

                    return (
                      <button
                        className={clsx(
                          "mb-1.5 flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition disabled:cursor-wait disabled:opacity-70",
                          isActive
                            ? "border-[#facc15]/40 bg-[#facc15]/10"
                            : "border-white/8 bg-white/4 hover:border-white/15 hover:bg-white/8"
                        )}
                        disabled={props.isBusy}
                        key={notebook.id}
                        onClick={() => props.onNotebookSelect(notebook)}
                        type="button">
                        <div
                          className={clsx(
                            "flex size-7 flex-shrink-0 items-center justify-center rounded-lg",
                            isActive ? "bg-[#facc15]/20" : "bg-white/8"
                          )}>
                          {isActive ? (
                            <Book className="size-3.5 text-[#facc15]" />
                          ) : (
                            <Book className="size-3.5 text-white" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p
                            className={clsx(
                              "truncate text-sm font-medium",
                              isActive ? "text-[#facc15]" : "text-white"
                            )}>
                            {truncateLabel(notebook.title)}
                          </p>
                          <p className="text-xs text-zinc-500">
                            {isActive ? "Current notebook" : "Save content here"}
                          </p>
                        </div>
                        {isActive && <Check className="size-3.5 flex-shrink-0 text-[#facc15]" />}
                      </button>
                    )
                  })
                )}
              </>
            )}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function SniperOverlay({
  onClose,
  getDefaultNotebookId
}: {
  onClose: () => void
  getDefaultNotebookId: () => string
}): JSX.Element {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2147483647 }}>
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0, 0, 0, 0.35)"
        }}
      />
      <div
        onClick={(event) => event.stopPropagation()}
        style={{ position: "relative", zIndex: 1 }}>
        <SniperUI onClose={onClose} getDefaultNotebookId={getDefaultNotebookId} />
      </div>
    </div>
  )
}

function UniversalMindDockButton(): JSX.Element {
  const currentUrl = useUrlWatcher()
  const activeStrategy = useMemo(() => resolveContentStrategy(currentUrl), [currentUrl])
  const isLinkedInRuntime = Boolean(activeStrategy.isInlineOnly?.())
  const isRedditRuntime = useMemo(() => {
    try {
      return new URL(currentUrl).hostname.toLowerCase().includes("reddit.com")
    } catch {
      return window.location.hostname.toLowerCase().includes("reddit.com")
    }
  }, [currentUrl])
  const isInlineTriggerRuntime = isLinkedInRuntime || isRedditRuntime
  const shouldShowForCurrentRoute = useMemo(() => shouldShowMindDockOnXRoute(currentUrl), [currentUrl])
  const isYouTubeWatch = useMemo(() => isYouTubeWatchUrl(currentUrl), [currentUrl])
  const isYouTubeHost = useMemo(() => {
    try {
      return new URL(currentUrl).hostname.toLowerCase().includes("youtube.com")
    } catch {
      return window.location.hostname.toLowerCase().includes("youtube.com")
    }
  }, [currentUrl])

  const {
    activeNotebookId: repositoryActiveNotebookId,
    syncedAt,
    refresh: refreshNotebookRepository
  } = useNotebookRepository()
  const {
    isLoading: isLoadingDiscovery,
    notebooks: discoveredNotebooks,
    error: notebookLoadError,
    reload: reloadNotebookDiscovery,
  } = useNotebookList()

  const [activeNotebookOverride, setActiveNotebookOverride] = useState("")
  const [isCreatingNotebook, setIsCreatingNotebook] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [menuMode, setMenuMode] = useState<"existing" | "root">("root")
  const [search, setSearch] = useState("")
  const [activeCaptureAction, setActiveCaptureAction] = useState<"capture" | "resync" | null>(null)
  const [resyncLiveLabel, setResyncLiveLabel] = useState("")
  const [selectedLinkedInPostUrn, setSelectedLinkedInPostUrn] = useState<string | null>(null)
  const [selectedLinkedInPostRoot, setSelectedLinkedInPostRoot] = useState<HTMLElement | null>(null)
  const [selectedLinkedInSnapshot, setSelectedLinkedInSnapshot] = useState<LinkedInCaptureSnapshot | null>(null)
  const [selectedRedditPostRoot, setSelectedRedditPostRoot] = useState<HTMLElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const isBusyRef = useRef(false)
  const [floatingPlacement, setFloatingPlacement] = useState<FloatingButtonPlacement>(() =>
    resolvePlacementFromStrategy(activeStrategy)
  )

  const effectiveActiveNotebookId = normalizeString(activeNotebookOverride) || repositoryActiveNotebookId
  const notebooks = useMemo<NotebookOption[]>(
    () => discoveredNotebooks.map((notebookManifest) => ({ id: notebookManifest.id, title: notebookManifest.title })),
    [discoveredNotebooks]
  )
  const captureOptions = useMemo<CaptureResolutionOptions>(
    () => ({
      linkedInPostUrn: selectedLinkedInPostUrn,
      linkedInPostRoot: selectedLinkedInPostRoot,
      linkedInSnapshot: selectedLinkedInSnapshot,
      redditPostRoot: selectedRedditPostRoot
    }),
    [selectedLinkedInPostUrn, selectedLinkedInPostRoot, selectedLinkedInSnapshot, selectedRedditPostRoot]
  )

  const { linkedNotebookId, linkedSourceId, linkedSyncInfo, captureState, handleCapture } = useSmartCapture(
    currentUrl,
    effectiveActiveNotebookId,
    captureOptions
  )

  const isBusy = captureState === "checking" || captureState === "capturing" || isCreatingNotebook
  const isGenericUrl = useMemo(() => isGenericConversationUrl(currentUrl), [currentUrl])
  const isGeminiHost = activeStrategy.id === "gemini"
  const isGoogleDocsHost = activeStrategy.id === "google-docs"
  const isGeminiConversationRoute = useMemo(() => {
    if (!isGeminiHost) {
      return false
    }

    try {
      const parsed = new URL(currentUrl)
      const pathname = parsed.pathname.replace(/\/+$/u, "") || "/"

      if (pathname !== "/" && pathname !== "/app") {
        return true
      }

      return Boolean(
        parsed.searchParams.get("conversation") ||
          parsed.searchParams.get("chat") ||
          parsed.searchParams.get("id")
      )
    } catch {
      return !isGenericUrl
    }
  }, [currentUrl, isGeminiHost, isGenericUrl])
  const [hasGeminiConversationContent, setHasGeminiConversationContent] = useState(false)
  const [hasGeminiComposerSurface, setHasGeminiComposerSurface] = useState(false)
  const [hasGeminiStickyReady, setHasGeminiStickyReady] = useState(false)
  const [lastGeminiContentAt, setLastGeminiContentAt] = useState(0)
  const isGeminiGraceActive = isGeminiHost && lastGeminiContentAt > 0 && Date.now() - lastGeminiContentAt < GEMINI_CONTENT_GRACE_MS
  const isGeminiReady =
    !isGeminiHost ||
    isGeminiConversationRoute ||
    hasGeminiConversationContent ||
    hasGeminiComposerSurface ||
    isGeminiGraceActive

  useEffect(() => {
    if (!isGeminiHost) {
      setHasGeminiStickyReady(false)
      return
    }

    if (isGeminiReady) {
      setHasGeminiStickyReady(true)
    }
  }, [isGeminiHost, isGeminiReady])

  const isResyncDisabledForHost = useMemo(() => isResyncDisabledForUrl(currentUrl), [currentUrl])
  const canShowResync = Boolean(linkedNotebookId) && !isGenericUrl && !isResyncDisabledForHost
  const notebookSyncLabel = useMemo(
    () => formatConversationSyncLabel(linkedSyncInfo),
    [linkedSyncInfo]
  )

  useEffect(() => {
    isBusyRef.current = isBusy
  }, [isBusy])

  useEffect(() => {
    sniperDefaultNotebookId = effectiveActiveNotebookId
  }, [effectiveActiveNotebookId])

  useEffect(() => {
    setSelectedLinkedInPostUrn(null)
    setSelectedLinkedInPostRoot(null)
    setSelectedLinkedInSnapshot(null)
    setSelectedRedditPostRoot(null)
  }, [currentUrl])
  useEffect(() => {
    if (!isGeminiHost) {
      setHasGeminiConversationContent(false)
      setHasGeminiComposerSurface(false)
      setLastGeminiContentAt(0)
      return
    }

    let animationFrameId: number | null = null
    setLastGeminiContentAt(Date.now())

    const updateContentState = (): void => {
      const hasContent = detectGeminiConversationContent()
      const hasComposerSurface = detectGeminiComposerSurface()
      if (hasContent || hasComposerSurface) {
        setLastGeminiContentAt(Date.now())
      }
      setHasGeminiConversationContent((prev) => (prev === hasContent ? prev : hasContent))
      setHasGeminiComposerSurface((prev) =>
        prev === hasComposerSurface ? prev : hasComposerSurface
      )
    }

    updateContentState()

    const delayedCheckIds = [
      window.setTimeout(updateContentState, 350),
      window.setTimeout(updateContentState, 900),
      window.setTimeout(updateContentState, 1800),
      window.setTimeout(updateContentState, 3200),
      window.setTimeout(updateContentState, GEMINI_CONTENT_GRACE_MS)
    ]

    const observer = new MutationObserver(() => {
      if (animationFrameId !== null) {
        return
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null
        updateContentState()
      })
    })

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    }

    const intervalId = window.setInterval(updateContentState, 1200)

    return () => {
      observer.disconnect()
      for (const delayedCheckId of delayedCheckIds) {
        window.clearTimeout(delayedCheckId)
      }
      window.clearInterval(intervalId)
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId)
      }
    }
  }, [currentUrl, isGeminiHost])



  useEffect(() => {
    if (!isYouTubeWatch) {
      removeYouTubeSniperButton()
      closeSniperOverlay()
      return
    }

    let cancelled = false
    const ensureInjected = (): void => {
      if (cancelled) {
        return
      }
      injectYouTubeSniperButton()
    }

    ensureInjected()

    const retryTimeoutIds = [120, 300, 700, 1200, 2000, 3200].map((delayMs) =>
      window.setTimeout(ensureInjected, delayMs)
    )

    const observer = new MutationObserver(() => {
      ensureInjected()
    })

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true })
    }

    const intervalId = window.setInterval(ensureInjected, 1000)
    const youtubeNavigationEvents = ["yt-navigate-finish", "yt-page-data-fetched"]
    const handleYouTubeNavigation = (): void => {
      ensureInjected()
    }
    youtubeNavigationEvents.forEach((eventName) => {
      window.addEventListener(eventName, handleYouTubeNavigation as EventListener)
    })

    return () => {
      cancelled = true
      retryTimeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId))
      observer.disconnect()
      window.clearInterval(intervalId)
      youtubeNavigationEvents.forEach((eventName) => {
        window.removeEventListener(eventName, handleYouTubeNavigation as EventListener)
      })
    }
  }, [currentUrl, isYouTubeWatch])

  useEffect(() => {
    if (!shouldShowForCurrentRoute || (isGeminiHost && !isGeminiReady)) {
      setIsMenuOpen(false)
    }
  }, [shouldShowForCurrentRoute, isGeminiHost, isGeminiReady])

  useEffect(() => {
    if (isYouTubeHost) {
      setIsMenuOpen(false)
    }
  }, [isYouTubeHost])

  useEffect(() => {
    if (isInlineTriggerRuntime) {
      return
    }

    let animationFrameId: number | null = null

    const updatePlacement = (): void => {
      if (injectionManager) {
        void injectionManager.ensureMountPoint(currentUrl)
        mountedHost = injectionManager.getHost()
      }
      const base = resolvePlacementFromStrategy(activeStrategy)
      setFloatingPlacement((prev) => ({ ...base, menuVertical: prev.menuVertical }))
    }

    const scheduleUpdate = (): void => {
      if (animationFrameId !== null) {
        return
      }
      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null
        updatePlacement()
      })
    }

    updatePlacement()

    const observer = new MutationObserver(() => {
      scheduleUpdate()
    })

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true })
    }

    const intervalId = window.setInterval(scheduleUpdate, 1000)
    window.addEventListener("scroll", scheduleUpdate, true)
    window.addEventListener("resize", scheduleUpdate, true)

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId)
      }
      window.clearInterval(intervalId)
      observer.disconnect()
      window.removeEventListener("scroll", scheduleUpdate, true)
      window.removeEventListener("resize", scheduleUpdate, true)
    }
  }, [activeStrategy, currentUrl, isInlineTriggerRuntime, shouldShowForCurrentRoute])

  useEffect(() => {
    if (!isLinkedInRuntime) {
      return
    }

    const stopInlineTriggers = initLinkedInInlineTriggers({
      inlineButtonAttribute: LINKEDIN_INLINE_TRIGGER_ATTRIBUTE,
      isBusy: () => isBusyRef.current,
      debugKey: "__minddockLinkedinDebug",
      onTriggerClick: ({ triggerElement, postUrn, postRoot }) => {
        const resolvedPostRoot = postRoot ?? resolveLinkedInPostRootFromTriggerElement(triggerElement)
        const linkedInSnapshot = buildLinkedInCaptureSnapshotFromRoot(
          resolvedPostRoot,
          currentUrl,
          postUrn
        )
        setSelectedLinkedInPostUrn(postUrn)
        setSelectedLinkedInPostRoot(resolvedPostRoot)
        setSelectedLinkedInSnapshot(linkedInSnapshot)
        setFloatingPlacement(resolveInlineAnchorPlacement(triggerElement.getBoundingClientRect()))
        setMenuMode("root")
        setSearch("")
        setIsMenuOpen(true)
      }
    })

    return () => {
      stopInlineTriggers()
    }
  }, [currentUrl, isLinkedInRuntime])

  useEffect(() => {
    if (!isRedditRuntime) {
      return
    }

    const stopInlineTriggers = initRedditInlineTriggers({
      inlineButtonAttribute: REDDIT_INLINE_TRIGGER_ATTRIBUTE,
      isBusy: () => isBusyRef.current,
      debugKey: "__minddockRedditDebug",
      onTriggerClick: ({ triggerElement, postRoot }) => {
        setSelectedRedditPostRoot(postRoot)
        setFloatingPlacement(resolveInlineAnchorPlacement(triggerElement.getBoundingClientRect()))
        setMenuMode("root")
        setSearch("")
        setIsMenuOpen(true)
      }
    })

    return () => {
      stopInlineTriggers()
    }
  }, [currentUrl, isRedditRuntime])

  useEffect(() => {
    if (!(captureState === "capturing" && activeCaptureAction === "resync")) {
      setResyncLiveLabel("")
      return
    }

    if (resyncLiveLabel) {
      return
    }

    return undefined
  }, [captureState, activeCaptureAction, resyncLiveLabel])

  useEffect(() => {
    const runtimeApi = typeof chrome !== "undefined" ? chrome.runtime : undefined
    if (!runtimeApi?.onMessage?.addListener) {
      return
    }

    const handleRuntimeMessage = (message: unknown): void => {
      if (!isRecord(message)) {
        return
      }

      const command = normalizeString(message.command)
      if (command !== RESYNC_PROGRESS_EVENT) {
        return
      }

      const payload = isRecord(message.payload) ? message.payload : {}
      const payloadUrl = normalizeString(payload.url)
      if (!payloadUrl || !isSameConversationResyncScope(payloadUrl, currentUrl)) {
        return
      }

      const stage = normalizeString(payload.stage).toLowerCase()
      const attempt = Number(payload.attempt ?? 0)
      const totalAttempts = Number(payload.totalAttempts ?? 0)
      const progressMessage = normalizeString(payload.message)
      const flowVersion = normalizeString(payload.flowVersion)

      if (flowVersion) {
        console.log("[RESYNC_PROGRESS_EVENT]", {
          flowVersion,
          stage,
          attempt,
          totalAttempts,
          progressMessage
        })
      }

      if (progressMessage) {
        const normalizedProgressMessage = progressMessage.toLowerCase()
        if (stage === "starting") {
          setResyncLiveLabel("Resolvendo fonte vinculada...")
          return
        }
        if (stage === "polling") {
          setResyncLiveLabel("Removendo versao antiga...")
          return
        }
        if (stage === "uploading") {
          if (normalizedProgressMessage.includes("updat")) {
            setResyncLiveLabel("Atualizando fonte existente...")
            return
          }
          setResyncLiveLabel("Inserindo nova versao...")
          return
        }
      }

      if (stage === "starting") {
        setResyncLiveLabel("Sincronizando...")
        return
      }

      if (stage === "polling") {
        if (attempt > 0 && totalAttempts > 0) {
          setResyncLiveLabel(`Removendo versao antiga (${attempt}/${totalAttempts})...`)
          return
        }
        setResyncLiveLabel("Removendo versao antiga...")
        return
      }

      if (stage === "uploading") {
        setResyncLiveLabel("Enviando nova versao...")
        return
      }

      if (stage === "fallback") {
        setResyncLiveLabel("Fonte antiga persistente. Seguindo sincronizacao...")
        return
      }

      if (stage === "done") {
        setResyncLiveLabel("Finalizando sync...")
        return
      }

      if (stage === "error") {
        setResyncLiveLabel("Re-sync interrompido.")
      }
    }

    runtimeApi.onMessage.addListener(handleRuntimeMessage)
    return () => {
      runtimeApi.onMessage.removeListener(handleRuntimeMessage)
    }
  }, [currentUrl])

  const filteredNotebooks = useMemo(() => {
    const query = search.trim().toLowerCase()

    return notebooks
      .filter((notebook) => notebook.title.toLowerCase().includes(query))
      .sort((left, right) => {
        if (left.id === effectiveActiveNotebookId) {
          return -1
        }
        if (right.id === effectiveActiveNotebookId) {
          return 1
        }
        return left.title.localeCompare(right.title, "pt-BR", { sensitivity: "base" })
      })
  }, [effectiveActiveNotebookId, notebooks, search])

  useEffect(() => {
    if (isMenuOpen) {
      return
    }

    setMenuMode("root")
    setSearch("")
  }, [isMenuOpen])

  useEffect(() => {
    if (!isMenuOpen) {
      return
    }

    const handleOutsidePointer = (event: PointerEvent): void => {
      const container = containerRef.current
      const target = event.target as Node | null
      const composedPath = typeof event.composedPath === "function" ? event.composedPath() : []
      const shadowRoot = container?.getRootNode()

      const isClickInsideContainer =
        (!!container && !!target && container.contains(target)) ||
        (!!container && composedPath.includes(container)) ||
        (!!shadowRoot && composedPath.includes(shadowRoot as EventTarget)) ||
        (!!mountedHost && composedPath.includes(mountedHost))

      if (!container || isClickInsideContainer) {
        return
      }

      setIsMenuOpen(false)
    }

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setIsMenuOpen(false)
      }
    }

    window.addEventListener("pointerdown", handleOutsidePointer, true)
    window.addEventListener("keydown", handleEscape, true)

    return () => {
      window.removeEventListener("pointerdown", handleOutsidePointer, true)
      window.removeEventListener("keydown", handleEscape, true)
    }
  }, [isMenuOpen])

  const runCapture = useCallback(
    async (
      notebookId: string,
      isResync: boolean,
      preparedCapture?: PreparedCapturePayload
    ) => {
      const normalizedNotebookId = normalizeString(notebookId)
      if (!normalizedNotebookId) {
        showMindDockToast({
          message: "Escolha um notebook antes de capturar.",
          variant: "error",
          timeoutMs: 2800
        })
        return
      }

      await persistPreferredNotebookId(normalizedNotebookId)
      setActiveNotebookOverride(normalizedNotebookId)
      setActiveCaptureAction(isResync ? "resync" : "capture")
      if (isResync) {
        // Keep label empty so the staged progress fallback remains visible
        // even when runtime progress events are delayed or missing.
        setResyncLiveLabel("")
      } else {
        setResyncLiveLabel("")
      }

      try {
        const response = await handleCapture(normalizedNotebookId, isResync, preparedCapture)
        if (!response.success) {
          const normalizedError = normalizeString(response.error)
          const errorPayload = isRecord(response.payload)
            ? response.payload
            : isRecord(response.data)
            ? response.data
            : {}
          const flowVersion = normalizeString(errorPayload.flowVersion)
          const errorDetails = normalizeString(errorPayload.details)
          const errorDiagnostics = errorPayload.diagnostics
          if (normalizedError === NO_CHANGES_DETECTED_ERROR) {
            showMindDockToast({
              message: "Nenhuma alteracao detectada.",
              variant: "info",
              timeoutMs: 2200
            })
            return
          }

          let userFriendlyError = ""
          if (isResync && normalizedError === "RESYNC_BINDING_INVALID") {
            userFriendlyError =
              "Fonte anterior nao encontrada no notebook. Ela pode ter sido removida manualmente."
          } else if (isResync && normalizedError === "RESYNC_DELETE_FAILED") {
            userFriendlyError =
              "Nao foi possivel remover a versao antiga. Re-sync interrompido para evitar duplicatas."
          } else if (isResync && normalizedError === "RESYNC_INSERT_INVALID") {
            userFriendlyError = "A nova versao foi enviada, mas o ID retornado nao foi validado."
          } else if (isResync && normalizedError === "RESYNC_TIMEOUT") {
            userFriendlyError = `Re-sync excedeu o tempo limite de ${RESYNC_FLOW_LIMIT_SECONDS}s. Tente novamente.`
          } else if (normalizedError.startsWith("REQUEST_TIMEOUT_")) {
            const requestTimeoutSeconds =
              resolveRequestTimeoutSeconds(normalizedError) ?? RESYNC_FLOW_LIMIT_SECONDS
            userFriendlyError = isResync
              ? `Re-sync excedeu ${requestTimeoutSeconds}s aguardando resposta do background.`
              : "A captura demorou demais e foi interrompida."
          } else if (normalizedError.includes("message channel closed")) {
            userFriendlyError = "Conexao com o background foi reiniciada. Tente novamente."
          } else {
            userFriendlyError = normalizedError
          }

          if (isResync && (errorDetails || normalizedError.startsWith("RESYNC_"))) {
            console.error("[RESYNC_ERROR]", {
              flowVersion: flowVersion || "unknown",
              code: normalizedError,
              details: errorDetails,
              diagnostics: errorDiagnostics
            })
            try {
              console.error(
                "[RESYNC_ERROR_JSON]",
                JSON.stringify({
                  flowVersion: flowVersion || "unknown",
                  code: normalizedError,
                  details: errorDetails,
                  diagnostics: errorDiagnostics
                })
              )
            } catch {
              // no-op
            }
          }

          if (isResync && !flowVersion && normalizedError.startsWith("RESYNC_")) {
            console.warn(
              "[RESYNC_ERROR] flowVersion ausente; possivel bundle antigo em execucao. Recarregue a extensao."
            )
          }

          showMindDockToast({
            message: userFriendlyError || "Falha ao enviar captura para o NotebookLM.",
            variant: "error",
            timeoutMs: 3200
          })
          return
        }

        showMindDockToast({
          message: isResync ? "Re-sync concluido com sucesso." : "Conversa enviada para o NotebookLM.",
          variant: "success",
          timeoutMs: 2400
        })

        setIsMenuOpen(false)
      } finally {
        setActiveCaptureAction(null)
        setResyncLiveLabel("")
      }
    },
    [handleCapture]
  )

  const handleNotebookClick = useCallback(
    (notebook: NotebookOption) => {
      void runCapture(notebook.id, false)
    },
    [runCapture]
  )

  const handleResyncClick = useCallback(() => {
    if (isResyncDisabledForHost) {
      showMindDockToast({
        message: "Re-sync nao esta disponivel nesta plataforma.",
        variant: "info",
        timeoutMs: 2500
      })
      return
    }

    if (isGenericUrl) {
      showMindDockToast({
        message: "Abra um chat especifico antes de usar Re-sync.",
        variant: "error",
        timeoutMs: 2800
      })
      return
    }

    const targetNotebookId = normalizeString(linkedNotebookId)
    if (!targetNotebookId) {
      showMindDockToast({
        message: "Este chat ainda nao possui vinculo para re-sync.",
        variant: "error",
        timeoutMs: 2800
      })
      return
    }

    void runCapture(targetNotebookId, true)
  }, [isGenericUrl, isResyncDisabledForHost, linkedNotebookId, runCapture])

  const handleOpenExisting = useCallback(() => {
    setMenuMode("existing")
    setSearch("")
    void reloadNotebookDiscovery()
  }, [reloadNotebookDiscovery])

  const handleBackToMain = useCallback(() => {
    setMenuMode("root")
    setSearch("")
  }, [])

  const handleCreateNotebookClick = useCallback(async () => {
    if (isBusy) {
      return
    }

    setIsCreatingNotebook(true)

    try {
      const preferredNotebookId = normalizeString(effectiveActiveNotebookId) || undefined
      const pageCapture = await resolvePreparedCaptureForCurrentPage(
        currentUrl,
        preferredNotebookId,
        captureOptions
      )
      const preparedConversation = normalizeConversation(pageCapture.conversation)
      const extractedTitle = normalizeString(pageCapture.sourceTitle)
      const captureSourceKind = normalizeCaptureSourceKind(pageCapture.sourceKind)
      const capturePlatform =
        normalizeString(pageCapture.sourcePlatform) ||
        resolveGenericPlatformLabel(window.location.hostname.toLowerCase())

      if (preparedConversation.length === 0) {
        showMindDockToast({
          message: "Nao foi encontrado conteudo valido na pagina para criar e capturar.",
          variant: "error",
          timeoutMs: 3200
        })
        return
      }

      const captureTitle = resolveBestSourceTitle([
        extractedTitle,
        resolveSafeCaptureTitle(),
        document.title
      ])
      const sourceTitleForCapture =
        captureSourceKind === "doc"
          ? sanitizeSourceTitleCandidate(captureTitle).replace(/^\[[^\]]+\]\s*/u, "").trim() ||
            resolveGoogleDocsSourceTitle()
          : buildTaggedSourceTitle(capturePlatform, captureTitle)

      const createResponse = await sendRuntimeMessage<Record<string, unknown>>(CREATE_NOTEBOOK_COMMAND, {
        title: captureTitle
      })

      if (!createResponse.success) {
        showMindDockToast({
          message: normalizeString(createResponse.error) || "Falha ao criar notebook.",
          variant: "error",
          timeoutMs: 3200
        })
        return
      }

      const payloadRecord = isRecord(createResponse.payload)
        ? createResponse.payload
        : isRecord(createResponse.data)
        ? createResponse.data
        : {}

      const createdNotebookId = normalizeString(payloadRecord.notebookId ?? payloadRecord.id)
      if (!createdNotebookId) {
        showMindDockToast({
          message: "Notebook criado sem ID valido. Tente novamente.",
          variant: "error",
          timeoutMs: 3200
        })
        return
      }

      await Promise.allSettled([reloadNotebookDiscovery(), refreshNotebookRepository()])
      await runCapture(createdNotebookId, false, {
        sourceKind: captureSourceKind,
        sourceTitle: sourceTitleForCapture,
        sourcePlatform: capturePlatform,
        conversation: preparedConversation
      })
    } finally {
      setIsCreatingNotebook(false)
    }
  }, [
    captureOptions,
    currentUrl,
    effectiveActiveNotebookId,
    isBusy,
    refreshNotebookRepository,
    reloadNotebookDiscovery,
    runCapture
  ])

  const isIdleTrigger = captureState === "idle"
  const shouldShowGeminiCapture = !isGeminiHost || shouldShowForCurrentRoute
  const shouldRenderFloatingButton =
    !isInlineTriggerRuntime && shouldShowForCurrentRoute && !isYouTubeHost && shouldShowGeminiCapture
  const shouldRenderMenuPanel =
    (shouldRenderFloatingButton || isInlineTriggerRuntime) &&
    shouldShowForCurrentRoute &&
    !isYouTubeHost &&
    shouldShowGeminiCapture

  const buttonBaseClass = isGoogleDocsHost
    ? "inline-flex items-center justify-center rounded-full border border-white/70 bg-black/90 p-2 transition"
    : "inline-flex items-center justify-center rounded-full border border-white/60 bg-black p-1.5 transition"
  const buttonHoverClass = isBusy
    ? "cursor-wait opacity-70"
    : isGoogleDocsHost
      ? "hover:border-white/70 hover:bg-black/80"
      : "hover:border-white hover:bg-white/10"
  const iconSizeClass = isGoogleDocsHost ? "size-5" : "size-4"
  const accentIconSizeClass = isGoogleDocsHost ? "size-6" : "size-5"

  return (
    <div className="fixed z-[2147483646]" ref={containerRef} style={floatingPlacement.style}>
      {!shouldRenderFloatingButton ? (
        <div className="h-px w-px pointer-events-none" />
      ) : isLinkedInRuntime ? (
        <div className="h-px w-px pointer-events-none" />
      ) : (
        <motion.button
          className={clsx(buttonBaseClass, buttonHoverClass)}
          disabled={isBusy}
          onClick={() => {
            setMenuMode("root")
            setSearch("")
            const rect = containerRef.current?.getBoundingClientRect()
            if (rect) {
              const spaceBelow = window.innerHeight - rect.bottom
              setFloatingPlacement((prev) => ({
                ...prev,
                menuVertical: spaceBelow < 460 ? "above" : "below"
              }))
            }
            setIsMenuOpen((current) => !current)
          }}
          title="MindDock â€” NotebookLM"
          type="button"
          whileTap={{ scale: 0.97 }}>
          <motion.span
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="inline-flex items-center justify-center"
            initial={{ opacity: 0, scale: 0.8, y: 2 }}
            key={`${captureState}-${currentUrl}`}
            transition={{ duration: 0.14 }}>
            {isIdleTrigger ? (
              <img
                alt="MindDock"
                className={clsx(iconSizeClass, "object-contain")}
                src={MINDDOCK_BUTTON_LOGO_SRC}
              />
            ) : captureState === "capturing" || captureState === "checking" ? (
              <Loader2 className={clsx(iconSizeClass, "animate-spin text-white")} />
            ) : captureState === "success" ? (
              <Check className={clsx(iconSizeClass, "text-emerald-400")} />
            ) : captureState === "error" ? (
              <RefreshCw className={clsx(accentIconSizeClass, "text-rose-400")} />
            ) : (
              <Book className={clsx(accentIconSizeClass, "text-white")} />
            )}
          </motion.span>
        </motion.button>
      )}

      {shouldRenderMenuPanel ? (
        <MenuPanel
          activeNotebookId={effectiveActiveNotebookId}
          canShowResync={canShowResync}
          filteredNotebooks={filteredNotebooks}
          isBusy={isBusy}
          isCreatingNotebook={isCreatingNotebook}
          isLoadError={Boolean(notebookLoadError)}
          isLoadingNotebooks={isLoadingDiscovery}
          isOpen={isMenuOpen}
          menuAlign={floatingPlacement.menuAlign}
          menuVertical={floatingPlacement.menuVertical}
          menuMode={menuMode}
          notebookSyncLabel={notebookSyncLabel}
          onBackToMain={handleBackToMain}
          onCreateNotebook={handleCreateNotebookClick}
          onNotebookSelect={handleNotebookClick}
          onOpenExisting={handleOpenExisting}
          onResync={handleResyncClick}
          onSearchChange={setSearch}
          search={search}
        />
      ) : null}
    </div>
  )
}

function ensureMountPoint(): HTMLElement {
  if (!injectionManager) {
    injectionManager = new InjectionManager({
      hostId: HOST_ID,
      mountId: MOUNT_ID,
      styleId: STYLE_ID,
      shadowCssText,
      resolveStrategy: resolveContentStrategy
    })
  }

  const mountPoint = injectionManager.ensureMountPoint(window.location.href)
  mountedHost = injectionManager.getHost()
  return mountPoint
}

function cleanupUniversalMindDockButton(): void {
  injectionManager?.stopAutoReinject()
  youtubeSniperHardGuardStop?.()

  if (rebootstrapTimer !== null) {
    window.clearTimeout(rebootstrapTimer)
    rebootstrapTimer = null
  }

  mountedRoot?.unmount()
  mountedRoot = null
  bootstrapPromise = null

  if (mountedHost) {
    mountedHost.remove()
    mountedHost = null
  }

  removeYouTubeSniperButton()
  closeSniperOverlay()

  injectionManager = null
}

function scheduleRebootstrap(): void {
  if (rebootstrapTimer !== null) {
    return
  }

  rebootstrapTimer = window.setTimeout(() => {
    rebootstrapTimer = null

    if (document.getElementById(HOST_ID)) {
      return
    }

    try {
      mountedRoot?.unmount()
    } catch {
      // no-op
    }

    mountedRoot = null
    mountedHost = null
    bootstrapPromise = null

    void bootstrapUniversalMindDockButton()
  }, 40)
}

async function waitForBody(): Promise<void> {
  if (document.body instanceof HTMLBodyElement) {
    return
  }

  await new Promise<void>((resolve) => {
    const observer = new MutationObserver(() => {
      if (document.body instanceof HTMLBodyElement) {
        observer.disconnect()
        resolve()
      }
    })

    observer.observe(document.documentElement, { childList: true, subtree: true })
  })
}

async function bootstrapUniversalMindDockButton(): Promise<void> {
  if (mountedRoot || bootstrapPromise) {
    return
  }

  bootstrapPromise = (async () => {
    await waitForBody()
    startYouTubeSniperHardGuard()
    if (mountedRoot) {
      return
    }

    const mountPoint = ensureMountPoint()
    mountedRoot = createRoot(mountPoint)
    mountedRoot.render(<UniversalMindDockButton />)
    injectionManager?.startAutoReinject(() => {
      scheduleRebootstrap()
    })
  })()

  try {
    await bootstrapPromise
  } finally {
    bootstrapPromise = null
  }
}

const globalWindow = window as typeof window & Record<string, unknown>
const existingCleanup = globalWindow[CLEANUP_KEY]
if (typeof existingCleanup === "function") {
  try {
    ;(existingCleanup as () => void)()
  } catch {
    // no-op
  }
}

globalWindow[CLEANUP_KEY] = cleanupUniversalMindDockButton

void bootstrapUniversalMindDockButton()
window.addEventListener("beforeunload", cleanupUniversalMindDockButton)

const UniversalMindDockButtonMount = () => null
export default UniversalMindDockButtonMount
