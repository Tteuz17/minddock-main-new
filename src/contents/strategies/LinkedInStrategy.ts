import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign } from "./types"

export class LinkedInStrategy implements ContentStrategy {
  readonly id = "linkedin"

  matches(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase()
      return host === "linkedin.com" || host.endsWith(".linkedin.com")
    } catch {
      return /linkedin\.com/iu.test(url)
    }
  }

  getRootContainer(): HTMLElement | null {
    return document.body
  }

  getStyles(): CSSProperties {
    return {
      top: "24px",
      right: "24px"
    }
  }

  getMenuAlign(): StrategyMenuAlign {
    return "right"
  }

  isInlineOnly(): boolean {
    return true
  }
}
