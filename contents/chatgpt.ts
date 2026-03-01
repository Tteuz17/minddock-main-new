/**
 * MindDock - ChatGPT Content Script
 * Injeta botoes de captura e envia conversa estruturada ao background.
 */

import type { PlasmoCSConfig } from "plasmo"
import type { AIChatMessage } from "~/lib/types"
import { sendChatCaptureToBackground } from "./common/chat-capture"
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

const SELECTORS = {
  assistantMessage: "[data-message-author-role='assistant']",
  messageActions: ".flex.items-center.gap-1"
}

installHighlightMessageListener()

function captureConversation(): AIChatMessage[] {
  const allMessages = document.querySelectorAll("[data-message-author-role]")
  const messages: AIChatMessage[] = []

  allMessages.forEach((element) => {
    const role =
      element.getAttribute("data-message-author-role") === "assistant" ? "assistant" : "user"
    const content = (element as HTMLElement).innerText.trim()
    if (content) {
      messages.push({ role, content })
    }
  })

  return messages
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

    try {
      const response = await sendChatCaptureToBackground({
        platform: "chatgpt",
        platformLabel: PLATFORM_LABEL,
        title: document.title.replace(" - ChatGPT", "").trim() || "Conversa ChatGPT",
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
injectAllButtons()

export {}
