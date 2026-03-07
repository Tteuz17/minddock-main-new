/**
 * MindDock - ChatGPT Content Script
 * Injeta botoes de captura e envia conversa estruturada ao background.
 */

import type { PlasmoCSConfig } from "plasmo"
import type { ChromeMessageResponse } from "~/lib/types"
import {
  buildDomChatCaptureInput,
  resolveChatCaptureSuccessMessage,
  sendChatCaptureToBackground,
  UNIVERSAL_CAPTURE_RESULT_EVENT,
  UNIVERSAL_CAPTURE_REQUEST_EVENT
} from "./common/chat-capture"
import { installHighlightMessageListener } from "./common/highlight-handler"
import { createMindDockButton, showMindDockToast } from "./common/minddock-ui"
import { injectAtomizeButton } from "./common/atomize-button"

export const config: PlasmoCSConfig = {
  matches: ["https://chat.openai.com/*", "https://chatgpt.com/*"],
  world: "ISOLATED",
  run_at: "document_idle"
}

const INJECTED_ATTR = "data-minddock-btn"
const PLATFORM_LABEL = "ChatGPT"
const UNIVERSAL_CAPTURE_LISTENER_KEY = "__MINDDOCK_CHATGPT_UNIVERSAL_CAPTURE__"

const SELECTORS = {
  assistantMessage: "[data-message-author-role='assistant']",
  messageActions: ".flex.items-center.gap-1"
}

installHighlightMessageListener()

interface RunCaptureOptions {
  suppressToast?: boolean
}

function buildCaptureInput(preferredNotebookId?: string) {
  return buildDomChatCaptureInput({
    platform: "chatgpt",
    platformLabel: PLATFORM_LABEL,
    title: document.title.replace(" - ChatGPT", "").trim() || "Conversa ChatGPT",
    messageSelectors: ["[data-message-author-role]"],
    containerSelectors: ["main", "[data-testid='conversation-turns']", "div[role='main']"],
    preferredNotebookId,
    resolveRole: (element) =>
      element.getAttribute("data-message-author-role") === "assistant" ? "assistant" : "user"
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

function injectCaptureButton(messageElement: Element) {
  if (messageElement.getAttribute(INJECTED_ATTR)) {
    return
  }

  messageElement.setAttribute(INJECTED_ATTR, "true")

  const { element: button, setState } = createMindDockButton({ idleLabel: "MindDock" })
  button.title = "Enviar para o NotebookLM (MindDock)"
  button.style.marginLeft = "4px"

  button.addEventListener("click", async () => {
    setState("loading")

    const response = await runConversationCapture()
    setState(response.success ? "success" : "error")
    window.setTimeout(() => {
      setState("idle")
    }, 1800)
  })

  const actionsArea = messageElement.querySelector(SELECTORS.messageActions)
  if (actionsArea) {
    actionsArea.appendChild(button)
    return
  }

  const wrapper = document.createElement("div")
  wrapper.style.cssText = "display:flex; justify-content:flex-end; margin-top:4px;"
  wrapper.appendChild(button)
  messageElement.appendChild(wrapper)
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

function injectAtomize(messageElement: Element) {
  const actionsArea = messageElement.querySelector(SELECTORS.messageActions)
  injectAtomizeButton(
    messageElement,
    () => (messageElement as HTMLElement).innerText.trim(),
    actionsArea
  )
}

function injectAllButtons() {
  document
    .querySelectorAll(`${SELECTORS.assistantMessage}:not([${INJECTED_ATTR}])`)
    .forEach(injectCaptureButton)
  document
    .querySelectorAll(`${SELECTORS.assistantMessage}:not([data-minddock-atomize])`)
    .forEach(injectAtomize)
}

const observer = new MutationObserver(() => injectAllButtons())
observer.observe(document.body, { childList: true, subtree: true })
installUniversalCaptureListener()
injectAllButtons()

export {}
