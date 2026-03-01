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

export interface NotebookEntry {
  id: string
  title: string
}

console.log("🚀 MindDock: Interceptor carregado no MAIN world")

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
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

function parseEmbeddedJson(value: string, parsedStrings: Set<string>): unknown | null {
  const normalizedValue = normalizeString(value)
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
  if (!notebookTitle) {
    return null
  }

  if (notebookTitle === "generic") {
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

export function findNotebooksInObject(obj: unknown): Array<{ id: string; title: string }> {
  const notebooks = new Map<string, NotebookEntry>()
  const seenObjects = new WeakSet<object>()
  const parsedStrings = new Set<string>()

  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      const embeddedJson = parseEmbeddedJson(node, parsedStrings)
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
      const notebook = extractNotebookFromArray(node)
      if (notebook) {
        upsertNotebook(notebooks, notebook)
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

function broadcastNotebookList(notebooks: NotebookEntry[]): void {
  try {
    window.postMessage(
      {
        source: MESSAGE_SOURCE,
        type: MESSAGE_TYPE,
        payload: notebooks
      },
      window.location.origin
    )
  } catch {
    // Silent by design: parsing failures must not affect the page.
  }
}

function processRawNetworkResponse(rawNetworkResponse: string): void {
  try {
    const parsedNodes = parseGoogleRpcResponse(rawNetworkResponse)
    if (parsedNodes.length === 0) {
      return
    }

    const notebooks = new Map<string, NotebookEntry>()
    for (const parsedNode of parsedNodes) {
      const extractedNotebooks = findNotebooksInObject(parsedNode)
      for (const notebook of extractedNotebooks) {
        upsertNotebook(notebooks, notebook)
      }
    }

    broadcastNotebookList(Array.from(notebooks.values()))
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

  processRawNetworkResponse(rawNetworkResponse)
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
