type LinkedInActionIntent = "like" | "comment" | "share" | "repost" | "send"

export interface LinkedInInlineTriggerPayload {
  triggerElement: HTMLButtonElement
  postUrn: string | null
  postRoot: HTMLElement | null
}

export interface LinkedInInlineTriggerOptions {
  inlineButtonAttribute: string
  onTriggerClick: (payload: LinkedInInlineTriggerPayload) => void
  isBusy?: () => boolean
  debugKey?: string
}

const LINKEDIN_NATIVE_ACTION_RAIL_SELECTOR = ".feed-shared-social-action-bar, .feed-action-bar"
const LINKEDIN_SHARE_ANCHOR_SELECTOR = [
  "button[aria-label*='compartilhar' i]",
  "button[aria-label*='share' i]",
  "button[aria-label*='repost' i]",
  "button[aria-label*='enviar' i]",
  "button[aria-label*='send' i]",
  "[data-control-name*='share'] button",
  "[data-control-name*='reshare'] button",
  "button[title*='Compartilhar' i]",
  "button[title*='Share' i]"
].join(",")
const LINKEDIN_COMMENT_SCOPE_SELECTOR = [
  ".comments-comment-item",
  "article.comments-comment-item",
  "li.comments-comment-item",
  "[data-test-id='comment-item']",
  "[data-view-name*='comments-comment-item']",
  "[data-view-name*='comment-container']",
  "[data-view-name*='comments-comment']",
  "[data-urn*='comment']",
  "li[id^='comment-']",
  "div[id^='comment-']"
].join(",")
const LINKEDIN_POST_SCOPE_SELECTOR = [
  "div[data-urn*='activity']",
  "div[data-id*='activity']",
  "article[data-urn*='activity']",
  "article[data-id*='activity']",
  "div.feed-shared-update-v2",
  "div.occludable-update",
  "div[data-view-name='feed-full-update']",
  "div[data-view-name='feed-reshare']",
  "div[data-finite-scroll-hotkey-item]"
].join(",")

const MINDDOCK_ICON_SRC = new URL("../../../public/images/logo/logotipo minddock.png", import.meta.url).href

function normalizeString(value: unknown): string {
  return String(value ?? "").trim()
}

function normalizeLabel(value: unknown): string {
  return normalizeString(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
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
  return rect.width > 0 && rect.height > 0
}

function resolveActionIntent(element: HTMLElement): LinkedInActionIntent | null {
  const label = normalizeLabel(
    `${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""} ${element.textContent ?? ""}`
  )
  if (!label) {
    return null
  }

  if (/\b(gostar|curtir|like|reagir)\b/u.test(label)) {
    return "like"
  }
  if (/\b(comentar|comment)\b/u.test(label)) {
    return "comment"
  }
  if (/\b(repostar|repost|republicar)\b/u.test(label)) {
    return "repost"
  }
  if (/\b(compartilhar|share)\b/u.test(label)) {
    return "share"
  }
  if (/\b(enviar|send|mensagem|message)\b/u.test(label)) {
    return "send"
  }

  return null
}

function hasComposerControls(scope: ParentNode): boolean {
  try {
    return Boolean(
      (scope as Element).querySelector?.(
        "input[type='text'], input[placeholder], textarea, [contenteditable='true'], [role='textbox']"
      )
    )
  } catch {
    return false
  }
}

function collectActionButtons(scope: ParentNode): HTMLElement[] {
  return Array.from(
    scope.querySelectorAll<HTMLElement>("button, [role='button'], a[role='button'], a[aria-label], a[title]")
  ).filter((candidate) => {
    if (!isVisibleElement(candidate)) {
      return false
    }

    if (candidate.tagName.toLowerCase() !== "a") {
      return true
    }

    const anchor = candidate as HTMLAnchorElement
    const href = normalizeString(anchor.getAttribute("href"))
    const hasSemanticHint = Boolean(resolveActionIntent(anchor))
    if (hasSemanticHint) {
      return true
    }

    if (href && !href.startsWith("javascript:")) {
      return true
    }

    return normalizeString(anchor.textContent).length > 0
  })
}

function resolveNearestRailFromAnchor(anchor: HTMLElement, scope: HTMLElement): HTMLElement | null {
  const candidates: Array<{ element: HTMLElement; score: number }> = []
  let cursor: HTMLElement | null = anchor
  let depth = 0
  while (cursor && cursor !== scope && depth < 10) {
    if (!cursor.closest(LINKEDIN_COMMENT_SCOPE_SELECTOR) && !hasComposerControls(cursor)) {
      const buttons = collectActionButtons(cursor)
      const intents = new Set<LinkedInActionIntent>()
      for (const button of buttons) {
        const intent = resolveActionIntent(button)
        if (intent) {
          intents.add(intent)
        }
      }

      const hasPrimary = intents.has("like") || intents.has("comment")
      const hasDistribution = intents.has("share") || intents.has("repost") || intents.has("send")
      const hasActionShape = buttons.length >= 3 && buttons.length <= 16
      const rect = cursor.getBoundingClientRect()
      const isRailLike = rect.width >= 180 && rect.height <= 140
      if (hasPrimary && hasDistribution && hasActionShape && isRailLike) {
        const area = Math.max(1, rect.width * rect.height)
        const depthBonus = Math.max(0, 10 - depth) * 200
        const score = depthBonus - area * 0.001
        candidates.push({ element: cursor, score })
      }
    }

    cursor = cursor.parentElement
    depth += 1
  }

  if (candidates.length === 0) {
    return null
  }

  candidates.sort((a, b) => b.score - a.score)
  return candidates[0]?.element ?? null
}

function resolveRailScore(rail: HTMLElement): number {
  if (hasComposerControls(rail)) {
    return Number.NEGATIVE_INFINITY
  }

  const buttons = collectActionButtons(rail)
  if (buttons.length < 1 || buttons.length > 28) {
    return Number.NEGATIVE_INFINITY
  }

  const intents = new Set<LinkedInActionIntent>()
  for (const button of buttons) {
    const intent = resolveActionIntent(button)
    if (intent) {
      intents.add(intent)
    }
  }

  const hasPrimary = intents.has("like") || intents.has("comment")
  const hasDistribution = intents.has("share") || intents.has("repost") || intents.has("send")
  const rect = rail.getBoundingClientRect()
  const structuralScore = rect.width >= 160 && rect.height <= 140 ? 1 : 0

  if (!hasPrimary || !hasDistribution) {
    const relaxedCandidate =
      intents.size >= 3 &&
      ((intents.has("like") && intents.has("share")) || (intents.has("comment") && intents.has("repost")))
    return structuralScore > 0 && relaxedCandidate ? 3 + intents.size : Number.NEGATIVE_INFINITY
  }

  return 12 + intents.size + structuralScore
}

function resolvePostRootFromRail(rail: HTMLElement): HTMLElement | null {
  let cursor: HTMLElement | null = rail
  while (cursor) {
    const hasActivityMarker =
      cursor.matches(LINKEDIN_POST_SCOPE_SELECTOR) ||
      normalizeString(cursor.getAttribute("data-urn")).includes("activity") ||
      normalizeString(cursor.getAttribute("data-id")).includes("activity")

    if (hasActivityMarker) {
      return cursor
    }

    cursor = cursor.parentElement
  }

  const permalinkAnchor = rail.closest("article, div[role='article']")?.querySelector?.(
    "a[href*='/feed/update/'], a[href*='/posts/'], a[href*='/activity-']"
  )
  if (permalinkAnchor) {
    return (permalinkAnchor.closest("article, div[role='article'], div[data-urn], div[data-id]") as HTMLElement | null) || null
  }

  return null
}

function resolvePostUrn(postRoot: HTMLElement | null): string {
  if (!postRoot) {
    return ""
  }

  const rawCandidates = [
    postRoot.getAttribute("data-urn"),
    postRoot.getAttribute("data-id"),
    postRoot.getAttribute("data-activity-urn"),
    postRoot.id
  ]

  for (const rawCandidate of rawCandidates) {
    const normalizedCandidate = normalizeString(rawCandidate)
    if (!normalizedCandidate) {
      continue
    }

    const numericMatch = normalizedCandidate.match(/(\d{8,})/u)
    if (numericMatch?.[1]) {
      return normalizeString(numericMatch[1])
    }
  }

  const permalink = postRoot.querySelector<HTMLAnchorElement>(
    "a[href*='/feed/update/'], a[href*='/posts/'], a[href*='/activity-']"
  )?.href
  const numericFromPermalink = normalizeString(permalink).match(/(\d{8,})/u)
  return numericFromPermalink?.[1] ? normalizeString(numericFromPermalink[1]) : ""
}

function resolveDirectChild(parent: HTMLElement, child: HTMLElement): HTMLElement {
  let cursor = child
  while (cursor.parentElement && cursor.parentElement !== parent) {
    cursor = cursor.parentElement
  }
  return cursor
}

type InsertionPlan = {
  anchor: HTMLElement
  mode: "before" | "after"
}

function resolveInsertionPlan(rail: HTMLElement): InsertionPlan | null {
  const buttons = collectActionButtons(rail)
  if (buttons.length === 0) {
    return null
  }

  const byIntent = (intent: LinkedInActionIntent): HTMLElement | undefined =>
    buttons.find((button) => resolveActionIntent(button) === intent)

  const send = byIntent("send")
  if (send) {
    return {
      anchor: resolveDirectChild(rail, send),
      mode: "before"
    }
  }

  const share = byIntent("share") || byIntent("repost")
  if (share) {
    return {
      anchor: resolveDirectChild(rail, share),
      mode: "after"
    }
  }

  const fallback = buttons[buttons.length - 1]
  if (!fallback) {
    return null
  }

  return {
    anchor: resolveDirectChild(rail, fallback),
    mode: "after"
  }
}

function resolveBestRailWithinScope(scope: HTMLElement): HTMLElement | null {
  const scoredRails = new Map<HTMLElement, number>()
  const intentButtons = collectActionButtons(scope).filter((button) => Boolean(resolveActionIntent(button)))
  if (intentButtons.length === 0) {
    return null
  }

  for (const button of intentButtons) {
    let cursor: HTMLElement | null = button
    let depth = 0
    while (cursor && cursor !== scope && depth < 9) {
      if (!cursor.closest(LINKEDIN_COMMENT_SCOPE_SELECTOR) && !hasComposerControls(cursor)) {
        const score = resolveRailScore(cursor)
        if (score > Number.NEGATIVE_INFINITY) {
          const depthBonus = Math.max(0, 8 - depth) * 0.15
          const candidateScore = score + depthBonus
          const currentScore = scoredRails.get(cursor) ?? Number.NEGATIVE_INFINITY
          if (candidateScore > currentScore) {
            scoredRails.set(cursor, candidateScore)
          }
        }
      }

      cursor = cursor.parentElement
      depth += 1
    }
  }

  if (scoredRails.size === 0) {
    return null
  }

  return Array.from(scoredRails.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

function collectGlobalSemanticRails(limit = 40): HTMLElement[] {
  const scoreByRail = new Map<HTMLElement, number>()
  const actionButtons = Array.from(
    document.querySelectorAll<HTMLElement>("button, [role='button'], a[role='button'], a[aria-label], a[title]")
  ).filter((button) => isVisibleElement(button) && Boolean(resolveActionIntent(button)))

  for (const button of actionButtons.slice(0, 1200)) {
    let cursor: HTMLElement | null = button
    let depth = 0

    while (cursor && cursor !== document.body && depth < 8) {
      if (!cursor.closest(LINKEDIN_COMMENT_SCOPE_SELECTOR) && !hasComposerControls(cursor)) {
        const rowButtons = collectActionButtons(cursor)
        if (rowButtons.length >= 3 && rowButtons.length <= 16) {
          const intents = new Set<LinkedInActionIntent>()
          for (const rowButton of rowButtons) {
            const intent = resolveActionIntent(rowButton)
            if (intent) {
              intents.add(intent)
            }
          }

          const hasPrimary = intents.has("like") || intents.has("comment")
          const hasDistribution = intents.has("share") || intents.has("repost") || intents.has("send")
          const rect = cursor.getBoundingClientRect()
          const isRailLike = rect.width >= 160 && rect.width <= 1600 && rect.height >= 24 && rect.height <= 180
          if (hasPrimary && hasDistribution && isRailLike) {
            const proximityBonus = Math.max(0, 8 - depth) * 3
            const intentBonus = intents.size * 10
            const compactBonus = Math.max(0, 120 - rect.height) * 0.08
            const score = proximityBonus + intentBonus + compactBonus
            const current = scoreByRail.get(cursor) ?? Number.NEGATIVE_INFINITY
            if (score > current) {
              scoreByRail.set(cursor, score)
            }
          }
        }
      }

      cursor = cursor.parentElement
      depth += 1
    }
  }

  return Array.from(scoreByRail.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, limit))
    .map(([rail]) => rail)
}

function buildInlineTrigger(sampleButton: HTMLElement | null, inlineButtonAttribute: string, postUrn: string): HTMLButtonElement {
  const trigger = document.createElement("button")
  trigger.type = "button"
  trigger.setAttribute(inlineButtonAttribute, "1")
  if (postUrn) {
    trigger.setAttribute("data-minddock-linkedin-post-urn", postUrn)
  }
  trigger.setAttribute("aria-label", "MindDock for this post")
  trigger.title = "MindDock"

  if (sampleButton instanceof HTMLButtonElement) {
    trigger.className = sampleButton.className
  }

  const inheritedColor = sampleButton ? window.getComputedStyle(sampleButton).color : ""
  trigger.style.minWidth = "62px"
  trigger.style.maxWidth = "72px"
  trigger.style.flex = "0 1 72px"
  trigger.style.height = "44px"
  trigger.style.padding = "2px 4px"
  trigger.style.borderRadius = "8px"
  trigger.style.border = "none"
  trigger.style.background = "transparent"
  trigger.style.color = inheritedColor || "inherit"
  trigger.style.fontSize = "11px"
  trigger.style.fontWeight = "600"
  trigger.style.lineHeight = "1.1"
  trigger.style.display = "inline-flex"
  trigger.style.flexDirection = "column"
  trigger.style.alignItems = "center"
  trigger.style.justifyContent = "center"
  trigger.style.gap = "2px"
  trigger.style.cursor = "pointer"
  trigger.style.fontFamily = "inherit"
  trigger.style.textTransform = "none"

  const logo = document.createElement("img")
  logo.src = MINDDOCK_ICON_SRC
  logo.alt = ""
  logo.width = 16
  logo.height = 16
  logo.style.width = "16px"
  logo.style.height = "16px"
  logo.style.objectFit = "contain"
  logo.style.pointerEvents = "none"

  const label = document.createElement("span")
  label.textContent = "NotebookLM"
  label.style.fontSize = "11px"
  label.style.fontWeight = "600"
  label.style.lineHeight = "1.1"
  label.style.color = inheritedColor || "inherit"
  label.style.pointerEvents = "none"

  trigger.replaceChildren(logo, label)
  return trigger
}

function collectCandidateRails(): HTMLElement[] {
  const rails = new Set<HTMLElement>()

  const nativeRails = Array.from(document.querySelectorAll<HTMLElement>(LINKEDIN_NATIVE_ACTION_RAIL_SELECTOR)).filter((rail) =>
    isVisibleElement(rail)
  )
  for (const rail of nativeRails) {
    if (rail.closest(LINKEDIN_COMMENT_SCOPE_SELECTOR)) {
      continue
    }
    if (resolveRailScore(rail) > Number.NEGATIVE_INFINITY) {
      rails.add(rail)
    }
  }

  const postScopes = Array.from(document.querySelectorAll<HTMLElement>(LINKEDIN_POST_SCOPE_SELECTOR)).filter((scope) =>
    isVisibleElement(scope)
  )
  for (const scope of postScopes) {
    const alreadyCovered = Array.from(rails).some((rail) => scope.contains(rail))
    if (alreadyCovered) {
      continue
    }

    const shareAnchors = Array.from(scope.querySelectorAll<HTMLElement>(LINKEDIN_SHARE_ANCHOR_SELECTOR)).filter((anchor) =>
      isVisibleElement(anchor)
    )
    for (const anchor of shareAnchors) {
      const railFromAnchor = resolveNearestRailFromAnchor(anchor, scope)
      if (railFromAnchor) {
        rails.add(railFromAnchor)
      }
    }

    const bestRail = resolveBestRailWithinScope(scope)
    if (bestRail) {
      rails.add(bestRail)
    }
  }

  if (rails.size === 0) {
    const broadScopes = Array.from(
      document.querySelectorAll<HTMLElement>("article, div[role='article'], div.feed-shared-update-v2, div.occludable-update")
    ).filter((scope) => isVisibleElement(scope))

    for (const scope of broadScopes.slice(0, 60)) {
      if (scope.closest(LINKEDIN_COMMENT_SCOPE_SELECTOR)) {
        continue
      }

      const shareAnchors = Array.from(scope.querySelectorAll<HTMLElement>(LINKEDIN_SHARE_ANCHOR_SELECTOR)).filter((anchor) =>
        isVisibleElement(anchor)
      )
      for (const anchor of shareAnchors) {
        const railFromAnchor = resolveNearestRailFromAnchor(anchor, scope)
        if (railFromAnchor) {
          rails.add(railFromAnchor)
        }
      }

      const bestRail = resolveBestRailWithinScope(scope)
      if (bestRail) {
        rails.add(bestRail)
      }
    }
  }

  if (rails.size === 0) {
    const globalShareAnchors = Array.from(document.querySelectorAll<HTMLElement>(LINKEDIN_SHARE_ANCHOR_SELECTOR)).filter(
      (anchor) => isVisibleElement(anchor)
    )

    for (const anchor of globalShareAnchors.slice(0, 120)) {
      if (anchor.closest(LINKEDIN_COMMENT_SCOPE_SELECTOR)) {
        continue
      }

      const railFromAnchor = resolveNearestRailFromAnchor(anchor, document.body)
      if (railFromAnchor && !railFromAnchor.closest(LINKEDIN_COMMENT_SCOPE_SELECTOR)) {
        rails.add(railFromAnchor)
      }
    }
  }

  if (rails.size === 0) {
    const semanticRails = collectGlobalSemanticRails(60)
    for (const rail of semanticRails) {
      if (!rail.closest(LINKEDIN_COMMENT_SCOPE_SELECTOR) && !hasComposerControls(rail)) {
        rails.add(rail)
      }
    }
  }

  return Array.from(rails)
}

export function initLinkedInInlineTriggers(options: LinkedInInlineTriggerOptions): () => void {
  const inlineButtonSelector = `button[${options.inlineButtonAttribute}='1']`
  const debugState = { scans: 0, rowsDetected: 0, inlineButtons: 0 }

  try {
    const debugKey = normalizeString(options.debugKey) || "__minddockLinkedinDebug"
    ;(window as typeof window & Record<string, unknown>)[debugKey] = debugState
  } catch {
    // Silent by design.
  }

  let disposed = false
  let debounceTimerId: number | null = null
  let animationFrameId: number | null = null

  const inject = (): void => {
    if (disposed) {
      return
    }

    const rails = collectCandidateRails()
    debugState.rowsDetected = rails.length
    debugState.scans += 1

    for (const rail of rails) {
      if (
        rail.querySelector(inlineButtonSelector) ||
        rail.closest(LINKEDIN_COMMENT_SCOPE_SELECTOR) ||
        hasComposerControls(rail)
      ) {
        continue
      }

      const postRoot = resolvePostRootFromRail(rail)
      const postUrn = resolvePostUrn(postRoot)
      const sampleButton = rail.querySelector<HTMLElement>("button, [role='button']")
      const triggerButton = buildInlineTrigger(sampleButton, options.inlineButtonAttribute, postUrn)

      triggerButton.addEventListener(
        "click",
        (event) => {
          event.preventDefault()
          event.stopPropagation()

          if (options.isBusy?.()) {
            return
          }

          const urnFromButton = normalizeString(triggerButton.getAttribute("data-minddock-linkedin-post-urn"))
          options.onTriggerClick({
            triggerElement: triggerButton,
            postUrn: urnFromButton || postUrn || null,
            postRoot
          })
        },
        { capture: true }
      )

      const insertionPlan = resolveInsertionPlan(rail)
      if (insertionPlan && insertionPlan.anchor.parentElement === rail) {
        if (insertionPlan.mode === "before") {
          rail.insertBefore(triggerButton, insertionPlan.anchor)
        } else {
          rail.insertBefore(triggerButton, insertionPlan.anchor.nextSibling)
        }
      } else {
        rail.appendChild(triggerButton)
      }
    }

    debugState.inlineButtons = document.querySelectorAll(inlineButtonSelector).length
  }

  const scheduleInject = (): void => {
    if (disposed) {
      return
    }

    if (debounceTimerId !== null) {
      window.clearTimeout(debounceTimerId)
    }

    debounceTimerId = window.setTimeout(() => {
      debounceTimerId = null

      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId)
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null
        inject()
      })
    }, 120)
  }

  const observer = new MutationObserver(() => {
    scheduleInject()
  })

  scheduleInject()
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true })
  }
  window.addEventListener("scroll", scheduleInject, true)
  window.addEventListener("resize", scheduleInject, true)

  return () => {
    disposed = true
    if (debounceTimerId !== null) {
      window.clearTimeout(debounceTimerId)
    }
    if (animationFrameId !== null) {
      window.cancelAnimationFrame(animationFrameId)
    }

    observer.disconnect()
    window.removeEventListener("scroll", scheduleInject, true)
    window.removeEventListener("resize", scheduleInject, true)

    const injectedButtons = Array.from(document.querySelectorAll<HTMLElement>(inlineButtonSelector))
    for (const button of injectedButtons) {
      button.remove()
    }
  }
}
