import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["https://notebooklm.google.com/*"],
  world: "MAIN",
  run_at: "document_start"
}

const TARGET_ENDPOINT_FRAGMENT = "batchexecute"
const TARGET_RPC_ID = "wXbhsf"
const MESSAGE_SOURCE = "MINDDOCK_HOOK"
const MESSAGE_TYPE = "NOTEBOOK_LIST_UPDATED"
const INTERCEPTOR_GUARD_KEY = "__MINDDOCK_NETWORK_TRAFFIC_INTERCEPTOR__"
const XHR_URL_KEY = "__minddockTrackedRequestUrl__"
const BLOCKED_NOTEBOOK_TITLE_KEYS = new Set([
  "conversa",
  "conversas",
  "conversation",
  "conversations"
])

export interface NotebookEntry {
  id: string
  title: string
}

console.log("🚀 MindDock: Interceptor carregado no MAIN world")

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

function resolveAuthUserFromUrl(rawUrl: string): string {
  try {
    const resolvedUrl = new URL(rawUrl, window.location.origin)
    return normalizeString(resolvedUrl.searchParams.get("authuser"))
  } catch {
    return ""
  }
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

function resolveNotebookAccountHints(requestUrl: string): { accountEmail?: string; authUser?: string } {
  const authUser = resolveAuthUserFromUrl(requestUrl) || resolveAuthUserFromUrl(window.location.href)
  const accountEmail = resolveAccountEmailFromDom() || resolveAccountEmailFromWizGlobalData()

  return {
    accountEmail: accountEmail || undefined,
    authUser: authUser || undefined
  }
}

function normalizeNotebookTitleKey(value: string): string {
  return normalizeString(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function isTargetRequestUrl(requestUrl: string): boolean {
  return String(requestUrl ?? "").includes(TARGET_ENDPOINT_FRAGMENT)
}

function doesRequestTargetNotebookList(requestUrl: string): boolean {
  try {
    const resolvedUrl = new URL(requestUrl, window.location.origin)
    const rpcIds = String(resolvedUrl.searchParams.get("rpcids") ?? "")

    return rpcIds
      .split(",")
      .map((item) => item.trim())
      .includes(TARGET_RPC_ID)
  } catch {
    return false
  }
}

function scoreNotebookTitle(value: string): number {
  const normalizedValue = normalizeString(value)
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

function upsertNotebook(output: Map<string, NotebookEntry>, notebook: NotebookEntry): void {
  const existingNotebook = output.get(notebook.id)
  if (!existingNotebook) {
    output.set(notebook.id, notebook)
    return
  }

  if (scoreNotebookTitle(notebook.title) > scoreNotebookTitle(existingNotebook.title)) {
    output.set(notebook.id, notebook)
  }
}

function extractNotebookFromArray(candidate: readonly unknown[]): NotebookEntry | null {
  if (!Array.isArray(candidate) || candidate.length < 3) {
    return null
  }

  const potentialTitle = candidate[0]
  const potentialId = candidate[2]

  if (typeof potentialTitle !== "string") {
    return null
  }

  const notebookTitle = potentialTitle.trim()
  const notebookTitleKey = normalizeNotebookTitleKey(notebookTitle)
  if (!notebookTitle) {
    return null
  }

  if (notebookTitle === "generic") {
    return null
  }

  if (BLOCKED_NOTEBOOK_TITLE_KEYS.has(notebookTitleKey)) {
    return null
  }

  if (typeof potentialId !== "string") {
    return null
  }

  const notebookId = potentialId.trim()
  const normalizedNotebookId = notebookId.toLowerCase()

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

  if (notebookId.includes(" ")) {
    return null
  }

  if (notebookTitle.includes(".") && notebookTitle.length < 10) {
    return null
  }

  if (notebookId.startsWith("-")) {
    return null
  }

  if (/^\d+$/u.test(notebookId)) {
    return null
  }

  return {
    id: notebookId,
    title: notebookTitle
  }
}

function resolveRowsFromPayload(payload: unknown): unknown[][] {
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
      continue
    }

    queue.push(...Object.values(current))
  }

  return []
}

function resolveNotebookRows(payload: unknown): unknown[][] {
  const byContract = (payload as { 0?: { 1?: unknown } } | undefined)?.[0]?.[1]
  if (Array.isArray(byContract) && byContract.every((entry) => Array.isArray(entry))) {
    return byContract as unknown[][]
  }

  return resolveRowsFromPayload(payload)
}

function extractNotebookPathHints(rawResponseText: string): Set<string> {
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
      const candidateId = normalizeString(match[1])
      if (candidateId) {
        hints.add(candidateId)
      }
    }
  }

  return hints
}

export function findNotebooksInObject(
  obj: unknown,
  rawResponseText?: string
): Array<{ id: string; title: string }> {
  const notebooks = new Map<string, NotebookEntry>()
  const notebookPathHints = extractNotebookPathHints(String(rawResponseText ?? ""))
  const notebookRows = resolveNotebookRows(obj)

  for (const row of notebookRows) {
    const notebook = extractNotebookFromArray(row)
    if (!notebook) {
      continue
    }

    if (notebookPathHints.size > 0 && !notebookPathHints.has(notebook.id)) {
      continue
    }

    upsertNotebook(notebooks, notebook)
  }

  if (notebooks.size > 0) {
    return Array.from(notebooks.values())
  }

  const seenObjects = new WeakSet<object>()
  const parsedStrings = new Set<string>()

  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      const normalizedValue = normalizeString(node)
      if (!normalizedValue || parsedStrings.has(normalizedValue)) {
        return
      }

      const looksLikeJson =
        (normalizedValue.startsWith("[") && normalizedValue.endsWith("]")) ||
        (normalizedValue.startsWith("{") && normalizedValue.endsWith("}"))
      if (!looksLikeJson) {
        return
      }

      parsedStrings.add(normalizedValue)
      try {
        visit(JSON.parse(normalizedValue))
      } catch {
        // no-op
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
      const notebook = extractNotebookFromArray(node)
      if (notebook) {
        if (notebookPathHints.size === 0 || notebookPathHints.has(notebook.id)) {
          upsertNotebook(notebooks, notebook)
        }
      }

      for (const item of node) {
        visit(item)
      }
      return
    }

    for (const value of Object.values(node)) {
      visit(value)
    }
  }

  visit(obj)
  return Array.from(notebooks.values())
}

function parseGoogleRpcResponse(rawData: string): unknown[] {
  try {
    const normalizedRawData = String(rawData ?? "")
      .replace(/^\)\]\}'\s*/, "")
      .trim()

    if (!normalizedRawData) {
      return []
    }

    try {
      return [JSON.parse(normalizedRawData)]
    } catch {
      const parsedNodes: unknown[] = []

      for (const line of normalizedRawData.split("\n")) {
        const trimmedLine = line.trim()
        if (!trimmedLine) {
          continue
        }

        if (!trimmedLine.startsWith("[") && !trimmedLine.startsWith("{")) {
          continue
        }

        try {
          parsedNodes.push(JSON.parse(trimmedLine))
        } catch {
          continue
        }
      }

      return parsedNodes
    }
  } catch {
    return []
  }
}

function broadcastNotebookList(
  notebooks: NotebookEntry[],
  accountHints?: { accountEmail?: string; authUser?: string }
): void {
  try {
    window.postMessage(
      {
        source: MESSAGE_SOURCE,
        type: MESSAGE_TYPE,
        payload: {
          notebooks,
          authUser: accountHints?.authUser,
          accountEmail: accountHints?.accountEmail
        }
      },
      window.location.origin
    )
  } catch {
    // Silent by design: parsing failures must not affect the page.
  }
}

function processRawNetworkResponse(rawNetworkResponse: string, requestUrl: string): void {
  try {
    const parsedNodes = parseGoogleRpcResponse(rawNetworkResponse)
    if (parsedNodes.length === 0) {
      return
    }

    const notebooks = new Map<string, NotebookEntry>()
    for (const parsedNode of parsedNodes) {
      const extractedNotebooks = findNotebooksInObject(parsedNode, rawNetworkResponse)
      for (const notebook of extractedNotebooks) {
        upsertNotebook(notebooks, notebook)
      }
    }

    const accountHints = resolveNotebookAccountHints(requestUrl)
    broadcastNotebookList(Array.from(notebooks.values()), accountHints)
  } catch {
    // Silent by design: parsing failures must not affect the page.
  }
}

function interceptGoogleCloudRpc(requestUrl: string, rawNetworkResponse: string): void {
  if (!isTargetRequestUrl(requestUrl)) {
    return
  }

  if (!doesRequestTargetNotebookList(requestUrl)) {
    return
  }

  processRawNetworkResponse(rawNetworkResponse, requestUrl)
}

function resolveRequestUrl(requestInput: RequestInfo | URL): string {
  if (requestInput instanceof Request) {
    return requestInput.url
  }

  return String(requestInput ?? "")
}

function patchFetch(): void {
  const originalFetch = window.fetch

  window.fetch = new Proxy(originalFetch, {
    apply(target, thisArg, argArray: [RequestInfo | URL, RequestInit | undefined]) {
      const [requestInput] = argArray
      console.log("📡 Fetch detectado:", requestInput?.toString())

      const requestUrl = resolveRequestUrl(requestInput)
      const isBatchExecuteTarget = isTargetRequestUrl(requestUrl)
      if (isBatchExecuteTarget) {
        console.log("🎯 Alvo batchexecute identificado na URL:", requestUrl)
      }

      const responsePromise = Reflect.apply(target, thisArg, argArray) as Promise<Response>

      if (!isBatchExecuteTarget || !doesRequestTargetNotebookList(requestUrl)) {
        return responsePromise
      }

      return responsePromise.then((response) => {
        try {
          void response
            .clone()
            .text()
            .then((rawNetworkResponse) => {
              interceptGoogleCloudRpc(requestUrl, rawNetworkResponse)
            })
            .catch(() => {
              // Silent by design: never break the page.
            })
        } catch {
          // Silent by design: never break the page.
        }

        return response
      })
    }
  })
}

function patchXmlHttpRequest(): void {
  const originalOpen = XMLHttpRequest.prototype.open

  XMLHttpRequest.prototype.open = new Proxy(originalOpen, {
    apply(target, thisArg, argArray: [string, string | URL, ...unknown[]]) {
      const [, requestInput] = argArray
      const requestUrl = String(requestInput ?? "")

      try {
        Object.defineProperty(thisArg, XHR_URL_KEY, {
          configurable: true,
          value: requestUrl,
          writable: true
        })
      } catch {
        ;(thisArg as XMLHttpRequest & Record<string, unknown>)[XHR_URL_KEY] = requestUrl
      }

      if (isTargetRequestUrl(requestUrl) && doesRequestTargetNotebookList(requestUrl)) {
        thisArg.addEventListener(
          "loadend",
          function onLoadEnd(this: XMLHttpRequest) {
            try {
              const trackedRequestUrl = String(
                (this as XMLHttpRequest & Record<string, unknown>)[XHR_URL_KEY] ?? ""
              )
              const rawNetworkResponse =
                typeof this.responseText === "string" ? this.responseText : ""

              interceptGoogleCloudRpc(trackedRequestUrl, rawNetworkResponse)
            } catch {
              // Silent by design: never break the page.
            }
          },
          { once: true }
        )
      }

      return Reflect.apply(target, thisArg, argArray)
    }
  })
}

function bootstrapNetworkTrafficInterceptor(): void {
  const globalRecord = window as typeof window & Record<string, unknown>
  if (globalRecord[INTERCEPTOR_GUARD_KEY]) {
    return
  }

  globalRecord[INTERCEPTOR_GUARD_KEY] = true
  patchFetch()
  patchXmlHttpRequest()
}

bootstrapNetworkTrafficInterceptor()
