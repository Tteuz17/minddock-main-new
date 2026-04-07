import type { CSSProperties } from "react"

import type { ContentStrategy, StrategyMenuAlign } from "./types"
import { INLINE_CONTAINER_STYLE, INLINE_HOST_STYLE, resolveFallbackPlacement } from "./dom-utils"

const GEMINI_RIGHT_SECTION_SELECTORS = [
  "header div.right-section",
  "[role='banner'] div.right-section",
  "header div[class*='right']",
  "[role='banner'] div[class*='right']",
  "div.right-section"
] as const

const GEMINI_SHARE_SELECTORS = [
  "button[aria-label*='compart' i]",
  "button[aria-label*='share' i]",
  "[role='button'][aria-label*='compart' i]",
  "[role='button'][aria-label*='share' i]",
  "button[title*='compart' i]",
  "button[title*='share' i]",
  "[role='button'][title*='compart' i]",
  "[role='button'][title*='share' i]",
  "mat-icon",
  "[class*='google-symbols']",
  "[class*='material-symbols']"
] as const

const GEMINI_COMPOSER_TOOL_SELECTORS = [
  "ms-chat-input button.toolbox-drawer-button-with-label",
  "ms-chat-input button[class*='toolbox-drawer-button']",
  "ms-chat-input ms-tool-access-button button",
  "ms-chat-input button[aria-label*='ferramentas' i]",
  "ms-chat-input button[aria-label*='tools' i]",
  "button.toolbox-drawer-button-with-label",
  "button[class*='toolbox-drawer-button']",
  "ms-tool-access-button button",
  "button[aria-label*='ferramentas' i]",
  "button[aria-label*='tools' i]"
] as const

const GEMINI_COMPOSER_HOST_STYLE =
  "display:inline-flex;align-items:center;vertical-align:middle;margin-left:15px;margin-right:0"
const GEMINI_HEADER_HOST_STYLE =
  "display:inline-flex;align-items:center;vertical-align:middle;margin-left:24px;margin-right:10px"

const GEMINI_COMPOSER_ROOT_SELECTORS = [
  "div[class*='text-input-field'][class*='with-toolbox-drawer']",
  "div[class*='text-input-field'][class*='with-toolbox']",
  "div[class*='text-input-field']",
  "ms-chat-input div[class*='text-input-field']",
  "ms-chat-input"
] as const

const GEMINI_TOOL_LABEL_TOKENS = ["ferramentas", "tools"] as const

const GEMINI_COMPOSER_ROW_SELECTORS = [
  "ms-chat-input div[class*='input-footer']",
  "ms-chat-input div[class*='footer']",
  "ms-chat-input div[class*='leading-actions']",
  "ms-chat-input div[class*='trailing-actions']",
  "ms-chat-input div[role='toolbar']",
  "div[class*='text-input-field'] div[class*='input-footer']",
  "div[class*='text-input-field'] div[class*='footer']",
  "div[class*='text-input-field'] div[class*='leading-actions']",
  "div[class*='text-input-field'] div[class*='trailing-actions']",
  "div[class*='text-input-field'] div[role='toolbar']",
  "form div[class*='input-footer']",
  "form div[class*='footer']",
  "form div[role='toolbar']"
] as const

const GEMINI_COMPOSER_INPUT_SELECTORS = [
  "textarea[aria-label*='gemini' i]",
  "textarea[placeholder*='gemini' i]",
  "div[contenteditable='true'][aria-label*='gemini' i]",
  "div[contenteditable='true'][data-placeholder*='gemini' i]"
] as const

const GEMINI_MOUNT_RETRY_DELAYS_MS = [200, 500, 1000, 1800, 2600] as const

function normalizeLabel(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
}

function isVisibleElement(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected) {
    return false
  }

  if (element.hidden || element.getAttribute("aria-hidden") === "true") {
    return false
  }

  const style = window.getComputedStyle(element)
  if (style.display === "none" || style.visibility === "hidden") {
    return false
  }

  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight
}

function isLikelyProfileItem(element: HTMLElement): boolean {
  if (
    element.querySelector(
      "img, [class*='avatar'], [data-profile], [aria-label*='profile' i], [aria-label*='conta' i], [aria-label*='account' i]"
    )
  ) {
    return true
  }

  const label = normalizeLabel(
    [element.getAttribute("aria-label") || "", element.getAttribute("title") || "", element.textContent || ""].join(" ")
  )
  if (label.includes("perfil") || label.includes("profile") || label.includes("conta") || label.includes("account")) {
    return true
  }

  const rect = element.getBoundingClientRect()
  if (rect.width >= 28 && rect.height >= 28) {
    const style = window.getComputedStyle(element)
    if (style.borderRadius.includes("999") || style.borderRadius.includes("50%")) {
      return true
    }
  }

  return false
}

function queryFirstVisibleElement(selectors: readonly string[], root: ParentNode = document): HTMLElement | null {
  for (const selector of selectors) {
    let candidates: Element[] = []
    try {
      candidates = Array.from(root.querySelectorAll(selector))
    } catch {
      continue
    }

    for (const candidate of candidates) {
      if (isVisibleElement(candidate)) {
        return candidate
      }
    }
  }

  return null
}

function resolveGeminiComposerRoot(): HTMLElement | null {
  const directRoot = queryFirstVisibleElement(GEMINI_COMPOSER_ROOT_SELECTORS)
  if (directRoot) {
    return directRoot
  }

  const inputCandidate = queryFirstVisibleElement(GEMINI_COMPOSER_INPUT_SELECTORS)
  if (!inputCandidate) {
    return null
  }

  const rootFromInput =
    inputCandidate.closest<HTMLElement>(
      "div[class*='text-input-field'], form, ms-chat-input, div[class*='chat-input'], div[class*='composer']"
    ) ?? inputCandidate.parentElement

  return rootFromInput && isVisibleElement(rootFromInput) ? rootFromInput : null
}

function isToolLabelMatch(element: HTMLElement): boolean {
  const label = normalizeLabel(
    [element.getAttribute("aria-label") ?? "", element.getAttribute("title") ?? "", element.textContent ?? ""].join(" ")
  )

  return GEMINI_TOOL_LABEL_TOKENS.some((token) => label.includes(token))
}

function pickBestToolButton(buttons: HTMLElement[]): HTMLElement | null {
  if (buttons.length === 0) {
    return null
  }

  const labeledButtons = buttons.filter((button) => isToolLabelMatch(button))
  if (labeledButtons.length > 0) {
    return labeledButtons[0]
  }

  const lowerHalfButtons = buttons.filter((button) => {
    const rect = button.getBoundingClientRect()
    return rect.top >= window.innerHeight * 0.45
  })

  if (lowerHalfButtons.length > 0) {
    lowerHalfButtons.sort((leftButton, rightButton) => {
      const leftRect = leftButton.getBoundingClientRect()
      const rightRect = rightButton.getBoundingClientRect()
      return rightRect.top - leftRect.top
    })
    return lowerHalfButtons[0]
  }

  return buttons[0]
}

function resolveGeminiToolAnchor(): HTMLElement | null {
  for (const selector of GEMINI_COMPOSER_TOOL_SELECTORS) {
    try {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
      for (const candidate of candidates) {
        if (!isVisibleElement(candidate)) continue
        const button =
          candidate.tagName === "BUTTON" ? candidate : (candidate.closest("button") as HTMLElement | null)
        if (button && isVisibleElement(button)) return button
      }
    } catch {
      continue
    }
  }

  const root = resolveGeminiComposerRoot()
  if (root) {
    const rootButtons = Array.from(root.querySelectorAll<HTMLElement>("button, [role='button']")).filter(isVisibleElement)
    const rootMatch = pickBestToolButton(rootButtons)
    if (rootMatch) {
      return rootMatch
    }
  }

  const globalButtons = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button']")).filter(isVisibleElement)
  return pickBestToolButton(globalButtons)
}

function resolveDirectChildInContainer(container: HTMLElement, node: Element | null): HTMLElement | null {
  if (!(node instanceof HTMLElement) || !isVisibleElement(node)) {
    return null
  }

  let cursor: HTMLElement | null = node
  for (let depth = 0; depth < 8 && cursor; depth += 1) {
    if (cursor.parentElement === container) {
      return cursor
    }
    cursor = cursor.parentElement
  }

  return null
}

function resolveRightSection(): HTMLElement | null {
  return queryFirstVisibleElement(GEMINI_RIGHT_SECTION_SELECTORS)
}

function resolveRightSectionItems(rightSection: HTMLElement): HTMLElement[] {
  return Array.from(rightSection.children).filter((child): child is HTMLElement => {
    if (!(child instanceof HTMLElement) || !isVisibleElement(child)) {
      return false
    }

    const rect = child.getBoundingClientRect()
    return rect.width >= 12 && rect.height >= 12
  })
}

function resolveShareItem(rightSection: HTMLElement): HTMLElement | null {
  for (const selector of GEMINI_SHARE_SELECTORS) {
    const candidate = queryFirstVisibleElement([selector], rightSection)
    const directChild = resolveDirectChildInContainer(rightSection, candidate)
    if (!directChild) {
      continue
    }

    const label = normalizeLabel(
      [
        directChild.getAttribute("aria-label") || "",
        directChild.getAttribute("title") || "",
        candidate?.getAttribute("aria-label") || "",
        candidate?.getAttribute("title") || "",
        candidate?.textContent || "",
        directChild.textContent || ""
      ].join(" ")
    )

    if (label.includes("share") || label.includes("compart") || label.includes("partilhar")) {
      return directChild
    }
  }

  const items = resolveRightSectionItems(rightSection)
  for (const item of items) {
    const label = normalizeLabel(
      [item.getAttribute("aria-label") || "", item.getAttribute("title") || "", item.textContent || ""].join(" ")
    )
    if (label.includes("share") || label.includes("compart") || label.includes("partilhar")) {
      return item
    }
  }

  const nonProfile = items.filter((item) => !isLikelyProfileItem(item))
  return nonProfile[0] ?? items[0] ?? null
}

function mountHostAfterAnchor(host: HTMLElement, anchor: HTMLElement, hostStyle = INLINE_HOST_STYLE): boolean {
  if (!anchor.parentElement) {
    return false
  }

  host.style.cssText = hostStyle
  const alreadyAfter = host.parentElement === anchor.parentElement && host.previousElementSibling === anchor
  if (!alreadyAfter) {
    anchor.parentElement.insertBefore(host, anchor.nextSibling)
  }

  return true
}

function mountHostBeforeAnchor(host: HTMLElement, anchor: HTMLElement, hostStyle = INLINE_HOST_STYLE): boolean {
  if (!anchor.parentElement) {
    return false
  }

  host.style.cssText = hostStyle
  if (host.parentElement !== anchor.parentElement || host.nextElementSibling !== anchor) {
    anchor.parentElement.insertBefore(host, anchor)
  }

  return true
}

function mountHostInContainer(host: HTMLElement, container: HTMLElement, hostStyle = INLINE_HOST_STYLE): boolean {
  host.style.cssText = hostStyle
  if (host.parentElement !== container) {
    container.appendChild(host)
  }

  return true
}

function tryMountInRightSection(host: HTMLElement): boolean {
  const rightSection = resolveRightSection()
  if (!rightSection) {
    return false
  }

  const shareItem = resolveShareItem(rightSection)
  // Place near "Atualizar", but anchor on "Compartilhar" because it is more stable.
  if (shareItem && mountHostBeforeAnchor(host, shareItem, GEMINI_HEADER_HOST_STYLE)) {
    return true
  }

  const profileItem = resolveRightSectionItems(rightSection).find((item) => isLikelyProfileItem(item))
  if (profileItem && mountHostBeforeAnchor(host, profileItem, GEMINI_HEADER_HOST_STYLE)) {
    return true
  }

  return mountHostInContainer(host, rightSection, GEMINI_HEADER_HOST_STYLE)
}

function resolveComposerRowFromRoot(composerRoot: HTMLElement): HTMLElement | null {
  const directMatch = queryFirstVisibleElement(GEMINI_COMPOSER_ROW_SELECTORS, composerRoot)
  if (directMatch) {
    return directMatch
  }

  const candidates = Array.from(composerRoot.querySelectorAll<HTMLElement>("div"))
    .filter((candidate) => {
      if (!isVisibleElement(candidate)) return false
      const controls = candidate.querySelectorAll("button, [role='button']")
      if (controls.length < 2) return false
      const rect = candidate.getBoundingClientRect()
      return rect.top >= window.innerHeight * 0.5
    })

  return candidates.at(-1) ?? null
}

function tryMountInComposer(host: HTMLElement): boolean {
  const composerRoot = resolveGeminiComposerRoot()
  const toolAnchor = resolveGeminiToolAnchor()

  if (toolAnchor) {
    if (mountHostAfterAnchor(host, toolAnchor, GEMINI_COMPOSER_HOST_STYLE)) {
      return true
    }
  }

  const composerRow =
    queryFirstVisibleElement(GEMINI_COMPOSER_ROW_SELECTORS, composerRoot ?? document) ??
    (composerRoot ? resolveComposerRowFromRoot(composerRoot) : null)

  if (!composerRow) {
    return false
  }

  host.style.cssText = GEMINI_COMPOSER_HOST_STYLE

  const rowButtons = Array.from(composerRow.querySelectorAll<HTMLElement>("button, [role='button']")).filter(
    isVisibleElement
  )

  const rowToolButton = rowButtons.find((button) => isToolLabelMatch(button))
  if (rowToolButton?.parentElement === composerRow) {
    if (host.parentElement !== composerRow || host.previousElementSibling !== rowToolButton) {
      composerRow.insertBefore(host, rowToolButton.nextSibling)
    }
    return true
  }

  const leadingButton = rowButtons[0]
  if (leadingButton?.parentElement === composerRow) {
    if (host.parentElement !== composerRow || host.previousElementSibling !== leadingButton) {
      composerRow.insertBefore(host, leadingButton.nextSibling)
    }
    return true
  }

  if (host.parentElement !== composerRow) {
    composerRow.appendChild(host)
  }

  return true
}

export class GeminiStrategy implements ContentStrategy {
  readonly id = "gemini"

  private mountedInline = false
  private mountRetryTimeoutIds: number[] = []
  private mountRetryScheduled = false

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

  private clearMountRetryTimers(): void {
    for (const timeoutId of this.mountRetryTimeoutIds) {
      window.clearTimeout(timeoutId)
    }
    this.mountRetryTimeoutIds = []
    this.mountRetryScheduled = false
  }

  private scheduleMountRetry(host: HTMLElement): void {
    if (this.mountRetryScheduled) {
      return
    }

    this.mountRetryScheduled = true

    for (const delayMs of GEMINI_MOUNT_RETRY_DELAYS_MS) {
      const timeoutId = window.setTimeout(() => {
        this.mountRetryTimeoutIds = this.mountRetryTimeoutIds.filter((activeTimeoutId) => activeTimeoutId !== timeoutId)

        if (!host.isConnected) {
          if (this.mountRetryTimeoutIds.length === 0) {
            this.mountRetryScheduled = false
          }
          return
        }

        this.mountedInline = false

        if (tryMountInRightSection(host) || tryMountInComposer(host)) {
          this.mountedInline = true
          this.clearMountRetryTimers()
          return
        }

        if (this.mountRetryTimeoutIds.length === 0) {
          this.mountRetryScheduled = false
        }
      }, delayMs)

      this.mountRetryTimeoutIds.push(timeoutId)
    }
  }

  mountHost(host: HTMLElement): boolean {
    this.mountedInline = false

    // Prefer top-right header placement; composer is fallback.
    if (tryMountInRightSection(host)) {
      this.mountedInline = true
      this.clearMountRetryTimers()
      return true
    }

    if (tryMountInComposer(host)) {
      this.mountedInline = true
      this.clearMountRetryTimers()
      return true
    }

    this.scheduleMountRetry(host)
    host.style.cssText = ""
    return false
  }

  getStyles(): CSSProperties {
    return this.mountedInline ? INLINE_CONTAINER_STYLE : resolveFallbackPlacement().style
  }

  getMenuAlign(): StrategyMenuAlign {
    return "right"
  }
}
