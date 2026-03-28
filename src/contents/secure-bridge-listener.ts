import type { PlasmoCSConfig } from "plasmo"
import {
  buildNotebookAccountKey,
  buildScopedStorageKey,
  isConfirmedNotebookAccountKey,
  normalizeAccountEmail,
  resolveAuthUserFromUrl
} from "~/lib/notebook-account-scope"

export const config: PlasmoCSConfig = {
  matches: ["https://notebooklm.google.com/*"],
  run_at: "document_start"
}

const MESSAGE_SOURCE = "MINDDOCK_HOOK"
const MESSAGE_TYPE = "NOTEBOOK_LIST_UPDATED"
const STUDIO_MESSAGE_TYPE = "STUDIO_RESULTS_UPDATED"
const STORAGE_KEY_BASE = "minddock_cached_notebooks"
const STORAGE_SYNC_KEY_BASE = "minddock_cached_notebooks_synced_at"
const STUDIO_STORAGE_KEY_BASE = "minddock_cached_studio_items"
const STUDIO_STORAGE_SYNC_KEY_BASE = "minddock_cached_studio_items_synced_at"
const AUTH_USER_KEY = "nexus_auth_user"
const ACCOUNT_EMAIL_KEY = "nexus_notebook_account_email"
const PENDING_NOTEBOOK_RESULT_KEY = "minddock_pending_notebook_result"
const PENDING_NOTEBOOK_REQUESTED_AT_KEY = "minddock_pending_notebook_requested_at"
const PROVISIONAL_NOTEBOOK_MAX_AGE_MS = 30000
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const BLOCKED_NOTEBOOK_TITLE_KEYS = new Set([
  "conversa",
  "conversas",
  "conversation",
  "conversations"
])

export interface NotebookEntry {
  id: string
  title: string
  provisional?: boolean
}

export interface StudioCacheItem {
  id: string
  title: string
  type?: string
  meta?: string
  content?: string
  url?: string
  mimeType?: string
  sourceCount?: number
  updatedAt?: string
  notebookId?: string
  kind?: "text" | "asset"
}

interface BridgeEnvelope {
  source?: unknown
  type?: unknown
  payload?: unknown
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim()
}

function normalizeNotebookScope(value: unknown): string {
  return normalizeString(value).toLowerCase()
}

function resolveNotebookIdFromLocation(): string | null {
  const match = String(window.location.href ?? "").match(UUID_RE)
  return match?.[0] ?? null
}

function buildNotebookScopedStorageKey(baseKey: string, accountKey: string, notebookId?: string): string {
  const scopedKey = buildScopedStorageKey(baseKey, accountKey)
  const notebookScope = normalizeNotebookScope(notebookId)
  return notebookScope ? `${scopedKey}::notebook:${notebookScope}` : scopedKey
}

function normalizeNotebookTitleKey(value: string): string {
  return normalizeString(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function isBlockedNotebookTitle(value: string): boolean {
  return BLOCKED_NOTEBOOK_TITLE_KEYS.has(normalizeNotebookTitleKey(value))
}

function isNotebookEntry(value: unknown): value is NotebookEntry {
  if (!isObjectRecord(value)) {
    return false
  }

  return normalizeString(value.id).length > 0 && normalizeString(value.title).length > 0
}

function isStudioCacheItem(value: unknown): value is StudioCacheItem {
  if (!isObjectRecord(value)) {
    return false
  }

  return normalizeString(value.id).length > 0 && normalizeString(value.title).length > 0
}

function scoreNotebookTitle(value: string): number {
  const normalizedValue = normalizeString(value).toLowerCase()
  if (!normalizedValue) {
    return -1
  }

  let score = normalizedValue.length

  if (
    normalizedValue === "untitled notebook" ||
    normalizedValue === "untitled" ||
    normalizedValue === "caderno sem titulo" ||
    normalizedValue === "sem titulo"
  ) {
    score -= 40
  }

  if (/\s/.test(normalizedValue)) {
    score += 6
  }

  return score
}

function upsertNotebookEntry(output: Map<string, NotebookEntry>, notebook: NotebookEntry): void {
  const existingNotebook = output.get(notebook.id)
  if (!existingNotebook) {
    output.set(notebook.id, notebook)
    return
  }

  if (scoreNotebookTitle(notebook.title) > scoreNotebookTitle(existingNotebook.title)) {
    output.set(notebook.id, notebook)
  }
}

function resolveNotebookEntries(payload: unknown): NotebookEntry[] | null {
  if (!Array.isArray(payload)) {
    return null
  }

  const notebooks = new Map<string, NotebookEntry>()

  for (const candidate of payload) {
    if (!isNotebookEntry(candidate)) {
      return null
    }

    const notebook: NotebookEntry = {
      id: normalizeString(candidate.id),
      title: normalizeString(candidate.title)
    }

    if (isBlockedNotebookTitle(notebook.title)) {
      continue
    }

    upsertNotebookEntry(notebooks, notebook)
  }

  return Array.from(notebooks.values())
}

function resolveStudioEntries(payload: unknown): StudioCacheItem[] | null {
  if (!Array.isArray(payload)) {
    return null
  }

  const items: StudioCacheItem[] = []

  for (const candidate of payload) {
    if (!isStudioCacheItem(candidate)) {
      return null
    }

    const item: StudioCacheItem = {
      id: normalizeString(candidate.id),
      title: normalizeString(candidate.title),
      type: normalizeString(candidate.type) || undefined,
      meta: normalizeString(candidate.meta) || undefined,
      content: normalizeString(candidate.content) || undefined,
      url: normalizeString(candidate.url) || undefined,
      mimeType: normalizeString(candidate.mimeType) || undefined,
      sourceCount: typeof candidate.sourceCount === "number" ? candidate.sourceCount : undefined,
      updatedAt: normalizeString(candidate.updatedAt) || undefined,
      notebookId: normalizeNotebookScope(candidate.notebookId) || undefined,
      kind:
        candidate.kind === "asset" || candidate.kind === "text"
          ? candidate.kind
          : undefined
    }

    if (!item.id || !item.title) {
      continue
    }

    items.push(item)
  }

  return items
}

function resolvePendingCreatedNotebook(payload: unknown, requestedAtValue: unknown): NotebookEntry | null {
  if (!isObjectRecord(payload)) {
    return null
  }

  const requestedAt = normalizeString(requestedAtValue)
  if (!requestedAt) {
    return null
  }

  const requestedAtMs = Date.parse(requestedAt)
  if (!Number.isFinite(requestedAtMs)) {
    return null
  }

  if (Date.now() - requestedAtMs > PROVISIONAL_NOTEBOOK_MAX_AGE_MS) {
    return null
  }

  const id = normalizeString(payload.id)
  const title = normalizeString(payload.title)
  if (!id || !title) {
    return null
  }

  if (isBlockedNotebookTitle(title)) {
    return null
  }

  return {
    id,
    title,
    provisional: true
  }
}

function isTrustedBridgeEvent(event: MessageEvent<unknown>): event is MessageEvent<BridgeEnvelope> {
  if (event.source !== window) {
    return false
  }

  if (!isObjectRecord(event.data)) {
    return false
  }

  return normalizeString(event.data.source) === MESSAGE_SOURCE
}

function resolveCurrentAccountScope(accountHints?: {
  accountEmail?: unknown
  authUser?: unknown
}): {
  accountKey: string
  accountEmail: string | null
  authUser: string | null
  confirmed: boolean
} {
  const accountEmail = normalizeAccountEmail(accountHints?.accountEmail)
  const authUser = normalizeString(accountHints?.authUser) || resolveAuthUserFromUrl(window.location.href)
  const accountKey = buildNotebookAccountKey({ accountEmail, authUser })

  return {
    accountKey,
    accountEmail,
    authUser: authUser || null,
    confirmed: isConfirmedNotebookAccountKey(accountKey)
  }
}

function notifyCacheUpdated(accountKey: string): void {
  try {
    chrome.runtime.sendMessage({ type: "CACHE_UPDATED", accountKey }, () => {
      void chrome.runtime.lastError
    })
  } catch {
    // Silent by design: the page must not be affected by extension errors.
  }
}

function logNotebookSync(notebooks: NotebookEntry[]): void {
  void notebooks
}

function logStudioSync(items: StudioCacheItem[]): void {
  void items
}

function persistNotebookCache(
  notebooks: NotebookEntry[],
  accountHints?: {
    accountEmail?: unknown
    authUser?: unknown
  }
): void {
  try {
    const syncedAt = new Date().toISOString()
    const accountScope = resolveCurrentAccountScope(accountHints)
    if (!accountScope.confirmed) {
      return
    }

    const scopedStorageKey = buildScopedStorageKey(STORAGE_KEY_BASE, accountScope.accountKey)
    const scopedSyncKey = buildScopedStorageKey(STORAGE_SYNC_KEY_BASE, accountScope.accountKey)

    chrome.storage.local.get(
      [PENDING_NOTEBOOK_RESULT_KEY, PENDING_NOTEBOOK_REQUESTED_AT_KEY],
      (snapshot) => {
        if (chrome.runtime.lastError) {
          return
        }

        const nextNotebooks = [...notebooks]
        const pendingCreatedNotebook = resolvePendingCreatedNotebook(
          snapshot[PENDING_NOTEBOOK_RESULT_KEY],
          snapshot[PENDING_NOTEBOOK_REQUESTED_AT_KEY]
        )

        if (
          pendingCreatedNotebook &&
          !nextNotebooks.some((notebook) => notebook.id === pendingCreatedNotebook.id)
        ) {
          nextNotebooks.push(pendingCreatedNotebook)
        }

        chrome.storage.local.set(
          {
            [scopedStorageKey]: nextNotebooks,
            [scopedSyncKey]: syncedAt,
            ...(accountScope.accountEmail
              ? { [ACCOUNT_EMAIL_KEY]: accountScope.accountEmail }
              : {}),
            ...(accountScope.authUser ? { [AUTH_USER_KEY]: accountScope.authUser } : {})
          },
          () => {
            if (chrome.runtime.lastError) {
              return
            }

            notifyCacheUpdated(accountScope.accountKey)
            logNotebookSync(nextNotebooks)
          }
        )
      }
    )
  } catch {
    // Silent by design: the page must not be affected by extension errors.
  }
}

function persistStudioCache(
  items: StudioCacheItem[],
  accountHints?: {
    accountEmail?: unknown
    authUser?: unknown
  }
): void {
  try {
    const syncedAt = new Date().toISOString()
    const accountScope = resolveCurrentAccountScope(accountHints)
    const currentNotebookId = normalizeNotebookScope(resolveNotebookIdFromLocation())
    const normalizedItems = items.map((item) => ({
      ...item,
      notebookId: normalizeNotebookScope(item.notebookId) || currentNotebookId || undefined
    }))

    const scopedStorageKey = buildScopedStorageKey(STUDIO_STORAGE_KEY_BASE, accountScope.accountKey)
    const scopedSyncKey = buildScopedStorageKey(STUDIO_STORAGE_SYNC_KEY_BASE, accountScope.accountKey)
    const notebookScopedStorageKey = buildNotebookScopedStorageKey(
      STUDIO_STORAGE_KEY_BASE,
      accountScope.accountKey,
      currentNotebookId
    )
    const notebookScopedSyncKey = buildNotebookScopedStorageKey(
      STUDIO_STORAGE_SYNC_KEY_BASE,
      accountScope.accountKey,
      currentNotebookId
    )

    chrome.storage.local.set(
      {
        [scopedStorageKey]: normalizedItems,
        [scopedSyncKey]: syncedAt,
        ...(currentNotebookId
          ? {
              [notebookScopedStorageKey]: normalizedItems,
              [notebookScopedSyncKey]: syncedAt
            }
          : {}),
        ...(accountScope.accountEmail ? { [ACCOUNT_EMAIL_KEY]: accountScope.accountEmail } : {}),
        ...(accountScope.authUser ? { [AUTH_USER_KEY]: accountScope.authUser } : {})
      },
      () => {
        if (chrome.runtime.lastError) {
          return
        }

        notifyCacheUpdated(accountScope.accountKey)
        logStudioSync(normalizedItems)
      }
    )
  } catch {
    // Silent by design: the page must not be affected by extension errors.
  }
}

function handleBridgeMessage(event: MessageEvent<unknown>): void {
  try {
    if (!isTrustedBridgeEvent(event)) {
      return
    }

    const messageType = normalizeString(event.data.type)
    if (messageType === MESSAGE_TYPE) {
      const payloadEnvelope =
        isObjectRecord(event.data.payload) && !Array.isArray(event.data.payload)
          ? (event.data.payload as { notebooks?: unknown; accountEmail?: unknown; authUser?: unknown })
          : null
      const notebooksPayload = payloadEnvelope ? payloadEnvelope.notebooks : event.data.payload
      const notebooks = resolveNotebookEntries(notebooksPayload)
      if (notebooks === null) {
        return
      }

      persistNotebookCache(notebooks, payloadEnvelope ?? undefined)
      return
    }

    if (messageType === STUDIO_MESSAGE_TYPE) {
      const payloadEnvelope =
        isObjectRecord(event.data.payload) && !Array.isArray(event.data.payload)
          ? (event.data.payload as { items?: unknown; accountEmail?: unknown; authUser?: unknown })
          : null
      const itemsPayload = payloadEnvelope ? payloadEnvelope.items : event.data.payload
      const items = resolveStudioEntries(itemsPayload)
      if (items === null) {
        return
      }

      persistStudioCache(items, payloadEnvelope ?? undefined)
      return
    }
  } catch {
    // Silent by design: the page must not be affected by extension errors.
  }
}

window.addEventListener("message", handleBridgeMessage)
