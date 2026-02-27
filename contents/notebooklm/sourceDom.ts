export const SOURCE_PANEL_TOGGLE_EVENT = "minddock:source-panel:toggle"
export const SOURCE_PANEL_RESET_EVENT = "minddock:source-panel:reset"

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

export function clearNativeSourceSearchInputs(): void {
  const searchSelectors = [
    "source-picker input[type='text']",
    "source-picker input[placeholder*='Pesquise']",
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
    return "fontes desconhecidas"
  }
  if (titles.length <= 3) {
    return titles.join(", ")
  }
  return `${titles.slice(0, 3).join(", ")} e +${titles.length - 3}`
}

export function extractUrlFromSnippets(snippets: string[]): string | undefined {
  const joined = snippets.join("\n")
  const match = joined.match(/https?:\/\/[^\s)\]}>"']+/i)
  return match?.[0]
}
