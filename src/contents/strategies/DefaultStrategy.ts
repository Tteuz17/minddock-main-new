import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign } from "./types"
import { INLINE_CONTAINER_STYLE, resolveFallbackPlacement, tryMountInToolbar } from "./dom-utils"

// Used by Genspark, OpenEvidence and any other platform
const DEFAULT_TOOLBAR_SELECTORS = [
  "div[class*='toolbar']",
  "div[class*='action-bar']",
  "div[class*='input-actions']",
  "div[class*='composer-footer']",
  "div[class*='chat-footer']",
  "div[class*='send']",
  "form div.flex.items-center",
] as const

export class DefaultStrategy implements ContentStrategy {
  readonly id = "default"

  private mountedInline = false

  matches(_url: string): boolean {
    return true
  }

  getRootContainer(): HTMLElement | null {
    return document.body
  }

  mountHost(host: HTMLElement): boolean {
    this.mountedInline = tryMountInToolbar(host, DEFAULT_TOOLBAR_SELECTORS)
    return this.mountedInline
  }

  getStyles(): CSSProperties {
    return this.mountedInline ? INLINE_CONTAINER_STYLE : resolveFallbackPlacement().style
  }

  getMenuAlign(): StrategyMenuAlign {
    return "right"
  }
}
