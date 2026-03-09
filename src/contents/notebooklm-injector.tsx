import type { PlasmoCSConfig } from "plasmo"
import { createRoot, type Root } from "react-dom/client"
import "~/styles/globals.css"
import { getFolders, saveSnippet, createFolder, FOLDER_ICONS } from "~/services/highlight-storage"
import { AgilePromptsBar } from "../../contents/notebooklm/AgilePromptsBar"
import { FocusThreadsBar } from "../../contents/notebooklm/FocusThreadsBar"
import { SourceDownloadPanel } from "../../contents/notebooklm/SourceDownloadPanel"
import { SourceFilterPanel } from "../../contents/notebooklm/SourceFilterPanel"
import { ZettelButton } from "../../contents/notebooklm/ZettelButton"
import {
  getDeepRoots,
  isVisible,
  resolveSourceActionsHost,
  resolveSourceFiltersHost
} from "../../contents/notebooklm/sourceDom"

export const config: PlasmoCSConfig = {
  matches: ["https://notebooklm.google.com/*"],
  run_at: "document_idle"
}

type InsertMode = "prepend" | "after"
type DisplayMode = "contents" | "block"

interface InjectionTarget {
  key: "source-actions" | "source-filters"
  rootId: string
  insertMode: InsertMode
  display: DisplayMode
  resolveHost: () => HTMLElement | null
  render: () => JSX.Element
}

interface MountedRootRecord {
  root: Root
  host: HTMLElement
}

interface NotebooklmInjectorGlobalState {
  cleanup?: (() => void) | null
}

const TARGETS: readonly InjectionTarget[] = [
  {
    key: "source-actions",
    rootId: "minddock-source-actions-root",
    insertMode: "prepend",
    display: "contents",
    resolveHost: resolveSourceActionsHost,
    render: () => <SourceDownloadPanel />
  },
  {
    key: "source-filters",
    rootId: "minddock-source-filters-root",
    insertMode: "after",
    display: "block",
    resolveHost: resolveSourceFiltersHost,
    render: () => <SourceFilterPanel />
  }
]

const mountedRoots = new Map<string, MountedRootRecord>()
const AGILE_BAR_ROOT_ID = "minddock-agile-bar-root"
const FOCUS_THREADS_ROOT_ID = "minddock-focus-threads-root"

let domObserver: MutationObserver | null = null
let refreshTimer: number | null = null
let agilePositionTimer: number | null = null
let focusThreadsPositionTimer: number | null = null
let zettelObserver: MutationObserver | null = null
const INJECTOR_GLOBAL_KEY = "__MINDDOCK_NOTEBOOKLM_INJECTOR_STATE__"

function resolveGlobalState(): NotebooklmInjectorGlobalState {
  const globalRecord = window as typeof window & Record<string, unknown>
  const existing = globalRecord[INJECTOR_GLOBAL_KEY]

  if (existing && typeof existing === "object") {
    return existing as NotebooklmInjectorGlobalState
  }

  const nextState: NotebooklmInjectorGlobalState = {}
  globalRecord[INJECTOR_GLOBAL_KEY] = nextState
  return nextState
}

function cleanupPreviousInstance(): void {
  const globalState = resolveGlobalState()
  if (typeof globalState.cleanup !== "function") {
    return
  }

  try {
    globalState.cleanup()
  } catch (error) {
    console.warn("[MindDock] NotebookLM injector cleanup failed", error)
  } finally {
    globalState.cleanup = null
  }
}

function isNotebookWorkspaceRoute(): boolean {
  return /\/notebook\/[^/]+/i.test(String(window.location.pathname ?? ""))
}

function mountTargets(): void {
  if (!isNotebookWorkspaceRoute()) {
    return
  }

  for (const target of TARGETS) {
    const host = target.resolveHost()
    if (!(host instanceof HTMLElement) || !isVisible(host)) {
      continue
    }

    let rootElement = document.getElementById(target.rootId) as HTMLElement | null
    if (!rootElement) {
      rootElement = document.createElement("div")
      rootElement.id = target.rootId
      rootElement.setAttribute("data-minddock-target", target.key)
    }

    syncInjectionPresentation(rootElement, target.display)
    if (!isPlacementValid(host, rootElement, target.insertMode)) {
      placeInjectionPoint(host, rootElement, target.insertMode)
    }

    mountRoot(target, rootElement, host)
  }

  cleanupDetachedRoots()
}

function placeInjectionPoint(host: HTMLElement, rootElement: HTMLElement, insertMode: InsertMode): void {
  if (insertMode === "prepend") {
    host.prepend(rootElement)
    return
  }

  host.insertAdjacentElement("afterend", rootElement)
}

function isPlacementValid(host: HTMLElement, rootElement: HTMLElement, insertMode: InsertMode): boolean {
  if (insertMode === "prepend") {
    return rootElement.parentElement === host
  }

  return host.nextElementSibling === rootElement
}

function syncInjectionPresentation(rootElement: HTMLElement, display: DisplayMode): void {
  rootElement.style.display = display
  if (display === "block") {
    rootElement.style.width = "100%"
  } else {
    rootElement.style.removeProperty("width")
  }
}

function mountRoot(target: InjectionTarget, rootElement: HTMLElement, host: HTMLElement): void {
  const mounted = mountedRoots.get(target.key)
  if (mounted && mounted.host !== host) {
    mounted.root.unmount()
    mountedRoots.delete(target.key)
  }

  const active = mountedRoots.get(target.key)
  if (active) {
    active.root.render(target.render())
    return
  }

  const root = createRoot(rootElement)
  root.render(target.render())
  mountedRoots.set(target.key, { root, host })
}

function cleanupDetachedRoots(): void {
  for (const [key, mounted] of mountedRoots.entries()) {
    if (mounted.host.isConnected) {
      continue
    }

    mounted.root.unmount()
    mountedRoots.delete(key)
  }
}

// ─── Agile Bar ────────────────────────────────────────────────────────────────

function mountAgileBar(): void {
  let rootElement = document.getElementById(AGILE_BAR_ROOT_ID) as HTMLElement | null
  if (!rootElement) {
    rootElement = document.createElement("div")
    rootElement.id = AGILE_BAR_ROOT_ID
    rootElement.style.position = "fixed"
    rootElement.style.left = "50%"
    rootElement.style.transform = "translateX(-50%)"
    rootElement.style.zIndex = "2147483645"
    rootElement.style.pointerEvents = "auto"
    document.body.appendChild(rootElement)
  }

  const mounted = mountedRoots.get("agile-bar")
  if (mounted) {
    mounted.root.render(<AgilePromptsBar />)
    updateAgileBarPosition()
    return
  }

  const root = createRoot(rootElement)
  root.render(<AgilePromptsBar />)
  mountedRoots.set("agile-bar", { root, host: rootElement })
  updateAgileBarPosition()
}

function resolveVisibleComposerTop(): number | null {
  const selectors = [
    "textarea",
    "div[contenteditable='true'][role='textbox']",
    "div[contenteditable='true']"
  ] as const

  let top: number | null = null
  for (const selector of selectors) {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
    for (const candidate of candidates) {
      if (!isVisible(candidate)) {
        continue
      }

      const rect = candidate.getBoundingClientRect()
      if (rect.height < 24) {
        continue
      }

      if (rect.top < window.innerHeight * 0.45) {
        continue
      }

      if (top === null || rect.top > top) {
        top = rect.top
      }
    }
  }

  return top
}

function updateAgileBarPosition(): void {
  const rootElement = document.getElementById(AGILE_BAR_ROOT_ID)
  if (!(rootElement instanceof HTMLElement)) {
    return
  }

  const composerTop = resolveVisibleComposerTop()
  if (composerTop === null) {
    rootElement.style.bottom = "24px"
    return
  }

  const offset = Math.max(24, Math.min(220, window.innerHeight - composerTop + 14))
  rootElement.style.bottom = `${offset}px`
}

// ─── Focus Threads Bar ────────────────────────────────────────────────────────

/**
 * Encontra o label "Conversa" no header do NotebookLM (atravessa Shadow DOM).
 * Usado para posicionar o overlay das Focus Threads ao lado dele.
 */
function resolveConversaLabel(): HTMLElement | null {
  // Palavras que podem aparecer no header da seção de chat dependendo do idioma
  const CHAT_LABELS = ["Conversa", "Chat", "Conversation"]

  for (const root of getDeepRoots()) {
    if (!("querySelectorAll" in root)) continue
    const elements = Array.from(
      (root as Document | ShadowRoot).querySelectorAll<HTMLElement>("span, div, h2, h3, button, a, [role='tab']")
    )
    for (const el of elements) {
      if (!isVisible(el)) continue
      const text = el.textContent?.trim() ?? ""
      if (!CHAT_LABELS.some((label) => text === label)) continue
      const rect = el.getBoundingClientRect()
      // Deve estar na faixa do header: top < 120px, altura compacta
      if (rect.top > 120 || rect.height > 80) continue
      return el
    }
  }
  return null
}

function mountFocusThreadsBar(): void {
  if (!isNotebookWorkspaceRoute()) {
    console.debug("[MindDock] FocusThreadsBar: not a notebook route, skipping")
    return
  }

  let rootElement = document.getElementById(FOCUS_THREADS_ROOT_ID) as HTMLElement | null
  if (!rootElement) {
    rootElement = document.createElement("div")
    rootElement.id = FOCUS_THREADS_ROOT_ID
    rootElement.style.position = "fixed"
    rootElement.style.zIndex = "2147483644"
    rootElement.style.pointerEvents = "auto"
    rootElement.style.overflow = "visible"
    document.body.appendChild(rootElement)
    console.debug("[MindDock] FocusThreadsBar: created root element")
  }

  const mounted = mountedRoots.get("focus-threads")
  if (mounted) {
    mounted.root.render(<FocusThreadsBar />)
    updateFocusThreadsBarPosition()
    return
  }

  const root = createRoot(rootElement)
  root.render(<FocusThreadsBar />)
  mountedRoots.set("focus-threads", { root, host: rootElement })
  updateFocusThreadsBarPosition()
}

function updateFocusThreadsBarPosition(): void {
  const rootElement = document.getElementById(FOCUS_THREADS_ROOT_ID)
  if (!(rootElement instanceof HTMLElement)) return

  const label = resolveConversaLabel()
  if (label) {
    const rect = label.getBoundingClientRect()
    rootElement.style.top = `${rect.top + (rect.height - 28) / 2}px`
    rootElement.style.left = `${rect.right + 16}px`
    rootElement.style.transform = "none"
    console.debug("[MindDock] FocusThreadsBar: positioned after label", rect)
  } else {
    // Fallback bem visível: centro exato da tela, 130px do topo
    rootElement.style.top = "130px"
    rootElement.style.left = "50%"
    rootElement.style.transform = "translateX(-50%)"
    console.debug("[MindDock] FocusThreadsBar: using fallback position (label not found)")
  }
}

// ─── Zettel Buttons ───────────────────────────────────────────────────────────

function injectZettelButtons(): void {
  const responseNodes = document.querySelectorAll("[data-testid='response-text']:not([data-minddock])")

  responseNodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) {
      return
    }

    node.setAttribute("data-minddock", "true")
    const buttonHost = document.createElement("span")
    buttonHost.style.display = "inline-flex"
    buttonHost.style.marginLeft = "8px"

    const root = createRoot(buttonHost)
    root.render(<ZettelButton content={node.textContent ?? ""} />)
    node.appendChild(buttonHost)
  })
}

// ─── Highlight Clipper ────────────────────────────────────────────────────────

const CLIPPER_PANEL_ID = "minddock-highlight-clipper-panel"
const CLIPPER_STYLES_ID = "minddock-highlight-clipper-styles"
let clipperHideTimer: ReturnType<typeof setTimeout> | null = null
let clipperPendingText = ""

const FOLDER_COLORS_PICKER = [
  "#3b82f6","#8b5cf6","#f97316","#22c55e","#ef4444","#facc15","#ec4899","#06b6d4"
]

function injectClipperStyles() {
  if (document.getElementById(CLIPPER_STYLES_ID)) return
  const style = document.createElement("style")
  style.id = CLIPPER_STYLES_ID
  style.textContent = `
    #${CLIPPER_PANEL_ID} {
      position: fixed;
      z-index: 2147483647;
      background: #0a0a0a;
      border: 1px solid rgba(250,204,21,0.18);
      border-radius: 18px;
      padding: 0;
      width: 236px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      overflow: hidden;
      pointer-events: auto;
      font-family: Inter, -apple-system, sans-serif;
      animation: md-clipper-in 0.16s cubic-bezier(0.16,1,0.3,1);
    }
    @keyframes md-clipper-in {
      from { opacity: 0; transform: translateY(-8px) scale(0.94); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .md-clipper-topbar {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 10px 12px 8px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .md-clipper-logo {
      width: 18px;
      height: 18px;
      border-radius: 5px;
      object-fit: contain;
      background: rgba(250,204,21,0.1);
      padding: 2px;
    }
    .md-clipper-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: #fff;
      flex: 1;
    }
    .md-clipper-badge {
      font-size: 7.5px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #facc15;
      background: rgba(250,204,21,0.1);
      border-radius: 4px;
      padding: 2px 5px;
    }
    .md-clipper-body {
      padding: 8px;
    }
    .md-clipper-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 5px;
    }
    .md-clipper-card {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 5px;
      padding: 8px 8px 7px;
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 12px;
      background: rgba(255,255,255,0.03);
      cursor: pointer;
      transition: background 0.12s, border-color 0.12s, transform 0.1s;
      text-align: left;
    }
    .md-clipper-card:hover {
      background: rgba(255,255,255,0.07);
      border-color: rgba(255,255,255,0.12);
      transform: translateY(-1px);
    }
    .md-clipper-card:active { transform: scale(0.98); }
    .md-clipper-icon {
      font-size: 15px;
      line-height: 1;
    }
    .md-clipper-card-name {
      font-size: 10px;
      font-weight: 600;
      color: rgba(255,255,255,0.85);
      line-height: 1.2;
      max-width: 80px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .md-clipper-card-dot {
      width: 4px;
      height: 4px;
      border-radius: 50%;
      margin-top: 1px;
    }
    .md-clipper-new-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      width: 100%;
      margin-top: 5px;
      padding: 6px;
      border: 1px dashed rgba(255,255,255,0.1);
      border-radius: 10px;
      background: transparent;
      cursor: pointer;
      font-size: 10px;
      font-weight: 500;
      color: rgba(255,255,255,0.35);
      transition: all 0.12s;
      font-family: inherit;
    }
    .md-clipper-new-btn:hover {
      border-color: rgba(250,204,21,0.3);
      color: rgba(250,204,21,0.7);
      background: rgba(250,204,21,0.04);
    }
    .md-clipper-form {
      margin-top: 5px;
      border: 1px solid rgba(250,204,21,0.18);
      border-radius: 12px;
      padding: 8px;
      background: rgba(250,204,21,0.03);
    }
    .md-clipper-form-title {
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: rgba(250,204,21,0.6);
      margin-bottom: 6px;
    }
    .md-clipper-input {
      width: 100%;
      padding: 5px 8px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 7px;
      color: #fff;
      font-size: 11px;
      font-family: inherit;
      outline: none;
      box-sizing: border-box;
    }
    .md-clipper-input:focus { border-color: rgba(250,204,21,0.3); }
    .md-clipper-icon-grid {
      display: grid;
      grid-template-columns: repeat(8, 1fr);
      gap: 2px;
      margin-top: 6px;
    }
    .md-clipper-icon-opt {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 5px;
      font-size: 13px;
      cursor: pointer;
      border: 1px solid transparent;
      transition: background 0.1s;
    }
    .md-clipper-icon-opt:hover { background: rgba(255,255,255,0.08); }
    .md-clipper-icon-opt.selected { border-color: rgba(250,204,21,0.5); background: rgba(250,204,21,0.08); }
    .md-clipper-color-row {
      display: flex;
      gap: 4px;
      margin-top: 6px;
    }
    .md-clipper-color-opt {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      cursor: pointer;
      border: 2px solid transparent;
      outline: 2px solid transparent;
      outline-offset: 2px;
      transition: outline-color 0.1s;
      flex-shrink: 0;
    }
    .md-clipper-color-opt.selected { outline-color: rgba(255,255,255,0.6); }
    .md-clipper-form-actions {
      display: flex;
      gap: 4px;
      margin-top: 7px;
    }
    .md-clipper-btn-cancel {
      flex: 1;
      padding: 5px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 7px;
      color: rgba(255,255,255,0.5);
      font-size: 10px;
      font-weight: 500;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.1s;
    }
    .md-clipper-btn-cancel:hover { background: rgba(255,255,255,0.09); }
    .md-clipper-btn-create {
      flex: 2;
      padding: 5px;
      background: rgba(250,204,21,0.85);
      border: none;
      border-radius: 7px;
      color: #000;
      font-size: 10px;
      font-weight: 700;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.1s;
    }
    .md-clipper-btn-create:hover { background: #facc15; }
    .md-clipper-btn-create:disabled { opacity: 0.4; cursor: default; }
    .md-clipper-saved {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 16px 8px;
      text-align: center;
    }
    .md-clipper-saved-icon { font-size: 22px; }
    .md-clipper-saved-text {
      font-size: 12px;
      font-weight: 600;
      color: #22c55e;
    }
    .md-clipper-saved-sub {
      font-size: 10px;
      color: rgba(255,255,255,0.3);
      margin-top: 2px;
    }
  `
  document.head.appendChild(style)
}

function removeClipperPanel() {
  document.getElementById(CLIPPER_PANEL_ID)?.remove()
}

function positionPanel(panel: HTMLElement, viewportX: number, viewportY: number) {
  panel.style.visibility = "hidden"
  document.body.appendChild(panel)
  const ph = panel.offsetHeight
  const pw = panel.offsetWidth
  const left = Math.min(Math.max(viewportX - pw / 2, 8), window.innerWidth - pw - 8)
  const top = viewportY - ph - 12 < 8 ? viewportY + 14 : viewportY - ph - 12
  panel.style.left = `${left}px`
  panel.style.top = `${top}px`
  panel.style.visibility = "visible"
}

async function showClipperPanel(viewportX: number, viewportY: number, selectedText: string) {
  removeClipperPanel()
  injectClipperStyles()
  clipperPendingText = selectedText

  const folders = await getFolders().catch(() => [])
  const panel = document.createElement("div")
  panel.id = CLIPPER_PANEL_ID

  renderClipperMain(panel, folders, selectedText, viewportX, viewportY)
  positionPanel(panel, viewportX, viewportY)
}

function renderClipperMain(
  panel: HTMLElement,
  folders: Awaited<ReturnType<typeof getFolders>>,
  selectedText: string,
  viewportX: number,
  viewportY: number
) {
  panel.innerHTML = ""

  // Top bar
  const topbar = document.createElement("div")
  topbar.className = "md-clipper-topbar"

  const logoImg = document.createElement("img")
  logoImg.className = "md-clipper-logo"
  logoImg.alt = "MindDock"
  // Use chrome.runtime.getURL for the logo asset
  try {
    logoImg.src = chrome.runtime.getURL("logo minddock sem fundo.f7a9d59c.png")
  } catch {
    logoImg.style.display = "none"
  }

  const title = document.createElement("span")
  title.className = "md-clipper-title"
  title.textContent = "MindDock"

  const badge = document.createElement("span")
  badge.className = "md-clipper-badge"
  badge.textContent = "Highlights"

  topbar.appendChild(logoImg)
  topbar.appendChild(title)
  topbar.appendChild(badge)
  panel.appendChild(topbar)

  // Body
  const body = document.createElement("div")
  body.className = "md-clipper-body"

  // Folder grid
  const grid = document.createElement("div")
  grid.className = "md-clipper-grid"

  for (const folder of folders) {
    const card = document.createElement("button")
    card.type = "button"
    card.className = "md-clipper-card"

    const iconEl = document.createElement("span")
    iconEl.className = "md-clipper-icon"
    iconEl.textContent = folder.icon || "📌"

    const nameRow = document.createElement("div")
    nameRow.style.display = "flex"
    nameRow.style.alignItems = "center"
    nameRow.style.gap = "4px"

    const dot = document.createElement("span")
    dot.className = "md-clipper-card-dot"
    dot.style.background = folder.color
    dot.style.flexShrink = "0"

    const name = document.createElement("span")
    name.className = "md-clipper-card-name"
    name.textContent = folder.name

    nameRow.appendChild(dot)
    nameRow.appendChild(name)
    card.appendChild(iconEl)
    card.appendChild(nameRow)

    card.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation() })
    card.addEventListener("click", async (e) => {
      e.stopPropagation()
      await saveSnippet(folder.id, selectedText, document.title || "NotebookLM", window.location.href)
      panel.innerHTML = ""
      const saved = document.createElement("div")
      saved.className = "md-clipper-saved"
      saved.innerHTML = `<span class="md-clipper-saved-icon">✓</span><span class="md-clipper-saved-text">Saved to ${folder.name}</span><span class="md-clipper-saved-sub">${folder.icon || "📌"} ${folder.name}</span>`
      panel.appendChild(saved)
      setTimeout(removeClipperPanel, 1400)
    })

    grid.appendChild(card)
  }

  body.appendChild(grid)

  // New folder button
  const newBtn = document.createElement("button")
  newBtn.type = "button"
  newBtn.className = "md-clipper-new-btn"
  newBtn.innerHTML = `<span style="font-size:13px">+</span> New folder`
  newBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation() })
  newBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    renderCreateForm(panel, folders, selectedText, viewportX, viewportY)
  })
  body.appendChild(newBtn)

  panel.appendChild(body)
}

function renderCreateForm(
  panel: HTMLElement,
  folders: Awaited<ReturnType<typeof getFolders>>,
  selectedText: string,
  viewportX: number,
  viewportY: number
) {
  panel.innerHTML = ""

  // Top bar (same)
  const topbar = document.createElement("div")
  topbar.className = "md-clipper-topbar"
  const title = document.createElement("span")
  title.className = "md-clipper-title"
  title.textContent = "New Folder"
  const badge = document.createElement("span")
  badge.className = "md-clipper-badge"
  badge.textContent = "Highlights"
  topbar.appendChild(title)
  topbar.appendChild(badge)
  panel.appendChild(topbar)

  const body = document.createElement("div")
  body.className = "md-clipper-body"

  const form = document.createElement("div")
  form.className = "md-clipper-form"

  const formTitle = document.createElement("div")
  formTitle.className = "md-clipper-form-title"
  formTitle.textContent = "Create folder"
  form.appendChild(formTitle)

  // Name input
  const input = document.createElement("input")
  input.type = "text"
  input.className = "md-clipper-input"
  input.placeholder = "Folder name…"
  input.maxLength = 24
  form.appendChild(input)

  // Icon grid
  let selectedIcon = FOLDER_ICONS[0]
  const iconGrid = document.createElement("div")
  iconGrid.className = "md-clipper-icon-grid"
  for (const emoji of FOLDER_ICONS) {
    const opt = document.createElement("button")
    opt.type = "button"
    opt.className = `md-clipper-icon-opt${emoji === selectedIcon ? " selected" : ""}`
    opt.textContent = emoji
    opt.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation() })
    opt.addEventListener("click", (e) => {
      e.stopPropagation()
      selectedIcon = emoji
      iconGrid.querySelectorAll(".md-clipper-icon-opt").forEach((el) => el.classList.remove("selected"))
      opt.classList.add("selected")
    })
    iconGrid.appendChild(opt)
  }
  form.appendChild(iconGrid)

  // Color row
  let selectedColor = FOLDER_COLORS_PICKER[0]
  const colorRow = document.createElement("div")
  colorRow.className = "md-clipper-color-row"
  for (const color of FOLDER_COLORS_PICKER) {
    const opt = document.createElement("button")
    opt.type = "button"
    opt.className = `md-clipper-color-opt${color === selectedColor ? " selected" : ""}`
    opt.style.background = color
    opt.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation() })
    opt.addEventListener("click", (e) => {
      e.stopPropagation()
      selectedColor = color
      colorRow.querySelectorAll(".md-clipper-color-opt").forEach((el) => el.classList.remove("selected"))
      opt.classList.add("selected")
    })
    colorRow.appendChild(opt)
  }
  form.appendChild(colorRow)

  // Actions
  const actions = document.createElement("div")
  actions.className = "md-clipper-form-actions"

  const cancelBtn = document.createElement("button")
  cancelBtn.type = "button"
  cancelBtn.className = "md-clipper-btn-cancel"
  cancelBtn.textContent = "Cancel"
  cancelBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation() })
  cancelBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    renderClipperMain(panel, folders, selectedText, viewportX, viewportY)
  })

  const createBtn = document.createElement("button")
  createBtn.type = "button"
  createBtn.className = "md-clipper-btn-create"
  createBtn.textContent = "Create & Save"
  createBtn.disabled = true
  createBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation() })
  createBtn.addEventListener("click", async (e) => {
    e.stopPropagation()
    const name = input.value.trim()
    if (!name) return
    createBtn.disabled = true
    createBtn.textContent = "Saving…"
    const folder = await createFolder(name, selectedColor, selectedIcon)
    await saveSnippet(folder.id, selectedText, document.title || "NotebookLM", window.location.href)
    panel.innerHTML = ""
    const saved = document.createElement("div")
    saved.className = "md-clipper-saved"
    saved.innerHTML = `<span class="md-clipper-saved-icon">✓</span><span class="md-clipper-saved-text">Saved to ${folder.name}</span><span class="md-clipper-saved-sub">${selectedIcon} Folder created</span>`
    panel.appendChild(saved)
    setTimeout(removeClipperPanel, 1400)
  })

  input.addEventListener("input", () => {
    createBtn.disabled = input.value.trim().length === 0
  })
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !createBtn.disabled) createBtn.click()
    if (e.key === "Escape") { e.stopPropagation(); renderClipperMain(panel, folders, selectedText, viewportX, viewportY) }
  })

  actions.appendChild(cancelBtn)
  actions.appendChild(createBtn)
  form.appendChild(actions)
  body.appendChild(form)
  panel.appendChild(body)

  setTimeout(() => input.focus(), 50)
}

function onHighlightMouseUp(e: MouseEvent) {
  const panel = document.getElementById(CLIPPER_PANEL_ID)
  if (panel && panel.contains(e.target as Node)) return

  const selection = window.getSelection()
  const text = selection?.toString().trim() ?? ""

  if (text.length >= 15) {
    const range = selection!.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    void showClipperPanel(rect.left + rect.width / 2, rect.top, text)
  } else {
    if (clipperHideTimer) clearTimeout(clipperHideTimer)
    clipperHideTimer = setTimeout(() => {
      if ((window.getSelection()?.toString().trim() ?? "").length < 15) removeClipperPanel()
    }, 160)
  }
}

function onHighlightKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape") removeClipperPanel()
}

// ─── Orchestration ────────────────────────────────────────────────────────────

function refreshUi(): void {
  mountTargets()
  mountAgileBar()
  mountFocusThreadsBar()
  updateAgileBarPosition()
  updateFocusThreadsBarPosition()
  injectZettelButtons()
}

function scheduleRefresh(): void {
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer)
  }

  refreshTimer = window.setTimeout(() => {
    refreshTimer = null
    refreshUi()
  }, 100)
}

function startObservers(): void {
  if (!(document.body instanceof HTMLBodyElement)) {
    return
  }

  if (!domObserver) {
    domObserver = new MutationObserver(() => {
      scheduleRefresh()
    })

    domObserver.observe(document.body, {
      childList: true,
      subtree: true
    })
  }

  if (!zettelObserver) {
    zettelObserver = new MutationObserver(() => {
      injectZettelButtons()
    })

    zettelObserver.observe(document.body, {
      childList: true,
      subtree: true
    })
  }

  if (agilePositionTimer === null) {
    agilePositionTimer = window.setInterval(updateAgileBarPosition, 700)
  }

  if (focusThreadsPositionTimer === null) {
    focusThreadsPositionTimer = window.setInterval(updateFocusThreadsBarPosition, 700)
  }

  window.addEventListener("resize", updateAgileBarPosition)
  window.addEventListener("scroll", updateAgileBarPosition, true)
  window.addEventListener("resize", updateFocusThreadsBarPosition)

  document.addEventListener("mouseup", onHighlightMouseUp)
  document.addEventListener("keydown", onHighlightKeyDown)
  document.addEventListener("scroll", removeClipperPanel, { passive: true, capture: true })
}

function cleanup(): void {
  domObserver?.disconnect()
  domObserver = null

  zettelObserver?.disconnect()
  zettelObserver = null

  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer)
    refreshTimer = null
  }

  if (agilePositionTimer !== null) {
    window.clearInterval(agilePositionTimer)
    agilePositionTimer = null
  }

  if (focusThreadsPositionTimer !== null) {
    window.clearInterval(focusThreadsPositionTimer)
    focusThreadsPositionTimer = null
  }

  window.removeEventListener("resize", updateAgileBarPosition)
  window.removeEventListener("scroll", updateAgileBarPosition, true)
  window.removeEventListener("resize", updateFocusThreadsBarPosition)

  document.removeEventListener("mouseup", onHighlightMouseUp)
  document.removeEventListener("keydown", onHighlightKeyDown)
  document.removeEventListener("scroll", removeClipperPanel, true)
  removeClipperPanel()

  window.removeEventListener("pagehide", cleanup)
  window.removeEventListener("beforeunload", cleanup)

  for (const [key, mounted] of mountedRoots.entries()) {
    mounted.root.unmount()
    mountedRoots.delete(key)

    if (key === "agile-bar" || key === "focus-threads") {
      mounted.host.remove()
    }
  }

  const globalState = resolveGlobalState()
  if (globalState.cleanup === cleanup) {
    globalState.cleanup = null
  }
}

function bootstrap(): void {
  cleanupPreviousInstance()

  const run = () => {
    refreshUi()
    startObservers()
    resolveGlobalState().cleanup = cleanup
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", run, { once: true })
  } else {
    run()
  }
}

bootstrap()
window.addEventListener("pagehide", cleanup)
window.addEventListener("beforeunload", cleanup)

export {}
