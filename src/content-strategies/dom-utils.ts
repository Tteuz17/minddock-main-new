import type { CSSProperties } from "react"

import type { StrategyPlacement } from "./types"

/** Inline style for the host element when mounted inside a toolbar. */
export const INLINE_HOST_STYLE = "display:inline-flex;align-items:center;vertical-align:middle;margin:0 4px"

/** CSS returned by getStyles() when the button is mounted inline inside the page toolbar. */
export const INLINE_CONTAINER_STYLE: CSSProperties = { position: "relative" }

/**
 * Tries to insert `host` as a child of the first visible toolbar element matching `selectors`.
 * Sets host inline display and returns `true` on success.
 */
export function tryMountInToolbar(host: HTMLElement, selectors: readonly string[]): boolean {
  const toolbar = queryFirstVisibleElement(selectors)
  if (!toolbar) return false

  host.style.cssText = INLINE_HOST_STYLE
  if (host.parentElement !== toolbar) {
    toolbar.appendChild(host)
  }
  return true
}

/**
 * Tries to insert `host` immediately after the first visible element matching `anchorSelectors`.
 * Falls back to `tryMountInToolbar` with `fallbackSelectors` if no anchor is found.
 * Returns `true` on success.
 */
export function tryMountAfterElement(
  host: HTMLElement,
  anchorSelectors: readonly string[],
  fallbackSelectors: readonly string[]
): boolean {
  const anchor = queryFirstVisibleElement(anchorSelectors)
  if (anchor?.parentElement) {
    host.style.cssText = INLINE_HOST_STYLE
    const alreadyAfter =
      host.parentElement === anchor.parentElement && host.previousElementSibling === anchor
    if (!alreadyAfter) {
      anchor.parentElement.insertBefore(host, anchor.nextSibling)
    }
    return true
  }
  return tryMountInToolbar(host, fallbackSelectors)
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function isVisibleElement(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected) {
    return false
  }

  if (element.hidden || element.getAttribute("aria-hidden") === "true") {
    return false
  }

  const style = window.getComputedStyle(element)
  return style.display !== "none" && style.visibility !== "hidden"
}

export function queryFirstVisibleElement(
  selectors: readonly string[],
  root: ParentNode = document
): HTMLElement | null {
  for (const selector of selectors) {
    let candidates: Element[] = []
    try {
      candidates = Array.from(root.querySelectorAll(selector))
    } catch {
      continue
    }

    for (const candidate of candidates) {
      if (isVisibleElement(candidate)) {
        return candidate
      }
    }
  }

  return null
}

export function resolveFallbackPlacement(): StrategyPlacement {
  return {
    style: {
      top: "24px",
      right: "24px"
    },
    menuAlign: "right"
  }
}

export function resolveLeftOfAnchorPlacement(rect: DOMRect, gapPx: number): StrategyPlacement {
  const minTop = 8
  const maxTop = Math.max(minTop, window.innerHeight - 52)
  const top = clampNumber(Math.round(rect.top), minTop, maxTop)
  const minLeft = 8
  const maxLeft = Math.max(minLeft, window.innerWidth - 8)
  const left = clampNumber(Math.round(rect.left), minLeft, maxLeft)

  if (left < 180) {
    const rightSideLeft = clampNumber(
      Math.round(rect.right + gapPx),
      minLeft,
      Math.max(minLeft, window.innerWidth - 220)
    )
    return {
      style: {
        top: `${top}px`,
        left: `${rightSideLeft}px`
      },
      menuAlign: "left"
    }
  }

  return {
    style: {
      top: `${top}px`,
      left: `${left}px`,
      transform: `translateX(calc(-100% - ${gapPx}px))`
    },
    menuAlign: left < 440 ? "left" : "right"
  }
}

export function resolveRightOfAnchorPlacement(rect: DOMRect, gapPx: number): StrategyPlacement {
  const minTop = 8
  const maxTop = Math.max(minTop, window.innerHeight - 52)
  const top = clampNumber(Math.round(rect.top), minTop, maxTop)
  const minLeft = 8
  const maxLeft = Math.max(minLeft, window.innerWidth - 220)
  const left = clampNumber(Math.round(rect.right + gapPx), minLeft, maxLeft)

  return {
    style: {
      top: `${top}px`,
      left: `${left}px`
    },
    menuAlign: left < 440 ? "left" : "right"
  }
}
