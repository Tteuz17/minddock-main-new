import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign, StrategyPlacement } from "./types"
import {
  queryFirstVisibleElement,
  resolveFallbackPlacement,
  resolveLeftOfAnchorPlacement
} from "./dom-utils"

export class ChatGPTStrategy implements ContentStrategy {
  readonly id = "chatgpt"

  matches(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase()
      return host.includes("chat.openai.com") || host.includes("chatgpt.com")
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
    const anchor = queryFirstVisibleElement(["#conversation-header-actions"])
    if (anchor) {
      return resolveLeftOfAnchorPlacement(anchor.getBoundingClientRect(), 8)
    }

    return resolveFallbackPlacement()
  }
}
