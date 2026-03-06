import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign, StrategyPlacement } from "./types"
import {
  isVisibleElement,
  resolveFallbackPlacement,
  resolveLeftOfAnchorPlacement,
  resolveRightOfAnchorPlacement
} from "./dom-utils"

type RedditControlKind = "comment" | "share"

const REDDIT_DOMAIN_SUFFIX = "reddit.com"

const REDDIT_LAYOUT = {
  postContainers: [
    "main shreddit-post",
    "main article[data-testid='post-container']",
    "main article",
    "shreddit-post",
    "article[data-testid='post-container']",
    ".thing.link"
  ],
  actionRows: [
    "div[data-testid='action-row']",
    "[slot='actions']",
    "faceplate-tracker[source='post_actions']",
    "div[data-post-click-location='post_footer']",
    "[aria-label*='Actions available']"
  ],
  shareControls: [
    "[slot='share-button']",
    "[data-post-click-location='share']",
    "button[aria-label*='Share']",
    "button[aria-label*='share']",
    "button[aria-label*='Compart']",
    "button[aria-label*='compart']",
    "button [icon-name*='share']",
    "svg[icon-name*='share']"
  ],
  commentControls: [
    "[slot='comment-button']",
    "button[aria-label*='Comment']",
    "button[aria-label*='comment']",
    "button[aria-label*='Coment']",
    "button[aria-label*='coment']",
    "button [icon-name*='comment']",
    "svg[icon-name*='comment']"
  ],
  clickableElements: ["button", "[role='button']", "a[role='button']", "a"]
} as const

interface ScoredControl {
  element: HTMLElement
  score: number
  top: number
}

function foldLabel(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function pickBestByScore<T extends { score: number; top: number }>(items: T[]): T | null {
  if (items.length === 0) {
    return null
  }

  items.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }

    const leftTop = left.top >= -80 ? left.top : Number.POSITIVE_INFINITY
    const rightTop = right.top >= -80 ? right.top : Number.POSITIVE_INFINITY
    return leftTop - rightTop
  })

  return items[0] ?? null
}

export class RedditStrategy implements ContentStrategy {
  readonly id = "reddit"

  matches(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase()
      return host === REDDIT_DOMAIN_SUFFIX || host.endsWith(`.${REDDIT_DOMAIN_SUFFIX}`)
    } catch {
      return false
    }
  }

  getRootContainer(): HTMLElement | null {
    return document.body
  }

  getStyles(): CSSProperties {
    return this.choosePlacement().style
  }

  getMenuAlign(): StrategyMenuAlign {
    return this.choosePlacement().menuAlign
  }

  private choosePlacement(): StrategyPlacement {
    const shareAnchor = this.findBestControl("share")
    if (shareAnchor) {
      return resolveRightOfAnchorPlacement(shareAnchor.getBoundingClientRect(), 8)
    }

    const commentAnchor = this.findBestControl("comment")
    if (commentAnchor) {
      return resolveRightOfAnchorPlacement(commentAnchor.getBoundingClientRect(), 8)
    }

    const actionRow = this.findBestActionRow()
    if (actionRow) {
      return resolveLeftOfAnchorPlacement(actionRow.getBoundingClientRect(), 8)
    }

    return resolveFallbackPlacement()
  }

  private scoreControl(element: HTMLElement, kind: RedditControlKind): ScoredControl {
    const rect = element.getBoundingClientRect()
    const label = this.buildElementLabel(element)
    let score = 1

    if (kind === "share" && /share|compart|repost|send/u.test(label)) {
      score += 5
    }
    if (kind === "comment" && /comment|coment/u.test(label)) {
      score += 5
    }

    if (this.isWithinActionRow(element)) {
      score += 3
    }

    if (rect.top >= -80 && rect.top <= window.innerHeight + 120) {
      score += 2
    }

    if (rect.width > 24 && rect.height > 18) {
      score += 1
    }

    return { element, score, top: rect.top }
  }

  private findBestControl(kind: RedditControlKind): HTMLElement | null {
    const roots = this.collectCandidatePosts()
    const semanticCandidates: ScoredControl[] = []
    const selectorCandidates = kind === "share" ? REDDIT_LAYOUT.shareControls : REDDIT_LAYOUT.commentControls
    const visited = new Set<HTMLElement>()

    for (const root of roots) {
      for (const selector of selectorCandidates) {
        let matched: Element[] = []
        try {
          matched = Array.from(root.querySelectorAll(selector))
        } catch {
          continue
        }

        for (const item of matched) {
          const anchor = this.resolveClickable(item)
          if (!anchor || visited.has(anchor)) {
            continue
          }

          visited.add(anchor)
          semanticCandidates.push(this.scoreControl(anchor, kind))
        }
      }

      for (const selector of REDDIT_LAYOUT.clickableElements) {
        let clickables: Element[] = []
        try {
          clickables = Array.from(root.querySelectorAll(selector))
        } catch {
          continue
        }

        for (const item of clickables) {
          const anchor = this.resolveClickable(item)
          if (!anchor || visited.has(anchor)) {
            continue
          }

          if (this.resolveControlKind(anchor) !== kind) {
            continue
          }

          visited.add(anchor)
          semanticCandidates.push(this.scoreControl(anchor, kind))
        }
      }
    }

    return pickBestByScore(semanticCandidates)?.element ?? null
  }

  private findBestActionRow(): HTMLElement | null {
    const roots = this.collectCandidatePosts()
    const rows: Array<{ row: HTMLElement; score: number; top: number }> = []

    for (const root of roots) {
      for (const selector of REDDIT_LAYOUT.actionRows) {
        let candidates: Element[] = []
        try {
          candidates = Array.from(root.querySelectorAll(selector))
        } catch {
          continue
        }

        for (const candidate of candidates) {
          if (!(candidate instanceof HTMLElement) || !isVisibleElement(candidate)) {
            continue
          }

          const score = this.scoreActionRow(candidate)
          if (score <= 0) {
            continue
          }

          rows.push({
            row: candidate,
            score,
            top: candidate.getBoundingClientRect().top
          })
        }
      }
    }

    return pickBestByScore(rows)?.row ?? null
  }

  private scoreActionRow(row: HTMLElement): number {
    const buttons = Array.from(row.querySelectorAll("button, [role='button']")).filter((candidate) =>
      isVisibleElement(candidate)
    )

    if (buttons.length < 2 || buttons.length > 14) {
      return 0
    }

    let score = 1
    let hasComment = false
    let hasShare = false

    for (const button of buttons) {
      const intent = this.resolveControlKind(button)
      if (intent === "comment") {
        hasComment = true
        score += 2
      } else if (intent === "share") {
        hasShare = true
        score += 2
      } else {
        const label = this.buildElementLabel(button)
        if (/upvote|downvote|voto/u.test(label)) {
          score += 1
        }
      }
    }

    if (hasComment && hasShare) {
      score += 3
    }

    return score
  }

  private collectCandidatePosts(): HTMLElement[] {
    const out: HTMLElement[] = []
    const seen = new Set<HTMLElement>()

    for (const selector of REDDIT_LAYOUT.postContainers) {
      let candidates: Element[] = []
      try {
        candidates = Array.from(document.querySelectorAll(selector))
      } catch {
        continue
      }

      for (const candidate of candidates) {
        if (!(candidate instanceof HTMLElement) || !isVisibleElement(candidate)) {
          continue
        }
        if (seen.has(candidate)) {
          continue
        }

        const rect = candidate.getBoundingClientRect()
        if (rect.width < 280) {
          continue
        }
        if (rect.bottom < 0 || rect.top > window.innerHeight + 200) {
          continue
        }

        seen.add(candidate)
        out.push(candidate)
      }
    }

    out.sort((left, right) => {
      const leftTop = left.getBoundingClientRect().top
      const rightTop = right.getBoundingClientRect().top
      const normalizedLeft = leftTop >= -120 ? leftTop : Number.POSITIVE_INFINITY
      const normalizedRight = rightTop >= -120 ? rightTop : Number.POSITIVE_INFINITY
      return normalizedLeft - normalizedRight
    })

    return out.slice(0, 8)
  }

  private resolveClickable(element: Element | null): HTMLElement | null {
    if (!(element instanceof HTMLElement) || !isVisibleElement(element)) {
      return null
    }

    if (element.matches("button, [role='button'], a[role='button']")) {
      return element
    }

    const closestAction = element.closest("button, [role='button'], a[role='button']")
    if (closestAction instanceof HTMLElement && isVisibleElement(closestAction)) {
      return closestAction
    }

    return element
  }

  private resolveControlKind(element: HTMLElement): RedditControlKind | null {
    const label = this.buildElementLabel(element)
    const hasShareIcon =
      !!element.querySelector("[icon-name*='share'], svg[icon-name*='share']") ||
      !!element.querySelector("[icon-name*='send'], svg[icon-name*='send']")
    const hasCommentIcon = !!element.querySelector("[icon-name*='comment'], svg[icon-name*='comment']")

    if (hasShareIcon || /share|compart|repost|send/u.test(label)) {
      return "share"
    }

    if (hasCommentIcon || /comment|coment/u.test(label)) {
      return "comment"
    }

    return null
  }

  private isWithinActionRow(element: HTMLElement): boolean {
    return !!element.closest(REDDIT_LAYOUT.actionRows.join(","))
  }

  private buildElementLabel(element: HTMLElement): string {
    const raw = `${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""} ${element.textContent ?? ""}`
    return foldLabel(raw)
  }
}
