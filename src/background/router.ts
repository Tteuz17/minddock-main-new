import { authManager } from "./auth-manager"
import { storageManager } from "./storage-manager"
import { subscriptionManager } from "./subscription"
import { renderPdfBase64ViaOffscreen } from "./services/offscreen-pdf-service"
import { aiService } from "~/services/ai-service"
import { exportService } from "~/services/export-service"
import { NotebookLMService, type SyncVerificationResult } from "~/services/NotebookLMService"
import { zettelkastenService } from "~/services/zettelkasten"
import { threadService } from "./services/ThreadService"
import { STORAGE_KEYS, STRIPE_PRICES } from "~/lib/constants"
import {
  FIXED_STORAGE_KEYS,
  MESSAGE_ACTIONS,
  type StandardResponse
} from "~/lib/contracts"
import {
  formatChatAsReadableMarkdownV2,
  getFromSecureStorage,
  setInSecureStorage
} from "~/lib/utils"
import type {
  ChromeMessage,
  ChromeMessageResponse,
  Notebook,
  SidePanelLaunchTarget,
  SidePanelNoteDraft,
  SubscriptionTier,
  UserProfile
} from "~/lib/types"
import {
  buildNotebookAccountKey,
  buildScopedStorageKey,
  isConfirmedNotebookAccountKey,
  normalizeAccountEmail,
  normalizeAuthUser
} from "~/lib/notebook-account-scope"
import {
  resolveConversationAliasKeys,
  resolveConversationPrimaryKey
} from "~/lib/conversation-resync-identity"

type MessageSender = chrome.runtime.MessageSender
type CaptureSourceKind = "chat" | "doc"

type Handler = (
  payload: unknown,
  sender: MessageSender
) => Promise<StandardResponse>

const IMPORT_LIMIT_DISABLED = false
const RESYNC_TOTAL_BUDGET_MS = 90_000
const RESYNC_TOTAL_BUDGET_SECONDS = Math.ceil(RESYNC_TOTAL_BUDGET_MS / 1000)
const RESYNC_PROGRESS_EVENT = "MINDDOCK_RESYNC_PROGRESS"
const RESYNC_SUCCESS_EVENT = "MINDDOCK_RESYNC_SUCCESS"
const RESYNC_FLOW_VERSION = "resync-v6"
const GDOC_SYNC_STEP_DELAY_MS = 320
const MAX_MESSAGE_FIELD_LENGTH = 160
const MAX_MESSAGE_PAYLOAD_SIZE = 1_000_000
const AI_RATE_LIMIT_WINDOW_MS = 60_000
const AI_RATE_LIMIT_MAX_REQUESTS = 8
const CHAT_SOURCE_BINDING_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const CHAT_SOURCE_BINDING_MAX_TITLE_LENGTH = 180
const CHAT_SOURCE_BINDING_MAX_HASH_LENGTH = 128
const CHAT_SOURCE_BINDING_MAX_KEY_LENGTH = 420
const BLOCKED_NOTEBOOK_TITLE_KEYS = new Set([
  "conversa",
  "conversas",
  "conversation",
  "conversations"
])

function normalizeNotebookTitleKey(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function isBlockedNotebookTitle(value: string): boolean {
  return BLOCKED_NOTEBOOK_TITLE_KEYS.has(normalizeNotebookTitleKey(value))
}

function normalizePlatformLabel(value: string): string {
  const rawValue = String(value ?? "").trim()
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
    return "YOUTUBE"
  }
  return rawValue.toUpperCase()
}

function normalizeCaptureSourceKind(value: unknown): CaptureSourceKind {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
  if (normalized === "doc" || normalized === "document") {
    return "doc"
  }
  return "chat"
}

function sleep(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, timeoutMs))
  })
}

function extractGoogleDocIdFromValue(value: unknown): string {
  const normalizedValue = String(value ?? "").trim()
  if (!normalizedValue) {
    return ""
  }

  const urlMatch = normalizedValue.match(/\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/u)
  if (urlMatch?.[1]) {
    return String(urlMatch[1] ?? "").trim()
  }

  if (/^[A-Za-z0-9_-]{20,}$/u.test(normalizedValue)) {
    return normalizedValue
  }

  return ""
}

function stripTrailingContextSnippet(value: string): string {
  const normalizedValue = String(value ?? "").trim()
  if (!normalizedValue) {
    return ""
  }

  const parentheticalMatch = normalizedValue.match(/\s*\(([^()]{1,140})\)\s*$/u)
  if (!parentheticalMatch) {
    return normalizedValue
  }

  const [fullMatch, innerRaw] = parentheticalMatch
  const inner = String(innerRaw ?? "").trim()
  const words = inner.split(/\s+/u).filter(Boolean)
  const hasLetters = /[A-Za-z]/u.test(inner)
  const looksLikeContextSnippet = hasLetters && (words.length >= 3 || inner.length >= 22)

  if (!looksLikeContextSnippet) {
    return normalizedValue
  }

  return normalizedValue.slice(0, normalizedValue.length - fullMatch.length).trim()
}

interface ChatSourceBindingRecord {
  sourceId: string
  sourceTitle: string
  lastSyncHash?: string
  updatedAt: string
}

class MessageRouter {
  private handlers: Map<string, Handler> = new Map()
  private readonly notebookCacheKey = "minddock_cached_notebooks"
  private readonly notebookCacheSyncKey = "minddock_cached_notebooks_synced_at"
  private readonly notebookAccountEmailKey = "nexus_notebook_account_email"
  private readonly strictNotebookAccountMode = true
  private readonly backgroundSyncAction = "SYNC_NOTEBOOKS"
  private readonly pendingNotebookNameKey = "minddock_pending_notebook_name"
  private readonly pendingNotebookRequestedAtKey = "minddock_pending_notebook_requested_at"
  private readonly pendingNotebookPhaseKey = "minddock_pending_notebook_phase"
  private readonly pendingNotebookResultKey = "minddock_pending_notebook_result"
  private readonly pendingNotebookErrorKey = "minddock_pending_notebook_error"
  private readonly chatSourceBindingsKey = "minddock_chat_source_bindings"
  private readonly maxChatSourceBindings = 180
  private readonly resyncInFlight = new Set<string>()
  private readonly aiRateLimitHits = new Map<string, number[]>()
  private createNotebookRequestLocked = false

  constructor() {
    // Phase 1 fixed actions.
    this.register(MESSAGE_ACTIONS.STORE_SESSION_TOKENS, this.handleStoreSessionTokens)
    this.register(MESSAGE_ACTIONS.CMD_AUTH_SIGN_IN, this.handleAuthSignIn)
    this.register(MESSAGE_ACTIONS.CMD_AUTH_SIGN_OUT, this.handleAuthSignOut)
    this.register(MESSAGE_ACTIONS.CMD_AUTH_GET_STATUS, this.handleAuthGetStatus)
    this.register(MESSAGE_ACTIONS.CMD_GET_NOTEBOOKS, this.handleGetNotebooks)
    this.register(MESSAGE_ACTIONS.CMD_CREATE_NOTEBOOK, this.handleCreateNotebook)
    this.register(MESSAGE_ACTIONS.CMD_GET_NOTEBOOK_SOURCES, this.handleGetNotebookSources)
    this.register(MESSAGE_ACTIONS.CMD_GET_SOURCE_CONTENTS, this.handleGetSourceContents)
    this.register(MESSAGE_ACTIONS.CMD_REFRESH_GDOC_SOURCES, this.handleRefreshGDocSources)
    this.register(MESSAGE_ACTIONS.CMD_DELETE_NOTEBOOK_SOURCES, this.handleDeleteNotebookSources)
    this.register(MESSAGE_ACTIONS.CMD_SYNC_ALL_GDOCS, this.handleRefreshGDocSources)
    this.register(this.backgroundSyncAction, this.handleSyncNotebooks)

    // Legacy aliases kept to avoid regressions in existing popup/sidepanel code.
    this.register("MINDDOCK_SAVE_TOKENS", this.handleStoreSessionTokens)
    this.register("MINDDOCK_LIST_NOTEBOOKS", this.handleGetNotebooks)
    this.register("MINDDOCK_LIST_SOURCES", this.handleGetNotebookSources)
    this.register("MINDDOCK_GET_AUTH", this.handleAuthGetStatus)
    this.register("MINDDOCK_SIGN_OUT", this.handleAuthSignOut)
    this.register("MINDDOCK_SIGN_IN", this.handleLegacySignIn)
    this.register("MINDDOCK_GET_SOURCE_CONTENT", this.handleGetSourceContent)
    this.register("MINDDOCK_ADD_SOURCE", this.handleAddSource)
    this.register("MINDDOCK_SYNC_GDOC", this.handleSyncGdoc)
    this.register("MINDDOCK_IMPORT_AI_CHAT", this.handleImportAIChat)
    this.register("PROTOCOL_APPEND_SOURCE", this.handleProtocolAppendSource)
    this.register("MINDDOCK_CHECK_SUBSCRIPTION", this.handleCheckSubscription)
    this.register("MINDDOCK_IMPROVE_PROMPT", this.handleImprovePrompt)
    this.register("MINDDOCK_ATOMIZE_NOTE", this.handleAtomizeNote)
    this.register(MESSAGE_ACTIONS.ATOMIZE_PREVIEW, this.handleAtomizePreview)
    this.register(MESSAGE_ACTIONS.SAVE_ATOMIC_NOTES, this.handleSaveAtomicNotes)
    this.register(MESSAGE_ACTIONS.PROMPT_OPTIONS, this.handlePromptOptions)
    this.register("MINDDOCK_EXPORT_SOURCES", this.handleExportSources)
    this.register("MINDDOCK_HIGHLIGHT_SNIPE", this.handleHighlightSnipe)
    this.register(MESSAGE_ACTIONS.THREAD_LIST, this.handleThreadList)
    this.register(MESSAGE_ACTIONS.THREAD_CREATE, this.handleThreadCreate)
    this.register(MESSAGE_ACTIONS.THREAD_DELETE, this.handleThreadDelete)
    this.register(MESSAGE_ACTIONS.THREAD_RENAME, this.handleThreadRename)
    this.register(MESSAGE_ACTIONS.THREAD_MESSAGES, this.handleThreadMessages)
    this.register(MESSAGE_ACTIONS.THREAD_SAVE_MESSAGES, this.handleThreadSaveMessages)
    this.register(MESSAGE_ACTIONS.OPEN_SIDEPANEL, this.handleOpenSidePanel)
    this.register(MESSAGE_ACTIONS.CMD_RENDER_PDF_OFFSCREEN, this.handleRenderPdfOffscreen)
    this.register(MESSAGE_ACTIONS.CMD_CREATE_CHECKOUT, this.handleCreateCheckout)
    this.register(MESSAGE_ACTIONS.CMD_BRAIN_MERGE, this.handleBrainMerge)
    this.register(MESSAGE_ACTIONS.FETCH_SNIPER_TRANSCRIPT, this.handleFetchSniperTranscript)

    authManager.onAuthStateChange((user) => {
      this.broadcastAuthChanged(user)
    })

    void this.compactChatSourceBindings()
  }

  private broadcastAuthChanged(user: UserProfile | null): void {
    try {
      chrome.runtime.sendMessage(
        {
          command: "MINDDOCK_AUTH_CHANGED",
          payload: { user }
        },
        () => {
          void chrome.runtime.lastError
        }
      )
    } catch {
      // Ignore transient runtime contexts (popup closed/reloaded).
    }
  }

  private register(command: string, handler: Handler): void {
    this.handlers.set(command, handler.bind(this))
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null
    }
    return value as Record<string, unknown>
  }

  private normalizeBoundedString(value: unknown, maxLength: number): string | null {
    if (typeof value !== "string") {
      return null
    }
    const normalized = value.trim()
    if (!normalized || normalized.length > maxLength) {
      return null
    }
    return normalized
  }

  private validateIncomingMessageEnvelope(message: unknown): string | null {
    const record = this.asRecord(message)
    if (!record) {
      return "Mensagem invalida: payload de runtime deve ser objeto."
    }

    for (const field of ["command", "action", "intent"] as const) {
      const value = record[field]
      if (value === undefined) {
        continue
      }
      if (typeof value !== "string") {
        return `Mensagem invalida: campo '${field}' deve ser string.`
      }
      if (value.trim().length > MAX_MESSAGE_FIELD_LENGTH) {
        return `Mensagem invalida: campo '${field}' excede limite.`
      }
    }

    for (const field of ["payload", "tokens"] as const) {
      const value = record[field]
      if (value === undefined) {
        continue
      }
      if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
        return `Mensagem invalida: campo '${field}' contem tipo nao suportado.`
      }

      try {
        const serialized = JSON.stringify(value)
        if ((serialized?.length ?? 0) > MAX_MESSAGE_PAYLOAD_SIZE) {
          return `Mensagem invalida: campo '${field}' excede limite de tamanho.`
        }
      } catch {
        return `Mensagem invalida: campo '${field}' nao serializavel.`
      }
    }

    return null
  }

  private validateMessagePayload(action: string, payload: unknown): string | null {
    const objectPayloadActions = new Set<string>([
      MESSAGE_ACTIONS.STORE_SESSION_TOKENS,
      "MINDDOCK_SAVE_TOKENS",
      MESSAGE_ACTIONS.CMD_AUTH_SIGN_IN,
      "MINDDOCK_ADD_SOURCE",
      "MINDDOCK_IMPORT_AI_CHAT",
      "PROTOCOL_APPEND_SOURCE",
      "MINDDOCK_IMPROVE_PROMPT",
      MESSAGE_ACTIONS.PROMPT_OPTIONS,
      "MINDDOCK_ATOMIZE_NOTE",
      MESSAGE_ACTIONS.ATOMIZE_PREVIEW,
      MESSAGE_ACTIONS.SAVE_ATOMIC_NOTES,
      "MINDDOCK_EXPORT_SOURCES",
      "MINDDOCK_HIGHLIGHT_SNIPE",
      MESSAGE_ACTIONS.THREAD_LIST,
      MESSAGE_ACTIONS.THREAD_CREATE,
      MESSAGE_ACTIONS.THREAD_DELETE,
      MESSAGE_ACTIONS.THREAD_RENAME,
      MESSAGE_ACTIONS.THREAD_MESSAGES,
      MESSAGE_ACTIONS.THREAD_SAVE_MESSAGES,
      MESSAGE_ACTIONS.FETCH_SNIPER_TRANSCRIPT
    ])

    if (objectPayloadActions.has(action) && !this.asRecord(payload)) {
      return `Payload invalido para ${action}: objeto esperado.`
    }

    switch (action) {
      case MESSAGE_ACTIONS.STORE_SESSION_TOKENS:
      case "MINDDOCK_SAVE_TOKENS": {
        const record = this.asRecord(payload)
        if (!record) return `Payload invalido para ${action}.`
        const nested = this.asRecord(record.tokens) ?? {}
        const at =
          this.normalizeBoundedString(record.at, 8192) ??
          this.normalizeBoundedString(record.atToken, 8192) ??
          this.normalizeBoundedString(nested.at, 8192) ??
          this.normalizeBoundedString(nested.atToken, 8192)
        const bl =
          this.normalizeBoundedString(record.bl, 8192) ??
          this.normalizeBoundedString(record.blToken, 8192) ??
          this.normalizeBoundedString(nested.bl, 8192) ??
          this.normalizeBoundedString(nested.blToken, 8192)
        if (!at || !bl) {
          return `Payload invalido para ${action}: at/bl obrigatorios.`
        }
        return null
      }

      case MESSAGE_ACTIONS.CMD_AUTH_SIGN_IN: {
        const record = this.asRecord(payload)
        if (!record) return `Payload invalido para ${action}.`
        if (!this.normalizeBoundedString(record.email, 320)) {
          return "Payload invalido para login: email obrigatorio."
        }
        if (!this.normalizeBoundedString(record.password, 2048)) {
          return "Payload invalido para login: senha obrigatoria."
        }
        return null
      }

      case "MINDDOCK_SIGN_IN": {
        if (payload === undefined || payload === null) {
          return null
        }
        const record = this.asRecord(payload)
        if (!record) return `Payload invalido para ${action}.`
        const email = this.normalizeBoundedString(record.email, 320)
        const password = this.normalizeBoundedString(record.password, 2048)
        if ((email && !password) || (!email && password)) {
          return "Payload invalido para login legado: email e senha devem ser informados juntos."
        }
        return null
      }

      case "MINDDOCK_IMPROVE_PROMPT":
      case MESSAGE_ACTIONS.PROMPT_OPTIONS: {
        const record = this.asRecord(payload)
        if (!record || !this.normalizeBoundedString(record.prompt, 20_000)) {
          return `Payload invalido para ${action}: prompt obrigatorio.`
        }
        return null
      }

      case "MINDDOCK_ATOMIZE_NOTE":
      case MESSAGE_ACTIONS.ATOMIZE_PREVIEW: {
        const record = this.asRecord(payload)
        if (!record || !this.normalizeBoundedString(record.content, 120_000)) {
          return `Payload invalido para ${action}: content obrigatorio.`
        }
        return null
      }

      case MESSAGE_ACTIONS.SAVE_ATOMIC_NOTES: {
        const record = this.asRecord(payload)
        const notes = Array.isArray(record?.notes) ? record.notes : []
        if (notes.length === 0 || notes.length > 200) {
          return `Payload invalido para ${action}: quantidade de notas invalida.`
        }
        return null
      }

      case MESSAGE_ACTIONS.THREAD_LIST: {
        const record = this.asRecord(payload)
        if (
          !record ||
          !this.normalizeBoundedString(record.notebookId, 128)
        ) {
          return `Payload invalido para ${action}.`
        }
        return null
      }

      case MESSAGE_ACTIONS.THREAD_CREATE: {
        const record = this.asRecord(payload)
        const topic = record ? this.normalizeBoundedString(record.topic, 120) : null
        const icon = record ? this.normalizeBoundedString(record.icon, 32) : null
        if (
          !record ||
          !this.normalizeBoundedString(record.notebookId, 128) ||
          !this.normalizeBoundedString(record.name, 120) ||
          (record.topic !== undefined && record.topic !== null && !topic) ||
          (record.icon !== undefined && record.icon !== null && !icon)
        ) {
          return `Payload invalido para ${action}.`
        }
        return null
      }

      case MESSAGE_ACTIONS.THREAD_DELETE:
      case MESSAGE_ACTIONS.THREAD_MESSAGES: {
        const record = this.asRecord(payload)
        if (!record || !this.normalizeBoundedString(record.threadId, 128)) {
          return `Payload invalido para ${action}.`
        }
        return null
      }

      case MESSAGE_ACTIONS.THREAD_RENAME: {
        const record = this.asRecord(payload)
        if (
          !record ||
          !this.normalizeBoundedString(record.threadId, 128) ||
          !this.normalizeBoundedString(record.name, 120)
        ) {
          return `Payload invalido para ${action}.`
        }
        return null
      }

      case MESSAGE_ACTIONS.THREAD_SAVE_MESSAGES: {
        const record = this.asRecord(payload)
        if (
          !record ||
          !this.normalizeBoundedString(record.threadId, 128) ||
          !Array.isArray(record.messages)
        ) {
          return `Payload invalido para ${action}.`
        }
        return null
      }

      case "MINDDOCK_ADD_SOURCE": {
        const record = this.asRecord(payload)
        if (
          !record ||
          !this.normalizeBoundedString(record.notebookId, 128) ||
          !this.normalizeBoundedString(record.title, 280) ||
          !this.normalizeBoundedString(record.content, 120_000)
        ) {
          return `Payload invalido para ${action}.`
        }
        return null
      }

      case "MINDDOCK_EXPORT_SOURCES": {
        const record = this.asRecord(payload)
        const format = this.normalizeBoundedString(record?.format, 16)
        const sources = Array.isArray(record?.sources) ? record.sources : null
        if (!format || !sources) {
          return `Payload invalido para ${action}.`
        }
        if (!["markdown", "txt", "pdf", "json"].includes(format)) {
          return `Payload invalido para ${action}: formato nao suportado.`
        }
        return null
      }

      case "MINDDOCK_HIGHLIGHT_SNIPE": {
        const record = this.asRecord(payload)
        if (!record) return `Payload invalido para ${action}.`
        const content = this.normalizeBoundedString(record.content, 120_000)
        const text = this.normalizeBoundedString(record.text, 120_000)
        if (!content && !text) {
          return `Payload invalido para ${action}: content/text obrigatorio.`
        }
        return null
      }

      case MESSAGE_ACTIONS.FETCH_SNIPER_TRANSCRIPT: {
        const record = this.asRecord(payload)
        if (!record || !this.normalizeBoundedString(record.videoId, 128)) {
          return `Payload invalido para ${action}: videoId obrigatorio.`
        }

        const startSec = Number(record.startSec)
        const endSec = Number(record.endSec)
        if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) {
          return `Payload invalido para ${action}: startSec/endSec devem ser numericos.`
        }

        return null
      }

      default:
        return null
    }
  }

  async handle(
    message: ChromeMessage & { action?: string; intent?: string; tokens?: unknown },
    sender: MessageSender,
    sendResponse: (response: ChromeMessageResponse) => void
  ): Promise<void> {
    const envelopeError = this.validateIncomingMessageEnvelope(message)
    if (envelopeError) {
      sendResponse(this.normalizeResponse(this.fail(envelopeError)))
      return
    }

    const action = this.resolveIncomingAction(message)
    const handler = this.handlers.get(action)
    if (!handler) {
      sendResponse(
        this.normalizeResponse({
          success: false,
          error: `Comando desconhecido: ${action || "undefined"}`
        })
      )
      return
    }

    try {
      const payload = this.resolveIncomingPayload(message, action)
      const payloadValidationError = this.validateMessagePayload(action, payload)
      if (payloadValidationError) {
        sendResponse(this.normalizeResponse(this.fail(payloadValidationError)))
        return
      }
      const result = await handler(payload, sender)
      sendResponse(this.normalizeResponse(result))
    } catch (err) {
      const errorMsg =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message ?? "Erro desconhecido"
      console.error(`[MindDock Router] ${action}:`, err)
      sendResponse(
        this.normalizeResponse({
          success: false,
          error: errorMsg
        })
      )
    }
  }

  private normalizeResponse<T>(response: StandardResponse<T>): ChromeMessageResponse<T> {
    const normalized: ChromeMessageResponse<T> = {
      success: response.success,
      error: response.error
    }

    if (response.payload !== undefined) {
      normalized.payload = response.payload
      // Legacy alias consumed by older hooks/components.
      normalized.data = response.payload
    }

    return normalized
  }

  private ok<T>(payload?: T): StandardResponse<T> {
    if (payload === undefined) {
      return { success: true }
    }
    return { success: true, payload }
  }

  private fail<T = never>(error: string, payload?: T): StandardResponse<T> {
    if (payload === undefined) {
      return { success: false, error }
    }
    return { success: false, error, payload }
  }

  private async openUrlInTab(url: string): Promise<void> {
    const normalizedUrl = String(url ?? "").trim()
    if (!normalizedUrl) {
      throw new Error("URL do checkout ausente.")
    }

    if (!chrome.tabs?.create) {
      throw new Error("API chrome.tabs indisponivel neste contexto.")
    }

    await new Promise<void>((resolve, reject) => {
      chrome.tabs.create({ url: normalizedUrl }, () => {
        const runtimeError = chrome.runtime.lastError
        if (runtimeError?.message) {
          reject(new Error(runtimeError.message))
          return
        }
        resolve()
      })
    })
  }

  private emitResyncProgress(
    capturedFromUrl: string,
    stage: "starting" | "polling" | "uploading" | "fallback" | "done" | "error",
    attempt?: number,
    totalAttempts?: number,
    message?: string
  ): void {
    const normalizedUrl = String(capturedFromUrl ?? "").trim()
    if (!normalizedUrl || !chrome.runtime?.sendMessage) {
      return
    }

    try {
      chrome.runtime.sendMessage(
        {
          command: RESYNC_PROGRESS_EVENT,
          payload: {
            url: normalizedUrl,
            stage,
            attempt,
            totalAttempts,
            flowVersion: RESYNC_FLOW_VERSION,
            message: String(message ?? "").trim() || undefined,
            emittedAt: new Date().toISOString()
          }
        },
        () => {
          void chrome.runtime?.lastError
        }
      )
    } catch {
      // no-op: progress events are best-effort
    }
  }

  private buildResyncErrorPayload(
    notebookId: string,
    attemptedSourceId: string,
    startedAtMs: number,
    details: string
  ): {
    flowVersion: string
    details: string
    diagnostics: {
      notebookId: string
      attemptedSourceId: string | undefined
      elapsedMs: number
    }
  } {
    return {
      flowVersion: RESYNC_FLOW_VERSION,
      details,
      diagnostics: {
        notebookId,
        attemptedSourceId: String(attemptedSourceId ?? "").trim() || undefined,
        elapsedMs: Math.max(0, Date.now() - startedAtMs)
      }
    }
  }

  private classifyResyncErrorCode(errorMessage: string): string {
    const normalizedMessage = String(errorMessage ?? "").trim()
    if (!normalizedMessage) {
      return "RESYNC_UNKNOWN_ERROR"
    }

    if (/BINDING_INVALIDO/i.test(normalizedMessage)) {
      return "RESYNC_BINDING_INVALID"
    }

    if (/DELETE_FAILED|STRICT_DELETE|CRITICAL:\s*Failed to delete old source/i.test(normalizedMessage)) {
      return "RESYNC_DELETE_FAILED"
    }

    if (/INSERT_VALIDATION_FAILED|INSERT_NOT_FOUND/i.test(normalizedMessage)) {
      return "RESYNC_INSERT_INVALID"
    }

    if (/TIMEOUT|RESYNC_ABORTED|\b\d+s\b/i.test(normalizedMessage)) {
      return "RESYNC_TIMEOUT"
    }

    return "RESYNC_UNKNOWN_ERROR"
  }

  private emitResyncSuccess(
    capturedFromUrl: string,
    notebookId: string,
    sourceId: string,
    lastHash?: string
  ): void {
    const normalizedUrl = String(capturedFromUrl ?? "").trim()
    const normalizedNotebookId = String(notebookId ?? "").trim()
    const normalizedSourceId = String(sourceId ?? "").trim()
    const normalizedLastHash = String(lastHash ?? "").trim()

    if (!normalizedUrl || !normalizedNotebookId || !normalizedSourceId || !chrome.runtime?.sendMessage) {
      return
    }

    try {
      chrome.runtime.sendMessage(
        {
          command: RESYNC_SUCCESS_EVENT,
          payload: {
            url: normalizedUrl,
            notebookId: normalizedNotebookId,
            sourceId: normalizedSourceId,
            lastHash: normalizedLastHash || undefined,
            flowVersion: RESYNC_FLOW_VERSION,
            emittedAt: new Date().toISOString()
          }
        },
        () => {
          void chrome.runtime?.lastError
        }
      )
    } catch {
      // no-op: success event is best-effort
    }
  }

  private async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    const boundedTimeout = Math.max(250, timeoutMs)
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(timeoutMessage))
      }, boundedTimeout)
    })

    try {
      return (await Promise.race([operation, timeoutPromise])) as T
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }
    }
  }

  private resolveIncomingAction(
    message: ChromeMessage & { action?: string; intent?: string }
  ): string {
    const byCommand = String(message?.command ?? "").trim()
    if (byCommand) {
      return byCommand
    }

    const byAction = String(message?.action ?? "").trim()
    if (byAction) {
      return byAction
    }

    return String(message?.intent ?? "").trim()
  }

  private resolveIncomingPayload(
    message: ChromeMessage & { action?: string; intent?: string; tokens?: unknown },
    action: string
  ): unknown {
    if (message?.payload !== undefined) {
      return message.payload
    }

    // Legacy token bridge sometimes sends { tokens } instead of { payload }.
    if (action === MESSAGE_ACTIONS.STORE_SESSION_TOKENS && message?.tokens !== undefined) {
      return message.tokens
    }

    // Legacy intent payloads may arrive flat, sem wrapper "payload".
    if (message?.intent && !message?.command && !message?.action) {
      const { intent, command, action, tokens, ...rest } = message as unknown as Record<
        string,
        unknown
      >
      void intent
      void command
      void action
      void tokens
      return rest
    }

    return undefined
  }

  // Phase 1 handlers
  private async handleStoreSessionTokens(payload: unknown): Promise<StandardResponse> {
    const raw = (payload as
        | {
            at?: string
            bl?: string
            atToken?: string
            blToken?: string
            sessionId?: string
            accountEmail?: string
            authUser?: string
            authUserIndex?: string
            tokens?: {
              at?: string
              bl?: string
              atToken?: string
              blToken?: string
              accountEmail?: string
            }
          }
      | undefined) ?? { tokens: {} }

    const nestedTokens = raw.tokens ?? {}

    const at =
      String(raw.at ?? raw.atToken ?? nestedTokens.at ?? nestedTokens.atToken ?? "").trim() ||
      null
    const bl =
      String(raw.bl ?? raw.blToken ?? nestedTokens.bl ?? nestedTokens.blToken ?? "").trim() ||
      null
    const sessionId = String(raw.sessionId ?? "").trim() || null
    const accountEmail = normalizeAccountEmail(raw.accountEmail ?? nestedTokens.accountEmail)
    const authUser = String(raw.authUser ?? raw.authUserIndex ?? "").trim() || null

    if (!at || !bl) {
      return this.fail("Payload invalido para MINDDOCK_STORE_SESSION_TOKENS: at/bl obrigatorios.")
    }

    await Promise.all([
      setInSecureStorage(FIXED_STORAGE_KEYS.AT_TOKEN, at),
      setInSecureStorage(FIXED_STORAGE_KEYS.BL_TOKEN, bl),
      setInSecureStorage(FIXED_STORAGE_KEYS.SESSION_ID, sessionId),
      setInSecureStorage(FIXED_STORAGE_KEYS.TOKEN_EXPIRES_AT, Date.now() + 60 * 60 * 1000)
    ])

    const storagePatch: Record<string, unknown> = {
      [FIXED_STORAGE_KEYS.AUTH_USER]: authUser
    }
    if (accountEmail) {
      storagePatch[this.notebookAccountEmailKey] = accountEmail
    }

    await chrome.storage.local.set(storagePatch)
    return this.ok()
  }

  private buildNotebookAccountUnconfirmedError(): string {
    return (
      "Conta do NotebookLM nao confirmada. Abra o NotebookLM na conta correta, recarregue a pagina e tente novamente."
    )
  }

  private async resolveNotebookAccountScope(): Promise<{
    accountKey: string
    accountEmail: string | null
    authUser: string | null
    confirmed: boolean
  }> {
    try {
      const secureSession = await getFromSecureStorage<Record<string, unknown>>("notebooklm_session")
      const snapshot = await chrome.storage.local.get([
        FIXED_STORAGE_KEYS.AUTH_USER,
        this.notebookAccountEmailKey,
        "notebooklm_session",
        STORAGE_KEYS.SETTINGS
      ])

      const fixedAuthUser = normalizeAuthUser(snapshot[FIXED_STORAGE_KEYS.AUTH_USER])
      const fixedAccountEmail = normalizeAccountEmail(snapshot[this.notebookAccountEmailKey])

      const session = secureSession ?? snapshot["notebooklm_session"]
      const sessionTokens =
        session && typeof session === "object"
          ? (session as { authUser?: unknown; accountEmail?: unknown })
          : {}

      const sessionAuthUser = normalizeAuthUser(sessionTokens.authUser)
      const sessionAccountEmail = normalizeAccountEmail(sessionTokens.accountEmail)

      const settings =
        snapshot[STORAGE_KEYS.SETTINGS] && typeof snapshot[STORAGE_KEYS.SETTINGS] === "object"
          ? (snapshot[STORAGE_KEYS.SETTINGS] as Record<string, unknown>)
          : {}
      const settingsAccountEmail = normalizeAccountEmail(settings.notebookAccountEmail)

      const accountEmail = fixedAccountEmail ?? sessionAccountEmail ?? settingsAccountEmail
      const authUser = fixedAuthUser ?? sessionAuthUser
      const accountKey = buildNotebookAccountKey({ accountEmail, authUser })

      return {
        accountKey,
        accountEmail,
        authUser,
        confirmed: isConfirmedNotebookAccountKey(accountKey)
      }
    } catch {
      const accountKey = buildNotebookAccountKey(null)
      return {
        accountKey,
        accountEmail: null,
        authUser: null,
        confirmed: false
      }
    }
  }

  private async requireConfirmedNotebookAccount(): Promise<{
    accountKey: string
    accountEmail: string | null
    authUser: string | null
    confirmed: boolean
  }> {
    const accountScope = await this.resolveNotebookAccountScope()
    if (this.strictNotebookAccountMode && !accountScope.confirmed) {
      throw new Error(this.buildNotebookAccountUnconfirmedError())
    }

    return accountScope
  }

  private async resolveScopedNotebookStorage(
    requireConfirmedAccount = true
  ): Promise<{
    accountKey: string
    notebookCacheKey: string
    notebookCacheSyncKey: string
    defaultNotebookKey: string
    legacyDefaultNotebookKey: string
  }> {
    const accountScope = requireConfirmedAccount
      ? await this.requireConfirmedNotebookAccount()
      : await this.resolveNotebookAccountScope()
    const accountKey = accountScope.accountKey

    return {
      accountKey,
      notebookCacheKey: buildScopedStorageKey(this.notebookCacheKey, accountKey),
      notebookCacheSyncKey: buildScopedStorageKey(this.notebookCacheSyncKey, accountKey),
      defaultNotebookKey: buildScopedStorageKey("nexus_default_notebook_id", accountKey),
      legacyDefaultNotebookKey: buildScopedStorageKey("minddock_default_notebook", accountKey)
    }
  }

  private async persistDefaultNotebookIdByAccount(
    accountKey: string,
    notebookId: string
  ): Promise<void> {
    const settings = await storageManager.getSettings()
    const defaultByAccount =
      typeof settings.defaultNotebookByAccount === "object" && settings.defaultNotebookByAccount !== null
        ? (settings.defaultNotebookByAccount as Record<string, unknown>)
        : {}

    const patch: Record<string, unknown> = {
      defaultNotebookByAccount: {
        ...defaultByAccount,
        [accountKey]: notebookId
      }
    }

    await storageManager.updateSettings(patch)
  }

  private async handleSyncNotebooks(payload: unknown): Promise<StandardResponse> {
    const rawNotebooks = Array.isArray((payload as { notebooks?: unknown[] } | undefined)?.notebooks)
      ? ((payload as { notebooks?: unknown[] }).notebooks as unknown[])
      : []

    const now = new Date().toISOString()
    const notebooks = rawNotebooks
      .filter((item): item is { id?: unknown; title?: unknown } => typeof item === "object" && item !== null)
      .map((item) => ({
        id: String(item.id ?? "").trim(),
        title: String(item.title ?? "").trim(),
        createTime: now,
        updateTime: now,
        sourceCount: 0
      }))
      .filter((item) => item.id && item.title)

    const scoped = await this.resolveScopedNotebookStorage()
    await chrome.storage.local.set({
      [scoped.notebookCacheKey]: notebooks,
      [scoped.notebookCacheSyncKey]: now
    })

    return this.ok({ syncedCount: notebooks.length })
  }

  private async handleAuthSignIn(payload: unknown): Promise<StandardResponse> {
    const email = (payload as { email?: string })?.email
    const password = (payload as { password?: string })?.password

    const user = await authManager.signIn(email ?? "", password ?? "")
    return this.ok({ isAuthenticated: true, user })
  }

  private async handleAuthSignOut(): Promise<StandardResponse> {
    await authManager.signOut()
    return this.ok({ isAuthenticated: false })
  }

  private async handleAuthGetStatus(): Promise<StandardResponse> {
    const user = await authManager.initializeSession()
    return this.ok({
      isAuthenticated: !!user,
      user
    })
  }

  private async handleDevBypassSignIn(payload: unknown): Promise<StandardResponse> {
    const requestedTier = String((payload as { tier?: unknown })?.tier ?? "")
      .trim()
      .toLowerCase()
    const requestedCycle = String((payload as { cycle?: unknown })?.cycle ?? "")
      .trim()
      .toLowerCase()
    const tier: SubscriptionTier = requestedTier === "thinker_pro" ? "thinker_pro" : "thinker"
    const cycle = requestedCycle === "yearly" ? "yearly" : "monthly"
    const now = new Date().toISOString()

    const user: UserProfile = {
      id: "dev-thinker-test-user",
      email: "thinker.test@minddock.local",
      displayName: "Thinker Test",
      subscriptionTier: tier,
      subscriptionStatus: "active",
      subscriptionCycle: cycle,
      createdAt: now,
      updatedAt: now
    }

    await chrome.storage.local.set({
      [STORAGE_KEYS.USER_PROFILE]: user,
      [STORAGE_KEYS.DEV_AUTH_BYPASS]: {
        enabled: true,
        tier,
        cycle,
        token: "dev-bypass-token",
        activatedAt: now
      }
    })

    this.broadcastAuthChanged(user)

    return this.ok({ isAuthenticated: true, user, bypass: true })
  }

  private async handleGetNotebooks(): Promise<StandardResponse> {
    try {
      const notebooks = await this.loadNotebooksPreferLive()
      return this.ok(notebooks)
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : "Falha ao listar notebooks no NotebookLM.")
    }
  }

  private async handleCreateNotebook(
    payload: unknown,
    sender: MessageSender
  ): Promise<StandardResponse> {
    const data =
      (payload as {
        name?: unknown
        title?: unknown
        content?: unknown
        initialContent?: unknown
        sourceTitle?: unknown
      }) ?? {}
    const notebookName = await this.resolveNotebookCreationTitle(data, sender)
    const initialContent = String(data.initialContent ?? data.content ?? "").trim()
    const initialSourceTitle = String(data.sourceTitle ?? "").trim() || notebookName

    if (this.createNotebookRequestLocked) {
      return this.fail("Ja existe uma criacao de caderno em andamento.")
    }

    try {
      this.createNotebookRequestLocked = true
      await this.clearPendingNotebookOperation()

      const service = new NotebookLMService()
      const notebookId = await service.createNotebook(notebookName)

      let sourceAdded = false
      let warning = ""

      try {
        await this.upsertCreatedNotebookCache(notebookId, notebookName)
      } catch (cacheError) {
        const cacheErrorMessage =
          cacheError instanceof Error ? cacheError.message : String(cacheError ?? "")
        warning =
          cacheErrorMessage ||
          "Caderno criado, mas nao foi possivel atualizar o cache local da conta atual."
      }

      if (initialContent) {
        try {
          await service.addSource(notebookId, initialSourceTitle, initialContent)
          sourceAdded = true
        } catch (error) {
          const sourceWarning =
            error instanceof Error
              ? `Caderno criado, mas falhou ao adicionar o conteudo inicial: ${error.message}`
              : "Caderno criado, mas falhou ao adicionar o conteudo inicial."
          warning = warning ? `${warning} ${sourceWarning}` : sourceWarning
        }
      }

      return this.ok({
        notebookId,
        name: notebookName,
        title: notebookName,
        sourceAdded,
        warning
      })
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : "Falha ao criar o novo caderno.")
    } finally {
      this.createNotebookRequestLocked = false
    }
  }

  private async handleGetNotebookSources(payload: unknown): Promise<StandardResponse> {
    const data = (payload as { notebookId?: string }) ?? {}
    const notebookId = String(data.notebookId ?? "").trim()

    if (!notebookId) {
      return this.fail("notebookId obrigatorio para listar fontes do notebook.")
    }

    try {
      const service = new NotebookLMService()
      const sources = await service.listSources(notebookId)

      return this.ok({
        sources: sources.map((source) => ({
          id: source.id,
          title: source.title,
          url: source.docReference ?? undefined,
          isGDoc: source.isGDoc === true,
          type: source.isGDoc === true ? "gdoc" : "text"
        }))
      })
    } catch (error) {
      return this.fail(
        error instanceof Error ? error.message : "Falha ao listar fontes do notebook."
      )
    }
  }

  private async handleGetSourceContents(payload: unknown): Promise<StandardResponse> {
    const data = (payload as { notebookId?: string; sourceIds?: string[] }) ?? {}
    const notebookId = String(data.notebookId ?? "").trim()
    const sourceIds = Array.isArray(data.sourceIds)
      ? data.sourceIds.map((id) => String(id ?? "").trim()).filter(Boolean)
      : []

    if (!notebookId) {
      return this.fail("notebookId obrigatorio para buscar conteudo de fontes.")
    }

    if (sourceIds.length === 0) {
      return this.fail("sourceIds obrigatorio para buscar conteudo de fontes.")
    }

    try {
      const service = new NotebookLMService()
      const result = await service.getSourcesContent(notebookId, sourceIds)

      return this.ok({
        sourceSnippets: result.sourceSnippets,
        failedSourceIds: result.failedSourceIds
      })
    } catch (error) {
      return this.fail(
        error instanceof Error ? error.message : "Falha ao buscar conteudo das fontes."
      )
    }
  }

  private async handleRefreshGDocSources(payload: unknown): Promise<StandardResponse> {
    const data =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as {
            notebookId?: unknown
            gdocSources?: Array<{
              title?: unknown
              docReference?: unknown
              sourceUrl?: unknown
              sourceId?: unknown
            }>
          })
        : {}

    const notebookId = String(data.notebookId ?? "").trim()
    console.debug("[DIAG] notebookId recebido:", notebookId || "(vazio)")

    if (!notebookId) {
      return this.fail("notebookId obrigatorio para sincronizar Google Docs.")
    }

    const service = new NotebookLMService()
    const listedSources = await service.listSources(notebookId)

    console.debug(
      "[DIAG] fontes listadas:",
      listedSources.map((s) => ({
        id: s.id,
        title: s.title,
        isGDoc: s.isGDoc,
        gDocId: s.gDocId ?? null
      }))
    )

    const gdocSources = listedSources.filter((s) => s.isGDoc === true)
    const staticSources = listedSources.filter((s) => s.isGDoc !== true)
    console.debug(`[DIAG] GDocs detectados: ${gdocSources.length} | Estaticos: ${staticSources.length}`)

    if (listedSources.length === 0) {
      return this.ok({
        syncedCount: 0,
        total: 0,
        failedSourceTitleList: [],
        syncedSourceTitleList: [],
        refreshedSourceIds: [],
        skippedSourceTitleList: [],
        message: "Nenhuma fonte detectada para atualizar.",
      })
    }

    const results: SyncVerificationResult[] = []

    for (let index = 0; index < listedSources.length; index += 1) {
      const source = listedSources[index]
      const sourceId = String(source.id ?? "").trim()
      if (!sourceId) {
        continue
      }

      console.debug(
        `[DIAG] sync [${index + 1}/${listedSources.length}] "${source.title}" | isGDoc:${source.isGDoc} | id:${sourceId}`
      )

      const result = await service.syncGoogleDocSourceBySourceIdVerified(
        notebookId,
        sourceId,
        String(source.title ?? "").trim() || sourceId,
        source.isGDoc === true
      )

      console.debug(`[DIAG] resultado "${source.title}":`, {
        accepted: result.accepted,
        changed: result.changed,
        skipReason: result.skipReason ?? null,
      })

      results.push(result)

      if (source.isGDoc === true && index < listedSources.length - 1) {
        await sleep(300)
      }
    }

    const synced = results.filter((result) => result.changed)
    const skipped = results.filter((result) => Boolean(result.skipReason))
    const failed = results.filter((result) => !result.accepted && !result.skipReason)

    console.debug("[DIAG] resultado final:", {
      synced: synced.length,
      skipped: skipped.length,
      failed: failed.length,
      total: results.length,
    })

    return this.ok({
      syncedCount: synced.length,
      total: results.length,
      syncedSourceTitleList: synced.map((result) => result.title),
      skippedSourceTitleList: skipped.map((result) => `${result.title} (${result.skipReason})`),
      failedSourceTitleList: failed.map((result) => result.title),
      refreshedSourceIds: synced.map((result) => result.sourceId),
      message:
        synced.length > 0
          ? `${synced.length} fonte(s) sincronizada(s).`
          : skipped.length > 0
            ? "Fontes sem vinculo Google Docs ativo."
            : "Nenhuma mudanca detectada.",
    })
  }

  private async handleDeleteNotebookSources(payload: unknown): Promise<StandardResponse> {
    const data =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as {
            notebookId?: unknown
            sourceIds?: unknown[]
            sources?: Array<{
              sourceId?: unknown
              backendId?: unknown
              sourceTitle?: unknown
              rowIndex?: unknown
            }>
          })
        : {}

    const notebookId = String(data.notebookId ?? "").trim()
    const requestedSourceIds = Array.isArray(data.sourceIds)
      ? data.sourceIds.map((id) => String(id ?? "").trim()).filter(Boolean)
      : []
    const rawCandidates = Array.isArray(data.sources) ? data.sources : []
    if (!notebookId) {
      return this.fail("notebookId obrigatorio para excluir fontes.")
    }
    if (requestedSourceIds.length === 0 && rawCandidates.length === 0) {
      return this.fail("Nenhuma fonte selecionada para exclusao.")
    }

    try {
      const service = new NotebookLMService()
      const listedSources = await service.listSources(notebookId)
      if (listedSources.length === 0) {
        return this.ok({
          deletedCount: 0,
          total: rawCandidates.length,
          deletedCandidateIndexList: [],
          deletedSourceIdList: [],
          deletedSourceTitleList: [],
          skippedSourceTitleList: rawCandidates.map((candidate) =>
            String(candidate?.sourceTitle ?? "").trim() || "Fonte sem titulo"
          ),
          failedSourceTitleList: [],
          message: "Nenhuma fonte do caderno foi encontrada."
        })
      }

      const sourceById = new Map<string, (typeof listedSources)[number]>()
      const sourceIdsByTitleKey = new Map<string, string[]>()
      for (const source of listedSources) {
        const sourceId = String(source.id ?? "").trim()
        if (!sourceId) {
          continue
        }
        sourceById.set(sourceId, source)
        const titleKey = normalizeNotebookTitleKey(String(source.title ?? ""))
        if (!titleKey) {
          continue
        }
        const current = sourceIdsByTitleKey.get(titleKey) ?? []
        current.push(sourceId)
        sourceIdsByTitleKey.set(titleKey, current)
      }

      const resolvedTargets: Array<{
        candidateIndex: number
        sourceId: string
        title: string
      }> = []
      const skippedSourceTitleList: string[] = []
      const seenSourceIds = new Set<string>()

      for (const requestedSourceId of requestedSourceIds) {
        if (!requestedSourceId) {
          continue
        }
        if (!sourceById.has(requestedSourceId)) {
          skippedSourceTitleList.push(requestedSourceId)
          continue
        }
        if (seenSourceIds.has(requestedSourceId)) {
          continue
        }
        seenSourceIds.add(requestedSourceId)
        resolvedTargets.push({
          candidateIndex: -1,
          sourceId: requestedSourceId,
          title: String(sourceById.get(requestedSourceId)?.title ?? requestedSourceId).trim()
        })
      }

      for (let index = 0; index < rawCandidates.length; index += 1) {
        const candidate = rawCandidates[index]
        const sourceTitle = String(candidate?.sourceTitle ?? "").trim() || "Fonte sem titulo"
        const backendId = String(candidate?.backendId ?? "").trim()
        const sourceIdCandidate = String(candidate?.sourceId ?? "").trim()
        const rowIndexRaw =
          candidate && typeof candidate === "object" ? Number((candidate as { rowIndex?: unknown }).rowIndex) : NaN
        const rowIndex = Number.isInteger(rowIndexRaw) ? rowIndexRaw : -1
        const titleKey = normalizeNotebookTitleKey(
          sourceTitle
            .replace(/\u2026+$/gu, "")
            .replace(/\.{3,}$/gu, "")
            .trim()
        )

        let resolvedSourceId = ""
        if (backendId && sourceById.has(backendId)) {
          resolvedSourceId = backendId
        } else if (sourceIdCandidate && sourceById.has(sourceIdCandidate)) {
          resolvedSourceId = sourceIdCandidate
        } else if (rowIndex >= 0 && rowIndex < listedSources.length) {
          resolvedSourceId = String(listedSources[rowIndex]?.id ?? "").trim()
        } else if (titleKey) {
          const titleMatches = sourceIdsByTitleKey.get(titleKey) ?? []
          if (titleMatches.length === 1) {
            resolvedSourceId = titleMatches[0]
          } else {
            const fuzzyMatches = listedSources
              .filter((source) => {
                const listedTitleKey = normalizeNotebookTitleKey(String(source.title ?? ""))
                return (
                  listedTitleKey.length > 0 &&
                  (listedTitleKey.includes(titleKey) || titleKey.includes(listedTitleKey))
                )
              })
              .map((source) => String(source.id ?? "").trim())
              .filter(Boolean)
            if (fuzzyMatches.length === 1) {
              resolvedSourceId = fuzzyMatches[0]
            }
          }
        }

        if (!resolvedSourceId) {
          skippedSourceTitleList.push(sourceTitle)
          continue
        }

        if (seenSourceIds.has(resolvedSourceId)) {
          continue
        }
        seenSourceIds.add(resolvedSourceId)
        resolvedTargets.push({
          candidateIndex: index,
          sourceId: resolvedSourceId,
          title: String(sourceById.get(resolvedSourceId)?.title ?? sourceTitle).trim() || sourceTitle
        })
      }

      const deletedCandidateIndexList: number[] = []
      const deletedSourceIdList: string[] = []
      const deletedSourceTitleList: string[] = []
      const failedSourceTitleList: string[] = []

      for (const target of resolvedTargets) {
        try {
          await service.deleteSource(notebookId, target.sourceId)
          deletedCandidateIndexList.push(target.candidateIndex)
          deletedSourceIdList.push(target.sourceId)
          deletedSourceTitleList.push(target.title)
        } catch (error) {
          console.warn("[MindDock] Falha ao excluir fonte selecionada.", {
            notebookId,
            sourceId: target.sourceId,
            title: target.title,
            error
          })
          failedSourceTitleList.push(target.title)
        }
      }

      const deletedCount = deletedSourceIdList.length
      const total = rawCandidates.length > 0 ? rawCandidates.length : requestedSourceIds.length

      return this.ok({
        deletedCount,
        total,
        deletedCandidateIndexList,
        deletedSourceIdList,
        deletedSourceTitleList,
        skippedSourceTitleList,
        failedSourceTitleList,
        message:
          deletedCount > 0
            ? `${deletedCount} fonte(s) excluida(s).`
            : skippedSourceTitleList.length > 0
              ? "Nao foi possivel mapear as fontes selecionadas para exclusao."
              : "Nenhuma fonte foi excluida."
      })
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : "Falha ao excluir fontes selecionadas.")
    }
  }

  private async launchIdentityWebAuthFlow(
    url: string
  ): Promise<{ redirectUrl: string | null; runtimeErrorMessage: string | null }> {
    if (!chrome.identity?.launchWebAuthFlow) {
      return {
        redirectUrl: null,
        runtimeErrorMessage: "API chrome.identity indisponivel. Recarregue a extensao."
      }
    }

    return new Promise((resolve) => {
      chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectUrl) => {
        const runtimeErrorMessage = String(chrome.runtime.lastError?.message ?? "").trim()
        if (runtimeErrorMessage) {
          resolve({ redirectUrl: null, runtimeErrorMessage })
          return
        }

        resolve({
          redirectUrl: String(redirectUrl ?? "").trim() || null,
          runtimeErrorMessage: null
        })
      })
    })
  }

  // Legacy auth command preserved for popup flow that still uses OAuth Google.
  private async handleLegacySignIn(payload: unknown): Promise<StandardResponse> {
    const email = (payload as { email?: string })?.email
    const password = (payload as { password?: string })?.password

    if (email && password) {
      return this.handleAuthSignIn(payload)
    }

    try {
      const redirectDefault = chrome.identity.getRedirectURL()
      const redirectSupabasePath = chrome.identity.getRedirectURL("supabase")
      const redirectCandidates = Array.from(
        new Set([redirectDefault, redirectSupabasePath].map((value) => String(value ?? "").trim()).filter(Boolean))
      )
      const collectedErrors: string[] = []

      for (const redirectTarget of redirectCandidates) {
        try {
          const { url } = await authManager.signInWithGoogle(redirectTarget)
          const flowResult = await this.launchIdentityWebAuthFlow(url)
          if (flowResult.runtimeErrorMessage || !flowResult.redirectUrl) {
            const runtimeErrorMessage = String(
              flowResult.runtimeErrorMessage ??
                "Falha no login Google: nenhum redirect OAuth foi retornado."
            )
            collectedErrors.push(`[redirect=${redirectTarget}] ${runtimeErrorMessage}`)
            continue
          }

          const user = await authManager.completeOAuthFlow(flowResult.redirectUrl)
          return this.ok({ isAuthenticated: !!user, user })
        } catch (attemptError) {
          const message =
            attemptError instanceof Error ? attemptError.message : String(attemptError ?? "Falha desconhecida")
          collectedErrors.push(`[redirect=${redirectTarget}] ${message}`)
        }
      }

      const mergedErrorMessage = collectedErrors.join(" | ")
      if (/Authorization page could not be loaded/i.test(mergedErrorMessage)) {
        return this.fail(
          `Authorization page could not be loaded. Configure no Supabase Auth > URL Configuration os redirects: ${redirectDefault} e ${redirectSupabasePath}. Dica: adicione tambem https://*.chromiumapp.org/* para evitar erro quando o ID da extensao mudar.`
        )
      }

      return this.fail(
        collectedErrors[collectedErrors.length - 1] ?? "Falha ao concluir login."
      )
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : "Falha ao concluir login.")
    }
  }

  // Existing non-phase1 handlers
  private async handleGetSourceContent(payload: unknown): Promise<StandardResponse> {
    void payload
    return this.fail(
      "Visualizacao de fonte via background foi desativada. Use o content script para sincronizar dados do NotebookLM."
    )
  }

  private async handleAddSource(payload: unknown): Promise<StandardResponse> {
    const data = (payload as { notebookId?: string; title?: string; content?: string }) ?? {}
    const requestedNotebookId = String(data.notebookId ?? "").trim()
    const title = String(data.title ?? "").trim()
    const content = String(data.content ?? "").trim()

    if (!requestedNotebookId) {
      return this.fail("notebookId obrigatorio para adicionar fonte.")
    }

    if (!title) {
      return this.fail("title obrigatorio para adicionar fonte.")
    }

    if (!content) {
      return this.fail("content obrigatorio para adicionar fonte.")
    }

    if (!IMPORT_LIMIT_DISABLED) {
      const canImport = await storageManager.checkUsageLimit(
        "imports",
        (await subscriptionManager.getLimits()).imports_per_day
      )
      if (!canImport) {
        return this.fail("Limite diario de importacoes atingido. Faca upgrade pro plano Pro.")
      }
    }

    try {
      const service = new NotebookLMService()
      const resolvedNotebookId = await this.resolvePreferredNotebookId(requestedNotebookId, true)
      const sourceId = await service.addSource(resolvedNotebookId, title, content)
      if (!String(sourceId ?? "").trim()) {
        return this.fail("NotebookLM nao confirmou a criacao da fonte. Nenhum sourceId foi retornado.")
      }
      await storageManager.incrementUsage("imports")
      return this.ok({ success: true, notebookId: resolvedNotebookId, sourceId })
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : "Falha ao adicionar fonte.")
    }
  }

  private async handleSyncGdoc(payload: unknown): Promise<StandardResponse> {
    const data =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as {
            notebookId?: unknown
            sourceId?: unknown
            url?: unknown
            docReference?: unknown
            title?: unknown
          })
        : {}

    try {
      const service = new NotebookLMService()
      const resolvedNotebookId = await this.resolvePreferredNotebookId(
        String(data.notebookId ?? "").trim() || undefined,
        true
      )

      const sourceId = String(data.sourceId ?? "").trim()
      if (sourceId) {
        await service.syncGoogleDocSourceBySourceId(resolvedNotebookId, sourceId)
        return this.ok({
          success: true,
          notebookId: resolvedNotebookId,
          syncedCount: 1,
          total: 1
        })
      }

      const docReference = String(data.docReference ?? data.url ?? "").trim()
      const docId = extractGoogleDocIdFromValue(docReference)
      if (!docId) {
        return this.fail("Nao foi possivel identificar o ID do Google Docs para sincronizacao.")
      }

      const gdocSources = (await service.listSources(resolvedNotebookId)).filter((source) => {
        if (source.isGDoc !== true) {
          return false
        }
        const listedDocId = extractGoogleDocIdFromValue(source.gDocId ?? source.docReference)
        return listedDocId === docId
      })

      if (gdocSources.length === 0) {
        const requestedTitle = String(data.title ?? "").trim() || "Google Doc"
        const sourceIdCreated = await service.addGoogleDocSource(resolvedNotebookId, requestedTitle, docId)
        return this.ok({
          success: true,
          notebookId: resolvedNotebookId,
          sourceId: sourceIdCreated,
          syncedCount: 1,
          total: 1,
          mode: "created"
        })
      }

      let syncedCount = 0
      const failedSourceIds: string[] = []

      for (let index = 0; index < gdocSources.length; index += 1) {
        const listedSource = gdocSources[index]
        const listedSourceId = String(listedSource.id ?? "").trim()
        if (!listedSourceId) {
          continue
        }
        try {
          await service.syncGoogleDocSourceBySourceId(resolvedNotebookId, listedSourceId)
          syncedCount += 1
        } catch (error) {
          console.warn("[MindDock] Falha ao sincronizar GDoc via MINDDOCK_SYNC_GDOC.", {
            notebookId: resolvedNotebookId,
            listedSourceId,
            error
          })
          failedSourceIds.push(listedSourceId)
        }

        if (index < gdocSources.length - 1) {
          await sleep(GDOC_SYNC_STEP_DELAY_MS)
        }
      }

      return this.ok({
        success: true,
        notebookId: resolvedNotebookId,
        syncedCount,
        total: gdocSources.length,
        failedSourceIds,
        mode: "synced-existing"
      })
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : "Falha ao sincronizar Google Docs.")
    }
  }

  private async handleProtocolAppendSource(payload: unknown): Promise<StandardResponse> {
    const payloadRecord =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {}
    const {
      conversation,
      notebookId,
      sourceTitle,
      sourcePlatform,
      sourceKind,
      capturedFromUrl,
      isResync,
      overwriteSourceId,
      currentHash
    } = payload as {
      conversation?: Array<{ role?: string; content?: string }>
      notebookId?: string
      sourceTitle?: string
      sourcePlatform?: string
      sourceKind?: string
      capturedFromUrl?: string
      isResync?: boolean
      overwriteSourceId?: string
      overWriteSourceId?: string
      currentHash?: string
    }

    const safeConversation = Array.isArray(conversation)
      ? conversation
          .map((message) => ({
            role:
              message?.role === "document"
                ? "document"
                : message?.role === "assistant"
                ? "assistant"
                : "user",
            content: String(message?.content ?? "").trim()
          }))
          .filter((message) => message.content.length > 0)
      : []

    if (safeConversation.length === 0) {
      return this.fail("conversation obrigatoria para PROTOCOL_APPEND_SOURCE.")
    }

    const normalizedPlatform = normalizePlatformLabel(String(sourcePlatform ?? ""))
    const normalizedSourceKind = normalizeCaptureSourceKind(sourceKind)
    const normalizedRawTitle = String(sourceTitle ?? "")
      .trim()
      .replace(/^\[[^\]]+\]\s*/u, "")
    const capturedAtIso = new Date().toISOString()
    const normalizedTitle =
      normalizedSourceKind === "doc"
        ? normalizedRawTitle || "Untitled Document"
        : `[${normalizedPlatform}] ${normalizedRawTitle || "Untitled Chat"}`

    const googleDocId =
      normalizedSourceKind === "doc"
        ? extractGoogleDocIdFromValue(
            safeConversation.find((message) => message.role === "document")?.content ?? ""
          ) || extractGoogleDocIdFromValue(capturedFromUrl)
        : ""

    if (normalizedSourceKind === "doc" && !googleDocId) {
      return this.fail("Nao foi possivel identificar o ID do Google Docs para importacao.")
    }

    const content =
      normalizedSourceKind === "doc"
        ? googleDocId
        : formatChatAsReadableMarkdownV2(
            normalizedPlatform,
            safeConversation
              .filter((message): message is { role: "assistant" | "user"; content: string } =>
                message.role === "assistant" || message.role === "user"
              ),
            normalizedTitle
          )

    if (!content) {
      return this.fail("Conteudo extraido vazio para importacao.")
    }

    return this.handleImportAIChat({
      platform: normalizedSourceKind === "doc" ? "doc" : normalizedPlatform.toLowerCase(),
      conversationTitle: normalizedTitle,
      content,
      sourceKind: normalizedSourceKind,
      googleDocId: googleDocId || undefined,
      capturedAt: capturedAtIso,
      url: String(capturedFromUrl ?? "").trim(),
      notebookId: String(notebookId ?? "").trim() || undefined,
      isResync: isResync === true,
      overwriteSourceId:
        String(overwriteSourceId ?? payloadRecord.overWriteSourceId ?? "").trim() || undefined,
      contentHash: String(currentHash ?? "").trim() || undefined
    })
  }

  private async handleImportAIChat(payload: unknown): Promise<StandardResponse> {
    const data = (payload as {
      platform?: string
      conversationTitle?: string
      title?: string
      content?: string
      capturedAt?: string
      notebookId?: string
      url?: string
      sourceKind?: string
      googleDocId?: string
      isResync?: boolean
      overwriteSourceId?: string
      overWriteSourceId?: string
      contentHash?: string
    }) ?? {}
    const rawDataRecord =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {}

    if (!IMPORT_LIMIT_DISABLED) {
      const canImport = await storageManager.checkUsageLimit(
        "imports",
        (await subscriptionManager.getLimits()).imports_per_day
      )
      if (!canImport) {
        return this.fail("Limite diario de importacoes atingido. Faca upgrade pro plano Pro.")
      }
    }

    const conversation = typeof data.content === "string" ? data.content : ""
    console.log(`[MindDock Debug] Payload Size: ${conversation?.length || 0} chars`)
    const content = conversation.trim()

    const sourceKind = normalizeCaptureSourceKind(data.sourceKind)
    const isDocumentSource = sourceKind === "doc"
    const platform = normalizePlatformLabel(String(data.platform ?? ""))
    const resolvedNotebookId = await this.resolvePreferredNotebookId(data.notebookId, true)
    const title =
      String(data.title ?? "").trim() ||
      String(data.conversationTitle ?? "").trim() ||
      (isDocumentSource
        ? `Documento - ${new Date(data.capturedAt ?? Date.now()).toLocaleDateString("pt-BR")}`
        : `Conversa ${platform || "chat"} - ${new Date(data.capturedAt ?? Date.now()).toLocaleDateString(
            "pt-BR"
          )}`)
    const capturedFromUrl = String(data.url ?? "").trim()
    const googleDocId = extractGoogleDocIdFromValue(data.googleDocId) || extractGoogleDocIdFromValue(content)
    const requestedResync = data.isResync === true
    const overwriteSourceId = String(
      data.overwriteSourceId ?? data.overWriteSourceId ?? rawDataRecord.overWriteSourceId ?? ""
    ).trim()
    const contentHash = String(data.contentHash ?? "").trim()
    const resyncStartTs = Date.now()
    const resyncDeadlineTs = requestedResync ? resyncStartTs + RESYNC_TOTAL_BUDGET_MS : 0
    let attemptedResyncSourceId = overwriteSourceId
    const resyncInFlightKey =
      requestedResync && capturedFromUrl
        ? this.normalizeChatSourceBindingKey(capturedFromUrl, resolvedNotebookId)
        : null

    if (requestedResync && resyncInFlightKey) {
      if (this.resyncInFlight.has(resyncInFlightKey)) {
        return this.fail("Re-sync ja em andamento para este chat.")
      }
      this.resyncInFlight.add(resyncInFlightKey)
    }

    try {
      if (!content) {
        throw new Error("Extracted content is empty. Aborting upload.")
      }

      const service = new NotebookLMService()

      if (isDocumentSource) {
        if (!googleDocId) {
          throw new Error("Google Docs ID ausente no payload de importacao.")
        }

        const sourceId = await service.addGoogleDocSource(resolvedNotebookId, title, googleDocId)
        await storageManager.incrementUsage("imports")

        return this.ok({
          success: true,
          notebookId: resolvedNotebookId,
          title,
          sourceId,
          sourceKind: "doc",
          docId: googleDocId,
          updatedExisting: false
        })
      }

      const existingBoundSourceRecord = capturedFromUrl
        ? await this.readChatSourceBindingRecord(capturedFromUrl, resolvedNotebookId)
        : null
      const existingBoundSourceId = String(existingBoundSourceRecord?.sourceId ?? "").trim()
      attemptedResyncSourceId = overwriteSourceId || existingBoundSourceId
      const existingBoundHash = String(existingBoundSourceRecord?.lastSyncHash ?? "").trim()
      if (requestedResync) {
        console.log("[MindDock DEBUG] Resync hash state:", {
          contentHash,
          existingBoundHash,
          existingBoundSourceId,
          resolvedNotebookId
        })
      }

      if (requestedResync && contentHash && existingBoundSourceId && existingBoundHash === contentHash) {
        let confirmedNoop = false
        try {
          confirmedNoop = await this.withTimeout(
            service.sourceContainsExpectedContent(existingBoundSourceId, content),
            5_000,
            "Re-sync nao conseguiu confirmar conteudo atual para no-op."
          )
        } catch (noopVerifyError) {
          console.warn("[MindDock] no-op verify falhou; seguindo com re-sync para evitar falso sucesso.", noopVerifyError)
          confirmedNoop = false
        }

        if (confirmedNoop) {
          this.emitResyncProgress(capturedFromUrl, "done")
          this.emitResyncSuccess(capturedFromUrl, resolvedNotebookId, existingBoundSourceId, contentHash)
          return this.ok({
            success: true,
            notebookId: resolvedNotebookId,
            title,
            sourceId: existingBoundSourceId,
            contentHash: contentHash || undefined,
            updatedExisting: false,
            noop: true
          })
        }
      }
      const fallbackBoundSourceId =
        !overwriteSourceId && capturedFromUrl ? existingBoundSourceId : ""
      const targetSourceToSwap = overwriteSourceId || fallbackBoundSourceId
      if (
        requestedResync &&
        existingBoundSourceId &&
        overwriteSourceId &&
        existingBoundSourceId !== overwriteSourceId
      ) {
        console.warn("[ROUTER] Mismatch de binding (UI x storage).", {
          storageSourceId: existingBoundSourceId,
          uiSourceId: overwriteSourceId
        })
      }
      let swappedExisting = false
      let updatedInPlace = false
      let downgradedFromResync = false

      if (requestedResync && !targetSourceToSwap) {
        downgradedFromResync = true
        console.warn(
          "[ROUTER] Re-sync sem binding valido; fallback para nova captura (insert).",
          {
            notebookId: resolvedNotebookId,
            overwriteSourceId,
            existingBoundSourceId
          }
        )
      }

      if (requestedResync && targetSourceToSwap) {
        attemptedResyncSourceId = targetSourceToSwap
        this.emitResyncProgress(capturedFromUrl, "starting", undefined, undefined, "resolving_source")
        console.debug("[MindDock] Iniciando swap de fontes...", {
          notebookId: resolvedNotebookId,
          overwriteSourceId: targetSourceToSwap
        })
      }

      if (requestedResync && Date.now() >= resyncDeadlineTs) {
        return this.fail(
          "RESYNC_TIMEOUT",
          this.buildResyncErrorPayload(
            resolvedNotebookId,
            targetSourceToSwap,
            resyncStartTs,
            `Re-sync excedeu o limite de ${RESYNC_TOTAL_BUDGET_SECONDS}s durante a fase de validacao.`
          )
        )
      }

      let sourceId = ""
      if (requestedResync && targetSourceToSwap) {
        const remainingForCreateMs = resyncDeadlineTs - Date.now()
        if (remainingForCreateMs < 900) {
          this.emitResyncProgress(capturedFromUrl, "error")
          return this.fail(
            "RESYNC_TIMEOUT",
            this.buildResyncErrorPayload(
              resolvedNotebookId,
              targetSourceToSwap,
              resyncStartTs,
              `Re-sync excedeu o limite de ${RESYNC_TOTAL_BUDGET_SECONDS}s antes de concluir a criacao da nova fonte.`
            )
          )
        }

        try {
          const strictReplaceResult = await this.withTimeout(
            service.strictReplaceSource(
              resolvedNotebookId,
              targetSourceToSwap,
              title,
              content,
              platform,
              {
                onProgress: (progressMessage) => {
                  const normalizedProgress = String(progressMessage ?? "").trim().toLowerCase()
                  if (normalizedProgress.includes("delet")) {
                    this.emitResyncProgress(
                      capturedFromUrl,
                      "polling",
                      undefined,
                      undefined,
                      progressMessage
                    )
                    return
                  }
                  if (normalizedProgress.includes("insert")) {
                    this.emitResyncProgress(
                      capturedFromUrl,
                      "uploading",
                      undefined,
                      undefined,
                      progressMessage
                    )
                    return
                  }
                  if (normalizedProgress.includes("updat")) {
                    this.emitResyncProgress(
                      capturedFromUrl,
                      "uploading",
                      undefined,
                      undefined,
                      progressMessage
                    )
                    return
                  }
                  this.emitResyncProgress(
                    capturedFromUrl,
                    "starting",
                    undefined,
                    undefined,
                    progressMessage
                  )
                }
              }
            ),
            remainingForCreateMs,
            `Re-sync excedeu o limite de ${RESYNC_TOTAL_BUDGET_SECONDS}s ao criar a nova fonte.`
          )
          sourceId = String(strictReplaceResult.newSourceId ?? "").trim()
          swappedExisting =
            strictReplaceResult.wasReplaced === true || strictReplaceResult.updatedInPlace === true
          updatedInPlace = strictReplaceResult.updatedInPlace === true

          if (updatedInPlace && sourceId) {
            this.emitResyncProgress(
              capturedFromUrl,
              "polling",
              undefined,
              undefined,
              "confirming_updated_content"
            )

            let updateInPlaceConfirmed = false
            const verifyDeadlineTs = Date.now() + 14_000

            for (let verifyAttempt = 0; verifyAttempt < 4; verifyAttempt += 1) {
              const remainingForVerifyMs = verifyDeadlineTs - Date.now()
              if (remainingForVerifyMs <= 450) {
                break
              }

              try {
                const verifyOperation = service.sourceContainsExpectedContent(sourceId, content)
                updateInPlaceConfirmed = await this.withTimeout(
                  verifyOperation,
                  Math.min(4_500, Math.max(800, remainingForVerifyMs)),
                  "RESYNC_UPDATE_IN_PLACE_VERIFY_TIMEOUT"
                )
              } catch {
                updateInPlaceConfirmed = false
              }

              if (updateInPlaceConfirmed) {
                break
              }

              await new Promise((resolve) => setTimeout(resolve, 650))
            }

            if (!updateInPlaceConfirmed) {
              downgradedFromResync = true
              this.emitResyncProgress(
                capturedFromUrl,
                "uploading",
                undefined,
                undefined,
                "update_in_place_unverified_fallback_new_insert"
              )
              console.warn(
                "[ROUTER] update in-place nao confirmou novo conteudo; fallback para nova captura (insert).",
                {
                  notebookId: resolvedNotebookId,
                  targetSourceToSwap,
                  sourceId
                }
              )
              sourceId = await service.insertSource(resolvedNotebookId, title, content, "NEW")
              swappedExisting = false
              updatedInPlace = false
            }
          }
        } catch (strictReplaceError) {
          const strictReplaceMessage =
            strictReplaceError instanceof Error
              ? strictReplaceError.message
              : String(strictReplaceError ?? "")
          if (this.classifyResyncErrorCode(strictReplaceMessage) !== "RESYNC_BINDING_INVALID") {
            throw strictReplaceError
          }

          downgradedFromResync = true
          this.emitResyncProgress(
            capturedFromUrl,
            "uploading",
            undefined,
            undefined,
            "binding_invalid_fallback_new_insert"
          )
          console.warn(
            "[ROUTER] Binding invalido durante strict replace; fallback para nova captura (insert).",
            {
              notebookId: resolvedNotebookId,
              targetSourceToSwap,
              strictReplaceMessage
            }
          )
          sourceId = await service.insertSource(resolvedNotebookId, title, content, "NEW")
          swappedExisting = false
          updatedInPlace = false
        }
      } else if (requestedResync) {
        this.emitResyncProgress(
          capturedFromUrl,
          "uploading",
          undefined,
          undefined,
          "binding_invalid_fallback_new_insert"
        )
        sourceId = await service.insertSource(resolvedNotebookId, title, content, "NEW")
        swappedExisting = false
        updatedInPlace = false
      } else {
        sourceId = await service.insertSource(resolvedNotebookId, title, content, "NEW")
      }

      // When re-sync falls back to a new insert, enforce old-source cleanup so we don't
      // silently leave duplicated entries in NotebookLM.
      if (
        requestedResync &&
        targetSourceToSwap &&
        sourceId &&
        String(sourceId ?? "").trim() !== String(targetSourceToSwap ?? "").trim() &&
        !updatedInPlace
      ) {
        this.emitResyncProgress(
          capturedFromUrl,
          "polling",
          undefined,
          undefined,
          "finalizing_replace_cleanup"
        )

        let oldSourceRemoved = false
        let lastCleanupError = ""

        for (let cleanupAttempt = 1; cleanupAttempt <= 2; cleanupAttempt += 1) {
          try {
            await this.withTimeout(
              service.deleteSource(resolvedNotebookId, targetSourceToSwap),
              14_000,
              "RESYNC_FINAL_DELETE_TIMEOUT"
            )
            oldSourceRemoved = true
            break
          } catch (cleanupError) {
            lastCleanupError =
              cleanupError instanceof Error ? cleanupError.message : String(cleanupError ?? "")

            // Verify if source is actually still present before deciding to fail.
            try {
              const sourcesAfterCleanup = await this.withTimeout(
                service.listSources(resolvedNotebookId),
                5_000,
                "RESYNC_FINAL_DELETE_LIST_TIMEOUT"
              )
              const stillExists = sourcesAfterCleanup.some(
                (source) =>
                  String(source.id ?? "").trim() === String(targetSourceToSwap ?? "").trim()
              )
              if (!stillExists) {
                oldSourceRemoved = true
                break
              }
            } catch {
              // best-effort verification only
            }
          }
        }

        if (!oldSourceRemoved) {
          // Best effort rollback to avoid ending with duplicate sources.
          try {
            await this.withTimeout(
              service.optimisticDeleteSource(resolvedNotebookId, sourceId, {
                maxTotalMs: 5_500
              }),
              8_000,
              "RESYNC_ROLLBACK_TIMEOUT"
            )
          } catch {
            // no-op; we still return a deterministic error
          }

          return this.fail(
            "RESYNC_DELETE_FAILED",
            this.buildResyncErrorPayload(
              resolvedNotebookId,
              targetSourceToSwap,
              resyncStartTs,
              `Nao foi possivel remover a fonte antiga apos insert de fallback. oldSourceId=${targetSourceToSwap}; newSourceId=${sourceId}; detail=${lastCleanupError || "cleanup_unconfirmed"}`
            )
          )
        }
      }

      // Final guard: in re-sync, keep only one source for the same title.
      if (requestedResync && sourceId) {
        const normalizedTargetSourceId = String(sourceId ?? "").trim()
        const normalizedTitleKey = normalizeNotebookTitleKey(title)

        if (normalizedTargetSourceId && normalizedTitleKey) {
          this.emitResyncProgress(
            capturedFromUrl,
            "polling",
            undefined,
            undefined,
            "deduping_same_title_sources"
          )

          let duplicateSourceIds: string[] = []
          try {
            const listedSources = await this.withTimeout(
              service.listSources(resolvedNotebookId),
              8_000,
              "RESYNC_DEDUPE_LIST_TIMEOUT"
            )

            duplicateSourceIds = listedSources
              .map((source) => ({
                id: String(source.id ?? "").trim(),
                titleKey: normalizeNotebookTitleKey(String(source.title ?? ""))
              }))
              .filter(
                (entry) =>
                  entry.id &&
                  entry.id !== normalizedTargetSourceId &&
                  entry.titleKey &&
                  entry.titleKey === normalizedTitleKey
              )
              .map((entry) => entry.id)
          } catch (dedupeListError) {
            const detail =
              dedupeListError instanceof Error
                ? dedupeListError.message
                : String(dedupeListError ?? "dedupe_list_failed")
            return this.fail(
              "RESYNC_DELETE_FAILED",
              this.buildResyncErrorPayload(
                resolvedNotebookId,
                normalizedTargetSourceId,
                resyncStartTs,
                `Falha ao listar fontes para deduplicacao final: ${detail}`
              )
            )
          }

          if (duplicateSourceIds.length > 0) {
            for (const duplicateSourceId of duplicateSourceIds) {
              try {
                await this.withTimeout(
                  service.deleteSource(resolvedNotebookId, duplicateSourceId),
                  14_000,
                  "RESYNC_DEDUPE_DELETE_TIMEOUT"
                )
              } catch (dedupeDeleteError) {
                const detail =
                  dedupeDeleteError instanceof Error
                    ? dedupeDeleteError.message
                    : String(dedupeDeleteError ?? "dedupe_delete_failed")
                return this.fail(
                  "RESYNC_DELETE_FAILED",
                  this.buildResyncErrorPayload(
                    resolvedNotebookId,
                    duplicateSourceId,
                    resyncStartTs,
                    `Nao foi possivel remover fonte duplicada apos re-sync. duplicateSourceId=${duplicateSourceId}; keptSourceId=${normalizedTargetSourceId}; detail=${detail}`
                  )
                )
              }
            }

            try {
              const postCleanupSources = await this.withTimeout(
                service.listSources(resolvedNotebookId),
                8_000,
                "RESYNC_DEDUPE_RECHECK_TIMEOUT"
              )
              const stillDuplicated = postCleanupSources.some((source) => {
                const listedId = String(source.id ?? "").trim()
                const listedTitleKey = normalizeNotebookTitleKey(String(source.title ?? ""))
                return (
                  listedId &&
                  listedId !== normalizedTargetSourceId &&
                  listedTitleKey &&
                  listedTitleKey === normalizedTitleKey
                )
              })

              if (stillDuplicated) {
                return this.fail(
                  "RESYNC_DELETE_FAILED",
                  this.buildResyncErrorPayload(
                    resolvedNotebookId,
                    normalizedTargetSourceId,
                    resyncStartTs,
                    "Deduplicacao final nao confirmou remocao completa das fontes antigas."
                  )
                )
              }
            } catch (dedupeRecheckError) {
              const detail =
                dedupeRecheckError instanceof Error
                  ? dedupeRecheckError.message
                  : String(dedupeRecheckError ?? "dedupe_recheck_failed")
              return this.fail(
                "RESYNC_DELETE_FAILED",
                this.buildResyncErrorPayload(
                  resolvedNotebookId,
                  normalizedTargetSourceId,
                  resyncStartTs,
                  `Falha ao confirmar deduplicacao final: ${detail}`
                )
              )
            }
          }
        }
      }

      if (!String(sourceId ?? "").trim()) {
        return this.fail("NotebookLM nao confirmou a criacao da fonte. Nenhum sourceId foi retornado.")
      }

      if (capturedFromUrl && sourceId) {
        await this.persistChatSourceBinding(
          capturedFromUrl,
          resolvedNotebookId,
          sourceId,
          title,
          contentHash
        )
      }

      await storageManager.incrementUsage("imports")

      if (requestedResync) {
        this.emitResyncProgress(capturedFromUrl, "done")
        this.emitResyncSuccess(capturedFromUrl, resolvedNotebookId, sourceId, contentHash)
      }

      return this.ok({
        success: true,
        notebookId: resolvedNotebookId,
        title,
        sourceId,
        contentHash: contentHash || undefined,
        updatedExisting: swappedExisting,
        updatedInPlace,
        downgradedFromResync
      })
    } catch (error) {
      if (requestedResync) {
        this.emitResyncProgress(capturedFromUrl, "error")
      }
      const errorMessage = error instanceof Error ? error.message : "Falha ao importar conversa."
      if (requestedResync) {
        const normalizedErrorDetail = String(errorMessage ?? "").replace(/\s+/g, " ").trim()
        const errorCode = this.classifyResyncErrorCode(normalizedErrorDetail)
        return this.fail(
          errorCode,
          this.buildResyncErrorPayload(
            resolvedNotebookId,
            attemptedResyncSourceId,
            resyncStartTs,
            normalizedErrorDetail
          )
        )
      }
      return this.fail(errorMessage)
    } finally {
      if (requestedResync && resyncInFlightKey) {
        this.resyncInFlight.delete(resyncInFlightKey)
      }
    }
  }

  private async handleCheckSubscription(): Promise<StandardResponse> {
    await subscriptionManager.invalidate()
    const tier = await subscriptionManager.getTier()
    const cycle = await subscriptionManager.getCycle()
    return this.ok({ tier, cycle })
  }

  private async ensureAuthenticatedForAi(): Promise<StandardResponse | null> {
    const token = await authManager.getAccessToken()
    if (!token) {
      return this.fail("Nao autenticado.")
    }
    return null
  }

  private async enforceAiRateLimit(): Promise<StandardResponse | null> {
    const now = Date.now()

    for (const [key, timestamps] of this.aiRateLimitHits.entries()) {
      const fresh = timestamps.filter((timestamp) => now - timestamp < AI_RATE_LIMIT_WINDOW_MS)
      if (fresh.length === 0) {
        this.aiRateLimitHits.delete(key)
      } else {
        this.aiRateLimitHits.set(key, fresh)
      }
    }

    const user = await authManager.getCurrentUser()
    const key = String(user?.id ?? "").trim()
    if (!key) {
      return this.fail("Nao autenticado.")
    }

    const hits = this.aiRateLimitHits.get(key) ?? []
    if (hits.length >= AI_RATE_LIMIT_MAX_REQUESTS) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((AI_RATE_LIMIT_WINDOW_MS - (now - hits[0])) / 1000)
      )
      return this.fail(
        `Muitas requisicoes de IA em pouco tempo. Aguarde ${retryAfterSeconds}s e tente novamente.`
      )
    }

    hits.push(now)
    this.aiRateLimitHits.set(key, hits)
    return null
  }


  private async handleImprovePrompt(payload: unknown): Promise<StandardResponse> {
    const authGuard = await this.ensureAuthenticatedForAi()
    if (authGuard) {
      return authGuard
    }

    const rateGuard = await this.enforceAiRateLimit()
    if (rateGuard) {
      return rateGuard
    }

    const { prompt } = payload as { prompt: string }
    const canUseAI = await subscriptionManager.canUseFeature("ai_features")
    if (!canUseAI) {
      return this.fail("Melhoria de prompts requer plano Thinker ou superior.", {
        tier_required: "thinker",
        upgrade_url: "https://minddocklm.digital/#pricing"
      })
    }

    const limits = await subscriptionManager.getLimits()
    const canCallAI = await storageManager.checkUsageLimit(
      "aiCalls",
      limits.ai_calls_per_day ?? "unlimited"
    )
    if (!canCallAI) {
      return this.fail("Limite de chamadas de IA atingido para hoje.")
    }

    const canUseMonthlyAgile = await storageManager.checkAiMonthlyLimit(
      "agilePrompts",
      limits.agile_prompts_per_month ?? "unlimited"
    )
    if (!canUseMonthlyAgile) {
      const agileLimit = limits.agile_prompts_per_month
      return this.fail(
        typeof agileLimit === "number"
          ? `Limite mensal do Agile Prompts atingido (${agileLimit}/mes).`
          : "Limite mensal do Agile Prompts atingido."
      )
    }

    const improved = await aiService.improvePrompt(prompt, {
      surface: "agile_prompts_bar",
      intent: "rewrite_user_prompt"
    })
    await storageManager.incrementUsage("aiCalls")
    await storageManager.incrementAiMonthlyUsage("agilePrompts")
    return this.ok({ improved })
  }
  private async handlePromptOptions(payload: unknown): Promise<StandardResponse> {
    const authGuard = await this.ensureAuthenticatedForAi()
    if (authGuard) {
      return authGuard
    }

    const rateGuard = await this.enforceAiRateLimit()
    if (rateGuard) {
      return rateGuard
    }

    const { prompt } = payload as { prompt: string }
    const canUseAI = await subscriptionManager.canUseFeature("ai_features")
    if (!canUseAI) {
      return this.fail("Geracao de opcoes requer plano Thinker ou superior.", {
        tier_required: "thinker",
        upgrade_url: "https://minddocklm.digital/#pricing"
      })
    }

    const limits = await subscriptionManager.getLimits()
    const canCallAI = await storageManager.checkUsageLimit(
      "aiCalls",
      limits.ai_calls_per_day ?? "unlimited"
    )
    if (!canCallAI) {
      return this.fail("Limite de chamadas de IA atingido para hoje.")
    }

    const canUseMonthlyAgile = await storageManager.checkAiMonthlyLimit(
      "agilePrompts",
      limits.agile_prompts_per_month ?? "unlimited"
    )
    if (!canUseMonthlyAgile) {
      const agileLimit = limits.agile_prompts_per_month
      return this.fail(
        typeof agileLimit === "number"
          ? `Limite mensal do Agile Prompts atingido (${agileLimit}/mes).`
          : "Limite mensal do Agile Prompts atingido."
      )
    }

    const options = await aiService.generatePromptOptions(prompt, {
      surface: "agile_prompts_bar",
      intent: "generate_prompt_variants"
    })
    await storageManager.incrementUsage("aiCalls")
    await storageManager.incrementAiMonthlyUsage("agilePrompts")
    return this.ok({ options })
  }
  // ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ Focus Threads ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬

  private async handleThreadList(payload: unknown): Promise<StandardResponse> {
    const canUseZettel = await subscriptionManager.canUseFeature("zettelkasten")
    if (!canUseZettel) {
      return this.fail("Focus Docks requer plano Thinker ou superior.", {
        tier_required: "thinker",
        upgrade_url: "https://minddocklm.digital/#pricing"
      })
    }

    const { notebookId } = payload as { notebookId: string }
    const threads = await threadService.getThreads(notebookId)
    return this.ok({ threads })
  }

  private async handleThreadCreate(payload: unknown): Promise<StandardResponse> {
    const canUseZettel = await subscriptionManager.canUseFeature("zettelkasten")
    if (!canUseZettel) {
      return this.fail("Focus Docks requer plano Thinker ou superior.", {
        tier_required: "thinker",
        upgrade_url: "https://minddocklm.digital/#pricing"
      })
    }

    const { notebookId, name, topic, icon } = payload as {
      notebookId: string
      name: string
      topic?: string
      icon?: string
    }
    const thread = await threadService.createThread(notebookId, name, { topic, icon })
    return this.ok({ thread })
  }

  private async handleThreadDelete(payload: unknown): Promise<StandardResponse> {
    const canUseZettel = await subscriptionManager.canUseFeature("zettelkasten")
    if (!canUseZettel) {
      return this.fail("Focus Docks requer plano Thinker ou superior.", {
        tier_required: "thinker",
        upgrade_url: "https://minddocklm.digital/#pricing"
      })
    }

    const { threadId } = payload as { threadId: string }
    await threadService.deleteThread(threadId)
    return this.ok({})
  }

  private async handleThreadRename(payload: unknown): Promise<StandardResponse> {
    const canUseZettel = await subscriptionManager.canUseFeature("zettelkasten")
    if (!canUseZettel) {
      return this.fail("Focus Docks requer plano Thinker ou superior.", {
        tier_required: "thinker",
        upgrade_url: "https://minddocklm.digital/#pricing"
      })
    }

    const { threadId, name } = payload as { threadId: string; name: string }
    const thread = await threadService.renameThread(threadId, name)
    return this.ok({ thread })
  }

  private async handleThreadMessages(payload: unknown): Promise<StandardResponse> {
    const canUseZettel = await subscriptionManager.canUseFeature("zettelkasten")
    if (!canUseZettel) {
      return this.fail("Focus Docks requer plano Thinker ou superior.", {
        tier_required: "thinker",
        upgrade_url: "https://minddocklm.digital/#pricing"
      })
    }

    const { threadId } = payload as { threadId: string }
    const messages = await threadService.getMessages(threadId)
    return this.ok({ messages })
  }

  private async handleThreadSaveMessages(payload: unknown): Promise<StandardResponse> {
    const canUseZettel = await subscriptionManager.canUseFeature("zettelkasten")
    if (!canUseZettel) {
      return this.fail("Focus Docks requer plano Thinker ou superior.", {
        tier_required: "thinker",
        upgrade_url: "https://minddocklm.digital/#pricing"
      })
    }

    const { threadId, messages } = payload as {
      threadId: string
      messages: Array<{ role: "user" | "assistant"; content: string }>
    }
    await threadService.saveMessages(threadId, messages)
    return this.ok({})
  }

  private async handleOpenSidePanel(
    payload: unknown,
    sender: MessageSender
  ): Promise<StandardResponse> {
    const raw = (payload ?? {}) as {
      target?: SidePanelLaunchTarget
      draft?: SidePanelNoteDraft | null
    }

    const target = String(raw.target ?? "").trim() as SidePanelLaunchTarget
    const validTargets: SidePanelLaunchTarget[] = ["notes", "graph", "create_note", "link_note"]

    if (!validTargets.includes(target)) {
      return this.fail("Target invalido para abrir o side panel.")
    }

    const storagePayload: Record<string, unknown> = {
      [STORAGE_KEYS.SIDEPANEL_VIEW]: target
    }

    const hasDraft =
      raw.draft &&
      typeof raw.draft.title === "string" &&
      typeof raw.draft.content === "string" &&
      raw.draft.title.trim() &&
      raw.draft.content.trim()

    if (hasDraft) {
      storagePayload[STORAGE_KEYS.SIDEPANEL_NOTE_DRAFT] = {
        title: raw.draft!.title.trim(),
        content: raw.draft!.content.trim(),
        tags: Array.isArray(raw.draft!.tags)
          ? raw.draft!.tags.map((tag) => String(tag).trim()).filter(Boolean)
          : []
      }
    } else {
      storagePayload[STORAGE_KEYS.SIDEPANEL_NOTE_DRAFT] = null
    }

    await chrome.storage.local.set(storagePayload)

    if (!chrome.sidePanel?.open) {
      return this.fail("API de side panel indisponivel.")
    }

    const targetWindowId = sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT
    await chrome.sidePanel.open({ windowId: targetWindowId })

    return this.ok()
  }

  private async handleAtomizeNote(payload: unknown): Promise<StandardResponse> {
    const authGuard = await this.ensureAuthenticatedForAi()
    if (authGuard) {
      return authGuard
    }

    const rateGuard = await this.enforceAiRateLimit()
    if (rateGuard) {
      return rateGuard
    }

    const { content } = payload as { content: string }
    const canUseZettel = await subscriptionManager.canUseFeature("zettelkasten")
    if (!canUseZettel) {
      return this.fail("Zettelkasten requer plano Thinker ou superior.", {
        tier_required: "thinker",
        upgrade_url: "https://minddocklm.digital/#pricing"
      })
    }

    const limits = await subscriptionManager.getLimits()
    const canCallAI = await storageManager.checkUsageLimit(
      "aiCalls",
      limits.ai_calls_per_day ?? "unlimited"
    )
    if (!canCallAI) {
      return this.fail("Limite de chamadas de IA atingido para hoje.")
    }
    const canUseMonthlyDocksSummary = await storageManager.checkAiMonthlyLimit(
      "docksSummaries",
      limits.docks_summaries_per_month ?? "unlimited"
    )
    if (!canUseMonthlyDocksSummary) {
      const docksLimit = limits.docks_summaries_per_month
      return this.fail(
        typeof docksLimit === "number"
          ? `Limite mensal de resumos do Docks atingido (${docksLimit}/mes).`
          : "Limite mensal de resumos do Docks atingido."
      )
    }

    const user = await authManager.getCurrentUser()
    if (!user) {
      return this.fail("Nao autenticado.")
    }

    const notes = await aiService.atomizeContent(content, {
      surface: "focus_docks",
      operation: "save_atomic_notes"
    })
    await zettelkastenService.saveAtomicNotes(user.id, notes)
    await storageManager.incrementUsage("aiCalls")
    await storageManager.incrementAiMonthlyUsage("docksSummaries")
    return this.ok({ count: notes.length })
  }

  private async handleExportSources(payload: unknown): Promise<StandardResponse> {
    const { sources, format } = payload as {
      sources: unknown[]
      format: string
    }
    const canExport = await storageManager.checkUsageLimit(
      "exports",
      (await subscriptionManager.getLimits()).exports_per_day
    )
    if (!canExport) {
      return this.fail("Limite diario de exports atingido.")
    }
    const result = await exportService.export(sources as never[], format as never)
    await storageManager.incrementUsage("exports")
    return this.ok(result)
  }

  private async handleRenderPdfOffscreen(payload: unknown): Promise<StandardResponse> {
    const text = String((payload as { text?: unknown })?.text ?? "")
    if (!text.trim()) {
      return this.fail("Texto obrigatorio para gerar PDF.")
    }

    try {
      const base64 = await renderPdfBase64ViaOffscreen(text)
      return this.ok({ base64 })
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Falha ao gerar PDF no pipeline offscreen."
      return this.fail(errorMessage)
    }
  }

  private async handleHighlightSnipe(payload: unknown): Promise<StandardResponse> {
    const { content, text, title, notebookId, url } = payload as {
      content: string
      text?: string
      title: string
      notebookId?: string
      url?: string
    }
    const sourceContent = content || text || ""
    if (!sourceContent.trim()) {
      return this.fail("Conteudo vazio para captura.")
    }

    const normalizedNotebookId = String(notebookId ?? "").trim()
    const normalizedTitle =
      String(title ?? "").trim() ||
      `Selecao Web - ${new Date().toLocaleDateString("pt-BR")}`

    return this.handleImportAIChat({
      platform: "WEB",
      conversationTitle: normalizedTitle,
      content: sourceContent,
      sourceKind: "chat",
      capturedAt: new Date().toISOString(),
      notebookId: normalizedNotebookId || undefined,
      url: String(url ?? "").trim()
    })
  }

  private async handleAtomizePreview(payload: unknown): Promise<StandardResponse> {
    const authGuard = await this.ensureAuthenticatedForAi()
    if (authGuard) {
      return authGuard
    }

    const rateGuard = await this.enforceAiRateLimit()
    if (rateGuard) {
      return rateGuard
    }

    const { content } = payload as { content: string }
    if (!content?.trim()) {
      return this.fail("Conteudo vazio para atomizacao.")
    }

    const canUseZettel = await subscriptionManager.canUseFeature("zettelkasten")
    if (!canUseZettel) {
      return this.fail("Zettelkasten requer plano Thinker ou superior.", {
        tier_required: "thinker",
        upgrade_url: "https://minddocklm.digital/#pricing"
      })
    }

    const limits = await subscriptionManager.getLimits()
    const canCallAI = await storageManager.checkUsageLimit(
      "aiCalls",
      limits.ai_calls_per_day ?? "unlimited"
    )
    if (!canCallAI) {
      return this.fail("Limite de chamadas de IA atingido para hoje.")
    }
    const canUseMonthlyDocksSummary = await storageManager.checkAiMonthlyLimit(
      "docksSummaries",
      limits.docks_summaries_per_month ?? "unlimited"
    )
    if (!canUseMonthlyDocksSummary) {
      const docksLimit = limits.docks_summaries_per_month
      return this.fail(
        typeof docksLimit === "number"
          ? `Limite mensal de resumos do Docks atingido (${docksLimit}/mes).`
          : "Limite mensal de resumos do Docks atingido."
      )
    }

    const notes = await aiService.atomizeContent(content, {
      surface: "focus_docks",
      operation: "preview_atomic_notes"
    })
    await storageManager.incrementUsage("aiCalls")
    await storageManager.incrementAiMonthlyUsage("docksSummaries")
    return this.ok({ notes })
  }

  private async handleSaveAtomicNotes(payload: unknown): Promise<StandardResponse> {
    const { notes } = payload as {
      notes: Array<{ title: string; content: string; tags: string[]; source?: string }>
    }
    if (!Array.isArray(notes) || notes.length === 0) {
      return this.fail("Nenhuma nota para salvar.")
    }
    const user = await authManager.getCurrentUser()
    if (!user) {
      return this.fail("Nao autenticado.")
    }
    const sanitized = notes.map((n) => ({
      title: String(n.title ?? "").trim() || "Nota sem titulo",
      content: String(n.content ?? "").trim(),
      tags: Array.isArray(n.tags) ? n.tags.map((t) => String(t).trim()).filter(Boolean) : [],
      source: "zettel_maker"
    }))
    const saved = await zettelkastenService.saveAtomicNotes(user.id, sanitized)
    return this.ok({ count: saved.length, notes: saved })
  }

  private normalizeChatSourceBindingKey(url: string, notebookId: string): string | null {
    const keys = this.normalizeChatSourceBindingKeys(url, notebookId)
    return keys[0] ?? null
  }

  private normalizeChatSourceBindingKeys(url: string, notebookId: string): string[] {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    const rawUrl = String(url ?? "").trim()

    if (!normalizedNotebookId || !rawUrl) {
      return []
    }

    const aliases = resolveConversationAliasKeys(rawUrl)
    const primary = resolveConversationPrimaryKey(rawUrl)
    const identityKeys = [primary, ...aliases]

    return Array.from(
      new Set(
        identityKeys
          .map((entry) => String(entry ?? "").trim())
          .filter(Boolean)
          .map((entry) => `${entry}::${normalizedNotebookId}`)
      )
    )
  }

  private async readChatSourceBindingsMap(): Promise<Record<string, ChatSourceBindingRecord>> {
    const snapshot = await chrome.storage.local.get([this.chatSourceBindingsKey])
    const rawValue = snapshot[this.chatSourceBindingsKey]

    if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
      return {}
    }

    const now = Date.now()
    const output: Record<string, ChatSourceBindingRecord> = {}
    for (const [key, candidate] of Object.entries(rawValue as Record<string, unknown>)) {
      if (!key || key.length > CHAT_SOURCE_BINDING_MAX_KEY_LENGTH) {
        continue
      }

      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        continue
      }

      const sourceId = String((candidate as { sourceId?: unknown }).sourceId ?? "").trim()
      if (!sourceId) {
        continue
      }

      const updatedAtRaw = String((candidate as { updatedAt?: unknown }).updatedAt ?? "").trim()
      const updatedAtMs = Date.parse(updatedAtRaw)
      const isStale =
        !Number.isFinite(updatedAtMs) || now - updatedAtMs > CHAT_SOURCE_BINDING_MAX_AGE_MS
      if (isStale) {
        continue
      }

      const sourceTitle = String((candidate as { sourceTitle?: unknown }).sourceTitle ?? "")
        .trim()
        .slice(0, CHAT_SOURCE_BINDING_MAX_TITLE_LENGTH)
      const lastSyncHash = String((candidate as { lastSyncHash?: unknown }).lastSyncHash ?? "")
        .trim()
        .slice(0, CHAT_SOURCE_BINDING_MAX_HASH_LENGTH)

      output[key] = {
        sourceId,
        sourceTitle,
        lastSyncHash: lastSyncHash || undefined,
        updatedAt: new Date(updatedAtMs).toISOString()
      }
    }

    return output
  }

  private async writeChatSourceBindingsMap(
    bindings: Record<string, ChatSourceBindingRecord>
  ): Promise<void> {
    const now = Date.now()
    const trimmedBindings = Object.fromEntries(
      Object.entries(bindings)
        .filter(([key, value]) => {
          if (!key || key.length > CHAT_SOURCE_BINDING_MAX_KEY_LENGTH) {
            return false
          }

          const sourceId = String(value?.sourceId ?? "").trim()
          if (!sourceId) {
            return false
          }

          const updatedAtMs = Date.parse(String(value?.updatedAt ?? "").trim())
          if (!Number.isFinite(updatedAtMs) || now - updatedAtMs > CHAT_SOURCE_BINDING_MAX_AGE_MS) {
            return false
          }

          return true
        })
        .map(
          ([key, value]): [string, ChatSourceBindingRecord] => [
            key,
            {
              sourceId: String(value.sourceId ?? "").trim(),
              sourceTitle: String(value.sourceTitle ?? "")
                .trim()
                .slice(0, CHAT_SOURCE_BINDING_MAX_TITLE_LENGTH),
              lastSyncHash:
                String(value.lastSyncHash ?? "")
                  .trim()
                  .slice(0, CHAT_SOURCE_BINDING_MAX_HASH_LENGTH) || undefined,
              updatedAt: new Date(value.updatedAt).toISOString()
            }
          ]
        )
        .sort((left, right) => {
          const leftTime = Date.parse(left[1].updatedAt)
          const rightTime = Date.parse(right[1].updatedAt)
          if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
            return 0
          }
          return rightTime - leftTime
        })
        .slice(0, this.maxChatSourceBindings)
    )

    await chrome.storage.local.set({
      [this.chatSourceBindingsKey]: trimmedBindings
    })
  }

  private async compactChatSourceBindings(): Promise<void> {
    try {
      const bindings = await this.readChatSourceBindingsMap()
      await this.writeChatSourceBindingsMap(bindings)
    } catch (error) {
      console.warn("[MindDock] Falha ao compactar chatSourceBindings.", error)
    }
  }

  private async readChatSourceBinding(url: string, notebookId: string): Promise<string | null> {
    const record = await this.readChatSourceBindingRecord(url, notebookId)
    if (!record?.sourceId) {
      return null
    }

    return record.sourceId
  }

  private async readChatSourceBindingRecord(
    url: string,
    notebookId: string
  ): Promise<ChatSourceBindingRecord | null> {
    const keys = this.normalizeChatSourceBindingKeys(url, notebookId)
    if (keys.length === 0) {
      return null
    }

    const bindings = await this.readChatSourceBindingsMap()
    let selectedBinding: ChatSourceBindingRecord | null = null
    let selectedUpdatedAt = -1

    for (const key of keys) {
      const binding = bindings[key]
      if (!binding?.sourceId) {
        continue
      }

      const parsedTime = Date.parse(binding.updatedAt)
      const timeScore = Number.isFinite(parsedTime) ? parsedTime : 0
      if (!selectedBinding || timeScore >= selectedUpdatedAt) {
        selectedBinding = binding
        selectedUpdatedAt = timeScore
      }
    }

    if (!selectedBinding?.sourceId) {
      return null
    }

    return selectedBinding
  }

  private async forceDeleteSourceForResync(
    service: NotebookLMService,
    notebookId: string,
    primarySourceId: string
  ): Promise<boolean> {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    const normalizedPrimarySourceId = String(primarySourceId ?? "").trim()
    if (!normalizedNotebookId || !normalizedPrimarySourceId) {
      return true
    }

    try {
      return await service.smartDeleteSource(normalizedNotebookId, normalizedPrimarySourceId)
    } catch (error) {
      console.warn("[MindDock] smartDeleteSource falhou durante re-sync.", error)
      return true
    }
  }

  private async persistChatSourceBinding(
    url: string,
    notebookId: string,
    sourceId: string,
    sourceTitle: string,
    lastSyncHash?: string
  ): Promise<void> {
    const keys = this.normalizeChatSourceBindingKeys(url, notebookId)
    if (keys.length === 0) {
      return
    }

    const normalizedSourceId = String(sourceId ?? "").trim()
    if (!normalizedSourceId) {
      return
    }

    const bindings = await this.readChatSourceBindingsMap()
    const normalizedLastSyncHash = String(lastSyncHash ?? "").trim()
    const nextRecord: ChatSourceBindingRecord = {
      sourceId: normalizedSourceId,
      sourceTitle: String(sourceTitle ?? "")
        .trim()
        .slice(0, CHAT_SOURCE_BINDING_MAX_TITLE_LENGTH),
      lastSyncHash: normalizedLastSyncHash.slice(0, CHAT_SOURCE_BINDING_MAX_HASH_LENGTH) || undefined,
      updatedAt: new Date().toISOString()
    }
    for (const key of keys) {
      bindings[key] = nextRecord
    }

    await this.writeChatSourceBindingsMap(bindings)
  }

  private async clearPendingNotebookOperation(): Promise<void> {
    await chrome.storage.local.remove([
      this.pendingNotebookNameKey,
      this.pendingNotebookRequestedAtKey,
      this.pendingNotebookPhaseKey,
      this.pendingNotebookResultKey,
      this.pendingNotebookErrorKey
    ])
  }

  private normalizeNotebookCreationTitle(title: string): string {
    const cleanedTitle = stripTrailingContextSnippet(
      String(title ?? "")
      .replace(/\s*-\s*ChatGPT\s*$/i, "")
      .replace(/\s*-\s*Claude\s*$/i, "")
      .replace(/\s*\|\s*Claude\s*$/i, "")
      .replace(/\s*-\s*Gemini\s*$/i, "")
      .replace(/\s*-\s*Google Gemini\s*$/i, "")
      .replace(/\s*-\s*Perplexity\s*$/i, "")
      .replace(/\s*\|\s*Perplexity\s*$/i, "")
      .replace(/\s*-\s*NotebookLM\s*$/i, "")
      .trim()
    )

    return cleanedTitle || "Sem Titulo"
  }

  private async resolveMetadataTabId(sender: MessageSender): Promise<number | null> {
    if (typeof sender.tab?.id === "number") {
      return sender.tab.id
    }

    return new Promise((resolve) => {
      try {
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
          const runtimeErrorMessage = String(chrome.runtime.lastError?.message ?? "").trim()
          if (runtimeErrorMessage) {
            resolve(null)
            return
          }

          const activeTabId = tabs.find((tab) => typeof tab.id === "number")?.id ?? null
          resolve(typeof activeTabId === "number" ? activeTabId : null)
        })
      } catch {
        resolve(null)
      }
    })
  }

  private async requestActiveTabMetadata(
    sender: MessageSender
  ): Promise<{ title: string; url: string } | null> {
    const tabId = await this.resolveMetadataTabId(sender)
    if (tabId === null) {
      return null
    }

    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(
          tabId,
          { command: "GET_PAGE_METADATA" },
          (response?: ChromeMessageResponse<Record<string, unknown>>) => {
            const runtimeErrorMessage = String(chrome.runtime.lastError?.message ?? "").trim()
            if (runtimeErrorMessage || !response?.success) {
              resolve(null)
              return
            }

            const payload = ((response.payload ?? response.data) as Record<string, unknown> | undefined) ?? {}
            const title = String(payload.title ?? "").trim()
            const url = String(payload.url ?? "").trim()

            if (!title && !url) {
              resolve(null)
              return
            }

            resolve({ title, url })
          }
        )
      } catch {
        resolve(null)
      }
    })
  }

  private async resolveNotebookCreationTitle(
    data: {
      name?: unknown
      title?: unknown
    },
    sender: MessageSender
  ): Promise<string> {
    const requestedTitle = String(data.name ?? data.title ?? "").trim()
    if (requestedTitle) {
      return this.normalizeNotebookCreationTitle(requestedTitle)
    }

    const pageMetadata = await this.requestActiveTabMetadata(sender)
    if (pageMetadata?.title) {
      return this.normalizeNotebookCreationTitle(pageMetadata.title)
    }

    const senderTabTitle = String(sender.tab?.title ?? "").trim()
    if (senderTabTitle) {
      return this.normalizeNotebookCreationTitle(senderTabTitle)
    }

    return "Sem Titulo"
  }

  private async upsertCreatedNotebookCache(notebookId: string, notebookTitle: string): Promise<void> {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    const normalizedNotebookTitle = String(notebookTitle ?? "").trim()

    if (!normalizedNotebookId) {
      throw new Error("O NotebookLM nao retornou o ID do novo caderno.")
    }

    if (!normalizedNotebookTitle) {
      throw new Error("O NotebookLM nao retornou o titulo do novo caderno.")
    }

    const scoped = await this.resolveScopedNotebookStorage()
    const snapshot = await chrome.storage.local.get([scoped.notebookCacheKey])
    const rawItems = Array.isArray(snapshot[scoped.notebookCacheKey])
      ? (snapshot[scoped.notebookCacheKey] as unknown[])
      : []

    const now = new Date().toISOString()

    let existingCreateTime = now
    let existingSourceCount = 0

    const nextItems = rawItems
      .filter(
        (
          item
        ): item is {
          id?: unknown
          title?: unknown
          createTime?: unknown
          updateTime?: unknown
          sourceCount?: unknown
        } => typeof item === "object" && item !== null
      )
      .map((item) => ({
        id: String(item.id ?? "").trim(),
        title: String(item.title ?? "").trim(),
        createTime: String(item.createTime ?? "").trim() || now,
        updateTime: String(item.updateTime ?? "").trim() || now,
        sourceCount:
          typeof item.sourceCount === "number" && Number.isFinite(item.sourceCount)
            ? item.sourceCount
            : 0
      }))
      .filter((item) => item.id && item.title)
      .filter((item) => {
        if (item.id !== normalizedNotebookId) {
          return true
        }

        existingCreateTime = item.createTime
        existingSourceCount = item.sourceCount
        return false
      })

    nextItems.unshift({
      id: normalizedNotebookId,
      title: normalizedNotebookTitle,
      createTime: existingCreateTime,
      updateTime: now,
      sourceCount: existingSourceCount
    })

    const storagePatch: Record<string, unknown> = {
      [scoped.notebookCacheKey]: nextItems,
      [scoped.notebookCacheSyncKey]: now,
      [scoped.defaultNotebookKey]: normalizedNotebookId,
      [scoped.legacyDefaultNotebookKey]: normalizedNotebookId
    }

    await chrome.storage.local.set(storagePatch)
    await this.persistDefaultNotebookIdByAccount(scoped.accountKey, normalizedNotebookId)
  }

  private mergeNotebookLists(primaryNotebooks: Notebook[], secondaryNotebooks: Notebook[]): Notebook[] {
    const merged = new Map<string, Notebook>()
    const now = new Date().toISOString()

    const upsert = (item: Notebook, preferIncoming: boolean): void => {
      const id = String(item.id ?? "").trim()
      const title = String(item.title ?? "").trim()
      if (!id || !title || isBlockedNotebookTitle(title)) {
        return
      }

      const incomingCreateTime = String(item.createTime ?? "").trim() || now
      const incomingUpdateTime = String(item.updateTime ?? "").trim() || now
      const incomingSourceCount =
        typeof item.sourceCount === "number" && Number.isFinite(item.sourceCount) ? item.sourceCount : 0
      const existing = merged.get(id)

      if (!existing) {
        merged.set(id, {
          id,
          title,
          createTime: incomingCreateTime,
          updateTime: incomingUpdateTime,
          sourceCount: incomingSourceCount
        })
        return
      }

      const existingCreateTime = String(existing.createTime ?? "").trim() || incomingCreateTime
      const existingUpdateTime = String(existing.updateTime ?? "").trim() || incomingUpdateTime
      const existingSourceCount =
        typeof existing.sourceCount === "number" && Number.isFinite(existing.sourceCount)
          ? existing.sourceCount
          : 0

      merged.set(id, {
        id,
        title: preferIncoming ? title || existing.title : existing.title || title,
        createTime: existingCreateTime,
        updateTime: preferIncoming ? incomingUpdateTime : existingUpdateTime,
        sourceCount: Math.max(existingSourceCount, incomingSourceCount)
      })
    }

    for (const notebook of secondaryNotebooks) {
      upsert(notebook, false)
    }

    for (const notebook of primaryNotebooks) {
      upsert(notebook, true)
    }

    return Array.from(merged.values())
  }

  private shouldUseNotebookCacheFallback(): boolean {
    return !this.strictNotebookAccountMode
  }

  private async refreshNotebookCacheFromNotebookLM(): Promise<Notebook[]> {
    const service = new NotebookLMService()
    const liveNotebookEntries = await service.listNotebooks()
    if (liveNotebookEntries.length === 0) {
      return []
    }

    const now = new Date().toISOString()

    const liveNotebooks: Notebook[] = liveNotebookEntries.map((item) => ({
      id: item.id,
      title: item.title,
      createTime: now,
      updateTime: now,
      sourceCount: 0
    }))

    const scoped = await this.resolveScopedNotebookStorage()
    await chrome.storage.local.set({
      [scoped.notebookCacheKey]: liveNotebooks,
      [scoped.notebookCacheSyncKey]: now
    })

    return liveNotebooks
  }

  private async loadNotebooksPreferLive(): Promise<Notebook[]> {
    try {
      const liveNotebooks = await this.refreshNotebookCacheFromNotebookLM()
      if (liveNotebooks.length > 0) {
        return liveNotebooks
      }

      if (!this.shouldUseNotebookCacheFallback()) {
        return []
      }

      const cachedNotebooks = await this.fetchAvailableNotebooks()
      if (cachedNotebooks.length > 0) {
        console.warn("[MindDock Router] NotebookLM retornou lista vazia. Usando cache local.")
        return cachedNotebooks
      }

      return []
    } catch (error) {
      if (!this.shouldUseNotebookCacheFallback()) {
        throw error
      }

      const cachedNotebooks = await this.fetchAvailableNotebooks()
      if (cachedNotebooks.length > 0) {
        console.warn("[MindDock Router] Falha na listagem live. Usando cache local.", error)
        return cachedNotebooks
      }

      throw error
    }
  }

  private async fetchAvailableNotebooks(): Promise<Notebook[]> {
    const scoped = await this.resolveScopedNotebookStorage()
    const snapshot = await chrome.storage.local.get([scoped.notebookCacheKey])
    const rawItems = Array.isArray(snapshot[scoped.notebookCacheKey])
      ? (snapshot[scoped.notebookCacheKey] as unknown[])
      : []

    const now = new Date().toISOString()

    return rawItems
      .filter(
        (
          item
        ): item is {
          id?: unknown
          title?: unknown
          createTime?: unknown
          updateTime?: unknown
          sourceCount?: unknown
        } => typeof item === "object" && item !== null
      )
      .map((item) => ({
        id: String(item.id ?? "").trim(),
        title: String(item.title ?? "").trim(),
        createTime: String(item.createTime ?? "").trim() || now,
        updateTime: String(item.updateTime ?? "").trim() || now,
        sourceCount:
          typeof item.sourceCount === "number" && Number.isFinite(item.sourceCount)
            ? item.sourceCount
            : 0
      }))
      .filter((item) => item.id && item.title && !isBlockedNotebookTitle(item.title))
  }

  private async resolvePreferredNotebookId(
    preferredNotebookId: string | undefined,
    fallbackToFirstNotebook: boolean
  ): Promise<string> {
    const fromPayload = String(preferredNotebookId ?? "").trim()
    if (fromPayload) {
      return fromPayload
    }

    const scoped = await this.resolveScopedNotebookStorage()
    const settings = await storageManager.getSettings()

    const defaultByAccount =
      typeof settings.defaultNotebookByAccount === "object" && settings.defaultNotebookByAccount !== null
        ? (settings.defaultNotebookByAccount as Record<string, unknown>)
        : {}

    const fromScopedSettings = String(defaultByAccount[scoped.accountKey] ?? "").trim()
    if (fromScopedSettings) {
      return this.ensureNotebookIdIsValid(fromScopedSettings, fallbackToFirstNotebook)
    }

    const storageSnapshot = await chrome.storage.local.get([
      scoped.defaultNotebookKey,
      scoped.legacyDefaultNotebookKey
    ])

    const fromScopedCanonical = String(storageSnapshot[scoped.defaultNotebookKey] ?? "").trim()
    if (fromScopedCanonical) {
      return this.ensureNotebookIdIsValid(fromScopedCanonical, fallbackToFirstNotebook)
    }

    const fromScopedLegacy = String(storageSnapshot[scoped.legacyDefaultNotebookKey] ?? "").trim()
    if (fromScopedLegacy) {
      return this.ensureNotebookIdIsValid(fromScopedLegacy, fallbackToFirstNotebook)
    }

    if (!fallbackToFirstNotebook) {
      throw new Error("Nenhum notebook padrao configurado.")
    }

    return this.ensureNotebookIdIsValid(null, true)
  }

  private async ensureNotebookIdIsValid(
    candidateNotebookId: string | null,
    fallbackToFirstNotebook: boolean
  ): Promise<string> {
    const notebooks = await this.loadNotebooksPreferLive()

    if (notebooks.length === 0) {
      throw new Error("Nenhum notebook encontrado. Crie um no NotebookLM primeiro.")
    }

    const candidate = String(candidateNotebookId ?? "").trim()
    const matchingNotebook = candidate ? notebooks.find((item) => item.id === candidate) : null
    if (matchingNotebook) {
      return matchingNotebook.id
    }

    if (!fallbackToFirstNotebook) {
      throw new Error("O notebook padrao salvo nao existe mais para a conta atual.")
    }

    const fallbackNotebookId = notebooks[0].id
    const scoped = await this.resolveScopedNotebookStorage()

    const storagePatch: Record<string, unknown> = {
      [scoped.defaultNotebookKey]: fallbackNotebookId,
      [scoped.legacyDefaultNotebookKey]: fallbackNotebookId
    }

    await chrome.storage.local.set(storagePatch)
    await this.persistDefaultNotebookIdByAccount(scoped.accountKey, fallbackNotebookId)

    return fallbackNotebookId
  }

  private decodeTranscriptEntities(value: string): string {
    return String(value ?? "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, rawCodePoint: string) => {
        const codePoint = Number(rawCodePoint)
        if (!Number.isFinite(codePoint) || codePoint <= 0) {
          return ""
        }
        try {
          return String.fromCodePoint(codePoint)
        } catch {
          return ""
        }
      })
      .replace(/&#x([0-9a-f]+);/gi, (_, rawHexCodePoint: string) => {
        const codePoint = Number.parseInt(rawHexCodePoint, 16)
        if (!Number.isFinite(codePoint) || codePoint <= 0) {
          return ""
        }
        try {
          return String.fromCodePoint(codePoint)
        } catch {
          return ""
        }
      })
  }

  private normalizeTranscriptText(value: string): string {
    return this.decodeTranscriptEntities(value)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  }

  private previewTranscriptUrl(rawUrl: unknown): string {
    const normalized = String(rawUrl ?? "").trim()
    if (!normalized) {
      return "(empty)"
    }
    if (normalized.length <= 180) {
      return normalized
    }
    return `${normalized.slice(0, 150)}...[${normalized.length} chars]`
  }

  private logSniperRouter(message: string, details?: Record<string, unknown>): void {
    if (details) {
      console.info(`[YT-SNIPER][ROUTER] ${message}`, details)
      return
    }
    console.info(`[YT-SNIPER][ROUTER] ${message}`)
  }

  private normalizeTranscriptBaseUrl(rawBaseUrl: unknown): string | null {
    let normalized = String(rawBaseUrl ?? "").trim()
    if (!normalized) {
      return null
    }

    normalized = normalized
      .replace(/\\u0026/g, "&")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&")

    if (normalized.startsWith("//")) {
      normalized = `https:${normalized}`
    } else if (normalized.startsWith("/")) {
      normalized = `https://www.youtube.com${normalized}`
    }

    try {
      const url = new URL(normalized)
      if (!url.searchParams.has("fmt")) {
        url.searchParams.set("fmt", "json3")
      }
      return url.toString()
    } catch {
      return null
    }
  }

  private dedupeTranscriptLines(lines: string[]): string[] {
    const deduped: string[] = []
    for (const rawLine of lines) {
      const line = String(rawLine ?? "").trim()
      if (!line) {
        continue
      }
      if (deduped[deduped.length - 1] !== line) {
        deduped.push(line)
      }
    }
    return deduped
  }

  private pickTranscriptLinesForRange(
    cues: Array<{ startMs: number; endMs: number; text: string }>,
    rangeStartMs: number,
    rangeEndMs: number
  ): string[] {
    const lines = cues
      .filter((cue) => cue.endMs >= rangeStartMs && cue.startMs <= rangeEndMs)
      .map((cue) => cue.text)

    return this.dedupeTranscriptLines(lines)
  }

  private nearestCueDistanceMs(
    cues: Array<{ startMs: number; endMs: number; text: string }>,
    targetMs: number
  ): number {
    if (!Array.isArray(cues) || cues.length === 0) {
      return Number.POSITIVE_INFINITY
    }

    let bestDistance = Number.POSITIVE_INFINITY
    for (const cue of cues) {
      const midpointMs = Math.round((cue.startMs + cue.endMs) / 2)
      const distance = Math.abs(midpointMs - targetMs)
      if (distance < bestDistance) {
        bestDistance = distance
      }
    }
    return bestDistance
  }

  private pickNearestTranscriptLines(
    cues: Array<{ startMs: number; endMs: number; text: string }>,
    rangeStartMs: number,
    rangeEndMs: number,
    maxLines = 24
  ): string[] {
    if (!Array.isArray(cues) || cues.length === 0) {
      return []
    }

    const targetMs = Math.round((rangeStartMs + rangeEndMs) / 2)
    let nearestIndex = 0
    let nearestDistance = Number.POSITIVE_INFINITY

    for (let index = 0; index < cues.length; index += 1) {
      const cue = cues[index]
      const midpointMs = Math.round((cue.startMs + cue.endMs) / 2)
      const distance = Math.abs(midpointMs - targetMs)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestIndex = index
      }
    }

    const halfWindow = Math.max(1, Math.floor(maxLines / 2))
    const startIndex = Math.max(0, nearestIndex - halfWindow)
    const endIndex = Math.min(cues.length, startIndex + maxLines)
    const lines = cues.slice(startIndex, endIndex).map((cue) => cue.text)
    return this.dedupeTranscriptLines(lines)
  }

  private extractCaptionTextFromJson3(
    rawBody: string,
    rangeStartMs: number,
    rangeEndMs: number
  ): string | null {
    let parsed: { events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: unknown[] }> } | null = null
    try {
      parsed = JSON.parse(rawBody) as {
        events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: unknown[] }>
      }
    } catch {
      parsed = null
    }

    if (!parsed || !Array.isArray(parsed.events)) {
      return null
    }

    const cuesAssumingMs: Array<{ startMs: number; endMs: number; text: string }> = []
    const cuesAssumingSec: Array<{ startMs: number; endMs: number; text: string }> = []

    for (const event of parsed.events) {
      const startValue = Number(event?.tStartMs)
      if (!Number.isFinite(startValue) || startValue < 0) {
        continue
      }

      const segments = Array.isArray(event?.segs) ? event.segs : []
      const rawText = segments
        .map((segment) => {
          if (!segment || typeof segment !== "object") {
            return ""
          }
          return String((segment as { utf8?: unknown }).utf8 ?? "")
        })
        .join("")
      const normalizedText = this.normalizeTranscriptText(rawText)
      if (!normalizedText) {
        continue
      }

      const durationValue = Number(event?.dDurationMs)
      const durationMsForMsScale =
        Number.isFinite(durationValue) && durationValue > 0 ? Math.round(durationValue) : 2500
      const durationMsForSecScale =
        Number.isFinite(durationValue) && durationValue > 0 ? Math.round(durationValue * 1000) : 2500

      const startMsAssumingMs = Math.round(startValue)
      const endMsAssumingMs = startMsAssumingMs + durationMsForMsScale
      cuesAssumingMs.push({
        startMs: startMsAssumingMs,
        endMs: endMsAssumingMs,
        text: normalizedText
      })

      const startMsAssumingSec = Math.round(startValue * 1000)
      const endMsAssumingSec = startMsAssumingSec + durationMsForSecScale
      cuesAssumingSec.push({
        startMs: startMsAssumingSec,
        endMs: endMsAssumingSec,
        text: normalizedText
      })
    }

    const linesMs = this.pickTranscriptLinesForRange(cuesAssumingMs, rangeStartMs, rangeEndMs)
    const linesSec = this.pickTranscriptLinesForRange(cuesAssumingSec, rangeStartMs, rangeEndMs)

    const selectedLinesByRange = linesMs.length >= linesSec.length ? linesMs : linesSec
    if (selectedLinesByRange.length > 0) {
      return selectedLinesByRange.join("\n").trim() || null
    }

    const targetMs = Math.round((rangeStartMs + rangeEndMs) / 2)
    const distanceMs = this.nearestCueDistanceMs(cuesAssumingMs, targetMs)
    const distanceSec = this.nearestCueDistanceMs(cuesAssumingSec, targetMs)
    const nearestLines =
      distanceMs <= distanceSec
        ? this.pickNearestTranscriptLines(cuesAssumingMs, rangeStartMs, rangeEndMs)
        : this.pickNearestTranscriptLines(cuesAssumingSec, rangeStartMs, rangeEndMs)

    const mergedNearest = nearestLines.join("\n").trim()
    return mergedNearest || null
  }

  private extractCaptionTextFromXml(
    rawBody: string,
    rangeStartMs: number,
    rangeEndMs: number
  ): string | null {
    const cuesAssumingMs: Array<{ startMs: number; endMs: number; text: string }> = []
    const cuesAssumingSec: Array<{ startMs: number; endMs: number; text: string }> = []

    const genericNodeRegex = /<(text|p)\b([^>]*)>([\s\S]*?)<\/\1>/giu
    let match: RegExpExecArray | null

    while ((match = genericNodeRegex.exec(rawBody)) !== null) {
      const tagName = String(match[1] ?? "").toLowerCase()
      const attrs = String(match[2] ?? "")
      const body = String(match[3] ?? "")

      const startSecRaw = /(?:^|\s)start="([^"]+)"/u.exec(attrs)?.[1]
      const durSecRaw = /(?:^|\s)dur="([^"]+)"/u.exec(attrs)?.[1]
      const startMsRaw = /(?:^|\s)t="([^"]+)"/u.exec(attrs)?.[1]
      const durMsRaw = /(?:^|\s)d="([^"]+)"/u.exec(attrs)?.[1]

      const normalizedText = this.normalizeTranscriptText(body)
      if (!normalizedText) {
        continue
      }

      if (tagName === "text" || startSecRaw !== undefined || durSecRaw !== undefined) {
        const startSec = Number(startSecRaw ?? "")
        if (!Number.isFinite(startSec) || startSec < 0) {
          continue
        }

        const durSec = Number(durSecRaw ?? "")
        const startMs = Math.round(startSec * 1000)
        const endMs =
          Number.isFinite(durSec) && durSec > 0 ? startMs + Math.round(durSec * 1000) : startMs + 2500
        cuesAssumingMs.push({ startMs, endMs, text: normalizedText })
        cuesAssumingSec.push({ startMs, endMs, text: normalizedText })
        continue
      }

      const startValue = Number(startMsRaw ?? "")
      if (!Number.isFinite(startValue) || startValue < 0) {
        continue
      }

      const durValue = Number(durMsRaw ?? "")

      const startMsAssumingMs = Math.round(startValue)
      const endMsAssumingMs =
        Number.isFinite(durValue) && durValue > 0
          ? startMsAssumingMs + Math.round(durValue)
          : startMsAssumingMs + 2500

      const startMsAssumingSec = Math.round(startValue * 1000)
      const endMsAssumingSec =
        Number.isFinite(durValue) && durValue > 0
          ? startMsAssumingSec + Math.round(durValue * 1000)
          : startMsAssumingSec + 2500

      cuesAssumingMs.push({ startMs: startMsAssumingMs, endMs: endMsAssumingMs, text: normalizedText })
      cuesAssumingSec.push({
        startMs: startMsAssumingSec,
        endMs: endMsAssumingSec,
        text: normalizedText
      })
    }

    const linesMs = this.pickTranscriptLinesForRange(cuesAssumingMs, rangeStartMs, rangeEndMs)
    const linesSec = this.pickTranscriptLinesForRange(cuesAssumingSec, rangeStartMs, rangeEndMs)

    const selectedLinesByRange = linesMs.length >= linesSec.length ? linesMs : linesSec
    if (selectedLinesByRange.length > 0) {
      return selectedLinesByRange.join("\n").trim() || null
    }

    const targetMs = Math.round((rangeStartMs + rangeEndMs) / 2)
    const distanceMs = this.nearestCueDistanceMs(cuesAssumingMs, targetMs)
    const distanceSec = this.nearestCueDistanceMs(cuesAssumingSec, targetMs)
    const nearestLines =
      distanceMs <= distanceSec
        ? this.pickNearestTranscriptLines(cuesAssumingMs, rangeStartMs, rangeEndMs)
        : this.pickNearestTranscriptLines(cuesAssumingSec, rangeStartMs, rangeEndMs)

    const mergedNearest = nearestLines.join("\n").trim()
    return mergedNearest || null
  }

  private extractAllCaptionTextFromJson3(rawBody: string): string | null {
    try {
      const parsed = JSON.parse(rawBody) as { events?: Array<{ segs?: unknown[] }> }
      if (!parsed || !Array.isArray(parsed.events)) {
        return null
      }

      const lines = parsed.events
        .map((event) => {
          const segments = Array.isArray(event?.segs) ? event.segs : []
          const rawText = segments
            .map((segment) => {
              if (!segment || typeof segment !== "object") {
                return ""
              }
              return String((segment as { utf8?: unknown }).utf8 ?? "")
            })
            .join("")
          return this.normalizeTranscriptText(rawText)
        })
        .filter(Boolean)

      const merged = this.dedupeTranscriptLines(lines).join("\n").trim()
      return merged || null
    } catch {
      return null
    }
  }

  private extractAllCaptionTextFromVtt(rawBody: string): string | null {
    const trimmed = String(rawBody ?? "").trim()
    if (!/^WEBVTT/i.test(trimmed)) {
      return null
    }

    const lines = trimmed
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) return false
        if (/^WEBVTT$/i.test(line)) return false
        if (/^\d+$/u.test(line)) return false
        if (/^\d{1,2}:\d{2}(?::\d{2})?\.\d{3}\s+-->\s+\d{1,2}:\d{2}(?::\d{2})?\.\d{3}$/u.test(line)) {
          return false
        }
        return true
      })
      .map((line) => this.normalizeTranscriptText(line))
      .filter(Boolean)

    const merged = this.dedupeTranscriptLines(lines).join("\n").trim()
    return merged || null
  }

  private parseVttTimestampToMs(rawValue: string): number {
    const normalized = String(rawValue ?? "").trim()
    const parts = normalized.split(":")
    if (parts.length < 2 || parts.length > 3) {
      return NaN
    }

    const hasHours = parts.length === 3
    const hours = hasHours ? Number(parts[0]) : 0
    const minutes = Number(parts[hasHours ? 1 : 0])
    const secAndMs = String(parts[hasHours ? 2 : 1] ?? "")
    const [secRaw, msRaw] = secAndMs.split(".")
    const seconds = Number(secRaw)
    const milliseconds = Number((msRaw ?? "0").padEnd(3, "0").slice(0, 3))

    if (
      !Number.isFinite(hours) ||
      !Number.isFinite(minutes) ||
      !Number.isFinite(seconds) ||
      !Number.isFinite(milliseconds)
    ) {
      return NaN
    }

    return Math.round((((hours * 60 + minutes) * 60 + seconds) * 1000) + milliseconds)
  }

  private extractCaptionTextFromVttRange(
    rawBody: string,
    rangeStartMs: number,
    rangeEndMs: number
  ): string | null {
    const trimmed = String(rawBody ?? "").trim()
    if (!/^WEBVTT/i.test(trimmed)) {
      return null
    }

    const blocks = trimmed.split(/\r?\n\r?\n/u)
    const cues: Array<{ startMs: number; endMs: number; text: string }> = []

    for (const block of blocks) {
      const lines = block
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
      if (lines.length < 2) {
        continue
      }

      const timeLineIndex = lines.findIndex((line) => line.includes("-->"))
      if (timeLineIndex < 0) {
        continue
      }

      const timeLine = lines[timeLineIndex]
      const [startRaw, endRaw] = timeLine.split("-->").map((value) => String(value ?? "").trim())
      const startMs = this.parseVttTimestampToMs(startRaw)
      const endMs = this.parseVttTimestampToMs(endRaw)
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        continue
      }

      const cueText = lines
        .slice(timeLineIndex + 1)
        .map((line) => this.normalizeTranscriptText(line))
        .filter(Boolean)
        .join(" ")
        .trim()
      if (!cueText) {
        continue
      }

      cues.push({ startMs, endMs, text: cueText })
    }

    const lines = this.pickTranscriptLinesForRange(cues, rangeStartMs, rangeEndMs)
    if (lines.length > 0) {
      return lines.join("\n").trim() || null
    }

    const nearest = this.pickNearestTranscriptLines(cues, rangeStartMs, rangeEndMs)
    const mergedNearest = nearest.join("\n").trim()
    return mergedNearest || null
  }

  private extractAllCaptionTextFromXml(rawBody: string): string | null {
    const lines: string[] = []
    const nodeRegex = /<(text|p|s|span)\b[^>]*>([\s\S]*?)<\/\1>/giu
    let match: RegExpExecArray | null

    while ((match = nodeRegex.exec(rawBody)) !== null) {
      const normalized = this.normalizeTranscriptText(String(match[2] ?? ""))
      if (!normalized) {
        continue
      }
      lines.push(normalized)
    }

    const merged = this.dedupeTranscriptLines(lines).join("\n").trim()
    return merged || null
  }

  private extractAnyCaptionText(rawBody: string): string | null {
    const fromJson = this.extractAllCaptionTextFromJson3(rawBody)
    if (fromJson) {
      return fromJson
    }

    const fromVtt = this.extractAllCaptionTextFromVtt(rawBody)
    if (fromVtt) {
      return fromVtt
    }

    return this.extractAllCaptionTextFromXml(rawBody)
  }

  private buildTimedTextFallbackUrls(videoId: string): string[] {
    const normalizedVideoId = String(videoId ?? "").trim()
    if (!normalizedVideoId) {
      return []
    }

    const langCandidates = ["pt-BR", "pt", "en"]
    const formatCandidates = ["json3", "vtt"]
    const kindCandidates = ["", "asr"]
    const urls = new Set<string>()

    for (const lang of langCandidates) {
      for (const fmt of formatCandidates) {
        for (const kind of kindCandidates) {
          const url = new URL("https://www.youtube.com/api/timedtext")
          url.searchParams.set("v", normalizedVideoId)
          url.searchParams.set("lang", lang)
          url.searchParams.set("fmt", fmt)
          if (kind) {
            url.searchParams.set("kind", kind)
          }
          urls.add(url.toString())
        }
      }
    }

    return Array.from(urls)
  }

  private async fetchCaptionSliceFromTimedTextFallback(
    videoId: string,
    rangeStartMs: number,
    rangeEndMs: number
  ): Promise<string | null> {
    const candidateUrls = this.buildTimedTextFallbackUrls(videoId)
    let looseFallbackText: string | null = null
    this.logSniperRouter("Starting timedtext fallback lookup.", {
      videoId,
      rangeStartMs,
      rangeEndMs,
      candidateCount: candidateUrls.length
    })

    for (const [candidateIndex, candidateUrl] of candidateUrls.entries()) {
      try {
        const response = await fetch(candidateUrl, {
          method: "GET",
          credentials: "include"
        })
        if (!response.ok) {
          this.logSniperRouter("Timedtext fallback candidate returned non-OK status.", {
            videoId,
            candidateIndex,
            status: response.status,
            urlPreview: this.previewTranscriptUrl(candidateUrl)
          })
          continue
        }

        const rawBody = await response.text()
        const fromJson = this.extractCaptionTextFromJson3(rawBody, rangeStartMs, rangeEndMs)
        if (fromJson) {
          this.logSniperRouter("Timedtext fallback resolved via json3 range parser.", {
            videoId,
            candidateIndex,
            textLength: fromJson.length,
            urlPreview: this.previewTranscriptUrl(candidateUrl)
          })
          return fromJson
        }

        const fromXml = this.extractCaptionTextFromXml(rawBody, rangeStartMs, rangeEndMs)
        if (fromXml) {
          this.logSniperRouter("Timedtext fallback resolved via XML range parser.", {
            videoId,
            candidateIndex,
            textLength: fromXml.length,
            urlPreview: this.previewTranscriptUrl(candidateUrl)
          })
          return fromXml
        }

        const fromVtt = this.extractCaptionTextFromVttRange(rawBody, rangeStartMs, rangeEndMs)
        if (fromVtt) {
          this.logSniperRouter("Timedtext fallback resolved via VTT range parser.", {
            videoId,
            candidateIndex,
            textLength: fromVtt.length,
            urlPreview: this.previewTranscriptUrl(candidateUrl)
          })
          return fromVtt
        }

        const fromAny = this.extractAnyCaptionText(rawBody)
        if (fromAny && !looseFallbackText) {
          looseFallbackText = fromAny
          this.logSniperRouter("Timedtext fallback captured loose transcript (without timing filter).", {
            videoId,
            candidateIndex,
            textLength: fromAny.length,
            urlPreview: this.previewTranscriptUrl(candidateUrl)
          })
        }
      } catch (error) {
        this.logSniperRouter("Timedtext fallback candidate threw fetch/parse error.", {
          videoId,
          candidateIndex,
          error: error instanceof Error ? error.message : String(error ?? "unknown"),
          urlPreview: this.previewTranscriptUrl(candidateUrl)
        })
      }
    }

    this.logSniperRouter("Timedtext fallback finished.", {
      videoId,
      hasLooseFallbackText: Boolean(looseFallbackText),
      looseFallbackTextLength: looseFallbackText?.length ?? 0
    })
    return looseFallbackText
  }

  private async fetchCaptionSliceFromBaseUrl(
    baseUrl: string,
    startSec: number,
    endSec: number
  ): Promise<string | null> {
    const rangeStartMs = Math.max(0, Math.round(startSec * 1000))
    const rangeEndMs = Math.max(rangeStartMs, Math.round(endSec * 1000))
    const normalizedBaseUrl = this.normalizeTranscriptBaseUrl(baseUrl)
    this.logSniperRouter("Fetching caption slice from baseUrl.", {
      startSec,
      endSec,
      rangeStartMs,
      rangeEndMs,
      hasBaseUrl: Boolean(baseUrl),
      hasNormalizedBaseUrl: Boolean(normalizedBaseUrl),
      baseUrlPreview: this.previewTranscriptUrl(baseUrl),
      normalizedBaseUrlPreview: this.previewTranscriptUrl(normalizedBaseUrl)
    })
    if (!normalizedBaseUrl) {
      return null
    }

    const jsonUrl = new URL(normalizedBaseUrl)
    jsonUrl.searchParams.set("fmt", "json3")
    const xmlUrl = new URL(normalizedBaseUrl)
    xmlUrl.searchParams.delete("fmt")

    const candidateUrls = [jsonUrl.toString(), xmlUrl.toString()]

    let lastErrorMessage = ""
    let fallbackTextWithoutTiming: string | null = null

    for (const [candidateIndex, candidateUrl] of candidateUrls.entries()) {
      try {
        const response = await fetch(candidateUrl, {
          method: "GET",
          credentials: "include"
        })
        if (!response.ok) {
          lastErrorMessage = `HTTP ${response.status}`
          this.logSniperRouter("BaseUrl candidate returned non-OK status.", {
            candidateIndex,
            status: response.status,
            urlPreview: this.previewTranscriptUrl(candidateUrl)
          })
          continue
        }

        const rawBody = await response.text()
        const fromJson = this.extractCaptionTextFromJson3(rawBody, rangeStartMs, rangeEndMs)
        if (fromJson) {
          this.logSniperRouter("BaseUrl candidate resolved via json3 range parser.", {
            candidateIndex,
            textLength: fromJson.length,
            urlPreview: this.previewTranscriptUrl(candidateUrl)
          })
          return fromJson
        }

        const fromXml = this.extractCaptionTextFromXml(rawBody, rangeStartMs, rangeEndMs)
        if (fromXml) {
          this.logSniperRouter("BaseUrl candidate resolved via XML range parser.", {
            candidateIndex,
            textLength: fromXml.length,
            urlPreview: this.previewTranscriptUrl(candidateUrl)
          })
          return fromXml
        }

        const fromAnyFormat = this.extractAnyCaptionText(rawBody)
        if (fromAnyFormat && !fallbackTextWithoutTiming) {
          fallbackTextWithoutTiming = fromAnyFormat
          this.logSniperRouter("BaseUrl candidate produced loose transcript (without timing filter).", {
            candidateIndex,
            textLength: fromAnyFormat.length,
            urlPreview: this.previewTranscriptUrl(candidateUrl)
          })
        }
      } catch (error) {
        lastErrorMessage =
          error instanceof Error ? error.message : String(error ?? "Erro ao buscar transcricao")
        this.logSniperRouter("BaseUrl candidate threw fetch/parse error.", {
          candidateIndex,
          error: lastErrorMessage,
          urlPreview: this.previewTranscriptUrl(candidateUrl)
        })
      }
    }

    if (fallbackTextWithoutTiming) {
      this.logSniperRouter("Returning loose transcript from baseUrl flow.", {
        textLength: fallbackTextWithoutTiming.length
      })
      return fallbackTextWithoutTiming
    }

    if (lastErrorMessage) {
      this.logSniperRouter("BaseUrl flow exhausted with last error.", { lastErrorMessage })
      throw new Error(lastErrorMessage)
    }

    this.logSniperRouter("BaseUrl flow exhausted with no transcript text.")
    return null
  }

  private extractJsonArrayAt(source: string, startIndex: number): string | null {
    if (startIndex < 0 || startIndex >= source.length || source[startIndex] !== "[") {
      return null
    }

    let depth = 0
    let inString = false
    let escaped = false

    for (let index = startIndex; index < source.length; index += 1) {
      const ch = source[index]

      if (escaped) {
        escaped = false
        continue
      }
      if (ch === "\\") {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = !inString
        continue
      }
      if (inString) {
        continue
      }

      if (ch === "[") {
        depth += 1
      } else if (ch === "]") {
        depth -= 1
        if (depth === 0) {
          return source.slice(startIndex, index + 1)
        }
      }
    }

    return null
  }

  private extractCaptionTracksFromWatchHtml(
    html: string
  ): Array<{ baseUrl?: string; languageCode?: string; kind?: string; vssId?: string }> {
    const marker = '"captionTracks":'
    const markerIndex = html.indexOf(marker)
    if (markerIndex < 0) {
      return []
    }

    const arrayStart = html.indexOf("[", markerIndex + marker.length)
    const arrayText = this.extractJsonArrayAt(html, arrayStart)
    if (!arrayText) {
      return []
    }

    try {
      const parsed = JSON.parse(arrayText)
      return Array.isArray(parsed)
        ? (parsed as Array<{ baseUrl?: string; languageCode?: string; kind?: string; vssId?: string }>)
        : []
    } catch {
      return []
    }
  }

  private pickCaptionTrackBaseUrl(
    tracks: Array<{ baseUrl?: string; languageCode?: string; kind?: string; vssId?: string }>
  ): string | null {
    if (!Array.isArray(tracks) || tracks.length === 0) {
      return null
    }

    const asrTrack =
      tracks.find((track) => String(track?.kind ?? "").toLowerCase() === "asr") ??
      tracks.find((track) => String(track?.vssId ?? "").toLowerCase().includes(".pt")) ??
      tracks.find((track) => String(track?.languageCode ?? "").toLowerCase().startsWith("pt")) ??
      tracks[0]

    return this.normalizeTranscriptBaseUrl(asrTrack?.baseUrl ?? "")
  }

  private async resolveCaptionBaseUrlForVideo(videoId: string): Promise<string | null> {
    const normalizedVideoId = String(videoId ?? "").trim()
    if (!normalizedVideoId) {
      return null
    }

    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(normalizedVideoId)}&hl=pt-BR`
    this.logSniperRouter("Resolving caption baseUrl from watch HTML.", {
      videoId: normalizedVideoId,
      watchUrl
    })
    const response = await fetch(watchUrl, {
      method: "GET",
      credentials: "include"
    })
    if (!response.ok) {
      this.logSniperRouter("Watch HTML request failed while resolving baseUrl.", {
        videoId: normalizedVideoId,
        status: response.status
      })
      return null
    }

    const html = await response.text()
    const tracks = this.extractCaptionTracksFromWatchHtml(html)
    const pickedBaseUrl = this.pickCaptionTrackBaseUrl(tracks)
    this.logSniperRouter("Caption tracks parsed from watch HTML.", {
      videoId: normalizedVideoId,
      trackCount: tracks.length,
      hasPickedBaseUrl: Boolean(pickedBaseUrl),
      pickedBaseUrlPreview: this.previewTranscriptUrl(pickedBaseUrl)
    })
    return pickedBaseUrl
  }

  private async handleFetchSniperTranscript(payload: unknown): Promise<StandardResponse> {
    const record = this.asRecord(payload)
    if (!record) return this.fail("Payload invalido para FETCH_SNIPER_TRANSCRIPT.")

    const videoId = this.normalizeBoundedString(record.videoId, 128)
    if (!videoId) return this.fail("videoId ausente para extrair transcricao.")

    const startSecRaw = Number(record.startSec)
    const endSecRaw = Number(record.endSec)
    if (!Number.isFinite(startSecRaw) || !Number.isFinite(endSecRaw))
      return this.fail("Intervalo invalido para extrair transcricao.")

    const safeStart = Math.max(0, Math.min(startSecRaw, endSecRaw))
    const safeEnd = Math.max(safeStart, Math.max(startSecRaw, endSecRaw))

    this.logSniperRouter("Starting transcript extraction via DOM (Plano B).", { videoId, safeStart, safeEnd })

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      const tabId = tabs.find((t) => t.url?.includes("youtube.com/watch"))?.id
      if (!tabId) return this.fail("Aba do YouTube nao encontrada.")

      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: async (safeStart: number, safeEnd: number) => {
          console.log("[SNIPER][FUNC] start:", safeStart, "end:", safeEnd)

          const PANEL_MODERN = 'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]'
          const PANEL_LEGACY =
            'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]'
          const SEGMENT_NEW = "TRANSCRIPT-SEGMENT-VIEW-MODEL"
          const SEGMENT_OLD = "ytd-transcript-segment-renderer"
          const TS_NEW = ".ytwTranscriptSegmentViewModelTimestamp"
          const TS_OLD = ".segment-timestamp"
          const TXT_NEW = ".yt-core-attributed-string"
          const TXT_OLD = ".segment-text"
          const STYLE_ID = "__sniper_hide__"

          const OPEN_LABELS = [
            "Mostrar transcrição",
            "Show transcript",
            "Mostrar transcripción",
            "Afficher la transcription",
            "Transkript anzeigen",
            "Transcript weergeven",
            "Mostrar legendas",
            "Visa transkription",
            "Vis transskription",
            "Näytä transkriptio"
          ]
          const CLOSE_LABELS = [
            "Fechar transcrição",
            "Close transcript",
            "Cerrar transcripción",
            "Fermer la transcription",
            "Transkript schließen",
            "Transcript verbergen"
          ]

          function timeToSeconds(raw: string): number {
            const parts = raw.trim().split(":").map(Number)
            if (parts.length === 2) return parts[0] * 60 + parts[1]
            if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
            return 0
          }

          function injectHideStyle(): void {
            if (document.getElementById(STYLE_ID)) return
            const style = document.createElement("style")
            style.id = STYLE_ID
            style.textContent = [
              PANEL_MODERN +
                " { position: fixed !important; top: -9999px !important; left: -9999px !important; opacity: 0 !important; pointer-events: none !important; }",
              PANEL_LEGACY +
                " { position: fixed !important; top: -9999px !important; left: -9999px !important; opacity: 0 !important; pointer-events: none !important; }",
              "ytd-engagement-panel-section-list-renderer[visibility='ENGAGEMENT_PANEL_VISIBILITY_EXPANDED'] { position: fixed !important; top: -9999px !important; left: -9999px !important; opacity: 0 !important; pointer-events: none !important; }"
            ].join("\n")
            document.head.appendChild(style)
          }

          function removeHideStyle(): void {
            document.getElementById(STYLE_ID)?.remove()
          }

          function waitForSegmentsAnyPanel(
            timeout = 8000
          ): Promise<{ segments: Element[]; isNewFormat: boolean } | null> {
            return new Promise((resolve) => {
              function check() {
                for (const el of document.querySelectorAll("ytd-engagement-panel-section-list-renderer")) {
                  const novo = Array.from(el.querySelectorAll(SEGMENT_NEW))
                  if (novo.length > 0) return { segments: novo, isNewFormat: true }
                  const velho = Array.from(el.querySelectorAll(SEGMENT_OLD))
                  if (velho.length > 0) return { segments: velho, isNewFormat: false }
                }
                return null
              }
              const found = check()
              if (found) return resolve(found)

              let lastCount = 0
              let stabilizeTimer: ReturnType<typeof setTimeout> | null = null

              const observer = new MutationObserver(() => {
                for (const el of document.querySelectorAll("ytd-engagement-panel-section-list-renderer")) {
                  const novo = Array.from(el.querySelectorAll(SEGMENT_NEW))
                  const velho = Array.from(el.querySelectorAll(SEGMENT_OLD))
                  const segs = novo.length > 0 ? novo : velho
                  const isNew = novo.length > 0
                  if (segs.length > 0 && segs.length !== lastCount) {
                    lastCount = segs.length
                    if (stabilizeTimer) clearTimeout(stabilizeTimer)
                    stabilizeTimer = setTimeout(() => {
                      observer.disconnect()
                      resolve({ segments: segs, isNewFormat: isNew })
                    }, 800)
                  }
                }
              })
              observer.observe(document.body, { childList: true, subtree: true })
              setTimeout(() => {
                observer.disconnect()
                resolve(null)
              }, timeout)
            })
          }

          Array.from(document.querySelectorAll("ytd-engagement-panel-section-list-renderer")).forEach((el) => {
            if (el.getAttribute("visibility") === "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED")
              el.setAttribute("visibility", "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN")
          })
          await new Promise((r) => setTimeout(r, 300))

          injectHideStyle()
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r as FrameRequestCallback)))

          let openBtn: HTMLElement | null = null
          openBtn =
            Array.from(document.querySelectorAll<HTMLElement>("button[aria-label]")).find((b) => {
              if (b.closest("ytd-engagement-panel-section-list-renderer")) return false
              if (b.closest(".ytp-chrome-controls")) return false
              if (b.closest(".ytp-right-controls")) return false
              if (b.closest(".ytp-left-controls")) return false
              const label = (b.getAttribute("aria-label") ?? "").toLowerCase()
              return (
                label.includes("transcript") ||
                label.includes("transcri") ||
                label.includes("字幕") ||
                label.includes("자막") ||
                label.includes("legenda") ||
                label.includes("caption")
              )
            }) ?? null

          if (!openBtn) {
            for (const label of OPEN_LABELS) {
              const all = Array.from(
                document.querySelectorAll<HTMLElement>(`button[aria-label="${label}"]`)
              ).filter((b) => !b.closest("ytd-engagement-panel-section-list-renderer") && !b.closest(".ytp-chrome-controls"))
              if (all.length > 0) {
                openBtn = all[0]
                break
              }
            }
          }

          console.log("[SNIPER][FUNC] botao encontrado:", !!openBtn, openBtn?.getAttribute("aria-label"))

          if (!openBtn) {
            removeHideStyle()
            return {
              totalSegments: 0,
              filteredSegments: 0,
              text: "__ERROR__:Botão de transcrição não encontrado. O vídeo possui legendas?"
            }
          }

          openBtn.click()

          const found = await waitForSegmentsAnyPanel(8000)
          console.log(
            "[SNIPER][FUNC] formato:",
            found?.isNewFormat ? "novo" : "legado",
            "| segmentos:",
            found?.segments.length ?? 0
          )

          if (!found || found.segments.length === 0) {
            removeHideStyle()
            return {
              totalSegments: 0,
              filteredSegments: 0,
              text: "__ERROR__:Nenhum segmento encontrado. O vídeo possui legenda?"
            }
          }

          const { segments, isNewFormat } = found
          const tsSelector = isNewFormat ? TS_NEW : TS_OLD
          const txtSelector = isNewFormat ? TXT_NEW : TXT_OLD
          const lines: string[] = []

          for (const seg of segments) {
            const tsEl = seg.querySelector(tsSelector)
            const txtEl = seg.querySelector(txtSelector)
            if (!tsEl || !txtEl) continue
            const seconds = timeToSeconds(tsEl.textContent ?? "")
            const text = (txtEl.textContent ?? "").trim()
            if (seconds >= safeStart && seconds <= safeEnd && text) lines.push(text)
          }
          console.log("[SNIPER][FUNC] segmentos no intervalo:", lines.length)

          let closeBtn: HTMLElement | null = null
          for (const label of CLOSE_LABELS) {
            const all = Array.from(
              document.querySelectorAll<HTMLElement>(`button[aria-label="${label}"]`)
            ).filter((b) => !b.closest("ytd-engagement-panel-section-list-renderer") && !b.closest(".ytp-chrome-controls"))
            if (all.length > 0) {
              closeBtn = all[0]
              break
            }
          }
          if (closeBtn) {
            closeBtn.click()
          } else {
            document.querySelectorAll("ytd-engagement-panel-section-list-renderer").forEach((el) => {
              if (el.getAttribute("visibility") === "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED")
                el.setAttribute("visibility", "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN")
            })
          }
          removeHideStyle()

          const text =
            lines.length > 0 ? lines.join(" ") : "__ERROR__:Nenhuma legenda encontrada no intervalo selecionado."
          return { totalSegments: segments.length, filteredSegments: lines.length, text }
        },
        args: [safeStart, safeEnd]
      })

      this.logSniperRouter("executeScript result received.", { resultType: typeof result?.result })

      const payloadResult = result?.result as
        | { text?: string; totalSegments?: number; filteredSegments?: number }
        | undefined
      if (!payloadResult) return this.fail("Falha ao executar script na pagina do YouTube.")

      const text = String(payloadResult.text ?? "")
      if (!text || text.startsWith("__ERROR__:")) {
        const msg = text.replace("__ERROR__:", "").trim() || "Erro desconhecido."
        this.logSniperRouter("DOM extraction returned error.", { msg })
        return this.fail(msg)
      }

      this.logSniperRouter("DOM extraction succeeded.", {
        textLength: text.length,
        filteredSegments: payloadResult.filteredSegments
      })
      return this.ok({ text: text.trim(), eventsCount: payloadResult.totalSegments ?? 0 })
    } catch (err: unknown) {
      const details = err instanceof Error ? err.message : String(err ?? "Erro desconhecido")
      this.logSniperRouter("executeScript threw error.", { details })
      return this.fail("executeScript falhou: " + details)
    }
  }

  private async handleCreateCheckout(payload: unknown): Promise<StandardResponse> {
    const { priceId, openInTab } = (payload ?? {}) as { priceId?: string; openInTab?: boolean }
    if (!priceId) {
      return this.fail("priceId ausente.")
    }

    const currentUser = await authManager.initializeSession()
    const isDevBypassUser =
      String(currentUser?.id ?? "").trim() === "dev-thinker-test-user" ||
      String(currentUser?.email ?? "")
        .trim()
        .toLowerCase()
        .endsWith("@minddock.local")
    if (isDevBypassUser) {
      return this.fail(
        "Checkout indisponivel sem login real. Faca login com Google para abrir Stripe Checkout."
      )
    }

    const resolveTargetTierFromPriceId = (id: string): SubscriptionTier | null => {
      const normalizedId = String(id ?? "").trim()
      if (!normalizedId) {
        return null
      }

      if (normalizedId === STRIPE_PRICES.pro_monthly || normalizedId === STRIPE_PRICES.pro_yearly) {
        return "pro"
      }

      if (
        normalizedId === STRIPE_PRICES.thinker_monthly ||
        normalizedId === STRIPE_PRICES.thinker_yearly
      ) {
        return "thinker"
      }

      return null
    }

    const normalizeTier = (rawTier: unknown): SubscriptionTier => {
      const candidate = String(rawTier ?? "")
        .trim()
        .toLowerCase()
      if (candidate === "pro" || candidate === "thinker" || candidate === "thinker_pro") {
        return candidate
      }
      return "free"
    }

    const targetTier = resolveTargetTierFromPriceId(priceId)
    const tierRank: Record<SubscriptionTier, number> = {
      free: 0,
      pro: 1,
      thinker: 2,
      thinker_pro: 3
    }

    const sessionTier = normalizeTier(currentUser?.subscriptionTier)
    const sessionStatus = String(currentUser?.subscriptionStatus ?? "")
      .trim()
      .toLowerCase()
    const sessionHasActivePaidPlan =
      (sessionStatus === "active" || sessionStatus === "trialing") && sessionTier !== "free"

    // Server-side truth fallback: avoids stale profile cache in popup/auth session.
    let resolvedTier = sessionTier
    if (sessionHasActivePaidPlan !== true) {
      try {
        await subscriptionManager.invalidate()
        resolvedTier = await subscriptionManager.getTier()
      } catch {
        resolvedTier = sessionTier
      }
    }

    const hasActivePaidPlan = resolvedTier !== "free"

    if (hasActivePaidPlan && resolvedTier === "thinker_pro") {
      return this.fail(
        "Sua conta ja esta no Thinker Pro ativo. Use Subscription para gerenciar alteracoes de plano."
      )
    }

    if (hasActivePaidPlan && targetTier && tierRank[resolvedTier] >= tierRank[targetTier]) {
      return this.fail(
        "Sua conta ja possui um plano ativo igual ou superior. Use Subscription para gerenciar alteracoes."
      )
    }

    let supabaseUrl = ""
    let supabaseAnonKey = ""
    try {
      const config = await authManager.getSupabaseConfig()
      supabaseUrl = String(config.url ?? "").trim()
      supabaseAnonKey = String(config.anonKey ?? "").trim()
    } catch (configError) {
      return this.fail(
        `Falha ao resolver configuracao do Supabase para checkout: ${String(
          configError instanceof Error ? configError.message : configError
        )}`
      )
    }

    if (!supabaseUrl) {
      return this.fail("Supabase URL nao configurada.")
    }

    const normalizeJwt = (rawToken: string | null | undefined): string | null => {
      let normalized = String(rawToken ?? "").trim()
      if (!normalized) return null
      if (/^bearer\s+/i.test(normalized)) {
        normalized = normalized.replace(/^bearer\s+/i, "").trim()
      }
      if (
        (normalized.startsWith('"') && normalized.endsWith('"')) ||
        (normalized.startsWith("'") && normalized.endsWith("'"))
      ) {
        normalized = normalized.slice(1, -1).trim()
      }
      const parts = normalized.split(".")
      if (parts.length !== 3 || parts.some((part) => !part.trim())) {
        return null
      }
      return normalized
    }

    const rawToken = await authManager.getVerifiedAccessToken()
    const token = normalizeJwt(rawToken)
    if (!token) {
      return this.fail("Sessao de login invalida para billing. Faca login novamente.")
    }

    const extractJwtRef = (jwt: string | null | undefined): string | null => {
      const raw = String(jwt ?? "").trim()
      if (!raw) return null
      const parts = raw.split(".")
      if (parts.length < 2) return null
      const payloadPart = parts[1].replace(/-/g, "+").replace(/_/g, "/")
      const padded = payloadPart.padEnd(Math.ceil(payloadPart.length / 4) * 4, "=")

      try {
        const decoded = atob(padded)
        const parsed = JSON.parse(decoded) as { ref?: unknown }
        const ref = String(parsed?.ref ?? "").trim()
        return ref || null
      } catch {
        return null
      }
    }

    const extractProjectRefFromUrl = (url: string): string | null => {
      try {
        const host = new URL(url).hostname
        const ref = String(host.split(".")[0] ?? "").trim()
        return ref || null
      } catch {
        return null
      }
    }

    const projectRef = extractProjectRefFromUrl(supabaseUrl)
    const tokenRef = extractJwtRef(token)
    const anonRef = extractJwtRef(supabaseAnonKey)
    const shouldSendApiKey =
      Boolean(supabaseAnonKey) && (!projectRef || !anonRef || anonRef === projectRef)

    const fallbackUrlFromTokenRef =
      tokenRef && tokenRef !== projectRef ? `https://${tokenRef}.supabase.co` : null

    const requestTargets: Array<{ baseUrl: string; apiKey: string; label: string }> = []
    if (fallbackUrlFromTokenRef) {
      requestTargets.push({
        baseUrl: fallbackUrlFromTokenRef,
        apiKey: anonRef === tokenRef ? supabaseAnonKey : "",
        label: "token-ref"
      })
    }

    requestTargets.push({
      baseUrl: supabaseUrl,
      apiKey: shouldSendApiKey ? supabaseAnonKey : "",
      label: "config"
    })

    const callCheckout = async (
      baseUrl: string,
      accessToken: string,
      apiKey: string
    ): Promise<{ res: Response; rawBody: string; json: { url?: string; error?: string } | null }> => {
      const res = await fetch(`${baseUrl}/functions/v1/create-checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          ...(apiKey ? { apikey: apiKey } : {})
        },
        body: JSON.stringify({ priceId })
      })

      const rawBody = await res.text()
      let json: { url?: string; error?: string } | null = null
      try {
        json = JSON.parse(rawBody) as { url?: string; error?: string }
      } catch {
        json = null
      }

      return { res, rawBody, json }
    }

    const openCheckout = async (checkoutUrl: string): Promise<StandardResponse> => {
      const shouldOpenInTab = openInTab !== false
      if (shouldOpenInTab) {
        try {
          await this.openUrlInTab(checkoutUrl)
        } catch (openError) {
          return this.fail(
            `Checkout criado, mas nao foi possivel abrir a aba: ${String(
              openError instanceof Error ? openError.message : openError
            )}`,
            { url: checkoutUrl, opened: false }
          )
        }
      }

      return this.ok({ url: checkoutUrl, opened: shouldOpenInTab })
    }

    try {
      let lastJwtError: string | null = null

      for (const target of requestTargets) {
        let tokenToUse = token

        const firstAttempt = await callCheckout(target.baseUrl, tokenToUse, target.apiKey)
        if (firstAttempt.res.ok) {
          const checkoutUrl = String(firstAttempt.json?.url ?? "").trim()
          if (!checkoutUrl) {
            return this.fail("Checkout sem URL retornada pela funcao.")
          }
          return openCheckout(checkoutUrl)
        }

        const firstErrorMessage =
          String(firstAttempt.json?.error ?? firstAttempt.rawBody ?? "").trim() ||
          `Erro ao criar checkout (${firstAttempt.res.status})`
        const firstIsJwtError = /invalid jwt|jwt/i.test(firstErrorMessage)

        if (!firstIsJwtError) {
          return this.fail(
            `Checkout falhou (${target.label}, status ${firstAttempt.res.status}): ${firstErrorMessage}`
          )
        }

        lastJwtError = firstErrorMessage

        const refreshedToken = normalizeJwt(await authManager.refreshAccessToken(null))
        if (!refreshedToken || refreshedToken === tokenToUse) {
          continue
        }

        tokenToUse = refreshedToken
        const retryAttempt = await callCheckout(target.baseUrl, tokenToUse, target.apiKey)
        if (retryAttempt.res.ok) {
          const checkoutUrl = String(retryAttempt.json?.url ?? "").trim()
          if (!checkoutUrl) {
            return this.fail("Checkout sem URL retornada pela funcao.")
          }
          return openCheckout(checkoutUrl)
        }

        const retryErrorMessage =
          String(retryAttempt.json?.error ?? retryAttempt.rawBody ?? "").trim() ||
          `Erro ao criar checkout (${retryAttempt.res.status})`
        const retryIsJwtError = /invalid jwt|jwt/i.test(retryErrorMessage)

        if (!retryIsJwtError) {
          return this.fail(
            `Checkout falhou (${target.label}, status ${retryAttempt.res.status}): ${retryErrorMessage}`
          )
        }

        lastJwtError = retryErrorMessage
      }

      return this.fail(
        `BILL-CHK-V4 Sessao invalida ou expirada para billing. Faca login novamente e tente o checkout. [project=${projectRef ?? "n/a"} token=${tokenRef ?? "n/a"} anon=${anonRef ?? "n/a"} apikey=${shouldSendApiKey ? "on" : "off"} targets=${requestTargets.map((target) => target.label).join(",")} detail=${lastJwtError ?? "n/a"}]`
      )
    } catch (err) {
      return this.fail(`Falha ao criar sessao de checkout: ${String(err)}`)
    }
  }

  private async handleBrainMerge(payload: unknown): Promise<StandardResponse> {
    const data = (payload as {
      notebookSources?: Array<{ notebookId: string; notebookTitle: string; sourceIds: string[] }>
      goal?: string
    }) ?? {}

    const notebookSources = Array.isArray(data.notebookSources) ? data.notebookSources : []
    const goal = String(data.goal ?? "").trim()

    if (notebookSources.length === 0) {
      return this.fail("Selecione pelo menos um notebook com fontes.")
    }

    if (!goal) {
      return this.fail("Descreva o objetivo do Brain Merge.")
    }

    const authGuard = await this.ensureAuthenticatedForAi()
    if (authGuard) {
      return authGuard
    }

    const rateGuard = await this.enforceAiRateLimit()
    if (rateGuard) {
      return rateGuard
    }

    const canUseAI = await subscriptionManager.canUseFeature("ai_features")
    if (!canUseAI) {
      return this.fail("Brain Merge requer plano Thinker ou superior.", {
        tier_required: "thinker",
        upgrade_url: "https://minddocklm.digital/#pricing"
      })
    }

    const limits = await subscriptionManager.getLimits()
    const canCallAI = await storageManager.checkUsageLimit(
      "aiCalls",
      limits.ai_calls_per_day ?? "unlimited"
    )
    if (!canCallAI) {
      return this.fail("Limite de chamadas de IA atingido para hoje.")
    }

    const canUseMonthlyBrainMerge = await storageManager.checkAiMonthlyLimit(
      "brainMerges",
      limits.brain_merges_per_month ?? "unlimited"
    )
    if (!canUseMonthlyBrainMerge) {
      const brainMergeLimit = limits.brain_merges_per_month
      return this.fail(
        typeof brainMergeLimit === "number"
          ? `Limite mensal do Brain Merge atingido (${brainMergeLimit}/mes).`
          : "Limite mensal do Brain Merge atingido."
      )
    }

    try {
      const service = new NotebookLMService()
      const flatSources: Array<{ notebookTitle: string; sourceTitle: string; content: string }> = []

      for (const nb of notebookSources) {
        const notebookId = String(nb.notebookId ?? "").trim()
        const notebookTitle = String(nb.notebookTitle ?? "").trim()
        const sourceIds = Array.isArray(nb.sourceIds)
          ? nb.sourceIds.map((id) => String(id ?? "").trim()).filter(Boolean)
          : []

        if (!notebookId || sourceIds.length === 0) continue

        const listedSources = await service.listSources(notebookId).catch(() => [])
        const sourceTitleById = new Map<string, string>()

        for (const source of listedSources) {
          const sourceId = String(source.id ?? "").trim()
          const sourceTitle = String(source.title ?? "").trim() || "Untitled"
          if (!sourceId) {
            continue
          }
          sourceTitleById.set(sourceId, sourceTitle)
        }

        const result = await service.getSourcesContent(notebookId, sourceIds)
        const snippetsBySourceId = result.sourceSnippets

        for (const sourceId of sourceIds) {
          const snippets = Array.isArray(snippetsBySourceId[sourceId])
            ? snippetsBySourceId[sourceId]
            : []
          if (snippets.length === 0) {
            continue
          }

          const sourceTitle = sourceTitleById.get(sourceId) ?? "Untitled"
          for (const snippet of snippets) {
            const content = String(snippet ?? "").trim()
            if (!content) {
              continue
            }

            flatSources.push({
              notebookTitle,
              sourceTitle,
              content
            })
          }
        }
      }

      if (flatSources.length === 0) {
        return this.fail("Nenhum conteudo encontrado nas fontes selecionadas.")
      }

      const document = await aiService.brainMerge(flatSources, goal, {
        surface: "brain_merge_hub",
        notebookCount: notebookSources.length,
        sourceSnippetCount: flatSources.length
      })
      await storageManager.incrementUsage("aiCalls")
      await storageManager.incrementAiMonthlyUsage("brainMerges")
      return this.ok({ document })
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : "Falha no Brain Merge.")
    }
  }
}

export const router = new MessageRouter()
