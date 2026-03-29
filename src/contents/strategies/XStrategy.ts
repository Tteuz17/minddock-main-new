import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign } from "./types"
import { INLINE_CONTAINER_STYLE, isVisibleElement } from "./dom-utils"

const X_HOST_TOKENS = ["x.com", "twitter.com"] as const

const X_BACK_BUTTON_SELECTORS = [
  "button[data-testid='app-bar-back']",
  "button[aria-label='Back']",
  "button[aria-label='Voltar']",
  "button[aria-label='Regresar']",
  "button[aria-label='Retour']"
] as const

const X_HEADER_TITLE_SELECTOR = "h2[role='heading']"
const X_HEADER_RETRY_DELAYS_MS = [200, 500, 1000, 1800, 3000] as const
const X_ROUTE_WATCH_INTERVAL_MS = 250
const X_INLINE_GAP_PX = 8

const X_INLINE_HOST_STYLE = `display:inline-flex;align-items:center;vertical-align:middle;margin-left:${X_INLINE_GAP_PX}px;margin-right:0`

const X_FALLBACK_CONTAINER_STYLE: CSSProperties = {
  top: "24px",
  right: "24px"
}

function parseStatusIdFromUrl(value: string): string {
  const match = String(value ?? "").match(/\/status\/(\d+)/iu)
  return String(match?.[1] ?? "").trim()
}

function resolveDirectChildInContainer(container: HTMLElement, element: Element | null): HTMLElement | null {
  if (!(element instanceof HTMLElement) || !isVisibleElement(element)) {
    return null
  }

  let currentElement: HTMLElement | null = element
  for (let depth = 0; depth < 8 && currentElement; depth += 1) {
    if (currentElement.parentElement === container) {
      return currentElement
    }
    currentElement = currentElement.parentElement
  }

  return null
}

function resolveBackButtonElement(): HTMLElement | null {
  const candidates: HTMLElement[] = []
  for (const selector of X_BACK_BUTTON_SELECTORS) {
    candidates.push(...Array.from(document.querySelectorAll<HTMLElement>(selector)))
  }

  let bestCandidate: HTMLElement | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (const backButtonElement of candidates) {
    if (!isVisibleElement(backButtonElement)) {
      continue
    }

    const backButtonRect = backButtonElement.getBoundingClientRect()
    if (backButtonRect.width < 16 || backButtonRect.height < 16) {
      continue
    }

    if (backButtonRect.top < -8 || backButtonRect.top > 260) {
      continue
    }

    const score = Math.abs(backButtonRect.top - 72)
    if (score < bestScore) {
      bestScore = score
      bestCandidate = backButtonElement
    }
  }

  return bestCandidate
}

function resolveHeaderContainerFromBackButton(backButtonElement: HTMLElement): HTMLElement | null {
  let currentContainer: HTMLElement | null = backButtonElement.parentElement
  for (let depth = 0; depth < 3 && currentContainer; depth += 1) {
    if (!isVisibleElement(currentContainer)) {
      currentContainer = currentContainer.parentElement
      continue
    }

    const headingElement = currentContainer.querySelector(X_HEADER_TITLE_SELECTOR)
    if (headingElement instanceof HTMLElement && isVisibleElement(headingElement)) {
      return currentContainer
    }

    const className =
      typeof currentContainer.className === "string" ? currentContainer.className.toLowerCase() : ""
    if (currentContainer.tagName === "HEADER" || className.includes("header")) {
      return currentContainer
    }

    currentContainer = currentContainer.parentElement
  }

  return backButtonElement.parentElement
}

function resolveHeaderTitleContainer(headerContainer: HTMLElement): HTMLElement | null {
  const headingElement = headerContainer.querySelector(X_HEADER_TITLE_SELECTOR)
  if (!(headingElement instanceof HTMLElement) || !isVisibleElement(headingElement)) {
    return null
  }

  return resolveDirectChildInContainer(headerContainer, headingElement) ?? headingElement
}

export class XStrategy implements ContentStrategy {
  readonly id = "x"

  private mountedInline = false
  private lastMountedStatusId = ""
  private trackedHostElement: HTMLElement | null = null
  private mutationObserverInstance: MutationObserver | null = null
  private mutationAnimationFrameId: number | null = null
  private retryTimeoutIds: number[] = []
  private retrySequenceScheduled = false
  private routeWatchIntervalId: number | null = null
  private routeWatchListener: (() => void) | null = null
  private lastObservedUrl = ""

  matches(url: string): boolean {
    try {
      const parsed = new URL(url)
      const host = parsed.hostname.toLowerCase()
      const pathname = parsed.pathname.toLowerCase()

      if (!X_HOST_TOKENS.some((token) => host === token || host.endsWith(`.${token}`))) {
        return false
      }

      // Grok route on x.com is handled by GrokStrategy.
      if (/^\/i\/grok(?:\/|$)/u.test(pathname)) {
        return false
      }

      return true
    } catch {
      return false
    }
  }

  getRootContainer(): HTMLElement | null {
    return document.body
  }

  private clearRetrySequence(): void {
    for (const timeoutId of this.retryTimeoutIds) {
      window.clearTimeout(timeoutId)
    }
    this.retryTimeoutIds = []
    this.retrySequenceScheduled = false
  }

  private ensureRouteWatcher(): void {
    if (this.routeWatchIntervalId !== null) {
      return
    }

    this.lastObservedUrl = window.location.href

    const handleRouteSignal = (): void => {
      const nextUrl = window.location.href
      if (nextUrl === this.lastObservedUrl) {
        return
      }

      this.lastObservedUrl = nextUrl

      const trackedHostElement = this.trackedHostElement
      if (!trackedHostElement) {
        return
      }

      // Reinicia a janela de retries a cada troca real de post/rota.
      this.clearRetrySequence()
      this.runMountPass(trackedHostElement)
      this.scheduleRetryMounts(trackedHostElement)
    }

    this.routeWatchListener = handleRouteSignal
    window.addEventListener("popstate", handleRouteSignal, true)
    window.addEventListener("hashchange", handleRouteSignal, true)
    this.routeWatchIntervalId = window.setInterval(handleRouteSignal, X_ROUTE_WATCH_INTERVAL_MS)
  }

  private ensureMutationObserver(): void {
    if (this.mutationObserverInstance || !document.body) {
      return
    }

    this.mutationObserverInstance = new MutationObserver(() => {
      if (this.mutationAnimationFrameId !== null) {
        return
      }

      this.mutationAnimationFrameId = window.requestAnimationFrame(() => {
        this.mutationAnimationFrameId = null

        const trackedHostElement = this.trackedHostElement
        if (!trackedHostElement) {
          return
        }

        this.runMountPass(trackedHostElement)
      })
    })

    this.mutationObserverInstance.observe(document.body, { childList: true, subtree: true })
  }

  private scheduleRetryMounts(hostElement: HTMLElement): void {
    if (this.retrySequenceScheduled) {
      return
    }

    this.retrySequenceScheduled = true

    for (const delayMs of X_HEADER_RETRY_DELAYS_MS) {
      const timeoutId = window.setTimeout(() => {
        this.retryTimeoutIds = this.retryTimeoutIds.filter((activeTimeoutId) => activeTimeoutId !== timeoutId)

        if (!hostElement.isConnected && !this.matches(window.location.href)) {
          this.retrySequenceScheduled = this.retryTimeoutIds.length > 0
          return
        }

        if (this.runMountPass(hostElement)) {
          this.clearRetrySequence()
          return
        }

        if (this.retryTimeoutIds.length === 0) {
          this.retrySequenceScheduled = false
        }
      }, delayMs)

      this.retryTimeoutIds.push(timeoutId)
    }
  }

  private runMountPass(hostElement: HTMLElement): boolean {
    if (!this.matches(window.location.href)) {
      hostElement.style.cssText = "display:none"
      this.mountedInline = false
      this.lastMountedStatusId = ""
      return false
    }

    if (this.tryMountInline(hostElement)) {
      return true
    }

    this.ensureFallbackMount(hostElement)
    return false
  }

  private tryMountInline(hostElement: HTMLElement): boolean {
    const backButtonElement = resolveBackButtonElement()
    if (!backButtonElement) {
      this.mountedInline = false
      this.lastMountedStatusId = ""
      return false
    }

    const headerContainer = resolveHeaderContainerFromBackButton(backButtonElement)
    const backButtonContainer =
      resolveDirectChildInContainer(headerContainer ?? backButtonElement, backButtonElement.parentElement) ??
      backButtonElement.parentElement ??
      backButtonElement
    const headerTitleContainer = headerContainer ? resolveHeaderTitleContainer(headerContainer) : null
    const insertionAnchorElement = headerTitleContainer ?? backButtonContainer

    const insertionParentElement =
      insertionAnchorElement.parentElement ?? headerContainer ?? backButtonElement.parentElement

    if (!insertionParentElement) {
      this.mountedInline = false
      this.lastMountedStatusId = ""
      return false
    }

    hostElement.style.cssText = X_INLINE_HOST_STYLE
    const isAlreadyMountedAfterAnchor =
      hostElement.parentElement === insertionParentElement &&
      hostElement.previousElementSibling === insertionAnchorElement

    if (!isAlreadyMountedAfterAnchor) {
      try {
        insertionParentElement.insertBefore(hostElement, insertionAnchorElement.nextSibling)
      } catch {
        this.mountedInline = false
        this.lastMountedStatusId = ""
        return false
      }
    }

    this.mountedInline = true
    this.lastMountedStatusId = parseStatusIdFromUrl(window.location.href)
    return true
  }

  private ensureFallbackMount(hostElement: HTMLElement): void {
    const fallbackParent = document.body ?? document.documentElement
    if (!fallbackParent) {
      return
    }

    hostElement.style.cssText = ""
    if (hostElement.parentElement !== fallbackParent) {
      fallbackParent.appendChild(hostElement)
    }
    this.mountedInline = false
    this.lastMountedStatusId = ""
  }

  mountHost(hostElement: HTMLElement): boolean {
    this.trackedHostElement = hostElement
    this.ensureMutationObserver()
    this.ensureRouteWatcher()

    const currentStatusId = parseStatusIdFromUrl(window.location.href)
    if (
      this.mountedInline &&
      hostElement.isConnected &&
      currentStatusId &&
      currentStatusId === this.lastMountedStatusId
    ) {
      return true
    }

    const mountedInline = this.runMountPass(hostElement)
    this.scheduleRetryMounts(hostElement)

    // Returning false allows InjectionManager fallback mount in body while retries keep trying inline.
    return mountedInline
  }

  getStyles(): CSSProperties {
    return this.mountedInline ? INLINE_CONTAINER_STYLE : X_FALLBACK_CONTAINER_STYLE
  }

  getMenuAlign(): StrategyMenuAlign {
    return "left"
  }
}
