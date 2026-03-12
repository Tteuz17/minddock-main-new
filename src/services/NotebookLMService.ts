import {
  normalizeAccountEmail,
  normalizeAuthUser,
  resolveAuthUserFromUrl
} from "~/lib/notebook-account-scope"

const NOTEBOOKLM_BASE_URL = "https://notebooklm.google.com"
const NOTEBOOKLM_BOOTSTRAP_URL = "https://notebooklm.google.com/?pageId=none"
const NOTEBOOKLM_RPC_ENDPOINT =
  "https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute"
const ADD_SOURCE_RPC_ID = "izAoDd"
const SYNC_GDOC_RPC_ID = "FLmJqe"
const DELETE_SOURCE_RPC_ID = "tGMBJ"
const CREATE_NOTEBOOK_RPC_ID = "CCqFvf"
const LIST_NOTEBOOKS_RPC_ID = "wXbhsf"
const LIST_SOURCES_RPC_ID = "rLM1Ne"
const GET_SOURCE_CONTENT_RPC_ID = "hizoJc"
const DEFAULT_SOURCE_PATH = "/"
const GOOGLE_DOCS_MIME_TYPE = "application/vnd.google-apps.document"
const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i
const SOURCE_ID_LOOKUP_RETRIES = 3
const SOURCE_UPDATE_VERIFY_RETRIES = 3
const SOURCE_UPDATE_VERIFY_DELAY_MS = 450
const STRICT_REPLACE_DELETE_BUDGET_MS = 25_000
const STRICT_REPLACE_DELETE_CONFIRM_MAX_WAIT_MS = 8_000
const STRICT_REPLACE_DELETE_CONFIRM_POLL_MS = 800
const STRICT_REPLACE_DELETE_RETRY_DELAY_MS = 1_500
const SOURCE_DELETE_VERIFY_RETRIES = 6
const SOURCE_DELETE_VERIFY_DELAY_MS = 500
const MAX_STALE_INDEX_TOLERANCE_MS = 2_800
const OPTIMISTIC_DELETE_SETTLE_DELAY_MS = 800
const OPTIMISTIC_DELETE_RPC_TIMEOUT_MS = 900
const OPTIMISTIC_DELETE_LIST_TIMEOUT_MS = 700
const TOKEN_STORAGE_KEY = "notebooklm_session"
const FIXED_AT_TOKEN_KEY = "nexus_at_token"
const FIXED_BL_TOKEN_KEY = "nexus_bl_token"
const FIXED_AUTH_USER_KEY = "nexus_auth_user"
const FIXED_ACCOUNT_EMAIL_KEY = "nexus_notebook_account_email"
const BLOCKED_NOTEBOOK_TITLE_KEYS = new Set([
  "conversa",
  "conversas",
  "conversation",
  "conversations"
])

interface NotebookLMAuthTokens {
  at: string
  bl: string
  accountEmail?: string | null
  authUser?: string | null
}

interface NotebookSourceSummary {
  id: string
  title: string
  gDocId?: string
  docReference?: string
  isGDoc?: boolean
}

interface SourceSnapshotEntry {
  id: string
  title: string
}

interface NotebookListEntry {
  id: string
  title: string
}

interface ResyncDiagnostics {
  notebookId: string
  boundSourceId: string | null
  existsInListBeforeDelete: boolean
  resolvedSourceId: string | null
  remappedByTitle: boolean
  deletePayloadVariant: "tGMBJ" | "legacy" | "none"
  sourcePath: string | null
  rpcError: string | null
  existsInListAfterDelete: boolean | null
  updateInPlaceAttempted: boolean
  updateInPlaceSucceeded: boolean | null
  updateInPlaceError: string | null
  listSnapshotBefore: SourceSnapshotEntry[]
  listSnapshotAfter: SourceSnapshotEntry[] | null
}

interface StrictReplaceSourceOptions {
  signal?: AbortSignal
  onProgress?: (message: string) => void
}

interface StrictReplaceSourceResult {
  newSourceId: string
  wasReplaced: boolean
  updatedInPlace: boolean
}

interface DeleteSourceRpcOutcome {
  payloadVariant: "tGMBJ" | "legacy"
  sourcePath: string
  candidateIndex: number
}

type OptimisticDeleteSourceResult = "SUCCESS" | "STALE"

interface OptimisticDeleteSourceOptions {
  deleteRpcTimeoutMs?: number
  listSourcesTimeoutMs?: number
  settleDelayMs?: number
  maxTotalMs?: number
}

interface SmartDeleteSourceOptions extends OptimisticDeleteSourceOptions {
  maxPollingAttempts?: number
  pollIntervalMs?: number
  onPollingAttempt?: (attempt: number, totalAttempts: number) => void
}

interface UpdateSourceOptions {
  verifyContent?: boolean
  rpcStepTimeoutMs?: number
  allowUnverifiedSuccess?: boolean
}

interface CleanupDuplicateSourcesResult {
  matchedCount: number
  requestedDeleteCount: number
}

interface EnsureSourceSlotAvailableOptions {
  maxWaitMs?: number
  checkIntervalMs?: number
  requiredSourceIdToClear?: string
}

interface EnsureSourceSlotAvailableResult {
  cleared: boolean
  authErrorDetected: boolean
}

export interface SyncVerificationResult {
  sourceId: string
  title: string
  accepted: boolean
  changed: boolean
  isGDoc: boolean
  skipReason?: string
}

type VerifyAndClearTitlePathOptions = EnsureSourceSlotAvailableOptions
type VerifyAndClearTitlePathResult = EnsureSourceSlotAvailableResult

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs)
  })
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AuthError"
  }
}

class NotebookLMRpcError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NotebookLMRpcError"
  }
}

export class NotebookLMService {
  private cachedTokens: NotebookLMAuthTokens | null = null

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

  private normalizeNotebookTitleKey(value: string): string {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
  }

  private isDeleteSourceNotFoundError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? "")
    return /HTTP 404|NOT_FOUND|not[\s_-]*found|nao[\s_-]*encontrad/i.test(message)
  }

  private hasNotFoundSignal(value: string): boolean {
    return /HTTP 404|NOT_FOUND|not[\s_-]*found|nao[\s_-]*encontrad/i.test(String(value ?? ""))
  }

  private async classifySourceReadbackState(
    sourceId: string,
    timeoutMs: number
  ): Promise<"exists" | "not_found" | "unknown"> {
    const normalizedSourceId = String(sourceId ?? "").trim()
    if (!normalizedSourceId) {
      return "not_found"
    }

    try {
      const snapshot = await this.withTimeout(
        this.getSourceContentSnapshot(normalizedSourceId),
        Math.max(350, timeoutMs),
        "STRICT_DELETE_READBACK_TIMEOUT"
      )
      const normalizedSnapshot = String(snapshot ?? "").trim()
      // Guard against false positives: user content may contain words like "not found".
      // Treat snapshot text as not-found signal only when it looks like a short RPC error payload.
      if (normalizedSnapshot.length > 0 && normalizedSnapshot.length <= 280 && this.hasNotFoundSignal(normalizedSnapshot)) {
        return "not_found"
      }
      return "exists"
    } catch (error) {
      if (this.isDeleteSourceNotFoundError(error)) {
        return "not_found"
      }
      const message = error instanceof Error ? error.message : String(error ?? "")
      if (this.hasNotFoundSignal(message)) {
        return "not_found"
      }
      return "unknown"
    }
  }

  private isAuthError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? "")
    return /HTTP 400|HTTP 401|HTTP 403|autentic|token|login|sessao|HTML em vez de JSON/i.test(message)
  }

  private buildDeletePayloadCandidates(
    normalizedNotebookId: string,
    normalizedSourceId: string
  ): unknown[][] {
    return [
      [
        normalizedNotebookId,
        null,
        [[normalizedSourceId, null, null, null, null, null, null, null, null, null, 1]]
      ],
      [
        [[normalizedSourceId, null, null, null, null, null, null, null, null, null, 1]],
        normalizedNotebookId,
        [2]
      ],
      [
        [[normalizedSourceId, null, null, null, null, null, null, null, null, null, 1]],
        normalizedNotebookId
      ],
      [normalizedNotebookId, [normalizedSourceId], [2]],
      [normalizedNotebookId, null, [[normalizedSourceId]]],
      [normalizedNotebookId, null, [[normalizedSourceId, null]]],
      [normalizedNotebookId, null, [[normalizedSourceId, null, null]]],
      [
        [
          [
            normalizedSourceId,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            3
          ]
        ],
        normalizedNotebookId,
        [2]
      ],
      [
        [
          [
            normalizedSourceId,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            2
          ]
        ],
        normalizedNotebookId,
        [2]
      ]
    ]
  }

  private buildDeleteSourceRpcPayloadCandidates(
    normalizedNotebookId: string,
    normalizedSourceId: string
  ): unknown[][] {
    const sourceEntry = [[normalizedSourceId]]
    const sourceIds = [normalizedSourceId]

    return [
      [sourceEntry, [2]],
      [sourceEntry],
      [[normalizedSourceId], [2]],
      [[normalizedSourceId]],
      [normalizedNotebookId, [[normalizedSourceId]], [2]],
      [sourceIds, [2]],
      [sourceIds],
      [normalizedNotebookId, sourceIds, [2]],
      [normalizedNotebookId, sourceIds],
      [normalizedNotebookId, { sourceIds }, [2]],
      [normalizedNotebookId, { sourceIds }],
      [{ notebookId: normalizedNotebookId, sourceIds }, [2]],
      [{ notebookId: normalizedNotebookId, sourceIds }]
    ]
  }

  private async deleteSourceRpcOnly(
    normalizedNotebookId: string,
    normalizedSourceId: string
  ): Promise<DeleteSourceRpcOutcome> {
    const modernDeletePayloadCandidates = this.buildDeleteSourceRpcPayloadCandidates(
      normalizedNotebookId,
      normalizedSourceId
    )
    const legacyDeletePayloadCandidates = this.buildDeletePayloadCandidates(
      normalizedNotebookId,
      normalizedSourceId
    )
    const sourcePathCandidates = [`/notebook/${normalizedNotebookId}`, DEFAULT_SOURCE_PATH]
    let lastError: Error | null = null
    let acceptedOutcome: DeleteSourceRpcOutcome | null = null
    let candidateIndex = 0

    for (const sourcePath of sourcePathCandidates) {
      for (const payloadCandidate of modernDeletePayloadCandidates) {
        candidateIndex += 1
        try {
          const responseText = await this.executeRpc(DELETE_SOURCE_RPC_ID, payloadCandidate, sourcePath)
          this.assertDeleteSourceResponseAccepted(responseText)
          acceptedOutcome = {
            payloadVariant: "tGMBJ",
            sourcePath,
            candidateIndex
          }
        } catch (error) {
          if (this.isDeleteSourceNotFoundError(error)) {
            if (acceptedOutcome) {
              continue
            }
            return {
              payloadVariant: "tGMBJ",
              sourcePath,
              candidateIndex
            }
          }
          lastError =
            error instanceof Error
              ? error
              : new Error("Falha ao acionar RPC dedicado de delecao da fonte.")
        }
      }
    }

    for (const sourcePath of sourcePathCandidates) {
      for (const payloadCandidate of legacyDeletePayloadCandidates) {
        candidateIndex += 1
        try {
          const responseText = await this.executeRpc(DELETE_SOURCE_RPC_ID, payloadCandidate, sourcePath)
          this.assertDeleteSourceResponseAccepted(responseText)
          acceptedOutcome = {
            payloadVariant: "legacy",
            sourcePath,
            candidateIndex
          }
        } catch (error) {
          if (this.isDeleteSourceNotFoundError(error)) {
            if (acceptedOutcome) {
              continue
            }
            return {
              payloadVariant: "legacy",
              sourcePath,
              candidateIndex
            }
          }
          lastError =
            error instanceof Error ? error : new Error("Falha ao acionar RPC de delecao da fonte.")
        }
      }
    }

    if (acceptedOutcome) {
      return acceptedOutcome
    }

    if (lastError) {
      throw lastError
    }

    throw new Error("Falha ao acionar RPC de delecao da fonte.")
  }

  private decodeToken(rawValue: string): string {
    const normalizedValue = String(rawValue ?? "").trim()
    if (!normalizedValue) {
      return ""
    }

    return normalizedValue
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16))
      )
  }

  private buildBootstrapUrl(authUser: string | null): string {
    const url = new URL(NOTEBOOKLM_BOOTSTRAP_URL)
    if (authUser) {
      url.searchParams.set("authuser", authUser)
    }
    return url.toString()
  }

  private async readPreferredAuthUserFromStorage(): Promise<string | null> {
    if (!chrome.storage?.local?.get) {
      return null
    }

    try {
      const snapshot = await chrome.storage.local.get([FIXED_AUTH_USER_KEY, TOKEN_STORAGE_KEY])
      const fixedAuthUser = normalizeAuthUser(snapshot[FIXED_AUTH_USER_KEY])
      if (fixedAuthUser) {
        return fixedAuthUser
      }

      const session = snapshot[TOKEN_STORAGE_KEY]
      if (session && typeof session === "object") {
        return normalizeAuthUser((session as { authUser?: unknown }).authUser)
      }

      return null
    } catch {
      return null
    }
  }

  private async readPreferredAccountEmailFromStorage(): Promise<string | null> {
    if (!chrome.storage?.local?.get) {
      return null
    }

    try {
      const snapshot = await chrome.storage.local.get([FIXED_ACCOUNT_EMAIL_KEY, TOKEN_STORAGE_KEY])
      const fixedAccountEmail = normalizeAccountEmail(snapshot[FIXED_ACCOUNT_EMAIL_KEY])
      if (fixedAccountEmail) {
        return fixedAccountEmail
      }

      const session = snapshot[TOKEN_STORAGE_KEY]
      if (session && typeof session === "object") {
        return normalizeAccountEmail((session as { accountEmail?: unknown }).accountEmail)
      }

      return null
    } catch {
      return null
    }
  }

  private extractAuthTokensFromHtml(
    html: string,
    authUser: string | null = null,
    accountEmail: string | null = null
  ): NotebookLMAuthTokens | null {
    const atMatch = html.match(/"SNlM0e":"([^"]+)"/)
    const blMatch = html.match(/"cfb2h":"([^"]+)"/)

    const at = this.decodeToken(atMatch?.[1] ?? "")
    const bl = this.decodeToken(blMatch?.[1] ?? "")

    if (!at || !bl) {
      return null
    }

    return {
      at,
      bl,
      authUser: normalizeAuthUser(authUser),
      accountEmail: normalizeAccountEmail(accountEmail)
    }
  }

  private async readAuthTokensFromOpenNotebookTab(): Promise<NotebookLMAuthTokens | null> {
    if (!chrome.tabs?.query || !chrome.scripting?.executeScript) {
      return null
    }

    try {
      const tabs = await chrome.tabs.query({})
      const notebookTab = tabs.find((tab) =>
        String(tab.url ?? "").startsWith(NOTEBOOKLM_BASE_URL)
      )

      if (typeof notebookTab?.id !== "number") {
        return null
      }

      const [executionResult] = await chrome.scripting.executeScript({
        target: { tabId: notebookTab.id },
        func: () => {
          const normalizeString = (value: unknown): string => String(value ?? "").trim()
          const normalizeAccountEmail = (value: unknown): string => {
            const normalizedValue = normalizeString(value).toLowerCase()
            if (!normalizedValue) {
              return ""
            }

            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalizedValue) ? normalizedValue : ""
          }
          const extractAccountEmail = (value: unknown): string => {
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
          const resolveAccountEmailFromDom = (): string => {
            const accountElement = document.querySelector("a[aria-label*='@'], button[aria-label*='@']")
            if (!(accountElement instanceof HTMLElement)) {
              return ""
            }

            return extractAccountEmail(accountElement.getAttribute("aria-label"))
          }
          const resolveAccountEmailFromWizGlobalData = (): string => {
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

          const globalWindow = window as typeof window & Record<string, unknown>
          const rawWizGlobalData = globalWindow.WIZ_global_data
          if (!rawWizGlobalData || typeof rawWizGlobalData !== "object") {
            return null
          }

          const wizGlobalData = rawWizGlobalData as Record<string, unknown>
          const at = String(wizGlobalData.SNlM0e ?? "").trim()
          const bl = String(wizGlobalData.cfb2h ?? "").trim()
          const authUser = (() => {
            try {
              return String(new URL(window.location.href).searchParams.get("authuser") ?? "").trim()
            } catch {
              return ""
            }
          })()
          const accountEmail = resolveAccountEmailFromDom() || resolveAccountEmailFromWizGlobalData()

          if (!at || !bl) {
            return null
          }

          return { at, bl, authUser, accountEmail }
        }
      })

      const rawTokens =
        executionResult && typeof executionResult.result === "object" && executionResult.result !== null
          ? (executionResult.result as {
              at?: unknown
              bl?: unknown
              authUser?: unknown
              accountEmail?: unknown
            })
          : null

      const at = this.decodeToken(String(rawTokens?.at ?? ""))
      const bl = this.decodeToken(String(rawTokens?.bl ?? ""))
      const authUser = normalizeAuthUser(rawTokens?.authUser)
      const accountEmail = normalizeAccountEmail(rawTokens?.accountEmail)

      if (!at || !bl) {
        return null
      }

      return { at, bl, authUser, accountEmail }
    } catch {
      return null
    }
  }

  private async resolveAuthUserForAccountEmail(accountEmail: string): Promise<string | null> {
    const normalizedAccountEmail = normalizeAccountEmail(accountEmail)
    if (!normalizedAccountEmail || !chrome.tabs?.query || !chrome.scripting?.executeScript) {
      return null
    }

    try {
      const tabs = await chrome.tabs.query({})
      const notebookTabs = tabs.filter((tab) => String(tab.url ?? "").startsWith(NOTEBOOKLM_BASE_URL))

      for (const tab of notebookTabs) {
        if (typeof tab.id !== "number") {
          continue
        }

        const [executionResult] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const normalizeString = (value: unknown): string => String(value ?? "").trim()
            const normalizeAccountEmail = (value: unknown): string => {
              const normalizedValue = normalizeString(value).toLowerCase()
              if (!normalizedValue) {
                return ""
              }

              return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalizedValue) ? normalizedValue : ""
            }
            const extractAccountEmail = (value: unknown): string => {
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
            const resolveAccountEmailFromDom = (): string => {
              const accountElement = document.querySelector("a[aria-label*='@'], button[aria-label*='@']")
              if (!(accountElement instanceof HTMLElement)) {
                return ""
              }

              return extractAccountEmail(accountElement.getAttribute("aria-label"))
            }
            const resolveAccountEmailFromWizGlobalData = (): string => {
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

            const authUser = (() => {
              try {
                return String(new URL(window.location.href).searchParams.get("authuser") ?? "").trim()
              } catch {
                return ""
              }
            })()

            const accountEmail = resolveAccountEmailFromDom() || resolveAccountEmailFromWizGlobalData()
            return { authUser, accountEmail }
          }
        })

        const rawResult =
          executionResult && typeof executionResult.result === "object" && executionResult.result !== null
            ? (executionResult.result as { authUser?: unknown; accountEmail?: unknown })
            : null

        const tabAccountEmail = normalizeAccountEmail(rawResult?.accountEmail)
        const tabAuthUser = normalizeAuthUser(rawResult?.authUser)
        if (tabAccountEmail === normalizedAccountEmail && tabAuthUser) {
          return tabAuthUser
        }
      }
    } catch {
      return null
    }

    return null
  }

  private async readAuthTokensFromStorage(): Promise<NotebookLMAuthTokens | null> {
    if (!chrome.storage?.local?.get) {
      return null
    }

    try {
      const snapshot = await chrome.storage.local.get([
        TOKEN_STORAGE_KEY,
        FIXED_AT_TOKEN_KEY,
        FIXED_BL_TOKEN_KEY,
        FIXED_AUTH_USER_KEY,
        FIXED_ACCOUNT_EMAIL_KEY
      ])

      const sessionValue = snapshot[TOKEN_STORAGE_KEY]
      const sessionTokens =
        sessionValue && typeof sessionValue === "object"
          ? (sessionValue as {
              at?: unknown
              bl?: unknown
              authUser?: unknown
              accountEmail?: unknown
            })
          : {}

      const sessionAt = this.decodeToken(String(sessionTokens.at ?? ""))
      const sessionBl = this.decodeToken(String(sessionTokens.bl ?? ""))
      const sessionAuthUser = normalizeAuthUser(sessionTokens.authUser)
      const sessionAccountEmail = normalizeAccountEmail(sessionTokens.accountEmail)
      const fixedAuthUser = normalizeAuthUser(snapshot[FIXED_AUTH_USER_KEY])
      const fixedAccountEmail = normalizeAccountEmail(snapshot[FIXED_ACCOUNT_EMAIL_KEY])
      const resolvedAuthUser = sessionAuthUser ?? fixedAuthUser
      const resolvedAccountEmail = sessionAccountEmail ?? fixedAccountEmail

      if (sessionAt && sessionBl) {
        return {
          at: sessionAt,
          bl: sessionBl,
          authUser: resolvedAuthUser,
          accountEmail: resolvedAccountEmail
        }
      }

      const fixedAt = this.decodeToken(String(snapshot[FIXED_AT_TOKEN_KEY] ?? ""))
      const fixedBl = this.decodeToken(String(snapshot[FIXED_BL_TOKEN_KEY] ?? ""))
      if (!fixedAt || !fixedBl) {
        return null
      }

      return {
        at: fixedAt,
        bl: fixedBl,
        authUser: resolvedAuthUser,
        accountEmail: resolvedAccountEmail
      }
    } catch {
      return null
    }
  }

  private async getAuthTokens(forceRefresh = false): Promise<NotebookLMAuthTokens> {
    if (!forceRefresh && this.cachedTokens) {
      return this.cachedTokens
    }

    const preferredAccountEmail = await this.readPreferredAccountEmailFromStorage()
    let preferredAuthUser = await this.readPreferredAuthUserFromStorage()

    if (!preferredAuthUser && preferredAccountEmail) {
      preferredAuthUser = await this.resolveAuthUserForAccountEmail(preferredAccountEmail)
      if (preferredAuthUser && chrome.storage?.local?.set) {
        try {
          await chrome.storage.local.set({
            [FIXED_AUTH_USER_KEY]: preferredAuthUser
          })
        } catch {
          // no-op
        }
      }
    }

    const isPreferredAccountMatch = (tokens: Partial<NotebookLMAuthTokens> | null): boolean => {
      if (!tokens) {
        return false
      }

      if (!preferredAccountEmail) {
        return true
      }

      const tokenAccountEmail = normalizeAccountEmail(tokens.accountEmail)
      return tokenAccountEmail === preferredAccountEmail
    }

    const finalizeResolvedTokens = async (
      candidate: NotebookLMAuthTokens | null,
      fallbackAuthUser: string | null,
      fallbackAccountEmail: string | null
    ): Promise<NotebookLMAuthTokens | null> => {
      if (!candidate) {
        return null
      }

      const resolvedAccountEmail =
        normalizeAccountEmail(candidate.accountEmail) ?? normalizeAccountEmail(fallbackAccountEmail)
      if (preferredAccountEmail && resolvedAccountEmail !== preferredAccountEmail) {
        return null
      }

      let resolvedAuthUser = normalizeAuthUser(candidate.authUser) ?? normalizeAuthUser(fallbackAuthUser)
      if (preferredAccountEmail && !resolvedAuthUser) {
        resolvedAuthUser = await this.resolveAuthUserForAccountEmail(preferredAccountEmail)
        if (resolvedAuthUser && chrome.storage?.local?.set) {
          try {
            await chrome.storage.local.set({
              [FIXED_AUTH_USER_KEY]: resolvedAuthUser
            })
          } catch {
            // no-op
          }
        }
      }

      return {
        ...candidate,
        accountEmail: resolvedAccountEmail ?? null,
        authUser: resolvedAuthUser ?? null
      }
    }

    if (!forceRefresh) {
      const persistedTokens = await this.readAuthTokensFromStorage()
      if (persistedTokens && isPreferredAccountMatch(persistedTokens)) {
        const candidate: NotebookLMAuthTokens = {
          ...persistedTokens,
          authUser: persistedTokens.authUser ?? preferredAuthUser,
          accountEmail: persistedTokens.accountEmail ?? preferredAccountEmail
        }
        const resolved = await finalizeResolvedTokens(
          candidate,
          preferredAuthUser,
          preferredAccountEmail
        )
        if (resolved) {
          this.cachedTokens = resolved
          return resolved
        }
      }
    }

    let response: Response

    try {
      response = await fetch(this.buildBootstrapUrl(preferredAuthUser), {
        credentials: "include",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      })
    } catch {
      const fallbackTokens = await this.readAuthTokensFromOpenNotebookTab()
      if (fallbackTokens && isPreferredAccountMatch(fallbackTokens)) {
        const candidate: NotebookLMAuthTokens = {
          ...fallbackTokens,
          authUser: fallbackTokens.authUser ?? preferredAuthUser,
          accountEmail: fallbackTokens.accountEmail ?? preferredAccountEmail
        }
        const resolved = await finalizeResolvedTokens(
          candidate,
          preferredAuthUser,
          preferredAccountEmail
        )
        if (resolved) {
          this.cachedTokens = resolved
          return resolved
        }
      }

      const persistedTokens = await this.readAuthTokensFromStorage()
      if (persistedTokens && isPreferredAccountMatch(persistedTokens)) {
        const candidate: NotebookLMAuthTokens = {
          ...persistedTokens,
          authUser: persistedTokens.authUser ?? preferredAuthUser,
          accountEmail: persistedTokens.accountEmail ?? preferredAccountEmail
        }
        const resolved = await finalizeResolvedTokens(
          candidate,
          preferredAuthUser,
          preferredAccountEmail
        )
        if (resolved) {
          this.cachedTokens = resolved
          return resolved
        }
      }

      throw new AuthError("Nao foi possivel validar a sessao do NotebookLM. Tente novamente.")
    }

    const responseAuthUser = resolveAuthUserFromUrl(String(response.url ?? ""))
    const resolvedAuthUser = preferredAuthUser ?? responseAuthUser ?? null
    const resolvedAccountEmail = preferredAccountEmail ?? null

    const redirectedToLogin =
      String(response.url ?? "").includes("accounts.google.com") ||
      (response.redirected && String(response.url ?? "").includes("ServiceLogin"))

    if (!response.ok || redirectedToLogin) {
      const persistedTokens = await this.readAuthTokensFromStorage()
      if (persistedTokens && isPreferredAccountMatch(persistedTokens)) {
        const candidate: NotebookLMAuthTokens = {
          ...persistedTokens,
          authUser: persistedTokens.authUser ?? resolvedAuthUser,
          accountEmail: persistedTokens.accountEmail ?? resolvedAccountEmail
        }
        const resolved = await finalizeResolvedTokens(
          candidate,
          resolvedAuthUser,
          resolvedAccountEmail
        )
        if (resolved) {
          this.cachedTokens = resolved
          return resolved
        }
      }

      throw new AuthError("Faca login no NotebookLM para continuar.")
    }

    const html = await response.text()
    const extractedTokens = this.extractAuthTokensFromHtml(
      html,
      resolvedAuthUser,
      resolvedAccountEmail
    )
    if (extractedTokens) {
      const resolved = await finalizeResolvedTokens(
        extractedTokens,
        resolvedAuthUser,
        resolvedAccountEmail
      )
      if (resolved) {
        this.cachedTokens = resolved
        return resolved
      }
    }

    const fallbackTokens = await this.readAuthTokensFromOpenNotebookTab()
    if (fallbackTokens && isPreferredAccountMatch(fallbackTokens)) {
      const candidate: NotebookLMAuthTokens = {
        ...fallbackTokens,
        authUser: fallbackTokens.authUser ?? resolvedAuthUser,
        accountEmail: fallbackTokens.accountEmail ?? resolvedAccountEmail
      }
      const resolved = await finalizeResolvedTokens(
        candidate,
        resolvedAuthUser,
        resolvedAccountEmail
      )
      if (resolved) {
        this.cachedTokens = resolved
        return resolved
      }
    }

    const persistedTokens = await this.readAuthTokensFromStorage()
    if (persistedTokens && isPreferredAccountMatch(persistedTokens)) {
      const candidate: NotebookLMAuthTokens = {
        ...persistedTokens,
        authUser: persistedTokens.authUser ?? resolvedAuthUser,
        accountEmail: persistedTokens.accountEmail ?? resolvedAccountEmail
      }
      const resolved = await finalizeResolvedTokens(
        candidate,
        resolvedAuthUser,
        resolvedAccountEmail
      )
      if (resolved) {
        this.cachedTokens = resolved
        return resolved
      }
    }

    throw new AuthError("Nao foi possivel localizar os tokens de autenticacao do NotebookLM.")
  }

  async refreshAuthTokens(): Promise<void> {
    this.cachedTokens = null
    await this.getAuthTokens(true)
  }

  private nextRequestId(): string {
    return String(Math.floor(Math.random() * 900_000) + 100_000)
  }

  private buildRpcUrl(
    rpcId: string,
    blToken: string,
    sourcePath = DEFAULT_SOURCE_PATH,
    authUser?: string | null
  ): string {
    const upstreamUrl = new URL(NOTEBOOKLM_RPC_ENDPOINT)
    upstreamUrl.searchParams.set("rpcids", rpcId)
    upstreamUrl.searchParams.set("source-path", sourcePath || DEFAULT_SOURCE_PATH)
    upstreamUrl.searchParams.set("bl", blToken)
    upstreamUrl.searchParams.set("_reqid", this.nextRequestId())
    upstreamUrl.searchParams.set("rt", "c")
    upstreamUrl.searchParams.set("authuser", "0")

    const normalizedAuthUser = normalizeAuthUser(authUser)
    if (normalizedAuthUser) {
      upstreamUrl.searchParams.set("authuser", normalizedAuthUser)
    }

    return upstreamUrl.toString()
  }

  private stripXssiPrefix(responseText: string): string {
    return String(responseText ?? "")
      .replace(/^\)\]\}'\s*/, "")
      .trim()
  }

  private parseJsonSegments(responseText: string): unknown[] {
    const sanitizedResponse = this.stripXssiPrefix(responseText)
    if (!sanitizedResponse) {
      return []
    }

    const parsedSegments: unknown[] = []
    for (const rawLine of sanitizedResponse.split("\n")) {
      const line = rawLine.trim()
      if (!line || (!line.startsWith("[") && !line.startsWith("{"))) {
        continue
      }

      try {
        parsedSegments.push(JSON.parse(line))
      } catch {
        // Ignore individual non-JSON framing lines.
      }
    }

    if (parsedSegments.length > 0) {
      return parsedSegments
    }

    try {
      return [JSON.parse(sanitizedResponse)]
    } catch {
      return []
    }
  }

  private tryParseJson(value: string): unknown | null {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }

  private parsePossiblyEncodedPayload(value: unknown): unknown {
    if (typeof value !== "string") {
      return value
    }

    const parsed = this.tryParseJson(value)
    return parsed ?? value
  }

  private extractPayloadByRpc(node: unknown, rpcId: string): unknown | undefined {
    const queue: unknown[] = [node]
    const seen = new Set<unknown>()

    while (queue.length > 0) {
      const current = queue.shift()
      if (current === null || current === undefined) {
        continue
      }

      if (typeof current !== "object" && !Array.isArray(current)) {
        continue
      }

      if (seen.has(current)) {
        continue
      }

      seen.add(current)

      if (Array.isArray(current)) {
        if (current[0] === "wrb.fr") {
          const itemRpcId = this.pickString(current[1])
          if (itemRpcId === rpcId) {
            return this.parsePossiblyEncodedPayload(current[2])
          }
        }

        if (this.pickString(current[0]) === rpcId) {
          return this.parsePossiblyEncodedPayload(current[2] ?? current[1])
        }

        queue.push(...current)
      } else {
        queue.push(...Object.values(current))
      }
    }

    return undefined
  }

  private parseBatchExecutePayload(responseText: string, rpcId: string): unknown {
    const sanitizedResponse = this.stripXssiPrefix(responseText)
    const lines = sanitizedResponse.split("\n")
    const line3 = String(lines[3] ?? "").trim()

    if (line3) {
      const parsedLine3 = this.tryParseJson(line3)
      if (parsedLine3 !== null) {
        const payloadFromLine3 = this.extractPayloadByRpc(parsedLine3, rpcId)
        if (payloadFromLine3 !== undefined) {
          return payloadFromLine3
        }
      }
    }

    for (const line of lines) {
      const trimmedLine = line.trim()
      if (!trimmedLine || !trimmedLine.startsWith("[")) {
        continue
      }

      const parsedLine = this.tryParseJson(trimmedLine)
      if (parsedLine === null) {
        continue
      }

      const payloadFromLine = this.extractPayloadByRpc(parsedLine, rpcId)
      if (payloadFromLine !== undefined) {
        return payloadFromLine
      }
    }

    throw new NotebookLMRpcError(`Resposta batchexecute invalida para RPC ${rpcId}.`)
  }

  private hasStructuredPayload(value: unknown): boolean {
    if (value === null || value === undefined) {
      return false
    }

    if (Array.isArray(value)) {
      return value.length > 0
    }

    if (typeof value === "object") {
      return Object.keys(value as Record<string, unknown>).length > 0
    }

    if (typeof value === "string") {
      return value.trim().length > 0
    }

    return true
  }

  private payloadIndicatesRpcFailure(payload: unknown): boolean {
    const queue: unknown[] = [payload]
    const seen = new Set<unknown>()
    const statusFailurePattern =
      /\b(INTERNAL|INTERNAL_ERROR|INVALID_ARGUMENT|PERMISSION_DENIED|FAILED_PRECONDITION|NOT_FOUND|UNAUTHENTICATED|ERROR|FAILED)\b/i
    const errorKeyPattern = /(^|_)(error|errors|exception|failure|failed)$/i
    const statusKeyPattern = /(^|_)(status)$/i
    const codeKeyPattern = /(^|_)(code)$/i
    const successKeyPattern = /(^|_)(success|ok)$/i

    while (queue.length > 0) {
      const current = queue.shift()
      if (current === null || current === undefined) {
        continue
      }

      if (typeof current === "string") {
        const parsedJson = this.tryParseJson(current.trim())
        if (parsedJson !== null) {
          queue.push(parsedJson)
        }
        continue
      }

      if (typeof current !== "object") {
        continue
      }

      if (seen.has(current)) {
        continue
      }
      seen.add(current)

      if (Array.isArray(current)) {
        // Detecta padrão ["wrb.fr", rpcId, null, null, null, [3], "generic"]
        // onde índice 5 = [3] indica erro silencioso do NotebookLM.
        if (
          current.length >= 6 &&
          typeof current[0] === "string" &&
          current[0] === "wrb.fr" &&
          Array.isArray(current[5]) &&
          current[5][0] === 3
        ) {
          return true
        }
        queue.push(...current)
        continue
      }

      const entries = Object.entries(current as Record<string, unknown>)
      for (const [key, value] of entries) {
        const normalizedKey = key.trim()
        if (errorKeyPattern.test(normalizedKey)) {
          if (typeof value === "string" && value.trim().length > 0) {
            return true
          }
          if (typeof value === "object" && value !== null) {
            return true
          }
        }

        if (statusKeyPattern.test(normalizedKey) && typeof value === "string") {
          if (statusFailurePattern.test(value.trim())) {
            return true
          }
        }

        if (codeKeyPattern.test(normalizedKey)) {
          if (typeof value === "number" && Number.isFinite(value) && value >= 400) {
            return true
          }

          if (typeof value === "string") {
            const trimmedCode = value.trim()
            const numericCode = Number.parseInt(trimmedCode, 10)
            if (Number.isFinite(numericCode) && numericCode >= 400) {
              return true
            }
            if (statusFailurePattern.test(trimmedCode)) {
              return true
            }
          }
        }

        if (successKeyPattern.test(normalizedKey) && value === false) {
          return true
        }

        queue.push(value)
      }
    }

    return false
  }

  private assertInsertSourceResponseAccepted(responseText: string): void {
    const sanitizedResponse = this.stripXssiPrefix(responseText)
    const parsedSegments = this.parseJsonSegments(sanitizedResponse)
    if (parsedSegments.length === 0) {
      throw new Error("NotebookLM rejected the upload payload.")
    }

    let rpcPayload: unknown
    try {
      rpcPayload = this.parseBatchExecutePayload(sanitizedResponse, ADD_SOURCE_RPC_ID)
    } catch {
      throw new Error("NotebookLM rejected the upload payload.")
    }

    if (!this.hasStructuredPayload(rpcPayload)) {
      throw new Error("NotebookLM rejected the upload payload.")
    }

    if (this.payloadIndicatesRpcFailure(rpcPayload)) {
      throw new Error("NotebookLM rejected the upload payload.")
    }
  }

  private assertDeleteSourceResponseAccepted(responseText: string): void {
    const sanitizedResponse = this.stripXssiPrefix(responseText)
    let rpcPayload: unknown
    try {
      rpcPayload = this.parseBatchExecutePayload(sanitizedResponse, DELETE_SOURCE_RPC_ID)
    } catch {
      throw new Error("NotebookLM rejected the delete payload.")
    }

    if (this.payloadIndicatesRpcFailure(rpcPayload)) {
      throw new Error("NotebookLM rejected the delete payload.")
    }

    // Detecta rejeição silenciosa via status [3] no array de resposta.
    // Ex.: ["wrb.fr","tGMBJ",null,null,null,[3],"generic"].
    if (Array.isArray(rpcPayload)) {
      const statusEntry = rpcPayload[5]
      if (Array.isArray(statusEntry) && statusEntry[0] === 3) {
        throw new Error("NotebookLM rejected delete: status code [3] indicates failure.")
      }
    }
  }

  private pickString(...values: unknown[]): string | null {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) {
        return value.trim()
      }
    }

    return null
  }

  private normalizeTitleKey(value: string): string {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
  }

  private extractGoogleDocId(value: string): string {
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

  private buildSyncGoogleDocPayloadCandidates(
    notebookId: string,
    docId: string,
    sourceTitle: string
  ): unknown[][] {
    const docDescriptor = [docId, GOOGLE_DOCS_MIME_TYPE, sourceTitle]

    return [
      [docId, GOOGLE_DOCS_MIME_TYPE, sourceTitle, notebookId],
      [docId, sourceTitle, notebookId, GOOGLE_DOCS_MIME_TYPE],
      [notebookId, docId, GOOGLE_DOCS_MIME_TYPE, sourceTitle],
      [notebookId, sourceTitle, docId, GOOGLE_DOCS_MIME_TYPE],
      [notebookId, docDescriptor, [2]],
      [[docDescriptor], notebookId, [2]],
      [
        [
          [
            null,
            [sourceTitle, docId],
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
        notebookId,
        [2]
      ],
      [
        [
          [
            null,
            [sourceTitle, docId, GOOGLE_DOCS_MIME_TYPE],
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
        notebookId,
        [2]
      ],
      [
        notebookId,
        null,
        [[docId, null, sourceTitle, GOOGLE_DOCS_MIME_TYPE]]
      ],
      [
        notebookId,
        null,
        [[docId, sourceTitle, GOOGLE_DOCS_MIME_TYPE]]
      ],
      [
        {
          notebookId,
          sourceTitle,
          source: {
            docId,
            mimeType: GOOGLE_DOCS_MIME_TYPE
          }
        }
      ],
      [
        {
          notebookId,
          docId,
          mimeType: GOOGLE_DOCS_MIME_TYPE,
          title: sourceTitle
        }
      ]
    ]
  }

  private assertSyncGoogleDocResponseAccepted(responseText: string): void {
    const sanitizedResponse = this.stripXssiPrefix(responseText)
    const parsedSegments = this.parseJsonSegments(sanitizedResponse)
    if (parsedSegments.length === 0) {
      throw new Error("NotebookLM rejeitou o payload de Google Docs.")
    }

    for (const segment of parsedSegments) {
      if (this.payloadIndicatesRpcFailure(segment)) {
        throw new Error("NotebookLM rejeitou o payload de Google Docs.")
      }
    }

    try {
      const rpcPayload = this.parseBatchExecutePayload(sanitizedResponse, SYNC_GDOC_RPC_ID)
      if (this.payloadIndicatesRpcFailure(rpcPayload)) {
        throw new Error("NotebookLM rejeitou o payload de Google Docs.")
      }

      if (Array.isArray(rpcPayload)) {
        const statusEntry = rpcPayload[5]
        if (Array.isArray(statusEntry) && statusEntry[0] === 3) {
          throw new Error("NotebookLM rejeitou Google Docs: status [3].")
        }
      }
    } catch {
      // Some NotebookLM variants omit a parseable rpc payload for FLmJqe.
      // If no explicit failure was detected in parsed segments, treat as accepted.
    }
  }

  private normalizeContentKey(value: string): string {
    return String(value ?? "")
      .replace(/\r/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  }

  private scoreNotebookTitle(value: string): number {
    const normalizedValue = String(value ?? "").trim()
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

  private upsertNotebookCandidate(
    output: Map<string, NotebookListEntry>,
    notebook: NotebookListEntry
  ): void {
    const existingNotebook = output.get(notebook.id)
    if (!existingNotebook) {
      output.set(notebook.id, notebook)
      return
    }

    if (this.scoreNotebookTitle(notebook.title) > this.scoreNotebookTitle(existingNotebook.title)) {
      output.set(notebook.id, notebook)
    }
  }

  private parseEmbeddedJson(value: string, parsedStrings: Set<string>): unknown | null {
    const normalizedValue = String(value ?? "").trim()
    if (!normalizedValue || parsedStrings.has(normalizedValue)) {
      return null
    }

    const looksLikeJson =
      (normalizedValue.startsWith("[") && normalizedValue.endsWith("]")) ||
      (normalizedValue.startsWith("{") && normalizedValue.endsWith("}"))

    if (!looksLikeJson) {
      return null
    }

    parsedStrings.add(normalizedValue)

    try {
      return JSON.parse(normalizedValue)
    } catch {
      return null
    }
  }

  private extractNotebookFromArray(candidate: readonly unknown[]): NotebookListEntry | null {
    if (!Array.isArray(candidate) || candidate.length < 3) {
      return null
    }

    const potentialTitle = candidate[0]
    const potentialId = candidate[2]

    if (typeof potentialTitle !== "string" || typeof potentialId !== "string") {
      return null
    }

    const notebookTitle = potentialTitle.trim()
    const notebookId = potentialId.trim()
    const normalizedNotebookId = notebookId.toLowerCase()
    const notebookTitleKey = this.normalizeNotebookTitleKey(notebookTitle)

    if (!notebookTitle || notebookTitle === "generic") {
      return null
    }

    if (BLOCKED_NOTEBOOK_TITLE_KEYS.has(notebookTitleKey)) {
      return null
    }

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

    if (notebookId.includes(" ") || notebookId.startsWith("-") || /^\d+$/u.test(notebookId)) {
      return null
    }

    if (notebookTitle.includes(".") && notebookTitle.length < 10) {
      return null
    }

    return {
      id: notebookId,
      title: notebookTitle
    }
  }

  private extractNotebookPathHints(rawResponseText: string): Set<string> {
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
        const candidateId = String(match[1] ?? "").trim()
        if (candidateId) {
          hints.add(candidateId)
        }
      }
    }

    return hints
  }

  private resolveNotebookRows(payload: unknown): unknown[][] {
    const byContract = (payload as { 0?: { 1?: unknown } } | undefined)?.[0]?.[1]
    if (Array.isArray(byContract) && byContract.every((entry) => Array.isArray(entry))) {
      return byContract as unknown[][]
    }

    return this.resolveRowsFromPayload(payload)
  }

  private findNotebooksInValue(value: unknown, rawResponseText?: string): NotebookListEntry[] {
    const notebooks = new Map<string, NotebookListEntry>()
    const notebookPathHints = this.extractNotebookPathHints(String(rawResponseText ?? ""))
    const notebookRows = this.resolveNotebookRows(value)

    for (const row of notebookRows) {
      const notebookCandidate = this.extractNotebookFromArray(row)
      if (!notebookCandidate) {
        continue
      }

      if (notebookPathHints.size > 0 && !notebookPathHints.has(notebookCandidate.id)) {
        continue
      }

      this.upsertNotebookCandidate(notebooks, notebookCandidate)
    }

    if (notebooks.size > 0) {
      return Array.from(notebooks.values())
    }

    const seenObjects = new WeakSet<object>()
    const parsedStrings = new Set<string>()

    const visit = (node: unknown): void => {
      if (typeof node === "string") {
        const embeddedJson = this.parseEmbeddedJson(node, parsedStrings)
        if (embeddedJson !== null) {
          visit(embeddedJson)
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
        const notebookCandidate = this.extractNotebookFromArray(node)
        if (notebookCandidate) {
          if (notebookPathHints.size === 0 || notebookPathHints.has(notebookCandidate.id)) {
            this.upsertNotebookCandidate(notebooks, notebookCandidate)
          }
        }

        for (const item of node) {
          visit(item)
        }
        return
      }

      for (const nestedValue of Object.values(node)) {
        visit(nestedValue)
      }
    }

    visit(value)
    return Array.from(notebooks.values())
  }

  private buildContentVerificationMarkers(content: string): string[] {
    const lines = String(content ?? "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) {
          return false
        }
        if (/^[-=_]{3,}$/u.test(line)) {
          return false
        }
        return true
      })

    if (lines.length === 0) {
      return []
    }

    const toMarker = (value: string): string =>
      this.normalizeContentKey(value)
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180)

    const pickLongestLine = (candidates: string[]): string => {
      let best = ""
      for (const candidate of candidates) {
        const current = toMarker(candidate)
        if (current.length > best.length) {
          best = current
        }
      }
      return best
    }

    const tailWindow = lines.slice(Math.max(0, lines.length - 8))
    const headWindow = lines.slice(0, Math.min(lines.length, 8))
    const candidateMarkers = [
      pickLongestLine(tailWindow),
      pickLongestLine(headWindow),
      pickLongestLine(lines),
      toMarker(lines[lines.length - 1] ?? ""),
      toMarker(lines[0] ?? "")
    ]

    const unique: string[] = []
    for (const marker of candidateMarkers) {
      if (!marker || marker.length < 12) {
        continue
      }
      if (!unique.includes(marker)) {
        unique.push(marker)
      }
    }

    return unique.slice(0, 4)
  }

  private async getSourceContentSnapshot(sourceId: string): Promise<string> {
    const normalizedSourceId = String(sourceId ?? "").trim()
    if (!normalizedSourceId) {
      return ""
    }

    const payload = await this.executeRpcPayload(GET_SOURCE_CONTENT_RPC_ID, [[normalizedSourceId], [2], [2]])
    const values: string[] = []
    this.collectStrings(payload, values)
    return values.join("\n")
  }

  private async isSourceContentUpdated(sourceId: string, expectedContent: string): Promise<boolean> {
    const markers = this.buildContentVerificationMarkers(expectedContent)
    if (markers.length === 0) {
      return true
    }

    for (let attempt = 0; attempt < SOURCE_UPDATE_VERIFY_RETRIES; attempt += 1) {
      if (attempt > 0) {
        await delay(SOURCE_UPDATE_VERIFY_DELAY_MS)
      }

      try {
        const snapshot = await this.getSourceContentSnapshot(sourceId)
        const normalizedSnapshot = this.normalizeContentKey(snapshot)
        if (markers.some((marker) => normalizedSnapshot.includes(marker))) {
          return true
        }
      } catch {
        // Continue retry loop for eventual consistency.
      }
    }

    return false
  }

  async sourceContainsExpectedContent(sourceId: string, expectedContent: string): Promise<boolean> {
    return this.isSourceContentUpdated(sourceId, expectedContent)
  }

  private resolveRowsFromPayload(payload: unknown): unknown[][] {
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
      } else {
        queue.push(...Object.values(current))
      }
    }

    return []
  }

  private resolveSourceRows(payload: unknown): unknown[][] {
    const byContract = (payload as { 0?: { 1?: unknown } } | undefined)?.[0]?.[1]
    if (Array.isArray(byContract)) {
      return byContract.filter((row): row is unknown[] => Array.isArray(row))
    }

    return this.resolveRowsFromPayload(payload)
  }

  private resolveGoogleDocMetadataFromRow(
    row: unknown[],
    _knownSourceId = ""
  ): { isGDoc: boolean; gDocId?: string; docReference?: string } {
    const segment2 = Array.isArray(row[2]) ? (row[2] as unknown[]) : null
    if (!segment2) {
      return { isGDoc: false }
    }

    const segment20 = Array.isArray(segment2[0]) ? (segment2[0] as unknown[]) : null
    if (!segment20) {
      return { isGDoc: false }
    }

    const gDocIdRaw = segment20[0]
    const gDocId = gDocIdRaw ? String(gDocIdRaw).trim() : null
    const isValidDriveId =
      Boolean(gDocId) &&
      String(gDocId).length >= 25 &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(gDocId))

    if (!isValidDriveId || !gDocId) {
      return { isGDoc: false }
    }

    return {
      isGDoc: true,
      gDocId,
      docReference: `https://docs.google.com/document/d/${gDocId}/edit`
    }
  }

  private validateRpcResponse(rpcId: string, responseText: string): string {
    const sanitizedResponse = this.stripXssiPrefix(responseText)
    if (!sanitizedResponse) {
      throw new NotebookLMRpcError(`NotebookLM RPC ${rpcId} retornou uma resposta vazia.`)
    }

    if (/^\s*</.test(sanitizedResponse) || /<html[\s>]/i.test(sanitizedResponse)) {
      throw new NotebookLMRpcError(
        `NotebookLM RPC ${rpcId} retornou HTML em vez de JSON. A autenticacao pode ter expirado.`
      )
    }

    const parsedSegments = this.parseJsonSegments(sanitizedResponse)
    if (parsedSegments.length === 0) {
      throw new NotebookLMRpcError(
        `NotebookLM RPC ${rpcId} retornou um payload invalido ou nao parseavel.`
      )
    }

    return sanitizedResponse
  }

  private async executeRpc(
    rpcId: string,
    payload: unknown[],
    sourcePath = DEFAULT_SOURCE_PATH
  ): Promise<string> {
    const runRequest = async (forceRefreshTokens: boolean, targetSourcePath: string): Promise<string> => {
      const { at, bl, authUser } = await this.getAuthTokens(forceRefreshTokens)

      const upstreamPayload = JSON.stringify([[[rpcId, JSON.stringify(payload), null, "generic"]]])
      const upstreamBody = new URLSearchParams()
      upstreamBody.set("f.req", upstreamPayload)
      upstreamBody.set("at", at)

      const response = await fetch(this.buildRpcUrl(rpcId, bl, targetSourcePath, authUser), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "x-same-domain": "1"
        },
        body: upstreamBody.toString()
      })

      const responseText = await response.text()
      if (!response.ok) {
        throw new NotebookLMRpcError(
          `NotebookLM RPC ${rpcId} falhou com HTTP ${response.status}.`
        )
      }

      return this.validateRpcResponse(rpcId, responseText)
    }

    try {
      return await runRequest(false, sourcePath)
    } catch (error) {
      if (
        error instanceof NotebookLMRpcError &&
        /HTTP 400|HTTP 401|HTTP 403|HTML em vez de JSON|status code \[3\]|rejected delete/i.test(
          error.message
        )
      ) {
        this.cachedTokens = null
        return runRequest(true, sourcePath)
      }

      throw error
    }
  }

  private async executeRpcPayload(
    rpcId: string,
    payload: unknown[],
    sourcePath = DEFAULT_SOURCE_PATH
  ): Promise<unknown> {
    const responseText = await this.executeRpc(rpcId, payload, sourcePath)
    return this.parseBatchExecutePayload(responseText, rpcId)
  }

  async listNotebooks(): Promise<NotebookListEntry[]> {
    const payloadCandidates: unknown[][] = [
      [],
      [null],
      [[2]],
      [null, [2]],
      [null, null, [2]]
    ]
    const output = new Map<string, NotebookListEntry>()
    let lastError: Error | null = null

    for (const payloadCandidate of payloadCandidates) {
      try {
        const rawResponse = await this.executeRpc(LIST_NOTEBOOKS_RPC_ID, payloadCandidate)
        const payload = this.parseBatchExecutePayload(rawResponse, LIST_NOTEBOOKS_RPC_ID)
        for (const notebookCandidate of this.findNotebooksInValue(payload, rawResponse)) {
          this.upsertNotebookCandidate(output, notebookCandidate)
        }
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error("Falha inesperada ao listar notebooks no NotebookLM.")
      }
    }

    if (output.size === 0) {
      try {
        const rawResponse = await this.executeRpc(LIST_NOTEBOOKS_RPC_ID, [])
        const parsedSegments = this.parseJsonSegments(rawResponse)

        for (const segment of parsedSegments) {
          for (const notebookCandidate of this.findNotebooksInValue(segment, rawResponse)) {
            this.upsertNotebookCandidate(output, notebookCandidate)
          }
        }
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error("Falha inesperada ao listar notebooks no NotebookLM.")
      }
    }

    if (output.size === 0 && lastError) {
      throw lastError
    }

    return Array.from(output.values())
  }

  async listSources(notebookId: string): Promise<NotebookSourceSummary[]> {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    if (!normalizedNotebookId) {
      throw new Error("notebookId obrigatorio para listar fontes.")
    }

    const payload = await this.executeRpcPayload(LIST_SOURCES_RPC_ID, [normalizedNotebookId, null, [2]])
    const rows = this.resolveSourceRows(payload)
    const sourceMap = new Map<string, NotebookSourceSummary>()

    let rowIndex = -1
    for (const row of rows) {
      rowIndex += 1
      // sourceId: sempre do UUID em row[0][0]. row[2] pode conter gDocId.
      const row0 = Array.isArray(row[0]) ? (row[0] as unknown[]) : null
      const sourceId = row0?.[0] ? String(row0[0]).trim() : null
      const title = row[1] ? String(row[1]).trim() : null

      if (!sourceId || !title) {
        console.debug("[listSources] pulando row sem sourceId ou titulo", {
          row0,
          row1: row[1]
        })
        continue
      }

      // gDocId: para fontes Google Docs, vem em row[2][0][0].
      const segment2 = Array.isArray(row[2]) ? (row[2] as unknown[]) : null
      const segment20 = segment2 && Array.isArray(segment2[0]) ? (segment2[0] as unknown[]) : null
      const segment200 = segment20 && segment20.length > 0 ? segment20[0] : null
      const gDocIdRaw = segment20?.[0] ? String(segment20[0]).trim() : null
      const isValidGDocId =
        Boolean(gDocIdRaw) &&
        String(gDocIdRaw).length >= 25 &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(gDocIdRaw)) &&
        String(gDocIdRaw) !== sourceId
      const gDocId = isValidGDocId && gDocIdRaw ? gDocIdRaw : undefined
      const isGDoc = Boolean(gDocId)
      const docReference = isGDoc ? `https://docs.google.com/document/d/${gDocId}/edit` : undefined

      const previous = sourceMap.get(sourceId)
      sourceMap.set(sourceId, {
        id: sourceId,
        title: title || previous?.title || sourceId,
        gDocId: gDocId ?? previous?.gDocId,
        docReference: docReference ?? previous?.docReference,
        isGDoc: isGDoc || previous?.isGDoc === true
      })

      console.debug("[listSources]", {
        sourceId,
        title,
        isGDoc,
        gDocId: gDocId ?? null
      })

      // TEMP-DEBUG: remover apos validar o parsing real do rLM1Ne.
      console.debug("[listSources raw]", {
        rowIndex,
        sourceId,
        title,
        row0,
        row1: row[1],
        row2: row[2],
        row2_0: segment2?.[0] ?? null,
        row2_0_0: segment200,
        gDocIdRaw,
        isValidGDocId
      })
    }

    return Array.from(sourceMap.values())
  }

  async findSourceIdByTitle(notebookId: string, title: string): Promise<string | null> {
    const normalizedTitle = this.normalizeTitleKey(title)
    if (!normalizedTitle) {
      return null
    }

    try {
      const sources = await this.listSources(notebookId)
      const match = sources.find((source) => this.normalizeTitleKey(source.title) === normalizedTitle)
      return match?.id ?? null
    } catch {
      return null
    }
  }

  private async sourceExists(notebookId: string, sourceId: string): Promise<boolean> {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    const normalizedSourceId = String(sourceId ?? "").trim()
    if (!normalizedNotebookId || !normalizedSourceId) {
      return false
    }

    try {
      const sources = await this.listSources(normalizedNotebookId)
      return sources.some((source) => source.id === normalizedSourceId)
    } catch {
      return true
    }
  }

  private async sourceExistsWithStrictTimeout(
    notebookId: string,
    sourceId: string,
    timeoutMs: number
  ): Promise<boolean | null> {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    const normalizedSourceId = String(sourceId ?? "").trim()
    if (!normalizedNotebookId || !normalizedSourceId) {
      return false
    }

    const boundedTimeout = Math.max(400, timeoutMs)
    try {
      const sources = await this.withTimeout(
        this.listSources(normalizedNotebookId),
        boundedTimeout,
        "STRICT_DELETE_LIST_CONFIRM_TIMEOUT"
      )
      return sources.some((source) => String(source.id ?? "").trim() === normalizedSourceId)
    } catch (error) {
      console.warn(
        "[MindDock] strictReplaceSource: listSources confirmacao indisponivel; fallback para readback.",
        error
      )
      return null
    }
  }

  private async confirmSourceMissingStrict(
    notebookId: string,
    sourceId: string,
    timeoutMs: number
  ): Promise<boolean> {
    const existsByList = await this.sourceExistsWithStrictTimeout(notebookId, sourceId, timeoutMs)
    if (existsByList === false) {
      return true
    }
    if (existsByList === true) {
      return false
    }

    const readbackState = await this.classifySourceReadbackState(
      sourceId,
      Math.max(350, Math.floor(timeoutMs))
    )
    return readbackState === "not_found"
  }

  private async collectStrictReplaceDeleteCandidates(
    notebookId: string,
    sourceId: string,
    title: string,
    listTimeoutMs: number
  ): Promise<string[]> {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    const normalizedSourceId = String(sourceId ?? "").trim()
    const normalizedTitleKey = this.normalizeTitleKey(String(title ?? ""))
    const candidateIds = new Set<string>()
    if (normalizedSourceId) {
      candidateIds.add(normalizedSourceId)
    }

    if (!normalizedNotebookId || !normalizedTitleKey) {
      return normalizedSourceId ? [normalizedSourceId] : []
    }

    try {
      const sources = await this.withTimeout(
        this.listSources(normalizedNotebookId),
        Math.max(450, listTimeoutMs),
        "STRICT_DELETE_CANDIDATE_LIST_TIMEOUT"
      )
      for (const source of sources) {
        const currentSourceId = String(source.id ?? "").trim()
        if (!currentSourceId) {
          continue
        }
        if (this.normalizeTitleKey(String(source.title ?? "")) === normalizedTitleKey) {
          candidateIds.add(currentSourceId)
        }
      }
    } catch (error) {
      console.warn(
        "[MindDock] strictReplaceSource: nao foi possivel listar candidatos por titulo; usando sourceId vinculado.",
        error
      )
    }

    const orderedCandidates = Array.from(candidateIds)
    orderedCandidates.sort((left, right) => {
      if (left === normalizedSourceId) {
        return -1
      }
      if (right === normalizedSourceId) {
        return 1
      }
      return left.localeCompare(right)
    })
    return orderedCandidates
  }

  private async isSourceDeleted(notebookId: string, sourceId: string): Promise<boolean> {
    for (let attempt = 0; attempt < SOURCE_DELETE_VERIFY_RETRIES; attempt += 1) {
      if (attempt > 0) {
        await delay(SOURCE_DELETE_VERIFY_DELAY_MS)
      }

      const exists = await this.sourceExists(notebookId, sourceId)
      if (!exists) {
        return true
      }
    }

    return false
  }

  private async isSourceDeletedWithBudget(
    notebookId: string,
    sourceId: string,
    retries: number,
    retryDelayMs: number
  ): Promise<boolean> {
    const maxRetries = Math.max(1, retries)

    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      if (attempt > 0) {
        await delay(Math.max(0, retryDelayMs))
      }

      const exists = await this.sourceExists(notebookId, sourceId)
      if (!exists) {
        return true
      }
    }

    return false
  }

  private collectStrings(value: unknown, output: string[]): void {
    if (typeof value === "string") {
      output.push(value)

      const trimmedValue = value.trim()
      if (trimmedValue.startsWith("[") || trimmedValue.startsWith("{")) {
        try {
          this.collectStrings(JSON.parse(trimmedValue), output)
        } catch {
          // Keep walking the already collected string list.
        }
      }

      return
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        this.collectStrings(item, output)
      }
      return
    }

    if (value && typeof value === "object") {
      for (const nestedValue of Object.values(value)) {
        this.collectStrings(nestedValue, output)
      }
    }
  }

  private extractNotebookIdFromResponse(responseText: string): string {
    const parsedSegments = this.parseJsonSegments(responseText)
    const stringCandidates: string[] = []

    for (const segment of parsedSegments) {
      this.collectStrings(segment, stringCandidates)
    }

    stringCandidates.push(responseText)

    for (const candidate of stringCandidates) {
      const match = String(candidate ?? "").match(UUID_PATTERN)
      if (match?.[0]) {
        return match[0]
      }
    }

    throw new NotebookLMRpcError("Nao foi possivel extrair o ID do novo caderno da resposta RPC.")
  }

  private looksLikeOpaqueEntityId(value: string): boolean {
    const normalizedValue = String(value ?? "").trim()
    if (!normalizedValue) {
      return false
    }

    if (normalizedValue.length < 12) {
      return false
    }

    if (!/^[A-Za-z0-9_-]+$/.test(normalizedValue)) {
      return false
    }

    if (/^\d+$/.test(normalizedValue)) {
      return false
    }

    if (normalizedValue === ADD_SOURCE_RPC_ID || normalizedValue === CREATE_NOTEBOOK_RPC_ID) {
      return false
    }

    return true
  }

  private extractOpaqueIdFromResponse(responseText: string): string | null {
    const parsedSegments = this.parseJsonSegments(responseText)
    const stringCandidates: string[] = []

    for (const segment of parsedSegments) {
      this.collectStrings(segment, stringCandidates)
    }

    const tokenPattern = /["']([A-Za-z0-9_-]{12,})["']/g
    for (const candidate of stringCandidates) {
      const normalizedCandidate = String(candidate ?? "").trim()
      if (this.looksLikeOpaqueEntityId(normalizedCandidate)) {
        return normalizedCandidate
      }

      for (const tokenMatch of normalizedCandidate.matchAll(tokenPattern)) {
        const token = String(tokenMatch[1] ?? "").trim()
        if (this.looksLikeOpaqueEntityId(token)) {
          return token
        }
      }
    }

    return null
  }

  async createNotebook(title: string): Promise<string> {
    const normalizedTitle = String(title ?? "").trim()
    if (!normalizedTitle) {
      throw new Error("title obrigatorio para criar caderno.")
    }

    const responseText = await this.executeRpc(CREATE_NOTEBOOK_RPC_ID, [normalizedTitle])
    return this.extractNotebookIdFromResponse(responseText)
  }

  async deleteSource(notebookId: string, sourceId: string): Promise<void> {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    const normalizedSourceId = String(sourceId ?? "").trim()

    if (!normalizedNotebookId) {
      throw new Error("notebookId obrigatorio para deletar fonte.")
    }

    if (!normalizedSourceId) {
      throw new Error("sourceId obrigatorio para deletar fonte.")
    }

    let lastError: Error | null = null
    try {
      await this.deleteSourceRpcOnly(normalizedNotebookId, normalizedSourceId)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Falha ao acionar RPC de delecao da fonte.")
    }

    if (!lastError) {
      const deleted = await this.isSourceDeletedWithBudget(
        normalizedNotebookId,
        normalizedSourceId,
        2,
        250
      )
      if (deleted) {
        return
      }
    }

    if (
      await this.isSourceDeletedWithBudget(
        normalizedNotebookId,
        normalizedSourceId,
        SOURCE_DELETE_VERIFY_RETRIES,
        SOURCE_DELETE_VERIFY_DELAY_MS
      )
    ) {
      return
    }

    if (lastError) {
      throw lastError
    }

    throw new Error("NotebookLM nao confirmou a delecao da fonte.")
  }

  async cleanupDuplicateSourcesByTitle(
    notebookId: string,
    title: string
  ): Promise<CleanupDuplicateSourcesResult> {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    const normalizedTitle = String(title ?? "").trim()
    const normalizedTitleKey = this.normalizeTitleKey(normalizedTitle)

    if (!normalizedNotebookId || !normalizedTitleKey) {
      return { matchedCount: 0, requestedDeleteCount: 0 }
    }

    console.debug(`[MindDock] Buscando duplicatas por titulo: "${normalizedTitle}"...`)
    const sources = await this.listSources(normalizedNotebookId)
    const duplicates = sources.filter(
      (source) => this.normalizeTitleKey(String(source.title ?? "")) === normalizedTitleKey
    )

    console.debug(
      `[MindDock] Encontradas ${duplicates.length} fontes antigas com este nome. Iniciando limpeza total.`
    )

    if (duplicates.length === 0) {
      console.debug("[MindDock] Limpeza concluida. Aguardando estabilizacao do backend...")
      return { matchedCount: 0, requestedDeleteCount: 0 }
    }

    await Promise.all(
      duplicates.map(async (source) => {
        const sourceId = String(source.id ?? "").trim()
        if (!sourceId) {
          return
        }

        try {
          await this.deleteSourceRpcOnly(normalizedNotebookId, sourceId)
        } catch (error) {
          if (this.isDeleteSourceNotFoundError(error)) {
            return
          }

          console.warn(
            "[MindDock] Falha ao disparar delecao de fonte duplicada durante cleanup por titulo.",
            {
              sourceId
            },
            error
          )
        }
      })
    )

    console.debug("[MindDock] Limpeza concluida. Aguardando estabilizacao do backend...")
    return { matchedCount: duplicates.length, requestedDeleteCount: duplicates.length }
  }

  async ensureSourceSlotAvailable(
    notebookId: string,
    title: string,
    options: EnsureSourceSlotAvailableOptions = {}
  ): Promise<EnsureSourceSlotAvailableResult> {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    const normalizedTitle = String(title ?? "").trim()
    const normalizedTitleKey = this.normalizeTitleKey(normalizedTitle)
    const requiredSourceIdToClear = String(options.requiredSourceIdToClear ?? "").trim()

    if (!normalizedNotebookId || (!normalizedTitleKey && !requiredSourceIdToClear)) {
      return { cleared: true, authErrorDetected: false }
    }

    const sourceIdsToClear = new Set<string>()
    if (requiredSourceIdToClear) {
      sourceIdsToClear.add(requiredSourceIdToClear)
    }

    if (normalizedTitleKey) {
      try {
        const sources = await this.withTimeout(
          this.listSources(normalizedNotebookId),
          OPTIMISTIC_DELETE_LIST_TIMEOUT_MS,
          "ENSURE_SLOT_LIST_TIMEOUT"
        )

        for (const source of sources) {
          const sourceId = String(source.id ?? "").trim()
          if (!sourceId) {
            continue
          }

          if (this.normalizeTitleKey(String(source.title ?? "")) === normalizedTitleKey) {
            sourceIdsToClear.add(sourceId)
          }
        }
      } catch (error) {
        return {
          cleared: false,
          authErrorDetected: this.isAuthError(error)
        }
      }
    }

    if (sourceIdsToClear.size === 0) {
      return { cleared: true, authErrorDetected: false }
    }

    let authErrorDetected = false
    let cleared = true

    for (const sourceId of sourceIdsToClear) {
      try {
        const deleteResult = await this.optimisticDeleteSource(normalizedNotebookId, sourceId)
        if (deleteResult === "STALE") {
          cleared = false
        }
      } catch (error) {
        if (this.isAuthError(error)) {
          authErrorDetected = true
        }
        cleared = false
      }
    }

    return { cleared, authErrorDetected }
  }

  async verifyAndClearTitlePath(
    notebookId: string,
    title: string,
    options: VerifyAndClearTitlePathOptions = {}
  ): Promise<VerifyAndClearTitlePathResult> {
    return this.ensureSourceSlotAvailable(notebookId, title, options)
  }

  async optimisticDeleteSource(
    notebookId: string,
    sourceId: string,
    options: OptimisticDeleteSourceOptions = {}
  ): Promise<OptimisticDeleteSourceResult> {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    const normalizedSourceId = String(sourceId ?? "").trim()
    if (!normalizedNotebookId) {
      throw new Error("notebookId obrigatorio para deletar fonte.")
    }

    if (!normalizedSourceId) {
      throw new Error("sourceId obrigatorio para deletar fonte.")
    }

    const maxTotalMs = Math.max(1_500, options.maxTotalMs ?? MAX_STALE_INDEX_TOLERANCE_MS)
    const settleDelayMs = Math.max(100, options.settleDelayMs ?? OPTIMISTIC_DELETE_SETTLE_DELAY_MS)
    const deleteRpcTimeoutMs = Math.max(
      250,
      options.deleteRpcTimeoutMs ?? OPTIMISTIC_DELETE_RPC_TIMEOUT_MS
    )
    const listSourcesTimeoutMs = Math.max(
      250,
      options.listSourcesTimeoutMs ?? OPTIMISTIC_DELETE_LIST_TIMEOUT_MS
    )
    const deadlineTs = Date.now() + maxTotalMs

    const getStepTimeout = (requestedTimeoutMs: number): number | null => {
      const remainingMs = deadlineTs - Date.now()
      if (remainingMs < 250) {
        return null
      }
      return Math.min(requestedTimeoutMs, remainingMs)
    }

    const initialDeleteTimeoutMs = getStepTimeout(deleteRpcTimeoutMs)
    if (initialDeleteTimeoutMs === null) {
      return "STALE"
    }

    try {
      await this.withTimeout(
        this.deleteSourceRpcOnly(normalizedNotebookId, normalizedSourceId),
        initialDeleteTimeoutMs,
        "OPTIMISTIC_DELETE_RPC_TIMEOUT"
      )
    } catch (error) {
      if (this.isDeleteSourceNotFoundError(error)) {
        return "SUCCESS"
      }

      console.warn(
        "[MindDock] optimisticDeleteSource: delete inicial falhou, validando uma vez antes de seguir.",
        error
      )
    }

    const remainingBeforeSettleMs = deadlineTs - Date.now()
    if (remainingBeforeSettleMs > 0) {
      await delay(Math.min(settleDelayMs, remainingBeforeSettleMs))
    }

    const listTimeoutMs = getStepTimeout(listSourcesTimeoutMs)
    if (listTimeoutMs === null) {
      return "STALE"
    }

    try {
      const sources = await this.withTimeout(
        this.listSources(normalizedNotebookId),
        listTimeoutMs,
        "OPTIMISTIC_DELETE_LIST_TIMEOUT"
      )
      const stillExists = sources.some((source) => String(source.id ?? "").trim() === normalizedSourceId)

      if (!stillExists) {
        return "SUCCESS"
      }
    } catch (error) {
      console.warn(
        "[MindDock] optimisticDeleteSource: validacao unica falhou. Seguindo em modo fail-open.",
        error
      )
      return "STALE"
    }

    const retryDeleteTimeoutMs = getStepTimeout(deleteRpcTimeoutMs)
    if (retryDeleteTimeoutMs !== null) {
      try {
        await this.withTimeout(
          this.deleteSourceRpcOnly(normalizedNotebookId, normalizedSourceId),
          retryDeleteTimeoutMs,
          "OPTIMISTIC_DELETE_RPC_RETRY_TIMEOUT"
        )
      } catch (error) {
        if (!this.isDeleteSourceNotFoundError(error)) {
          console.warn(
            "[MindDock] optimisticDeleteSource: retry de delete falhou; upload seguira sem bloquear.",
            error
          )
        }
      }
    }

    return "STALE"
  }

  async smartDeleteSource(notebookId: string, sourceId: string): Promise<boolean> {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    const normalizedSourceId = String(sourceId ?? "").trim()
    console.log(`[NotebookLMService] Fire & Forget delete initiated for: ${normalizedSourceId}`)

    try {
      await this.deleteSourceRpcOnly(normalizedNotebookId, normalizedSourceId)
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      return true
    } catch (error) {
      console.warn(
        "[NotebookLMService] Delete RPC failed, but proceeding with upload to ensure data preservation.",
        error
      )
      return true
    }
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error("RESYNC_ABORTED")
    }
  }

  private buildSourceSnapshot(sources: NotebookSourceSummary[]): SourceSnapshotEntry[] {
    return sources.map((source) => ({
      id: String(source.id ?? "").trim(),
      title: String(source.title ?? "").trim()
    }))
  }

  private resolveResyncRemapCandidateByTitle(
    sources: NotebookSourceSummary[],
    title: string,
    platform: string
  ): NotebookSourceSummary | null {
    const normalizedTitleKey = this.normalizeTitleKey(title)
    const normalizedPlatformKey = this.normalizeTitleKey(platform)
    if (!normalizedTitleKey) {
      return null
    }

    let bestCandidate: NotebookSourceSummary | null = null
    let bestScore = 0

    for (const source of sources) {
      const sourceTitleKey = this.normalizeTitleKey(String(source.title ?? ""))
      if (!sourceTitleKey) {
        continue
      }

      let score = 0
      if (sourceTitleKey === normalizedTitleKey) {
        score = 120
      } else if (
        sourceTitleKey.includes(normalizedTitleKey) ||
        normalizedTitleKey.includes(sourceTitleKey)
      ) {
        score = 80
      }

      if (normalizedPlatformKey && sourceTitleKey.includes(normalizedPlatformKey)) {
        score += 15
      }

      if (score > bestScore) {
        bestScore = score
        bestCandidate = source
      }
    }

    return bestScore > 0 ? bestCandidate : null
  }

  private async waitForSourceMissingInList(
    notebookId: string,
    sourceId: string,
    maxWaitMs: number,
    pollIntervalMs: number
  ): Promise<{
    removed: boolean
    lastSnapshot: SourceSnapshotEntry[] | null
    listError: string | null
  }> {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    const normalizedSourceId = String(sourceId ?? "").trim()
    const deadlineTs = Date.now() + Math.max(250, maxWaitMs)
    const intervalMs = Math.max(120, pollIntervalMs)
    let lastSnapshot: SourceSnapshotEntry[] | null = null
    let listError: string | null = null

    while (Date.now() <= deadlineTs) {
      try {
        const sources = await this.listSources(normalizedNotebookId)
        lastSnapshot = this.buildSourceSnapshot(sources)
        const stillExists = sources.some(
          (source) => String(source.id ?? "").trim() === normalizedSourceId
        )
        if (!stillExists) {
          return {
            removed: true,
            lastSnapshot,
            listError
          }
        }
      } catch (error) {
        listError = error instanceof Error ? error.message : String(error ?? "")
      }

      const remainingMs = deadlineTs - Date.now()
      if (remainingMs <= 0) {
        break
      }
      await delay(Math.min(intervalMs, remainingMs))
    }

    return {
      removed: false,
      lastSnapshot,
      listError
    }
  }

  private logResyncDiagnostics(diag: ResyncDiagnostics): void {
    const hasRecoverableFallback =
      diag.updateInPlaceAttempted === true &&
      diag.updateInPlaceSucceeded === true &&
      String(diag.rpcError ?? "").toLowerCase().includes("delete")

    const hasFailure =
      diag.updateInPlaceSucceeded === false ||
      (diag.existsInListAfterDelete === true && diag.updateInPlaceSucceeded !== true)

    const logger: (...args: unknown[]) => void = hasFailure
      ? console.error
      : hasRecoverableFallback
      ? console.warn
      : console.log

    try {
      logger("[RESYNC_DIAGNOSTICS]", JSON.stringify(diag))
    } catch {
      logger("[RESYNC_DIAGNOSTICS]", diag)
    }
  }

  async strictReplaceSource(
    notebookId: string,
    overwriteSourceId: string | undefined,
    title: string,
    content: string,
    platform: string,
    options: StrictReplaceSourceOptions = {}
  ): Promise<StrictReplaceSourceResult> {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    const normalizedBoundSourceId = String(overwriteSourceId ?? "").trim()
    const normalizedTitle = String(title ?? "").trim() || `Source ${new Date().toISOString()}`
    const normalizedContent = String(content ?? "").trim()
    const normalizedPlatform = String(platform ?? "").trim()
    const diag: ResyncDiagnostics = {
      notebookId: normalizedNotebookId,
      boundSourceId: normalizedBoundSourceId || null,
      existsInListBeforeDelete: false,
      resolvedSourceId: null,
      remappedByTitle: false,
      deletePayloadVariant: "none",
      sourcePath: null,
      rpcError: null,
      existsInListAfterDelete: null,
      updateInPlaceAttempted: false,
      updateInPlaceSucceeded: null,
      updateInPlaceError: null,
      listSnapshotBefore: [],
      listSnapshotAfter: null
    }
    let diagnosticsLogged = false
    const flushDiagnostics = (): void => {
      if (diagnosticsLogged) {
        return
      }
      diagnosticsLogged = true
      this.logResyncDiagnostics(diag)
    }

    try {
      if (!normalizedNotebookId) {
        throw new Error("notebookId obrigatorio para strict replace de fonte.")
      }

      if (!normalizedContent) {
        throw new Error("content obrigatorio para strict replace de fonte.")
      }

      this.throwIfAborted(options.signal)
      options.onProgress?.("resolving_source")

      const currentSources = await this.listSources(normalizedNotebookId)
      diag.listSnapshotBefore = this.buildSourceSnapshot(currentSources)

      let targetSourceId: string | null = null

      if (normalizedBoundSourceId) {
        const boundSourceExists = currentSources.some(
          (source) => String(source.id ?? "").trim() === normalizedBoundSourceId
        )
        diag.existsInListBeforeDelete = boundSourceExists

        if (boundSourceExists) {
          targetSourceId = normalizedBoundSourceId
          diag.resolvedSourceId = targetSourceId
        } else {
          const remappedCandidate = this.resolveResyncRemapCandidateByTitle(
            currentSources,
            normalizedTitle,
            normalizedPlatform
          )
          if (remappedCandidate?.id) {
            targetSourceId = String(remappedCandidate.id).trim()
            diag.resolvedSourceId = targetSourceId
            diag.remappedByTitle = true
          } else {
            throw new Error(
              `BINDING_INVALIDO: SourceId ${normalizedBoundSourceId} nao existe e nao foi possivel remapear por titulo "${normalizedTitle}"`
            )
          }
        }
      }

      let deleteConfirmed = false
      if (targetSourceId) {
        const deleteDeadlineTs = Date.now() + STRICT_REPLACE_DELETE_BUDGET_MS
        await this.refreshAuthTokens()
        let deleteAttempt = 0
        let lastDeleteError: string | null = null

        while (Date.now() < deleteDeadlineTs) {
          deleteAttempt += 1
          this.throwIfAborted(options.signal)
          options.onProgress?.(`deleting_source_attempt_${deleteAttempt}`)

          try {
            const deleteOutcome = await this.deleteSourceRpcOnly(normalizedNotebookId, targetSourceId)
            diag.deletePayloadVariant = deleteOutcome.payloadVariant
            diag.sourcePath = `${deleteOutcome.sourcePath}#candidate:${deleteOutcome.candidateIndex}`
            lastDeleteError = null
          } catch (deleteError) {
            lastDeleteError =
              deleteError instanceof Error ? deleteError.message : String(deleteError ?? "")
            diag.rpcError = lastDeleteError
          }

          this.throwIfAborted(options.signal)
          const remainingAfterDeleteMs = deleteDeadlineTs - Date.now()
          const confirmWaitMs = Math.min(
            STRICT_REPLACE_DELETE_CONFIRM_MAX_WAIT_MS,
            Math.max(4_000, remainingAfterDeleteMs - 150)
          )
          await delay(2_000)
          const confirmResult = await this.waitForSourceMissingInList(
            normalizedNotebookId,
            targetSourceId,
            confirmWaitMs,
            STRICT_REPLACE_DELETE_CONFIRM_POLL_MS
          )
          diag.listSnapshotAfter = confirmResult.lastSnapshot

          if (confirmResult.removed) {
            deleteConfirmed = true
            diag.existsInListAfterDelete = false
            options.onProgress?.("delete_confirmed")
            break
          }

          diag.existsInListAfterDelete = true
          if (confirmResult.listError) {
            const listErrorDetail = `listSources confirm failed: ${confirmResult.listError}`
            diag.rpcError = lastDeleteError
              ? `${lastDeleteError}; ${listErrorDetail}`
              : listErrorDetail
          } else if (!lastDeleteError) {
            diag.rpcError = "Source ainda existe apos delete"
          }

          if (deleteDeadlineTs - Date.now() <= STRICT_REPLACE_DELETE_RETRY_DELAY_MS + 300) {
            break
          }
          await delay(STRICT_REPLACE_DELETE_RETRY_DELAY_MS)
        }

        if (!deleteConfirmed) {
          diag.updateInPlaceAttempted = true
          options.onProgress?.("updating_in_place")
          try {
            await this.updateSource(normalizedNotebookId, targetSourceId, normalizedTitle, normalizedContent, {
              verifyContent: true,
              allowUnverifiedSuccess: true,
              rpcStepTimeoutMs: 6_000
            })
            diag.updateInPlaceSucceeded = true
            diag.updateInPlaceError = null
            diag.existsInListAfterDelete = true
            diag.rpcError = "DELETE_NOT_CONFIRMED_UPDATED_IN_PLACE"
            flushDiagnostics()
            return {
              newSourceId: targetSourceId,
              wasReplaced: false,
              updatedInPlace: true
            }
          } catch (updateInPlaceError) {
            const updateErrorText =
              updateInPlaceError instanceof Error
                ? updateInPlaceError.message
                : String(updateInPlaceError ?? "")
            diag.updateInPlaceSucceeded = false
            diag.updateInPlaceError = updateErrorText
            if (diag.existsInListAfterDelete === null) {
              diag.existsInListAfterDelete = true
            }
            if (!diag.rpcError) {
              diag.rpcError = "Source ainda existe apos delete"
            }
            const fullErrorDetail =
              `deleteError=${diag.rpcError}; updateInPlaceError=${updateErrorText}`.slice(0, 520)
            diag.rpcError = fullErrorDetail
            flushDiagnostics()
            throw new Error(
              `DELETE_FAILED: Nao foi possivel deletar ${targetSourceId}. Erro: ${fullErrorDetail}. Remapeado: ${diag.remappedByTitle}. Abortando re-sync para evitar duplicatas.`
            )
          }
        }
      }

      this.throwIfAborted(options.signal)
      options.onProgress?.("inserting_source")

      const newSourceId = await this.insertSource(normalizedNotebookId, normalizedTitle, normalizedContent)
      this.throwIfAborted(options.signal)

      const finalSources = await this.listSources(normalizedNotebookId)
      const canonicalNewSource = finalSources.find(
        (source) => String(source.id ?? "").trim() === newSourceId
      )
      if (!canonicalNewSource?.id) {
        throw new Error(
          `INSERT_VALIDATION_FAILED: ID ${newSourceId} retornado pelo insert nao encontrado em listSources().`
        )
      }

      diag.resolvedSourceId = canonicalNewSource.id
      if (deleteConfirmed) {
        diag.existsInListAfterDelete = false
      }

      flushDiagnostics()
      return {
        newSourceId: canonicalNewSource.id,
        wasReplaced: deleteConfirmed,
        updatedInPlace: false
      }
    } catch (error) {
      if (!diag.rpcError) {
        diag.rpcError = error instanceof Error ? error.message : String(error ?? "")
      }
      flushDiagnostics()
      throw error
    }
  }

  private resolveInsertedSourceCandidate(
    sources: NotebookSourceSummary[],
    knownSourceIds: Set<string>,
    sourceTitle: string
  ): NotebookSourceSummary | null {
    const normalizedTitleKey = this.normalizeTitleKey(sourceTitle)
    if (!normalizedTitleKey) {
      return null
    }

    const exactTitleMatches = sources.filter(
      (source) => this.normalizeTitleKey(String(source.title ?? "")) === normalizedTitleKey
    )
    const unseenExactMatch = exactTitleMatches.find(
      (source) => !knownSourceIds.has(String(source.id ?? "").trim())
    )
    if (unseenExactMatch?.id) {
      return unseenExactMatch
    }
    if (exactTitleMatches.length === 1 && exactTitleMatches[0]?.id) {
      return exactTitleMatches[0]
    }

    const partialTitleMatches = sources.filter((source) => {
      const currentTitleKey = this.normalizeTitleKey(String(source.title ?? ""))
      if (!currentTitleKey) {
        return false
      }
      return (
        currentTitleKey.includes(normalizedTitleKey) || normalizedTitleKey.includes(currentTitleKey)
      )
    })
    const unseenPartialMatch = partialTitleMatches.find(
      (source) => !knownSourceIds.has(String(source.id ?? "").trim())
    )
    if (unseenPartialMatch?.id) {
      return unseenPartialMatch
    }
    if (partialTitleMatches.length === 1 && partialTitleMatches[0]?.id) {
      return partialTitleMatches[0]
    }

    return null
  }

  async insertSource(
    notebookId: string,
    title: string,
    content: string,
    sourceId = "NEW"
  ): Promise<string> {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    const normalizedContent = String(content ?? "").trim()
    const normalizedSourceIdForLog = String(sourceId ?? "").trim() || "NEW"

    console.log(
      "[NotebookLMService] Inserting into Notebook:",
      normalizedNotebookId || notebookId,
      "with SourceID:",
      normalizedSourceIdForLog
    )

    if (!normalizedNotebookId) {
      throw new Error("notebookId obrigatorio para adicionar fonte.")
    }

    if (!normalizedContent) {
      throw new Error("content obrigatorio para adicionar fonte.")
    }

    const sourceLabel = String(title ?? "").trim() || `Source ${new Date().toISOString()}`
    const knownSourceIds = new Set<string>()
    try {
      const preInsertSources = await this.listSources(normalizedNotebookId)
      for (const source of preInsertSources) {
        const currentSourceId = String(source.id ?? "").trim()
        if (currentSourceId) {
          knownSourceIds.add(currentSourceId)
        }
      }
    } catch (error) {
      console.warn(
        "[MindDock] insertSource: listSources inicial indisponivel; continuando sem baseline de IDs.",
        error
      )
    }

    const upstreamPayload: unknown[] = [
      [
        [
          null,
          [sourceLabel, normalizedContent],
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

    const responseText = await this.executeRpc(ADD_SOURCE_RPC_ID, upstreamPayload)
    this.assertInsertSourceResponseAccepted(responseText)

    let lastLookupError: Error | null = null
    for (let attempt = 0; attempt < SOURCE_ID_LOOKUP_RETRIES; attempt += 1) {
      await delay(attempt === 0 ? 1_000 : SOURCE_UPDATE_VERIFY_DELAY_MS)
      try {
        const sourcesAfterInsert = await this.listSources(normalizedNotebookId)
        const insertedCandidate = this.resolveInsertedSourceCandidate(
          sourcesAfterInsert,
          knownSourceIds,
          sourceLabel
        )
        if (insertedCandidate?.id) {
          return insertedCandidate.id
        }

        lastLookupError = new Error(
          "ID canonic da nova fonte nao encontrado na listSources para o titulo informado."
        )
      } catch (error) {
        lastLookupError =
          error instanceof Error
            ? error
            : new Error("Falha inesperada ao validar insercao da fonte em listSources.")
      }
    }

    const lookupErrorSuffix =
      lastLookupError instanceof Error
        ? ` Last listSources error: ${String(lastLookupError.message ?? "")
            .trim()
            .slice(0, 220)}`
        : ""
    throw new Error(
      `INSERT_NOT_FOUND: Fonte inserida nao aparece em listSources apos validacao.${lookupErrorSuffix}`
    )
  }

  async addSource(notebookId: string, title: string, content: string): Promise<string> {
    return this.insertSource(notebookId, title, content)
  }

  async syncGoogleDocSource(notebookId: string, title: string, docReference: string): Promise<void> {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    const normalizedTitle = String(title ?? "").trim() || `Documento ${new Date().toISOString()}`
    const normalizedDocId = this.extractGoogleDocId(docReference)

    if (!normalizedNotebookId) {
      throw new Error("notebookId obrigatorio para sincronizar Google Docs.")
    }

    if (!normalizedDocId) {
      throw new Error("docId obrigatorio para sincronizar Google Docs.")
    }

    const payloadCandidates = this.buildSyncGoogleDocPayloadCandidates(
      normalizedNotebookId,
      normalizedDocId,
      normalizedTitle
    )
    const sourcePathCandidates = [`/notebook/${normalizedNotebookId}`, DEFAULT_SOURCE_PATH]
    let lastError: Error | null = null

    for (const sourcePath of sourcePathCandidates) {
      for (const payloadCandidate of payloadCandidates) {
        try {
          const responseText = await this.executeRpc(SYNC_GDOC_RPC_ID, payloadCandidate, sourcePath)
          this.assertSyncGoogleDocResponseAccepted(responseText)
          return
        } catch (error) {
          lastError =
            error instanceof Error
              ? error
              : new Error("Falha inesperada ao sincronizar Google Docs no NotebookLM.")
        }
      }
    }

    if (lastError) {
      throw lastError
    }

    throw new Error("Falha ao sincronizar Google Docs no NotebookLM.")
  }

  async syncGoogleDocSourceBySourceId(notebookId: string, sourceId: string): Promise<void> {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    const normalizedSourceId = String(sourceId ?? "").trim()

    if (!normalizedNotebookId) {
      throw new Error("notebookId obrigatorio para sincronizar Google Docs.")
    }

    if (!normalizedSourceId) {
      throw new Error("sourceId obrigatorio para sincronizar Google Docs.")
    }

    const payloadCandidates: unknown[][] = [
      [null, [normalizedSourceId], [2]],
      [[normalizedSourceId], [2]],
      [normalizedSourceId, [2]],
      [null, [normalizedSourceId]],
      [[normalizedSourceId]]
    ]
    const sourcePathCandidates = [`/notebook/${normalizedNotebookId}`, DEFAULT_SOURCE_PATH]
    let lastError: Error | null = null

    for (const sourcePath of sourcePathCandidates) {
      for (const payloadCandidate of payloadCandidates) {
        try {
          const responseText = await this.executeRpc(SYNC_GDOC_RPC_ID, payloadCandidate, sourcePath)
          this.assertSyncGoogleDocResponseAccepted(responseText)
          return
        } catch (error) {
          lastError =
            error instanceof Error
              ? error
              : new Error("Falha inesperada ao sincronizar Google Docs no NotebookLM.")
        }
      }
    }

    if (lastError) {
      throw lastError
    }

    throw new Error("Falha ao sincronizar Google Docs no NotebookLM.")
  }

  async syncGoogleDocSourceBySourceIdVerified(
    notebookId: string,
    sourceId: string,
    title: string,
    isGDoc: boolean
  ): Promise<SyncVerificationResult> {
    const base: SyncVerificationResult = {
      sourceId: String(sourceId ?? "").trim(),
      title: String(title ?? "").trim() || sourceId,
      accepted: false,
      changed: false,
      isGDoc: isGDoc === true,
    }

    console.debug(`[DIAG syncVerified] "${title}" | isGDoc:${isGDoc} | sourceId:${sourceId}`)

    if (!isGDoc) {
      console.debug(`[DIAG syncVerified] PULOU "${title}" - sem vinculo GDoc`)
      return { ...base, skipReason: "sem_gdocid - snapshot estatico" }
    }

    try {
      console.debug(`[DIAG syncVerified] chamando FLmJqe para "${title}" sourceId:${sourceId}`)
      await this.syncGoogleDocSourceBySourceId(notebookId, base.sourceId)
      console.debug(`[DIAG syncVerified] FLmJqe OK para "${title}"`)
      return { ...base, accepted: true, changed: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.debug(`[DIAG syncVerified] FLmJqe FALHOU para "${title}":`, message)
      return { ...base, skipReason: `sync_falhou: ${message}` }
    }
  }

  async addGoogleDocSource(notebookId: string, title: string, docReference: string): Promise<string> {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    const normalizedTitle = String(title ?? "").trim() || `Documento ${new Date().toISOString()}`
    const normalizedDocId = this.extractGoogleDocId(docReference)

    if (!normalizedNotebookId) {
      throw new Error("notebookId obrigatorio para sincronizar Google Docs.")
    }

    if (!normalizedDocId) {
      throw new Error("docId obrigatorio para sincronizar Google Docs.")
    }

    const knownSourceIds = new Set<string>()
    try {
      const sourcesBefore = await this.listSources(normalizedNotebookId)
      for (const source of sourcesBefore) {
        const sourceId = String(source.id ?? "").trim()
        if (sourceId) {
          knownSourceIds.add(sourceId)
        }
      }
    } catch (error) {
      console.warn(
        "[MindDock] addGoogleDocSource: listSources inicial indisponivel; continuando sem baseline de IDs.",
        error
      )
    }

    const sourcePath = `/notebook/${normalizedNotebookId}`
    const addGoogleDocPayload: unknown[] = [
      [
        [
          [normalizedDocId, GOOGLE_DOCS_MIME_TYPE, 1, normalizedTitle],
          null,
          null,
          null,
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
      [2],
      [1, null, null, null, null, null, null, null, null, null, [1]]
    ]

    let lastError: Error | null = null
    try {
      const responseText = await this.executeRpc(ADD_SOURCE_RPC_ID, addGoogleDocPayload, sourcePath)
      this.assertInsertSourceResponseAccepted(responseText)

      if (responseText.includes("reached its source limit")) {
        throw new Error("SOURCE_LIMIT_REACHED")
      }
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error("Falha inesperada ao sincronizar Google Docs no NotebookLM.")
    }

    if (lastError) {
      const fallbackSourceId = await this.findSourceIdByTitle(normalizedNotebookId, normalizedTitle)
      if (fallbackSourceId) {
        return fallbackSourceId
      }
      throw lastError
    }

    for (let attempt = 0; attempt < SOURCE_ID_LOOKUP_RETRIES; attempt += 1) {
      await delay(attempt === 0 ? 1_000 : SOURCE_UPDATE_VERIFY_DELAY_MS)
      const sourcesAfter = await this.listSources(normalizedNotebookId)
      const insertedCandidate = this.resolveInsertedSourceCandidate(
        sourcesAfter,
        knownSourceIds,
        normalizedTitle
      )
      if (insertedCandidate?.id) {
        return insertedCandidate.id
      }

      const exactMatches = sourcesAfter.filter(
        (source) =>
          this.normalizeTitleKey(String(source.title ?? "")) ===
          this.normalizeTitleKey(normalizedTitle)
      )

      const unseenExactMatch = exactMatches.find(
        (source) => !knownSourceIds.has(String(source.id ?? "").trim())
      )
      if (unseenExactMatch?.id) {
        return unseenExactMatch.id
      }

      if (knownSourceIds.size === 0 && exactMatches.length === 1 && exactMatches[0]?.id) {
        return exactMatches[0].id
      }
    }

    const fallbackSourceId = await this.findSourceIdByTitle(normalizedNotebookId, normalizedTitle)
    if (fallbackSourceId) {
      return fallbackSourceId
    }

    throw new Error("Falha ao sincronizar Google Docs no NotebookLM.")
  }

  async updateSource(
    notebookId: string,
    sourceId: string,
    title: string,
    content: string,
    options: UpdateSourceOptions = {}
  ): Promise<string> {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    const normalizedSourceId = String(sourceId ?? "").trim()
    const normalizedContent = String(content ?? "").trim()
    const verifyContent = options.verifyContent !== false
    const allowUnverifiedSuccess = options.allowUnverifiedSuccess === true
    const rpcStepTimeoutMs = Number.isFinite(options.rpcStepTimeoutMs)
      ? Math.max(1_200, Number(options.rpcStepTimeoutMs))
      : null

    if (!normalizedNotebookId) {
      throw new Error("notebookId obrigatorio para atualizar fonte.")
    }

    if (!normalizedSourceId) {
      throw new Error("sourceId obrigatorio para atualizar fonte.")
    }

    if (!normalizedContent) {
      throw new Error("content obrigatorio para atualizar fonte.")
    }

    const sourceLabel = String(title ?? "").trim() || `Source ${new Date().toISOString()}`

    const updatePayloadCandidates: unknown[][] = [
      [normalizedNotebookId, null, [[normalizedSourceId, null, sourceLabel, normalizedContent]]],
      [normalizedNotebookId, null, [[null, normalizedSourceId, sourceLabel, normalizedContent]]],
      [
        [
          [
            normalizedSourceId,
            [sourceLabel, normalizedContent],
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
      ],
      [
        [
          [
            null,
            [sourceLabel, normalizedContent],
            normalizedSourceId,
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
    ]

    const sourcePathCandidates = [`/notebook/${normalizedNotebookId}`, DEFAULT_SOURCE_PATH]

    let lastError: Error | null = null
    let sawAcceptedRpc = false

    for (const candidateSourcePath of sourcePathCandidates) {
      for (const candidatePayload of updatePayloadCandidates) {
        try {
          const rpcOperation = this.executeRpc(ADD_SOURCE_RPC_ID, candidatePayload, candidateSourcePath)
          if (rpcStepTimeoutMs !== null) {
            await this.withTimeout(rpcOperation, rpcStepTimeoutMs, "UPDATE_SOURCE_RPC_STEP_TIMEOUT")
          } else {
            await rpcOperation
          }
          sawAcceptedRpc = true

          if (!verifyContent) {
            return normalizedSourceId
          }

          const updated = await this.isSourceContentUpdated(normalizedSourceId, normalizedContent)
          if (updated) {
            return normalizedSourceId
          }
        } catch (error) {
          lastError =
            error instanceof Error ? error : new Error("Falha ao atualizar fonte no NotebookLM.")
        }
      }
    }

    if (sawAcceptedRpc) {
      if (allowUnverifiedSuccess) {
        console.log(
          "[MindDock] NotebookLM aceitou RPC de update, mas a leitura de confirmacao ainda nao refletiu mudanca."
        )
        return normalizedSourceId
      }

      console.warn(
        "[MindDock] NotebookLM aceitou RPC de update, mas nao foi possivel confirmar atualizacao do conteudo."
      )
      throw new Error(
        "UPDATE_SOURCE_UNVERIFIED: NotebookLM aceitou o update, mas nao refletiu o novo conteudo."
      )
    }

    if (lastError) {
      throw lastError
    }

    throw new Error("NotebookLM nao confirmou atualizacao da fonte existente.")
  }

  /**
   * Busca o conteúdo de múltiplas fontes do NotebookLM.
   * Retorna um mapa sourceId -> array de snippets de texto.
   */
  async getSourcesContent(
    notebookId: string,
    sourceIds: string[]
  ): Promise<{
    sourceSnippets: Record<string, string[]>
    failedSourceIds: string[]
  }> {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    if (!normalizedNotebookId) {
      throw new Error("notebookId obrigatorio para buscar conteudo de fontes.")
    }

    const normalizedSourceIds = sourceIds
      .map((id) => String(id ?? "").trim())
      .filter(Boolean)

    if (normalizedSourceIds.length === 0) {
      return {
        sourceSnippets: {},
        failedSourceIds: []
      }
    }

    const sourceSnippets: Record<string, string[]> = {}
    const failedSourceIds: string[] = []

    // Busca conteúdo de cada fonte individualmente
    for (const sourceId of normalizedSourceIds) {
      try {
        const content = await this.getSourceContentSnapshot(sourceId)
        
        // Divide o conteúdo em snippets (parágrafos)
        const snippets = content
          .split(/\n\n+/)
          .map((snippet) => snippet.trim())
          .filter((snippet) => snippet.length > 0)

        if (snippets.length > 0) {
          sourceSnippets[sourceId] = snippets
        } else {
          // Se não tem snippets, retorna o conteúdo completo
          sourceSnippets[sourceId] = [content]
        }
      } catch (error) {
        console.warn(`[MindDock] Falha ao buscar conteudo da fonte ${sourceId}:`, error)
        failedSourceIds.push(sourceId)
      }
    }

    return {
      sourceSnippets,
      failedSourceIds
    }
  }
}
