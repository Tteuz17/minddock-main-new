/**
 * MindDock — Perplexity Content Script
 */

import type { PlasmoCSConfig } from "plasmo"
import { formatChatAsMarkdown } from "~/lib/utils"
import type { AIChatMessage } from "~/lib/types"
import { installHighlightMessageListener } from "./common/highlight-handler"

export const config: PlasmoCSConfig = {
  matches: ["https://perplexity.ai/*", "https://www.perplexity.ai/*"],
  world: "ISOLATED",
  run_at: "document_idle"
}

const INJECTED_ATTR = "data-minddock-btn"
const PLATFORM = "Perplexity"

installHighlightMessageListener()

function captureConversation(): AIChatMessage[] {
  const messages: AIChatMessage[] = []

  // Perplexity agrupa em divs com data-testid
  document.querySelectorAll("[data-testid='answer'], [data-testid='query']").forEach((el) => {
    const isAssistant = el.getAttribute("data-testid") === "answer"
    const content = (el as HTMLElement).innerText.trim()
    if (content) messages.push({ role: isAssistant ? "assistant" : "user", content })
  })

  // Fallback: tenta pegar respostas por classes comuns
  if (messages.length === 0) {
    document.querySelectorAll(".prose").forEach((el) => {
      const content = (el as HTMLElement).innerText.trim()
      if (content) messages.push({ role: "assistant", content })
    })
  }

  return messages
}

function createMindDockBtn(messageEl: Element) {
  if (messageEl.getAttribute(INJECTED_ATTR)) return
  messageEl.setAttribute(INJECTED_ATTR, "true")

  const btn = document.createElement("button")
  btn.textContent = "📌 MindDock"
  btn.style.cssText = `
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 8px; border-radius: 6px; font-size: 11px;
    font-weight: 500; color: #a1a1aa; background: transparent;
    border: 1px solid rgba(255,255,255,0.1); cursor: pointer;
    margin-top: 6px; font-family: Inter, sans-serif;
    transition: all 0.2s ease;
  `

  btn.addEventListener("mouseenter", () => {
    btn.style.color = "#facc15"
    btn.style.borderColor = "rgba(250,204,21,0.3)"
    btn.style.background = "rgba(250,204,21,0.08)"
  })
  btn.addEventListener("mouseleave", () => {
    btn.style.color = "#a1a1aa"
    btn.style.borderColor = "rgba(255,255,255,0.1)"
    btn.style.background = "transparent"
  })

  btn.addEventListener("click", async () => {
    btn.textContent = "Enviando..."
    const messages = captureConversation()
    const title = document.title.replace("- Perplexity", "").trim()
    const markdown = formatChatAsMarkdown(PLATFORM, messages, title)

    const response = await chrome.runtime.sendMessage({
      command: "MINDDOCK_IMPORT_AI_CHAT",
      payload: {
        platform: "perplexity",
        conversationTitle: title,
        content: markdown,
        url: window.location.href,
        capturedAt: new Date().toISOString()
      }
    })

    btn.textContent = response?.success ? "✓ Enviado!" : "Erro"
    btn.style.color = response?.success ? "#22c55e" : "#ef4444"
    setTimeout(() => {
      btn.textContent = "📌 MindDock"
      btn.style.color = "#a1a1aa"
    }, 2000)
  })

  messageEl.appendChild(btn)
}

const observer = new MutationObserver(() => {
  document
    .querySelectorAll(`[data-testid='answer']:not([${INJECTED_ATTR}]), .prose:not([${INJECTED_ATTR}])`)
    .forEach(createMindDockBtn)
})
observer.observe(document.body, { childList: true, subtree: true })

export {}
