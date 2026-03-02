export const SOURCE_PANEL_TOGGLE_EVENT = "minddock:source-panel:toggle"
export const SOURCE_PANEL_RESET_EVENT = "minddock:source-panel:reset"
export const SOURCE_PANEL_EXPORT_EVENT = "minddock:source-panel:export"
export const SOURCE_PANEL_REFRESH_EVENT = "minddock:source-panel:refresh"

export type SourceFilterType = "All" | "PDFs" | "GDocs" | "Web" | "Text" | "YouTube"

const SOURCE_ROW_SELECTORS = [
  "[data-testid='source-list-item']",
  "[data-testid*='source-item']",
  "[data-testid*='source-list'] [role='listitem']",
  "source-picker [role='listitem']",
  "source-picker li",
  ".source-panel [role='listitem']",
  ".source-panel li"
] as const

const TITLE_SELECTORS = ["[data-testid*='title']", "[title]", "a", "h3", "h4", "span", "p"] as const
const CHECKBOX_SELECTORS = ["input[type='checkbox']", "[role='checkbox']", "[aria-checked]"] as const

export function getDeepRoots(): ParentNode[] {
  const roots: ParentNode[] = []
  const queue: ParentNode[] = [document]
  const seen = new Set<ParentNode>()

  while (queue.length > 0) {
    const current = queue.shift()!
    if (seen.has(current)) {
      continue
    }

    seen.add(current)
    roots.push(current)

    const elements =
      "querySelectorAll" in current
        ? Array.from(current.querySelectorAll("*"))
        : []

    for (const element of elements) {
      if (element.shadowRoot && !seen.has(element.shadowRoot)) {
        queue.push(element.shadowRoot)
      }
    }
  }

  return roots
}

export function queryDeepAll<T extends Element>(selectors: readonly string[], root?: ParentNode): T[] {
  const roots = root ? [root] : getDeepRoots()
  const result: T[] = []
  const seen = new Set<Element>()

  for (const currentRoot of roots) {
    if (!("querySelectorAll" in currentRoot)) {
      continue
    }

    for (const selector of selectors) {
      for (const element of Array.from(currentRoot.querySelectorAll(selector))) {
        if (seen.has(element)) {
          continue
        }
        seen.add(element)
        result.push(element as T)
      }
    }
  }

  return result
}

export function queryDeepFirstVisible<T extends HTMLElement>(selectors: readonly string[]): T | null {
  for (const element of queryDeepAll<T>(selectors)) {
    if (isVisible(element)) {
      return element
    }
  }

  return null
}

export function isVisible(element: HTMLElement | null | undefined): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false
  }
  if (!element.isConnected) {
    return false
  }

  const style = window.getComputedStyle(element)
  return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0
}

function inInjectedTree(element: HTMLElement): boolean {
  return !!element.closest("#minddock-source-actions-root, #minddock-source-filters-root")
}

function normalize(text: string): string {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

export function extractSourceTitle(row: HTMLElement): string {
  for (const selector of TITLE_SELECTORS) {
    const candidate = row.querySelector(selector)
    if (!(candidate instanceof HTMLElement)) {
      continue
    }

    const byTitle = String(candidate.getAttribute("title") ?? "").trim()
    if (byTitle) {
      return byTitle
    }

    const byText = String(candidate.innerText ?? "").trim()
    if (byText) {
      return byText
    }
  }

  const fallback = String(row.innerText ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean)

  return fallback ?? ""
}

export function extractSourceUrl(row: HTMLElement): string {
  const anchor = row.querySelector("a[href]")
  if (anchor instanceof HTMLAnchorElement) {
    return String(anchor.href ?? "").trim()
  }

  return ""
}

export function inferSourceType(row: HTMLElement): SourceFilterType {
  const title = normalize(extractSourceTitle(row))
  const url = normalize(extractSourceUrl(row))
  const snapshot = `${title} ${url}`

  if (/youtube|youtu\.be|youtube\.com/.test(snapshot)) {
    return "YouTube"
  }

  if (/\.pdf(\b|$)|\bpdf\b/.test(snapshot)) {
    return "PDFs"
  }

  if (/docs\.google\.com\/document|\bgdoc\b|google doc/.test(snapshot)) {
    return "GDocs"
  }

  if (/^https?:\/\//.test(url) || /https?:\/\//.test(snapshot)) {
    return "Web"
  }

  return "Text"
}

export function resolveSourceRows(): HTMLElement[] {
  return queryDeepAll<HTMLElement>(SOURCE_ROW_SELECTORS).filter((row) => {
    if (!isVisible(row)) {
      return false
    }
    if (inInjectedTree(row)) {
      return false
    }

    const hasCheckbox = CHECKBOX_SELECTORS.some((selector) => {
      const found = row.querySelector(selector)
      return found instanceof HTMLElement
    })

    return hasCheckbox
  })
}

export function dispatchSourcePanelToggle(isVisibleNext: boolean): void {
  window.dispatchEvent(
    new CustomEvent(SOURCE_PANEL_TOGGLE_EVENT, {
      detail: { isVisible: isVisibleNext }
    })
  )
}

export function dispatchSourcePanelReset(): void {
  window.dispatchEvent(new CustomEvent(SOURCE_PANEL_RESET_EVENT))
}

export function dispatchSourcePanelExport(): void {
  window.dispatchEvent(new CustomEvent(SOURCE_PANEL_EXPORT_EVENT))
}

export function dispatchSourcePanelRefresh(): void {
  window.dispatchEvent(new CustomEvent(SOURCE_PANEL_REFRESH_EVENT))
}

export function clearNativeSourceSearchInputs(): void {
  const searchSelectors = [
    "source-picker input[type='text']",
    "source-picker input[placeholder*='Pesquise']",
    "source-picker input[placeholder*='Search']",
    ".source-panel input[type='text']"
  ] as const

  for (const input of queryDeepAll<HTMLInputElement | HTMLTextAreaElement>(searchSelectors)) {
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
      continue
    }

    input.value = ""
    input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }))
    input.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }))
  }
}

export function resolveNotebookIdFromRoute(): string | null {
  const match = String(window.location.pathname ?? "").match(/\/notebook\/([^/?#]+)/i)
  return match?.[1] ?? null
}

export function resolveSourceActionsHost(): HTMLElement | null {
  return queryDeepFirstVisible<HTMLElement>([
    "source-picker .panel-header > div:last-child",
    "source-picker .panel-header > div",
    ".source-panel .panel-header > div:last-child"
  ])
}

export function resolveSourceFiltersHost(): HTMLElement | null {
  return queryDeepFirstVisible<HTMLElement>([
    "source-picker div.contents div.button-row",
    ".source-panel .button-row"
  ])
}

export function ensureOriginalDisplay(row: HTMLElement): string {
  const stored = String(row.dataset.minddockOriginalDisplay ?? "")
  if (stored) {
    return stored
  }

  const computed = window.getComputedStyle(row).display
  const original = computed && computed !== "none" ? computed : ""
  row.dataset.minddockOriginalDisplay = original
  return original
}

export function formatTitleList(titles: string[]): string {
  if (titles.length === 0) {
    return "unknown sources"
  }
  if (titles.length <= 3) {
    return titles.join(", ")
  }
  return `${titles.slice(0, 3).join(", ")} and +${titles.length - 3}`
}

export function extractUrlFromSnippets(snippets: string[]): string | undefined {
  const joined = snippets.join("\n")
  const match = joined.match(/https?:\/\/[^\s)\]}>"']+/i)
  return match?.[0]
}

// ─── Focus Threads Injection Point ───────────────────────────────────────────

/**
 * Encontra o container do header da seção "Conversa" no NotebookLM.
 * Retorna o elemento que fica entre o label "Conversa" e os ícones de ação.
 * Usa múltiplos seletores + fallback por texto para máxima robustez.
 */
export function resolveConversationHeaderHost(): HTMLElement | null {
  // Tenta seletores específicos do NotebookLM (nomes de componentes Angular)
  const bySelector = queryDeepFirstVisible<HTMLElement>([
    "chat-panel-v2 .panel-title-row",
    "chat-panel .panel-title-row",
    "[data-testid='conversation-header']",
    "chat-panel-v2 header",
    "chat-panel header",
    "div.conversation-header",
    "chat-panel-v2 > div:first-child",
    "chat-panel > div:first-child",
  ])
  if (bySelector) return bySelector

  // Fallback: procura o elemento visível com texto "Conversa" próximo ao topo
  for (const root of getDeepRoots()) {
    const candidates = Array.from(
      "querySelectorAll" in root
        ? (root as Document | ShadowRoot).querySelectorAll<HTMLElement>("div, header, section")
        : []
    )
    for (const el of candidates) {
      if (!isVisible(el)) continue
      const rect = el.getBoundingClientRect()
      if (rect.top > 120) continue // deve estar na parte superior da tela
      if (rect.height > 80) continue // header deve ser compacto
      const text = el.textContent?.trim() ?? ""
      if (text === "Conversa" || text.startsWith("Conversa")) {
        return el.parentElement ?? el
      }
    }
  }

  return null
}

/**
 * Captura as mensagens visíveis no chat do NotebookLM.
 * Retorna array de {role, content} para salvar na thread ativa.
 */
export function captureVisibleMessages(): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = []

  // Mensagens do assistente
  const assistantNodes = queryDeepAll<HTMLElement>([
    "[data-testid='response-text']",
    "[data-testid='chat-message-assistant']",
    ".response-container .message-content",
  ])
  for (const node of assistantNodes) {
    const content = node.textContent?.trim()
    if (content && content.length > 0) {
      messages.push({ role: "assistant", content })
    }
  }

  // Mensagens do usuário
  const userNodes = queryDeepAll<HTMLElement>([
    "[data-testid='user-query']",
    "[data-testid='chat-message-user']",
    "[data-testid='query-text']",
    ".user-query-text",
    ".query-container .query-text",
  ])
  for (const node of userNodes) {
    const content = node.textContent?.trim()
    if (content && content.length > 0) {
      messages.push({ role: "user", content })
    }
  }

  return messages
}

function resolveConversationLabel(): HTMLElement | null {
  const labels = ["Conversa", "Conversation", "Chat"]

  for (const root of getDeepRoots()) {
    const candidates = Array.from(
      "querySelectorAll" in root
        ? (root as Document | ShadowRoot).querySelectorAll<HTMLElement>(
            "span, div, h2, h3, button, a, [role='tab']"
          )
        : []
    )

    for (const element of candidates) {
      if (!isVisible(element)) continue

      const text = String(element.textContent ?? "").trim()
      if (!labels.some((label) => text === label)) continue

      const rect = element.getBoundingClientRect()
      if (rect.top > 140 || rect.height > 80) continue

      return element
    }
  }

  return null
}

function clickElement(element: HTMLElement): boolean {
  element.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      view: window
    })
  )
  element.dispatchEvent(
    new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      view: window
    })
  )
  element.click()
  return true
}

function isMindDockInjectedElement(element: HTMLElement): boolean {
  return !!element.closest(
    "#minddock-focus-threads-root, #minddock-agile-bar-root, #minddock-source-actions-root, #minddock-source-filters-root"
  )
}

function isLikelyNativeConversationTrigger(
  candidate: HTMLElement,
  labelRect?: DOMRect
): boolean {
  if (!isVisible(candidate) || isMindDockInjectedElement(candidate)) {
    return false
  }

  const text = String(candidate.textContent ?? "").trim()
  const aria = String(candidate.getAttribute("aria-label") ?? candidate.getAttribute("title") ?? "")
    .trim()
    .toLowerCase()
  const rect = candidate.getBoundingClientRect()

  if (
    text === "+" ||
    aria.includes("new conversation") ||
    aria.includes("new chat") ||
    aria.includes("nova conversa") ||
    aria.includes("novo chat")
  ) {
    return true
  }

  if (!labelRect) {
    return false
  }

  const isCompact = rect.width <= 32 && rect.height <= 32
  const isRightNextToLabel =
    rect.left >= labelRect.right - 6 &&
    rect.left <= labelRect.right + 44 &&
    Math.abs(rect.top - labelRect.top) <= 16

  return isCompact && isRightNextToLabel
}

export function triggerNotebookNewConversation(): boolean {
  const label = resolveConversationLabel()
  const labelRect = label?.getBoundingClientRect()
  const headerHost = resolveConversationHeaderHost()

  if (headerHost) {
    const directCandidates = Array.from(
      headerHost.querySelectorAll<HTMLElement>("button, [role='button'], a, span, div")
    )

    for (const candidate of directCandidates) {
      if (isLikelyNativeConversationTrigger(candidate, labelRect)) {
        return clickElement(candidate)
      }
    }
  }

  if (!label) {
    return false
  }

  const row = label.parentElement ?? label
  const siblingCandidates = Array.from(
    row.querySelectorAll<HTMLElement>("button, [role='button'], a, span")
  )

  for (const candidate of siblingCandidates) {
    if (candidate === label) continue

    if (isLikelyNativeConversationTrigger(candidate, labelRect)) {
      return clickElement(candidate)
    }
  }

  const rowRect = row.getBoundingClientRect()
  const nearbyInteractive = queryDeepAll<HTMLElement>(["button", "[role='button']", "a", "span", "div"]).filter(
    (candidate) => {
      if (!isLikelyNativeConversationTrigger(candidate, labelRect)) return false
      const rect = candidate.getBoundingClientRect()
      if (Math.abs(rect.top - rowRect.top) > 28) return false
      if (rect.left < rowRect.right - 8 || rect.left > rowRect.right + 80) return false
      return true
    }
  )

  if (nearbyInteractive[0]) {
    return clickElement(nearbyInteractive[0])
  }

  return false
}
