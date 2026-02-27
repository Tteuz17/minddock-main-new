import type { PlasmoCSConfig } from "plasmo"
import { createRoot, type Root } from "react-dom/client"
import "~/styles/globals.css"
import { AgilePromptsBar } from "../../contents/notebooklm/AgilePromptsBar"
import { SourceDownloadPanel } from "../../contents/notebooklm/SourceDownloadPanel"
import { SourceFilterPanel } from "../../contents/notebooklm/SourceFilterPanel"
import { ZettelButton } from "../../contents/notebooklm/ZettelButton"
import { isVisible, resolveSourceActionsHost, resolveSourceFiltersHost } from "../../contents/notebooklm/sourceDom"

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

let domObserver: MutationObserver | null = null
let refreshTimer: number | null = null
let agilePositionTimer: number | null = null
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

function refreshUi(): void {
  mountTargets()
  mountAgileBar()
  updateAgileBarPosition()
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

  window.addEventListener("resize", updateAgileBarPosition)
  window.addEventListener("scroll", updateAgileBarPosition, true)
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

  window.removeEventListener("resize", updateAgileBarPosition)
  window.removeEventListener("scroll", updateAgileBarPosition, true)

  for (const [key, mounted] of mountedRoots.entries()) {
    mounted.root.unmount()
    mountedRoots.delete(key)

    if (key === "agile-bar") {
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
