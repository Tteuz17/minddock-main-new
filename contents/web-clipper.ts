/**
 * MindDock — Highlight & Snipe (Web Clipper)
 * Aparece em qualquer site quando o usuário seleciona texto.
 * Envia a seleção como fonte para o NotebookLM.
 */

import type { PlasmoCSConfig } from "plasmo"
import { installHighlightMessageListener } from "./common/highlight-handler"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  exclude_matches: [
    "https://notebooklm.google.com/*",
    "https://chat.openai.com/*",
    "https://chatgpt.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*",
    "https://perplexity.ai/*",
    "https://www.perplexity.ai/*",
    "https://docs.google.com/*"
  ],
  world: "ISOLATED",
  run_at: "document_idle"
}

let floatingBtn: HTMLElement | null = null

installHighlightMessageListener()

function createFloatingBtn(): HTMLElement {
  const btn = document.createElement("div")
  btn.id = "minddock-clipper-btn"
  btn.innerHTML = `
    <span style="font-size:12px">📌</span>
    <span style="font-size:12px; font-weight:500; font-family:Inter,sans-serif">Enviar pro MindDock</span>
  `
  btn.style.cssText = `
    position: fixed;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    background: rgba(10, 10, 10, 0.9);
    border: 1px solid rgba(250, 204, 21, 0.3);
    border-radius: 8px;
    color: #facc15;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    animation: minddock-fade-in 0.15s ease;
    user-select: none;
    pointer-events: auto;
  `

  // Inject keyframe se não existir
  if (!document.getElementById("minddock-clipper-styles")) {
    const style = document.createElement("style")
    style.id = "minddock-clipper-styles"
    style.textContent = `
      @keyframes minddock-fade-in {
        from { opacity: 0; transform: translateY(-4px) scale(0.97); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
    `
    document.head.appendChild(style)
  }

  btn.addEventListener("mouseenter", () => {
    btn.style.background = "rgba(250, 204, 21, 0.12)"
    btn.style.borderColor = "rgba(250, 204, 21, 0.6)"
  })
  btn.addEventListener("mouseleave", () => {
    btn.style.background = "rgba(10, 10, 10, 0.9)"
    btn.style.borderColor = "rgba(250, 204, 21, 0.3)"
  })

  return btn
}

function showBtn(x: number, y: number, selectedText: string) {
  removeBtn()

  floatingBtn = createFloatingBtn()

  // Posiciona acima da seleção
  floatingBtn.style.left = `${Math.min(x, window.innerWidth - 220)}px`
  floatingBtn.style.top = `${Math.max(y - 48, 8)}px`

  floatingBtn.addEventListener("click", async (e) => {
    e.stopPropagation()
    e.preventDefault()

    if (!floatingBtn) return
    const originalHtml = floatingBtn.innerHTML
    floatingBtn.innerHTML = `<span style="font-size:12px; font-family:Inter,sans-serif; color:#fff">Enviando...</span>`

    const content = `# Seleção de ${document.title}\n\n> Fonte: ${window.location.href}\n\n${selectedText}`

    const response = await chrome.runtime.sendMessage({
      command: "MINDDOCK_HIGHLIGHT_SNIPE",
      payload: {
        text: selectedText,
        content,
        url: window.location.href,
        title: document.title
      }
    })

    if (response?.success) {
      if (floatingBtn) {
        floatingBtn.innerHTML = `<span style="font-size:12px; font-family:Inter,sans-serif; color:#22c55e">✓ Enviado!</span>`
        setTimeout(removeBtn, 1500)
      }
    } else {
      if (floatingBtn) {
        floatingBtn.innerHTML = `<span style="font-size:12px; font-family:Inter,sans-serif; color:#ef4444">Erro</span>`
        setTimeout(removeBtn, 1500)
      }
    }
  })

  document.body.appendChild(floatingBtn)
}

function removeBtn() {
  floatingBtn?.remove()
  floatingBtn = null
}

// ─── Listeners ────────────────────────────────────────────────────────────────

document.addEventListener("mouseup", (e) => {
  const selection = window.getSelection()
  const text = selection?.toString().trim()

  if (text && text.length > 20) {
    const range = selection!.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    showBtn(
      rect.left + window.scrollX,
      rect.top + window.scrollY,
      text
    )
  } else {
    // Pequeno delay pra não fechar ao clicar no botão
    setTimeout(() => {
      const sel = window.getSelection()?.toString().trim()
      if (!sel || sel.length < 20) removeBtn()
    }, 150)
  }
})

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") removeBtn()
})

export {}
