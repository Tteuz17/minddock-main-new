import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign } from "./types"
import { clampNumber, isVisibleElement, queryFirstVisibleElement, resolveFallbackPlacement } from "./dom-utils"

const PERPLEXITY_HOST_TOKENS = ["perplexity.ai"] as const

// "Thread actions" (...) button in the top-right header
const PERPLEXITY_ANCHOR_SELECTORS = [
  "button[aria-label='Thread actions']",
  "button[aria-label*='Thread' i]",
  "button[aria-label*='Actions' i]",
  "button[aria-label*='More' i]",
  "button[aria-label*='Options' i]",
  "button[aria-label*='Menu' i]"
] as const

const PERPLEXITY_ACTION_CONTAINER_SELECTORS = [
  "div.gap-x-sm.pointer-events-auto.relative.flex.min-w-0.items-center.justify-end",
  "div[class*='gap-x-sm'][class*='items-center'][class*='justify-end']",
  "div[class*='gap-x-'][class*='items-center'][class*='justify-end']",
  "header div[class*='items-center'][class*='justify-end']"
] as const

const PERPLEXITY_ANCHOR_TOKENS = [
  "thread",
  "action",
  "actions",
  "more",
  "option",
  "options",
  "menu",
  "settings",
  "config",
  "configur"
] as const

const PERPLEXITY_SHARE_TOKENS = ["share", "compart", "copiar", "copy", "link"] as const

const FLOATING_BUTTON_SIZE_PX = 32
const FLOATING_BUTTON_GAP_PX = 10

let lastPerplexityStyle: CSSProperties | null = null

function isPerplexitySearchRoute(): boolean {
  const pathname = window.location.pathname.toLowerCase()
  return pathname === "/search" || pathname.startsWith("/search/")
}

function normalizeLabel(control: HTMLElement): string {
  const label = [
    control.getAttribute("aria-label") ?? "",
    control.getAttribute("title") ?? "",
    control.textContent ?? ""
  ]
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()

  return label
}

function isLikelyShareControl(label: string): boolean {
  return PERPLEXITY_SHARE_TOKENS.some((token) => label.includes(token))
}

function isHeaderControlCandidate(control: HTMLElement): boolean {
  if (!isVisibleElement(control)) return false
  const rect = control.getBoundingClientRect()
  if (rect.width < 14 || rect.height < 14) return false
  if (rect.top < -4 || rect.top > 200) return false
  if (rect.right < window.innerWidth * 0.45) return false
  if (rect.left < -4 || rect.right > window.innerWidth + 8) return false
  return true
}

function isSmallControl(control: HTMLElement): boolean {
  const rect = control.getBoundingClientRect()
  return rect.width <= 40 && rect.height <= 40
}

function pickRightMostControl(controls: HTMLElement[]): HTMLElement | null {
  if (controls.length === 0) return null

  let best: HTMLElement | null = null
  let bestRight = -Infinity

  for (const control of controls) {
    const rect = control.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    if (rect.right > bestRight) {
      bestRight = rect.right
      best = control
    }
  }

  return best
}

function pickAnchorByLabel(controls: HTMLElement[]): HTMLElement | null {
  for (const control of controls) {
    const label = normalizeLabel(control)
    if (!label) continue
    if (PERPLEXITY_ANCHOR_TOKENS.some((token) => label.includes(token))) {
      return control
    }
  }
  return null
}

function pickBestAnchor(controls: HTMLElement[]): HTMLElement | null {
  const headerControls = controls.filter(isHeaderControlCandidate)
  if (headerControls.length === 0) return null

  const byLabel = pickAnchorByLabel(headerControls)
  if (byLabel) return byLabel

  const nonShareControls = headerControls.filter((control) => !isLikelyShareControl(normalizeLabel(control)))
  const smallControls = nonShareControls.filter(isSmallControl)
  const rightMostSmall = pickRightMostControl(smallControls)
  if (rightMostSmall) return rightMostSmall

  const rightMostNonShare = pickRightMostControl(nonShareControls)
  if (rightMostNonShare) return rightMostNonShare

  return pickRightMostControl(headerControls)
}

function resolvePerplexityAnchor(): HTMLElement | null {
  for (const selector of PERPLEXITY_ANCHOR_SELECTORS) {
    const candidate = document.querySelector(selector)
    if (candidate instanceof HTMLElement && isHeaderControlCandidate(candidate)) {
      return candidate
    }
  }

  const container = queryFirstVisibleElement(PERPLEXITY_ACTION_CONTAINER_SELECTORS)
  if (container) {
    const controls = Array.from(
      container.querySelectorAll<HTMLElement>("button, [role='button'], a")
    ).filter(isVisibleElement)

    const picked = pickBestAnchor(controls)
    if (picked) return picked
  }

  const header = document.querySelector("header")
  if (header instanceof HTMLElement) {
    const headerControls = Array.from(
      header.querySelectorAll<HTMLElement>("button, [role='button'], a")
    ).filter(isVisibleElement)

    const picked = pickBestAnchor(headerControls)
    if (picked) return picked
  }

  return null
}

function resolveLeftOfAnchorStyle(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return resolveFallbackPlacement().style

  const minTop = 8
  const maxTop = Math.max(minTop, window.innerHeight - FLOATING_BUTTON_SIZE_PX - 8)
  const top = clampNumber(
    Math.round(rect.top + (rect.height - FLOATING_BUTTON_SIZE_PX) / 2),
    minTop,
    maxTop
  )

  const minLeft = 8
  const maxLeft = Math.max(minLeft, window.innerWidth - FLOATING_BUTTON_SIZE_PX - 8)
  const leftCandidate = Math.round(rect.left - FLOATING_BUTTON_SIZE_PX - FLOATING_BUTTON_GAP_PX)
  const left = clampNumber(leftCandidate, minLeft, maxLeft)

  return {
    position: "fixed",
    top: `${top}px`,
    left: `${left}px`,
    zIndex: 2147483646,
    pointerEvents: "auto"
  }
}

export class PerplexityStrategy implements ContentStrategy {
  readonly id = "perplexity"

  matches(url: string): boolean {
    try {
      const parsed = new URL(url)
      const host = parsed.hostname.toLowerCase()
      return PERPLEXITY_HOST_TOKENS.some((token) => host === token || host.endsWith(`.${token}`))
    } catch {
      return false
    }
  }

  getRootContainer(): HTMLElement | null {
    return document.body
  }

  // Do NOT inject into Perplexity's React tree - use fixed positioning instead.
  mountHost(_host: HTMLElement): boolean {
    return false
  }

  getStyles(): CSSProperties {
    if (!isPerplexitySearchRoute()) {
      lastPerplexityStyle = null
      return {
        position: "fixed",
        top: "-9999px",
        left: "-9999px",
        pointerEvents: "none"
      }
    }

    const anchor = resolvePerplexityAnchor()
    if (anchor) {
      const style = resolveLeftOfAnchorStyle(anchor)
      lastPerplexityStyle = style
      return style
    }

    if (lastPerplexityStyle) {
      return lastPerplexityStyle
    }

    return resolveFallbackPlacement().style
  }

  getMenuAlign(): StrategyMenuAlign {
    return "right"
  }
}
