import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign } from "./types"
import { clampNumber, queryFirstVisibleElement, resolveFallbackPlacement } from "./dom-utils"

const CLAUDE_BLOCKED_ROUTES = /^\/(new|projects|settings|login|upgrade|billing|team|referral|oauth)(?:\/|$)/i

const CLAUDE_TITLE_SELECTORS = [
  // Conversation title in header
  "header button[id^='radix-'][class*='inline-flex']",
  "header button[id^='radix-']",
  "header h1",
  "header [class*='font-semibold'][class*='truncate']",
  "header [class*='conversation-title']",
  "header [class*='chat-title']"
] as const

const FLOATING_BUTTON_SIZE_PX = 32
const FLOATING_BUTTON_GAP_PX = 30

function isClaudeChatRoute(): boolean {
  const pathname = window.location.pathname
  if (CLAUDE_BLOCKED_ROUTES.test(pathname)) return false
  return /^\/(chat|c)\/[a-zA-Z0-9-]+/i.test(pathname) || pathname === "/"
}

function resolveClaudeTitleAnchor(): HTMLElement | null {
  if (!isClaudeChatRoute()) return null

  for (const selector of CLAUDE_TITLE_SELECTORS) {
    let candidates: Element[] = []
    try {
      candidates = Array.from(document.querySelectorAll(selector))
    } catch {
      continue
    }

    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement)) continue
      if (!candidate.isConnected) continue
      const style = window.getComputedStyle(candidate)
      if (style.display === "none" || style.visibility === "hidden") continue
      const rect = candidate.getBoundingClientRect()
      if (rect.width < 20 || rect.height < 16) continue
      if (rect.top < 0 || rect.top > 100) continue
      return candidate
    }
  }

  return null
}

export class ClaudeStrategy implements ContentStrategy {
  readonly id = "claude"

  matches(url: string): boolean {
    try {
      return new URL(url).hostname.toLowerCase().includes("claude.ai")
    } catch {
      return false
    }
  }

  getRootContainer(): HTMLElement | null {
    return document.body
  }

  // Never mount inline to avoid React conflicts
  mountHost(_host: HTMLElement): boolean {
    return false
  }

  getStyles(): CSSProperties {
    const hidden: CSSProperties = {
      position: "fixed",
      top: "-9999px",
      left: "-9999px",
      pointerEvents: "none"
    }

    if (!isClaudeChatRoute()) return hidden

    const anchor = resolveClaudeTitleAnchor()
    if (!anchor) return hidden

    const rect = anchor.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return hidden

    const top = clampNumber(
      Math.round(rect.top + (rect.height - FLOATING_BUTTON_SIZE_PX) / 2),
      8,
      Math.max(8, window.innerHeight - FLOATING_BUTTON_SIZE_PX - 8)
    )

    const left = clampNumber(
      Math.round(rect.right + FLOATING_BUTTON_GAP_PX),
      8,
      Math.max(8, window.innerWidth - FLOATING_BUTTON_SIZE_PX - 8)
    )

    return {
      position: "fixed",
      top: `${top}px`,
      left: `${left}px`,
      zIndex: 2147483646,
      pointerEvents: "auto"
    }
  }

  getMenuAlign(): StrategyMenuAlign {
    return "right"
  }
}
