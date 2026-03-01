/**
 * MindDock - Claude Content Script
 */

import type { PlasmoCSConfig } from "plasmo"
import type { AIChatMessage } from "~/lib/types"
import { sendChatCaptureToBackground } from "./common/chat-capture"
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

const SELECTORS = {
  assistantMessage: '[data-testid="assistant-message"]'
}

installHighlightMessageListener()

function captureConversation(): AIChatMessage[] {
  const messages: AIChatMessage[] = []

  document
    .querySelectorAll("[data-testid='user-message'], [data-testid='assistant-message']")
    .forEach((element) => {
      const role = element.getAttribute("data-testid")?.includes("assistant")
        ? "assistant"
        : "user"
      const content = (element as HTMLElement).innerText.trim()
      if (content) {
        messages.push({ role, content })
      }
    })

  return messages
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

    try {
      const response = await sendChatCaptureToBackground({
        platform: "claude",
        platformLabel: PLATFORM_LABEL,
        title: document.title.replace(" - Claude", "").trim() || "Conversa Claude",
        messages: captureConversation(),
        capturedFromUrl: window.location.href
      })

      if (response.success) {
        setState("success")
        showMindDockToast({ message: "Conversa enviada para o NotebookLM.", variant: "success" })
      } else {
        setState("error")
        showMindDockToast({
          message: response.error ?? "Nao foi possivel enviar a conversa.",
          variant: "error",
          timeoutMs: 3200
        })
      }
    } catch (error) {
      setState("error")
      showMindDockToast({
        message: error instanceof Error ? error.message : "Erro inesperado ao capturar conversa.",
        variant: "error",
        timeoutMs: 3200
      })
    } finally {
      window.setTimeout(() => {
        setState("idle")
      }, 1800)
    }
  })

  targetElement.appendChild(button)
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
injectAll()

export {}
