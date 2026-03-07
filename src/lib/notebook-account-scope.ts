export const NOTEBOOK_ACCOUNT_DEFAULT = "authuser:default"
export const NOTEBOOK_ACCOUNT_EMAIL_PREFIX = "email:"

const EMAIL_MATCHER = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu
const STRICT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

function normalizeString(value: unknown): string {
  return String(value ?? "").trim()
}

export function normalizeAuthUser(value: unknown): string | null {
  const normalizedValue = normalizeString(value)
  return normalizedValue || null
}

export function normalizeAccountEmail(value: unknown): string | null {
  const normalizedValue = normalizeString(value).toLowerCase()
  if (!normalizedValue) {
    return null
  }

  return STRICT_EMAIL_PATTERN.test(normalizedValue) ? normalizedValue : null
}

export function extractAccountEmail(value: unknown): string | null {
  const normalizedValue = normalizeString(value)
  if (!normalizedValue) {
    return null
  }

  const directEmail = normalizeAccountEmail(normalizedValue)
  if (directEmail) {
    return directEmail
  }

  const match = normalizedValue.match(EMAIL_MATCHER)
  return normalizeAccountEmail(match?.[0] ?? "")
}

function isAccountIdentity(value: unknown): value is { accountEmail?: unknown; authUser?: unknown } {
  return typeof value === "object" && value !== null
}

export function buildNotebookAccountKey(
  accountIdentity: { accountEmail?: unknown; authUser?: unknown } | unknown
): string {
  const identity = isAccountIdentity(accountIdentity)
    ? accountIdentity
    : { authUser: accountIdentity }

  const normalizedAccountEmail = normalizeAccountEmail(identity.accountEmail)
  if (normalizedAccountEmail) {
    return `${NOTEBOOK_ACCOUNT_EMAIL_PREFIX}${normalizedAccountEmail}`
  }

  const normalizedAuthUser = normalizeAuthUser(identity.authUser)
  return normalizedAuthUser ? `authuser:${normalizedAuthUser}` : NOTEBOOK_ACCOUNT_DEFAULT
}

export function isDefaultNotebookAccountKey(accountKey: string): boolean {
  return normalizeString(accountKey) === NOTEBOOK_ACCOUNT_DEFAULT
}

export function isConfirmedNotebookAccountKey(accountKey: string): boolean {
  return normalizeString(accountKey).startsWith(NOTEBOOK_ACCOUNT_EMAIL_PREFIX)
}

export function buildScopedStorageKey(baseKey: string, accountKey: string): string {
  const normalizedBaseKey = normalizeString(baseKey)
  const normalizedAccountKey = normalizeString(accountKey) || NOTEBOOK_ACCOUNT_DEFAULT
  return `${normalizedBaseKey}::${normalizedAccountKey}`
}

export function resolveAuthUserFromUrl(urlLike: unknown): string | null {
  const rawUrl = normalizeString(urlLike)
  if (!rawUrl) {
    return null
  }

  try {
    const absolute = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(rawUrl)
    const resolvedUrl = absolute ? new URL(rawUrl) : new URL(rawUrl, "https://notebooklm.google.com")
    return normalizeAuthUser(resolvedUrl.searchParams.get("authuser"))
  } catch {
    return null
  }
}
