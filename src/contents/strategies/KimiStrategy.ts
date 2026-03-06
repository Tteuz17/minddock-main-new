import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign, StrategyPlacement } from "./types"

const KIMI_HOST_TOKENS = ["kimi.com", "moonshot.cn"] as const

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

  getStyles(): CSSProperties {
    return this.resolvePlacement().style
  }

  getMenuAlign(): StrategyMenuAlign {
    return this.resolvePlacement().menuAlign
  }

  private resolvePlacement(): StrategyPlacement {
    return {
      style: {
        position: "fixed",
        top: "15px",
        right: "80px",
        zIndex: 2147483646,
        pointerEvents: "auto"
      },
      menuAlign: "right"
    }
  }
}
