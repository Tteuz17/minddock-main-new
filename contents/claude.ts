/**
 * MindDock - Claude Content Script
 */

import type { PlasmoCSConfig } from "plasmo"
import type { ChromeMessageResponse } from "~/lib/types"
import {
  buildDomChatCaptureInputAsync,
  resolveChatCaptureSuccessMessage,
  sendChatCaptureToBackground,
  UNIVERSAL_CAPTURE_RESULT_EVENT,
  UNIVERSAL_CAPTURE_REQUEST_EVENT
} from "./common/chat-capture"
import { installHighlightMessageListener } from "./common/highlight-handler"
import { createMindDockButton, showMindDockToast } from "./common/minddock-ui"
import { injectAtomizeButton } from "./common/atomize-button"

export const config: PlasmoCSConfig = {
  matches: ["https://claude.ai/*"],
  world: "ISOLATED",
  run_at: "document_idle"
}

const INJECTED_ATTR = "data-minddock-btn"
const PLATFORM_LABEL = "Claude"
const UNIVERSAL_CAPTURE_LISTENER_KEY = "__MINDDOCK_CLAUDE_UNIVERSAL_CAPTURE__"

const SELECTORS = {
  assistantMessage: '[data-testid="assistant-message"]'
}

installHighlightMessageListener()

interface RunCaptureOptions {
  suppressToast?: boolean
}

async function buildCaptureInput(preferredNotebookId?: string) {
  return buildDomChatCaptureInputAsync({
    platform: "claude",
    platformLabel: PLATFORM_LABEL,
    title: document.title.replace(" - Claude", "").trim() || "Conversa Claude",
    messageSelectors: ["[data-testid='user-message']", "[data-testid='assistant-message']"],
    containerSelectors: ["main", "div[role='main']", "[data-testid='chat-messages']"],
    preferredNotebookId,
    resolveRole: (element) =>
      element.getAttribute("data-testid")?.includes("assistant") ? "assistant" : "user"
  })
}

async function submitConversationCapture(
  input: Awaited<ReturnType<typeof buildCaptureInput>>,
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
    const input = await buildCaptureInput(preferredNotebookId)
    return await submitConversationCapture(input, options)
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
      const captureInputPromise = buildCaptureInput(notebookId)

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

      void captureInputPromise
        .then((captureInput) => submitConversationCapture(captureInput))
        .catch((error) => {
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
        })
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
  document
    .querySelectorAll(`${SELECTORS.assistantMessage}:not([${INJECTED_ATTR}])`)
    .forEach(injectCaptureButton)
  document
    .querySelectorAll(`${SELECTORS.assistantMessage}:not([data-minddock-atomize])`)
    .forEach((el) =>
      injectAtomizeButton(el, () => (el as HTMLElement).innerText.trim())
    )
}

const observer = new MutationObserver(() => injectAll())
observer.observe(document.body, { childList: true, subtree: true })
installUniversalCaptureListener()
injectAll()

export {}
