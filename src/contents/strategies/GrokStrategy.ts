import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign, StrategyPlacement } from "./types"
import { clampNumber, isVisibleElement, queryFirstVisibleElement } from "./dom-utils"

const GROK_HOST_TOKENS = ["grok.com"] as const
const GROK_X_HOST_TOKENS = ["x.com", "twitter.com"] as const

// "Imagine" button in the Grok header nav
const GROK_IMAGINE_SELECTORS = [
  "a[aria-label='Imagine']",
  "a[href='/imagine']",
] as const

export class GrokStrategy implements ContentStrategy {
  readonly id = "grok"

  matches(url: string): boolean {
    try {
      const parsed = new URL(url)
      const host = parsed.hostname.toLowerCase()
      const pathname = parsed.pathname.toLowerCase()

      if (GROK_HOST_TOKENS.some((token) => host === token || host.endsWith(`.${token}`))) {
        return true
      }

      if (
        GROK_X_HOST_TOKENS.some((token) => host === token || host.endsWith(`.${token}`)) &&
        /^\/i\/grok(?:\/|$)/u.test(pathname)
      ) {
        return true
      }

      return false
    } catch {
      return false
    }
  }

  getRootContainer(): HTMLElement | null {
    return document.body
  }

  // Do NOT inject into Grok's React tree — use fixed positioning instead.
  mountHost(_host: HTMLElement): boolean {
    return false
  }

  getStyles(): CSSProperties {
    for (const selector of GROK_IMAGINE_SELECTORS) {
      const anchor = document.querySelector(selector)
      if (anchor) {
        const rect = anchor.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          return {
            position: "fixed",
            top: `${Math.round(rect.top + (rect.height - 32) / 2)}px`,
            left: `${Math.round(rect.left - 38)}px`,
            zIndex: 2147483646,
            pointerEvents: "auto"
          }
        }
      }
    }
    return this.resolvePlacement().style
  }

  getMenuAlign(): StrategyMenuAlign {
    return "right"
  }

  private resolvePlacement(): StrategyPlacement {
    const panelRect = this.resolveActiveConversationPanelRect()
    if (panelRect) {
      const top = clampNumber(Math.round(panelRect.top + 14), 8, Math.max(8, window.innerHeight - 52))
      const left = clampNumber(
        Math.round(panelRect.right - 198),
        8,
        Math.max(8, window.innerWidth - 220)
      )

      return {
        style: {
          position: "fixed",
          top: `${top}px`,
          left: `${left}px`,
          zIndex: 2147483646,
          pointerEvents: "auto"
        },
        menuAlign: "right"
      }
    }

    return {
      style: {
        position: "fixed",
        top: "15px",
        right: "15px",
        zIndex: 2147483646,
        pointerEvents: "auto"
      },
      menuAlign: "right"
    }
  }

  private resolveActiveConversationPanelRect(): DOMRect | null {
    const composer = queryFirstVisibleElement([
      "main textarea",
      "main [contenteditable='true']",
      "textarea",
      "[contenteditable='true']"
    ])

    if (composer) {
      let cursor: HTMLElement | null = composer
      let bestRect: DOMRect | null = null

      while (cursor && cursor !== document.body) {
        const computedStyle = window.getComputedStyle(cursor)
        if (
          cursor.hidden ||
          cursor.getAttribute("aria-hidden") === "true" ||
          computedStyle.display === "none" ||
          computedStyle.visibility === "hidden"
        ) {
          cursor = cursor.parentElement
          continue
        }

        const rect = cursor.getBoundingClientRect()
        if (rect.width < 360 || rect.height < 200) {
          cursor = cursor.parentElement
          continue
        }

        if (rect.width < window.innerWidth * 0.97) {
          if (!bestRect || rect.width < bestRect.width) {
            bestRect = rect
          }
        } else if (!bestRect) {
          bestRect = rect
        }

        cursor = cursor.parentElement
      }

      if (bestRect) {
        return bestRect
      }
    }

    const main = queryFirstVisibleElement(["main[role='main']", "main"])
    if (!main) {
      return null
    }

    const mainRect = main.getBoundingClientRect()
    const childRects = Array.from(main.children)
      .filter((child): child is HTMLElement => child instanceof HTMLElement && isVisibleElement(child))
      .map((child) => child.getBoundingClientRect())
      .filter((rect) => rect.width > 260 && rect.height > 200 && rect.top < window.innerHeight - 80)
      .sort((left, right) => left.left - right.left)

    if (childRects.length >= 2) {
      return childRects[0]
    }

    return mainRect
  }
}
