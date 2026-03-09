import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign } from "./types"

export class GoogleDocsStrategy implements ContentStrategy {
  readonly id = "google-docs"

  matches(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase()
      return host === "docs.google.com" || host.endsWith(".docs.google.com")
    } catch {
      return false
    }
  }

  getRootContainer(): HTMLElement | null {
    return document.body
  }

  // Keep host in document.body — Google Docs replaces toolbar children on every action.
  mountHost(_host: HTMLElement): boolean {
    return false
  }

  getStyles(): CSSProperties {
    return {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      zIndex: 2147483646,
      pointerEvents: "auto"
    }
  }

  getMenuAlign(): StrategyMenuAlign {
    return "right"
  }
}
