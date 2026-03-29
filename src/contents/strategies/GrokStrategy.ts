import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign, StrategyPlacement } from "./types"
import { INLINE_CONTAINER_STYLE, clampNumber, isVisibleElement, queryFirstVisibleElement } from "./dom-utils"

const GROK_HOST_TOKENS = ["grok.com"] as const
const GROK_X_HOST_TOKENS = ["x.com", "twitter.com"] as const

// "Imagine" button in the Grok header nav
const GROK_IMAGINE_SELECTORS = ["a[aria-label='Imagine']", "a[href='/imagine']"] as const

// Top-right actions on chat header where we want MindDock beside native actions.
const GROK_TOP_ACTION_ANCHOR_SELECTORS = [
  "button[aria-label='Mais']",
  "button[aria-label='More']",
  "button[aria-label='Menu']",
  "button[aria-label='Compartilhar']",
  "button[aria-label='Share']"
] as const

const GROK_FLOAT_BUTTON_SIZE_PX = 32
const GROK_DEFAULT_ACTION_GAP_PX = 8
const GROK_BUTTON_Z_INDEX = 80
const GROK_INLINE_HOST_STYLE_BASE = "display:inline-flex;align-items:center;vertical-align:middle;flex:0 0 auto"

function parseCssPixelValue(value: string): number | null {
  const numeric = Number.parseFloat(String(value ?? "").replace(",", "."))
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null
  }

  return numeric
}

function resolveGrokTopActionAnchor(): HTMLElement | null {
  return queryFirstVisibleElement(GROK_TOP_ACTION_ANCHOR_SELECTORS)
}

function resolveGrokActionGapPx(anchorElement: HTMLElement): number {
  const parentElement = anchorElement.parentElement
  if (!parentElement) {
    return GROK_DEFAULT_ACTION_GAP_PX
  }

  const style = window.getComputedStyle(parentElement)
  const gapCandidates = [style.columnGap, style.gap]

  for (const candidate of gapCandidates) {
    const parsedGap = parseCssPixelValue(candidate)
    if (parsedGap !== null) {
      return clampNumber(Math.round(parsedGap), 4, 24)
    }
  }

  return GROK_DEFAULT_ACTION_GAP_PX
}

export class GrokStrategy implements ContentStrategy {
  readonly id = "grok"

  private mountedInline = false

  matches(url: string): boolean {
    try {
      const parsed = new URL(url)
      const host = parsed.hostname.toLowerCase()
      const pathname = parsed.pathname.toLowerCase()

      if (GROK_HOST_TOKENS.some((token) => host === token || host.endsWith(`.${token}`))) {
        return true
      }

      if (
        GROK_X_HOST_TOKENS.some((token) => host === token || host.endsWith(`.${token}`)) &&
        /^\/i\/grok(?:\/|$)/u.test(pathname)
      ) {
        return true
      }

      return false
    } catch {
      return false
    }
  }

  getRootContainer(): HTMLElement | null {
    return document.body
  }

  mountHost(host: HTMLElement): boolean {
    const topActionAnchor = resolveGrokTopActionAnchor()
    if (!(topActionAnchor instanceof HTMLElement) || !topActionAnchor.parentElement) {
      this.mountedInline = false
      return false
    }

    const parentElement = topActionAnchor.parentElement
    const gapPx = resolveGrokActionGapPx(topActionAnchor)

    host.style.cssText = `${GROK_INLINE_HOST_STYLE_BASE};margin-right:${gapPx}px`

    const alreadyMounted = host.parentElement === parentElement && host.nextElementSibling === topActionAnchor
    if (!alreadyMounted) {
      parentElement.insertBefore(host, topActionAnchor)
    }

    this.mountedInline = true
    return true
  }

  getStyles(): CSSProperties {
    if (this.mountedInline) {
      return INLINE_CONTAINER_STYLE
    }

    const topActionAnchor = resolveGrokTopActionAnchor()
    if (topActionAnchor) {
      const anchorRect = topActionAnchor.getBoundingClientRect()
      if (anchorRect.width > 0 && anchorRect.height > 0) {
        const gapPx = resolveGrokActionGapPx(topActionAnchor)
        const top = clampNumber(
          Math.round(anchorRect.top + (anchorRect.height - GROK_FLOAT_BUTTON_SIZE_PX) / 2),
          8,
          Math.max(8, window.innerHeight - (GROK_FLOAT_BUTTON_SIZE_PX + 8))
        )
        const left = clampNumber(
          Math.round(anchorRect.left - GROK_FLOAT_BUTTON_SIZE_PX - gapPx),
          8,
          Math.max(8, window.innerWidth - (GROK_FLOAT_BUTTON_SIZE_PX + 8))
        )

        return {
          position: "fixed",
          top: `${top}px`,
          left: `${left}px`,
          zIndex: GROK_BUTTON_Z_INDEX,
          pointerEvents: "auto"
        }
      }
    }

    for (const selector of GROK_IMAGINE_SELECTORS) {
      const anchor = document.querySelector(selector)
      if (anchor) {
        const rect = anchor.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          return {
            position: "fixed",
            top: `${Math.round(rect.top + (rect.height - 32) / 2)}px`,
            left: `${Math.round(rect.left - 38)}px`,
            zIndex: GROK_BUTTON_Z_INDEX,
            pointerEvents: "auto"
          }
        }
      }
    }

    return this.resolvePlacement().style
  }

  getMenuAlign(): StrategyMenuAlign {
    return "right"
  }

  private resolvePlacement(): StrategyPlacement {
    const panelRect = this.resolveActiveConversationPanelRect()
    if (panelRect) {
      const top = clampNumber(Math.round(panelRect.top + 14), 8, Math.max(8, window.innerHeight - 52))
      const left = clampNumber(Math.round(panelRect.right - 198), 8, Math.max(8, window.innerWidth - 220))

      return {
        style: {
          position: "fixed",
          top: `${top}px`,
          left: `${left}px`,
          zIndex: GROK_BUTTON_Z_INDEX,
          pointerEvents: "auto"
        },
        menuAlign: "right"
      }
    }

    return {
      style: {
        position: "fixed",
        top: "15px",
        right: "15px",
        zIndex: GROK_BUTTON_Z_INDEX,
        pointerEvents: "auto"
      },
      menuAlign: "right"
    }
  }

  private resolveActiveConversationPanelRect(): DOMRect | null {
    const composer = queryFirstVisibleElement([
      "main textarea",
      "main [contenteditable='true']",
      "textarea",
      "[contenteditable='true']"
    ])

    if (composer) {
      let cursor: HTMLElement | null = composer
      let bestRect: DOMRect | null = null

      while (cursor && cursor !== document.body) {
        const computedStyle = window.getComputedStyle(cursor)
        if (
          cursor.hidden ||
          cursor.getAttribute("aria-hidden") === "true" ||
          computedStyle.display === "none" ||
          computedStyle.visibility === "hidden"
        ) {
          cursor = cursor.parentElement
          continue
        }

        const rect = cursor.getBoundingClientRect()
        if (rect.width < 360 || rect.height < 200) {
          cursor = cursor.parentElement
          continue
        }

        if (rect.width < window.innerWidth * 0.97) {
          if (!bestRect || rect.width < bestRect.width) {
            bestRect = rect
          }
        } else if (!bestRect) {
          bestRect = rect
        }

        cursor = cursor.parentElement
      }

      if (bestRect) {
        return bestRect
      }
    }

    const main = queryFirstVisibleElement(["main[role='main']", "main"])
    if (!main) {
      return null
    }

    const mainRect = main.getBoundingClientRect()
    const childRects = Array.from(main.children)
      .filter((child): child is HTMLElement => child instanceof HTMLElement && isVisibleElement(child))
      .map((child) => child.getBoundingClientRect())
      .filter((rect) => rect.width > 260 && rect.height > 200 && rect.top < window.innerHeight - 80)
      .sort((left, right) => left.left - right.left)

    if (childRects.length >= 2) {
      return childRects[0]
    }

    return mainRect
  }
}
