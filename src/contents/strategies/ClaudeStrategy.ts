import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign, StrategyPlacement } from "./types"
import {
  queryFirstVisibleElement,
  resolveFallbackPlacement,
  resolveLeftOfAnchorPlacement
} from "./dom-utils"

export class ClaudeStrategy implements ContentStrategy {
  readonly id = "claude"

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

  getStyles(): CSSProperties {
    return this.resolvePlacement().style
  }

  getMenuAlign(): StrategyMenuAlign {
    return this.resolvePlacement().menuAlign
  }

  private resolvePlacement(): StrategyPlacement {
    const anchor = queryFirstVisibleElement(["header .right-3", "header [class*='right']"])
    if (anchor) {
      return resolveLeftOfAnchorPlacement(anchor.getBoundingClientRect(), 8)
    }

    return resolveFallbackPlacement()
  }
}
