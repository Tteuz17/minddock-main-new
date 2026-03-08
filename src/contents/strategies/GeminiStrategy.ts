import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign } from "./types"
import { INLINE_CONTAINER_STYLE, resolveFallbackPlacement, tryMountAfterElement } from "./dom-utils"

// Try to find the Ferramentas/Tools button in Gemini's input toolbar
const GEMINI_TOOLS_ANCHOR_SELECTORS = [
  "button.toolbox-drawer-button-with-label",
  "button[class*='toolbox-drawer-button']",
  "ms-tool-access-button",
  "ms-chat-input button[aria-label*='Ferramentas']",
  "ms-chat-input button[aria-label*='Tools']",
] as const

// Fallback: append to the left-side leading-actions container (where + and Ferramentas live)
const GEMINI_FALLBACK_SELECTORS = [
  "ms-chat-input [class*='leading-actions']",
  "ms-chat-input [class*='footer-leading']",
  "ms-chat-input [class*='left-actions']",
  "[class*='leading-actions']",
  "[class*='footer-leading']",
  "div.trailing-actions",
  "div[class*='trailing-actions']",
  "div.input-footer-buttons",
  "ms-chat-input div[class*='actions']",
] as const

export class GeminiStrategy implements ContentStrategy {
  readonly id = "gemini"

  private mountedInline = false

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

  mountHost(host: HTMLElement): boolean {
    this.mountedInline = tryMountAfterElement(host, GEMINI_TOOLS_ANCHOR_SELECTORS, GEMINI_FALLBACK_SELECTORS)
    return this.mountedInline
  }

  getStyles(): CSSProperties {
    return this.mountedInline ? INLINE_CONTAINER_STYLE : resolveFallbackPlacement().style
  }

  getMenuAlign(): StrategyMenuAlign {
    return "right"
  }
}
