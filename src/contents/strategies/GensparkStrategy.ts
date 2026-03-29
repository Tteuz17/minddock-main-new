import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign } from "./types"
import { isVisibleElement } from "./dom-utils"

const GENSPARK_ALLOWED_HOSTS = ["www.genspark.ai", "genspark.ai"] as const

const GENSPARK_FALLBACK_STYLE: CSSProperties = {
  top: "24px",
  right: "24px"
}

const GENSPARK_FLOAT_BUTTON_SIZE_PX = 32
const GENSPARK_GAP_TO_SHARE_PX = 10

const GENSPARK_TOP_ROW_SELECTORS = ["div.top", "header div.top", "main div.top"] as const

const GENSPARK_SHARE_DIRECT_SELECTORS = [
  "button[aria-label*='partilhar' i]",
  "button[aria-label*='share' i]",
  "a[aria-label*='partilhar' i]",
  "a[aria-label*='share' i]",
  "button[title*='partilhar' i]",
  "button[title*='share' i]",
  "a[title*='partilhar' i]",
  "a[title*='share' i]"
] as const

const GENSPARK_SHARE_LABEL_TOKENS = ["partilhar", "share", "compartilhar"] as const

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase()
}

function readElementLabel(element: HTMLElement): string {
  return normalizeText(
    [element.getAttribute("aria-label"), element.getAttribute("title"), element.textContent]
      .filter(Boolean)
      .join(" ")
  )
}

function isTopRegionElement(element: HTMLElement): boolean {
  if (!isVisibleElement(element)) {
    return false
  }

  const rect = element.getBoundingClientRect()
  if (rect.width < 20 || rect.height < 20) {
    return false
  }

  if (rect.top < -8 || rect.top > 150) {
    return false
  }

  return true
}

function scoreByTopRight(rect: DOMRect): number {
  return Math.abs(rect.top - 40) + Math.abs(rect.right - (window.innerWidth - 24))
}

function resolveTopActionRow(): HTMLElement | null {
  const candidates: HTMLElement[] = []

  for (const selector of GENSPARK_TOP_ROW_SELECTORS) {
    candidates.push(...Array.from(document.querySelectorAll<HTMLElement>(selector)))
  }

  let bestRow: HTMLElement | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (const row of candidates) {
    if (!isVisibleElement(row)) {
      continue
    }

    const rect = row.getBoundingClientRect()
    if (rect.width < 120 || rect.height < 24) {
      continue
    }

    if (rect.top < -8 || rect.top > 150) {
      continue
    }

    if (rect.left < window.innerWidth * 0.45) {
      continue
    }

    const label = readElementLabel(row)
    const hasShareHint = GENSPARK_SHARE_LABEL_TOKENS.some((token) => label.includes(token))
    const score = scoreByTopRight(rect) + (hasShareHint ? 0 : 40)

    if (score < bestScore) {
      bestScore = score
      bestRow = row
    }
  }

  return bestRow
}

function resolveShareAnchorFromCandidates(candidates: HTMLElement[]): HTMLElement | null {
  let bestAnchor: HTMLElement | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    if (!isTopRegionElement(candidate)) {
      continue
    }

    const rect = candidate.getBoundingClientRect()
    const score = scoreByTopRight(rect)
    if (score < bestScore) {
      bestScore = score
      bestAnchor = candidate
    }
  }

  return bestAnchor
}

function resolveShareAnchorInside(row: HTMLElement): HTMLElement | null {
  const directCandidates: HTMLElement[] = []

  for (const selector of GENSPARK_SHARE_DIRECT_SELECTORS) {
    directCandidates.push(...Array.from(row.querySelectorAll<HTMLElement>(selector)))
  }

  const directMatch = resolveShareAnchorFromCandidates(directCandidates)
  if (directMatch) {
    return directMatch
  }

  const looseCandidates = Array.from(row.querySelectorAll<HTMLElement>("button, a, [role='button'], div, span")).filter(
    (element) => {
      if (element === row) {
        return false
      }

      const label = readElementLabel(element)
      return GENSPARK_SHARE_LABEL_TOKENS.some((token) => label.includes(token))
    }
  )

  return resolveShareAnchorFromCandidates(looseCandidates)
}

function resolveGlobalShareAnchor(): HTMLElement | null {
  const directCandidates: HTMLElement[] = []

  for (const selector of GENSPARK_SHARE_DIRECT_SELECTORS) {
    directCandidates.push(...Array.from(document.querySelectorAll<HTMLElement>(selector)))
  }

  const directMatch = resolveShareAnchorFromCandidates(directCandidates)
  if (directMatch) {
    return directMatch
  }

  const looseCandidates = Array.from(document.querySelectorAll<HTMLElement>("button, a, [role='button'], div, span")).filter(
    (element) => {
      const label = readElementLabel(element)
      return GENSPARK_SHARE_LABEL_TOKENS.some((token) => label.includes(token))
    }
  )

  return resolveShareAnchorFromCandidates(looseCandidates)
}

function resolveFloatingStyleNearShareAnchor(): CSSProperties | null {
  const topRow = resolveTopActionRow()
  const shareAnchor = (topRow ? resolveShareAnchorInside(topRow) : null) ?? resolveGlobalShareAnchor()

  if (!(shareAnchor instanceof HTMLElement)) {
    return null
  }

  const rect = shareAnchor.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    return null
  }

  const top = Math.max(8, Math.min(window.innerHeight - 40, Math.round(rect.top + (rect.height - GENSPARK_FLOAT_BUTTON_SIZE_PX) / 2)))
  const left = Math.max(
    8,
    Math.min(
      window.innerWidth - 40,
      Math.round(rect.left - GENSPARK_FLOAT_BUTTON_SIZE_PX - GENSPARK_GAP_TO_SHARE_PX)
    )
  )

  return {
    top: `${top}px`,
    left: `${left}px`
  }
}

export class GensparkStrategy implements ContentStrategy {
  readonly id = "genspark"

  matches(url: string): boolean {
    try {
      const parsed = new URL(url)
      const host = parsed.hostname.toLowerCase()
      const pathname = parsed.pathname || "/"

      const isAllowedHost = GENSPARK_ALLOWED_HOSTS.includes(host as (typeof GENSPARK_ALLOWED_HOSTS)[number])
      return isAllowedHost && /^\/agents\/?$/u.test(pathname)
    } catch {
      return false
    }
  }

  getRootContainer(): HTMLElement | null {
    return document.body
  }

  // Keep floating mount to avoid inline clipping/stacking issues in Genspark header.
  mountHost(_host: HTMLElement): boolean {
    return false
  }

  getStyles(): CSSProperties {
    return resolveFloatingStyleNearShareAnchor() ?? GENSPARK_FALLBACK_STYLE
  }

  getMenuAlign(): StrategyMenuAlign {
    return "right"
  }
}
