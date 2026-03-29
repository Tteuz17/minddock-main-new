import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign } from "./types"
import { clampNumber, queryFirstVisibleElement, resolveFallbackPlacement } from "./dom-utils"

const CHATGPT_CONVERSATION_ANCHOR_SELECTORS = [
  // NEW: title dropdown button (covers /c and /g)
  "header div[id^='radix-'][aria-haspopup='menu']",
  "header button[id^='radix-'][aria-haspopup='menu']",
  // NEW: GPT title (/g/...)
  "header button[class*='group'][class*='items-center']",
  "header button[class*='font-semibold']",
  "header button[class*='truncate']",
  "header div[class*='font-semibold'][class*='truncate']",
  "header span[class*='font-semibold']",
  "[data-testid='conversation-header'] div[id^='radix-'][class*='group']",
  "[data-testid='conversation-header'] button[id^='radix-'][class*='group']",
  "[data-testid='conversation-header'] [id^='radix-'][class*='group']",
  "main header div[id^='radix-'][class*='group']",
  "main header button[id^='radix-'][class*='group']",
  "main header [id^='radix-'][class*='group']",
  "main button[id^='radix-'][class*='group'][class*='justify-center']",
  "main div[id^='radix-'][class*='group'][class*='touch:min-h-10']",
  "main [id^='radix-'][class*='group'][class*='hover:bg-token-surface-hover']",
  "[data-testid='conversation-header'] h1",
  "[data-testid='conversation-header'] [data-testid*='title']",
  "main header [data-testid='conversation-title']",
  "main header [data-testid*='thread-title']",
  "main header h1"
] as const

const CHATGPT_MODEL_SWITCHER_SELECTORS = [
  "button[data-testid='model-switcher-dropdown-button']",
  "button[aria-label*='Model selector']",
  "button[aria-label*='Seletor de modelo']",
  "button[data-testid*='model-switcher']"
] as const

const CHATGPT_GPT_TITLE_SELECTORS = [
  "[data-testid='conversation-header'] button[id^='radix-']",
  "header button[id^='radix-'][class*='group']",
  "main header button[id^='radix-']",
  "[data-testid='conversation-header'] h1",
  "main header h1",
  "header h1"
] as const
const CHATGPT_SHARE_BUTTON_SELECTORS = [
  "button[aria-label*='Share' i]",
  "button[aria-label*='Compart' i]",
  "button[aria-label*='Copiar' i]",
  "[role='button'][aria-label*='Share' i]",
  "[role='button'][aria-label*='Compart' i]",
  "[data-testid*='share' i]"
] as const
const CHATGPT_HEADER_ACTION_SELECTORS = [
  "header button[aria-label*='Share' i]",
  "header a[aria-label*='Share' i]",
  "header button[aria-label*='Compart' i]",
  "header a[aria-label*='Compart' i]",
  "header button[aria-label*='Copiar' i]",
  "header button[aria-label*='Copy' i]",
  "header [data-testid*='share' i]",
  "header [data-testid*='copy' i]",
  "[data-testid='conversation-header'] button[aria-label*='Share' i]",
  "[data-testid='conversation-header'] a[aria-label*='Share' i]",
  "[data-testid='conversation-header'] button[aria-label*='Compart' i]",
  "[data-testid='conversation-header'] a[aria-label*='Compart' i]",
  "[data-testid='conversation-header'] [data-testid*='share' i]",
  "[data-testid='conversation-header'] [data-testid*='copy' i]",
  "main header button[aria-label*='Share' i]",
  "main header a[aria-label*='Share' i]",
  "main header button[aria-label*='Compart' i]",
  "main header a[aria-label*='Compart' i]",
  "main header [data-testid*='share' i]",
  "main header [data-testid*='copy' i]",
  "header .flex[class*='items-center'][class*='justify-center'][class*='gap-1.5']",
  "header .flex[class*='items-center'][class*='justify-center']",
  "[data-testid='conversation-header'] .flex[class*='items-center'][class*='justify-center']"
] as const

const FLOATING_BUTTON_SIZE_PX = 32
const FLOATING_BUTTON_GAP_PX = 6

let lastChatGptDebugSignature = ""

function logChatGptDebug(event: string, payload: Record<string, unknown>): void {
  try {
    const signature = `${event}:${JSON.stringify(payload)}`
    if (signature === lastChatGptDebugSignature) return
    lastChatGptDebugSignature = signature
    console.log(`[MindDock][ChatGPTStrategy] ${event}`, payload)
  } catch {
    console.log(`[MindDock][ChatGPTStrategy] ${event}`, payload)
  }
}

function isValidConversationAnchor(element: HTMLElement): boolean {
  if (!element.isConnected) return false
  const style = window.getComputedStyle(element)
  if (style.display === "none" || style.visibility === "hidden") return false

  const rect = element.getBoundingClientRect()
  if (rect.width < 40 || rect.height < 18) return false
  if (rect.top < -4 || rect.top > 190) return false
  if (rect.left < 8 || rect.left > window.innerWidth * 0.85) return false

  return true
}

function resolveConversationAnchor(): HTMLElement | null {
  const selectors = [...CHATGPT_GPT_TITLE_SELECTORS, ...CHATGPT_CONVERSATION_ANCHOR_SELECTORS]
  for (const selector of selectors) {
    let candidates: Element[] = []
    try {
      candidates = Array.from(document.querySelectorAll(selector))
    } catch {
      continue
    }

    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement)) continue
      if (!isValidConversationAnchor(candidate)) continue
      return candidate
    }
  }

  return null
}

function isHeaderControlCandidate(control: HTMLElement): boolean {
  if (!control.isConnected) return false
  const style = window.getComputedStyle(control)
  if (style.display === "none" || style.visibility === "hidden") return false
  const rect = control.getBoundingClientRect()
  if (rect.width < 18 || rect.height < 18) return false
  if (rect.bottom <= 0 || rect.top > Math.min(window.innerHeight, 220)) return false
  if (rect.right < window.innerWidth * 0.40) return false
  if (rect.left < -4 || rect.right > window.innerWidth + 8) return false
  return true
}

function isInteractiveControl(control: HTMLElement): boolean {
  const tag = control.tagName.toLowerCase()
  if (tag === "button") return true
  if (tag === "a") return true
  const role = control.getAttribute("role")
  if (role === "button") return true
  return false
}

function resolveShareButtonAnchor(): HTMLElement | null {
  const candidates: HTMLElement[] = []

  for (const selector of CHATGPT_SHARE_BUTTON_SELECTORS) {
    let elements: Element[] = []
    try {
      elements = Array.from(document.querySelectorAll(selector))
    } catch {
      continue
    }

    for (const el of elements) {
      if (!(el instanceof HTMLElement)) continue
      if (!isHeaderControlCandidate(el)) continue
      if (!isInteractiveControl(el)) continue
      candidates.push(el)
    }
  }

  if (candidates.length > 0) {
    const rightMost = pickRightMostControl(candidates)
    if (rightMost) return rightMost
  }

  const textMatches: HTMLElement[] = []
  const allButtons = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button']"))
  for (const btn of allButtons) {
    if (!isHeaderControlCandidate(btn)) continue
    if (!isInteractiveControl(btn)) continue
    const text = (btn.textContent ?? "").trim().toLowerCase()
    const aria = (btn.getAttribute("aria-label") ?? "").trim().toLowerCase()
    if (text.includes("compart") || text.includes("share") || aria.includes("compart") || aria.includes("share")) {
      textMatches.push(btn)
    }
  }

  if (textMatches.length > 0) {
    const rightMost = pickRightMostControl(textMatches)
    if (rightMost) return rightMost
  }

  return null
}

function resolveAnchorGap(anchor: HTMLElement): number {
  const parent = anchor.parentElement
  if (!parent) return FLOATING_BUTTON_GAP_PX
  const style = window.getComputedStyle(parent)
  if (style.display.includes("flex")) {
    const gapRaw = style.columnGap || style.gap
    if (gapRaw && gapRaw !== "normal") {
      const parsed = Number.parseFloat(gapRaw)
      if (Number.isFinite(parsed) && parsed >= 0) return parsed
    }
  }
  return FLOATING_BUTTON_GAP_PX
}

function findRightNeighbor(anchor: HTMLElement): HTMLElement | null {
  const parent = anchor.parentElement
  if (!parent) return null
  const anchorRect = anchor.getBoundingClientRect()
  const siblings = Array.from(parent.querySelectorAll<HTMLElement>("button, [role='button'], a"))
  let next: HTMLElement | null = null
  let nextLeft = Infinity
  for (const sib of siblings) {
    if (sib === anchor) continue
    if (!isHeaderControlCandidate(sib)) continue
    if (!isInteractiveControl(sib)) continue
    const rect = sib.getBoundingClientRect()
    if (rect.left > anchorRect.right && rect.left < nextLeft) {
      nextLeft = rect.left
      next = sib
    }
  }
  return next
}

function pickRightMostControl(controls: HTMLElement[]): HTMLElement | null {
  if (controls.length === 0) return null

  let best: HTMLElement | null = null
  let bestRight = -Infinity

  for (const control of controls) {
    const rect = control.getBoundingClientRect()
    // Ignore elements without size (React not painted yet)
    if (rect.width === 0 || rect.height === 0) continue
    if (rect.right > bestRight) {
      bestRight = rect.right
      best = control
    }
  }

  return best
}

function resolveChatGptHeaderActionAnchor(): HTMLElement | null {
  const shareAnchor = resolveShareButtonAnchor()
  if (shareAnchor) return shareAnchor

  const interactiveMatches: HTMLElement[] = []
  const containerMatches: HTMLElement[] = []

  for (const selector of CHATGPT_HEADER_ACTION_SELECTORS) {
    let candidates: Element[] = []
    try {
      candidates = Array.from(document.querySelectorAll(selector))
    } catch {
      continue
    }

    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement)) continue
      if (!isHeaderControlCandidate(candidate)) continue
      if (isInteractiveControl(candidate)) {
        interactiveMatches.push(candidate)
      } else {
        containerMatches.push(candidate)
      }
    }
  }

  if (interactiveMatches.length > 0) {
    const rightMost = pickRightMostControl(interactiveMatches)
    if (rightMost) return rightMost
  }

  if (containerMatches.length > 0) {
    const nestedMatches: HTMLElement[] = []
    for (const container of containerMatches) {
      const nestedControls = Array.from(
        container.querySelectorAll<HTMLElement>("button, [role='button'], a[role='button'], a")
      ).filter((control) => isHeaderControlCandidate(control) && isInteractiveControl(control))
      nestedMatches.push(...nestedControls)
    }
    if (nestedMatches.length > 0) {
      const rightMost = pickRightMostControl(nestedMatches)
      if (rightMost) return rightMost
    }
  }

  const header = document.querySelector("header")
  if (header instanceof HTMLElement) {
    const controls = Array.from(
      header.querySelectorAll<HTMLElement>("button, [role='button'], a[role='button'], a")
    ).filter((control) => isHeaderControlCandidate(control) && isInteractiveControl(control))

    const rightMost = pickRightMostControl(controls)
    if (rightMost) return rightMost
  }

  const main = document.querySelector("main")
  if (main instanceof HTMLElement) {
    const controls = Array.from(
      main.querySelectorAll<HTMLElement>("button, [role='button'], a[role='button'], a")
    ).filter((control) => isHeaderControlCandidate(control) && isInteractiveControl(control))

    const rightMost = pickRightMostControl(controls)
    if (rightMost) return rightMost
  }

  const fallback = queryFirstVisibleElement(CHATGPT_HEADER_ACTION_SELECTORS)
  if (fallback instanceof HTMLElement) {
    if (isInteractiveControl(fallback) && isHeaderControlCandidate(fallback)) return fallback
    if (fallback.getBoundingClientRect().width > 260) {
      const nestedControls = Array.from(
        fallback.querySelectorAll<HTMLElement>("button, [role='button'], a[role='button'], a")
      ).filter((control) => isHeaderControlCandidate(control) && isInteractiveControl(control))
      const rightMost = pickRightMostControl(nestedControls)
      if (rightMost) return rightMost
    }
  }

  return null
}

function resolveHeaderActionPlacement(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect()
  const minTop = 8
  const maxTop = Math.max(minTop, window.innerHeight - FLOATING_BUTTON_SIZE_PX - 8)
  const top = clampNumber(
    Math.round(rect.top + (rect.height - FLOATING_BUTTON_SIZE_PX) / 2),
    minTop,
    maxTop
  )

  const gap = resolveAnchorGap(anchor)
  const minLeft = 8
  const maxLeft = Math.max(minLeft, window.innerWidth - FLOATING_BUTTON_SIZE_PX - 8)

  let preferredLeft = Math.round(rect.right + gap)
  const rightNeighbor = findRightNeighbor(anchor)
  if (rightNeighbor) {
    const neighborLeft = rightNeighbor.getBoundingClientRect().left
    if (preferredLeft + FLOATING_BUTTON_SIZE_PX > neighborLeft - 2) {
      preferredLeft = Math.round(rect.left - FLOATING_BUTTON_SIZE_PX - gap)
    }
  }

  if (preferredLeft < minLeft || preferredLeft > maxLeft) {
    const leftCandidate = Math.round(rect.left - FLOATING_BUTTON_SIZE_PX - gap)
    preferredLeft = leftCandidate
  }

  const left = clampNumber(preferredLeft, minLeft, maxLeft)

  return {
    position: "fixed",
    top: `${top}px`,
    left: `${left}px`,
    zIndex: 2147483646,
    pointerEvents: "auto"
  }
}

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

  // Do NOT inject into ChatGPT's React tree - use fixed positioning instead.
  mountHost(_host: HTMLElement): boolean {
    logChatGptDebug("mount-host", { mountedInline: false })
    return false
  }

  getStyles(): CSSProperties {
    const pathname = window.location.pathname

    // Always try the title anchor first (/c and /g)
    const titleAnchor = resolveConversationAnchor()

    if (titleAnchor) {
      const rect = titleAnchor.getBoundingClientRect()

      // Timing guard: React not painted yet
      if (rect.width === 0 || rect.height === 0) {
        return {
          position: "fixed",
          top: "14px",
          left: "200px",
          zIndex: 2147483646,
          pointerEvents: "auto"
        }
      }

      const top = clampNumber(
        Math.round(rect.top + (rect.height - FLOATING_BUTTON_SIZE_PX) / 2),
        8,
        Math.max(8, window.innerHeight - FLOATING_BUTTON_SIZE_PX - 8)
      )
      const left = clampNumber(
        Math.round(rect.right + 8),
        8,
        Math.max(8, window.innerWidth - FLOATING_BUTTON_SIZE_PX - 8)
      )

      logChatGptDebug("style-anchor", {
        top,
        left,
        route: pathname.startsWith("/g/") ? "/g/" : "/c/",
        anchorText: (titleAnchor.textContent ?? "").trim().slice(0, 60)
      })

      return {
        position: "fixed",
        top: `${top}px`,
        left: `${left}px`,
        zIndex: 2147483646,
        pointerEvents: "auto"
      }
    }

    // Fallback only if title not found
    logChatGptDebug("style-fallback", { reason: "no-title-anchor" })
    return {
      position: "fixed",
      top: "14px",
      left: "200px",
      zIndex: 2147483646,
      pointerEvents: "auto"
    }
  }

  getMenuAlign(): StrategyMenuAlign {
    return "left"
  }
}





















