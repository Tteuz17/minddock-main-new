export interface SessionTokens {
  primaryToken: string
  secondaryToken: string
}

const SESSION_STORAGE_KEY = "network_manager_session_tokens"

function normalizeToken(value: unknown): string {
  return String(value ?? "").trim()
}

function normalizeTokens(rawValue: unknown): SessionTokens | null {
  if (!rawValue || typeof rawValue !== "object") {
    return null
  }

  const candidate = rawValue as Partial<SessionTokens>
  const primaryToken = normalizeToken(candidate.primaryToken)
  const secondaryToken = normalizeToken(candidate.secondaryToken)

  if (!primaryToken || !secondaryToken) {
    return null
  }

  return {
    primaryToken,
    secondaryToken
  }
}

export class SessionTokenVault {
  private static instance: SessionTokenVault | null = null

  private memoryTokens: SessionTokens | null = null
  private hydrationPromise: Promise<void> | null = null

  private constructor() {
    this.hydrationPromise = this.hydrateFromSessionStorage()
  }

  static getInstance(): SessionTokenVault {
    if (!SessionTokenVault.instance) {
      SessionTokenVault.instance = new SessionTokenVault()
    }

    return SessionTokenVault.instance
  }

  async setTokens(tokens: SessionTokens): Promise<void> {
    const normalizedTokens = normalizeTokens(tokens)
    if (!normalizedTokens) {
      throw new Error("INVALID_AUTH_TOKENS")
    }

    this.memoryTokens = normalizedTokens

    await chrome.storage.session.set({
      [SESSION_STORAGE_KEY]: normalizedTokens
    })
  }

  async getTokens(): Promise<SessionTokens | null> {
    await this.ensureHydrated()
    return this.memoryTokens ? { ...this.memoryTokens } : null
  }

  hasValidTokens(): boolean {
    return Boolean(this.memoryTokens?.primaryToken && this.memoryTokens?.secondaryToken)
  }

  async clearTokens(): Promise<void> {
    this.memoryTokens = null
    await chrome.storage.session.remove(SESSION_STORAGE_KEY)
  }

  private async ensureHydrated(): Promise<void> {
    if (!this.hydrationPromise) {
      this.hydrationPromise = this.hydrateFromSessionStorage()
    }

    await this.hydrationPromise
  }

  private async hydrateFromSessionStorage(): Promise<void> {
    try {
      const snapshot = await chrome.storage.session.get(SESSION_STORAGE_KEY)
      this.memoryTokens = normalizeTokens(snapshot[SESSION_STORAGE_KEY])
    } catch {
      this.memoryTokens = null
    }
  }
}

export const sessionTokenVault = SessionTokenVault.getInstance()
