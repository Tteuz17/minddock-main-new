import { useEffect, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  SOURCE_PANEL_RESET_EVENT,
  SOURCE_PANEL_TOGGLE_EVENT,
  type SourceFilterType,
  dispatchSourcePanelToggle,
  ensureOriginalDisplay,
  inferSourceType,
  resolveSourceRows
} from "./sourceDom"

const SAVED_VIEW_KEY = "minddock:source-panel-saved-view"

const FILTERS: Array<{ type: SourceFilterType; label: string }> = [
  { type: "All", label: "Todos" },
  { type: "PDFs", label: "PDFs" },
  { type: "GDocs", label: "GDocs" },
  { type: "Web", label: "Web" },
  { type: "Text", label: "Texto" },
  { type: "YouTube", label: "YouTube" }
]

export function SourceFilterPanel() {
  const [searchText, setSearchText] = useState("")
  const [activeFilters, setActiveFilters] = useState<Set<SourceFilterType>>(new Set(["All"]))
  const [isVisible, setIsVisible] = useState(true)

  const activeFilterList = useMemo(() => Array.from(activeFilters), [activeFilters])

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
      setSearchText("")
      setActiveFilters(new Set(["All"]))
      setIsVisible(true)
      dispatchSourcePanelToggle(true)
    }

    window.addEventListener(SOURCE_PANEL_TOGGLE_EVENT, onToggle as EventListener)
    window.addEventListener(SOURCE_PANEL_RESET_EVENT, onReset as EventListener)

    return () => {
      window.removeEventListener(SOURCE_PANEL_TOGGLE_EVENT, onToggle as EventListener)
      window.removeEventListener(SOURCE_PANEL_RESET_EVENT, onReset as EventListener)
    }
  }, [])

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

  if (!isVisible) {
    return null
  }

  return (
    <section className="mt-2 w-full rounded-xl border border-white/15 bg-black/45 p-2.5">
      <div className="relative mb-2.5 flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-2.5 py-2">
        <Search size={13} strokeWidth={1.7} className="text-text-tertiary" />
        <input
          type="search"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Fontes de pesquisa..."
          className="w-full bg-transparent text-xs text-white outline-none placeholder:text-text-tertiary"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((filter) => {
          const isActive = activeFilters.has(filter.type)

          return (
            <button
              key={filter.type}
              type="button"
              onClick={() => toggleFilter(filter.type)}
              className={[
                "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                isActive
                  ? "border-blue-400/70 bg-blue-600/25 text-blue-100"
                  : "border-white/20 bg-white/5 text-text-secondary hover:text-white"
              ].join(" ")}>
              {filter.label}
            </button>
          )
        })}

        <button
          type="button"
          onClick={saveView}
          className="ml-auto rounded-full border border-white/25 bg-white/8 px-3 py-1 text-[11px] font-medium text-white hover:bg-white/12">
          Salvar visualizacao
        </button>
      </div>
    </section>
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
