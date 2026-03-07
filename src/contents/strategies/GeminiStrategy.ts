import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign, StrategyPlacement } from "./types"
import { clampNumber, queryFirstVisibleElement, resolveFallbackPlacement } from "./dom-utils"

export class GeminiStrategy implements ContentStrategy {
  readonly id = "gemini"

  matches(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase()
      return host.includes("gemini.google.com")
    } catch {
      return false
    }
  }

  getRootContainer(): HTMLElement | null {
    return document.body
  }

  getStyles(): CSSProperties {
    return this.resolvePlacement().style
  }

  getMenuAlign(): StrategyMenuAlign {
    return this.resolvePlacement().menuAlign
  }

  private resolvePlacement(): StrategyPlacement {
    const anchor = queryFirstVisibleElement([
      "div.right-section > div.buttons-container",
      "div.buttons-container"
    ])
    if (!anchor) {
      return resolveFallbackPlacement()
    }

    const rect = anchor.getBoundingClientRect()
    const top = clampNumber(Math.round(rect.top), 8, Math.max(8, window.innerHeight - 52))
    const left = clampNumber(Math.round(rect.left), 8, Math.max(8, window.innerWidth - 220))

    return {
      style: {
        top: `${top}px`,
        left: `${left}px`
      },
      menuAlign: "left"
    }
  }
}
