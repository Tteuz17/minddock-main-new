import { googleRpc, type GoogleRPCResponse } from "../api/GoogleRPC"
import type { Notebook } from "~/lib/types"
import {
  buildNotebookAccountKey,
  buildScopedStorageKey,
  isConfirmedNotebookAccountKey,
  normalizeAccountEmail,
  normalizeAuthUser
} from "~/lib/notebook-account-scope"
import { getFromSecureStorage } from "~/lib/utils"

const NOTEBOOK_CACHE_KEY = "minddock_cached_notebooks"
const AUTH_USER_KEY = "nexus_auth_user"
const ACCOUNT_EMAIL_KEY = "nexus_notebook_account_email"
const TOKEN_STORAGE_KEY = "notebooklm_session"
const STRICT_NOTEBOOK_ACCOUNT_MODE = true
const CREATE_NOTEBOOK_RPC_ID = "CCqFvf"
const ADD_SOURCE_RPC_ID = "izAoDd"
const RPC_DEBUG_PREVIEW_LENGTH = 500
const RECOVERY_LOOKBACK_WINDOW_MS = 5_000
const RECOVERY_MAX_ATTEMPTS = 3
const RECOVERY_RETRY_DELAY_MS = 1_000
const UNTITLED_NOTEBOOK_TITLES = new Set(["sem titulo", "untitled notebook"])
const MAX_INITIAL_CONTENT_LENGTH = 120_000

export interface CreatedNotebookRecord {
  id: string
  status: "created_unknown_id" | "success"
  sourceAdded?: boolean
  title: string
  warning?: string
}

export interface NotebookCreateError {
  error: "AUTH_ERROR"
  success: false
}

export type NotebookCreateResult = CreatedNotebookRecord | NotebookCreateError
type NotebookRPCResponse = GoogleRPCResponse

interface CreationResult {
  id: string | null
  recoveredFromCache: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizeForMatch(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function looksLikeNotebookId(value: string): boolean {
  const normalizedValue = String(value ?? "").trim()

  return (
    normalizedValue.length >= 12 &&
    /^[A-Za-z0-9_-]+$/.test(normalizedValue) &&
    !/^\d+$/.test(normalizedValue) &&
    !normalizedValue.startsWith("[") &&
    normalizedValue !== "null"
  )
}

function extractIdFromRawText(responseText: string): string | null {
  const normalizedResponse = String(responseText ?? "")

  const uuidMatch = normalizedResponse.match(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i
  )
  if (uuidMatch?.[0]) {
    return uuidMatch[0]
  }

  const tokenMatches = normalizedResponse.matchAll(/["']([A-Za-z0-9_-]{12,})["']/g)
  for (const match of tokenMatches) {
    const candidate = String(match[1] ?? "").trim()
    if (looksLikeNotebookId(candidate)) {
      return candidate
    }
  }

  return null
}

function findNotebookIdInValue(value: unknown): string | null {
  if (typeof value === "string") {
    const normalizedValue = value.trim()

    if (!normalizedValue) {
      return null
    }

    if (looksLikeNotebookId(normalizedValue)) {
      return normalizedValue
    }

    try {
      const reparsedValue = JSON.parse(normalizedValue) as unknown
      return findNotebookIdInValue(reparsedValue)
    } catch {
      return null
    }
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const nestedId = findNotebookIdInValue(entry)
      if (nestedId) {
        return nestedId
      }
    }

    return null
  }

  if (isRecord(value)) {
    for (const nestedValue of Object.values(value)) {
      const nestedId = findNotebookIdInValue(nestedValue)
      if (nestedId) {
        return nestedId
      }
    }
  }

  return null
}

function parseNotebookTimestamp(notebook: Notebook): number {
  const updateTime = Date.parse(String(notebook.updateTime ?? ""))
  if (Number.isFinite(updateTime) && updateTime > 0) {
    return updateTime
  }

  const createTime = Date.parse(String(notebook.createTime ?? ""))
  return Number.isFinite(createTime) && createTime > 0 ? createTime : 0
}

function isMatchingRecoveryTitle(notebookTitle: string, requestedTitle: string): boolean {
  const normalizedNotebookTitle = normalizeForMatch(notebookTitle)
  const normalizedRequestedTitle = normalizeForMatch(requestedTitle)

  return (
    normalizedNotebookTitle === normalizedRequestedTitle ||
    UNTITLED_NOTEBOOK_TITLES.has(normalizedNotebookTitle)
  )
}

function findMostRecentNotebook(notebooks: Notebook[], title: string, startedAt: number): Notebook | null {
  const createdAfter = startedAt - RECOVERY_LOOKBACK_WINDOW_MS

  const matches = notebooks
    .filter((notebook) => {
      const notebookTimestamp = parseNotebookTimestamp(notebook)
      if (notebookTimestamp < createdAfter) {
        return false
      }

      return isMatchingRecoveryTitle(notebook.title, title)
    })
    .sort((left, right) => parseNotebookTimestamp(right) - parseNotebookTimestamp(left))

  return matches[0] ?? null
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs)
  })
}

async function resolveNotebookAccountScope(): Promise<{ accountKey: string; confirmed: boolean }> {
  try {
    const secureSession = await getFromSecureStorage<Record<string, unknown>>(TOKEN_STORAGE_KEY)
    const snapshot = await chrome.storage.local.get([AUTH_USER_KEY, ACCOUNT_EMAIL_KEY, TOKEN_STORAGE_KEY])
    const fixedAuthUser = normalizeAuthUser(snapshot[AUTH_USER_KEY])
    const fixedAccountEmail = normalizeAccountEmail(snapshot[ACCOUNT_EMAIL_KEY])

    const session = secureSession ?? snapshot[TOKEN_STORAGE_KEY]
    const sessionAuthUser =
      session && typeof session === "object"
        ? normalizeAuthUser((session as { authUser?: unknown }).authUser)
        : null
    const sessionAccountEmail =
      session && typeof session === "object"
        ? normalizeAccountEmail((session as { accountEmail?: unknown }).accountEmail)
        : null

    const accountKey = buildNotebookAccountKey({
      accountEmail: fixedAccountEmail ?? sessionAccountEmail,
      authUser: fixedAuthUser ?? sessionAuthUser
    })
    return { accountKey, confirmed: isConfirmedNotebookAccountKey(accountKey) }
  } catch {
    const accountKey = buildNotebookAccountKey(null)
    return { accountKey, confirmed: false }
  }
}

export class NotebookService {
  private async fetchNotebookLibrary(): Promise<Notebook[]> {
    const accountScope = await resolveNotebookAccountScope()
    if (STRICT_NOTEBOOK_ACCOUNT_MODE && !accountScope.confirmed) {
      return []
    }

    const accountKey = accountScope.accountKey
    const scopedCacheKey = buildScopedStorageKey(NOTEBOOK_CACHE_KEY, accountKey)
    const snapshot = await chrome.storage.local.get([scopedCacheKey])
    const rawItems = Array.isArray(snapshot[scopedCacheKey])
      ? (snapshot[scopedCacheKey] as unknown[])
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
      .filter((item) => item.id && item.title)
  }

  private async syncNotebooksList(): Promise<Notebook[]> {
    return this.fetchNotebookLibrary()
  }

  private async attemptResyncAndLocateNotebook(
    title: string,
    startedAt: number
  ): Promise<Notebook | null> {
    for (let attempt = 0; attempt < RECOVERY_MAX_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        await delay(RECOVERY_RETRY_DELAY_MS)
      }

      const notebooks = await this.syncNotebooksList()
      const recoveredNotebook = findMostRecentNotebook(notebooks, title, startedAt)
      if (recoveredNotebook) {
        return recoveredNotebook
      }
    }

    return null
  }

  private async executeNotebookCreationStrategy(title: string): Promise<CreationResult> {
    const startedAt = Date.now()
    const rpcResponse: NotebookRPCResponse = await googleRpc.execute(CREATE_NOTEBOOK_RPC_ID, [title])
    const rawRpcResponsePayload = rpcResponse.sanitizedText || rpcResponse.rawText

    console.log(
      `[RPC-DEBUG] Raw Creation Response: ${rawRpcResponsePayload.substring(0, RPC_DEBUG_PREVIEW_LENGTH)}...`
    )

    const regexId = extractIdFromRawText(rawRpcResponsePayload)
    if (regexId) {
      return {
        id: regexId,
        recoveredFromCache: false
      }
    }

    const parsedId = findNotebookIdInValue(rpcResponse.parsedPayload)
    if (parsedId) {
      return {
        id: parsedId,
        recoveredFromCache: false
      }
    }

    const recoveredNotebook = await this.attemptResyncAndLocateNotebook(title, startedAt)
    if (recoveredNotebook) {
      return {
        id: recoveredNotebook.id,
        recoveredFromCache: true
      }
    }

    return {
      id: null,
      recoveredFromCache: false
    }
  }

  async createNotebook(title: string): Promise<NotebookCreateResult> {
    const normalizedTitle = String(title ?? "").trim() || "Novo Notebook"

    console.log(`[Background] Creating notebook: ${normalizedTitle}`)

    try {
      const creationResult = await this.executeNotebookCreationStrategy(normalizedTitle)
      console.log(
        "[Background] Notebook create strategy extracted notebook ID:",
        creationResult.id
      )

      if (creationResult.id) {
        return {
          id: creationResult.id,
          title: normalizedTitle,
          status: "success"
        }
      }

      console.warn(
        "[Background] Notebook create RPC accepted, but the notebook ID was not recovered."
      )

      return {
        id: "",
        title: normalizedTitle,
        status: "created_unknown_id"
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown RPC error."
      console.error("[Background] Notebook creation RPC failed:", errorMessage)

      return {
        success: false,
        error: "AUTH_ERROR"
      }
    }
  }

  async addSource(notebookId: string, sourceTitle: string, content: string): Promise<void> {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    const normalizedSourceTitle = String(sourceTitle ?? "").trim()
    const normalizedContent = String(content ?? "").trim()

    if (!normalizedNotebookId) {
      throw new Error("notebookId obrigatorio para adicionar fonte inicial.")
    }

    if (!normalizedContent) {
      throw new Error("content obrigatorio para adicionar fonte inicial.")
    }

    const sourceLabel = normalizedSourceTitle || `Source ${new Date().toISOString()}`
    const contentToUpload = normalizedContent.slice(0, MAX_INITIAL_CONTENT_LENGTH)

    console.log(
      `[Background] Adding initial source to notebook ${normalizedNotebookId} (${contentToUpload.length} chars).`
    )

    const payload: unknown[] = [
      [
        [
          null,
          [sourceLabel, contentToUpload],
          null,
          2,
          null,
          null,
          null,
          null,
          null,
          null,
          1
        ]
      ],
      normalizedNotebookId,
      [2]
    ]

    await googleRpc.execute(ADD_SOURCE_RPC_ID, payload)
  }
}

export const notebookService = new NotebookService()
