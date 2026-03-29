import { router } from "./router"
import {
  notebookService,
  type CreatedNotebookRecord,
  type NotebookCreateError,
  type NotebookCreateResult
} from "./services/NotebookService"
import { tokenStorage } from "./storage/TokenStorage"
import { fetchStudioArtifactsByIds } from "./studioArtifacts"
import type { ChromeMessage, ChromeMessageResponse } from "~/lib/types"
import {
  probeAvailableAccounts,
  resolveActiveSessions,
  type NotebookProbeAccountResult
} from "~/services/notebookDiscoveryService"
import { formatChatAsReadableMarkdownV2, getFromSecureStorage } from "~/lib/utils"
import {
  NOTEBOOK_ACCOUNT_DEFAULT,
  buildNotebookAccountKey,
  buildScopedStorageKey,
  isConfirmedNotebookAccountKey,
  normalizeAccountEmail,
  normalizeAuthUser
} from "~/lib/notebook-account-scope"
import type { DiscoverSessionsResponseData } from "~/types/messages"

const NOTEBOOK_CACHE_UPDATED_COMMAND = "MINDDOCK_NOTEBOOK_CACHE_UPDATED"
const NOTEBOOK_CACHE_KEY = "minddock_cached_notebooks"
const NOTEBOOK_CACHE_SYNC_KEY = "minddock_cached_notebooks_synced_at"
const DEFAULT_NOTEBOOK_KEY = "nexus_default_notebook_id"
const LEGACY_DEFAULT_NOTEBOOK_KEY = "minddock_default_notebook"
const SETTINGS_KEY = "minddock_settings"
const AUTH_USER_KEY = "nexus_auth_user"
const NOTEBOOK_ACCOUNT_EMAIL_KEY = "nexus_notebook_account_email"
const TOKEN_STORAGE_KEY = "notebooklm_session"
const NOTEBOOK_SCOPE_MIGRATION_KEY = "minddock_notebook_scope_migration_v2_done"
const NOTEBOOKS_RPC_ENDPOINT = "https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute"
const NOTEBOOKS_RPC_ID = "wXbhsf"
const NOTEBOOKS_AUTHUSER = "0"
const NOTEBOOKS_PAYLOAD_CANDIDATES: unknown[][] = [[null, 1, null, [2]], [], [null], [[2]]]

interface IncomingMessage extends Partial<ChromeMessage> {
  data?: Record<string, unknown>
  payload?: Record<string, unknown>
  type?: string
}

interface ConversationMessage {
  content: string
  role: "assistant" | "user"
}

interface CachedNotebookEntry {
  createTime: string
  id: string
  sourceCount: number
  title: string
  updateTime: string
}

interface NotebookListItem {
  id: string
  name: string
}

let messageRouterInitialized = false

async function broadcastNotebookCacheUpdated(): Promise<void> {
  const tabs = await chrome.tabs.query({})

  await Promise.all(
    tabs.map(async (tab) => {
      if (typeof tab.id !== "number") {
        return
      }

      try {
        await chrome.tabs.sendMessage(tab.id, { command: NOTEBOOK_CACHE_UPDATED_COMMAND })
      } catch {
        // Ignore tabs without the matching content script.
      }
    })
  )
}

function normalizeIncomingType(message: IncomingMessage): string {
  return String(message?.type ?? "").trim()
}

function normalizeNotebookTitle(message: IncomingMessage): string {
  return String(message?.data?.title ?? "").trim() || "Novo Notebook"
}

function normalizeNotebookInitialContent(message: IncomingMessage): string {
  return String(message?.data?.initialContent ?? message?.data?.content ?? "").trim()
}

function normalizeNotebookSourceTitle(message: IncomingMessage, notebookTitle: string): string {
  const explicitSourceTitle = String(message?.data?.sourceTitle ?? "").trim()
  return explicitSourceTitle || notebookTitle
}

function normalizePlatformLabel(value: string): string {
  const rawValue = String(value ?? "").trim()
  if (!rawValue) {
    return "CHATGPT"
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizeNotebookSourcePlatform(message: IncomingMessage): string {
  return normalizePlatformLabel(String(message?.data?.sourcePlatform ?? ""))
}

function normalizeInitialConversation(message: IncomingMessage): ConversationMessage[] {
  const rawConversation = message?.data?.initialConversation
  if (!Array.isArray(rawConversation)) {
    return []
  }

  return rawConversation
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item): ConversationMessage | null => {
      const content = String(item.content ?? "").trim()
      if (!content) {
        return null
      }

      return {
        role: item.role === "assistant" ? "assistant" : "user",
        content
      }
    })
    .filter((item): item is ConversationMessage => item !== null)
}

function resolveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected background error."
}

class NotebookFetchAuthError extends Error {
  constructor(message = "Nao autorizado no NotebookLM.") {
    super(message)
    this.name = "NotebookFetchAuthError"
  }
}

class NotebookFetchHttpError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`Falha HTTP ${status} ao listar cadernos.`)
    this.name = "NotebookFetchHttpError"
    this.status = status
  }
}

function stripAntiHijackPrefix(value: string): string {
  return String(value ?? "")
    .replace(/^\)\]\}'\s*/, "")
    .trim()
}

function tryParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function parseJsonCandidates(rawResponseText: string): unknown[] {
  const sanitizedText = stripAntiHijackPrefix(rawResponseText)
  if (!sanitizedText) {
    return []
  }

  const parsedCandidates: unknown[] = []
  for (const rawLine of sanitizedText.split("\n")) {
    const line = String(rawLine ?? "").trim()
    if (!line || (!line.startsWith("[") && !line.startsWith("{"))) {
      continue
    }

    const parsedLine = tryParseJson(line)
    if (parsedLine !== null) {
      parsedCandidates.push(parsedLine)
    }
  }

  if (parsedCandidates.length > 0) {
    return parsedCandidates
  }

  const parsedWhole = tryParseJson(sanitizedText)
  return parsedWhole === null ? [] : [parsedWhole]
}

function collectNotebookRows(root: unknown): unknown[][] {
  const rows: unknown[][] = []
  const queue: unknown[] = [root]
  const seenObjects = new Set<unknown>()
  const parsedStrings = new Set<string>()

  while (queue.length > 0) {
    const current = queue.shift()

    if (typeof current === "string") {
      const normalized = String(current ?? "").trim()
      const looksJson =
        (normalized.startsWith("[") && normalized.endsWith("]")) ||
        (normalized.startsWith("{") && normalized.endsWith("}"))
      if (!normalized || parsedStrings.has(normalized) || !looksJson) {
        continue
      }

      parsedStrings.add(normalized)
      const parsedStringValue = tryParseJson(normalized)
      if (parsedStringValue !== null) {
        queue.push(parsedStringValue)
      }
      continue
    }

    if (!current || typeof current !== "object") {
      continue
    }

    if (seenObjects.has(current)) {
      continue
    }
    seenObjects.add(current)

    if (Array.isArray(current)) {
      if (
        current.length >= 3 &&
        (typeof current[0] === "string" || typeof current[2] === "string")
      ) {
        rows.push(current as unknown[])
      }

      if (current.length > 0 && current.every((item) => Array.isArray(item))) {
        for (const item of current) {
          rows.push(item as unknown[])
        }
      }

      queue.push(...current)
      continue
    }

    queue.push(...Object.values(current))
  }

  return rows
}

function extractNotebookRowsFromRpcResponse(rawResponseText: string): unknown[][] {
  const parsedCandidates = parseJsonCandidates(rawResponseText)
  const rows: unknown[][] = []

  for (const candidate of parsedCandidates) {
    // Prefer strict path when available: external[0][2] -> JSON string -> notebook rows.
    if (Array.isArray(candidate) && Array.isArray(candidate[0])) {
      const encodedInnerPayload = candidate[0]?.[2]
      if (typeof encodedInnerPayload === "string") {
        const parsedInnerPayload = tryParseJson(encodedInnerPayload)
        if (parsedInnerPayload !== null) {
          rows.push(...collectNotebookRows(parsedInnerPayload))
        }
      }
    }

    rows.push(...collectNotebookRows(candidate))
  }

  return rows
}

function mapNotebookRows(rows: unknown[][]): NotebookListItem[] {
  const notebooksById = new Map<string, NotebookListItem>()
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const longHexPattern = /^[0-9a-f]{32,}$/i

  for (const row of rows) {
    if (!Array.isArray(row)) {
      continue
    }

    const status = Array.isArray(row[5]) ? Number(row[5][0]) : null
    if (status === 3) {
      continue
    }

    const id = String(row[2] ?? "").trim()
    const rawName = String(row[0] ?? "").trim()
    const name = rawName || "Sem Titulo"
    const normalizedName = rawName.toLowerCase()

    if (!id || id.length < 10 || /\s/.test(id)) {
      continue
    }

    if (rawName.toLowerCase() === "generic") {
      continue
    }

    // Aggressive sanitization: remove protocol artifacts and opaque UUID/hash-like titles.
    if (!rawName) {
      continue
    }
    if (normalizedName.includes("af.httprm") || normalizedName.includes("boq_")) {
      continue
    }
    if (rawName === id) {
      continue
    }
    if (uuidPattern.test(rawName) || longHexPattern.test(rawName)) {
      continue
    }
    if (rawName.length > 50 && !rawName.includes(" ")) {
      continue
    }

    if (!notebooksById.has(id)) {
      notebooksById.set(id, { id, name })
    }
  }

  return Array.from(notebooksById.values())
}

async function fetchNotebooksViaRpc(): Promise<NotebookListItem[]> {
  const tokens = await tokenStorage.getTokens().catch(() => null)
  const tokenModes = tokens?.at || tokens?.bl ? [true, false] : [false]
  let lastHttpStatus: number | null = null
  let hasSuccessfulResponse = false
  let lastNetworkError = ""

  for (const payloadCandidate of NOTEBOOKS_PAYLOAD_CANDIDATES) {
    for (const withTokens of tokenModes) {
      const requestUrl = new URL(NOTEBOOKS_RPC_ENDPOINT)
      requestUrl.searchParams.set("rpcids", NOTEBOOKS_RPC_ID)
      requestUrl.searchParams.set("source-path", "/")
      requestUrl.searchParams.set("authuser", NOTEBOOKS_AUTHUSER)
      requestUrl.searchParams.set("rt", "c")

      if (withTokens && tokens?.bl) {
        requestUrl.searchParams.set("bl", tokens.bl)
      }

      const body = new URLSearchParams()
      body.set(
        "f.req",
        JSON.stringify([[[NOTEBOOKS_RPC_ID, JSON.stringify(payloadCandidate), null, "generic"]]])
      )
      if (withTokens && tokens?.at) {
        body.set("at", tokens.at)
      }

      let response: Response
      try {
        response = await fetch(requestUrl.toString(), {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "x-same-domain": "1"
          },
          body: body.toString()
        })
      } catch (error) {
        lastNetworkError = resolveErrorMessage(error)
        continue
      }

      if (response.status === 401 || response.status === 403) {
        throw new NotebookFetchAuthError("Nao autorizado no NotebookLM. Faca login e tente novamente.")
      }

      if (!response.ok) {
        lastHttpStatus = response.status
        continue
      }

      hasSuccessfulResponse = true
      const rawResponseText = await response.text()
      const notebooks = mapNotebookRows(extractNotebookRowsFromRpcResponse(rawResponseText))
      if (notebooks.length > 0) {
        return notebooks
      }
    }
  }

  if (hasSuccessfulResponse) {
    return []
  }

  if (typeof lastHttpStatus === "number") {
    throw new NotebookFetchHttpError(lastHttpStatus)
  }

  if (lastNetworkError) {
    throw new Error(lastNetworkError)
  }

  throw new Error("Falha ao listar cadernos no NotebookLM.")
}

function normalizeDiscoveryIndices(message: IncomingMessage): number[] {
  const rawIndices = isRecord(message.payload) ? message.payload.indices : undefined
  if (!Array.isArray(rawIndices)) {
    return [0, 1, 2]
  }

  const normalizedIndices = rawIndices
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 9)

  if (normalizedIndices.length === 0) {
    return [0, 1, 2]
  }

  return Array.from(new Set(normalizedIndices))
}

function normalizeDiscoveryProbeResults(
  probeResults: NotebookProbeAccountResult[]
): DiscoverSessionsResponseData["probeResults"] {
  return probeResults.map((probeUserSession) => ({
    authIndex: probeUserSession.authIndex,
    email: probeUserSession.email,
    notebooks: probeUserSession.notebooks,
    status: probeUserSession.status,
    httpStatus: probeUserSession.httpStatus,
    errorMessage: probeUserSession.errorMessage
  }))
}

function resolveTokenPayload(message: IncomingMessage): {
  at?: string
  bl?: string
  accountEmail?: string
  authUser?: string
} {
  const rawPayload =
    typeof message?.payload === "object" && message.payload !== null ? message.payload : {}
  const accountEmail = normalizeAccountEmail(rawPayload.accountEmail)

  return {
    at: String(rawPayload.at ?? "").trim() || undefined,
    bl: String(rawPayload.bl ?? "").trim() || undefined,
    accountEmail: accountEmail ?? undefined,
    authUser: String(rawPayload.authUser ?? "").trim() || undefined
  }
}

async function resolveNotebookAccountScope(): Promise<{
  accountKey: string
  accountEmail: string | null
  authUser: string | null
  confirmed: boolean
}> {
  try {
    const secureSession = await getFromSecureStorage<Record<string, unknown>>(TOKEN_STORAGE_KEY)
    const snapshot = await chrome.storage.local.get([
      AUTH_USER_KEY,
      NOTEBOOK_ACCOUNT_EMAIL_KEY,
      TOKEN_STORAGE_KEY,
      SETTINGS_KEY
    ])
    const fixedAccountEmail = normalizeAccountEmail(snapshot[NOTEBOOK_ACCOUNT_EMAIL_KEY])
    const fromFixed = normalizeAuthUser(snapshot[AUTH_USER_KEY])

    const session = secureSession ?? snapshot[TOKEN_STORAGE_KEY]
    const sessionAccountEmail =
      session && typeof session === "object"
        ? normalizeAccountEmail((session as { accountEmail?: unknown }).accountEmail)
        : null
    const fromSession =
      session && typeof session === "object"
        ? normalizeAuthUser((session as { authUser?: unknown }).authUser)
        : null
    const settings =
      typeof snapshot[SETTINGS_KEY] === "object" && snapshot[SETTINGS_KEY] !== null
        ? (snapshot[SETTINGS_KEY] as Record<string, unknown>)
        : {}
    const settingsAccountEmail = normalizeAccountEmail(settings.notebookAccountEmail)

    const accountEmail = fixedAccountEmail ?? sessionAccountEmail ?? settingsAccountEmail
    const authUser = fromFixed ?? fromSession
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

function resolveScopedNotebookKeys(accountKey: string): {
  cacheKey: string
  cacheSyncKey: string
  defaultKey: string
  legacyDefaultKey: string
} {
  return {
    cacheKey: buildScopedStorageKey(NOTEBOOK_CACHE_KEY, accountKey),
    cacheSyncKey: buildScopedStorageKey(NOTEBOOK_CACHE_SYNC_KEY, accountKey),
    defaultKey: buildScopedStorageKey(DEFAULT_NOTEBOOK_KEY, accountKey),
    legacyDefaultKey: buildScopedStorageKey(LEGACY_DEFAULT_NOTEBOOK_KEY, accountKey)
  }
}

async function purgeLegacyGlobalNotebookStorage(): Promise<void> {
  const defaultScopedCacheKey = buildScopedStorageKey(NOTEBOOK_CACHE_KEY, NOTEBOOK_ACCOUNT_DEFAULT)
  const defaultScopedCacheSyncKey = buildScopedStorageKey(
    NOTEBOOK_CACHE_SYNC_KEY,
    NOTEBOOK_ACCOUNT_DEFAULT
  )
  const defaultScopedCanonicalKey = buildScopedStorageKey(
    DEFAULT_NOTEBOOK_KEY,
    NOTEBOOK_ACCOUNT_DEFAULT
  )
  const defaultScopedLegacyKey = buildScopedStorageKey(
    LEGACY_DEFAULT_NOTEBOOK_KEY,
    NOTEBOOK_ACCOUNT_DEFAULT
  )

  try {
    const migrationSnapshot = await chrome.storage.local.get([NOTEBOOK_SCOPE_MIGRATION_KEY])
    if (migrationSnapshot[NOTEBOOK_SCOPE_MIGRATION_KEY] === true) {
      return
    }
  } catch {
    // Continue best-effort migration.
  }

  try {
    await chrome.storage.local.remove([
      NOTEBOOK_CACHE_KEY,
      NOTEBOOK_CACHE_SYNC_KEY,
      DEFAULT_NOTEBOOK_KEY,
      LEGACY_DEFAULT_NOTEBOOK_KEY,
      defaultScopedCacheKey,
      defaultScopedCacheSyncKey,
      defaultScopedCanonicalKey,
      defaultScopedLegacyKey
    ])
  } catch {
    // no-op
  }

  try {
    const snapshot = await chrome.storage.local.get(null)
    const legacyScopedKeys = Object.keys(snapshot).filter((key) =>
      /^(minddock_cached_notebooks|minddock_cached_notebooks_synced_at|nexus_default_notebook_id|minddock_default_notebook)::authuser:/u.test(
        key
      )
    )
    if (legacyScopedKeys.length > 0) {
      await chrome.storage.local.remove(legacyScopedKeys)
    }
  } catch {
    // no-op
  }

  try {
    const snapshot = await chrome.storage.local.get([SETTINGS_KEY])
    const settings =
      typeof snapshot[SETTINGS_KEY] === "object" && snapshot[SETTINGS_KEY] !== null
        ? (snapshot[SETTINGS_KEY] as Record<string, unknown>)
        : null
    if (settings) {
      const { defaultNotebookId: _removedDefaultNotebookId, ...nextSettings } = settings
      void _removedDefaultNotebookId
      const cleanedDefaultNotebookByAccount =
        typeof nextSettings.defaultNotebookByAccount === "object" &&
        nextSettings.defaultNotebookByAccount !== null
          ? Object.fromEntries(
              Object.entries(nextSettings.defaultNotebookByAccount as Record<string, unknown>).filter(
                ([key]) => !String(key).trim().startsWith("authuser:")
              )
            )
          : nextSettings.defaultNotebookByAccount

      await chrome.storage.local.set({
        [SETTINGS_KEY]: {
          ...nextSettings,
          defaultNotebookByAccount: cleanedDefaultNotebookByAccount
        }
      })
    }
  } catch {
    // no-op
  }

  try {
    await chrome.storage.local.set({
      [NOTEBOOK_SCOPE_MIGRATION_KEY]: true
    })
  } catch {
    // no-op
  }
}

function isCachedNotebookEntry(value: unknown): value is CachedNotebookEntry {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const candidate = value as Partial<CachedNotebookEntry>
  return String(candidate.id ?? "").trim().length > 0 && String(candidate.title ?? "").trim().length > 0
}

async function upsertCreatedNotebookInCache(
  notebookId: string,
  notebookTitle: string,
  sourceAdded: boolean
): Promise<void> {
  const normalizedNotebookId = String(notebookId ?? "").trim()
  const normalizedNotebookTitle = String(notebookTitle ?? "").trim()
  if (!normalizedNotebookId || !normalizedNotebookTitle) {
    return
  }

  const now = new Date().toISOString()
  const accountScope = await resolveNotebookAccountScope()
  if (!accountScope.confirmed) {
    console.warn(
      "[MindDock Background] Notebook cache nao foi atualizado: conta do NotebookLM ainda nao confirmada."
    )
    return
  }

  const scopedKeys = resolveScopedNotebookKeys(accountScope.accountKey)
  const snapshot = await chrome.storage.local.get([scopedKeys.cacheKey, SETTINGS_KEY])
  const rawItems = Array.isArray(snapshot[scopedKeys.cacheKey])
    ? (snapshot[scopedKeys.cacheKey] as unknown[])
    : []

  let existingCreateTime = now
  let existingSourceCount = sourceAdded ? 1 : 0

  const nextItems = rawItems
    .filter(isCachedNotebookEntry)
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
      existingSourceCount = Math.max(item.sourceCount, sourceAdded ? 1 : 0)
      return false
    })

  nextItems.unshift({
    id: normalizedNotebookId,
    title: normalizedNotebookTitle,
    createTime: existingCreateTime,
    updateTime: now,
    sourceCount: existingSourceCount
  })

  const currentSettings =
    typeof snapshot[SETTINGS_KEY] === "object" && snapshot[SETTINGS_KEY] !== null
      ? (snapshot[SETTINGS_KEY] as Record<string, unknown>)
      : {}

  const defaultByAccount =
    typeof currentSettings.defaultNotebookByAccount === "object" &&
    currentSettings.defaultNotebookByAccount !== null
      ? (currentSettings.defaultNotebookByAccount as Record<string, unknown>)
      : {}

  await chrome.storage.local.set({
    [scopedKeys.cacheKey]: nextItems,
    [scopedKeys.cacheSyncKey]: now,
    [scopedKeys.defaultKey]: normalizedNotebookId,
    [scopedKeys.legacyDefaultKey]: normalizedNotebookId,
    [SETTINGS_KEY]: {
      ...currentSettings,
      defaultNotebookByAccount: {
        ...defaultByAccount,
        [accountScope.accountKey]: normalizedNotebookId
      }
    }
  })
}

function sendNotebookCreateSuccess(
  sendResponse: (response: ChromeMessageResponse<CreatedNotebookRecord>) => void,
  result: CreatedNotebookRecord
): void {
  sendResponse({
    success: true,
    data: result,
    payload: result
  })
}

function isNotebookCreateError(result: NotebookCreateResult): result is NotebookCreateError {
  return "success" in result && result.success === false
}

export function initializeMessageRouter(): void {
  if (messageRouterInitialized) {
    return
  }

  void purgeLegacyGlobalNotebookStorage()

  chrome.runtime.onMessage.addListener(
    (
      message: IncomingMessage,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: ChromeMessageResponse<unknown>) => void
    ) => {
      const messageType = normalizeIncomingType(message)
      const messageAction = String(message?.action ?? "").trim()

      if (
        messageAction === "CREATE_CLOUD_DOC" ||
        messageAction === "CONNECT_NOTION_ACCOUNT" ||
        messageAction === "EXPORT_WORKSPACE_NOTION"
      ) {
        return false
      }

      switch (messageType) {
        case "NOTEBOOK_CREATE": {
          const notebookTitle = normalizeNotebookTitle(message)
          const initialContent = normalizeNotebookInitialContent(message)
          const initialConversation = normalizeInitialConversation(message)
          const sourcePlatform = normalizeNotebookSourcePlatform(message)
          const sourceTitle = normalizeNotebookSourceTitle(message, notebookTitle)
          const contentToPersist =
            initialConversation.length > 0
              ? formatChatAsReadableMarkdownV2(sourcePlatform, initialConversation, sourceTitle)
              : initialContent

          void notebookService
            .createNotebook(notebookTitle)
            .then(async (result) => {
              if (isNotebookCreateError(result)) {
                sendResponse(result)
                return
              }

              let sourceAdded = false
              let warning = ""

              if (result.id && contentToPersist) {
                try {
                  await notebookService.addSource(result.id, sourceTitle, contentToPersist)
                  sourceAdded = true
                } catch (error) {
                  warning =
                    error instanceof Error
                      ? `Caderno criado, mas falhou ao adicionar conteudo inicial: ${error.message}`
                      : "Caderno criado, mas falhou ao adicionar conteudo inicial."
                }
              }

              if (result.id) {
                await upsertCreatedNotebookInCache(result.id, result.title, sourceAdded)
                await broadcastNotebookCacheUpdated()
              }

              sendNotebookCreateSuccess(
                sendResponse as (response: ChromeMessageResponse<CreatedNotebookRecord>) => void,
                {
                  ...result,
                  sourceAdded,
                  warning
                }
              )
            })
            .catch((error) => {
              sendResponse({
                success: false,
                error: resolveErrorMessage(error)
              })
            })
          return true
        }

        case "CACHE_UPDATED": {
          void broadcastNotebookCacheUpdated()
            .then(() => {
              sendResponse({ success: true })
            })
            .catch((error) => {
              sendResponse({
                success: false,
                error: resolveErrorMessage(error)
              })
            })
          return true
        }

        case "TOKENS_UPDATED": {
          const tokenPayload = resolveTokenPayload(message)

          void tokenStorage
            .saveTokens(tokenPayload)
            .then(async () => {
              const patch: Record<string, unknown> = {}
              const normalizedAuthUser = normalizeAuthUser(tokenPayload.authUser)
              const normalizedAccountEmail = normalizeAccountEmail(tokenPayload.accountEmail)
              if (normalizedAuthUser) {
                patch[AUTH_USER_KEY] = normalizedAuthUser
              }
              if (normalizedAccountEmail) {
                patch[NOTEBOOK_ACCOUNT_EMAIL_KEY] = normalizedAccountEmail
              }
              if (Object.keys(patch).length > 0) {
                await chrome.storage.local.set(patch)
              }

              console.log("[MindDock Background] Session tokens secured. Ready for API calls.")
              sendResponse({ success: true })
            })
            .catch((error) => {
              sendResponse({
                success: false,
                error: resolveErrorMessage(error)
              })
            })
          return true
        }

        case "FETCH_NOTEBOOKS": {
          void fetchNotebooksViaRpc()
            .then((notebooks) => {
              sendResponse({
                success: true,
                payload: { notebooks },
                data: { notebooks }
              })
            })
            .catch((error) => {
              sendResponse({
                success: false,
                error: resolveErrorMessage(error),
                payload: { notebooks: [] },
                data: { notebooks: [] }
              })
            })
          return true
        }

        case "DISCOVER_SESSIONS": {
          const requestedIndices = normalizeDiscoveryIndices(message)

          void probeAvailableAccounts({ indices: requestedIndices })
            .then((probeResults) => {
              const accounts = resolveActiveSessions(probeResults)
              const responseData: DiscoverSessionsResponseData = {
                accounts,
                probeResults: normalizeDiscoveryProbeResults(probeResults),
                requestedIndices,
                generatedAt: new Date().toISOString()
              }

              console.log("[MindDock Discovery] Probe finished", {
                requestedIndices: responseData.requestedIndices,
                accountsFound: responseData.accounts.map((account) => ({
                  authIndex: account.authIndex,
                  email: account.email,
                  notebookCount: account.notebooks.length
                })),
                probeResults: responseData.probeResults.map((probeUserSession) => ({
                  authIndex: probeUserSession.authIndex,
                  status: probeUserSession.status,
                  httpStatus: probeUserSession.httpStatus,
                  email: probeUserSession.email,
                  notebookCount: probeUserSession.notebooks.length,
                  errorMessage: probeUserSession.errorMessage
                }))
              })
              try {
                console.log("[MindDock Discovery JSON]", JSON.stringify(responseData))
              } catch {
                // Ignore stringify issues.
              }

              if (accounts.length === 0) {
                sendResponse({
                  success: false,
                  error: "NO_ACTIVE_SESSION",
                  payload: responseData,
                  data: responseData
                })
                return
              }

              sendResponse({
                success: true,
                payload: responseData,
                data: responseData
              })
            })
            .catch((error) => {
              sendResponse({
                success: false,
                error: resolveErrorMessage(error)
              })
            })

          return true
        }

        case STUDIO_FETCH_MESSAGE: {
          try {
            const { ids, notebookId, forceRefresh, rpcContext } = normalizeStudioArtifactRequest(message)
            console.warn("[MindDock][BG] fetch studio ids:", ids, "force:", forceRefresh)
            Promise.resolve(fetchStudioArtifactsByIds(ids, notebookId, { forceRefresh, rpcContext }))
              .then((items) => {
                sendResponse({
                  success: true,
                  artifacts: items,
                  items,
                  payload: { items },
                  data: { items }
                })
              })
              .catch((error) => {
                sendResponse({
                  success: false,
                  error: resolveErrorMessage(error),
                  artifacts: [],
                  items: [],
                  payload: { items: [] },
                  data: { items: [] }
                })
              })
          } catch (error) {
            sendResponse({
              success: false,
              error: resolveErrorMessage(error),
              artifacts: [],
              items: [],
              payload: { items: [] },
              data: { items: [] }
            })
          }
          return true
        }

        case STUDIO_BINARY_FETCH_MESSAGE: {
          Promise.resolve(handleStudioBinaryFetch(message))
            .then((result) => sendResponse(result))
            .catch((error) =>
              sendResponse({
                success: false,
                error: resolveErrorMessage(error)
              })
            )
          return true
        }

        case "BG_LOG": {
          sendResponse?.({ ok: true })
          return true
        }

        default: {
          const legacyCommand = String(message?.command ?? "").trim()
          if (legacyCommand) {
            void router.handle(message as ChromeMessage, sender, sendResponse)
            return true
          }

          console.warn("[Background] Unknown message type", messageType || "(empty)")
          sendResponse({
            success: false,
            error: "Unknown message type"
          })
          return true
        }
      }
    }
  )

  messageRouterInitialized = true
}

const STUDIO_FETCH_MESSAGE = "MINDDOCK_FETCH_STUDIO_ARTIFACTS"
const STUDIO_BINARY_FETCH_MESSAGE = "MINDDOCK_FETCH_BINARY_ASSET"
const MAX_RAW_BYTES_FOR_MESSAGE = 46 * 1024 * 1024

function normalizeStudioArtifactRequest(message: IncomingMessage): {
  ids: string[]
  notebookId?: string
  forceRefresh?: boolean
  rpcContext?: Record<string, unknown>
} {
  const payload = message?.payload && typeof message.payload === "object" ? message.payload : undefined
  const data = message?.data && typeof message.data === "object" ? message.data : undefined
  const source = (payload ?? data ?? {}) as Record<string, unknown>

  const ids = Array.isArray(source.ids) ? source.ids : []
  const notebookId = typeof source.notebookId === "string" ? source.notebookId : undefined
  const forceRefresh = Boolean(source.forceRefresh)
  const rpcContext =
    source.rpcContext && typeof source.rpcContext === "object"
      ? (source.rpcContext as Record<string, unknown>)
      : undefined
  return {
    ids: ids.filter((id: unknown) => typeof id === "string"),
    notebookId,
    forceRefresh,
    rpcContext
  }
}

function normalizeStudioBinaryFetchRequest(message: IncomingMessage): {
  url: string
  atToken?: string
  authUser?: string | number | null
  mode?: "buffer" | "download"
  filename?: string
} {
  const payload = message?.payload && typeof message.payload === "object" ? message.payload : undefined
  const data = message?.data && typeof message.data === "object" ? message.data : undefined
  const source = (payload ?? data ?? {}) as Record<string, unknown>

  const url = String(source.url ?? "").trim()
  const atTokenRaw = String(source.atToken ?? "").trim()
  const authUser = source.authUser as string | number | null | undefined
  const modeRaw = String(source.mode ?? "").trim().toLowerCase()
  const filenameRaw = String(source.filename ?? "").trim()

  return {
    url,
    atToken: atTokenRaw || undefined,
    authUser,
    mode: modeRaw === "download" ? "download" : undefined,
    filename: filenameRaw || undefined
  }
}

function normalizeBinaryAssetUrl(value: string): string {
  const trimmed = String(value ?? "").trim().replace(/\\\//g, "/")
  if (!trimmed) return ""
  if (trimmed.startsWith("//")) return `https:${trimmed}`
  return trimmed
}

function withAuthUserIfGoogle(url: string, authUser?: string | number | null): string {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    const isGoogle = host.endsWith("google.com") || host.endsWith("googleusercontent.com")
    if (!isGoogle || parsed.searchParams.has("authuser")) return url
    if (authUser === null || authUser === undefined || String(authUser).trim() === "") return url
    parsed.searchParams.set("authuser", String(authUser))
    return parsed.toString()
  } catch {
    return url
  }
}

function appendAtToken(url: string, atToken: string): string {
  try {
    const parsed = new URL(url)
    parsed.searchParams.set("at", atToken)
    return parsed.toString()
  } catch {
    return url
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function extensionFromMimeType(mimeType?: string): string | undefined {
  const normalized = String(mimeType ?? "").toLowerCase().split(";")[0].trim()
  const mapping: Record<string, string> = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "audio/mpeg": "mp3",
    "audio/mp4": "mp4",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "application/pdf": "pdf"
  }
  return mapping[normalized]
}

function normalizeBackgroundDownloadFilename(filename?: string, mimeType?: string): string {
  const clean = String(filename ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^_+|_+$/g, "")

  const fallbackBase = "MindDock-Studio-Asset"
  const base = clean || fallbackBase
  const hasExtension = /\.[a-z0-9]{2,8}$/i.test(base)
  if (hasExtension) return base

  const ext = extensionFromMimeType(mimeType) ?? "bin"
  return `${base}.${ext}`
}

async function handleStudioBinaryFetch(
  message: IncomingMessage
): Promise<
  ChromeMessageResponse<{
    bytesBase64?: string
    downloaded?: boolean
    downloadId?: number
    mimeType?: string
    size?: number
    filename?: string
  }>
> {
  const { url, atToken, authUser, mode, filename } = normalizeStudioBinaryFetchRequest(message)
  const baseUrl = normalizeBinaryAssetUrl(url)

  if (!baseUrl) {
    return { success: false, error: "URL do asset ausente." }
  }

  console.log("[MindDock][BG][StudioBinaryFetch] start", {
    url: baseUrl,
    hasToken: Boolean(atToken),
    authUser: authUser ?? null,
    mode: mode ?? "buffer",
    filename: filename ?? null
  })

  const candidateUrl = withAuthUserIfGoogle(baseUrl, authUser)
  const urls = Array.from(new Set([baseUrl, candidateUrl]))

  let lastStatus: number | null = null
  let lastError = ""

  const buildDownloadCandidates = (seedUrls: string[]): string[] => {
    const out = new Set<string>()
    for (const raw of seedUrls) {
      const normalized = normalizeBinaryAssetUrl(raw)
      if (!normalized) continue
      out.add(normalized)
      out.add(withAuthUserIfGoogle(normalized, authUser))
      if (atToken) {
        out.add(appendAtToken(normalized, atToken))
        out.add(appendAtToken(withAuthUserIfGoogle(normalized, authUser), atToken))
      }
    }
    return Array.from(out).filter(Boolean)
  }

  const tryDirectDownload = async (candidateUrls: string[], resolvedFilename: string): Promise<number | null> => {
    if (!chrome?.downloads?.download) {
      console.warn("[MindDock][BG][StudioBinaryFetch] downloads-api-unavailable", {
        filename: resolvedFilename
      })
      return null
    }

    for (const targetUrl of candidateUrls) {
      const downloadId = await new Promise<number | null>((resolve) => {
        try {
          chrome.downloads.download(
            { url: targetUrl, filename: resolvedFilename, saveAs: false },
            (id) => {
              const runtimeError = chrome.runtime.lastError
              if (runtimeError || typeof id !== "number") {
                console.warn("[MindDock][BG][StudioBinaryFetch] direct-url-download-fail", {
                  url: targetUrl,
                  filename: resolvedFilename,
                  error: runtimeError?.message ?? "unknown"
                })
                resolve(null)
                return
              }
              resolve(id)
            }
          )
        } catch (error) {
          console.warn("[MindDock][BG][StudioBinaryFetch] direct-url-download-throw", {
            url: targetUrl,
            filename: resolvedFilename,
            error: error instanceof Error ? error.message : String(error)
          })
          resolve(null)
        }
      })

      if (downloadId !== null) {
        console.log("[MindDock][BG][StudioBinaryFetch] direct-url-download-success", {
          url: targetUrl,
          filename: resolvedFilename,
          downloadId
        })
        return downloadId
      }
    }

    return null
  }

  const respondSuccess = async (
    bytes: Uint8Array,
    mimeType?: string,
    sourceUrl?: string
  ): Promise<
    ChromeMessageResponse<{
      bytesBase64?: string
      downloaded?: boolean
      downloadId?: number
      mimeType?: string
      size?: number
      filename?: string
    }>
  > => {
    const shouldDirectDownload = mode === "download" || bytes.byteLength > MAX_RAW_BYTES_FOR_MESSAGE

    if (shouldDirectDownload) {
      const resolvedFilename = normalizeBackgroundDownloadFilename(filename, mimeType)
      const directCandidates = buildDownloadCandidates([sourceUrl ?? baseUrl, ...urls])
      const directDownloadId = await tryDirectDownload(directCandidates, resolvedFilename)
      if (directDownloadId !== null) {
        return {
          success: true,
          payload: {
            downloaded: true,
            downloadId: directDownloadId,
            mimeType,
            size: bytes.byteLength,
            filename: resolvedFilename
          },
          data: {
            downloaded: true,
            downloadId: directDownloadId,
            mimeType,
            size: bytes.byteLength,
            filename: resolvedFilename
          }
        }
      }

      if (typeof URL.createObjectURL !== "function") {
        throw new Error("Direct download failed and URL.createObjectURL is unavailable in service worker.")
      }

      const blob = new Blob([bytes], { type: mimeType || "application/octet-stream" })
      const objectUrl = URL.createObjectURL(blob)
      try {
        const downloadId = await new Promise<number>((resolve, reject) => {
          chrome.downloads.download({ url: objectUrl, filename: resolvedFilename, saveAs: false }, (id) => {
            const runtimeError = chrome.runtime.lastError
            if (runtimeError || typeof id !== "number") {
              reject(new Error(runtimeError?.message || "download failed"))
              return
            }
            resolve(id)
          })
        })
        console.log("[MindDock][BG][StudioBinaryFetch] direct-download-success", {
          url: baseUrl,
          downloadId,
          filename: resolvedFilename,
          size: bytes.byteLength,
          mimeType: mimeType ?? null
        })

        setTimeout(() => URL.revokeObjectURL(objectUrl), 120_000)
        return {
          success: true,
          payload: {
            downloaded: true,
            downloadId,
            mimeType,
            size: bytes.byteLength,
            filename: resolvedFilename
          },
          data: {
            downloaded: true,
            downloadId,
            mimeType,
            size: bytes.byteLength,
            filename: resolvedFilename
          }
        }
      } catch (error) {
        try {
          URL.revokeObjectURL(objectUrl)
        } catch {
          // ignore revoke failures
        }
        throw error
      }
    }

    const bytesBase64 = bytesToBase64(bytes)
    return {
      success: true,
      payload: {
        bytesBase64,
        mimeType,
        size: bytes.byteLength
      },
      data: {
        bytesBase64,
        mimeType,
        size: bytes.byteLength
      }
    }
  }

  if (mode === "download") {
    const resolvedFilename = normalizeBackgroundDownloadFilename(filename)
    const directCandidates = buildDownloadCandidates(urls)
    const directDownloadId = await tryDirectDownload(directCandidates, resolvedFilename)
    if (directDownloadId !== null) {
      return {
        success: true,
        payload: {
          downloaded: true,
          downloadId: directDownloadId,
          filename: resolvedFilename
        },
        data: {
          downloaded: true,
          downloadId: directDownloadId,
          filename: resolvedFilename
        }
      }
    }
    console.warn("[MindDock][BG][StudioBinaryFetch] direct-mode-download-failed-continue-fetch", {
      filename: resolvedFilename,
      candidates: directCandidates.length
    })
  }

  const runFetch = async (
    targetUrl: string,
    strategy: string,
    init?: RequestInit
  ): Promise<{ ok: true; bytes: Uint8Array; mimeType?: string } | { ok: false }> => {
    try {
      const response = await fetch(targetUrl, { redirect: "follow", ...init })
      if (!response.ok) {
        lastStatus = response.status
        console.warn("[MindDock][BG][StudioBinaryFetch] http-fail", {
          strategy,
          status: response.status,
          url: targetUrl
        })
        return { ok: false }
      }
      const ab = await response.arrayBuffer()
      const mimeType = response.headers.get("content-type") ?? undefined
      console.log("[MindDock][BG][StudioBinaryFetch] success", {
        strategy,
        url: targetUrl,
        size: ab.byteLength,
        mimeType: mimeType ?? null
      })
      return {
        ok: true,
        bytes: new Uint8Array(ab),
        mimeType
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      console.warn("[MindDock][BG][StudioBinaryFetch] network-fail", {
        strategy,
        url: targetUrl,
        error: lastError
      })
      return { ok: false }
    }
  }

  for (const target of urls) {
    const includeAttempt = await runFetch(target, "include", { credentials: "include" })
    if (includeAttempt.ok) {
      return respondSuccess(includeAttempt.bytes, includeAttempt.mimeType, target)
    }

    if (atToken) {
      const authAttempt = await runFetch(target, "include+auth", {
        credentials: "include",
        headers: { Authorization: `Bearer ${atToken}` }
      })
      if (authAttempt.ok) {
        return respondSuccess(authAttempt.bytes, authAttempt.mimeType, target)
      }
    }

    if (atToken) {
      const withAt = appendAtToken(target, atToken)
      const atAttempt = await runFetch(withAt, "include+at", { credentials: "include" })
      if (atAttempt.ok) {
        return respondSuccess(atAttempt.bytes, atAttempt.mimeType, withAt)
      }
    }

    const anonymousAttempt = await runFetch(target, "anonymous")
    if (anonymousAttempt.ok) {
      return respondSuccess(anonymousAttempt.bytes, anonymousAttempt.mimeType, target)
    }
  }

  console.warn("[MindDock][BG][StudioBinaryFetch] failed", {
    url: baseUrl,
    lastStatus,
    lastError: lastError || null
  })
  return {
    success: false,
    error: lastStatus !== null ? `Binary fetch failed (${lastStatus})` : lastError || "Binary fetch failed"
  }
}
