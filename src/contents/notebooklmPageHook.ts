import type { PlasmoCSConfig } from "plasmo"
import { STUDIO_LIST_TYPE_LABELS_PT_NUMERIC } from "~/shared/studioTypes"

export const config: PlasmoCSConfig = {
  matches: ["https://notebooklm.google.com/*"],
  world: "MAIN",
  run_at: "document_start",
  all_frames: true
}

const PAGE_HOOK_FLAG = "__MINDDOCK_PAGE_HOOK_INSTALLED__"
const alreadyInstalled = Boolean((window as unknown as Record<string, unknown>)[PAGE_HOOK_FLAG])

if (!alreadyInstalled) {
  ;(window as unknown as Record<string, unknown>)[PAGE_HOOK_FLAG] = true
  installPageHook()
}

function installPageHook() {
  const CONTEXT_KEY = "__minddock_rpc_context"
  const STUDIO_LIST_RPC_ID = "gArtLc"
  const STUDIO_LIST_FILTER = 'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"'
  const BATCHEXECUTE_URL = "https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute"
  const BATCHEXECUTE_PATH = "/_/LabsTailwindUi/data/batchexecute"
  const PDF_HINT_RE = /application\/pdf|\.pdf|googleusercontent/i
  const NATIVE_SLIDES_DOWNLOAD_TYPE = "MINDDOCK_NATIVE_SLIDES_DOWNLOAD_URL"
  const NATIVE_SLIDES_CAPTURE_ONLY_EVENT = "MINDDOCK_NATIVE_SLIDES_CAPTURE_ONLY"
  const NATIVE_SLIDES_DOWNLOAD_RE = /^https:\/\/contribution\.usercontent\.google\.com\/download\?/i
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  const AT_PATTERN = /AIX[A-Za-z0-9_\-]{10,}:[0-9]{10,}/

  let __pendingStudioNotebookId: string | null = null
  let __retryTimer: ReturnType<typeof setTimeout> | null = null
  let __retryCount = 0
  const MAX_RETRIES = 20
  const RETRY_INTERVAL_MS = 300

  function debugLog(...args: unknown[]) {
    void args
  }

  // ─── LÊ at DIRETO DO WIZ_global_data ─────────────────────────────────────
  // O NotebookLM expõe o at token aqui — disponível imediatamente na página.
  function readAtFromPage(): string | null {
    try {
      const wiz = (window as any).WIZ_global_data
      if (wiz && typeof wiz === "object") {
        // Procura direto nas keys do objeto
        for (const val of Object.values(wiz)) {
          if (typeof val === "string" && AT_PATTERN.test(val)) {
            return val
          }
        }
        // Fallback: serializa e extrai com regex
        const str = JSON.stringify(wiz)
        const match = str.match(AT_PATTERN)
        if (match) return match[0]
      }
    } catch {}

    // Fallback secundário: lê do HTML (mais lento mas confiável)
    try {
      const html = document.documentElement.innerHTML
      const match = html.match(AT_PATTERN)
      if (match) return match[0]
    } catch {}

    return null
  }

  function hasRpcContextReady(ctx: any) {
    return Boolean(ctx?.fSid && ctx?.bl && ctx?.sourcePath)
  }

  function hasAt(ctx: any) {
    return typeof ctx?.at === "string" && ctx.at.length > 10
  }

  // Tenta pegar o at do WIZ_global_data e injetar no contexto
  function tryInjectAtFromPage(): boolean {
    const at = readAtFromPage()
    if (!at) return false

    const prev = (window as unknown as Record<string, unknown>)[CONTEXT_KEY] ?? ({} as any)
    if ((prev as any).at === at) return true // já tinha, nada a fazer

    debugLog("✅ at lido do WIZ_global_data:", at.slice(0, 25) + "…")
    updateContext({ at })
    return true
  }

  function queueStudioListFetch(notebookId: string, reason: string) {
    __pendingStudioNotebookId = notebookId
    __retryCount = 0
    if (__retryTimer) clearTimeout(__retryTimer)

    // Tenta injetar o at imediatamente antes de qualquer retry
    tryInjectAtFromPage()
    flushStudioListFetch(reason)
  }

  function flushStudioListFetch(reason: string) {
    const ctx = (window as unknown as Record<string, unknown>)[CONTEXT_KEY] ?? {}
    if (!__pendingStudioNotebookId) return

    // Sempre tenta pegar o at antes de checar
    if (!hasAt(ctx)) tryInjectAtFromPage()

    const ctxNow = (window as unknown as Record<string, unknown>)[CONTEXT_KEY] ?? {}

    if (!hasRpcContextReady(ctxNow)) {
      debugLog("context not ready (fSid/bl/sourcePath missing)")
      scheduleRetry()
      return
    }

    if (!hasAt(ctxNow)) {
      debugLog("⏳ at ainda não disponível, retry", __retryCount)
      scheduleRetry()
      return
    }

    // Tudo pronto
    const notebookId = __pendingStudioNotebookId
    __pendingStudioNotebookId = null
    __retryCount = 0
    if (__retryTimer) {
      clearTimeout(__retryTimer)
      __retryTimer = null
    }

    debugLog("🚀 disparando gArtLc com at ✅")
    void fetchStudioListInPage(notebookId, ctxNow as any, reason)
  }

  function scheduleRetry() {
    if (__retryCount < MAX_RETRIES) {
      __retryCount++
      __retryTimer = setTimeout(() => flushStudioListFetch("retry"), RETRY_INTERVAL_MS)
    } else {
      // Último recurso: dispara sem at
      const ctx = (window as unknown as Record<string, unknown>)[CONTEXT_KEY] ?? {}
      if (!hasRpcContextReady(ctx)) return
      const notebookId = __pendingStudioNotebookId
      if (!notebookId) return
      __pendingStudioNotebookId = null
      debugLog("⚠️ disparando sem at após max retries")
      void fetchStudioListInPage(notebookId, ctx as any, "no-at-fallback")
    }
  }

  function updateContext(partial: Record<string, unknown>) {
    const prev = (window as unknown as Record<string, unknown>)[CONTEXT_KEY] ?? {}
    const next = { ...(prev as object) } as Record<string, unknown>

    for (const [key, value] of Object.entries(partial)) {
      if (value !== undefined && value !== null && value !== "") {
        next[key] = value
      }
    }

    next.updatedAt = Date.now()
    ;(window as unknown as Record<string, unknown>)[CONTEXT_KEY] = next
    try {
      window.postMessage({ source: "minddock", type: "MINDDOCK_RPC_CONTEXT", payload: next }, "*")
    } catch {}
    flushStudioListFetch("ctx-updated")
  }

  function rememberFromUrlAndBody(urlText: string, bodyText?: string) {
    try {
      const url = new URL(urlText, window.location.href)
      const patch: Record<string, unknown> = {}

      const fSid = url.searchParams.get("f.sid")
      if (fSid) patch.fSid = fSid

      const bl = url.searchParams.get("bl")
      if (bl) patch.bl = bl

      const hl = url.searchParams.get("hl")
      if (hl) patch.hl = hl

      const sourcePath = url.searchParams.get("source-path")
      if (sourcePath) patch.sourcePath = sourcePath

      const socApp = url.searchParams.get("soc-app")
      if (socApp) patch.socApp = socApp

      const socPlatform = url.searchParams.get("soc-platform")
      if (socPlatform) patch.socPlatform = socPlatform

      const socDevice = url.searchParams.get("soc-device")
      if (socDevice) patch.socDevice = socDevice

      // Captura at do body também (quando disponível)
      if (bodyText) {
        const match = bodyText.match(/(?:^|&)at=([^&]+)/)
        if (match) {
          try {
            const decoded = decodeURIComponent(match[1])
            if (decoded.length >= 20) patch.at = decoded
          } catch {}
        }
      }

      if (Object.keys(patch).length > 0) updateContext(patch)
    } catch {}
  }

  function logRpcDiagnostics(urlText: string) {
    try {
      const url = new URL(urlText, window.location.href)
      if (!url.pathname.includes(BATCHEXECUTE_PATH)) return
      console.log("[MD-RPC]", {
        rpcids: url.searchParams.get("rpcids"),
        sourcePath: url.searchParams.get("source-path"),
        reqid: url.searchParams.get("_reqid"),
        authuser: url.searchParams.get("authuser"),
      })
    } catch {}
  }

  function logRpcPdfHit(urlText: string, rawText: string) {
    try {
      const url = new URL(urlText, window.location.href)
      if (!url.pathname.includes(BATCHEXECUTE_PATH)) return
      if (!PDF_HINT_RE.test(rawText)) return
      console.log("[MD-RPC-PDF-HIT]", {
        url: url.toString(),
        rpcids: url.searchParams.get("rpcids"),
        sourcePath: url.searchParams.get("source-path"),
        sample: String(rawText ?? "").slice(0, 1500),
      })
    } catch {}
  }

  function installNativeSlidesDownloadCapture(): void {
    const globalRecord = window as unknown as Record<string, unknown>
    if (globalRecord.__mdNativeDlInstalled) return
    globalRecord.__mdNativeDlInstalled = true
    if (typeof globalRecord.__mdNativeDlCaptureOnlyUntil !== "number") {
      globalRecord.__mdNativeDlCaptureOnlyUntil = 0
    }

    const isNativeDl = (value: string): boolean => {
      const normalized = String(value ?? "").trim()
      return Boolean(normalized) && NATIVE_SLIDES_DOWNLOAD_RE.test(normalized)
    }

    const isCaptureOnlyMode = (): boolean => {
      const until = Number(globalRecord.__mdNativeDlCaptureOnlyUntil ?? 0)
      return Number.isFinite(until) && until > Date.now()
    }

    const resolveNotebookId = (): string => {
      const path = String(location.pathname ?? "")
      const uuidHit = path.match(UUID_RE)?.[0]
      if (uuidHit) return uuidHit
      const parts = path.split("/").filter(Boolean)
      return String(parts[parts.length - 1] ?? "").trim()
    }

    const emitNativeUrl = (url: string, from: string): void => {
      try {
        const notebookId = resolveNotebookId()
        window.postMessage(
          {
            source: "minddock",
            type: NATIVE_SLIDES_DOWNLOAD_TYPE,
            payload: { url, from, ts: Date.now(), notebookId }
          },
          "*"
        )
      } catch {}
    }

    const oldOpen = window.open
    window.open = function patchedWindowOpen(url?: string | URL | null, ...rest: unknown[]) {
      const normalized = url ? String(url) : ""
      if (normalized && isNativeDl(normalized)) {
        emitNativeUrl(normalized, "window-open")
        if (isCaptureOnlyMode()) {
          return null
        }
      }
      return oldOpen.call(this, url as string | URL | undefined, ...(rest as []))
    }

    const oldAnchorClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function patchedAnchorClick(...args: unknown[]) {
      const href = String(this.href ?? "").trim()
      if (href && isNativeDl(href)) {
        emitNativeUrl(href, "anchor-proto-click")
        if (isCaptureOnlyMode()) {
          return
        }
      }
      return oldAnchorClick.apply(this, args as [])
    }

    document.addEventListener(
      "click",
      (ev) => {
        const target = ev.target as HTMLElement | null
        const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null
        const href = String(anchor?.href ?? "").trim()
        if (href && isNativeDl(href)) {
          if (isCaptureOnlyMode()) {
            ev.preventDefault()
            ev.stopPropagation()
            try {
              ;(ev as Event & { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.()
            } catch {}
          }
          emitNativeUrl(href, "dom-click")
        }
      },
      true
    )
  }

  function buildListPayload(notebookId: string): unknown[] {
    return [
      [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]], [[2, 1, 3]]],
      notebookId,
      STUDIO_LIST_FILTER
    ]
  }

  function parseBatchexecuteFrames(rawText: string): unknown[][] {
    const text = String(rawText ?? "").replace(/^\)\]\}'\s*/, "").trim()
    const frames: unknown[][] = []
    const visit = (node: unknown) => {
      if (!Array.isArray(node)) return
      if (node.length >= 3 && node[0] === "wrb.fr") frames.push(node)
      for (const child of node) visit(child)
    }
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || (!trimmed.startsWith("[") && !trimmed.startsWith("{"))) continue
      try {
        visit(JSON.parse(trimmed))
      } catch {}
    }
    return frames
  }

  const STUDIO_TYPE_MAP: Record<number, string> = STUDIO_LIST_TYPE_LABELS_PT_NUMERIC

  function extractListItemsFromPayload(payload: unknown) {
    const out: { id: string; title: string; type?: number; typeLabel?: string }[] = []
    const visit = (node: unknown) => {
      if (!Array.isArray(node)) return
      if (
        node.length >= 2 &&
        typeof node[0] === "string" &&
        typeof node[1] === "string" &&
        UUID_RE.test(node[0]) &&
        node[1].length >= 3
      ) {
        const typeId = typeof node[2] === "number" ? node[2] : undefined
        out.push({
          id: node[0],
          title: node[1],
          type: typeId,
          typeLabel: typeId !== undefined ? STUDIO_TYPE_MAP[typeId] ?? `Tipo ${typeId}` : undefined
        })
        return
      }
      for (const child of node) visit(child)
    }
    visit(payload)
    return out
  }

  function handleStudioListResponse(rawText: string) {
    const frames = parseBatchexecuteFrames(rawText)
    const items: { id: string; title: string; type?: number; typeLabel?: string }[] = []

    for (const frame of frames) {
      if (String(frame[1]) !== STUDIO_LIST_RPC_ID) continue
      const payloadStr = typeof frame[2] === "string" ? frame[2] : ""
      try {
        const payload = JSON.parse(payloadStr)
        items.push(...extractListItemsFromPayload(payload))
      } catch {}
    }

    debugLog("gArtLc result:", items.length, "items →", items.map((i) => i.title))

    if (items.length > 0) {
      window.postMessage(
        { source: "minddock", type: "MINDDOCK_STUDIO_LIST_UPDATED", payload: { items } },
        "*"
      )
    } else {
      debugLog("gArtLc vazio. raw head:", String(rawText).slice(0, 300))
      window.postMessage({ source: "minddock", type: "MINDDOCK_STUDIO_LIST_EMPTY" }, "*")
    }
  }

  async function fetchStudioListInPage(notebookId: string, ctx: any, reason: string) {
    debugLog("fetching", { reason, notebookId, hasAt: hasAt(ctx) })

    const sourcePath = typeof ctx.sourcePath === "string" ? ctx.sourcePath : `/notebook/${notebookId}`

    const url = new URL(BATCHEXECUTE_URL)
    url.searchParams.set("rpcids", STUDIO_LIST_RPC_ID)
    url.searchParams.set("source-path", sourcePath)
    url.searchParams.set("bl", ctx.bl)
    url.searchParams.set("f.sid", ctx.fSid)
    url.searchParams.set("rt", "c")
    url.searchParams.set("_reqid", String(Math.floor(100000 + Math.random() * 900000)))

    const authUser = new URL(window.location.href).searchParams.get("authuser")
    if (authUser) url.searchParams.set("authuser", authUser)
    if (typeof ctx.hl === "string") url.searchParams.set("hl", ctx.hl)
    if (typeof ctx.socApp === "string") url.searchParams.set("soc-app", ctx.socApp)
    if (typeof ctx.socPlatform === "string") url.searchParams.set("soc-platform", ctx.socPlatform)
    if (typeof ctx.socDevice === "string") url.searchParams.set("soc-device", ctx.socDevice)

    const fReq = JSON.stringify([
      [[STUDIO_LIST_RPC_ID, JSON.stringify(buildListPayload(notebookId)), null, "generic"]]
    ])

    const bodyParams = new URLSearchParams({ "f.req": fReq })
    if (hasAt(ctx)) {
      bodyParams.set("at", ctx.at)
      debugLog("✅ at incluído no request")
    }

    void fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      credentials: "include",
      body: bodyParams
    })
      .then((res) => {
        if (!res.ok) debugLog("❌ HTTP", res.status)
        return res.text()
      })
      .then((raw) => handleStudioListResponse(raw))
      .catch((err) => debugLog("fetch error:", err))
  }

  // ─── INTERCEPT FETCH (mantido para capturar fSid/bl/sourcePath) ──────────
  const originalFetch = window.fetch
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    let requestUrl = ""
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
          ? input.url
          : String(input)
      requestUrl = url

      if (url.includes(BATCHEXECUTE_PATH)) {
        logRpcDiagnostics(url)
        const serializeBody = (): string | undefined => {
          const body = init?.body
          if (typeof body === "string") return body
          if (body instanceof URLSearchParams) return body.toString()
          if (body instanceof FormData) {
            const parts: string[] = []
            ;(body as FormData).forEach((v, k) => {
              parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
            })
            return parts.join("&")
          }
          return undefined
        }

        const bodyText = serializeBody()
        if (bodyText) {
          rememberFromUrlAndBody(url, bodyText)
        } else if (input instanceof Request) {
          try {
            input
              .clone()
              .text()
              .then((text) => {
                if (text) rememberFromUrlAndBody(url, text)
              })
              .catch(() => {})
          } catch {}
        }
      }
    } catch {}
    const responsePromise = originalFetch.apply(this, arguments as any)
    try {
      if (requestUrl.includes(BATCHEXECUTE_PATH)) {
        responsePromise
          .then((res) =>
            res
              .clone()
              .text()
              .then((raw) => logRpcPdfHit(requestUrl, raw))
              .catch(() => {})
          )
          .catch(() => {})
      }
    } catch {}
    return responsePromise
  }

  // ─── INTERCEPT XHR ───────────────────────────────────────────────────────
  const originalOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method: string, url: string) {
    try {
      ;(this as any).__minddock_url = url
    } catch {}
    return originalOpen.apply(this, arguments as any)
  }

  const originalSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.send = function (body?: Document | BodyInit | null) {
    try {
      const url = (this as any).__minddock_url as string | undefined
      if (url?.includes(BATCHEXECUTE_PATH)) {
        logRpcDiagnostics(url)
        let bodyText: string | undefined
        if (typeof body === "string") bodyText = body
        else if (body instanceof URLSearchParams) bodyText = body.toString()
        else if (body instanceof FormData) {
          const parts: string[] = []
          ;(body as FormData).forEach((v, k) => {
            parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          })
          bodyText = parts.join("&")
        }
        if (bodyText) rememberFromUrlAndBody(url, bodyText)

        this.addEventListener(
          "loadend",
          () => {
            try {
              if (typeof this.responseText === "string") {
                logRpcPdfHit(url, this.responseText)
              }
            } catch {}
          },
          { once: true }
        )
      }
    } catch {}
    return originalSend.apply(this, arguments as any)
  }

  installNativeSlidesDownloadCapture()

  const applyNativeSlidesCaptureOnlyTtl = (ttlMsRaw: unknown): void => {
    const ttlMsNumber = Number(ttlMsRaw ?? 3000)
    const ttlMs = Number.isFinite(ttlMsNumber) ? Math.max(300, Math.min(10000, ttlMsNumber)) : 3000
    ;(window as unknown as Record<string, unknown>).__mdNativeDlCaptureOnlyUntil = Date.now() + ttlMs
  }

  window.addEventListener(
    NATIVE_SLIDES_CAPTURE_ONLY_EVENT,
    (event) => {
      const customEvent = event as CustomEvent<{ ttlMs?: number } | undefined>
      applyNativeSlidesCaptureOnlyTtl(customEvent.detail?.ttlMs)
    },
    true
  )

  // ─── LISTENER ────────────────────────────────────────────────────────────
  window.addEventListener("message", (event) => {
    if (event.source !== window) return
    const data = (event as MessageEvent).data as {
      source?: string
      type?: string
      payload?: { notebookId?: string; ttlMs?: number }
    } | null
    if (!data || data.source !== "minddock") return
    if (data.type === NATIVE_SLIDES_CAPTURE_ONLY_EVENT) {
      applyNativeSlidesCaptureOnlyTtl(data.payload?.ttlMs)
      return
    }
    if (data.type !== "MINDDOCK_FETCH_STUDIO_LIST") return

    debugLog("MINDDOCK_FETCH_STUDIO_LIST", data.payload)
    const notebookId = data.payload?.notebookId
    if (notebookId) queueStudioListFetch(notebookId, "message")
  })
}


