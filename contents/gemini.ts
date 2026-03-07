/**
 * MindDock - Gemini Content Script
 */

import type { PlasmoCSConfig } from "plasmo"
import type { ChromeMessageResponse } from "~/lib/types"
import {
  buildDomChatCaptureInput,
  getConversationTitle,
  resolveChatCaptureSuccessMessage,
  sendChatCaptureToBackground,
  UNIVERSAL_CAPTURE_RESULT_EVENT,
  UNIVERSAL_CAPTURE_REQUEST_EVENT
} from "./common/chat-capture"
import { installHighlightMessageListener } from "./common/highlight-handler"
import { createMindDockButton, showMindDockToast } from "./common/minddock-ui"
import { injectAtomizeButton } from "./common/atomize-button"

export const config: PlasmoCSConfig = {
  matches: ["https://gemini.google.com/*"],
  world: "ISOLATED",
  run_at: "document_idle"
}

const INJECTED_ATTR = "data-minddock-btn"
const PLATFORM_LABEL = "GEMINI"
const UNIVERSAL_CAPTURE_LISTENER_KEY = "__MINDDOCK_GEMINI_UNIVERSAL_CAPTURE__"

installHighlightMessageListener()

interface RunCaptureOptions {
  suppressToast?: boolean
}

function buildCaptureInput(preferredNotebookId?: string) {
  return buildDomChatCaptureInput({
    platform: "gemini",
    platformLabel: PLATFORM_LABEL,
    title: getConversationTitle("Conversa Gemini"),
    messageSelectors: [
      "user-query .query-content",
      "user-query .query-text",
      "user-query markdown-renderer",
      "user-query .markdown",
      "model-response .model-response-text",
      "model-response .response-content",
      "model-response message-content",
      "model-response markdown-renderer",
      "model-response [data-test-id='deep-research-result']",
      "model-response [data-testid='deep-research-result']",
      "model-response [class*='report-content']",
      "model-response [class*='artifact']"
    ],
    containerSelectors: ["main", "chat-window", "div[role='main']"],
    preferredNotebookId,
    resolveRole: (element) =>
      element.closest("model-response") !== null ? "assistant" : "user"
  })
}

async function submitConversationCapture(
  input: ReturnType<typeof buildCaptureInput>,
  options?: RunCaptureOptions
): Promise<ChromeMessageResponse<Record<string, unknown>>> {
  try {
    const response = await sendChatCaptureToBackground(input)

    if (response.success) {
      if (!options?.suppressToast) {
        showMindDockToast({
          message: resolveChatCaptureSuccessMessage(response),
          variant: "success"
        })
      }

      return response
    }

    if (!options?.suppressToast) {
      showMindDockToast({
        message: response.error ?? "Nao foi possivel enviar a conversa.",
        variant: "error",
        timeoutMs: 3200
      })
    }

    return response
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Erro inesperado ao capturar conversa."

    if (!options?.suppressToast) {
      showMindDockToast({
        message: errorMessage,
        variant: "error",
        timeoutMs: 3200
      })
    }

    return {
      success: false,
      error: errorMessage
    }
  }
}

async function runConversationCapture(
  preferredNotebookId?: string,
  options?: RunCaptureOptions
): Promise<ChromeMessageResponse<Record<string, unknown>>> {
  try {
    return await submitConversationCapture(buildCaptureInput(preferredNotebookId), options)
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Erro inesperado ao capturar conversa."

    if (!options?.suppressToast) {
      showMindDockToast({
        message: errorMessage,
        variant: "error",
        timeoutMs: 3200
      })
    }

    return {
      success: false,
      error: errorMessage
    }
  }
}

function injectCaptureButton(targetElement: Element) {
  if (targetElement.getAttribute(INJECTED_ATTR)) {
    return
  }

  targetElement.setAttribute(INJECTED_ATTR, "true")

  const { element: button, setState } = createMindDockButton({ idleLabel: "MindDock" })
  button.title = "Enviar para o NotebookLM (MindDock)"
  button.style.marginTop = "6px"

  button.addEventListener("click", async () => {
    setState("loading")

    const response = await runConversationCapture()
    setState(response.success ? "success" : "error")
    window.setTimeout(() => {
      setState("idle")
    }, 1800)
  })

  targetElement.appendChild(button)
}

function installUniversalCaptureListener(): void {
  const globalRecord = window as typeof window & Record<string, unknown>
  if (globalRecord[UNIVERSAL_CAPTURE_LISTENER_KEY]) {
    return
  }

  globalRecord[UNIVERSAL_CAPTURE_LISTENER_KEY] = true

  window.addEventListener(UNIVERSAL_CAPTURE_REQUEST_EVENT, (event: Event) => {
    const detail = (event as CustomEvent<{ notebookId?: unknown; requestId?: unknown }>).detail
    const notebookId = String(detail?.notebookId ?? "").trim()
    const requestId = String(detail?.requestId ?? "").trim()
    if (!notebookId) {
      return
    }

    try {
      const captureInput = buildCaptureInput(notebookId)

      if (requestId) {
        window.dispatchEvent(
          new CustomEvent(UNIVERSAL_CAPTURE_RESULT_EVENT, {
            bubbles: true,
            composed: true,
            detail: {
              requestId,
              success: true
            }
          })
        )
      }

      void submitConversationCapture(captureInput)
    } catch (error) {
      if (!requestId) {
        return
      }

      window.dispatchEvent(
        new CustomEvent(UNIVERSAL_CAPTURE_RESULT_EVENT, {
          bubbles: true,
          composed: true,
          detail: {
            requestId,
            success: false,
            error: error instanceof Error ? error.message : "Erro inesperado ao capturar conversa."
          }
        })
      )
    }
  })
}

function injectAll() {
  document.querySelectorAll(`model-response:not([${INJECTED_ATTR}])`).forEach(injectCaptureButton)
  document
    .querySelectorAll(`model-response:not([data-minddock-atomize])`)
    .forEach((el) =>
      injectAtomizeButton(el, () => (el as HTMLElement).innerText.trim())
    )
}

const observer = new MutationObserver(() => injectAll())
observer.observe(document.body, { childList: true, subtree: true })
installUniversalCaptureListener()
injectAll()

export {}
