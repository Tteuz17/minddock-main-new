import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign } from "./types"

export class DefaultStrategy implements ContentStrategy {
  readonly id = "default"

  matches(_url: string): boolean {
    return true
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
}
