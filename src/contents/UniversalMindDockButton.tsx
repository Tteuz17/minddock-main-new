import type { PlasmoCSConfig } from "plasmo"
import { useEffect, useState } from "react"
import { createRoot, type Root } from "react-dom/client"

export const config: PlasmoCSConfig = {
  matches: [
    "https://chat.openai.com/*",
    "https://chatgpt.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*"
  ],
  run_at: "document_idle"
}

type StorageSnapshot = Record<string, unknown>
type GlobalWindowRecord = typeof window & Record<string, unknown>

const STORAGE_KEY = "minddock_cached_notebooks"
const CUSTOM_EVENT_NAME = "MINDDOCK_OPEN_SELECTOR"
const HOST_ID = "minddock-universal-button-host"
const MOUNT_ID = "minddock-universal-button-root"
const CLEANUP_KEY = "__MINDDOCK_UNIVERSAL_BUTTON_CLEANUP__"
const STABILITY_WINDOW_MS = 600
const MAX_STABILITY_WAIT_MS = 5000
const RIGHT_OFFSET_PX = 80
const MIN_TOP_OFFSET_PX = 24
const SAFE_TOP_GAP_PX = 12

let mountedRoot: Root | null = null
let mountedHost: HTMLElement | null = null
let bootstrapPromise: Promise<void> | null = null

function normalizeNotebookCount(value: unknown): number {
  if (!Array.isArray(value)) {
    return 0
  }

  return value.filter((item) => item && typeof item === "object" && !Array.isArray(item)).length
}

async function readNotebookCount(): Promise<number> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(STORAGE_KEY, (result: StorageSnapshot) => {
        if (chrome.runtime.lastError) {
          resolve(0)
          return
        }

        resolve(normalizeNotebookCount(result[STORAGE_KEY]))
      })
    } catch {
      resolve(0)
    }
  })
}

async function waitForDocumentLoad(): Promise<void> {
  if (document.readyState === "complete") {
    return
  }

  await new Promise<void>((resolve) => {
    window.addEventListener(
      "load",
      () => {
        resolve()
      },
      { once: true }
    )
  })
}

async function waitForBodyElement(): Promise<HTMLBodyElement> {
  if (document.body instanceof HTMLBodyElement) {
    return document.body
  }

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (document.body instanceof HTMLBodyElement) {
        observer.disconnect()
        resolve(document.body)
      }
    })

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    })
  })
}

async function waitForStableBody(bodyElement: HTMLBodyElement): Promise<void> {
  await new Promise<void>((resolve) => {
    let finished = false
    let settleTimer = 0

    const finish = (): void => {
      if (finished) {
        return
      }

      finished = true
      observer.disconnect()
      window.clearTimeout(settleTimer)
      window.clearTimeout(hardTimeout)
      resolve()
    }

    const resetSettleTimer = (): void => {
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        finish()
      }, STABILITY_WINDOW_MS)
    }

    const observer = new MutationObserver(() => {
      resetSettleTimer()
    })

    const hardTimeout = window.setTimeout(() => {
      finish()
    }, MAX_STABILITY_WAIT_MS)

    observer.observe(bodyElement, {
      childList: true,
      subtree: true,
      attributes: true
    })

    resetSettleTimer()
  })
}

async function waitForSafeMountWindow(): Promise<void> {
  await waitForDocumentLoad()
  const bodyElement = await waitForBodyElement()
  await waitForStableBody(bodyElement)

  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        resolve()
      })
    })
  })
}

function isVisibleElement(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false
  }

  const computedStyle = window.getComputedStyle(element)
  if (
    computedStyle.display === "none" ||
    computedStyle.visibility === "hidden" ||
    computedStyle.pointerEvents === "none"
  ) {
    return false
  }

  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function resolveTopCollisionOffset(): number {
  const scanSelectors = [
    "header",
    "[role='banner']",
    "[role='toolbar']",
    "button",
    "a"
  ].join(", ")

  const scanBoundaryLeft = Math.max(0, window.innerWidth - 320)
  let maxBottom = MIN_TOP_OFFSET_PX

  for (const element of Array.from(document.querySelectorAll(scanSelectors))) {
    if (!isVisibleElement(element)) {
      continue
    }

    const rect = element.getBoundingClientRect()
    if (rect.bottom <= 0 || rect.top >= 180) {
      continue
    }

    if (rect.right < scanBoundaryLeft) {
      continue
    }

    maxBottom = Math.max(maxBottom, Math.ceil(rect.bottom + SAFE_TOP_GAP_PX))
  }

  return Math.max(MIN_TOP_OFFSET_PX, maxBottom)
}

function applyFloatingPosition(): void {
  if (!(mountedHost instanceof HTMLElement)) {
    return
  }

  mountedHost.style.position = "fixed"
  mountedHost.style.right = `${RIGHT_OFFSET_PX}px`
  mountedHost.style.top = `${resolveTopCollisionOffset()}px`
  mountedHost.style.bottom = "auto"
  mountedHost.style.left = "auto"
  mountedHost.style.zIndex = "2147483647"
  mountedHost.style.display = "block"
  mountedHost.style.pointerEvents = "auto"
  mountedHost.style.width = "auto"
}

function ensureShadowMount(): HTMLDivElement {
  const existingHost = document.getElementById(HOST_ID)
  const host =
    existingHost instanceof HTMLElement ? existingHost : document.createElement("minddock-uab")

  host.id = HOST_ID

  const bodyTarget = document.body ?? document.documentElement
  if (host.parentElement !== bodyTarget) {
    bodyTarget.appendChild(host)
  }

  mountedHost = host
  applyFloatingPosition()

  const shadowRoot =
    host.shadowRoot instanceof ShadowRoot ? host.shadowRoot : host.attachShadow({ mode: "open" })

  let mountPoint = shadowRoot.getElementById(MOUNT_ID) as HTMLDivElement | null
  if (!mountPoint) {
    mountPoint = document.createElement("div")
    mountPoint.id = MOUNT_ID

    shadowRoot.append(mountPoint)
  }

  return mountPoint
}

function cleanupUniversalMindDockButton(): void {
  mountedRoot?.unmount()
  mountedRoot = null
  bootstrapPromise = null

  if (mountedHost) {
    mountedHost.remove()
    mountedHost = null
  }
}

function dispatchOpenSelector(notebookCount: number): void {
  window.dispatchEvent(
    new CustomEvent(CUSTOM_EVENT_NAME, {
      bubbles: true,
      composed: true,
      detail: {
        notebookCount
      }
    })
  )
}

function UniversalMindDockButton(): JSX.Element {
  const [notebookCount, setNotebookCount] = useState(0)
  const [isHovered, setIsHovered] = useState(false)

  useEffect(() => {
    let isActive = true

    const syncNotebookCount = async (): Promise<void> => {
      const nextCount = await readNotebookCount()
      if (isActive) {
        setNotebookCount(nextCount)
      }
    }

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ): void => {
      if (areaName !== "local" || !changes[STORAGE_KEY]) {
        return
      }

      setNotebookCount(normalizeNotebookCount(changes[STORAGE_KEY].newValue))
      window.requestAnimationFrame(() => {
        applyFloatingPosition()
      })
    }

    void syncNotebookCount()
    chrome.storage.onChanged.addListener(handleStorageChange)

    return () => {
      isActive = false
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [])

  useEffect(() => {
    let frameId = 0
    let debounceTimer = 0

    const schedulePositionRefresh = (): void => {
      window.clearTimeout(debounceTimer)
      debounceTimer = window.setTimeout(() => {
        frameId = window.requestAnimationFrame(() => {
          applyFloatingPosition()
        })
      }, 120)
    }

    schedulePositionRefresh()

    const observer = new MutationObserver(() => {
      schedulePositionRefresh()
    })

    if (document.body instanceof HTMLBodyElement) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true
      })
    }

    window.addEventListener("resize", schedulePositionRefresh)

    return () => {
      observer.disconnect()
      window.removeEventListener("resize", schedulePositionRefresh)
      window.clearTimeout(debounceTimer)
      window.cancelAnimationFrame(frameId)
    }
  }, [])

  const buttonLabel = notebookCount > 0 ? `🧠 ${notebookCount}` : "🧠"

  const shellStyle: React.CSSProperties = {
    all: "initial",
    display: "block",
    fontFamily: 'Inter, "Segoe UI", Arial, sans-serif'
  }

  const buttonStyle: React.CSSProperties = {
    all: "initial",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    minHeight: "40px",
    padding: notebookCount > 0 ? "10px 12px" : "10px",
    borderRadius: "12px",
    background: isHovered ? "#7c83ff" : "#6366f1",
    color: "#ffffff",
    fontSize: "13px",
    fontWeight: 700,
    lineHeight: 1,
    cursor: "pointer",
    boxShadow: "0 14px 30px rgba(99, 102, 241, 0.22)",
    letterSpacing: "0.01em"
  }

  return (
    <div style={shellStyle} suppressHydrationWarning={true}>
      <button
        aria-label="Open MindDock notebook selector"
        onClick={() => {
          dispatchOpenSelector(notebookCount)
        }}
        onMouseEnter={() => {
          setIsHovered(true)
        }}
        onMouseLeave={() => {
          setIsHovered(false)
        }}
        style={buttonStyle}
        type="button">
        {buttonLabel}
      </button>
    </div>
  )
}

async function bootstrapUniversalMindDockButton(): Promise<void> {
  if (mountedRoot || bootstrapPromise) {
    return
  }

  bootstrapPromise = (async () => {
    await waitForSafeMountWindow()

    if (mountedRoot) {
      return
    }

    const mountPoint = ensureShadowMount()
    mountedRoot = createRoot(mountPoint)
    mountedRoot.render(<UniversalMindDockButton />)
  })()

  try {
    await bootstrapPromise
  } finally {
    bootstrapPromise = null
  }
}

const globalWindowRecord = window as GlobalWindowRecord
const existingCleanup = globalWindowRecord[CLEANUP_KEY]
if (typeof existingCleanup === "function") {
  try {
    ;(existingCleanup as () => void)()
  } catch {
    // Ignore stale cleanup errors from prior hot reload cycles.
  }
}

globalWindowRecord[CLEANUP_KEY] = cleanupUniversalMindDockButton

void bootstrapUniversalMindDockButton()
window.addEventListener("beforeunload", cleanupUniversalMindDockButton)

const UniversalMindDockButtonMount = () => null

export default UniversalMindDockButtonMount
