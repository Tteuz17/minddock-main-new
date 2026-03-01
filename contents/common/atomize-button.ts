/**
 * MindDock — Atomize Button Factory
 * Cria o botão "Atomizar" injetado em sites de IA (ChatGPT, Claude, Gemini, Perplexity).
 * Vanilla DOM — sem React, pois injeta em páginas de terceiros.
 */

import { showMindDockToast } from "./minddock-ui"
import { showAtomizePreviewPanel } from "./atomize-preview-panel"

const ATOMIZE_ATTR = "data-minddock-atomize"
const MIN_TEXT_LENGTH = 200

const STYLE_TAG_ID = "minddock-atomize-styles"

function ensureAtomizeStyles() {
  if (document.getElementById(STYLE_TAG_ID)) return

  const style = document.createElement("style")
  style.id = STYLE_TAG_ID
  style.textContent = `
    .minddock-atomize-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.01em;
      color: #a1a1aa;
      background: rgba(250,204,21,0.06);
      border: 1px solid rgba(250,204,21,0.18);
      cursor: pointer;
      font-family: Inter, system-ui, sans-serif;
      transition: all 0.22s ease;
      backdrop-filter: blur(6px);
    }
    .minddock-atomize-btn:hover {
      color: #facc15;
      border-color: rgba(250,204,21,0.45);
      background: rgba(250,204,21,0.12);
      transform: translateY(-1px);
      box-shadow: 0 2px 12px rgba(250,204,21,0.15);
    }
    .minddock-atomize-btn:active {
      transform: translateY(0);
    }
    .minddock-atomize-btn[data-state="loading"] {
      color: #facc15;
      border-color: rgba(250,204,21,0.3);
      background: rgba(250,204,21,0.08);
      pointer-events: none;
      opacity: 0.85;
    }
    .minddock-atomize-btn[data-state="loading"] .minddock-atomize-icon {
      animation: minddock-spin 1s linear infinite;
    }
    .minddock-atomize-btn[data-state="success"] {
      color: #22c55e;
      border-color: rgba(34,197,94,0.45);
      background: rgba(34,197,94,0.1);
    }
    .minddock-atomize-btn[data-state="error"] {
      color: #ef4444;
      border-color: rgba(239,68,68,0.45);
      background: rgba(239,68,68,0.1);
    }
    @keyframes minddock-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `
  document.head.appendChild(style)
}

const ATOMIZE_ICON = `<svg class="minddock-atomize-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><line x1="12" y1="6" x2="12" y2="11"/><line x1="12" y1="13" x2="12" y2="18"/><line x1="6" y1="12" x2="11" y2="12"/><line x1="13" y1="12" x2="18" y2="12"/></svg>`

interface AtomizeButtonOptions {
  textExtractor: () => string
}

export function createAtomizeButton(options: AtomizeButtonOptions): HTMLButtonElement {
  ensureAtomizeStyles()

  const button = document.createElement("button")
  button.type = "button"
  button.className = "minddock-atomize-btn"
  button.dataset.state = "idle"
  button.innerHTML = `${ATOMIZE_ICON} <span>Atomizar</span>`
  button.title = "Dividir em notas atomicas (MindDock Zettel Maker)"

  button.addEventListener("click", async (e) => {
    e.preventDefault()
    e.stopPropagation()

    const text = options.textExtractor()
    if (!text || text.length < MIN_TEXT_LENGTH) {
      showMindDockToast({
        message: "Texto muito curto para atomizar (minimo 200 caracteres).",
        variant: "error"
      })
      return
    }

    button.dataset.state = "loading"
    button.querySelector("span")!.textContent = "Atomizando..."

    try {
      const response = await chrome.runtime.sendMessage({
        command: "MINDDOCK_ATOMIZE_PREVIEW",
        payload: { content: text }
      })

      if (!response?.success) {
        throw new Error(response?.error ?? "Falha ao atomizar conteudo.")
      }

      const notes = response.payload?.notes ?? response.data?.notes ?? []
      if (notes.length === 0) {
        throw new Error("Nenhuma nota atomica foi gerada.")
      }

      button.dataset.state = "success"
      button.querySelector("span")!.textContent = `${notes.length} notas`

      showAtomizePreviewPanel(notes)
    } catch (error) {
      button.dataset.state = "error"
      button.querySelector("span")!.textContent = "Erro"
      showMindDockToast({
        message: error instanceof Error ? error.message : "Erro ao atomizar.",
        variant: "error",
        timeoutMs: 3500
      })
    } finally {
      setTimeout(() => {
        button.dataset.state = "idle"
        button.innerHTML = `${ATOMIZE_ICON} <span>Atomizar</span>`
      }, 2200)
    }
  })

  return button
}

/**
 * Injeta o botão Atomizar em um elemento de mensagem de IA,
 * apenas se o texto for longo o suficiente.
 */
export function injectAtomizeButton(
  messageElement: Element,
  textExtractor: () => string,
  insertTarget?: Element | null
): void {
  if (messageElement.getAttribute(ATOMIZE_ATTR)) return

  const text = textExtractor()
  if (!text || text.length < MIN_TEXT_LENGTH) return

  messageElement.setAttribute(ATOMIZE_ATTR, "true")

  const button = createAtomizeButton({ textExtractor })
  button.style.marginLeft = "4px"

  if (insertTarget) {
    insertTarget.appendChild(button)
  } else {
    const wrapper = document.createElement("div")
    wrapper.style.cssText = "display:flex; justify-content:flex-end; margin-top:4px;"
    wrapper.appendChild(button)
    messageElement.appendChild(wrapper)
  }
}
