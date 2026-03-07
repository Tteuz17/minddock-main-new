import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["https://notebooklm.google.com/*"],
  world: "MAIN",
  run_at: "document_start"
}

const INTERCEPT_MESSAGE_TYPE = "MINDDOCK_INTERCEPT"
const INTERCEPTOR_GUARD_KEY = "__MINDDOCK_NOTEBOOKLM_TOKEN_INTERCEPTOR__"
const XHR_TRACKING_KEY = "__minddockNotebookLmInterceptorRequestMeta__"
const NOTEBOOKLM_HOST = "notebooklm.google.com"
const BATCH_EXECUTE_PATH = "/_/LabsTailwindUi/data/batchexecute"

type FetchInput = RequestInfo | URL
type FetchArgs = [input: FetchInput, init?: RequestInit]
type XhrSendBody = Document | XMLHttpRequestBodyInit | null | undefined
type TrackedXhr = XMLHttpRequest & Record<string, unknown>

interface NotebookLMPayload {
  at?: string
  bl?: string
  accountEmail?: string
  authUser?: string
  transport: "fetch" | "xhr"
  phase: "request" | "response"
  url: string
}

interface XhrTrackedMeta {
  method: string
  url: string
}

interface TokenState {
  at?: string
  bl?: string
  accountEmail?: string
  authUser?: string
}

let capturedTokens: TokenState = {}
let cachedAccountEmail = ""

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeAccountEmail(value: unknown): string {
  const normalizedValue = normalizeString(value).toLowerCase()
  if (!normalizedValue) {
    return ""
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalizedValue) ? normalizedValue : ""
}

function extractAccountEmail(value: unknown): string {
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

function resolveAccountEmailFromWizGlobalData(): string {
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

function resolveAccountEmailFromDom(): string {
  const accountElement = document.querySelector("a[aria-label*='@'], button[aria-label*='@']")
  if (!(accountElement instanceof HTMLElement)) {
    return ""
  }

  return extractAccountEmail(accountElement.getAttribute("aria-label"))
}

function resolveAccountEmail(): string {
  if (cachedAccountEmail) {
    return cachedAccountEmail
  }

  const fromDom = resolveAccountEmailFromDom()
  if (fromDom) {
    cachedAccountEmail = fromDom
    return fromDom
  }

  const fromWizGlobalData = resolveAccountEmailFromWizGlobalData()
  if (fromWizGlobalData) {
    cachedAccountEmail = fromWizGlobalData
    return fromWizGlobalData
  }

  return ""
}

function decodeEscapedToken(value: string): string {
  const normalizedValue = normalizeString(value)
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

function isNotebookLmUrl(rawUrl: string): boolean {
  try {
    const resolvedUrl = new URL(rawUrl, window.location.origin)
    return resolvedUrl.hostname.includes(NOTEBOOKLM_HOST)
  } catch {
    return normalizeString(rawUrl).includes(NOTEBOOKLM_HOST)
  }
}

function isInterceptTarget(rawUrl: string): boolean {
  const normalizedUrl = normalizeString(rawUrl)
  if (!normalizedUrl) {
    return false
  }

  return normalizedUrl.includes(BATCH_EXECUTE_PATH) || isNotebookLmUrl(normalizedUrl)
}

function resolveUrlFromInput(input: FetchInput): string {
  if (input instanceof Request) {
    return input.url
  }

  if (input instanceof URL) {
    return input.toString()
  }

  return String(input ?? "")
}

function extractAuthUserFromUrl(rawUrl: string): string | undefined {
  try {
    const resolvedUrl = new URL(rawUrl, window.location.origin)
    const authUser = normalizeString(resolvedUrl.searchParams.get("authuser"))
    return authUser || undefined
  } catch {
    return undefined
  }
}

function extractTokensFromQuery(rawUrl: string): TokenState {
  try {
    const resolvedUrl = new URL(rawUrl, window.location.origin)
    return {
      bl: normalizeString(resolvedUrl.searchParams.get("bl")) || undefined,
      accountEmail: normalizeAccountEmail(resolvedUrl.searchParams.get("email")) || undefined,
      authUser: normalizeString(resolvedUrl.searchParams.get("authuser")) || undefined
    }
  } catch {
    return {}
  }
}

function extractTokensFromHtml(html: string): TokenState {
  const atMatch = html.match(/"SNlM0e":"([^"]+)"/)
  const blMatch = html.match(/"cfb2h":"([^"]+)"/)

  const at = decodeEscapedToken(atMatch?.[1] ?? "")
  const bl = decodeEscapedToken(blMatch?.[1] ?? "")

  return {
    at: at || undefined,
    bl: bl || undefined
  }
}

function extractTokensFromFormEncoded(bodyText: string): TokenState {
  const normalizedBodyText = normalizeString(bodyText)
  if (!normalizedBodyText) {
    return {}
  }

  const params = new URLSearchParams(normalizedBodyText)
  const at = normalizeString(params.get("at"))
  const bl = normalizeString(params.get("bl"))
  const htmlTokens = extractTokensFromHtml(normalizedBodyText)

  return {
    at: at || htmlTokens.at,
    bl: bl || htmlTokens.bl
  }
}

async function readBodyTextFromFetchRequest(input: FetchInput, init?: RequestInit): Promise<string> {
  if (input instanceof Request) {
    try {
      return await input.clone().text()
    } catch {
      return ""
    }
  }

  const body = init?.body
  if (typeof body === "string") {
    return body
  }

  if (body instanceof URLSearchParams) {
    return body.toString()
  }

  if (body instanceof FormData) {
    const formParams = new URLSearchParams()

    for (const [key, value] of body.entries()) {
      if (typeof value === "string") {
        formParams.append(key, value)
      }
    }

    return formParams.toString()
  }

  if (body instanceof Blob) {
    try {
      return await body.text()
    } catch {
      return ""
    }
  }

  return ""
}

async function readBodyTextFromXhrSend(body: XhrSendBody): Promise<string> {
  if (typeof body === "string") {
    return body
  }

  if (body instanceof URLSearchParams) {
    return body.toString()
  }

  if (body instanceof FormData) {
    const formParams = new URLSearchParams()

    for (const [key, value] of body.entries()) {
      if (typeof value === "string") {
        formParams.append(key, value)
      }
    }

    return formParams.toString()
  }

  if (body instanceof Blob) {
    try {
      return await body.text()
    } catch {
      return ""
    }
  }

  return ""
}

function postInterceptPayload(
  nextTokens: TokenState,
  context: Omit<NotebookLMPayload, "at" | "bl" | "accountEmail" | "authUser">
): void {
  const at = normalizeString(nextTokens.at)
  const bl = normalizeString(nextTokens.bl)
  const accountEmail =
    normalizeAccountEmail(nextTokens.accountEmail) ||
    resolveAccountEmail() ||
    normalizeAccountEmail(capturedTokens.accountEmail) ||
    ""
  const authUser =
    normalizeString(nextTokens.authUser) ||
    extractAuthUserFromUrl(context.url) ||
    extractAuthUserFromUrl(window.location.href) ||
    ""

  if (at) {
    capturedTokens.at = at
  }

  if (bl) {
    capturedTokens.bl = bl
  }

  if (accountEmail) {
    capturedTokens.accountEmail = accountEmail
  }

  if (authUser) {
    capturedTokens.authUser = authUser
  }

  const payload: NotebookLMPayload = {
    ...context,
    at: capturedTokens.at,
    bl: capturedTokens.bl,
    accountEmail: capturedTokens.accountEmail,
    authUser: capturedTokens.authUser
  }

  if (!payload.at && !payload.bl) {
    return
  }

  try {
    window.postMessage(
      {
        type: INTERCEPT_MESSAGE_TYPE,
        payload
      },
      "*"
    )
  } catch {
    // Silent by design: interception errors must not affect the page.
  }
}

async function inspectFetchRequest(input: FetchInput, init?: RequestInit): Promise<void> {
  const requestUrl = resolveUrlFromInput(input)
  if (!isInterceptTarget(requestUrl)) {
    return
  }

  const queryTokens = extractTokensFromQuery(requestUrl)
  postInterceptPayload(queryTokens, {
    transport: "fetch",
    phase: "request",
    url: requestUrl
  })

  const requestBodyText = await readBodyTextFromFetchRequest(input, init)
  const bodyTokens = extractTokensFromFormEncoded(requestBodyText)
  postInterceptPayload(bodyTokens, {
    transport: "fetch",
    phase: "request",
    url: requestUrl
  })
}

async function inspectFetchResponse(requestUrl: string, response: Response): Promise<void> {
  if (!isInterceptTarget(requestUrl)) {
    return
  }

  try {
    const responseText = await response.clone().text()
    const htmlTokens = extractTokensFromHtml(responseText)
    postInterceptPayload(htmlTokens, {
      transport: "fetch",
      phase: "response",
      url: requestUrl
    })
  } catch {
    // Silent by design: cloned response reads must never affect the real request.
  }
}

function patchFetch(): void {
  const originalFetch = window.fetch

  window.fetch = function patchedFetch(this: WindowOrWorkerGlobalScope, ...args: FetchArgs): Promise<Response> {
    const [input, init] = args
    const requestUrl = resolveUrlFromInput(input)

    try {
      void inspectFetchRequest(input, init)
    } catch {
      // Silent by design: never block the page request.
    }

    const responsePromise = originalFetch.apply(this, args)

    return responsePromise.then(
      (response) => {
        try {
          void inspectFetchResponse(requestUrl, response)
        } catch {
          // Silent by design: never block the page response.
        }

        return response
      },
      (error) => {
        throw error
      }
    )
  }
}

function patchXmlHttpRequest(): void {
  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send

  XMLHttpRequest.prototype.open = function patchedOpen(
    this: TrackedXhr,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ): void {
    const requestUrl = String(url ?? "")

    try {
      const trackedMeta: XhrTrackedMeta = {
        method: String(method ?? "").trim().toUpperCase(),
        url: requestUrl
      }

      this[XHR_TRACKING_KEY] = trackedMeta

      if (isInterceptTarget(requestUrl)) {
        this.addEventListener(
          "load",
          function onLoad(this: XMLHttpRequest) {
            try {
              const htmlTokens = extractTokensFromHtml(
                typeof this.responseText === "string" ? this.responseText : ""
              )

              postInterceptPayload(htmlTokens, {
                transport: "xhr",
                phase: "response",
                url: requestUrl
              })
            } catch {
              // Silent by design: response parsing must not affect the page.
            }
          },
          { once: true }
        )
      }
    } catch {
      // Silent by design: metadata tracking must never break XHR setup.
    }

    originalOpen.call(this, method, url, async ?? true, username ?? null, password ?? null)
  }

  XMLHttpRequest.prototype.send = function patchedSend(this: TrackedXhr, body?: XhrSendBody): void {
    try {
      const trackedMeta =
        typeof this[XHR_TRACKING_KEY] === "object" && this[XHR_TRACKING_KEY] !== null
          ? (this[XHR_TRACKING_KEY] as XhrTrackedMeta)
          : null

      if (trackedMeta && isInterceptTarget(trackedMeta.url)) {
        postInterceptPayload(extractTokensFromQuery(trackedMeta.url), {
          transport: "xhr",
          phase: "request",
          url: trackedMeta.url
        })

        void readBodyTextFromXhrSend(body)
          .then((bodyText) => {
            const bodyTokens = extractTokensFromFormEncoded(bodyText)
            postInterceptPayload(bodyTokens, {
              transport: "xhr",
              phase: "request",
              url: trackedMeta.url
            })
          })
          .catch(() => {
            // Silent by design: body reads must not affect the page.
          })
      }
    } catch {
      // Silent by design: request inspection must never break XHR send.
    }

    originalSend.call(this, body)
  }
}

function bootstrapNotebookLmInterceptor(): void {
  const globalRecord = window as typeof window & Record<string, unknown>
  if (globalRecord[INTERCEPTOR_GUARD_KEY]) {
    return
  }

  globalRecord[INTERCEPTOR_GUARD_KEY] = true

  try {
    patchFetch()
  } catch {
    // Silent by design: if patching fails, the page must keep working.
  }

  try {
    patchXmlHttpRequest()
  } catch {
    // Silent by design: if patching fails, the page must keep working.
  }
}

bootstrapNotebookLmInterceptor()
