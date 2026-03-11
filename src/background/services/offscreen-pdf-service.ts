const OFFSCREEN_DOCUMENT_PATH = "popup.html?minddock_offscreen=1"
const OFFSCREEN_PDF_PORT_NAME = "minddock-offscreen-pdf-port"
const OFFSCREEN_CLOSE_DELAY_MS = 800
const OFFSCREEN_REQUEST_TIMEOUT_MS = 30_000

interface OffscreenPdfPortResultMessage {
  type?: unknown
  requestId?: unknown
  success?: unknown
  base64?: unknown
  error?: unknown
}

let offscreenCreatePromise: Promise<void> | null = null
let offscreenCloseTimer: ReturnType<typeof setTimeout> | null = null
let activeOffscreenRequests = 0

async function hasOpenOffscreenDocument(): Promise<boolean> {
  if (typeof chrome.offscreen?.hasDocument === "function") {
    try {
      return await chrome.offscreen.hasDocument()
    } catch {
      return false
    }
  }

  const clientsApi = (
    globalThis as typeof globalThis & {
      clients?: {
        matchAll?: (options: { includeUncontrolled: boolean; type: "window" }) => Promise<Array<{ url: string }>>
      }
    }
  ).clients

  if (typeof clientsApi?.matchAll !== "function") {
    return false
  }

  try {
    const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)
    const allClients = await clientsApi.matchAll({
      includeUncontrolled: true,
      type: "window"
    })
    return allClients.some((client) => client.url === offscreenUrl)
  } catch {
    return false
  }
}

function clearOffscreenCloseTimer(): void {
  if (offscreenCloseTimer !== null) {
    clearTimeout(offscreenCloseTimer)
    offscreenCloseTimer = null
  }
}

async function closeOffscreenDocument(): Promise<void> {
  if (typeof chrome.offscreen?.closeDocument !== "function") {
    return
  }

  const hasDocument = await hasOpenOffscreenDocument()
  if (!hasDocument) {
    return
  }

  try {
    await chrome.offscreen.closeDocument()
  } catch (error) {
    console.debug("[MindDock] Falha ao fechar offscreen document:", error)
  }
}

function scheduleOffscreenClose(): void {
  clearOffscreenCloseTimer()
  offscreenCloseTimer = setTimeout(() => {
    offscreenCloseTimer = null
    if (activeOffscreenRequests > 0) {
      return
    }
    void closeOffscreenDocument()
  }, OFFSCREEN_CLOSE_DELAY_MS)
}

async function ensureOffscreenDocument(): Promise<void> {
  if (typeof chrome.offscreen?.createDocument !== "function") {
    throw new Error("API chrome.offscreen indisponivel neste navegador.")
  }

  clearOffscreenCloseTimer()

  if (await hasOpenOffscreenDocument()) {
    return
  }

  if (offscreenCreatePromise) {
    await offscreenCreatePromise
    return
  }

  offscreenCreatePromise = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: "Renderizar PDF fora do content script para reduzir custo de memoria e bundle."
    })
    .finally(() => {
      offscreenCreatePromise = null
    })

  await offscreenCreatePromise
}

function buildRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

async function requestPdfBase64(text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const requestId = buildRequestId()
    const port = chrome.runtime.connect({ name: OFFSCREEN_PDF_PORT_NAME })
    let settled = false

    const finalize = (error?: Error, base64?: string): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeoutId)
      try {
        port.disconnect()
      } catch {
        // no-op
      }
      if (error) {
        reject(error)
        return
      }
      resolve(base64 ?? "")
    }

    const timeoutId = setTimeout(() => {
      finalize(new Error("Tempo limite ao gerar PDF no offscreen document."))
    }, OFFSCREEN_REQUEST_TIMEOUT_MS)

    port.onDisconnect.addListener(() => {
      if (settled) {
        return
      }
      const disconnectError = chrome.runtime.lastError?.message
      finalize(
        new Error(
          disconnectError || "Conexao com o documento offscreen foi encerrada antes da resposta de PDF."
        )
      )
    })

    port.onMessage.addListener((message: OffscreenPdfPortResultMessage) => {
      const type = String(message?.type ?? "").trim()
      if (type !== "render-pdf-result") {
        return
      }

      const incomingRequestId = String(message?.requestId ?? "").trim()
      if (incomingRequestId !== requestId) {
        return
      }

      const wasSuccessful = message?.success === true
      if (!wasSuccessful) {
        finalize(new Error(String(message?.error ?? "Offscreen retornou erro ao gerar PDF.")))
        return
      }

      const base64 = String(message?.base64 ?? "").trim()
      if (!base64) {
        finalize(new Error("Offscreen retornou PDF vazio."))
        return
      }

      finalize(undefined, base64)
    })

    try {
      port.postMessage({
        type: "render-pdf",
        requestId,
        text
      })
    } catch (error) {
      finalize(error instanceof Error ? error : new Error("Falha ao enviar requisicao para offscreen."))
    }
  })
}

export async function renderPdfBase64ViaOffscreen(text: string): Promise<string> {
  const normalized = String(text ?? "")
  if (!normalized.trim()) {
    throw new Error("Texto obrigatorio para gerar PDF.")
  }

  activeOffscreenRequests += 1
  clearOffscreenCloseTimer()

  try {
    await ensureOffscreenDocument()
    return await requestPdfBase64(normalized)
  } finally {
    activeOffscreenRequests = Math.max(0, activeOffscreenRequests - 1)
    if (activeOffscreenRequests === 0) {
      scheduleOffscreenClose()
    }
  }
}
