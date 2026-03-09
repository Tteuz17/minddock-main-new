import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign } from "./types"
import { resolveFallbackPlacement } from "./dom-utils"

const KIMI_HOST_TOKENS = ["kimi.com", "moonshot.cn"] as const

// "tool-switch" button in Kimi's input toolbar (Vue component)
const KIMI_ANCHOR_SELECTORS = [
  "div.tool-switch",
  "[class*='tool-switch']",
] as const

export class KimiStrategy implements ContentStrategy {
  readonly id = "kimi"

  matches(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase()
      return KIMI_HOST_TOKENS.some((token) => host === token || host.endsWith(`.${token}`))
    } catch {
      return false
    }
  }

  getRootContainer(): HTMLElement | null {
    return document.body
  }

  // Do NOT inject into Kimi's Vue tree — use fixed positioning instead.
  mountHost(_host: HTMLElement): boolean {
    return false
  }

  getStyles(): CSSProperties {
    for (const selector of KIMI_ANCHOR_SELECTORS) {
      const anchor = document.querySelector(selector)
      if (anchor) {
        const rect = anchor.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          return {
            position: "fixed",
            top: `${Math.round(rect.top + (rect.height - 32) / 2)}px`,
            left: `${Math.round(rect.right + 6)}px`,
            zIndex: 2147483646,
            pointerEvents: "auto"
          }
        }
      }
    }
    return resolveFallbackPlacement().style
  }

  getMenuAlign(): StrategyMenuAlign {
    return "left"
  }
}
