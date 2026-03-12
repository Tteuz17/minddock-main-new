import { router } from "./router"
import {
  notebookService,
  type CreatedNotebookRecord,
  type NotebookCreateError,
  type NotebookCreateResult
} from "./services/NotebookService"
import { tokenStorage } from "./storage/TokenStorage"
import type { ChromeMessage, ChromeMessageResponse } from "~/lib/types"
import {
  probeAvailableAccounts,
  resolveActiveSessions,
  type NotebookProbeAccountResult
} from "~/services/notebookDiscoveryService"
import { formatChatAsReadableMarkdownV2 } from "~/lib/utils"
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
    const snapshot = await chrome.storage.local.get([
      AUTH_USER_KEY,
      NOTEBOOK_ACCOUNT_EMAIL_KEY,
      TOKEN_STORAGE_KEY,
      SETTINGS_KEY
    ])
    const fixedAccountEmail = normalizeAccountEmail(snapshot[NOTEBOOK_ACCOUNT_EMAIL_KEY])
    const fromFixed = normalizeAuthUser(snapshot[AUTH_USER_KEY])

    const session = snapshot[TOKEN_STORAGE_KEY]
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
