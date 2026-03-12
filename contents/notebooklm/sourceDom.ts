export const SOURCE_PANEL_TOGGLE_EVENT = "minddock:source-panel:toggle"
export const SOURCE_PANEL_RESET_EVENT = "minddock:source-panel:reset"
export const SOURCE_PANEL_EXPORT_EVENT = "minddock:source-panel:export"
export const SOURCE_PANEL_REFRESH_EVENT = "minddock:source-panel:refresh"
export const SOURCE_PANEL_SAVED_GROUPS_EVENT = "minddock:source-panel:saved-groups"
export const SOURCE_PANEL_SAVED_GROUPS_UPDATED_EVENT = "minddock:source-panel:saved-groups:updated"
export const SOURCE_FILTER_APPLY_START_EVENT = "minddock:source-filters:apply-start"
export const SOURCE_FILTER_APPLY_END_EVENT = "minddock:source-filters:apply-end"
export const SOURCE_DOWNLOAD_MODAL_STATE_EVENT = "minddock:source-download:modal-state"

export type SourceFilterType = "All" | "PDFs" | "GDocs" | "Web" | "Text" | "YouTube"

export interface SourcePanelRefreshCandidate {
  title: string
  docReference?: string
  sourceUrl?: string
  sourceId?: string
}

export interface SourcePanelRefreshDetail {
  gdocSources?: SourcePanelRefreshCandidate[]
}

export interface SourcePanelSavedGroupsDetail {
  open?: boolean
  action?: "open-menu" | "request-save" | "apply-group"
  groupId?: string
}

declare global {
  interface Window {
    __minddockSourceDebug?: {
      timestamp: string
      panelRootsCount: number
      rootsCount: number
      checkboxCandidates: number
      selectorCandidates: number
      linkCandidates: number
      resolvedFromCheckbox: number
      resolvedFromSelectors: number
      resolvedFromLinks: number
      finalRows: number
      droppedReasons: Record<string, number>
      sampleRows: Array<{
        title: string
        url: string
        type: SourceFilterType
        width: number
        height: number
        checkboxCount: number
        textPreview: string
      }>
    }
  }
}

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
const ROW_BY_CHECKBOX_SELECTORS = [
  "[data-testid='source-list-item']",
  "[data-testid*='source-item']",
  "[role='listitem']",
  "li",
  "[class*='source'][class*='item']"
] as const

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
  return !!element.closest(
    "#minddock-source-actions-root, #minddock-source-filters-root, #minddock-conversation-export-root"
  )
}

function normalize(text: string): string {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function bumpReason(debug: { droppedReasons: Record<string, number> }, key: string): void {
  debug.droppedReasons[key] = (debug.droppedReasons[key] ?? 0) + 1
}

function extractFirstUrlFromText(input: string): string {
  const match = String(input ?? "").match(/https?:\/\/[^\s)\]}>"']+/i)
  return String(match?.[0] ?? "").trim()
}

function collectSourceSignals(row: HTMLElement): string {
  const parts = new Set<string>()
  const push = (value: unknown) => {
    const normalized = normalize(String(value ?? ""))
    if (normalized) {
      parts.add(normalized)
    }
  }

  push(extractSourceTitle(row))
  push(extractSourceUrl(row))
  push(row.innerText)
  push(row.textContent)
  push(row.getAttribute("aria-label"))
  push(row.getAttribute("title"))
  push(row.getAttribute("data-testid"))

  const selector =
    "img,svg,use,mat-icon,a[href],[src],[aria-label],[title],[alt],[data-testid],[data-icon],[icon-name]"
  const nodes = Array.from(row.querySelectorAll(selector)).slice(0, 64)

  for (const node of nodes) {
    push(node.textContent)
    push(node.getAttribute("aria-label"))
    push(node.getAttribute("title"))
    push(node.getAttribute("alt"))
    push(node.getAttribute("data-testid"))
    push(node.getAttribute("data-icon"))
    push(node.getAttribute("icon-name"))

    if (node instanceof HTMLAnchorElement) {
      push(node.href)
    } else {
      push(node.getAttribute("href"))
    }

    if (node instanceof HTMLImageElement) {
      push(node.src)
    } else {
      push(node.getAttribute("src"))
    }
  }

  return Array.from(parts).join(" ")
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
  const directUrl = extractSourceUrl(row)
  const localText = normalize(
    [row.getAttribute("aria-label"), row.getAttribute("title"), row.getAttribute("data-testid")]
      .filter(Boolean)
      .join(" ")
  )
  const rawUrl = directUrl || extractFirstUrlFromText(`${title} ${localText}`)
  const url = normalize(rawUrl)
  
  // Coleta contexto completo da linha + ancestrais (até 3 níveis)
  const fullSnapshot = collectRowContextSnapshot(row)
  const snapshot = normalize(fullSnapshot)

  // PRIORIDADE 1: GDOC (detecção expandida)
  const gdocIndicators = {
    hasDocsUrl: /docs\.google\.com\/(document|spreadsheets|presentation|forms)/.test(snapshot),
    hasDriveUrl: /drive\.google\.com/.test(snapshot),
    hasVndGoogleApps: /vnd\.google-apps/.test(snapshot),
    hasGDocAttr: /\bgdoc\b|isgdoc|gdocid|data-gdoc-id/.test(snapshot),
    hasGoogleDocText: /google doc|google document|google sheet|google slide|documento google/i.test(snapshot),
    hasDocsInUrl: /docs\.google\.com/.test(directUrl),
    hasDriveInUrl: /drive\.google\.com/.test(directUrl),
    hasDocIcon: row.querySelector('[aria-label*="Google Doc" i], [title*="Google Doc" i], mat-icon[fonticon*="doc" i]') !== null,
    // NOVO: Busca mais agressiva por "docs.google" em qualquer lugar
    hasDocsAnywhere: snapshot.includes("docs.google") || snapshot.includes("drive.google")
  }
  
  const isGDoc = Object.values(gdocIndicators).some(v => v === true)
  
  if (isGDoc) {
    return "GDocs"
  }

  // PRIORIDADE 2: YouTube
  if (/youtube|youtu\.be|youtube\.com/.test(snapshot)) {
    return "YouTube"
  }

  const firstToken = String(snapshot.split(/\s+/)[0] ?? "").trim()
  if (firstToken === "article" || firstToken === "drive_spreadsheet" || firstToken === "drive_presentation") {
    return "GDocs"
  }

  // PRIORIDADE 3: PDF
  if (/\.pdf(\b|$)|\bpdf\b|application\/pdf|adobe acrobat/.test(snapshot)) {
    return "PDFs"
  }

  // PRIORIDADE 4: Web
  if (
    /^https?:\/\//.test(url) ||
    /https?:\/\//.test(snapshot) ||
    /\bweb\b|\bsite\b|\blink\b|\burl\b|globe|public/.test(snapshot)
  ) {
    return "Web"
  }

  // FALLBACK: Text
  return "Text"
}

/**
 * Coleta contexto completo da linha + ancestrais para detecção precisa
 */
function collectRowContextSnapshot(row: HTMLElement): string {
  const parts: string[] = []
  
  // 1. Título e URL da linha
  parts.push(extractSourceTitle(row))
  parts.push(extractSourceUrl(row))
  
  // 2. Busca TODOS os links dentro da linha (não só o primeiro)
  const allLinks = Array.from(row.querySelectorAll("a[href]"))
  allLinks.forEach(link => {
    const href = (link as HTMLAnchorElement).href
    parts.push(href)
    // Adiciona também o texto do link
    parts.push(link.textContent || "")
    parts.push(link.getAttribute("aria-label") || "")
    parts.push(link.getAttribute("title") || "")
  })
  
  // 3. Busca mat-icon (ícones do Material Design usados pelo NotebookLM)
  const matIcons = Array.from(row.querySelectorAll("mat-icon"))
  matIcons.forEach(icon => {
    parts.push(icon.textContent || "")
    parts.push(icon.getAttribute("fonticon") || "")
    parts.push(icon.getAttribute("svgicon") || "")
    parts.push(icon.getAttribute("aria-label") || "")
  })
  
  // 4. Texto e atributos da linha
  parts.push(row.innerText || "")
  parts.push(row.textContent || "")
  parts.push(row.getAttribute("aria-label") || "")
  parts.push(row.getAttribute("title") || "")
  parts.push(row.getAttribute("data-testid") || "")
  parts.push(row.getAttribute("class") || "")
  
  // 5. Todos os atributos data-*
  Array.from(row.attributes).forEach(attr => {
    if (attr.name.startsWith("data-")) {
      parts.push(`${attr.name}=${attr.value}`)
    }
  })
  
  // 6. Imagens dentro da linha
  row.querySelectorAll("img[src]").forEach(img => {
    parts.push((img as HTMLImageElement).src)
    parts.push(img.getAttribute("alt") || "")
  })
  
  // 7. Contexto dos ancestrais (até 4 níveis acima - aumentei de 3 para 4)
  let ancestor = row.parentElement
  let level = 0
  
  while (ancestor && level < 4) {
    // Atributos importantes do ancestral
    parts.push(ancestor.getAttribute("data-testid") || "")
    parts.push(ancestor.getAttribute("class") || "")
    parts.push(ancestor.getAttribute("aria-label") || "")
    
    // Links do ancestral (importante para GDocs que podem ter link no container)
    ancestor.querySelectorAll("a[href]").forEach(link => {
      const href = (link as HTMLAnchorElement).href
      if (href.includes("docs.google.com") || href.includes("drive.google.com")) {
        parts.push(href)
      }
    })
    
    // Atributos data-* do ancestral
    Array.from(ancestor.attributes).forEach(attr => {
      if (attr.name.startsWith("data-")) {
        parts.push(`${attr.name}=${attr.value}`)
      }
    })
    
    ancestor = ancestor.parentElement
    level++
  }
  
  const fullContext = parts.filter(Boolean).join(" ")

  return fullContext
}

export function resolveSourceRows(): HTMLElement[] {
  const rows = new Set<HTMLElement>()
  const FILTER_HIDDEN_ATTR = "minddockFilterHidden"
  const CONTROL_CONTAINER_SELECTORS = [
    "#minddock-source-actions-root",
    "#minddock-source-filters-root",
    "[data-minddock-target]",
    "input[type='search']",
    "input[placeholder*='Search']",
    "input[placeholder*='Fontes']",
    "input[placeholder*='Pesquise']",
    "button[title*='Refresh']",
    "button[title*='Export']",
    "button[title*='Clear']"
  ] as const

  const sourcePanelRoots = queryDeepAll<HTMLElement>(["source-picker", ".source-panel"]).filter((element) =>
    element.isConnected
  )
  const roots: ParentNode[] = getDeepRoots()
  const debug = {
    timestamp: new Date().toISOString(),
    panelRootsCount: sourcePanelRoots.length,
    rootsCount: roots.length,
    checkboxCandidates: 0,
    selectorCandidates: 0,
    linkCandidates: 0,
    resolvedFromCheckbox: 0,
    resolvedFromSelectors: 0,
    resolvedFromLinks: 0,
    finalRows: 0,
    droppedReasons: {} as Record<string, number>,
    sampleRows: [] as Array<{
      title: string
      url: string
      type: SourceFilterType
      width: number
      height: number
      checkboxCount: number
      textPreview: string
    }>
  }

  const queryFromRoots = <T extends Element>(selectors: readonly string[]): T[] => {
    const out: T[] = []
    const seen = new Set<Element>()

    for (const root of roots) {
      for (const element of queryDeepAll<T>(selectors, root)) {
        if (seen.has(element)) {
          continue
        }
        seen.add(element)
        out.push(element)
      }
    }

    return out
  }

  const countCheckboxes = (element: HTMLElement): number =>
    CHECKBOX_SELECTORS.reduce((count, selector) => count + element.querySelectorAll(selector).length, 0)

  const countNestedRowCandidates = (element: HTMLElement): number => {
    let count = 0
    for (const selector of SOURCE_ROW_SELECTORS) {
      try {
        const nested = Array.from(element.querySelectorAll(selector)).filter(
          (candidate) => candidate instanceof HTMLElement && candidate !== element
        )
        count += nested.length
      } catch {
        // ignore selector failure
      }
    }
    return count
  }

  const looksLikeAtomicRow = (element: HTMLElement): boolean => {
    const nestedRows = countNestedRowCandidates(element)
    if (nestedRows > 0) {
      return false
    }

    const checkboxCount = countCheckboxes(element)
    if (checkboxCount > 1) {
      return false
    }

    const textPreview = String(element.innerText || element.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
    if (textPreview.length > 340) {
      return false
    }

    return true
  }

  const isControlContainer = (element: HTMLElement): boolean => {
    if (inInjectedTree(element)) {
      return true
    }

    return CONTROL_CONTAINER_SELECTORS.some((selector) => {
      try {
        return !!element.closest(selector)
      } catch {
        return false
      }
    })
  }

  const hasSourceLikeText = (element: HTMLElement): boolean => {
    const text = normalize(String(element.innerText || element.textContent || ""))
    const title = normalize(extractSourceTitle(element))
    const href = normalize(extractSourceUrl(element))
    const merged = [text, title, href].filter(Boolean).join(" ")

    if (!merged || merged.length < 2) {
      return false
    }

    if (/pesquise|search sources|fonte(s)? de pesquisa|sources search/.test(merged)) {
      return false
    }

    if (/selecionar todas as fontes|select all sources/.test(merged)) {
      return false
    }

    if (/save view|salvar visualizacao|source groups|grupos de fontes|search saved views|visualizacoes da pesquisa/.test(merged)) {
      return false
    }

    return true
  }

  const looksLikeRowShape = (element: HTMLElement): boolean => {
    const rect = element.getBoundingClientRect()
    if (rect.width < 120) {
      return false
    }
    if (rect.height < 12 || rect.height > 420) {
      return false
    }
    return true
  }

  const resolveRowFromCheckbox = (checkbox: HTMLElement): HTMLElement | null => {
    if (isControlContainer(checkbox)) {
      bumpReason(debug, "checkbox:control-container")
      return null
    }

    // Preferred path: nearest source row selectors that contains only this checkbox.
    for (const selector of ROW_BY_CHECKBOX_SELECTORS) {
      const found = checkbox.closest(selector)
      if (!(found instanceof HTMLElement)) {
        bumpReason(debug, "checkbox:not-htmlelement")
        continue
      }
      if (isControlContainer(found)) {
        bumpReason(debug, "checkbox:found-control-container")
        continue
      }
      if (!found.isConnected) {
        bumpReason(debug, "checkbox:found-disconnected")
        continue
      }
      if (countCheckboxes(found) !== 1) {
        bumpReason(debug, "checkbox:found-not-single-checkbox")
        continue
      }
      if (!looksLikeRowShape(found)) {
        bumpReason(debug, "checkbox:found-shape-mismatch")
        continue
      }
      if (!looksLikeAtomicRow(found)) {
        bumpReason(debug, "checkbox:found-not-atomic-row")
        continue
      }
      if (!hasSourceLikeText(found)) {
        bumpReason(debug, "checkbox:found-no-source-text")
        continue
      }
      return found
    }

    // Generic fallback: climb up until parent starts containing multiple checkboxes.
    let current: HTMLElement | null = checkbox
    let depth = 0
    let best: HTMLElement | null = null
    while (current && depth < 12) {
      const parent: HTMLElement | null = current.parentElement
      if (!(parent instanceof HTMLElement)) {
        bumpReason(debug, "checkbox:fallback-no-parent")
        break
      }

      if (isControlContainer(current)) {
        bumpReason(debug, "checkbox:fallback-control-container")
        return null
      }

      if (!current.isConnected) {
        bumpReason(debug, "checkbox:fallback-disconnected")
        current = parent
        depth++
        continue
      }

      const selfCount = countCheckboxes(current)
      const parentCount = countCheckboxes(parent)
      const looksLikeRow = looksLikeRowShape(current)

      if (selfCount === 1 && looksLikeRow && looksLikeAtomicRow(current) && hasSourceLikeText(current)) {
        best = current
      }

      if (best && parentCount > selfCount) {
        return best
      }

      current = parent
      depth++
    }

    return best
  }

  // 1) Primary clean-room strategy: one resolved row per checkbox.
  const checkboxElements = queryFromRoots<HTMLElement>(CHECKBOX_SELECTORS)
  debug.checkboxCandidates = checkboxElements.length
  for (const checkbox of checkboxElements) {
    if (!(checkbox instanceof HTMLElement) || !checkbox.isConnected) {
      bumpReason(debug, "checkbox:candidate-invalid")
      continue
    }

    const row = resolveRowFromCheckbox(checkbox)
    if (row) {
      rows.add(row)
      debug.resolvedFromCheckbox++
    }
  }

  // 2) Fallback to selector-based detection.
  if (rows.size === 0) {
    const selectorRows = queryFromRoots<HTMLElement>(SOURCE_ROW_SELECTORS)
    debug.selectorCandidates = selectorRows.length
    for (const row of selectorRows) {
      if (isControlContainer(row)) {
        bumpReason(debug, "selector:control-container")
        continue
      }
      if (!row.isConnected) {
        bumpReason(debug, "selector:disconnected")
        continue
      }
      if (!looksLikeRowShape(row)) {
        bumpReason(debug, "selector:shape-mismatch")
        continue
      }
      if (!looksLikeAtomicRow(row)) {
        bumpReason(debug, "selector:not-atomic-row")
        continue
      }

      const hasCheckbox = CHECKBOX_SELECTORS.some((selector) => {
        const found = row.querySelector(selector)
        return found instanceof HTMLElement
      })
      if (!hasSourceLikeText(row) || (!hasCheckbox && !extractSourceUrl(row))) {
        bumpReason(debug, "selector:no-source-signals")
        continue
      }

      rows.add(row)
      debug.resolvedFromSelectors++
    }
  }

  // 3) Last fallback: resolve from links inside source picker.
  if (rows.size === 0) {
    const linkCandidates = queryFromRoots<HTMLElement>(["a[href]"])
    debug.linkCandidates = linkCandidates.length
    for (const link of linkCandidates) {
      if (isControlContainer(link)) {
        bumpReason(debug, "link:control-container")
        continue
      }

      let current: HTMLElement | null = link
      let depth = 0
      while (current && depth < 8) {
        if (
          current.isConnected &&
          looksLikeRowShape(current) &&
          looksLikeAtomicRow(current) &&
          hasSourceLikeText(current) &&
          countCheckboxes(current) <= 1
        ) {
          rows.add(current)
          debug.resolvedFromLinks++
          break
        }

        current = current.parentElement
        depth++
      }
    }
  }

  const finalRows = Array.from(rows)
  debug.finalRows = finalRows.length
  debug.sampleRows = finalRows.slice(0, 12).map((row) => {
    const rect = row.getBoundingClientRect()
    const title = extractSourceTitle(row)
    const url = extractSourceUrl(row)
    const textPreview = String(row.innerText || row.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140)

    return {
      title,
      url,
      type: inferSourceType(row),
      width: Number(rect.width.toFixed(1)),
      height: Number(rect.height.toFixed(1)),
      checkboxCount: countCheckboxes(row),
      textPreview
    }
  })

  window.__minddockSourceDebug = debug
  return finalRows
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

export function dispatchSourcePanelRefresh(detail?: SourcePanelRefreshDetail): void {
  window.dispatchEvent(
    new CustomEvent(SOURCE_PANEL_REFRESH_EVENT, {
      detail
    })
  )
}

export function dispatchSourcePanelSavedGroups(detail?: SourcePanelSavedGroupsDetail): void {
  window.dispatchEvent(
    new CustomEvent(SOURCE_PANEL_SAVED_GROUPS_EVENT, {
      detail
    })
  )
}

export function dispatchSourcePanelSavedGroupsUpdated(): void {
  window.dispatchEvent(
    new CustomEvent(SOURCE_PANEL_SAVED_GROUPS_UPDATED_EVENT, {
      detail: { timestamp: Date.now() }
    })
  )
}

export function dispatchSourceFilterApplyStart(): void {
  window.dispatchEvent(
    new CustomEvent(SOURCE_FILTER_APPLY_START_EVENT, {
      detail: { timestamp: Date.now() }
    })
  )
}

export function dispatchSourceFilterApplyEnd(): void {
  window.dispatchEvent(
    new CustomEvent(SOURCE_FILTER_APPLY_END_EVENT, {
      detail: { timestamp: Date.now() }
    })
  )
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
 * Resolve o container de ações no header da conversa para acoplar ações extras.
 * Prioriza o bloco à direita (onde ficam os botões nativos de configurações/menu).
 */
export function resolveConversationActionsHost(): HTMLElement | null {
  const bySelector = queryDeepFirstVisible<HTMLElement>([
    "chat-panel-v2 .panel-title-row > div:last-child",
    "chat-panel .panel-title-row > div:last-child",
    "[data-testid='conversation-header'] > div:last-child",
    "div.conversation-header > div:last-child"
  ])

  if (isViableConversationActionsHost(bySelector)) {
    return bySelector
  }

  const headerHost = resolveConversationHeaderHost()
  if (!(headerHost instanceof HTMLElement) || !isVisible(headerHost)) {
    return null
  }

  const headerRect = headerHost.getBoundingClientRect()
  const candidates = [
    headerHost,
    ...Array.from(headerHost.querySelectorAll<HTMLElement>("div, section, span"))
  ].filter((candidate) => isViableConversationActionsHost(candidate))

  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scoreConversationActionsHost(candidate, headerRect)
    }))
    .sort((left, right) => right.score - left.score)

  return scored[0]?.candidate ?? null
}

/**
 * Resolve o botão nativo "Configurar notebook" (ou equivalentes por idioma).
 * Esse botão é usado como âncora para inserir ações customizadas no topo do chat.
 */
export function resolveNotebookConfigureButton(): HTMLElement | null {
  const bySelector = queryDeepFirstVisible<HTMLElement>([
    "button[aria-label*='Configurar notebook' i]",
    "button[title*='Configurar notebook' i]",
    "button[aria-label*='Configurações do notebook' i]",
    "button[title*='Configurações do notebook' i]",
    "button[aria-label*='Configure notebook' i]",
    "button[title*='Configure notebook' i]",
    "button[aria-label*='Notebook settings' i]",
    "button[title*='Notebook settings' i]"
  ])

  if (bySelector && isVisible(bySelector)) {
    const rect = bySelector.getBoundingClientRect()
    if (rect.top <= 180) {
      return bySelector
    }
  }

  // Fallback semântico: procura botões no topo direito com label de configuração.
  const candidates = queryDeepAll<HTMLElement>(["button", "[role='button']"]).filter((candidate) => {
    if (!isVisible(candidate)) {
      return false
    }
    const rect = candidate.getBoundingClientRect()
    if (rect.top > 180 || rect.left < window.innerWidth * 0.45) {
      return false
    }

    const label = String(
      candidate.getAttribute("aria-label") ??
        candidate.getAttribute("title") ??
        candidate.textContent ??
        ""
    )
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()

    if (!label) {
      return false
    }

    return (
      label.includes("configurar notebook") ||
      label.includes("configuracoes do notebook") ||
      label.includes("configure notebook") ||
      label.includes("notebook settings")
    )
  })

  return candidates[0] ?? null
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

function isViableConversationActionsHost(candidate: HTMLElement | null | undefined): candidate is HTMLElement {
  if (!(candidate instanceof HTMLElement) || !isVisible(candidate)) {
    return false
  }

  if (candidate.id === "minddock-conversation-export-root" || candidate.hasAttribute("data-minddock-target")) {
    return false
  }

  const rect = candidate.getBoundingClientRect()
  if (rect.top > 180 || rect.height < 18 || rect.height > 120) {
    return false
  }

  const interactiveCount = resolveVisibleInteractiveCount(candidate)
  if (interactiveCount === 0) {
    return false
  }

  return true
}

function resolveVisibleInteractiveCount(element: HTMLElement): number {
  const controls = Array.from(
    element.querySelectorAll<HTMLElement>("button, [role='button'], a[role='button'], a[aria-label], span[role='button']")
  )
  const selfIsControl =
    element.matches("button, [role='button'], a[role='button'], a[aria-label], span[role='button']") && isVisible(element)

  let count = selfIsControl ? 1 : 0
  for (const control of controls) {
    if (!isVisible(control)) {
      continue
    }
    if (control.closest("#minddock-conversation-export-root")) {
      continue
    }
    count += 1
  }

  return count
}

function scoreConversationActionsHost(candidate: HTMLElement, headerRect: DOMRect): number {
  const rect = candidate.getBoundingClientRect()
  const controls = resolveVisibleInteractiveCount(candidate)
  const rightPreference = rect.left > headerRect.left + headerRect.width * 0.4 ? 220 : 0
  const compactPreference = Math.max(0, 120 - Math.abs(rect.height - 34) * 6)
  return controls * 120 + rightPreference + compactPreference + rect.left * 0.14
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

function activateElementForInlineEdit(element: HTMLElement): boolean {
  clickElement(element)

  element.dispatchEvent(
    new MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
      view: window
    })
  )

  return true
}

function isMindDockInjectedElement(element: HTMLElement): boolean {
  return !!element.closest(
    "#minddock-focus-threads-root, #minddock-agile-bar-root, #minddock-source-actions-root, #minddock-source-filters-root, #minddock-conversation-export-root"
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

const NOTEBOOK_CREATE_ACTION_SELECTORS = [
  "button",
  "[role='button']",
  "a",
  "span[role='button']",
  "div[role='button']"
] as const

const NOTEBOOK_CREATE_INPUT_SELECTORS = [
  "[role='dialog'] input[type='text']",
  "[role='dialog'] input:not([type])",
  "[role='dialog'] textarea",
  "[role='dialog'] [contenteditable='true']",
  "dialog input[type='text']",
  "dialog input:not([type])",
  "dialog textarea",
  "dialog [contenteditable='true']",
  "input[placeholder*='name' i]",
  "input[placeholder*='nome' i]",
  "input[aria-label*='name' i]",
  "input[aria-label*='nome' i]",
  "textarea[aria-label*='name' i]",
  "textarea[aria-label*='nome' i]"
] as const

const NOTEBOOK_TITLE_EDITABLE_SELECTORS = [
  "input[aria-label='Notebook title']",
  "textarea[aria-label='Notebook title']",
  "input[aria-label*='title' i]",
  "input[placeholder*='title' i]",
  "input[aria-label*='titulo' i]",
  "input[placeholder*='titulo' i]",
  "input[aria-label*='notebook' i]",
  "input[aria-label*='caderno' i]",
  "textarea[aria-label*='title' i]",
  "textarea[placeholder*='title' i]",
  "textarea[aria-label*='titulo' i]",
  "textarea[placeholder*='titulo' i]",
  "[contenteditable='true'][aria-label*='title' i]",
  "[contenteditable='true'][aria-label*='titulo' i]",
  "[contenteditable='true'][aria-label*='notebook' i]",
  "[contenteditable='true'][aria-label*='caderno' i]",
  "[contenteditable='true'][role='textbox']"
] as const

const NOTEBOOK_TITLE_DISPLAY_SELECTORS = [
  "[role='heading']",
  "[data-testid*='title']",
  "h1",
  "h2",
  "h3",
  "button",
  "[role='button']",
  "span"
] as const

const UNTITLED_NOTEBOOK_LABELS = [
  "untitled notebook",
  "untitled",
  "caderno sem titulo",
  "sem titulo"
] as const

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs)
  })
}

async function waitForValue<T>(
  resolveValue: () => T | null,
  timeoutMs: number,
  pollIntervalMs = 150
): Promise<T | null> {
  const timeoutAt = Date.now() + timeoutMs

  while (Date.now() < timeoutAt) {
    const currentValue = resolveValue()
    if (currentValue !== null) {
      return currentValue
    }

    await wait(pollIntervalMs)
  }

  return null
}

function resolveActionCandidates(root?: ParentNode): HTMLElement[] {
  if (root && "querySelectorAll" in root) {
    const localResults: HTMLElement[] = []
    const seen = new Set<HTMLElement>()

    for (const selector of NOTEBOOK_CREATE_ACTION_SELECTORS) {
      for (const element of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
        if (!(element instanceof HTMLElement) || seen.has(element) || !isVisible(element)) {
          continue
        }

        seen.add(element)
        localResults.push(element)
      }
    }

    return localResults
  }

  return queryDeepAll<HTMLElement>(NOTEBOOK_CREATE_ACTION_SELECTORS).filter((candidate) =>
    isVisible(candidate)
  )
}

function getNotebookActionLabel(candidate: HTMLElement): string {
  const textParts = [
    candidate.innerText,
    candidate.textContent,
    candidate.getAttribute("aria-label"),
    candidate.getAttribute("title"),
    candidate.getAttribute("placeholder"),
    candidate.getAttribute("data-testid")
  ]

  return normalize(
    textParts
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .join(" ")
  )
}

function scoreCreateTriggerCandidate(candidate: HTMLElement): number {
  const label = getNotebookActionLabel(candidate)
  if (!label) {
    return -1
  }

  const rect = candidate.getBoundingClientRect()
  let score = -1

  const strongLabels = [
    "create new notebook",
    "new notebook",
    "create notebook",
    "novo caderno",
    "novo notebook",
    "criar caderno",
    "criar notebook"
  ]

  for (const candidateLabel of strongLabels) {
    if (label.includes(candidateLabel)) {
      score = Math.max(score, 220 - candidateLabel.length)
    }
  }

  if (label.includes("create new")) {
    score = Math.max(score, 180)
  }

  if (label === "create" || label === "criar") {
    score = Math.max(score, 120)
  }

  if (label.includes("create") || label.includes("criar")) {
    score = Math.max(score, 90)
  }

  if (
    label.includes("cancel") ||
    label.includes("cancelar") ||
    label.includes("delete") ||
    label.includes("apagar")
  ) {
    score -= 200
  }

  if (score < 0) {
    return -1
  }

  if (candidate.tagName === "BUTTON") {
    score += 8
  }

  if (rect.top <= window.innerHeight * 0.8) {
    score += 6
  }

  if (rect.width >= 72) {
    score += 4
  }

  if (candidate.closest("[role='dialog'], dialog, [aria-modal='true']")) {
    score -= 12
  }

  return score
}

function scoreCreateConfirmCandidate(candidate: HTMLElement): number {
  const label = getNotebookActionLabel(candidate)
  if (!label) {
    return -1
  }

  let score = -1

  const confirmLabels = ["create", "criar", "confirm", "confirmar", "continue", "continuar", "ok"]
  for (const confirmLabel of confirmLabels) {
    if (label === confirmLabel) {
      score = Math.max(score, 220 - confirmLabel.length)
    } else if (label.includes(confirmLabel)) {
      score = Math.max(score, 180 - confirmLabel.length)
    }
  }

  if (
    label.includes("cancel") ||
    label.includes("cancelar") ||
    label.includes("back") ||
    label.includes("voltar")
  ) {
    score -= 200
  }

  if (score < 0) {
    return -1
  }

  if (candidate.closest("[role='dialog'], dialog, [aria-modal='true']")) {
    score += 14
  }

  if (candidate.tagName === "BUTTON") {
    score += 6
  }

  return score
}

function resolveCreateTrigger(): HTMLElement | null {
  let bestCandidate: HTMLElement | null = null
  let bestScore = -1

  for (const candidate of resolveActionCandidates()) {
    const score = scoreCreateTriggerCandidate(candidate)
    if (score > bestScore) {
      bestScore = score
      bestCandidate = candidate
    }
  }

  return bestCandidate
}

function resolveNotebookTitleHeader(): HTMLElement | null {
  let bestCandidate: HTMLElement | null = null
  let bestScore = -1

  for (const candidate of queryDeepAll<HTMLElement>(NOTEBOOK_TITLE_DISPLAY_SELECTORS)) {
    if (!isVisible(candidate) || isMindDockInjectedElement(candidate)) {
      continue
    }

    const label = String(candidate.textContent ?? "").trim()
    if (!label) {
      continue
    }

    const rect = candidate.getBoundingClientRect()
    if (rect.top > 220 || rect.height > 120 || rect.width < 80) {
      continue
    }

    let score = 0

    if (candidate.tagName === "H1") {
      score += 72
    } else if (candidate.tagName === "H2") {
      score += 58
    } else if (candidate.getAttribute("role") === "heading") {
      score += 46
    } else if (candidate.tagName === "H3") {
      score += 34
    } else {
      score += 12
    }

    if (rect.top <= 120) {
      score += 24
    } else {
      score += Math.max(0, 220 - Math.round(rect.top))
    }

    if (UNTITLED_NOTEBOOK_LABELS.includes(normalize(label) as (typeof UNTITLED_NOTEBOOK_LABELS)[number])) {
      score += 18
    }

    if (score > bestScore) {
      bestScore = score
      bestCandidate = candidate
    }
  }

  return bestCandidate
}

function resolveNotebookTitleEditor(): HTMLElement | null {
  const exactEditor = queryDeepFirstVisible<HTMLElement>([
    "input[aria-label='Notebook title']",
    "textarea[aria-label='Notebook title']"
  ])

  if (exactEditor) {
    return exactEditor
  }

  return resolveNotebookTitleEditableField()
}

function readVisibleNotebookTitleText(): string {
  const header = resolveNotebookTitleHeader()
  if (header) {
    return String(header.textContent ?? "").trim()
  }

  const editor = resolveNotebookTitleEditor()
  if (editor) {
    return readNotebookTitleValue(editor)
  }

  return ""
}

function applyNotebookTitleValue(candidate: HTMLElement, notebookName: string): void {
  if (candidate instanceof HTMLInputElement) {
    candidate.focus()
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
    if (setter) {
      setter.call(candidate, notebookName)
    } else {
      candidate.value = notebookName
    }

    candidate.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }))
    candidate.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }))
    return
  }

  if (candidate instanceof HTMLTextAreaElement) {
    candidate.focus()
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set
    if (setter) {
      setter.call(candidate, notebookName)
    } else {
      candidate.value = notebookName
    }

    candidate.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }))
    candidate.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }))
    return
  }

  if (candidate.isContentEditable) {
    candidate.focus()
    candidate.textContent = notebookName
    candidate.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        data: notebookName,
        inputType: "insertText"
      })
    )
    candidate.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }))
  }
}

function resolveCreateConfirmTrigger(root?: ParentNode): HTMLElement | null {
  let bestCandidate: HTMLElement | null = null
  let bestScore = -1

  for (const candidate of resolveActionCandidates(root)) {
    const score = scoreCreateConfirmCandidate(candidate)
    if (score > bestScore) {
      bestScore = score
      bestCandidate = candidate
    }
  }

  return bestCandidate
}

function resolveDialogRoot(candidate: HTMLElement): ParentNode | null {
  return candidate.closest("[role='dialog'], dialog, [aria-modal='true']")
}

function resolveNotebookNameInput(): HTMLElement | null {
  const candidates = queryDeepAll<HTMLElement>(NOTEBOOK_CREATE_INPUT_SELECTORS).filter((candidate) =>
    isVisible(candidate)
  )

  let bestCandidate: HTMLElement | null = null
  let bestScore = -1

  for (const candidate of candidates) {
    const label = getNotebookActionLabel(candidate)
    const rect = candidate.getBoundingClientRect()
    let score = 0

    if (resolveDialogRoot(candidate)) {
      score += 28
    }

    if (label.includes("name") || label.includes("nome")) {
      score += 22
    }

    if (candidate instanceof HTMLInputElement || candidate instanceof HTMLTextAreaElement) {
      score += 8
    }

    if (candidate.isContentEditable) {
      score += 4
    }

    if (rect.top <= window.innerHeight * 0.75) {
      score += 6
    }

    if (rect.height <= 72) {
      score += 4
    }

    if (score > bestScore) {
      bestScore = score
      bestCandidate = candidate
    }
  }

  return bestCandidate
}

function describeEditableField(candidate: HTMLElement): string {
  if (candidate instanceof HTMLInputElement || candidate instanceof HTMLTextAreaElement) {
    return [
      candidate.value,
      candidate.getAttribute("aria-label"),
      candidate.getAttribute("placeholder"),
      candidate.getAttribute("title")
    ]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .join(" ")
  }

  return [
    candidate.textContent,
    candidate.getAttribute("aria-label"),
    candidate.getAttribute("placeholder"),
    candidate.getAttribute("title")
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ")
}

function readNotebookTitleValue(candidate: HTMLElement): string {
  if (candidate instanceof HTMLInputElement || candidate instanceof HTMLTextAreaElement) {
    return String(candidate.value ?? "").trim()
  }

  return String(candidate.textContent ?? "").trim()
}

function scoreNotebookTitleEditableCandidate(candidate: HTMLElement): number {
  if (!isVisible(candidate)) {
    return -1
  }

  const rect = candidate.getBoundingClientRect()
  if (rect.top > Math.max(240, window.innerHeight * 0.45)) {
    return -1
  }

  let score = 0
  const label = normalize(describeEditableField(candidate))

  if (label.includes("title") || label.includes("titulo")) {
    score += 28
  }

  if (label.includes("notebook") || label.includes("caderno")) {
    score += 18
  }

  if (UNTITLED_NOTEBOOK_LABELS.some((untitledLabel) => label.includes(untitledLabel))) {
    score += 36
  }

  if (candidate instanceof HTMLInputElement || candidate instanceof HTMLTextAreaElement) {
    score += 10
  }

  if (candidate.isContentEditable) {
    score += 6
  }

  if (rect.top <= 180) {
    score += 18
  } else if (rect.top <= 240) {
    score += 8
  }

  if (rect.width >= 160) {
    score += 6
  }

  if (rect.height <= 88) {
    score += 4
  }

  return score
}

function resolveNotebookTitleEditableField(): HTMLElement | null {
  let bestCandidate: HTMLElement | null = null
  let bestScore = -1

  for (const candidate of queryDeepAll<HTMLElement>(NOTEBOOK_TITLE_EDITABLE_SELECTORS)) {
    const score = scoreNotebookTitleEditableCandidate(candidate)
    if (score > bestScore) {
      bestScore = score
      bestCandidate = candidate
    }
  }

  return bestCandidate
}

function scoreNotebookTitleDisplayCandidate(candidate: HTMLElement): number {
  if (!isVisible(candidate)) {
    return -1
  }

  const rect = candidate.getBoundingClientRect()
  if (rect.top > 220 || rect.height > 96) {
    return -1
  }

  const label = normalize(
    [
      candidate.textContent,
      candidate.getAttribute("aria-label"),
      candidate.getAttribute("title")
    ]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .join(" ")
  )

  if (!label) {
    return -1
  }

  let score = -1
  if (UNTITLED_NOTEBOOK_LABELS.some((untitledLabel) => label.includes(untitledLabel))) {
    score = 40
  }

  if (label.includes("title") || label.includes("titulo")) {
    score = Math.max(score, 18)
  }

  if (label.includes("notebook") || label.includes("caderno")) {
    score = Math.max(score, 12)
  }

  if (score < 0) {
    return -1
  }

  if (candidate.tagName === "H1" || candidate.tagName === "H2") {
    score += 10
  }

  if (rect.top <= 140) {
    score += 8
  }

  return score
}

function resolveNotebookTitleDisplayCandidate(): HTMLElement | null {
  let bestCandidate: HTMLElement | null = null
  let bestScore = -1

  for (const candidate of queryDeepAll<HTMLElement>(NOTEBOOK_TITLE_DISPLAY_SELECTORS)) {
    const score = scoreNotebookTitleDisplayCandidate(candidate)
    if (score > bestScore) {
      bestScore = score
      bestCandidate = candidate
    }
  }

  return bestCandidate
}

function setFieldValue(input: HTMLInputElement | HTMLTextAreaElement, nextValue: string): void {
  const prototype =
    input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value")

  if (descriptor?.set) {
    descriptor.set.call(input, nextValue)
  } else {
    input.value = nextValue
  }

  input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }))
  input.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }))
}

function fillNotebookNameInput(candidate: HTMLElement, notebookName: string): void {
  if (candidate instanceof HTMLInputElement || candidate instanceof HTMLTextAreaElement) {
    candidate.focus()
    setFieldValue(candidate, notebookName)
    return
  }

  if (candidate.isContentEditable) {
    candidate.focus()
    candidate.textContent = notebookName
    candidate.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        data: notebookName,
        inputType: "insertText"
      })
    )
    candidate.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }))
  }
}

function submitNotebookNameInput(candidate: HTMLElement): void {
  if (candidate instanceof HTMLInputElement && candidate.form) {
    candidate.form.requestSubmit()
    return
  }

  for (const eventName of ["keydown", "keypress", "keyup"] as const) {
    candidate.dispatchEvent(
      new KeyboardEvent(eventName, {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        code: "Enter"
      })
    )
  }
}

export async function startNotebookCreationViaDom(notebookName: string): Promise<void> {
  void notebookName
  throw new Error("O fluxo legado de criacao via DOM foi desativado.")
}

export async function ensureNotebookTitleViaDom(notebookName: string): Promise<boolean> {
  void notebookName
  return false
}

export async function readCurrentNotebookTitleViaDom(
  fallbackTitle = "Untitled notebook"
): Promise<string> {
  const visibleTitle = await waitForValue(() => {
    const title = String(readVisibleNotebookTitleText() ?? "").trim()
    return title || null
  }, 1200, 120)

  return String(visibleTitle ?? "").trim() || String(fallbackTitle ?? "").trim() || "Untitled notebook"
}

export async function waitForCreatedNotebookId(
  previousNotebookId: string | null,
  timeoutMs = 15000
): Promise<string | null> {
  const baselineNotebookId = String(previousNotebookId ?? "").trim()

  return waitForValue(() => {
    const nextNotebookId = resolveNotebookIdFromRoute()
    if (!nextNotebookId) {
      return null
    }

    if (baselineNotebookId && nextNotebookId === baselineNotebookId) {
      return null
    }

    return nextNotebookId
  }, timeoutMs, 200)
}
