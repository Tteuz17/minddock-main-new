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
    __minddockConversationCaptureDebug?: {
      mode: "pairs" | "primary" | "loose" | "aggregate" | "main" | "empty"
      count: number
      sample: string[]
      at: string
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
      try {
        for (const element of Array.from(currentRoot.querySelectorAll(selector))) {
          if (seen.has(element)) {
            continue
          }
          seen.add(element)
          result.push(element as T)
        }
      } catch (error) {
        console.warn("[MindDock] Seletor invalido ignorado", { selector, error })
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
    "#minddock-source-actions-root, #minddock-source-filters-root, #minddock-conversation-export-root, #minddock-studio-export-root"
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

    if (/save view|salvar visualizacao|salvar grupo|source groups|grupos de fontes|search saved views|visualizacoes da pesquisa/.test(merged)) {
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

export function isStudioExportModalOpen(): boolean {
  const shadowHost = document.querySelector<HTMLElement>('[data-minddock-shadow-host="studio-export-modal"]')
  const shadowRoot = shadowHost?.shadowRoot
  if (shadowRoot?.querySelector('[data-minddock-studio-export-overlay="true"]')) {
    return true
  }

  return Boolean(
    document.querySelector('[data-minddock-host="studio-export-modal"] [data-minddock-studio-export-overlay="true"]')
  )
}

export function dispatchSourcePanelExport(): void {
  if (isStudioExportModalOpen()) return
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
interface CapturedVisibleMessageCandidate {
  role: "user" | "assistant"
  content: string
  top: number
}

const MINDDOCK_ROOT_SELECTOR =
  "#minddock-focus-threads-root, #minddock-agile-bar-root, #minddock-source-actions-root, #minddock-source-filters-root"

const TURN_CONTAINER_SELECTORS = [
  "conversational-turn",
  "chat-turn",
  "[data-testid*='conversation-turn']",
  "[data-testid*='chat-turn']"
] as const

const TURN_PAIR_SELECTORS = [
  ".chat-message-pair",
  "[data-testid*='chat-message-pair']",
  "[data-testid*='conversation-turn']",
  "conversational-turn"
] as const

const USER_PAIR_CONTENT_SELECTORS = [
  ".from-user-container .message-text-content",
  "[data-testid='query-text']",
  "[data-testid='user-query']",
  ".query-container .query-text",
  ".user-query-text",
  "user-query"
] as const

const ASSISTANT_PAIR_CONTENT_SELECTORS = [
  ".to-user-container .message-text-content",
  "[data-testid='response-text']",
  "[data-testid='chat-message-assistant'] [data-testid='response-text']",
  ".response-container .message-content",
  ".response-content",
  "model-response"
] as const

const USER_MESSAGE_SELECTORS = [
  "user-query .query-content",
  "user-query .query-text",
  "user-query markdown-renderer",
  "user-query .markdown",
  "user-query",
  "[data-testid='user-query']",
  "[data-testid='query-text']",
  "[data-testid*='query-text']",
  "[data-testid='chat-message-user']",
  "[data-testid*='chat-message-user']",
  "[data-testid='user-message']",
  "[data-testid*='user-message']",
  "[data-role='user']",
  ".user-query-text",
  ".query-container .query-text"
] as const

const ASSISTANT_MESSAGE_SELECTORS = [
  "model-response .model-response-text",
  "model-response .response-content",
  "model-response message-content",
  "model-response markdown-renderer",
  "model-response .markdown",
  "model-response",
  "[data-testid='response-text']",
  "[data-testid*='response-text']",
  "[data-testid='chat-message-assistant']",
  "[data-testid*='chat-message-assistant']",
  "[data-testid='assistant-message']",
  "[data-testid*='assistant-message']",
  "[data-role='assistant']",
  ".response-container .message-content"
] as const

const LOOSE_CONVERSATION_FALLBACK_SELECTORS = [
  "main model-response",
  "main [class*='model-response']",
  "main [data-testid*='response']",
  "main [class*='response']",
  "main [class*='conversation'] [class*='message']",
  "main article",
  "main [class*='markdown']",
  "main [data-testid*='markdown']"
] as const

const CONVERSATION_COMPOSER_SELECTORS = [
  "textarea",
  "div[contenteditable='true'][role='textbox']",
  "div[contenteditable='true']",
  "input[type='text']"
] as const

const CONVERSATION_UI_NOISE_TOKENS = [
  "comece a digitar",
  "start typing",
  "search sources",
  "pesquise novas fontes na web",
  "selecionar todas as fontes",
  "select all sources",
  "source groups",
  "saved views",
  "visualizacoes da pesquisa"
] as const

const CONVERSATION_UI_EXACT_NOISE_LINES = [
  "conversa",
  "conversation",
  "export",
  "copy",
  "share",
  "compartilhar",
  "configuracoes",
  "settings",
  "estudio",
  "studio",
  "resumo",
  "mapa mental",
  "teste"
] as const

function normalizeCapturedMessageText(value: string): string {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function isInMindDockTree(element: HTMLElement): boolean {
  return !!element.closest(MINDDOCK_ROOT_SELECTOR)
}

function isLikelyUiNoiseText(normalizedText: string, rawLength: number): boolean {
  if (!normalizedText) {
    return true
  }

  const isShort = rawLength < 220
  if (isShort && CONVERSATION_UI_NOISE_TOKENS.some((token) => normalizedText.includes(token))) {
    return true
  }

  if (isShort && CONVERSATION_UI_EXACT_NOISE_LINES.includes(normalizedText as (typeof CONVERSATION_UI_EXACT_NOISE_LINES)[number])) {
    return true
  }

  return false
}

function resolveMessageText(node: HTMLElement): string {
  const directText = normalizeCapturedMessageText(node.innerText || node.textContent || "")
  if (directText.length >= 2) {
    return directText
  }

  const nestedTextSelectors = [
    "markdown-renderer",
    ".markdown",
    ".prose",
    ".message-content",
    ".response-content",
    ".query-content",
    ".query-text"
  ] as const

  let best = ""
  for (const selector of nestedTextSelectors) {
    for (const candidate of Array.from(node.querySelectorAll<HTMLElement>(selector))) {
      if (!isVisible(candidate)) continue
      const text = normalizeCapturedMessageText(candidate.innerText || candidate.textContent || "")
      if (text.length > best.length) {
        best = text
      }
    }
  }

  return best
}

function queryFirstVisibleDescendant(root: ParentNode, selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    for (const candidate of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
      if (isVisible(candidate)) {
        return candidate
      }
    }
  }

  return null
}

function collectConversationPairCandidates(): CapturedVisibleMessageCandidate[] {
  const output: CapturedVisibleMessageCandidate[] = []
  const seenPairKeys = new Set<string>()

  for (const pair of queryDeepAll<HTMLElement>(TURN_PAIR_SELECTORS)) {
    if (!(pair instanceof HTMLElement) || !isVisible(pair) || isInMindDockTree(pair)) {
      continue
    }

    if (
      pair.closest(
        "source-picker, .source-panel, #minddock-source-actions-root, #minddock-source-filters-root, [data-testid*='source-list'], [data-testid*='source-panel'], [class*='source-list'], [class*='studio-sidebar']"
      )
    ) {
      continue
    }

    const pairRect = pair.getBoundingClientRect()
    if (pairRect.width < 180 || pairRect.height < 18) {
      continue
    }

    const userNode = queryFirstVisibleDescendant(pair, USER_PAIR_CONTENT_SELECTORS)
    const assistantNode = queryFirstVisibleDescendant(pair, ASSISTANT_PAIR_CONTENT_SELECTORS)

    const userContent = userNode ? resolveMessageText(userNode) : ""
    const assistantContent = assistantNode ? resolveMessageText(assistantNode) : ""

    if (assistantContent.length < 2 && userContent.length < 2) {
      continue
    }

    const pairKey = normalize(`${userContent}\n${assistantContent}`).slice(0, 420)
    if (!pairKey || seenPairKeys.has(pairKey)) {
      continue
    }
    seenPairKeys.add(pairKey)

    const baseTop = pairRect.top
    if (userContent.length >= 2) {
      output.push({
        role: "user",
        content: userContent,
        top: userNode?.getBoundingClientRect().top ?? baseTop
      })
    }

    if (assistantContent.length >= 2) {
      output.push({
        role: "assistant",
        content: assistantContent,
        top: assistantNode?.getBoundingClientRect().top ?? baseTop + 0.1
      })
    }
  }

  return output
}

function collectConversationTurnCandidates(): CapturedVisibleMessageCandidate[] {
  const results: CapturedVisibleMessageCandidate[] = []

  for (const turn of queryDeepAll<HTMLElement>(TURN_CONTAINER_SELECTORS)) {
    if (!isVisible(turn) || isInMindDockTree(turn)) {
      continue
    }

    const userNode =
      turn.matches("user-query") ? turn : queryFirstVisibleDescendant(turn, USER_MESSAGE_SELECTORS)
    const assistantNode =
      turn.matches("model-response")
        ? turn
        : queryFirstVisibleDescendant(turn, ASSISTANT_MESSAGE_SELECTORS)

    if (userNode) {
      const content = resolveMessageText(userNode)
      if (content.length >= 2) {
        results.push({
          role: "user",
          content,
          top: userNode.getBoundingClientRect().top
        })
      }
    }

    if (assistantNode) {
      const content = resolveMessageText(assistantNode)
      if (content.length >= 2) {
        results.push({
          role: "assistant",
          content,
          top: assistantNode.getBoundingClientRect().top
        })
      }
    }
  }

  return results
}

function collectRoleCandidates(
  role: "user" | "assistant",
  selectors: readonly string[]
): CapturedVisibleMessageCandidate[] {
  const results: CapturedVisibleMessageCandidate[] = []
  const seenNodes = new Set<HTMLElement>()

  for (const node of queryDeepAll<HTMLElement>(selectors)) {
    if (seenNodes.has(node)) {
      continue
    }
    seenNodes.add(node)

    if (!isVisible(node) || isInMindDockTree(node)) {
      continue
    }

    const content = resolveMessageText(node)
    if (content.length < 2) {
      continue
    }

    results.push({
      role,
      content,
      top: node.getBoundingClientRect().top
    })
  }

  return results
}

function compactCapturedCandidates(
  input: CapturedVisibleMessageCandidate[]
): Array<{ role: "user" | "assistant"; content: string }> {
  const sorted = [...input].sort((left, right) => left.top - right.top)
  const seen = new Set<string>()
  const output: Array<{ role: "user" | "assistant"; content: string }> = []

  for (const candidate of sorted) {
    const content = normalizeCapturedMessageText(candidate.content)
    if (content.length < 2) {
      continue
    }

    const dedupeKey = `${candidate.role}:${normalize(content).slice(0, 280)}`
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue
    }

    const last = output[output.length - 1]
    if (last && last.role === candidate.role && normalize(last.content) === normalize(content)) {
      continue
    }

    seen.add(dedupeKey)
    output.push({ role: candidate.role, content })
  }

  return output
}

function collectLooseConversationFallbackCandidates(): CapturedVisibleMessageCandidate[] {
  const results: CapturedVisibleMessageCandidate[] = []
  const seenNodes = new Set<HTMLElement>()

  for (const node of queryDeepAll<HTMLElement>(LOOSE_CONVERSATION_FALLBACK_SELECTORS)) {
    if (seenNodes.has(node)) {
      continue
    }
    seenNodes.add(node)

    if (!isVisible(node) || isInMindDockTree(node)) {
      continue
    }

    const rect = node.getBoundingClientRect()
    if (rect.width < 220 || rect.height < 42) {
      continue
    }

    // Ignore elements inside side panels when selectors are too generic.
    if (
      node.closest(
        "source-picker, .source-panel, #minddock-source-actions-root, #minddock-source-filters-root, [data-testid*='source-list'], [data-testid*='source-panel'], [class*='source-list'], [class*='studio-sidebar']"
      )
    ) {
      continue
    }

    const content = resolveMessageText(node)
    if (content.length < 120) {
      continue
    }

    const normalizedContent = normalize(content)
    if (isLikelyUiNoiseText(normalizedContent, content.length)) {
      continue
    }

    results.push({
      role: "assistant",
      content,
      top: rect.top
    })
  }

  return results
}

function resolveConversationContainerFromComposer(): HTMLElement | null {
  const composer = queryDeepFirstVisible<HTMLElement>(CONVERSATION_COMPOSER_SELECTORS)
  if (composer) {
    const anchored =
      composer.closest<HTMLElement>(
        "chat-panel-v2, chat-panel, [data-testid*='conversation'], [class*='conversation-panel'], main, [role='main']"
      ) ?? composer.parentElement

    if (anchored && isVisible(anchored)) {
      return anchored
    }
  }

  return queryDeepFirstVisible<HTMLElement>(["chat-panel-v2", "chat-panel", "main", "[role='main']"])
}

function collectReadableConversationBlocks(container: HTMLElement): string[] {
  const blocks = Array.from(
    container.querySelectorAll<HTMLElement>(
      "model-response, user-query, markdown-renderer, [data-testid*='response'], [data-testid*='query'], p, li, blockquote, pre, article"
    )
  )
  const seen = new Set<string>()
  const records: Array<{ top: number; text: string }> = []

  for (const block of blocks) {
    if (!isVisible(block) || isInMindDockTree(block)) {
      continue
    }

    if (
      block.closest(
        "source-picker, .source-panel, #minddock-source-actions-root, #minddock-source-filters-root, [data-testid*='source-list'], [data-testid*='source-panel'], [class*='source-list'], [class*='studio-sidebar']"
      )
    ) {
      continue
    }

    const rect = block.getBoundingClientRect()
    if (rect.width < 170 || rect.height < 14) {
      continue
    }

    const text = normalizeCapturedMessageText(block.innerText || block.textContent || "")
    if (text.length < 48) {
      continue
    }

    const normalizedText = normalize(text)
    if (isLikelyUiNoiseText(normalizedText, text.length)) {
      continue
    }

    const dedupeKey = normalizedText.slice(0, 220)
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue
    }
    seen.add(dedupeKey)

    records.push({ top: rect.top, text })
  }

  return records
    .sort((left, right) => left.top - right.top)
    .map((record) => record.text)
    .slice(0, 42)
}

function collectIntroFromConversationContainer(beforeTop: number): string {
  if (!Number.isFinite(beforeTop)) {
    return ""
  }

  const container = resolveConversationContainerFromComposer()
  if (!container) {
    return ""
  }

  const composer = queryDeepFirstVisible<HTMLElement>(CONVERSATION_COMPOSER_SELECTORS)
  const composerRect = composer?.getBoundingClientRect() ?? null
  const laneLeft = composerRect ? composerRect.left - 120 : window.innerWidth * 0.28
  const laneRight = composerRect ? composerRect.right + 120 : window.innerWidth * 0.97

  const introSelectors = [
    "h1",
    "h2",
    "h3",
    "h4",
    "[data-testid*='title']",
    "[data-testid*='heading']",
    "[data-testid*='intro']",
    "markdown-renderer",
    "article",
    "p",
    "li",
    "blockquote",
    "pre",
    "section",
    "div[class*='intro']",
    "div[class*='summary']",
    "div[class*='title']",
    "div[class*='heading']",
    "span[class*='intro']",
    "span[class*='title']"
  ] as const

  const records: Array<{ top: number; text: string }> = []
  const seen = new Set<string>()

  for (const candidate of Array.from(container.querySelectorAll<HTMLElement>(introSelectors.join(", ")))) {
    if (!isVisible(candidate) || isInMindDockTree(candidate)) {
      continue
    }

    if (
      candidate.closest(
        "user-query, source-picker, .source-panel, [data-testid*='source-list'], [class*='source-list'], [class*='studio-sidebar'], #minddock-source-actions-root, #minddock-source-filters-root"
      )
    ) {
      continue
    }

    const rect = candidate.getBoundingClientRect()
    if (rect.width < 160 || rect.height < 12) {
      continue
    }

    if (rect.bottom >= beforeTop - 4) {
      continue
    }

    if (rect.right < laneLeft || rect.left > laneRight) {
      continue
    }

    const text = normalizeCapturedMessageText(candidate.innerText || candidate.textContent || "")
    if (text.length < 2) {
      continue
    }

    const tagName = candidate.tagName.toLowerCase()
    if ((tagName === "div" || tagName === "span") && text.length < 24) {
      continue
    }

    const normalizedText = normalize(text)
    if (
      isLikelyUiNoiseText(normalizedText, text.length) ||
      CONVERSATION_UI_EXACT_NOISE_LINES.includes(
        normalizedText as (typeof CONVERSATION_UI_EXACT_NOISE_LINES)[number]
      )
    ) {
      continue
    }

    const dedupeKey = normalizedText.slice(0, 240)
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue
    }

    seen.add(dedupeKey)
    records.push({ top: rect.top, text })
  }

  const intro = normalizeCapturedMessageText(
    records
      .sort((left, right) => left.top - right.top)
      .map((record) => record.text)
      .slice(0, 14)
      .join("\n\n")
  )

  return intro.length >= 18 ? intro : ""
}

function isIntroSourceMetaLine(normalizedText: string): boolean {
  return /^\d+\s*(fonte|fontes|source|sources)\b/.test(normalizedText)
}

function collectIntroFromDeepRoots(beforeTop: number): string {
  if (!Number.isFinite(beforeTop)) {
    return ""
  }

  const composer = queryDeepFirstVisible<HTMLElement>(CONVERSATION_COMPOSER_SELECTORS)
  const composerRect = composer?.getBoundingClientRect() ?? null
  const laneLeft = composerRect ? composerRect.left - 120 : window.innerWidth * 0.22
  const laneRight = composerRect ? composerRect.right + 160 : window.innerWidth * 0.98

  const introSelectors = [
    "h1",
    "h2",
    "h3",
    "h4",
    "[data-testid*='title']",
    "[data-testid*='heading']",
    "[data-testid*='intro']",
    "[data-testid*='summary']",
    "[data-testid*='source']",
    "markdown-renderer",
    "article",
    "p",
    "li",
    "blockquote",
    "pre",
    "section",
    "button",
    "[role='button']",
    "span[class*='title']",
    "div[class*='title']",
    "span[class*='summary']",
    "div[class*='summary']",
    "span[class*='intro']",
    "div[class*='intro']"
  ] as const

  const records: Array<{ top: number; text: string }> = []
  const seen = new Set<string>()

  for (const candidate of queryDeepAll<HTMLElement>(introSelectors)) {
    if (!isVisible(candidate) || isInMindDockTree(candidate)) {
      continue
    }

    if (
      candidate.closest(
        "source-picker, .source-panel, [data-testid*='source-list'], [class*='source-list'], [class*='studio-sidebar'], #minddock-source-actions-root, #minddock-source-filters-root, #minddock-conversation-export-root, #minddock-focus-threads-root"
      )
    ) {
      continue
    }

    const rect = candidate.getBoundingClientRect()
    if (rect.bottom >= beforeTop - 2) {
      continue
    }

    if (rect.right < laneLeft || rect.left > laneRight) {
      continue
    }

    const text = normalizeCapturedMessageText(candidate.innerText || candidate.textContent || "")
    if (!text) {
      continue
    }

    const normalizedText = normalize(text)
    const isMetaLine = isIntroSourceMetaLine(normalizedText)
    if (!isMetaLine && text.length < 18) {
      continue
    }

    if (!isMetaLine && rect.width < 140 && rect.height < 12) {
      continue
    }

    if (
      isLikelyUiNoiseText(normalizedText, text.length) ||
      CONVERSATION_UI_EXACT_NOISE_LINES.includes(
        normalizedText as (typeof CONVERSATION_UI_EXACT_NOISE_LINES)[number]
      )
    ) {
      continue
    }

    const dedupeKey = normalizedText.slice(0, 240)
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue
    }

    seen.add(dedupeKey)
    records.push({ top: rect.top, text })
  }

  const intro = normalizeCapturedMessageText(
    records
      .sort((left, right) => left.top - right.top)
      .map((record) => record.text)
      .slice(0, 36)
      .join("\n\n")
  )

  return intro.length >= 18 ? intro : ""
}

function captureAggregateConversationFallback(): Array<{ role: "user" | "assistant"; content: string }> {
  const container = resolveConversationContainerFromComposer()
  if (!container) {
    return []
  }

  const pieces = collectReadableConversationBlocks(container)
  if (pieces.length === 0) {
    return []
  }

  const content = normalizeCapturedMessageText(pieces.join("\n\n"))
  if (content.length < 140) {
    return []
  }

  return [{ role: "assistant", content }]
}

function sanitizeConversationSnapshotText(rawValue: string): string {
  const lines = String(rawValue ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  const keptLines: string[] = []
  const seen = new Set<string>()

  for (const line of lines) {
    const normalizedLine = normalize(line)
    if (!normalizedLine) {
      continue
    }

    if (isLikelyUiNoiseText(normalizedLine, line.length)) {
      continue
    }

    if (CONVERSATION_UI_EXACT_NOISE_LINES.includes(normalizedLine as (typeof CONVERSATION_UI_EXACT_NOISE_LINES)[number])) {
      continue
    }

    const dedupeKey = normalizedLine.slice(0, 220)
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue
    }
    seen.add(dedupeKey)
    keptLines.push(line)
  }

  return normalizeCapturedMessageText(keptLines.join("\n"))
}

function captureMainConversationSnapshotFallback(): Array<{ role: "user" | "assistant"; content: string }> {
  const mainContainer = queryDeepFirstVisible<HTMLElement>([
    "chat-panel-v2",
    "chat-panel",
    "main",
    "[role='main']"
  ])

  if (!mainContainer) {
    return []
  }

  const rawText = normalizeCapturedMessageText(mainContainer.innerText || mainContainer.textContent || "")
  if (rawText.length < 180) {
    return []
  }

  const sanitized = sanitizeConversationSnapshotText(rawText)
  if (sanitized.length < 180) {
    return []
  }

  return [{ role: "assistant", content: sanitized }]
}

function isMessageContentRedundant(
  candidateContent: string,
  existingMessages: Array<{ role: "user" | "assistant"; content: string }>
): boolean {
  const candidateNormalized = normalize(candidateContent)
  if (!candidateNormalized) {
    return true
  }

  const candidateHead = candidateNormalized.slice(0, 260)

  for (const message of existingMessages) {
    const messageNormalized = normalize(message.content)
    if (!messageNormalized) {
      continue
    }

    if (messageNormalized === candidateNormalized) {
      return true
    }

    const messageHead = messageNormalized.slice(0, 260)
    if (!candidateHead || !messageHead) {
      continue
    }

    if (
      candidateHead === messageHead ||
      candidateHead.includes(messageHead) ||
      messageHead.includes(candidateHead)
    ) {
      return true
    }
  }

  return false
}

function collectIntroBeforeFirstUserFromSnapshot(
  pairMessages: Array<{ role: "user" | "assistant"; content: string }>
): string {
  const firstUserMessage = pairMessages.find((message) => message.role === "user")?.content ?? ""
  if (!firstUserMessage) {
    return ""
  }

  const container =
    resolveConversationContainerFromComposer() ??
    queryDeepFirstVisible<HTMLElement>(["chat-panel-v2", "chat-panel", "main", "[role='main']"])

  if (!container) {
    return ""
  }

  const rawText = normalizeCapturedMessageText(container.innerText || container.textContent || "")
  if (rawText.length < 140) {
    return ""
  }

  const normalizedRaw = normalize(rawText)
  const normalizedNeedle = normalize(firstUserMessage).slice(0, 96)
  if (!normalizedNeedle || normalizedNeedle.length < 8) {
    return ""
  }

  const needleIndex = normalizedRaw.indexOf(normalizedNeedle)
  if (needleIndex <= 0) {
    return ""
  }

  const introSlice = normalizedRaw.slice(0, needleIndex).trim()
  if (introSlice.length < 18) {
    return ""
  }

  const sanitized = sanitizeConversationSnapshotText(introSlice)
  if (sanitized.length < 18) {
    return ""
  }

  return sanitized
}

function mergeIntroIntoPairedCapture(
  pairMessages: Array<{ role: "user" | "assistant"; content: string }>,
  pairCandidates: CapturedVisibleMessageCandidate[]
): Array<{ role: "user" | "assistant"; content: string }> {
  if (pairMessages.length === 0 || pairCandidates.length === 0) {
    return pairMessages
  }

  const firstPairTop = pairCandidates.reduce(
    (best, candidate) => Math.min(best, candidate.top),
    Number.POSITIVE_INFINITY
  )

  const firstUserTop = pairCandidates
    .filter((candidate) => candidate.role === "user")
    .reduce((best, candidate) => Math.min(best, candidate.top), Number.POSITIVE_INFINITY)

  const introAnchorTop = Number.isFinite(firstUserTop) ? firstUserTop : firstPairTop

  if (!Number.isFinite(introAnchorTop)) {
    return pairMessages
  }

  const introMessages: Array<{ role: "assistant"; content: string }> = []
  const introCandidatesByPriority = [
    collectIntroFromDeepRoots(introAnchorTop),
    collectIntroFromConversationContainer(introAnchorTop),
    collectIntroBeforeFirstUserFromSnapshot(pairMessages)
  ]

  for (const introCandidate of introCandidatesByPriority) {
    if (!introCandidate) {
      continue
    }

    if (isMessageContentRedundant(introCandidate, [...introMessages, ...pairMessages])) {
      continue
    }

    introMessages.push({
      role: "assistant",
      content: introCandidate
    })
    break
  }

  const introCandidates = collectLooseConversationFallbackCandidates()
    .filter((candidate) => candidate.role === "assistant" && candidate.top < introAnchorTop - 4)
    .sort((left, right) => left.top - right.top)

  if (introCandidates.length === 0 && introMessages.length === 0) {
    return pairMessages
  }

  for (const candidate of introCandidates) {
    const content = normalizeCapturedMessageText(candidate.content)
    if (content.length < 40) {
      continue
    }

    const normalizedContent = normalize(content)
    if (isLikelyUiNoiseText(normalizedContent, content.length)) {
      continue
    }

    const alreadyExists = isMessageContentRedundant(content, [...introMessages, ...pairMessages])
    if (alreadyExists) {
      continue
    }

    introMessages.push({ role: "assistant", content })
    if (introMessages.length >= 2) {
      break
    }
  }

  if (introMessages.length === 0) {
    return pairMessages
  }

  return [...introMessages, ...pairMessages]
}

export function captureVisibleMessages(): Array<{ role: "user" | "assistant"; content: string }> {
  const pairCandidates = collectConversationPairCandidates()
  const fromPairs = compactCapturedCandidates(pairCandidates)
  if (fromPairs.length > 0) {
    const mergedWithIntro = mergeIntroIntoPairedCapture(fromPairs, pairCandidates)
    window.__minddockConversationCaptureDebug = {
      mode: "pairs",
      count: mergedWithIntro.length,
      sample: mergedWithIntro.slice(0, 2).map((item) => item.content.slice(0, 120)),
      at: new Date().toISOString()
    }
    return mergedWithIntro
  }

  const fromTurns = collectConversationTurnCandidates()
  const fromStandalone = [
    ...collectRoleCandidates("user", USER_MESSAGE_SELECTORS),
    ...collectRoleCandidates("assistant", ASSISTANT_MESSAGE_SELECTORS)
  ]

  const primaryCapture = compactCapturedCandidates([...fromTurns, ...fromStandalone])
  if (primaryCapture.length > 0) {
    window.__minddockConversationCaptureDebug = {
      mode: "primary",
      count: primaryCapture.length,
      sample: primaryCapture.slice(0, 2).map((item) => item.content.slice(0, 120)),
      at: new Date().toISOString()
    }
    return primaryCapture
  }

  const looseCapture = compactCapturedCandidates(collectLooseConversationFallbackCandidates())
  if (looseCapture.length > 0) {
    window.__minddockConversationCaptureDebug = {
      mode: "loose",
      count: looseCapture.length,
      sample: looseCapture.slice(0, 2).map((item) => item.content.slice(0, 120)),
      at: new Date().toISOString()
    }
    return looseCapture
  }

  const aggregateCapture = captureAggregateConversationFallback()
  if (aggregateCapture.length > 0) {
    window.__minddockConversationCaptureDebug = {
      mode: "aggregate",
      count: aggregateCapture.length,
      sample: aggregateCapture.slice(0, 2).map((item) => item.content.slice(0, 120)),
      at: new Date().toISOString()
    }
    return aggregateCapture
  }

  const mainCapture = captureMainConversationSnapshotFallback()
  if (mainCapture.length > 0) {
    window.__minddockConversationCaptureDebug = {
      mode: "main",
      count: mainCapture.length,
      sample: mainCapture.slice(0, 2).map((item) => item.content.slice(0, 120)),
      at: new Date().toISOString()
    }
    return mainCapture
  }

  window.__minddockConversationCaptureDebug = {
    mode: "empty",
    count: 0,
    sample: [],
    at: new Date().toISOString()
  }

  return []
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
    "#minddock-focus-threads-root, #minddock-agile-bar-root, #minddock-source-actions-root, #minddock-source-filters-root, #minddock-conversation-export-root, #minddock-studio-export-root"
  )
}

function resolveConversationTriggerSnapshot(candidate: HTMLElement): string {
  return normalize(
    [
      candidate.innerText,
      candidate.textContent,
      candidate.getAttribute("aria-label"),
      candidate.getAttribute("title"),
      candidate.getAttribute("data-testid"),
      candidate.getAttribute("data-tooltip"),
      candidate.className,
      candidate.id
    ]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .join(" ")
  )
}

function isDisabledConversationAction(candidate: HTMLElement): boolean {
  if (candidate instanceof HTMLButtonElement && candidate.disabled) {
    return true
  }

  const ariaDisabled = normalize(String(candidate.getAttribute("aria-disabled") ?? ""))
  if (ariaDisabled === "true") {
    return true
  }

  const disabledAttr = candidate.getAttribute("disabled")
  return disabledAttr !== null
}

function resolveClickableConversationActionTarget(candidate: HTMLElement): HTMLElement | null {
  if (!candidate || !isVisible(candidate)) {
    return null
  }

  const directClickableSelector = "button, [role='menuitem'], [role='button'], a, li, mat-menu-item"
  if (candidate.matches(directClickableSelector)) {
    return isDisabledConversationAction(candidate) ? null : candidate
  }

  const ancestor = candidate.closest<HTMLElement>(directClickableSelector)
  if (ancestor && isVisible(ancestor) && !isDisabledConversationAction(ancestor)) {
    return ancestor
  }

  const descendant = candidate.querySelector<HTMLElement>(directClickableSelector)
  if (descendant && isVisible(descendant) && !isDisabledConversationAction(descendant)) {
    return descendant
  }

  return null
}

function scoreNativeConversationTrigger(
  candidate: HTMLElement,
  labelRect?: DOMRect
): number {
  if (!isVisible(candidate) || isMindDockInjectedElement(candidate)) {
    return -1
  }

  const text = normalize(String(candidate.textContent ?? "").trim())
  const snapshot = resolveConversationTriggerSnapshot(candidate)
  const rect = candidate.getBoundingClientRect()
  if (rect.width < 12 || rect.height < 12) {
    return -1
  }

  if (rect.top > Math.max(260, window.innerHeight * 0.42)) {
    return -1
  }

  const blockedTokens = [
    "minddock",
    "delete",
    "remove",
    "trash",
    "rename",
    "settings",
    "config",
    "share",
    "export",
    "help",
    "profile",
    "upgrade",
    "billing",
    "plan",
    "menu"
  ]
  if (blockedTokens.some((token) => snapshot.includes(token))) {
    return -1
  }

  let score = -1

  const strongLabels = [
    "new conversation",
    "new chat",
    "create conversation",
    "create chat",
    "nova conversa",
    "novo chat",
    "criar conversa",
    "criar chat",
    "new thread",
    "nova thread"
  ]
  for (const label of strongLabels) {
    if (snapshot.includes(label)) {
      score = Math.max(score, 260 - label.length)
    }
  }

  const isCompact = rect.width <= 44 && rect.height <= 44
  const hasAddToken = /\b(add|plus|novo|nova|new|create|criar)\b/u.test(snapshot)
  const hasConversationToken = /\b(conversation|conversa|chat|thread)\b/u.test(snapshot)

  if (text === "+" || text === "add" || text === "plus") {
    score = Math.max(score, 150)
  }

  if (hasAddToken && hasConversationToken) {
    score = Math.max(score, 190)
  }

  if (isCompact && hasAddToken) {
    score = Math.max(score, 120)
  }

  if (labelRect) {
    const nearLabel =
      rect.left >= labelRect.right - 12 &&
      rect.left <= labelRect.right + 96 &&
      Math.abs(rect.top - labelRect.top) <= 30

    if (nearLabel && isCompact) {
      score = Math.max(score, 170)
    } else if (nearLabel) {
      score = Math.max(score, 145)
    }
  }

  if (score < 0) {
    return -1
  }

  if (candidate.tagName === "BUTTON") {
    score += 10
  }

  if (candidate.closest("header, .panel-title-row, [data-testid='conversation-header']")) {
    score += 8
  }

  return score
}

function pickBestConversationTriggerCandidate(
  candidates: HTMLElement[],
  labelRect?: DOMRect
): HTMLElement | null {
  let bestCandidate: HTMLElement | null = null
  let bestScore = -1

  for (const candidate of candidates) {
    const score = scoreNativeConversationTrigger(candidate, labelRect)
    if (score > bestScore) {
      bestScore = score
      bestCandidate = candidate
    }
  }

  return bestCandidate
}

function matchesNewConversationAction(candidate: HTMLElement): boolean {
  if (!isVisible(candidate) || isMindDockInjectedElement(candidate)) {
    return false
  }

  const snapshot = resolveConversationTriggerSnapshot(candidate)
  if (!snapshot) {
    return false
  }

  const newConversationTokens = [
    "new conversation",
    "new chat",
    "create conversation",
    "create chat",
    "nova conversa",
    "novo chat",
    "criar conversa",
    "criar chat",
    "new thread",
    "nova thread"
  ]

  return newConversationTokens.some((token) => snapshot.includes(token))
}

function isLikelyHeaderOverflowMenuButton(candidate: HTMLElement, labelRect?: DOMRect): boolean {
  if (!isVisible(candidate) || isMindDockInjectedElement(candidate)) {
    return false
  }

  const rect = candidate.getBoundingClientRect()
  if (rect.top > Math.max(220, window.innerHeight * 0.35)) {
    return false
  }

  const snapshot = resolveConversationTriggerSnapshot(candidate)
  const hasMenuToken =
    snapshot.includes("more") ||
    snapshot.includes("mais") ||
    snapshot.includes("menu") ||
    snapshot.includes("options") ||
    snapshot.includes("opcoes")
  const hasPopupMenu = normalize(String(candidate.getAttribute("aria-haspopup") ?? "")) === "menu"
  const rawLabel = String(candidate.innerText || candidate.textContent || "").trim()
  const isDotsGlyph =
    rawLabel === "..." ||
    rawLabel === "…" ||
    rawLabel === "⋮" ||
    rawLabel === "︙" ||
    rawLabel === "⋯"
  const isCompact = rect.width <= 48 && rect.height <= 48

  if (!hasMenuToken && !hasPopupMenu) {
    const permissiveIconMatch = isDotsGlyph || (snapshot.length <= 3 && isCompact)
    if (!permissiveIconMatch) {
      return false
    }
  }

  if (!labelRect) {
    return true
  }

  const isOnSameHeaderRow = Math.abs(rect.top - labelRect.top) <= 40
  const isToTheRightOfConversationLabel = rect.left >= labelRect.right - 10
  if (!isOnSameHeaderRow || !isToTheRightOfConversationLabel) {
    return false
  }

  if (hasMenuToken || hasPopupMenu) {
    return true
  }

  return rect.left >= window.innerWidth * 0.45
}

function tryTriggerFromOverflowMenu(labelRect?: DOMRect): boolean {
  const menuButtons = queryDeepAll<HTMLElement>([
    "button",
    "[role='button']",
    "[aria-haspopup='menu']",
    "[data-testid*='menu']",
    "[aria-label*='more' i]",
    "[aria-label*='mais' i]"
  ]).filter((candidate) => isLikelyHeaderOverflowMenuButton(candidate, labelRect))

  const menuButton = menuButtons[0]
  if (!menuButton) {
    return false
  }

  clickElement(menuButton)

  const menuScopes = queryDeepAll<HTMLElement>([
    "[role='menu']",
    "[role='listbox']",
    "[aria-modal='true']",
    "[data-testid*='menu']",
    "mat-menu-panel"
  ]).filter((scope) => isVisible(scope))

  for (const scope of menuScopes) {
    const candidates = Array.from(
      scope.querySelectorAll<HTMLElement>("button, [role='menuitem'], [role='button'], li, a, span, div")
    ).filter((candidate) => matchesNewConversationAction(candidate))

    if (candidates[0]) {
      return clickElement(candidates[0])
    }
  }

  const globalCandidates = queryDeepAll<HTMLElement>([
    "button",
    "[role='menuitem']",
    "[role='button']",
    "li",
    "a",
    "span",
    "div"
  ]).filter((candidate) => matchesNewConversationAction(candidate))

  if (globalCandidates[0]) {
    return clickElement(globalCandidates[0])
  }

  return false
}

const CONVERSATION_ACTION_SELECTORS = [
  "button",
  "[role='menuitem']",
  "[role='button']",
  "a",
  "li",
  "span",
  "div"
] as const

const CONVERSATION_MENU_SCOPE_SELECTORS = [
  "[role='menu']",
  "[role='listbox']",
  "[aria-modal='true']",
  "[data-testid*='menu']",
  "mat-menu-panel",
  ".cdk-overlay-pane",
  ".cdk-overlay-container"
] as const

function collectConversationActionCandidates(root?: ParentNode): HTMLElement[] {
  const candidates = root
    ? queryDeepAll<HTMLElement>(CONVERSATION_ACTION_SELECTORS, root)
    : queryDeepAll<HTMLElement>(CONVERSATION_ACTION_SELECTORS)

  return candidates.filter((candidate) => isVisible(candidate) && !isMindDockInjectedElement(candidate))
}

function isDeleteLikeSnapshot(snapshot: string): boolean {
  return /(^|[\s:;,.()[\]{}"'`-])(delete|clear|remove|erase|excluir|apagar|limpar)\b/u.test(snapshot)
}

function isConversationLikeSnapshot(snapshot: string): boolean {
  return /\b(conversation|conversa|chat|thread|history|historico)\b/u.test(snapshot)
}

function hasDangerousDeleteTarget(snapshot: string): boolean {
  return /\b(notebook|caderno|workspace|source|fonte|arquivo|file|conta|account|profile|perfil|dock|minddock)\b/u.test(
    snapshot
  )
}

function matchesDeleteConversationHistoryAction(candidate: HTMLElement): boolean {
  if (!isVisible(candidate) || isMindDockInjectedElement(candidate)) {
    return false
  }

  const snapshot = resolveConversationTriggerSnapshot(candidate)
  if (!snapshot) {
    return false
  }

  const strongLabels = [
    "delete conversation history",
    "clear conversation history",
    "delete chat history",
    "clear chat history",
    "excluir historico de conversa",
    "excluir historico de conversas",
    "apagar historico de conversa",
    "limpar historico de conversa",
    "limpar historico de conversas",
    "historico de conversa"
  ]

  if (strongLabels.some((label) => snapshot.includes(label))) {
    return true
  }

  if (!isDeleteLikeSnapshot(snapshot) || !isConversationLikeSnapshot(snapshot)) {
    return false
  }

  if (hasDangerousDeleteTarget(snapshot)) {
    return false
  }

  return true
}

function scoreDeleteConversationHistoryCandidate(candidate: HTMLElement, labelRect?: DOMRect): number {
  const target = resolveClickableConversationActionTarget(candidate)
  if (!target) {
    return -1
  }

  if (!matchesDeleteConversationHistoryAction(candidate) && !matchesDeleteConversationHistoryAction(target)) {
    return -1
  }

  const snapshot = resolveConversationTriggerSnapshot(target) || resolveConversationTriggerSnapshot(candidate)

  const rect = target.getBoundingClientRect()
  let score = 0

  if (snapshot.includes("delete conversation history") || snapshot.includes("excluir historico de conversa")) {
    score += 360
  } else if (snapshot.includes("clear conversation history") || snapshot.includes("limpar historico de conversa")) {
    score += 340
  } else if (snapshot.includes("history") || snapshot.includes("historico")) {
    score += 180
  } else {
    score += 120
  }

  if (target.closest("[role='menu'], [role='listbox'], [data-testid*='menu'], mat-menu-panel")) {
    score += 80
  }

  if (labelRect) {
    score += Math.max(0, 120 - Math.abs(rect.top - labelRect.top) * 2)
    score += Math.max(0, 120 - Math.abs(rect.left - labelRect.right) * 0.6)
  }

  if (target.tagName === "BUTTON" || target.getAttribute("role") === "menuitem") {
    score += 14
  }

  return score
}

function pickDeleteConversationHistoryCandidate(
  candidates: HTMLElement[],
  labelRect?: DOMRect
): HTMLElement | null {
  let best: HTMLElement | null = null
  let bestScore = -1

  for (const candidate of candidates) {
    const score = scoreDeleteConversationHistoryCandidate(candidate, labelRect)
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }

  return best
}

function findDeleteConversationHistoryActionInOpenMenus(labelRect?: DOMRect): HTMLElement | null {
  const scopedCandidates: HTMLElement[] = []
  for (const scope of queryDeepAll<HTMLElement>(CONVERSATION_MENU_SCOPE_SELECTORS)) {
    if (!isVisible(scope)) {
      continue
    }
    scopedCandidates.push(...collectConversationActionCandidates(scope))
  }

  return pickDeleteConversationHistoryCandidate(scopedCandidates, labelRect)
}

function resolveConversationOverflowMenuButton(labelRect?: DOMRect): HTMLElement | null {
  const candidates = queryDeepAll<HTMLElement>([
    "button",
    "[role='button']",
    "[aria-haspopup='menu']",
    "[data-testid*='menu']",
    "[aria-label*='more' i]",
    "[aria-label*='mais' i]",
    "[title*='more' i]",
    "[title*='mais' i]"
  ]).filter((candidate) => isLikelyHeaderOverflowMenuButton(candidate, labelRect))

  if (candidates.length === 0) {
    return null
  }

  const sorted = [...candidates].sort((left, right) => {
    const leftRect = left.getBoundingClientRect()
    const rightRect = right.getBoundingClientRect()

    if (!labelRect) {
      return leftRect.top - rightRect.top
    }

    const leftDistance =
      Math.abs(leftRect.top - labelRect.top) + Math.abs(leftRect.left - labelRect.right)
    const rightDistance =
      Math.abs(rightRect.top - labelRect.top) + Math.abs(rightRect.left - labelRect.right)

    return leftDistance - rightDistance
  })

  return sorted[0] ?? null
}

function resolveStudioLabel(): HTMLElement | null {
  const labels = ["studio", "estudio"]
  const matchesLabel = (candidate: HTMLElement): boolean => {
    const merged = [
      candidate.innerText,
      candidate.textContent,
      candidate.getAttribute("aria-label"),
      candidate.getAttribute("title"),
      candidate.getAttribute("data-testid"),
      candidate.getAttribute("data-tooltip")
    ]
      .map((value) => String(value ?? ""))
      .join(" ")
    const normalized = normalize(merged)
    return labels.some((label) => {
      if (normalized === label) {
        return true
      }
      if (normalized.startsWith(`${label} `)) {
        return true
      }
      if (normalized.endsWith(` ${label}`)) {
        return true
      }
      return normalized.includes(` ${label} `)
    })
  }

  const strictMatches: Array<{ element: HTMLElement; rect: DOMRect }> = []
  const relaxedMatches: Array<{ element: HTMLElement; rect: DOMRect }> = []

  for (const root of getDeepRoots()) {
    const candidates = Array.from(
      "querySelectorAll" in root
        ? (root as Document | ShadowRoot).querySelectorAll<HTMLElement>("span, div, h2, h3, button, a, [role='tab'], [role='heading']")
        : []
    )

    for (const candidate of candidates) {
      if (!isVisible(candidate) || isMindDockInjectedElement(candidate)) {
        continue
      }
      if (!matchesLabel(candidate)) {
        continue
      }

      const rect = candidate.getBoundingClientRect()
      if (rect.left < window.innerWidth * 0.45) {
        continue
      }

      if (rect.top <= 240) {
        strictMatches.push({ element: candidate, rect })
      } else if (rect.top <= 420) {
        relaxedMatches.push({ element: candidate, rect })
      }
    }
  }

  const pickClosest = (items: Array<{ element: HTMLElement; rect: DOMRect }>): HTMLElement | null => {
    if (items.length === 0) {
      return null
    }
    const sorted = [...items].sort((left, right) => {
      if (left.rect.top !== right.rect.top) {
        return left.rect.top - right.rect.top
      }
      return left.rect.left - right.rect.left
    })
    return sorted[0]?.element ?? null
  }

  return pickClosest(strictMatches) ?? pickClosest(relaxedMatches)
}

export function resolveStudioLabelText(): string | null {
  const label = resolveStudioLabel()
  if (!label) return null
  const text = String(label.innerText || label.textContent || "").replace(/\s+/g, " ").trim()
  return text.length > 0 ? text : null
}

function isStudioLabelCollapsed(studioLabel: HTMLElement): boolean {
  if (!isVisible(studioLabel)) {
    return true
  }

  const studioRect = studioLabel.getBoundingClientRect()
  const visibleLabelText = normalize(`${studioLabel.innerText ?? ""} ${studioLabel.textContent ?? ""}`)
  const hasVisibleStudioText =
    visibleLabelText.includes("studio") || visibleLabelText.includes("estudio")

  if (!hasVisibleStudioText && studioRect.width > 0 && studioRect.width <= 88) {
    return true
  }

  const tabLikeHost =
    studioLabel.closest<HTMLElement>(
      "[role='tab'], [data-testid*='tab'], [aria-selected], [class*='tab'], [class*='rail'], [class*='sidebar']"
    ) ?? studioLabel.parentElement

  if (tabLikeHost && isVisible(tabLikeHost)) {
    const hostRect = tabLikeHost.getBoundingClientRect()
    const hostVisibleText = normalize(`${tabLikeHost.innerText ?? ""} ${tabLikeHost.textContent ?? ""}`)
    const hostHasStudioText =
      hostVisibleText.includes("studio") || hostVisibleText.includes("estudio")

    if (!hostHasStudioText && hostRect.width > 0 && hostRect.width <= 92) {
      return true
    }
  }

  return false
}

export function resolveStudioOverflowMenuButton(): HTMLElement | null {
  const studioLabel = resolveStudioLabel()
  const studioRect = studioLabel?.getBoundingClientRect()
  if (!studioRect) {
    return null
  }

  const candidates = queryDeepAll<HTMLElement>([
    "button",
    "[role='button']",
    "[aria-haspopup='menu']",
    "[data-testid*='menu']",
    "[aria-label*='more' i]",
    "[aria-label*='mais' i]",
    "[title*='more' i]",
    "[title*='mais' i]"
  ]).filter((candidate) => {
    if (!isVisible(candidate) || isMindDockInjectedElement(candidate)) {
      return false
    }

    const rect = candidate.getBoundingClientRect()
    const snapshot = resolveConversationTriggerSnapshot(candidate)
    const rawLabel = String(candidate.innerText || candidate.textContent || "").trim()
    const isDotsGlyph =
      rawLabel === "..." ||
      rawLabel === "…" ||
      rawLabel === "⋮" ||
      rawLabel === "︙" ||
      rawLabel === "⋯"
    const hasMenuToken =
      snapshot.includes("more") ||
      snapshot.includes("mais") ||
      snapshot.includes("menu") ||
      snapshot.includes("options") ||
      snapshot.includes("opcoes")
    const hasPopupMenu = normalize(String(candidate.getAttribute("aria-haspopup") ?? "")) === "menu"
    const nearStudioRow = Math.abs(rect.top - studioRect.top) <= 44
    const nearStudioColumn = rect.right >= studioRect.left - 90 && rect.left <= studioRect.left + 20
    const compact = rect.width <= 54 && rect.height <= 54

    if (!nearStudioRow || !nearStudioColumn || !compact) {
      return false
    }

    return hasMenuToken || hasPopupMenu || isDotsGlyph || snapshot.length <= 3
  })

  if (candidates.length === 0) {
    return null
  }

  const sorted = [...candidates].sort((left, right) => {
    const leftRect = left.getBoundingClientRect()
    const rightRect = right.getBoundingClientRect()
    const leftDistance =
      Math.abs(leftRect.top - studioRect.top) + Math.abs(leftRect.left - (studioRect.left - 28))
    const rightDistance =
      Math.abs(rightRect.top - studioRect.top) + Math.abs(rightRect.left - (studioRect.left - 28))
    return leftDistance - rightDistance
  })

  return sorted[0] ?? null
}

export function resolveStudioExportAnchor(): HTMLElement | null {
  const studioLabel = resolveStudioLabel()
  if (!studioLabel || isStudioLabelCollapsed(studioLabel)) {
    return null
  }

  // Primary: find the button containing the dock_to_left icon
  const dockIcons = queryDeepAll<HTMLElement>(["mat-icon", ".mat-icon"])
    .filter((el) => el.textContent?.trim() === "dock_to_left" && isVisible(el))
  for (const icon of dockIcons) {
    const btn = icon.closest<HTMLElement>("button, [role='button']")
    if (btn && isVisible(btn) && !isMindDockInjectedElement(btn)) {
      return btn
    }
  }

  // Fallback: first compact button to the right of Studio label
  const studioRect = studioLabel.getBoundingClientRect()
  const candidates = queryDeepAll<HTMLElement>([
    "button",
    "[role='button']"
  ]).filter((candidate) => {
    if (!isVisible(candidate) || isMindDockInjectedElement(candidate)) return false
    const rect = candidate.getBoundingClientRect()
    return (
      Math.abs(rect.top - studioRect.top) <= 44 &&
      rect.left >= studioRect.right - 6 &&
      rect.left >= window.innerWidth * 0.45 &&
      rect.width <= 64 && rect.height <= 64
    )
  })

  if (candidates.length > 0) {
    const sorted = [...candidates].sort(
      (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left
    )
    return sorted[sorted.length - 1] ?? null
  }

  return resolveStudioOverflowMenuButton() ?? null
}

function findDeleteConversationHistoryAction(labelRect?: DOMRect): HTMLElement | null {
  const scopedCandidates: HTMLElement[] = []
  for (const scope of queryDeepAll<HTMLElement>(CONVERSATION_MENU_SCOPE_SELECTORS)) {
    if (!isVisible(scope)) {
      continue
    }
    scopedCandidates.push(...collectConversationActionCandidates(scope))
  }

  const scopedPick = pickDeleteConversationHistoryCandidate(scopedCandidates, labelRect)
  if (scopedPick) {
    return scopedPick
  }

  return pickDeleteConversationHistoryCandidate(collectConversationActionCandidates(), labelRect)
}

function matchesDeleteConversationHistoryConfirm(candidate: HTMLElement): boolean {
  if (!isVisible(candidate) || isMindDockInjectedElement(candidate)) {
    return false
  }

  const snapshot = resolveConversationTriggerSnapshot(candidate)
  if (!snapshot) {
    return false
  }

  if (/\b(cancel|cancelar|close|fechar|back|voltar|no)\b/u.test(snapshot)) {
    return false
  }

  if (
    snapshot.includes("delete conversation history") ||
    snapshot.includes("clear conversation history") ||
    snapshot.includes("excluir historico de conversa") ||
    snapshot.includes("excluir historico de conversas") ||
    snapshot.includes("limpar historico de conversa")
  ) {
    return true
  }

  return isDeleteLikeSnapshot(snapshot) && !hasDangerousDeleteTarget(snapshot)
}

function pickDeleteConversationHistoryConfirmCandidate(candidates: HTMLElement[]): HTMLElement | null {
  let best: HTMLElement | null = null
  let bestScore = -1

  for (const candidate of candidates) {
    if (!matchesDeleteConversationHistoryConfirm(candidate)) {
      continue
    }

    const snapshot = resolveConversationTriggerSnapshot(candidate)
    let score = 80

    if (snapshot === "delete" || snapshot === "excluir" || snapshot === "apagar") {
      score += 200
    }
    if (snapshot.includes("delete conversation history") || snapshot.includes("excluir historico de conversa")) {
      score += 260
    }
    if (candidate.closest("[role='dialog'], dialog, [aria-modal='true']")) {
      score += 90
    }
    if (candidate.tagName === "BUTTON") {
      score += 18
    }

    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }

  return best
}

async function waitForConversationResetAfterDelete(
  beforeMessages: Array<{ role: "user" | "assistant"; content: string }>,
  timeoutMs = 7000
): Promise<boolean> {
  const beforeMessageCount = beforeMessages.length
  const beforeHasUserMessages = beforeMessages.some((message) => message.role === "user")
  const anchorSnippets = Array.from(
    new Set(
      beforeMessages
        .map((message) => normalize(message.content).slice(0, 120))
        .filter((snippet) => snippet.length >= 18)
        .slice(0, 8)
    )
  )
  const timeoutAt = Date.now() + timeoutMs

  while (Date.now() < timeoutAt) {
    const currentCapture = captureVisibleMessages()
    const currentCount = currentCapture.length
    const currentHasUserMessages = currentCapture.some((message) => message.role === "user")
    const currentSnapshot = normalize(currentCapture.map((message) => message.content).join("\n\n"))
    const currentMainSnapshot = normalize(
      captureMainConversationSnapshotFallback()
        .map((item) => item.content)
        .join("\n\n")
    )
    const stillHasAnyAnchor =
      anchorSnippets.length > 0 &&
      anchorSnippets.some(
        (anchor) => currentSnapshot.includes(anchor) || (currentMainSnapshot.length > 0 && currentMainSnapshot.includes(anchor))
      )

    if (currentCount === 0) {
      return true
    }

    if (beforeHasUserMessages && !currentHasUserMessages && !stillHasAnyAnchor) {
      return true
    }

    if (!beforeHasUserMessages && beforeMessageCount >= 2 && currentCount <= 1 && !stillHasAnyAnchor) {
      return true
    }

    await wait(120)
  }

  return false
}

export async function triggerNotebookDeleteConversationHistory(): Promise<boolean> {
  const label = resolveConversationLabel()
  const labelRect = label?.getBoundingClientRect()
  const beforeMessages = captureVisibleMessages()

  for (let attempt = 0; attempt < 1; attempt += 1) {
    let triggeredDeleteAction = false
    const menuButton = resolveStudioOverflowMenuButton() ?? resolveConversationOverflowMenuButton(labelRect)
    if (menuButton) {
      clickElement(menuButton)

      const timeoutAt = Date.now() + 1200
      while (Date.now() < timeoutAt) {
        const menuAction = findDeleteConversationHistoryActionInOpenMenus(labelRect)
        if (menuAction) {
          const menuActionTarget = resolveClickableConversationActionTarget(menuAction) ?? menuAction
          clickElement(menuActionTarget)
          triggeredDeleteAction = true
          const resetDetected = await waitForConversationResetAfterDelete(beforeMessages, 15000)
          if (resetDetected) {
            return true
          }
          break
        }

        await wait(80)
      }
    }

    if (triggeredDeleteAction) {
      return false
    }

    const directAction = findDeleteConversationHistoryAction(labelRect)
    if (directAction) {
      const directTarget = resolveClickableConversationActionTarget(directAction) ?? directAction
      clickElement(directTarget)
      const resetDetected = await waitForConversationResetAfterDelete(beforeMessages, 15000)
      if (resetDetected) {
        return true
      }
    }

    await wait(120)
  }

  return false
}

export function triggerNotebookNewConversation(): boolean {
  const label = resolveConversationLabel()
  const labelRect = label?.getBoundingClientRect()
  const headerHost = resolveConversationHeaderHost()

  if (headerHost) {
    const bestDirectCandidate = pickBestConversationTriggerCandidate(
      Array.from(headerHost.querySelectorAll<HTMLElement>("button, [role='button'], a, span, div")),
      labelRect
    )

    if (bestDirectCandidate) {
      return clickElement(bestDirectCandidate)
    }
  }

  if (label) {
    const row = label.parentElement ?? label
    const siblingCandidates = Array.from(
      row.querySelectorAll<HTMLElement>("button, [role='button'], a, span, div")
    ).filter((candidate) => candidate !== label)

    const bestSiblingCandidate = pickBestConversationTriggerCandidate(siblingCandidates, labelRect)
    if (bestSiblingCandidate) {
      return clickElement(bestSiblingCandidate)
    }

    const rowRect = row.getBoundingClientRect()
    const nearbyInteractive = queryDeepAll<HTMLElement>([
      "button",
      "[role='button']",
      "a",
      "span[role='button']",
      "div[role='button']"
    ]).filter((candidate) => {
      const rect = candidate.getBoundingClientRect()
      if (Math.abs(rect.top - rowRect.top) > 36) return false
      if (rect.left < rowRect.right - 16 || rect.left > rowRect.right + 128) return false
      return true
    })

    const bestNearbyCandidate = pickBestConversationTriggerCandidate(nearbyInteractive, labelRect)
    if (bestNearbyCandidate) {
      return clickElement(bestNearbyCandidate)
    }
  }

  const globalCandidates = queryDeepAll<HTMLElement>([
    "button",
    "[role='button']",
    "a[role='button']",
    "span[role='button']",
    "div[role='button']",
    "[aria-label*='new' i]",
    "[aria-label*='nova' i]",
    "[aria-label*='novo' i]",
    "[title*='new' i]",
    "[title*='nova' i]",
    "[title*='novo' i]",
    "[data-testid*='new' i]",
    "[data-testid*='conversation' i]",
    "[data-testid*='chat' i]"
  ]).filter((candidate) => candidate.getBoundingClientRect().top <= Math.max(260, window.innerHeight * 0.45))

  const bestGlobalCandidate = pickBestConversationTriggerCandidate(globalCandidates, labelRect)
  if (bestGlobalCandidate) {
    return clickElement(bestGlobalCandidate)
  }

  if (tryTriggerFromOverflowMenu(labelRect)) {
    return true
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
