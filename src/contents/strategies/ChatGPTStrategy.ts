import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign } from "./types"
import { resolveFallbackPlacement } from "./dom-utils"

const CHATGPT_MODEL_SWITCHER_SELECTORS = [
  "button[data-testid='model-switcher-dropdown-button']",
  "button[aria-label*='Model selector']",
  "button[data-testid*='model-switcher']",
] as const

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

  // Do NOT inject into ChatGPT's React tree — use fixed positioning instead.
  mountHost(_host: HTMLElement): boolean {
    return false
  }

  getStyles(): CSSProperties {
    // Dynamically track the model-switcher position on every placement update.
    for (const selector of CHATGPT_MODEL_SWITCHER_SELECTORS) {
      const anchor = document.querySelector(selector)
      if (anchor) {
        const rect = anchor.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          return {
            position: "fixed",
            top: `${Math.round(rect.top + (rect.height - 32) / 2)}px`,
            left: `${Math.round(rect.right + 6)}px`,
            zIndex: 2147483646,
            pointerEvents: "auto"
          }
        }
      }
    }
    return resolveFallbackPlacement().style
  }

  getMenuAlign(): StrategyMenuAlign {
    return "left"
  }
}
