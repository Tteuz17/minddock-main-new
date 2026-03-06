export interface NotebookTokens {
  at: string
  bl: string
  accountEmail?: string | null
  authUser?: string | null
  timestamp: number
}

const STORAGE_KEY = "notebooklm_session"
const MAX_TOKEN_AGE_MS = 24 * 60 * 60 * 1000

function normalizeString(value: unknown): string {
  return String(value ?? "").trim()
}

function normalizeAccountEmail(value: unknown): string | null {
  const normalizedValue = normalizeString(value).toLowerCase()
  if (!normalizedValue) {
    return null
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalizedValue) ? normalizedValue : null
}

function normalizeTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

export class TokenStorage {
  async saveTokens(tokens: Partial<NotebookTokens>): Promise<void> {
    const snapshot = await chrome.storage.local.get(STORAGE_KEY)
    const existingTokens = await this.normalizeStoredTokens(snapshot[STORAGE_KEY])

    const nextAt = normalizeString(tokens.at) || existingTokens?.at || ""
    const nextBl = normalizeString(tokens.bl) || existingTokens?.bl || ""
    const nextAccountEmail =
      normalizeAccountEmail(tokens.accountEmail) ?? normalizeAccountEmail(existingTokens?.accountEmail)
    const nextAuthUser =
      normalizeString(tokens.authUser) || normalizeString(existingTokens?.authUser) || null

    if (!nextAt || !nextBl) {
      return
    }

    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        at: nextAt,
        bl: nextBl,
        accountEmail: nextAccountEmail,
        authUser: nextAuthUser,
        timestamp: Date.now()
      }
    })
  }

  async getTokens(): Promise<NotebookTokens | null> {
    const snapshot = await chrome.storage.local.get(STORAGE_KEY)
    return this.normalizeStoredTokens(snapshot[STORAGE_KEY])
  }

  async hasValidTokens(): Promise<boolean> {
    const tokens = await this.getTokens()
    if (!tokens) {
      return false
    }

    return Date.now() - tokens.timestamp < MAX_TOKEN_AGE_MS
  }

  private async normalizeStoredTokens(rawValue: unknown): Promise<NotebookTokens | null> {
    if (!rawValue || typeof rawValue !== "object") {
      return null
    }

    const rawTokens = rawValue as Partial<NotebookTokens>
    const at = normalizeString(rawTokens.at)
    const bl = normalizeString(rawTokens.bl)
    const accountEmail = normalizeAccountEmail(rawTokens.accountEmail)
    const authUser = normalizeString(rawTokens.authUser) || null
    const timestamp = normalizeTimestamp(rawTokens.timestamp)

    if (!at || !bl || timestamp <= 0) {
      return null
    }

    return {
      at,
      bl,
      accountEmail,
      authUser,
      timestamp
    }
  }
}

export const tokenStorage = new TokenStorage()
