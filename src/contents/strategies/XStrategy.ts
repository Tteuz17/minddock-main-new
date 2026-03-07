import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign, StrategyPlacement } from "./types"
import { queryFirstVisibleElement, resolveRightOfAnchorPlacement } from "./dom-utils"

const X_HOST_TOKENS = ["x.com", "twitter.com"] as const

export class XStrategy implements ContentStrategy {
  readonly id = "x"

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

  getStyles(): CSSProperties {
    return this.resolvePlacement().style
  }

  getMenuAlign(): StrategyMenuAlign {
    return this.resolvePlacement().menuAlign
  }

  private resolvePlacement(): StrategyPlacement {
    const backButton = queryFirstVisibleElement(["button[data-testid='app-bar-back']"])
    if (backButton) {
      const anchor =
        backButton.parentElement instanceof HTMLElement
          ? backButton.parentElement
          : backButton
      return resolveRightOfAnchorPlacement(anchor.getBoundingClientRect(), 8)
    }

    return {
      style: {
        top: "15px",
        right: "15px"
      },
      menuAlign: "right"
    }
  }
}
