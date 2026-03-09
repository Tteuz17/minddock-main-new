import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  CheckCircle2,
  File,
  FileText,
  Globe,
  Image,
  LayoutGrid,
  ListFilter,
  Music,
  RefreshCw,
  Search,
  Trash2,
  Youtube
} from "lucide-react"
import {
  SOURCE_PANEL_RESET_EVENT,
  SOURCE_PANEL_TOGGLE_EVENT,
  clearNativeSourceSearchInputs,
  dispatchSourceFilterApplyEnd,
  dispatchSourceFilterApplyStart,
  dispatchSourcePanelExport,
  dispatchSourcePanelRefresh,
  dispatchSourcePanelReset,
  dispatchSourcePanelToggle,
  queryDeepAll,
  resolveSourceRows
} from "./sourceDom"
import { DownloadSourcesButton } from "./DownloadSourcesButton"

const SAVED_VIEW_KEY = "minddock:source-panel-saved-view"
const FILTER_HIDDEN_DATASET_KEY = "minddockFilterHidden"
const SOURCE_NODE_CONTAINER_SELECTOR =
  "[data-testid='source-list-item'], [data-testid*='source-item'], [role='row'], [role='listitem'], li"
const SOURCE_NODE_SELECTORS = [
  "[data-testid='source-list-item']",
  "[data-testid*='source-item']",
  "source-picker [role='listitem']",
  ".source-panel [role='listitem']",
  "source-picker div[role='row']",
  ".source-panel div[role='row']",
  "source-picker div[role='button']",
  ".source-panel div[role='button']"
] as const
const MINDDOCK_ROOT_SELECTOR = "#minddock-source-actions-root, #minddock-source-filters-root"
const NATIVE_SOURCE_SEARCH_SELECTORS = [
  "source-picker input[type='text']",
  "source-picker input[placeholder*='Pesquise']",
  "source-picker input[placeholder*='Search']",
  ".source-panel input[type='text']"
] as const
let filterRetryHandle: number | null = null
let filterRetryAttempts = 0

type SourceDetectedType = "PDF" | "YOUTUBE" | "GDOC" | "WEB" | "TEXT" | "AUDIO" | "IMAGE"
type SourcePanelFilterType = "ALL" | SourceDetectedType

declare global {
  interface Window {
    __minddockSourceFilterApply?: {
      timestamp: string
      activeFilters: string[]
      rows: number
      visibleCount: number
      hiddenCount: number
      sample: Array<{ type: SourceDetectedType; title: string; visible: boolean }>
    }
  }
}

const FILTERS: Array<{
  type: SourcePanelFilterType
  label: string
}> = [
  { type: "ALL", label: "All" },
  { type: "PDF", label: "PDF" },
  { type: "GDOC", label: "GDocs" },
  { type: "WEB", label: "Web" },
  { type: "TEXT", label: "Text" },
  { type: "AUDIO", label: "Audio" },
  { type: "IMAGE", label: "Images" },
  { type: "YOUTUBE", label: "YouTube" }
]

function getSafeIcon(type: string, isActive: boolean): ReactNode {
  const props = {
    size: 14,
    strokeWidth: 1.9,
    className: isActive ? "text-yellow-400" : "text-gray-400"
  }

  switch (type) {
    case "ALL":
      return <ListFilter {...props} />
    case "PDF":
      return <FileText {...props} />
    case "YOUTUBE":
      return <Youtube {...props} />
    case "WEB":
      return <Globe {...props} />
    case "GDOC":
    case "GDOCS":
      return <File {...props} />
    case "TEXT":
      return <LayoutGrid {...props} />
    case "AUDIO":
      return <Music {...props} />
    case "IMAGE":
      return <Image {...props} />
    default:
      return <CheckCircle2 {...props} />
  }
}

function useSourceFilterLogic() {
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set(["ALL"]))

  const handleToggleFilter = useCallback((type: string) => {
    setActiveFilters((previousFilters) => {
      const normalizedType = normalizeFilterType(type)
      if (isAllFilter(type)) {
        return new Set(["ALL"])
      }

      if (!normalizedType) {
        return previousFilters
      }

      const currentSpecific = Array.from(previousFilters).find((item) => item !== "ALL")
      if (currentSpecific === normalizedType) {
        return new Set(["ALL"])
      }

      // Single-select strict mode: keeps only the latest clicked specific filter.
      return new Set([normalizedType])
    })
  }, [])

  return {
    activeFilters,
    setActiveFilters,
    handleToggleFilter
  }
}

export function SourceFilterPanel() {
  const [searchText, setSearchText] = useState("")
  const [isVisible, setIsVisible] = useState(true)
  const { activeFilters, setActiveFilters, handleToggleFilter } = useSourceFilterLogic()

  const activeFilterList = useMemo<string[]>(() => Array.from(activeFilters), [activeFilters])

  const resetPanelState = useCallback(() => {
    setSearchText("")
    setActiveFilters(new Set(["ALL"]))
    setIsVisible(true)
    dispatchSourcePanelToggle(true)
  }, [setActiveFilters])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_VIEW_KEY)
      if (!raw) {
        return
      }

      const parsed = JSON.parse(raw) as {
        searchText?: string
        filters?: unknown
      }

      if (typeof parsed.searchText === "string") {
        setSearchText(parsed.searchText)
      }

      setActiveFilters(hydratePersistedFilterSet(parsed.filters))
    } catch {
      // Ignore malformed local state.
    }
  }, [setActiveFilters])

  useEffect(() => {
    const onToggle = (event: Event) => {
      const custom = event as CustomEvent<{ isVisible?: boolean }>
      if (typeof custom.detail?.isVisible === "boolean") {
        setIsVisible(custom.detail.isVisible)
      } else {
        setIsVisible((previousVisibility) => !previousVisibility)
      }
    }

    const onReset = () => {
      resetPanelState()
    }

    window.addEventListener(SOURCE_PANEL_TOGGLE_EVENT, onToggle as EventListener)
    window.addEventListener(SOURCE_PANEL_RESET_EVENT, onReset as EventListener)

    return () => {
      window.removeEventListener(SOURCE_PANEL_TOGGLE_EVENT, onToggle as EventListener)
      window.removeEventListener(SOURCE_PANEL_RESET_EVENT, onReset as EventListener)
    }
  }, [resetPanelState])

  useEffect(() => {
    syncNativeSourceSearchInputs(searchText)
  }, [searchText])

  useEffect(() => {
    const filterSet = new Set(activeFilters)

    if (filterSet.has("ALL") && normalizeSnapshotValue(searchText).length === 0) {
      restoreAllSourceNodeVisibility()
    }

    applyVisualFilters(filterSet, searchText)
  }, [activeFilters, searchText])

  useEffect(
    () => () => {
      if (filterRetryHandle !== null) {
        window.clearTimeout(filterRetryHandle)
        filterRetryHandle = null
      }
    },
    []
  )

  const saveView = () => {
    try {
      window.localStorage.setItem(
        SAVED_VIEW_KEY,
        JSON.stringify({
          searchText,
          filters: activeFilterList
        })
      )
    } catch {
      // Ignore storage failures.
    }
  }

  const openExportPanel = () => {
    dispatchSourcePanelExport()
  }

  const refreshSources = () => {
    dispatchSourcePanelRefresh()
  }

  const resetAllSources = () => {
    clearNativeSourceSearchInputs()
    dispatchSourcePanelReset()
  }

  if (!isVisible) {
    return null
  }

  return (
    <section className="relative mt-2 w-full overflow-visible rounded-[22px] border border-white/[0.06] bg-[#08090b] p-3.5 shadow-[0_12px_28px_rgba(0,0,0,0.18)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-90"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255, 255, 255, 0.07) 1px, transparent 1px)",
          backgroundSize: "14px 14px",
          backgroundPosition: "0 0"
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-[1px] rounded-[21px] border border-white/[0.03]"
      />
      <div className="relative z-[1] flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="relative flex min-w-0 flex-1 items-center gap-2 rounded-[18px] border border-white/[0.06] bg-[#0f1114] px-3 py-2.5">
            <Search size={14} strokeWidth={1.7} className="shrink-0 text-[#7e8590]" />
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search sources..."
              className="w-full bg-transparent text-[12px] text-white outline-none placeholder:text-[#6f7580]"
            />
          </div>

          <div className="inline-flex shrink-0 items-center gap-1 rounded-[16px] border border-white/[0.06] bg-[#0d0f12] p-1">
            <DownloadSourcesButton onClick={openExportPanel} />
            <PanelActionButton title="Refresh Google Docs sources" onClick={refreshSources}>
              <RefreshCw size={15} strokeWidth={1.8} />
            </PanelActionButton>
            <PanelActionButton title="Clear filters and reset panel" onClick={resetAllSources}>
              <Trash2 size={15} strokeWidth={1.8} />
            </PanelActionButton>
          </div>
        </div>

        <div className="overflow-visible">
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {FILTERS.map((filter) => {
              const isActive = activeFilters.has(filter.type)

              return (
                <button
                  key={filter.type}
                  type="button"
                  onClick={() => handleToggleFilter(filter.type)}
                  className={[
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium tracking-[0.01em] transition-colors",
                    isActive
                      ? "border-[#facc15]/35 bg-[#2a2208] text-[#fff1a6]"
                      : "border-white/[0.06] bg-[#101216] text-[#a4acb8] hover:text-white"
                  ].join(" ")}>
                  {getSafeIcon(filter.type, isActive)}
                  {filter.label}
                </button>
              )
            })}

            <button
              type="button"
              onClick={saveView}
              className="ml-auto rounded-full border border-white/[0.06] bg-[#101216] px-3.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-[#14171c]">
              Save view
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

function normalizeSnapshotValue(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeFilterType(type: string): SourceDetectedType | null {
  const compact = normalizeSnapshotValue(type).replace(/\s+/g, "")

  switch (compact) {
    case "pdf":
    case "pdfs":
      return "PDF"
    case "youtube":
    case "yt":
      return "YOUTUBE"
    case "gdoc":
    case "gdocs":
    case "googledoc":
    case "googledocs":
      return "GDOC"
    case "web":
    case "url":
    case "site":
      return "WEB"
    case "text":
    case "txt":
    case "plaintext":
      return "TEXT"
    case "audio":
    case "mp3":
    case "wav":
    case "m4a":
    case "ogg":
      return "AUDIO"
    case "image":
    case "images":
    case "img":
    case "imagem":
    case "imagens":
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
      return "IMAGE"
    default:
      return null
  }
}

function isAllFilter(type: string): boolean {
  const compact = normalizeSnapshotValue(type).replace(/\s+/g, "")
  return compact === "all" || compact === "todos" || compact === "todas"
}

function hydratePersistedFilterSet(rawFilters: unknown): Set<string> {
  if (!Array.isArray(rawFilters)) {
    return new Set(["ALL"])
  }

  let firstSpecific: string | null = null
  for (const rawItem of rawFilters) {
    const item = String(rawItem ?? "")
    if (!item) {
      continue
    }

    if (isAllFilter(item)) {
      return new Set(["ALL"])
    }

    const normalizedFilter = normalizeFilterType(item)
    if (normalizedFilter && !firstSpecific) {
      firstSpecific = normalizedFilter
    }
  }

  if (!firstSpecific) {
    return new Set(["ALL"])
  }

  return new Set([firstSpecific])
}

function extractFirstUrl(input: string): string {
  const match = String(input ?? "").match(/https?:\/\/[^\s)\]}>"']+/i)
  return String(match?.[0] ?? "").trim()
}

function readClassSnapshot(element: Element): string {
  if (element instanceof HTMLElement) {
    return element.className
  }

  if (element instanceof SVGElement) {
    return element.className.baseVal ?? ""
  }

  return String(element.getAttribute("class") ?? "")
}

function collectNodeSnapshot(node: HTMLElement): string {
  const values = new Set<string>()
  const push = (value: unknown) => {
    const normalized = normalizeSnapshotValue(value)
    if (normalized) {
      values.add(normalized)
    }
  }

  push(node.innerText)
  push(node.textContent)
  push(node.getAttribute("aria-label"))
  push(node.getAttribute("title"))
  push(node.getAttribute("data-testid"))
  push(readClassSnapshot(node))

  const richNodes = Array.from(
    node.querySelectorAll<Element>(
      "a[href],img[src],svg,use,path,[aria-label],[title],[alt],[class],[data-testid],[data-icon],[icon-name],[src],[href]"
    )
  ).slice(0, 128)

  for (const richNode of richNodes) {
    push(richNode.textContent)
    push(readClassSnapshot(richNode))
    push(richNode.getAttribute("aria-label"))
    push(richNode.getAttribute("title"))
    push(richNode.getAttribute("alt"))
    push(richNode.getAttribute("data-testid"))
    push(richNode.getAttribute("data-icon"))
    push(richNode.getAttribute("icon-name"))
    push(richNode.getAttribute("src"))
    push(richNode.getAttribute("href"))

    if (richNode instanceof HTMLAnchorElement) {
      push(richNode.href)
    }
    if (richNode instanceof HTMLImageElement) {
      push(richNode.src)
    }
    if (richNode instanceof SVGUseElement) {
      push(richNode.href.baseVal)
      push(richNode.getAttribute("xlink:href"))
    }
    if (richNode instanceof SVGPathElement) {
      push(richNode.getAttribute("d"))
    }
  }

  return Array.from(values).join(" ")
}

function collectSvgPathSnapshot(node: HTMLElement): string {
  return Array.from(node.querySelectorAll("svg path"))
    .slice(0, 48)
    .map((path) => normalizeSnapshotValue(path.getAttribute("d")))
    .filter(Boolean)
    .join(" ")
}

function collectIconSnapshot(node: HTMLElement): string {
  const values = new Set<string>()
  const push = (value: unknown) => {
    const normalized = normalizeSnapshotValue(value)
    if (normalized) {
      values.add(normalized)
    }
  }

  const iconNodes = [node, ...Array.from(node.querySelectorAll<HTMLElement | SVGElement>("svg, use, path, i, span, [data-icon], [icon-name]"))]
  for (const iconNode of iconNodes) {
    push(iconNode.getAttribute("class"))
    push(iconNode.getAttribute("style"))
    push(iconNode.getAttribute("data-icon"))
    push(iconNode.getAttribute("icon-name"))
    push(iconNode.getAttribute("aria-label"))
    push(iconNode.getAttribute("title"))
    push(iconNode.getAttribute("src"))

    if (iconNode instanceof HTMLElement) {
      const shortText = normalizeSnapshotValue(String(iconNode.innerText || iconNode.textContent || ""))
      if (shortText && shortText.length <= 40) {
        push(shortText)
      }
    }

    if (iconNode instanceof SVGElement) {
      push(iconNode.getAttribute("fill"))
      push(iconNode.getAttribute("stroke"))
    }
  }

  return Array.from(values).join(" ")
}

function normalizeRawSourceType(rawType: string): SourceDetectedType | null {
  const normalized = normalizeSnapshotValue(rawType)
  if (!normalized) {
    return null
  }

  // Priority order follows our clean-room detector contract.
  if (/\bpdf\b|\.pdf(\b|$)|application\/pdf|picture_as_pdf|adobe acrobat/.test(normalized)) {
    return "PDF"
  }

  if (/\byoutube\b|youtu\.be|youtube\.com|watch\?v=|\/shorts\//.test(normalized)) {
    return "YOUTUBE"
  }

  if (
    /\bgdoc\b|\bgdocs\b|google docs?|docs\.google\.com|drive\.google\.com|vnd\.google-apps/.test(
      normalized
    )
  ) {
    return "GDOC"
  }

  if (/\bweb\b|\bwebsite\b|\blink\b|\burl\b|https?:\/\/|www\./.test(normalized)) {
    return "WEB"
  }

  if (/\baudio\b|\.mp3(\b|$)|\.wav(\b|$)|\.m4a(\b|$)|\.ogg(\b|$)|\.aac(\b|$)|audio_file|music|sound/.test(normalized)) {
    return "AUDIO"
  }

  if (/\bimage\b|\bimagem\b|\.png(\b|$)|\.jpe?g(\b|$)|\.gif(\b|$)|\.webp(\b|$)|\.svg(\b|$)|photo|picture|img/.test(normalized)) {
    return "IMAGE"
  }

  if (/\btext\b|\btexto\b|\bnote\b|\bnotes\b|\bmarkdown\b|\bplain text\b|copied text|pasted text|\.txt(\b|$)|\.md(\b|$)/.test(normalized)) {
    return "TEXT"
  }

  return null
}

function collectRawTypeSignals(row: HTMLElement): string {
  const signals: string[] = []
  const push = (value: unknown) => {
    const normalized = normalizeSnapshotValue(value)
    if (normalized) {
      signals.push(normalized)
    }
  }

  const candidates = [
    row.getAttribute("data-source-type"),
    row.getAttribute("data-type"),
    row.getAttribute("source-type"),
    row.getAttribute("type"),
    row.getAttribute("data-mime-type"),
    row.getAttribute("mime-type"),
    row.getAttribute("data-file-type"),
    row.getAttribute("data-origin-type"),
    row.getAttribute("data-kind"),
    row.getAttribute("data-source-kind"),
    row.getAttribute("data-source-subtype")
  ]
  for (const candidate of candidates) {
    push(candidate)
  }

  const datasetEntries = Object.entries(row.dataset ?? {})
  for (const [key, value] of datasetEntries) {
    if (!value) {
      continue
    }
    if (/type|kind|mime|source|doc|gdoc|audio|video|url|link/i.test(key)) {
      push(`${key}:${value}`)
      push(value)
    }
  }

  return signals.join(" ")
}

function hasGdocMetadataSignal(row: HTMLElement, combinedSnapshot: string): boolean {
  const attributeSnapshot = normalizeSnapshotValue(
    [
      row.getAttribute("data-is-gdoc"),
      row.getAttribute("data-isgdoc"),
      row.getAttribute("is-gdoc"),
      row.getAttribute("isgdoc"),
      row.getAttribute("data-gdoc-id"),
      row.getAttribute("gdocid"),
      row.getAttribute("data-google-doc-id"),
      row.getAttribute("google-doc-id")
    ]
      .filter(Boolean)
      .join(" ")
  )

  return (
    /\bisgdoc\b.*\btrue\b|\bdata-is-gdoc\b.*\btrue\b|\bgdocid\b|\bdata-gdoc-id\b|\bgoogle-doc-id\b/.test(attributeSnapshot) ||
    /\bisgdoc\b.*\btrue\b|\bgdocid\b|\bdata-gdoc-id\b|\bgoogle-doc-id\b/.test(combinedSnapshot)
  )
}

function collectRowContextSnapshot(row: HTMLElement): string {
  const values = new Set<string>()
  const push = (value: unknown) => {
    const normalized = normalizeSnapshotValue(value)
    if (normalized) {
      values.add(normalized)
    }
  }

  let current: HTMLElement | null = row
  let depth = 0
  while (current && depth < 7) {
    const checkboxCount = current.querySelectorAll("input[type='checkbox'], [role='checkbox']").length
    if (depth > 0 && checkboxCount > 1) {
      break
    }

    push(current.getAttribute("aria-label"))
    push(current.getAttribute("title"))
    push(current.getAttribute("data-testid"))
    push(readClassSnapshot(current))
    push(current.getAttribute("data-source-type"))
    push(current.getAttribute("data-type"))
    push(current.getAttribute("type"))
    push(current.getAttribute("data-mime-type"))
    push(current.getAttribute("mime-type"))
    push(current.getAttribute("data-source-kind"))
    push(current.getAttribute("data-source-subtype"))
    push(current.getAttribute("data-gdoc-id"))
    push(current.getAttribute("google-doc-id"))
    push(current.getAttribute("data-google-doc-id"))
    push(current.getAttribute("data-is-gdoc"))
    push(current.getAttribute("data-isgdoc"))

    const richNodes = Array.from(current.querySelectorAll<Element>("a[href],img[src],audio[src],source[src],[data-type],[data-source-type],[mime-type],[data-mime-type],[data-gdoc-id],[data-google-doc-id]")).slice(0, 32)
    for (const richNode of richNodes) {
      push(richNode.getAttribute("href"))
      push(richNode.getAttribute("src"))
      push(richNode.getAttribute("aria-label"))
      push(richNode.getAttribute("title"))
      push(richNode.getAttribute("data-testid"))
      push(richNode.getAttribute("data-type"))
      push(richNode.getAttribute("data-source-type"))
      push(richNode.getAttribute("mime-type"))
      push(richNode.getAttribute("data-mime-type"))
      push(richNode.getAttribute("data-gdoc-id"))
      push(richNode.getAttribute("data-google-doc-id"))
      if (richNode instanceof HTMLAnchorElement) {
        push(richNode.href)
      }
      if (richNode instanceof HTMLImageElement) {
        push(richNode.src)
      }
    }

    current = current.parentElement
    depth += 1
  }

  return Array.from(values).join(" ")
}

function detectSourceTypeFromRow(row: HTMLElement): SourceDetectedType {
  const html = normalizeSnapshotValue(row.innerHTML)
  const text = normalizeSnapshotValue(String(row.innerText || row.textContent || ""))
  const aria = normalizeSnapshotValue(row.getAttribute("aria-label"))
  const title = normalizeSnapshotValue(row.getAttribute("title"))
  const dataHints = normalizeSnapshotValue(
    [row.getAttribute("data-testid"), row.getAttribute("data-icon"), row.getAttribute("icon-name")].filter(Boolean).join(" ")
  )
  const classHints = normalizeSnapshotValue(readClassSnapshot(row))
  const svgPathSnapshot = collectSvgPathSnapshot(row)
  const iconSnapshot = collectIconSnapshot(row)
  const nodeSnapshot = collectNodeSnapshot(row)
  
  // Busca links na linha E nos ancestrais (até 3 níveis acima)
  const allHrefs: string[] = []
  let current: HTMLElement | null = row
  let depth = 0
  while (current && depth < 3) {
    // Busca links diretos
    Array.from(current.querySelectorAll<HTMLAnchorElement>("a[href]")).forEach(anchor => {
      allHrefs.push(anchor.href)
    })
    
    // Busca também em atributos data-* que podem conter URLs
    const dataAttrs = Array.from(current.attributes).filter(attr => 
      attr.name.startsWith("data-") && 
      (attr.value.includes("docs.google.com") || attr.value.includes("drive.google.com") || attr.value.includes("http"))
    )
    dataAttrs.forEach(attr => allHrefs.push(attr.value))
    
    current = current.parentElement
    depth++
  }
  
  const hrefSnapshot = normalizeSnapshotValue(allHrefs.join(" "))
  const mediaSnapshot = normalizeSnapshotValue(
    Array.from(row.querySelectorAll<HTMLElement>("img[src],audio[src],source[src]"))
      .map((element) => {
        if (element instanceof HTMLImageElement) {
          return element.src
        }
        return String(element.getAttribute("src") ?? "")
      })
      .join(" ")
  )
  const extractedUrl = normalizeSnapshotValue(extractFirstUrl(`${nodeSnapshot} ${hrefSnapshot} ${mediaSnapshot}`))

  const combinedSnapshot = [
    html,
    text,
    aria,
    title,
    dataHints,
    classHints,
    iconSnapshot,
    nodeSnapshot,
    svgPathSnapshot,
    hrefSnapshot,
    mediaSnapshot,
    extractedUrl
  ]
    .filter(Boolean)
    .join(" ")
  const contextSnapshot = collectRowContextSnapshot(row)
  const fullSnapshot = `${combinedSnapshot} ${contextSnapshot}`.trim()

  const rawTypeSignals = `${collectRawTypeSignals(row)} ${contextSnapshot}`.trim()
  const explicitGdocMetadata = hasGdocMetadataSignal(row, `${fullSnapshot} ${rawTypeSignals}`)
  
  if (explicitGdocMetadata) {
    return "GDOC"
  }
  
  // DETECÇÃO POR ÍCONE (primeira palavra do texto)
  const firstWord = text.split(" ")[0]
  
  // Google Workspace (Docs, Sheets, Slides)
  if (firstWord === "article") {
    return "GDOC"
  }
  
  if (firstWord === "drive_spreadsheet") {
    return "GDOC"
  }
  
  if (firstWord === "drive_presentation") {
    return "GDOC"
  }
  
  // Áudio
  if (firstWord === "video_audio_call") {
    return "AUDIO"
  }
  
  // Imagens
  if (firstWord === "image") {
    return "IMAGE"
  }
  
  // Texto (description)
  if (firstWord === "description") {
    return "TEXT"
  }

  const strictGoogleDocsSignal = /docs\.google\.com\/(document|spreadsheets|presentation|forms)|drive\.google\.com\/(file|open|drive|folders)|vnd\.google-apps/.test(
    `${hrefSnapshot} ${mediaSnapshot} ${rawTypeSignals} ${fullSnapshot}`
  )
  if (strictGoogleDocsSignal) {
    console.log(`  ✅ GDOC (strict signal)`)
    return "GDOC"
  }

  // If the DOM exposes a direct type-like value, normalize it first.
  const normalizedFromRawType = normalizeRawSourceType(rawTypeSignals)
  if (normalizedFromRawType) {
    return normalizedFromRawType
  }

  // Fallback priority pass on whole snapshot.
  const normalizedFromSnapshot = normalizeRawSourceType(fullSnapshot)
  if (normalizedFromSnapshot) {
    return normalizedFromSnapshot
  }

  const looksLikeSocialText =
    /\bx\.com\b|\btwitter\.com\b|\bpost\b|\btweet\b|(^|\s)@[\w_]{2,}/.test(fullSnapshot) &&
    !/docs\.google\.com|drive\.google\.com|google docs?|\bgdocs?\b/.test(fullSnapshot)
  if (looksLikeSocialText) {
    return "TEXT"
  }

  return "TEXT"
}

function isControlSnapshot(snapshot: string): boolean {
  if (!snapshot) {
    return true
  }

  return /search sources|filter sources|save view|export visible sources|refresh google docs sources|clear filters and reset panel/.test(
    snapshot
  )
}

function isFilterableSourceNode(node: HTMLElement): boolean {
  if (!node.isConnected) {
    return false
  }

  if (node.closest(MINDDOCK_ROOT_SELECTOR)) {
    return false
  }

  const snapshot = collectNodeSnapshot(node)
  if (isControlSnapshot(snapshot)) {
    return false
  }

  const hasSignalNode = !!node.querySelector("svg, img, a[href], input[type='checkbox'], [role='checkbox']")
  const hasTypedSignal =
    /https?:\/\/|youtube|\.pdf(\b|$)|docs\.google\.com|drive\.google\.com|\btext\b|\btexto\b|\baudio\b|\.mp3(\b|$)|\.wav(\b|$)|\.m4a(\b|$)|\.ogg(\b|$)/.test(
      snapshot
    )

  return hasSignalNode || hasTypedSignal
}

function resolveCandidateSourceNodes(): HTMLElement[] {
  const mergedNodes = new Set<HTMLElement>()
  const byResolver = resolveSourceRows()
  const byGenericSelectors = queryDeepAll<HTMLElement>(SOURCE_NODE_SELECTORS)

  for (const candidate of [...byResolver, ...byGenericSelectors]) {
    if (!(candidate instanceof HTMLElement)) {
      continue
    }

    const container = candidate.closest<HTMLElement>(SOURCE_NODE_CONTAINER_SELECTOR) ?? candidate
    if (isFilterableSourceNode(container)) {
      mergedNodes.add(container)
      continue
    }

    if (isFilterableSourceNode(candidate)) {
      mergedNodes.add(candidate)
    }
  }

  return Array.from(mergedNodes)
}

function resolveLeafRows(rows: HTMLElement[]): HTMLElement[] {
  const uniqueRows = Array.from(new Set(rows))
  return uniqueRows.filter((row) => !uniqueRows.some((other) => other !== row && row.contains(other)))
}

function isIgnoredUiRow(row: HTMLElement): boolean {
  if (!row.isConnected) {
    return true
  }
  if (row.closest(MINDDOCK_ROOT_SELECTOR)) {
    return true
  }
  if (row.id === "minddock-filter-panel") {
    return true
  }

  const normalizedText = normalizeSnapshotValue(String(row.innerText || row.textContent || ""))
  if (
    /adicionar fontes|add sources|search sources|save view|export visible sources|refresh google docs sources|clear filters and reset panel/.test(
      normalizedText
    )
  ) {
    return true
  }

  if (row.querySelector("input[type='search'], input[type='text']")) {
    return true
  }

  return false
}

function resolveRowsForFiltering(): HTMLElement[] {
  const strictRows = resolveLeafRows(
    resolveSourceRows().filter((row) => !isIgnoredUiRow(row) && isFilterableSourceNode(row))
  )
  const broadRows = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".source-row, [data-testid='source-list-item'], [data-testid*='source-item'], div[role='row'], li, div[role='button'], div[jsaction]"
    )
  ).filter((row) => !isIgnoredUiRow(row) && isFilterableSourceNode(row))

  const mergedRows = resolveLeafRows([...strictRows, ...broadRows])
  if (mergedRows.length > 0) {
    return mergedRows
  }

  if (strictRows.length > 0) {
    return strictRows
  }

  return resolveLeafRows(broadRows)
}

function restoreAllSourceNodeVisibility(): void {
  const visibleSourceNodes = resolveRowsForFiltering()

  for (const node of visibleSourceNodes) {
    delete node.dataset[FILTER_HIDDEN_DATASET_KEY]
    node.style.removeProperty("display")
  }

  for (const node of Array.from(document.querySelectorAll<HTMLElement>("[data-minddock-filter-hidden='1']"))) {
    delete node.dataset[FILTER_HIDDEN_DATASET_KEY]
    node.style.removeProperty("display")
  }
}

function collectRowSearchSnapshot(row: HTMLElement): string {
  const anchorLinks = Array.from(row.querySelectorAll<HTMLAnchorElement>("a[href]"))
    .map((anchor) => anchor.href)
    .join(" ")
  const mediaSources = Array.from(row.querySelectorAll<HTMLElement>("img[src],audio[src],source[src]"))
    .map((element) => String(element.getAttribute("src") ?? ""))
    .join(" ")

  return normalizeSnapshotValue(
    [
      row.innerText,
      row.textContent,
      row.getAttribute("aria-label"),
      row.getAttribute("title"),
      row.getAttribute("data-testid"),
      anchorLinks,
      mediaSources
    ]
      .filter(Boolean)
      .join(" ")
  )
}

function executeDomFiltering(filters: Set<string>, searchText: string): {
  rows: number
  visibleCount: number
  hiddenCount: number
  sample: Array<{ type: SourceDetectedType; title: string; visible: boolean }>
} {
  const filterSet = new Set<SourcePanelFilterType>()
  for (const filter of filters) {
    if (isAllFilter(filter)) {
      filterSet.clear()
      filterSet.add("ALL")
      break
    }

    const normalized = normalizeFilterType(filter)
    if (normalized) {
      filterSet.add(normalized)
    }
  }

  if (filterSet.size === 0) {
    filterSet.add("ALL")
  }
  const normalizedSearch = normalizeSnapshotValue(searchText)
  const hasSearch = normalizedSearch.length > 0

  // Always restore previous hidden nodes first, so switching filters cannot leave stale hidden parents.
  for (const hiddenNode of Array.from(document.querySelectorAll<HTMLElement>("[data-minddock-filter-hidden='1']"))) {
    delete hiddenNode.dataset[FILTER_HIDDEN_DATASET_KEY]
    hiddenNode.style.removeProperty("display")
    hiddenNode.style.removeProperty("visibility")
  }

  const visibleSourceNodes = resolveRowsForFiltering()
  let visibleCount = 0
  let hiddenCount = 0
  const sample: Array<{ type: SourceDetectedType; title: string; visible: boolean }> = []

  console.group("--- DEBUG FILTERING ---")
  console.log("Active Filters:", Array.from(filterSet))
  console.log("Search:", normalizedSearch || "(empty)")
  try {
    for (const row of visibleSourceNodes) {
      if (isIgnoredUiRow(row)) {
        continue
      }

      const detectedType = detectSourceTypeFromRow(row)
      const matchesType = filterSet.has("ALL") || filterSet.has(detectedType)
      const rowSearchSnapshot = hasSearch ? collectRowSearchSnapshot(row) : ""
      const matchesSearch = !hasSearch || rowSearchSnapshot.includes(normalizedSearch)
      const shouldShow = matchesType && matchesSearch
      const rowPreview = String(row.innerText || row.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 20)

      console.log(
        `Row Text: "${rowPreview}..." | Detected: ${detectedType} | TypeMatch: ${matchesType} | SearchMatch: ${matchesSearch} | Visible: ${shouldShow}`
      )

      if (shouldShow) {
        row.style.display = ""
        row.style.visibility = "visible"
        delete row.dataset[FILTER_HIDDEN_DATASET_KEY]
      } else {
        row.style.visibility = ""
        row.style.display = "none"
        row.dataset[FILTER_HIDDEN_DATASET_KEY] = "1"
      }

      if (shouldShow) {
        visibleCount += 1
      } else {
        hiddenCount += 1
      }

      if (sample.length < 8) {
        sample.push({
          type: detectedType,
          title: String(row.innerText || row.textContent || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 120),
          visible: shouldShow
        })
      }
    }
  } finally {
    console.groupEnd()
  }

  return {
    rows: visibleSourceNodes.length,
    visibleCount,
    hiddenCount,
    sample
  }
}

function applyVisualFilters(filters: Set<string>, searchText: string): void {
  const filterSet = new Set(filters)
  const currentSearchText = String(searchText ?? "")
  dispatchSourceFilterApplyStart()

  try {
    const result = executeDomFiltering(filterSet, currentSearchText)

    if (result.rows === 0) {
      if (filterRetryAttempts < 5) {
        filterRetryAttempts += 1
        if (filterRetryHandle !== null) {
          window.clearTimeout(filterRetryHandle)
        }
        filterRetryHandle = window.setTimeout(() => {
          filterRetryHandle = null
          applyVisualFilters(new Set(filterSet), currentSearchText)
        }, 240)
      } else {
        filterRetryAttempts = 0
      }
    } else {
      filterRetryAttempts = 0
      if (filterRetryHandle !== null) {
        window.clearTimeout(filterRetryHandle)
        filterRetryHandle = null
      }
    }

    window.__minddockSourceFilterApply = {
      timestamp: new Date().toISOString(),
      activeFilters: Array.from(filterSet),
      rows: result.rows,
      visibleCount: result.visibleCount,
      hiddenCount: result.hiddenCount,
      sample: result.sample
    }

    console.info("[sources:filters] applied", {
      activeFilters: Array.from(filterSet),
      searchText: currentSearchText,
      rows: result.rows,
      visibleCount: result.visibleCount,
      hiddenCount: result.hiddenCount
    })
  } finally {
    dispatchSourceFilterApplyEnd()
  }
}

function syncNativeSourceSearchInputs(searchText: string): void {
  const normalizedInput = String(searchText ?? "")

  for (const input of queryDeepAll<HTMLInputElement | HTMLTextAreaElement>(NATIVE_SOURCE_SEARCH_SELECTORS)) {
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
      continue
    }
    if (input.value === normalizedInput) {
      continue
    }

    input.value = normalizedInput
    input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }))
    input.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }))
  }
}

function PanelActionButton(props: {
  title: string
  onClick: () => void
  children: ReactNode
  active?: boolean
}) {
  const { title, onClick, children, active = false } = props

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={[
        "inline-flex h-8 w-8 items-center justify-center rounded-[11px] border text-[#8e959e] transition-colors",
        active
          ? "border-[#facc15]/30 bg-[#221c08] text-[#facc15]"
          : "border-white/[0.06] bg-[#131519] hover:bg-[#171a1f] hover:text-white"
      ].join(" ")}>
      {children}
    </button>
  )
}
