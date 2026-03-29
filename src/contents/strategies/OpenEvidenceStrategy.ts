import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign } from "./types"
import { clampNumber, isVisibleElement } from "./dom-utils"

const OPENEVIDENCE_HOST_TOKENS = ["openevidence.com"] as const
const OPENEVIDENCE_ASK_PATH_PATTERN = /^\/ask(?:\/|$)/u
const OPENEVIDENCE_BUTTON_SIZE_PX = 32
const OPENEVIDENCE_GAP_TO_TITLE_PX = 12
const OPENEVIDENCE_FALLBACK_STYLE: CSSProperties = {
  position: "fixed",
  top: "94px",
  left: "438px",
  zIndex: 2147483646,
  pointerEvents: "auto"
}

const OPENEVIDENCE_HEADER_ROW_SELECTORS = [
  "header div.MuiContainer-root",
  "div.MuiContainer-root",
  "header [class*='MuiContainer-root']",
  "header"
] as const

const OPENEVIDENCE_TITLE_SELECTORS = ["a", "span", "div", "h1", "h2", "p"] as const

const HIDDEN_STYLE: CSSProperties = {
  position: "fixed",
  top: "-9999px",
  left: "-9999px",
  pointerEvents: "none"
}

let lastResolvedStyle: CSSProperties | null = null

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/gu, " ").trim().toLowerCase()
}

function isOpenEvidenceHost(hostname: string): boolean {
  return OPENEVIDENCE_HOST_TOKENS.some((token) => hostname === token || hostname.endsWith(`.${token}`))
}

function isOpenEvidenceAskRoute(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    return isOpenEvidenceHost(parsed.hostname.toLowerCase()) && OPENEVIDENCE_ASK_PATH_PATTERN.test(parsed.pathname || "/")
  } catch {
    return false
  }
}

function resolveOpenEvidenceHeaderRow(): HTMLElement | null {
  let bestRow: HTMLElement | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (const selector of OPENEVIDENCE_HEADER_ROW_SELECTORS) {
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
      if (rect.width < 620 || rect.height < 28 || rect.height > 110) {
        continue
      }

      if (rect.top < -8 || rect.top > 220) {
        continue
      }

      const label = normalizeText(candidate.innerText || candidate.textContent || "")
      const hasActionHints =
        label.includes("compartilhar") ||
        label.includes("share") ||
        label.includes("nova conversa") ||
        label.includes("new chat")

      const score = Math.abs(rect.top - 95) + Math.abs(rect.left - 16) + (hasActionHints ? 0 : 120)
      if (score < bestScore) {
        bestScore = score
        bestRow = candidate
      }
    }
  }

  return bestRow
}

function resolveOpenEvidenceTitleRect(headerRow: HTMLElement): DOMRect | null {
  const rowRect = headerRow.getBoundingClientRect()
  let bestRect: DOMRect | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (const selector of OPENEVIDENCE_TITLE_SELECTORS) {
    let candidates: HTMLElement[] = []
    try {
      candidates = Array.from(headerRow.querySelectorAll<HTMLElement>(selector))
    } catch {
      continue
    }

    for (const candidate of candidates) {
      if (!isVisibleElement(candidate)) {
        continue
      }

      const rect = candidate.getBoundingClientRect()
      if (rect.width < 70 || rect.width > 460 || rect.height < 14 || rect.height > 64) {
        continue
      }

      if (rect.left > rowRect.left + rowRect.width * 0.55) {
        continue
      }

      if (rect.top < rowRect.top - 12 || rect.bottom > rowRect.bottom + 12) {
        continue
      }

      const label = normalizeText(
        [candidate.getAttribute("aria-label") || "", candidate.getAttribute("title") || "", candidate.textContent || ""].join(
          " "
        )
      )

      if (!label.includes("openevidence") && !label.includes("open evidence")) {
        continue
      }

      const score = Math.abs(rect.left - (rowRect.left + 20)) + Math.abs(rect.top - (rowRect.top + 8))
      if (score < bestScore) {
        bestScore = score
        bestRect = rect
      }
    }
  }

  return bestRect
}

function resolveOpenEvidenceGlobalTitleRect(): DOMRect | null {
  let bestRect: DOMRect | null = null
  let bestScore = Number.POSITIVE_INFINITY
  let candidates: HTMLElement[] = []
  try {
    candidates = Array.from(document.querySelectorAll<HTMLElement>("a, span, div, h1, h2, p"))
  } catch {
    return null
  }

  for (const candidate of candidates) {
    if (!isVisibleElement(candidate)) {
      continue
    }

    const rect = candidate.getBoundingClientRect()
    if (rect.width < 70 || rect.width > 460 || rect.height < 14 || rect.height > 64) {
      continue
    }

    if (rect.top < -8 || rect.top > 240) {
      continue
    }

    if (rect.left > window.innerWidth * 0.7) {
      continue
    }

    const label = normalizeText(
      [candidate.getAttribute("aria-label") || "", candidate.getAttribute("title") || "", candidate.textContent || ""].join(
        " "
      )
    )

    if (!label.includes("openevidence") && !label.includes("open evidence")) {
      continue
    }

    const score = Math.abs(rect.left - 250) + Math.abs(rect.top - 90)
    if (score < bestScore) {
      bestScore = score
      bestRect = rect
    }
  }

  return bestRect
}

export class OpenEvidenceStrategy implements ContentStrategy {
  readonly id = "openevidence"

  matches(url: string): boolean {
    try {
      const parsed = new URL(url)
      return isOpenEvidenceHost(parsed.hostname.toLowerCase())
    } catch {
      return false
    }
  }

  getRootContainer(): HTMLElement | null {
    return document.body
  }

  mountHost(_host: HTMLElement): boolean {
    return false
  }

  getStyles(): CSSProperties {
    if (!isOpenEvidenceAskRoute(window.location.href)) {
      lastResolvedStyle = null
      return HIDDEN_STYLE
    }

    const globalTitleRect = resolveOpenEvidenceGlobalTitleRect()
    if (globalTitleRect) {
      const top = clampNumber(
        Math.round(globalTitleRect.top + (globalTitleRect.height - OPENEVIDENCE_BUTTON_SIZE_PX) / 2),
        8,
        Math.max(8, window.innerHeight - OPENEVIDENCE_BUTTON_SIZE_PX - 8)
      )

      const left = clampNumber(
        Math.round(globalTitleRect.right + OPENEVIDENCE_GAP_TO_TITLE_PX),
        8,
        Math.max(8, window.innerWidth - OPENEVIDENCE_BUTTON_SIZE_PX - 8)
      )

      const resolvedFromGlobal: CSSProperties = {
        position: "fixed",
        top: `${top}px`,
        left: `${left}px`,
        zIndex: 2147483646,
        pointerEvents: "auto"
      }
      lastResolvedStyle = resolvedFromGlobal
      return resolvedFromGlobal
    }

    const headerRow = resolveOpenEvidenceHeaderRow()
    if (!headerRow) {
      return lastResolvedStyle ?? OPENEVIDENCE_FALLBACK_STYLE
    }

    const rowRect = headerRow.getBoundingClientRect()
    const titleRect = resolveOpenEvidenceTitleRect(headerRow)

    const anchorTop = titleRect?.top ?? rowRect.top
    const anchorHeight = titleRect?.height ?? rowRect.height
    const anchorRight = titleRect?.right ?? Math.round(rowRect.left + 190)

    const top = clampNumber(
      Math.round(anchorTop + (anchorHeight - OPENEVIDENCE_BUTTON_SIZE_PX) / 2),
      8,
      Math.max(8, window.innerHeight - OPENEVIDENCE_BUTTON_SIZE_PX - 8)
    )

    const left = clampNumber(
      Math.round(anchorRight + OPENEVIDENCE_GAP_TO_TITLE_PX),
      8,
      Math.max(8, window.innerWidth - OPENEVIDENCE_BUTTON_SIZE_PX - 8)
    )

    const resolvedStyle: CSSProperties = {
      position: "fixed",
      top: `${top}px`,
      left: `${left}px`,
      zIndex: 2147483646,
      pointerEvents: "auto"
    }

    lastResolvedStyle = resolvedStyle
    return resolvedStyle
  }

  getMenuAlign(): StrategyMenuAlign {
    return "left"
  }
}
