import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign } from "./types"
import { resolveFallbackPlacement } from "./dom-utils"

const PERPLEXITY_HOST_TOKENS = ["perplexity.ai"] as const

// "Thread actions" (...) button in the top-right header
const PERPLEXITY_ANCHOR_SELECTORS = [
  "button[aria-label='Thread actions']",
  "button[aria-label*='Thread']",
] as const

export class PerplexityStrategy implements ContentStrategy {
  readonly id = "perplexity"

  matches(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase()
      return PERPLEXITY_HOST_TOKENS.some((token) => host === token || host.endsWith(`.${token}`))
    } catch {
      return false
    }
  }

  getRootContainer(): HTMLElement | null {
    return document.body
  }

  // Do NOT inject into Perplexity's React tree — use fixed positioning instead.
  mountHost(_host: HTMLElement): boolean {
    return false
  }

  getStyles(): CSSProperties {
    for (const selector of PERPLEXITY_ANCHOR_SELECTORS) {
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
    return resolveFallbackPlacement().style
  }

  getMenuAlign(): StrategyMenuAlign {
    return "right"
  }
}
