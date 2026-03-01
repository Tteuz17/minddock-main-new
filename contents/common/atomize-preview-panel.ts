/**
 * MindDock — Atomize Preview Panel
 * Painel flutuante que mostra notas atômicas geradas pela IA.
 * O usuário revisa, seleciona e salva. Vanilla DOM.
 */

import { showMindDockToast } from "./minddock-ui"

const PANEL_ID = "minddock-atomize-preview-panel"
const STYLE_TAG_ID = "minddock-atomize-preview-styles"

interface AtomicNote {
  title: string
  content: string
  tags: string[]
  source?: string
}

function ensurePreviewStyles() {
  if (document.getElementById(STYLE_TAG_ID)) return

  const style = document.createElement("style")
  style.id = STYLE_TAG_ID
  style.textContent = `
    #${PANEL_ID} {
      position: fixed;
      top: 50%;
      right: 20px;
      transform: translateY(-50%);
      z-index: 2147483647;
      width: 360px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      background: rgba(8,8,8,0.94);
      backdrop-filter: blur(24px) saturate(1.4);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      box-shadow: 0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04);
      font-family: Inter, system-ui, sans-serif;
      color: #f3f4f6;
      animation: minddock-panel-in 220ms cubic-bezier(0.16, 1, 0.3, 1);
      overflow: hidden;
    }

    @keyframes minddock-panel-in {
      from { opacity: 0; transform: translateY(-50%) translateX(12px) scale(0.97); }
      to { opacity: 1; transform: translateY(-50%) translateX(0) scale(1); }
    }

    .minddock-preview-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }

    .minddock-preview-header h3 {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .minddock-preview-header h3 .minddock-count-badge {
      font-size: 10px;
      font-weight: 600;
      background: rgba(250,204,21,0.15);
      color: #facc15;
      padding: 2px 7px;
      border-radius: 10px;
      border: 1px solid rgba(250,204,21,0.2);
    }

    .minddock-preview-close {
      background: none;
      border: none;
      color: #71717a;
      cursor: pointer;
      padding: 4px;
      border-radius: 6px;
      transition: all 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .minddock-preview-close:hover {
      color: #ffffff;
      background: rgba(255,255,255,0.08);
    }

    .minddock-preview-body {
      flex: 1;
      overflow-y: auto;
      padding: 8px 12px;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.1) transparent;
    }

    .minddock-note-card {
      position: relative;
      padding: 12px;
      margin-bottom: 8px;
      border-radius: 12px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.06);
      transition: all 0.18s ease;
      cursor: default;
    }
    .minddock-note-card:hover {
      background: rgba(255,255,255,0.06);
      border-color: rgba(255,255,255,0.1);
    }
    .minddock-note-card[data-selected="false"] {
      opacity: 0.4;
    }

    .minddock-note-card-header {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 6px;
    }

    .minddock-note-checkbox {
      width: 16px;
      height: 16px;
      margin-top: 1px;
      accent-color: #facc15;
      cursor: pointer;
      flex-shrink: 0;
    }

    .minddock-note-title {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: -0.01em;
      color: #ffffff;
      margin: 0;
      line-height: 1.3;
    }

    .minddock-note-content {
      font-size: 11px;
      color: #a1a1aa;
      line-height: 1.45;
      margin: 0 0 6px 24px;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .minddock-note-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-left: 24px;
    }

    .minddock-note-tag {
      font-size: 9px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 2px 6px;
      border-radius: 6px;
      background: rgba(250,204,21,0.08);
      color: #d4d4d8;
      border: 1px solid rgba(255,255,255,0.06);
    }

    .minddock-preview-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px 14px;
      border-top: 1px solid rgba(255,255,255,0.06);
      gap: 8px;
    }

    .minddock-preview-footer .minddock-selected-count {
      font-size: 11px;
      color: #71717a;
    }

    .minddock-btn-save {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 7px 16px;
      border-radius: 10px;
      font-size: 12px;
      font-weight: 600;
      color: #000;
      background: #facc15;
      border: none;
      cursor: pointer;
      transition: all 0.18s ease;
    }
    .minddock-btn-save:hover {
      background: #fbbf24;
      transform: translateY(-1px);
      box-shadow: 0 4px 16px rgba(250,204,21,0.3);
    }
    .minddock-btn-save:disabled {
      opacity: 0.5;
      pointer-events: none;
    }

    .minddock-btn-discard {
      display: inline-flex;
      align-items: center;
      padding: 7px 12px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 500;
      color: #71717a;
      background: none;
      border: 1px solid rgba(255,255,255,0.08);
      cursor: pointer;
      transition: all 0.15s;
    }
    .minddock-btn-discard:hover {
      color: #ef4444;
      border-color: rgba(239,68,68,0.3);
      background: rgba(239,68,68,0.06);
    }
  `
  document.head.appendChild(style)
}

function closePanel() {
  const existing = document.getElementById(PANEL_ID)
  if (existing) {
    existing.style.animation = "none"
    existing.style.opacity = "0"
    existing.style.transform = "translateY(-50%) translateX(12px) scale(0.97)"
    existing.style.transition = "all 160ms ease"
    setTimeout(() => existing.remove(), 160)
  }
}

export function showAtomizePreviewPanel(notes: AtomicNote[]): void {
  ensurePreviewStyles()
  closePanel()

  const selected = new Set<number>(notes.map((_, i) => i))

  const panel = document.createElement("div")
  panel.id = PANEL_ID

  // Header
  const header = document.createElement("div")
  header.className = "minddock-preview-header"
  header.innerHTML = `
    <h3>
      Zettel Maker
      <span class="minddock-count-badge">${notes.length} notas</span>
    </h3>
  `
  const closeBtn = document.createElement("button")
  closeBtn.className = "minddock-preview-close"
  closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
  closeBtn.addEventListener("click", closePanel)
  header.appendChild(closeBtn)

  // Body
  const body = document.createElement("div")
  body.className = "minddock-preview-body"

  notes.forEach((note, index) => {
    const card = document.createElement("div")
    card.className = "minddock-note-card"
    card.dataset.selected = "true"

    const cardHeader = document.createElement("div")
    cardHeader.className = "minddock-note-card-header"

    const checkbox = document.createElement("input")
    checkbox.type = "checkbox"
    checkbox.checked = true
    checkbox.className = "minddock-note-checkbox"
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selected.add(index)
        card.dataset.selected = "true"
      } else {
        selected.delete(index)
        card.dataset.selected = "false"
      }
      updateFooter()
    })

    const title = document.createElement("h4")
    title.className = "minddock-note-title"
    title.textContent = note.title

    cardHeader.appendChild(checkbox)
    cardHeader.appendChild(title)

    const content = document.createElement("p")
    content.className = "minddock-note-content"
    content.textContent = note.content

    card.appendChild(cardHeader)
    card.appendChild(content)

    if (note.tags && note.tags.length > 0) {
      const tagsContainer = document.createElement("div")
      tagsContainer.className = "minddock-note-tags"
      note.tags.forEach((tag) => {
        const tagEl = document.createElement("span")
        tagEl.className = "minddock-note-tag"
        tagEl.textContent = tag
        tagsContainer.appendChild(tagEl)
      })
      card.appendChild(tagsContainer)
    }

    body.appendChild(card)
  })

  // Footer
  const footer = document.createElement("div")
  footer.className = "minddock-preview-footer"

  const countLabel = document.createElement("span")
  countLabel.className = "minddock-selected-count"

  const discardBtn = document.createElement("button")
  discardBtn.className = "minddock-btn-discard"
  discardBtn.textContent = "Descartar"
  discardBtn.addEventListener("click", closePanel)

  const saveBtn = document.createElement("button")
  saveBtn.className = "minddock-btn-save"
  saveBtn.textContent = "Salvar"

  function updateFooter() {
    countLabel.textContent = `${selected.size}/${notes.length} selecionadas`
    saveBtn.disabled = selected.size === 0
  }
  updateFooter()

  saveBtn.addEventListener("click", async () => {
    if (selected.size === 0) return
    saveBtn.disabled = true
    saveBtn.textContent = "Salvando..."

    const notesToSave = notes
      .filter((_, i) => selected.has(i))
      .map((n) => ({
        title: n.title,
        content: n.content,
        tags: n.tags ?? [],
        source: "zettel_maker"
      }))

    try {
      const response = await chrome.runtime.sendMessage({
        command: "MINDDOCK_SAVE_ATOMIC_NOTES",
        payload: { notes: notesToSave }
      })

      if (!response?.success) {
        throw new Error(response?.error ?? "Falha ao salvar notas.")
      }

      showMindDockToast({
        message: `${notesToSave.length} nota${notesToSave.length > 1 ? "s" : ""} atomica${notesToSave.length > 1 ? "s" : ""} salva${notesToSave.length > 1 ? "s" : ""}!`,
        variant: "success"
      })
      closePanel()
    } catch (error) {
      saveBtn.disabled = false
      saveBtn.textContent = "Salvar"
      showMindDockToast({
        message: error instanceof Error
          ? error.message
          : (error as { message?: string })?.message ?? "Erro ao salvar notas.",
        variant: "error",
        timeoutMs: 3500
      })
    }
  })

  footer.appendChild(countLabel)
  const buttonsWrap = document.createElement("div")
  buttonsWrap.style.cssText = "display:flex;gap:6px;align-items:center;"
  buttonsWrap.appendChild(discardBtn)
  buttonsWrap.appendChild(saveBtn)
  footer.appendChild(buttonsWrap)

  panel.appendChild(header)
  panel.appendChild(body)
  panel.appendChild(footer)
  document.body.appendChild(panel)
}
