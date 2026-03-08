/**
 * MindDock — NotebookLM Highlight Clipper
 * Detects text selection on NotebookLM and shows a floating folder picker
 * to save the selection as a highlight snippet.
 */

import type { PlasmoCSConfig } from "plasmo"
import {
  getFolders,
  saveSnippet,
  type HighlightFolder
} from "~/services/highlight-storage"

export const config: PlasmoCSConfig = {
  matches: ["https://notebooklm.google.com/*"],
  world: "ISOLATED",
  run_at: "document_idle"
}

// ─── State ───────────────────────────────────────────────────────────────────

let panel: HTMLElement | null = null
let currentSelection = ""
let cachedFolders: HighlightFolder[] = []
let hideTimer: ReturnType<typeof setTimeout> | null = null

// ─── Folder cache ─────────────────────────────────────────────────────────────

async function refreshFolders() {
  cachedFolders = await getFolders().catch(() => [])
}

void refreshFolders()

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes["minddock_highlight_folders"]) {
    void refreshFolders()
  }
})

// ─── UI helpers ───────────────────────────────────────────────────────────────

function injectStyles() {
  if (document.getElementById("minddock-nblm-clipper-styles")) return
  const style = document.createElement("style")
  style.id = "minddock-nblm-clipper-styles"
  style.textContent = `
    #minddock-nblm-panel {
      position: fixed;
      z-index: 2147483647;
      background: rgba(8, 8, 8, 0.96);
      border: 1px solid rgba(250, 204, 21, 0.22);
      border-radius: 14px;
      padding: 8px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      user-select: none;
      pointer-events: auto;
      min-width: 168px;
      font-family: Inter, -apple-system, sans-serif;
      animation: minddock-nblm-in 0.15s ease;
    }
    @keyframes minddock-nblm-in {
      from { opacity: 0; transform: translateY(-6px) scale(0.96); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .minddock-nblm-header {
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: rgba(250, 204, 21, 0.7);
      padding: 0 4px 6px 4px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      margin-bottom: 6px;
    }
    .minddock-nblm-folder-btn {
      display: flex;
      align-items: center;
      gap: 7px;
      width: 100%;
      padding: 5px 6px;
      border: none;
      background: transparent;
      border-radius: 8px;
      cursor: pointer;
      text-align: left;
      transition: background 0.1s;
    }
    .minddock-nblm-folder-btn:hover {
      background: rgba(255,255,255,0.07);
    }
    .minddock-nblm-folder-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .minddock-nblm-folder-name {
      font-size: 11px;
      font-weight: 500;
      color: rgba(255,255,255,0.85);
    }
    .minddock-nblm-success {
      font-size: 11px;
      color: #22c55e;
      text-align: center;
      padding: 6px 4px;
    }
    .minddock-nblm-empty {
      font-size: 10px;
      color: rgba(255,255,255,0.35);
      text-align: center;
      padding: 6px 4px;
    }
  `
  document.head.appendChild(style)
}

function removePanel() {
  panel?.remove()
  panel = null
}

function showSuccess() {
  if (!panel) return
  panel.innerHTML = `<div class="minddock-nblm-success">✓ Saved!</div>`
  setTimeout(removePanel, 1200)
}

function createPanel(x: number, y: number, selectedText: string): HTMLElement {
  const el = document.createElement("div")
  el.id = "minddock-nblm-panel"

  const header = document.createElement("div")
  header.className = "minddock-nblm-header"
  header.textContent = "Save to MindDock"
  el.appendChild(header)

  if (cachedFolders.length === 0) {
    const empty = document.createElement("div")
    empty.className = "minddock-nblm-empty"
    empty.textContent = "No folders found"
    el.appendChild(empty)
  } else {
    for (const folder of cachedFolders) {
      const btn = document.createElement("button")
      btn.type = "button"
      btn.className = "minddock-nblm-folder-btn"

      const dot = document.createElement("span")
      dot.className = "minddock-nblm-folder-dot"
      dot.style.background = folder.color

      const label = document.createElement("span")
      label.className = "minddock-nblm-folder-name"
      label.textContent = folder.name

      btn.appendChild(dot)
      btn.appendChild(label)

      btn.addEventListener("click", async (e) => {
        e.stopPropagation()
        e.preventDefault()
        await saveSnippet(
          folder.id,
          selectedText,
          document.title || "NotebookLM",
          window.location.href
        )
        showSuccess()
      })

      el.appendChild(btn)
    }
  }

  // Position above selection, clamped to viewport
  const panelWidth = 180
  const panelHeight = cachedFolders.length * 30 + 52
  const left = Math.min(Math.max(x - panelWidth / 2, 8), window.innerWidth - panelWidth - 8)
  const top = Math.max(y - panelHeight - 10, 8)

  el.style.left = `${left}px`
  el.style.top = `${top}px`

  return el
}

function showPanel(x: number, y: number, selectedText: string) {
  removePanel()
  injectStyles()
  panel = createPanel(x, y, selectedText)
  document.body.appendChild(panel)
}

// ─── Selection listener ───────────────────────────────────────────────────────

document.addEventListener("mouseup", (e) => {
  // Don't trigger if click is inside our panel
  if (panel && panel.contains(e.target as Node)) return

  const selection = window.getSelection()
  const text = selection?.toString().trim() ?? ""

  if (text.length >= 15) {
    currentSelection = text
    const range = selection!.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    showPanel(
      rect.left + rect.width / 2,
      rect.top + window.scrollY,
      text
    )
  } else {
    // Small delay to avoid hiding when clicking the panel itself
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      const sel = window.getSelection()?.toString().trim() ?? ""
      if (sel.length < 15) removePanel()
    }, 150)
  }
})

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") removePanel()
})

// Hide panel on scroll (selection position changes)
document.addEventListener("scroll", () => removePanel(), { passive: true })

export {}
