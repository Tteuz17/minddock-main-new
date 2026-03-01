import type { PlasmoCSConfig } from "plasmo"
import { createRoot, type Root } from "react-dom/client"
import "~/styles/globals.css"
import { AgilePromptsBar } from "../../contents/notebooklm/AgilePromptsBar"
import { FocusThreadsBar } from "../../contents/notebooklm/FocusThreadsBar"
import { SourceDownloadPanel } from "../../contents/notebooklm/SourceDownloadPanel"
import { SourceFilterPanel } from "../../contents/notebooklm/SourceFilterPanel"
import { ZettelButton } from "../../contents/notebooklm/ZettelButton"
import { getDeepRoots, isVisible, resolveSourceActionsHost, resolveSourceFiltersHost } from "../../contents/notebooklm/sourceDom"

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

  for (const [key, mounted] of mountedRoots.entries()) {
    mounted.root.unmount()
    mountedRoots.delete(key)

    if (key === "agile-bar" || key === "focus-threads") {
      mounted.host.remove()
    }
  }
}

function bootstrap(): void {
  const run = () => {
    refreshUi()
    startObservers()
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", run, { once: true })
  } else {
    run()
  }
}

bootstrap()
window.addEventListener("beforeunload", cleanup)

const NotebooklmInjectorMount = () => null

export default NotebooklmInjectorMount
