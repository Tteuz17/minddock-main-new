export interface RedditInlineTriggerPayload {
  triggerElement: HTMLButtonElement
  postRoot: HTMLElement
  postPermalink: string | null
}

export interface RedditInlineTriggerOptions {
  inlineButtonAttribute: string
  onTriggerClick: (payload: RedditInlineTriggerPayload) => void
  isBusy?: () => boolean
  debugKey?: string
}

const REDDIT_DOM = {
  postNodes: "shreddit-post, article[data-testid='post-container'], .thing.link",
  actionRows: [
    "faceplate-tracker[source='post_actions']",
    "div[data-testid='action-row']",
    "[slot='actions']",
    ".post-actions",
    ".flex.items-center.gap-2",
    "div[data-post-click-location='post_footer']"
  ],
  shareHooks: [
    "button[aria-label*='Share' i]",
    "button[aria-label*='Compartilhar' i]",
    "button[aria-label*='compartilhar' i]",
    "[data-post-click-location='share']",
    "slot[name='share-button']",
    "[slot='share-button']",
    "button [icon-name*='share']",
    "svg[icon-name*='share']"
  ],
  interactive: "button, [role='button'], a[role='button'], a"
} as const

const MINDDOCK_ICON_SRC = new URL("../../../public/images/logo/logotipo minddock.png", import.meta.url).href

function clean(value: unknown): string {
  return String(value ?? "").trim()
}

function fold(value: unknown): string {
  return clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
}

function isInteractable(element: Element): element is HTMLElement {
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

function resolvePostPermalink(postRoot: HTMLElement): string | null {
  const fromAttribute = clean(postRoot.getAttribute("permalink"))
  if (fromAttribute) {
    try {
      return new URL(fromAttribute, window.location.origin).toString()
    } catch {
      // no-op
    }
  }

  const anchor = postRoot.querySelector<HTMLAnchorElement>("a[href*='/comments/']")
  const href = clean(anchor?.getAttribute("href"))
  if (!href) {
    return null
  }

  try {
    return new URL(href, window.location.origin).toString()
  } catch {
    return null
  }
}

function collectRoots(host: HTMLElement): ParentNode[] {
  const unique = new Set<ParentNode>()
  unique.add(host)

  const hostShadow = (host as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot
  if (hostShadow) {
    unique.add(hostShadow)
  }

  const trackers = Array.from(host.querySelectorAll<HTMLElement>("faceplate-tracker"))
  for (const tracker of trackers) {
    unique.add(tracker)
    const trackerShadow = (tracker as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot
    if (trackerShadow) {
      unique.add(trackerShadow)
    }
  }

  return Array.from(unique)
}

function queryAcrossRoots(roots: ParentNode[], selector: string): Element[] {
  const out: Element[] = []
  for (const root of roots) {
    try {
      out.push(...Array.from(root.querySelectorAll(selector)))
    } catch {
      // no-op
    }
  }
  return out
}

function likelyShareControl(element: HTMLElement): boolean {
  const label = fold(`${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""} ${element.textContent ?? ""}`)
  if (label.includes("share") || label.includes("compart")) {
    return true
  }

  return !!element.querySelector("[icon-name*='share'], svg[icon-name*='share']")
}

function findActionRow(postRoot: HTMLElement): HTMLElement | null {
  const roots = collectRoots(postRoot)

  for (const selector of REDDIT_DOM.actionRows) {
    const hits = queryAcrossRoots(roots, selector)
    for (const hit of hits) {
      if (!(hit instanceof HTMLElement)) {
        continue
      }

      if (hit.tagName.toLowerCase() === "faceplate-tracker") {
        return hit
      }

      if (isInteractable(hit)) {
        return hit
      }
    }
  }

  const controls = queryAcrossRoots(roots, REDDIT_DOM.interactive).filter(
    (element): element is HTMLElement => element instanceof HTMLElement && isInteractable(element)
  )

  const share = controls.find((control) => likelyShareControl(control))
  if (!share) {
    return null
  }

  let cursor: HTMLElement | null = share
  let depth = 0

  while (cursor && cursor !== postRoot && depth < 8) {
    const controlCount = cursor.querySelectorAll(REDDIT_DOM.interactive).length
    if (controlCount >= 3 && controlCount <= 14 && isInteractable(cursor)) {
      return cursor
    }

    cursor = cursor.parentElement
    depth += 1
  }

  return null
}

function resolveAnchorFromNode(node: Element): HTMLElement | null {
  if (!(node instanceof HTMLElement)) {
    return null
  }

  const closest = node.closest("button, [role='button'], a[role='button'], a")
  if (closest instanceof HTMLElement) {
    return closest
  }

  return node
}

function findShareControl(actionRow: HTMLElement): HTMLElement | null {
  const roots = collectRoots(actionRow)

  for (const selector of REDDIT_DOM.shareHooks) {
    const hits = queryAcrossRoots(roots, selector)
    for (const hit of hits) {
      const anchor = resolveAnchorFromNode(hit)
      if (anchor && isInteractable(anchor)) {
        return anchor
      }
    }
  }

  const controls = queryAcrossRoots(roots, REDDIT_DOM.interactive).filter(
    (element): element is HTMLElement => element instanceof HTMLElement && isInteractable(element)
  )

  return controls.find((control) => likelyShareControl(control)) ?? null
}

function hasTriggerMounted(actionRow: HTMLElement, triggerSelector: string): boolean {
  const roots = collectRoots(actionRow)
  for (const root of roots) {
    try {
      if (root.querySelector(triggerSelector)) {
        return true
      }
    } catch {
      // no-op
    }
  }

  return false
}

function createTriggerButton(attributeName: string, referenceControl: HTMLElement | null): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.setAttribute(attributeName, "1")
  button.setAttribute("aria-label", "NotebookLM")
  button.title = "NotebookLM"

  if (referenceControl instanceof HTMLButtonElement && clean(referenceControl.className)) {
    button.className = referenceControl.className
  }

  button.style.cssText = [
    "margin-left: 6px",
    "padding: 0 12px",
    "border-radius: 999px",
    "border: 1px solid rgba(120,120,120,.45)",
    "background: transparent",
    "color: inherit",
    "height: 32px",
    "display: inline-flex",
    "align-items: center",
    "gap: 6px",
    "flex: 0 0 auto",
    "position: relative",
    "z-index: 2",
    "pointer-events: auto",
    "cursor: pointer",
    "font-weight: 600",
    "font-size: 12px",
    "line-height: 1",
    "white-space: nowrap"
  ].join(";")

  const icon = document.createElement("img")
  icon.src = MINDDOCK_ICON_SRC
  icon.alt = ""
  icon.width = 14
  icon.height = 14
  icon.style.cssText = "width:14px;height:14px;object-fit:contain;flex:0 0 auto;pointer-events:none"

  const text = document.createElement("span")
  text.textContent = "NotebookLM"
  text.style.pointerEvents = "none"

  button.append(icon, text)
  return button
}

function mountAfterShare(actionRow: HTMLElement, triggerButton: HTMLButtonElement, shareControl: HTMLElement | null): void {
  if (shareControl?.parentElement) {
    shareControl.parentElement.insertBefore(triggerButton, shareControl.nextSibling)
    return
  }

  actionRow.appendChild(triggerButton)
}

export function initRedditInlineTriggers(options: RedditInlineTriggerOptions): () => void {
  const triggerSelector = `button[${options.inlineButtonAttribute}='1']`

  const debugState = {
    scans: 0,
    postsFound: 0,
    activeTriggers: 0,
    triggersMounted: 0
  }

  try {
    const debugKey = clean(options.debugKey) || "__minddockRedditDebug"
    ;(window as typeof window & Record<string, unknown>)[debugKey] = debugState
  } catch {
    // no-op
  }

  let disposed = false
  let scheduleTimer: number | null = null
  let rafId: number | null = null

  const runInjection = (): void => {
    if (disposed) {
      return
    }

    const posts = Array.from(document.querySelectorAll<HTMLElement>(REDDIT_DOM.postNodes)).filter((post) => post.isConnected)
    debugState.postsFound = posts.length
    debugState.scans += 1

    for (const postRoot of posts) {
      const actionRow = findActionRow(postRoot)
      if (!actionRow || hasTriggerMounted(actionRow, triggerSelector)) {
        continue
      }

      const shareControl = findShareControl(actionRow)
      const trigger = createTriggerButton(options.inlineButtonAttribute, shareControl)
      const postPermalink = resolvePostPermalink(postRoot)

      trigger.addEventListener(
        "click",
        (event) => {
          event.preventDefault()
          event.stopPropagation()

          if (options.isBusy?.()) {
            return
          }

          options.onTriggerClick({
            triggerElement: trigger,
            postRoot,
            postPermalink
          })
        },
        { capture: true }
      )

      mountAfterShare(actionRow, trigger, shareControl)
      debugState.triggersMounted += 1
    }

    debugState.activeTriggers = document.querySelectorAll(triggerSelector).length
  }

  const scheduleInjection = (): void => {
    if (disposed) {
      return
    }

    if (scheduleTimer !== null) {
      window.clearTimeout(scheduleTimer)
    }

    scheduleTimer = window.setTimeout(() => {
      scheduleTimer = null

      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
      }

      rafId = window.requestAnimationFrame(() => {
        rafId = null
        runInjection()
      })
    }, 110)
  }

  const observer = new MutationObserver(() => {
    scheduleInjection()
  })

  scheduleInjection()
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true })
  }

  window.addEventListener("scroll", scheduleInjection, true)
  window.addEventListener("resize", scheduleInjection, true)

  return () => {
    disposed = true

    if (scheduleTimer !== null) {
      window.clearTimeout(scheduleTimer)
    }

    if (rafId !== null) {
      window.cancelAnimationFrame(rafId)
    }

    observer.disconnect()
    window.removeEventListener("scroll", scheduleInjection, true)
    window.removeEventListener("resize", scheduleInjection, true)

    const mounted = Array.from(document.querySelectorAll<HTMLElement>(triggerSelector))
    for (const node of mounted) {
      node.remove()
    }
  }
}
