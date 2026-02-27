/**
 * MindDock — Google Docs Content Script
 * Injeta botão para sincronizar o documento com o NotebookLM.
 */

import type { PlasmoCSConfig } from "plasmo"
import { installHighlightMessageListener } from "./common/highlight-handler"

export const config: PlasmoCSConfig = {
  matches: ["https://docs.google.com/document/*"],
  world: "ISOLATED",
  run_at: "document_idle"
}

const INJECTED_ID = "minddock-gdoc-btn"

installHighlightMessageListener()

function extractDocContent(): string {
  // Google Docs renderiza num iframe ou canvas — tentamos pegar o texto acessível
  const doc = document.querySelector(".kix-page-content-block, .docs-editor-container")
  return doc ? (doc as HTMLElement).innerText.trim() : ""
}

function getDocTitle(): string {
  return (document.querySelector(".docs-title-input") as HTMLInputElement)?.value
    || document.title.replace(" - Google Docs", "").trim()
}

function getDocUrl(): string {
  // URL limpa sem parâmetros extras
  return window.location.href.split("?")[0]
}

function injectButton() {
  if (document.getElementById(INJECTED_ID)) return

  const btn = document.createElement("button")
  btn.id = INJECTED_ID
  btn.innerHTML = `
    <span style="font-size:13px">📌</span>
    <span>Sync com NotebookLM</span>
  `
  btn.style.cssText = `
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 12px; border-radius: 8px; font-size: 13px;
    font-weight: 500; color: #000; background: #facc15;
    border: none; cursor: pointer; margin: 0 8px;
    font-family: Inter, -apple-system, sans-serif;
    transition: all 0.2s ease;
    position: fixed; top: 14px; right: 120px; z-index: 999999;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  `

  btn.addEventListener("mouseenter", () => {
    btn.style.background = "#eab308"
    btn.style.transform = "scale(1.02)"
  })
  btn.addEventListener("mouseleave", () => {
    btn.style.background = "#facc15"
    btn.style.transform = "scale(1)"
  })

  btn.addEventListener("click", async () => {
    btn.textContent = "Sincronizando..."
    btn.style.opacity = "0.7"
    btn.style.cursor = "not-allowed"

    // Tenta sync via URL do Google Doc (RPC FLmJqe)
    const response = await chrome.runtime.sendMessage({
      command: "MINDDOCK_SYNC_GDOC",
      payload: {
        url: getDocUrl(),
        title: getDocTitle()
      }
    })

    if (response?.success) {
      btn.innerHTML = `<span>✓ Sincronizado!</span>`
      btn.style.background = "#22c55e"
      btn.style.opacity = "1"
      setTimeout(() => {
        btn.innerHTML = `<span style="font-size:13px">📌</span><span>Sync com NotebookLM</span>`
        btn.style.background = "#facc15"
        btn.style.cursor = "pointer"
      }, 3000)
    } else {
      btn.innerHTML = `<span>Erro ao sincronizar</span>`
      btn.style.background = "#ef4444"
      btn.style.color = "#fff"
      btn.style.opacity = "1"
      setTimeout(() => {
        btn.innerHTML = `<span style="font-size:13px">📌</span><span>Sync com NotebookLM</span>`
        btn.style.background = "#facc15"
        btn.style.color = "#000"
        btn.style.cursor = "pointer"
      }, 3000)
    }
  })

  document.body.appendChild(btn)
}

// Aguarda o editor carregar
const observer = new MutationObserver(() => {
  if (document.querySelector(".kix-appview-editor, .docs-editor")) {
    observer.disconnect()
    setTimeout(injectButton, 1000)
  }
})
observer.observe(document.body, { childList: true, subtree: true })

export {}
