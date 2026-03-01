import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Download,
  FileText,
  Files,
  Globe,
  LayoutGrid,
  ListFilter,
  type LucideIcon,
  RefreshCw,
  Search,
  Trash2,
  Type,
  Youtube
} from "lucide-react"
import {
  SOURCE_PANEL_RESET_EVENT,
  SOURCE_PANEL_TOGGLE_EVENT,
  type SourceFilterType,
  clearNativeSourceSearchInputs,
  dispatchSourcePanelExport,
  dispatchSourcePanelRefresh,
  dispatchSourcePanelReset,
  dispatchSourcePanelToggle,
  ensureOriginalDisplay,
  inferSourceType,
  resolveSourceRows
} from "./sourceDom"

const SAVED_VIEW_KEY = "minddock:source-panel-saved-view"

const FILTERS: Array<{ type: SourceFilterType; label: string; icon: LucideIcon }> = [
  { type: "All", label: "Todos", icon: LayoutGrid },
  { type: "PDFs", label: "PDFs", icon: FileText },
  { type: "GDocs", label: "GDocs", icon: Files },
  { type: "Web", label: "Web", icon: Globe },
  { type: "Text", label: "Texto", icon: Type },
  { type: "YouTube", label: "YouTube", icon: Youtube }
]

export function SourceFilterPanel() {
  const [searchText, setSearchText] = useState("")
  const [activeFilters, setActiveFilters] = useState<Set<SourceFilterType>>(new Set(["All"]))
  const [areFiltersOpen, setAreFiltersOpen] = useState(false)
  const [isVisible, setIsVisible] = useState(true)

  const activeFilterList = useMemo(() => Array.from(activeFilters), [activeFilters])
  const brandMarkSrc = new URL(
    "../../public/images/logo/logotipo minddock.png",
    import.meta.url
  ).href
  const resetPanelState = useCallback(() => {
    setSearchText("")
    setActiveFilters(new Set(["All"]))
    setAreFiltersOpen(false)
    setIsVisible(true)
    dispatchSourcePanelToggle(true)
  }, [])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_VIEW_KEY)
      if (!raw) {
        return
      }

      const parsed = JSON.parse(raw) as {
        searchText?: string
        filters?: string[]
      }

      if (typeof parsed.searchText === "string") {
        setSearchText(parsed.searchText)
      }

      if (Array.isArray(parsed.filters) && parsed.filters.length > 0) {
        const validated = parsed.filters.filter((item): item is SourceFilterType =>
          ["All", "PDFs", "GDocs", "Web", "Text", "YouTube"].includes(String(item))
        )

        if (validated.length > 0) {
          setActiveFilters(new Set(validated))
        }
      }
    } catch {
      // Ignore malformed local state.
    }
  }, [])

  useEffect(() => {
    const onToggle = (event: Event) => {
      const custom = event as CustomEvent<{ isVisible?: boolean }>
      if (typeof custom.detail?.isVisible === "boolean") {
        setIsVisible(custom.detail.isVisible)
      } else {
        setIsVisible((prev) => !prev)
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
    applyFilters(activeFilterList, searchText)
  }, [activeFilterList, searchText])

  const toggleFilter = (nextFilter: SourceFilterType) => {
    setActiveFilters((prev) => {
      if (nextFilter === "All") {
        return new Set(["All"])
      }

      const next = new Set(prev)
      next.delete("All")

      if (next.has(nextFilter)) {
        next.delete(nextFilter)
      } else {
        next.add(nextFilter)
      }

      if (next.size === 0) {
        next.add("All")
      }

      return next
    })
  }

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

  const toggleFilters = () => {
    setAreFiltersOpen((current) => !current)
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
      <img
        src={brandMarkSrc}
        alt="MindDock"
        className={[
          "pointer-events-none absolute z-0 h-[14px] w-[14px] opacity-80 transition-all duration-300",
          areFiltersOpen ? "bottom-3 left-[20px]" : "left-[20px] top-[58px]"
        ].join(" ")}
      />

      <div className="relative z-[1] flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="relative flex min-w-0 flex-1 items-center gap-2 rounded-[18px] border border-white/[0.06] bg-[#0f1114] px-3 py-2.5">
            <Search size={14} strokeWidth={1.7} className="shrink-0 text-[#7e8590]" />
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Fontes de pesquisa..."
              className="w-full bg-transparent text-[12px] text-white outline-none placeholder:text-[#6f7580]"
            />
          </div>

          <div className="inline-flex shrink-0 items-center gap-1 rounded-[16px] border border-white/[0.06] bg-[#0d0f12] p-1">
            <PanelActionButton title="Exportar fontes visiveis" onClick={openExportPanel}>
              <Download size={15} strokeWidth={1.8} />
            </PanelActionButton>
            <PanelActionButton title="Atualizar fontes Google Docs" onClick={refreshSources}>
              <RefreshCw size={15} strokeWidth={1.8} />
            </PanelActionButton>
            <PanelActionButton
              title={areFiltersOpen ? "Ocultar filtros" : "Mostrar filtros"}
              onClick={toggleFilters}
              active={areFiltersOpen}>
              <ListFilter size={15} strokeWidth={1.8} />
            </PanelActionButton>
            <PanelActionButton title="Limpar filtros e restaurar painel" onClick={resetAllSources}>
              <Trash2 size={15} strokeWidth={1.8} />
            </PanelActionButton>
          </div>
        </div>

        <div
          className={[
            "overflow-hidden transition-all duration-200",
            areFiltersOpen ? "max-h-28 opacity-100" : "max-h-0 opacity-0"
          ].join(" ")}>
          <div className="flex flex-wrap items-center gap-2 pt-1">
          {FILTERS.map((filter) => {
            const isActive = activeFilters.has(filter.type)
            const Icon = filter.icon

            return (
              <button
                key={filter.type}
                type="button"
                onClick={() => toggleFilter(filter.type)}
                className={[
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium tracking-[0.01em] transition-colors",
                  isActive
                    ? "border-[#facc15]/35 bg-[#2a2208] text-[#fff1a6]"
                    : "border-white/[0.06] bg-[#101216] text-[#a4acb8] hover:text-white"
                ].join(" ")}>
                <Icon size={12} strokeWidth={1.9} className="text-white" />
                {filter.label}
              </button>
            )
          })}

          <button
            type="button"
            onClick={saveView}
            className="ml-auto rounded-full border border-white/[0.06] bg-[#101216] px-3.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-[#14171c]">
            Salvar visualizacao
          </button>
          </div>
        </div>
      </div>
    </section>
  )
}

function PanelActionButton(props: {
  title: string
  onClick: () => void
  children: JSX.Element
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

function applyFilters(activeFilters: SourceFilterType[], searchText: string): void {
  const normalizedSearch = String(searchText ?? "").toLowerCase().trim()
  const showAll = activeFilters.includes("All")

  let visibleCount = 0
  let hiddenCount = 0

  for (const row of resolveSourceRows()) {
    const sourceType = inferSourceType(row)
    const titleSnapshot = String(row.innerText ?? "").toLowerCase()

    const byFilter = showAll || activeFilters.includes(sourceType)
    const bySearch = normalizedSearch.length === 0 || titleSnapshot.includes(normalizedSearch)

    const keepVisible = byFilter && bySearch
    row.style.display = keepVisible ? ensureOriginalDisplay(row) : "none"

    if (keepVisible) {
      visibleCount++
    } else {
      hiddenCount++
    }
  }

  console.debug("[sources:filters]", {
    activeFilters,
    searchText,
    visibleCount,
    hiddenCount
  })
}
