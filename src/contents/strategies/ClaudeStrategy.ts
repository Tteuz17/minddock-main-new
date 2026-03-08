import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign } from "./types"
import { INLINE_CONTAINER_STYLE, resolveFallbackPlacement, tryMountInToolbar } from "./dom-utils"

const CLAUDE_TOOLBAR_SELECTORS = [
  "div[data-testid='chat-footer']",
  "fieldset footer",
  "div[class*='composer'] div.flex.items-center",
  "div[class*='input-footer']",
  "div[class*='toolbar']",
  "div[class*='action-bar']",
] as const

export class ClaudeStrategy implements ContentStrategy {
  readonly id = "claude"

  private mountedInline = false

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

  mountHost(host: HTMLElement): boolean {
    this.mountedInline = tryMountInToolbar(host, CLAUDE_TOOLBAR_SELECTORS)
    return this.mountedInline
  }

  getStyles(): CSSProperties {
    return this.mountedInline ? INLINE_CONTAINER_STYLE : resolveFallbackPlacement().style
  }

  getMenuAlign(): StrategyMenuAlign {
    return "right"
  }
}
