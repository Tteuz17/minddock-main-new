import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign } from "./types"
import {
  INLINE_CONTAINER_STYLE,
  clampNumber,
  queryFirstVisibleElement,
  resolveFallbackPlacement,
  tryMountAfterElement,
  tryMountInToolbar
} from "./dom-utils"

const CLAUDE_TOP_ACTION_ANCHOR_SELECTORS = [
  "header button[aria-label*='copy' i]",
  "header button[aria-label*='share' i]",
  "header button[aria-label*='compart' i]",
  "header button[title*='copy' i]",
  "header button[title*='share' i]",
  "header button[title*='compart' i]",
  "header [data-testid*='copy' i] button",
  "header [data-testid*='share' i] button",
  "header button[data-testid*='copy' i]",
  "header button[data-testid*='share' i]",
  "header button[aria-haspopup='menu']",
  "header button[aria-expanded]"
] as const

const CLAUDE_TOP_ACTION_CONTAINER_SELECTORS = [
  "header .right-3",
  "header [class*='right']",
  "header [class*='actions']",
  "header [class*='controls']",
  "header [class*='buttons']",
  "header nav",
  "header"
] as const

const FLOATING_BUTTON_SIZE_PX = 32
const FLOATING_BUTTON_GAP_PX = 6

function resolveClaudeHeaderActionAnchor(): HTMLElement | null {
  const preferredAnchor = queryFirstVisibleElement(CLAUDE_TOP_ACTION_ANCHOR_SELECTORS)
  if (preferredAnchor) {
    return preferredAnchor
  }

  const header = document.querySelector("header")
  if (header instanceof HTMLElement) {
    const controls = Array.from(
      header.querySelectorAll<HTMLElement>("button, [role='button'], a[role='button'], a")
    ).filter((control) => {
      const rect = control.getBoundingClientRect()
      return (
        rect.width >= 16 &&
        rect.height >= 16 &&
        rect.bottom > 0 &&
        rect.top < Math.min(window.innerHeight, 220) &&
        rect.right > window.innerWidth * 0.55
      )
    })

    if (controls.length > 0) {
      let rightMostControl = controls[0]
      let rightMost = rightMostControl.getBoundingClientRect().right
      for (const control of controls) {
        const rectRight = control.getBoundingClientRect().right
        if (rectRight > rightMost) {
          rightMost = rectRight
          rightMostControl = control
        }
      }

      const rowTop = rightMostControl.getBoundingClientRect().top
      let rowLeftMostControl = rightMostControl
      let rowLeftMost = rightMostControl.getBoundingClientRect().left
      for (const control of controls) {
        const rect = control.getBoundingClientRect()
        if (Math.abs(rect.top - rowTop) <= 14 && rect.left < rowLeftMost) {
          rowLeftMost = rect.left
          rowLeftMostControl = control
        }
      }

      return rowLeftMostControl
    }
  }

  return queryFirstVisibleElement(CLAUDE_TOP_ACTION_CONTAINER_SELECTORS)
}

function resolveClaudeFloatingPlacement(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect()
  const minTop = 8
  const maxTop = Math.max(minTop, window.innerHeight - FLOATING_BUTTON_SIZE_PX - 8)
  const top = clampNumber(
    Math.round(rect.top + (rect.height - FLOATING_BUTTON_SIZE_PX) / 2),
    minTop,
    maxTop
  )

  const minLeft = 8
  const maxLeft = Math.max(minLeft, window.innerWidth - FLOATING_BUTTON_SIZE_PX - 8)
  const preferredLeft = Math.round(rect.left - FLOATING_BUTTON_SIZE_PX - FLOATING_BUTTON_GAP_PX)
  const left =
    preferredLeft >= minLeft
      ? clampNumber(preferredLeft, minLeft, maxLeft)
      : clampNumber(Math.round(rect.right + FLOATING_BUTTON_GAP_PX), minLeft, maxLeft)

  return {
    position: "fixed",
    top: `${top}px`,
    left: `${left}px`,
    zIndex: 2147483646,
    pointerEvents: "auto"
  }
}

export class ClaudeStrategy implements ContentStrategy {
  readonly id = "claude"

  private mountedInline = false

  matches(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase()
      return host.includes("claude.ai")
    } catch {
      return false
    }
  }

  getRootContainer(): HTMLElement | null {
    return document.body
  }

  mountHost(host: HTMLElement): boolean {
    this.mountedInline =
      tryMountAfterElement(host, CLAUDE_TOP_ACTION_ANCHOR_SELECTORS, CLAUDE_TOP_ACTION_CONTAINER_SELECTORS) ||
      tryMountInToolbar(host, CLAUDE_TOP_ACTION_CONTAINER_SELECTORS)
    return this.mountedInline
  }

  getStyles(): CSSProperties {
    if (this.mountedInline) {
      return INLINE_CONTAINER_STYLE
    }

    const anchor = resolveClaudeHeaderActionAnchor()
    if (anchor) {
      const rect = anchor.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        return resolveClaudeFloatingPlacement(anchor)
      }
    }

    return resolveFallbackPlacement().style
  }

  getMenuAlign(): StrategyMenuAlign {
    return "right"
  }
}
