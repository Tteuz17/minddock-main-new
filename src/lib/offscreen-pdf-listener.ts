import { MESSAGE_ACTIONS, type StandardResponse } from "~/lib/contracts"
import { bytesToBase64 } from "~/lib/base64-bytes"

interface OffscreenPdfPayload {
  text?: unknown
}

interface OffscreenPdfResult {
  base64: string
}

interface OffscreenPdfPortMessage {
  type?: unknown
  requestId?: unknown
  text?: unknown
}

interface OffscreenPdfPortResultMessage {
  type: "render-pdf-result"
  requestId: string
  success: boolean
  base64?: string
  error?: string
}

const OFFSCREEN_LISTENER_FLAG = "__MINDDOCK_OFFSCREEN_PDF_LISTENER_READY__"
const OFFSCREEN_PDF_PORT_NAME = "minddock-offscreen-pdf-port"

function buildErrorResponse(error: unknown): StandardResponse<OffscreenPdfResult> {
  return {
    success: false,
    error: error instanceof Error ? error.message : "Falha ao gerar PDF no documento offscreen."
  }
}

function buildPayloadFromMessage(message: unknown): OffscreenPdfPayload {
  if (!message || typeof message !== "object") {
    return {}
  }

  const payload = (message as { payload?: unknown }).payload
  if (!payload || typeof payload !== "object") {
    return {}
  }

  return payload as OffscreenPdfPayload
}

function resolveMessageAction(message: unknown): string {
  if (!message || typeof message !== "object") {
    return ""
  }

  const action = (message as { action?: unknown }).action
  const command = (message as { command?: unknown }).command
  return String(action ?? command ?? "").trim()
}

async function buildPdfBase64(text: string): Promise<string> {
  const { buildPdfBytesFromText } = await import("~/lib/pdf-build")
  return bytesToBase64(buildPdfBytesFromText(text))
}

export function registerOffscreenPdfListener(): void {
  const globalState = globalThis as typeof globalThis & Record<string, unknown>
  if (globalState[OFFSCREEN_LISTENER_FLAG] === true) {
    return
  }
  globalState[OFFSCREEN_LISTENER_FLAG] = true

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (resolveMessageAction(message) !== MESSAGE_ACTIONS.OFFSCREEN_RENDER_PDF) {
      return false
    }

    const payload = buildPayloadFromMessage(message)
    const text = String(payload.text ?? "")
    if (!text.trim()) {
      sendResponse({
        success: false,
        error: "Texto obrigatorio para gerar PDF no offscreen."
      } satisfies StandardResponse<OffscreenPdfResult>)
      return false
    }

    void (async () => {
      try {
        sendResponse({
          success: true,
          payload: {
            base64: await buildPdfBase64(text)
          }
        } satisfies StandardResponse<OffscreenPdfResult>)
      } catch (error) {
        sendResponse(buildErrorResponse(error))
      }
    })()

    return true
  })

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== OFFSCREEN_PDF_PORT_NAME) {
      return
    }

    port.onMessage.addListener((message: OffscreenPdfPortMessage) => {
      const type = String(message?.type ?? "").trim()
      if (type !== "render-pdf") {
        return
      }

      const requestId = String(message?.requestId ?? "").trim()
      if (!requestId) {
        port.postMessage({
          type: "render-pdf-result",
          requestId: "",
          success: false,
          error: "Request ID obrigatorio para renderizacao de PDF."
        } satisfies OffscreenPdfPortResultMessage)
        return
      }

      const text = String(message?.text ?? "")
      if (!text.trim()) {
        port.postMessage({
          type: "render-pdf-result",
          requestId,
          success: false,
          error: "Texto obrigatorio para gerar PDF no offscreen."
        } satisfies OffscreenPdfPortResultMessage)
        return
      }

      void (async () => {
        try {
          port.postMessage({
            type: "render-pdf-result",
            requestId,
            success: true,
            base64: await buildPdfBase64(text)
          } satisfies OffscreenPdfPortResultMessage)
        } catch (error) {
          port.postMessage({
            type: "render-pdf-result",
            requestId,
            success: false,
            error: error instanceof Error ? error.message : "Falha ao gerar PDF no documento offscreen."
          } satisfies OffscreenPdfPortResultMessage)
        }
      })()
    })
  })
}
