import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign } from "./types"
import { clampNumber, isVisibleElement, resolveFallbackPlacement } from "./dom-utils"

const KIMI_ALLOWED_HOSTS = ["www.kimi.com", "kimi.com"] as const
const KIMI_CHAT_PATH_PATTERN = /^\/chat(?:\/|$)/u
const KIMI_FLOAT_BUTTON_SIZE_PX = 32
const KIMI_GAP_TO_SHARE_PX = 10

const KIMI_SHARE_ANCHOR_SELECTORS = [
  "div.chat-header-actions button[aria-label*='share' i]",
  "div.chat-header-actions a[aria-label*='share' i]",
  "div.chat-header-actions button[title*='share' i]",
  "div.chat-header-actions a[title*='share' i]",
  "div.chat-header-actions button",
  "div.chat-header-actions a",
  "div.chat-header-actions",
  "[class*='chat-header-actions'] button[aria-label*='share' i]",
  "[class*='chat-header-actions'] a[aria-label*='share' i]",
  "[class*='chat-header-actions'] button[title*='share' i]",
  "[class*='chat-header-actions'] a[title*='share' i]",
  "[class*='chat-header-actions'] button",
  "[class*='chat-header-actions'] a",
  "[class*='chat-header-actions']",
  "header button[aria-label*='share' i]",
  "header a[aria-label*='share' i]",
  "header button[title*='share' i]",
  "header a[title*='share' i]",
  "header [class*='share']",
  "header button",
  "header a"
] as const

const KIMI_SHARE_LABEL_TOKENS = ["share", "partilhar", "compartilhar"] as const

const HIDDEN_STYLE: CSSProperties = {
  position: "fixed",
  top: "-9999px",
  left: "-9999px",
  pointerEvents: "none"
}

let kimiLastResolvedStyle: CSSProperties | null = null
let kimiLastResolvedAt = 0
const KIMI_STYLE_GRACE_PERIOD_MS = 5000

function isAllowedKimiHost(hostname: string): boolean {
  return KIMI_ALLOWED_HOSTS.includes(hostname as (typeof KIMI_ALLOWED_HOSTS)[number])
}

function isKimiChatRoute(url: string): boolean {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    const pathname = parsed.pathname || "/"
    return isAllowedKimiHost(host) && KIMI_CHAT_PATH_PATTERN.test(pathname)
  } catch {
    return false
  }
}

function resolveKimiShareAnchor(): HTMLElement | null {
  let bestAnchor: HTMLElement | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (const selector of KIMI_SHARE_ANCHOR_SELECTORS) {
    let candidates: HTMLElement[] = []
    try {
      candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
    } catch {
      continue
    }

    for (const candidate of candidates) {
      if (!isVisibleElement(candidate)) {
        continue
      }

      const rect = candidate.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        continue
      }

      if (rect.top < -8 || rect.top > 180) {
        continue
      }

      if (rect.left < window.innerWidth * 0.45) {
        continue
      }

      const label = `${candidate.getAttribute("aria-label") || ""} ${candidate.getAttribute("title") || ""} ${
        candidate.textContent || ""
      }`.toLowerCase()
      const hasShareHint = KIMI_SHARE_LABEL_TOKENS.some((token) => label.includes(token))
      const score = Math.abs(rect.top - 40) + Math.abs(rect.right - (window.innerWidth - 24)) + (hasShareHint ? 0 : 50)

      if (score < bestScore) {
        bestScore = score
        bestAnchor = candidate
      }
    }
  }

  return bestAnchor
}

export class KimiStrategy implements ContentStrategy {
  readonly id = "kimi"

  matches(url: string): boolean {
    return isKimiChatRoute(url)
  }

  getRootContainer(): HTMLElement | null {
    return document.body
  }

  // Keep floating mount to avoid conflicts with Kimi's reactive header tree.
  mountHost(_host: HTMLElement): boolean {
    return false
  }

  getStyles(): CSSProperties {
    if (!isKimiChatRoute(window.location.href)) {
      return HIDDEN_STYLE
    }

    const anchor = resolveKimiShareAnchor()
    if (!anchor) {
      if (kimiLastResolvedStyle && Date.now() - kimiLastResolvedAt <= KIMI_STYLE_GRACE_PERIOD_MS) {
        return kimiLastResolvedStyle
      }
      return resolveFallbackPlacement().style
    }

    const rect = anchor.getBoundingClientRect()
    const top = clampNumber(
      Math.round(rect.top + (rect.height - KIMI_FLOAT_BUTTON_SIZE_PX) / 2),
      8,
      Math.max(8, window.innerHeight - KIMI_FLOAT_BUTTON_SIZE_PX - 8)
    )

    const minLeft = 8
    const maxLeft = Math.max(minLeft, window.innerWidth - KIMI_FLOAT_BUTTON_SIZE_PX - 8)
    const preferredLeft = Math.round(rect.left - KIMI_FLOAT_BUTTON_SIZE_PX - KIMI_GAP_TO_SHARE_PX)
    const fallbackRight = Math.round(rect.right + KIMI_GAP_TO_SHARE_PX)
    const left =
      preferredLeft >= minLeft
        ? clampNumber(preferredLeft, minLeft, maxLeft)
        : clampNumber(fallbackRight, minLeft, maxLeft)

    const resolvedStyle: CSSProperties = {
      position: "fixed",
      top: `${top}px`,
      left: `${left}px`,
      zIndex: 2147483646,
      pointerEvents: "auto"
    }

    kimiLastResolvedStyle = resolvedStyle
    kimiLastResolvedAt = Date.now()

    return resolvedStyle
  }

  getMenuAlign(): StrategyMenuAlign {
    return "right"
  }
}
