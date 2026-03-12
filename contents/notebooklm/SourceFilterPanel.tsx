import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
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
  SquareCheck,
  Trash2,
  X,
  Youtube
} from "lucide-react"
import { MESSAGE_ACTIONS, type StandardResponse } from "~/lib/contracts"
import {
  SOURCE_PANEL_RESET_EVENT,
  SOURCE_PANEL_TOGGLE_EVENT,
  dispatchSourceFilterApplyEnd,
  dispatchSourceFilterApplyStart,
  dispatchSourcePanelExport,
  dispatchSourcePanelRefresh,
  dispatchSourcePanelSavedGroupsUpdated,
  dispatchSourcePanelToggle,
  extractSourceTitle,
  extractSourceUrl,
  inferSourceType,
  queryDeepAll,
  resolveNotebookIdFromRoute,
  resolveSourceRows,
  type SourcePanelRefreshCandidate
} from "./sourceDom"
import { DownloadSourcesButton } from "./DownloadSourcesButton"
import {
  buildSavedSelectionEntriesFromSources,
  deleteSavedSourceSelectionGroup,
  listSavedSourceSelectionGroupsByNotebook,
  loadSavedSourceSelectionGroups,
  normalizeGroupName,
  persistSavedSourceSelectionGroups,
  resolveMatchingSourceIdsForGroup,
  upsertSavedSourceSelectionGroup,
  type SavedSourceSelectionGroup
} from "./sourceSelectionGroups"
import { resolveSourceFilterUiCopy, type SourceFilterUiCopy } from "./notebooklmI18n"

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
const SOURCE_ICON_TOKEN_ONLY_REGEX =
  /^(more_vert|article|drive_pdf|drive_spreadsheet|drive_presentation|video_audio_call|video_youtube|image|description)$/u

type SourceDetectedType = "PDF" | "YOUTUBE" | "GDOC" | "WEB" | "TEXT" | "AUDIO" | "IMAGE"
type SourcePanelFilterType = "ALL" | SourceDetectedType
type DeleteToastStatus = "idle" | "running" | "success" | "error" | "info"

interface DeleteToastState {
  status: DeleteToastStatus
  message: string
  progress: number
}

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

type SourceFilterLabelKey = keyof SourceFilterUiCopy["filterLabels"]

const FILTERS: Array<{
  type: SourcePanelFilterType
  labelKey: SourceFilterLabelKey
}> = [
  { type: "ALL", labelKey: "ALL" },
  { type: "PDF", labelKey: "PDF" },
  { type: "GDOC", labelKey: "GDOC" },
  { type: "WEB", labelKey: "WEB" },
  { type: "TEXT", labelKey: "TEXT" },
  { type: "AUDIO", labelKey: "AUDIO" },
  { type: "IMAGE", labelKey: "IMAGE" },
  { type: "YOUTUBE", labelKey: "YOUTUBE" }
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
  const [savedSelectionGroups, setSavedSelectionGroups] = useState<SavedSourceSelectionGroup[]>([])
  const [isGroupsMenuOpen, setIsGroupsMenuOpen] = useState(false)
  const [groupsSearchText, setGroupsSearchText] = useState("")
  const [isSaveSelectionDialogOpen, setIsSaveSelectionDialogOpen] = useState(false)
  const [saveSelectionName, setSaveSelectionName] = useState("")
  const [isDeletingSources, setIsDeletingSources] = useState(false)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [pendingDeleteRows, setPendingDeleteRows] = useState<SelectableSourceRow[]>([])
  const [deleteToast, setDeleteToast] = useState<DeleteToastState>({
    status: "idle",
    message: "",
    progress: 0
  })
  const groupsMenuRef = useRef<HTMLDivElement | null>(null)
  const { activeFilters, setActiveFilters, handleToggleFilter } = useSourceFilterLogic()
  const notebookId = resolveNotebookIdFromRoute() ?? ""
  const uiCopy = useMemo(() => resolveSourceFilterUiCopy(), [])
  const deleteCopy = uiCopy.delete

  const notebookSavedGroups = useMemo(
    () => listSavedSourceSelectionGroupsByNotebook(notebookId, savedSelectionGroups),
    [notebookId, savedSelectionGroups]
  )
  const filteredNotebookSavedGroups = useMemo(() => {
    const query = normalizeGroupName(groupsSearchText).toLowerCase()
    if (!query) {
      return notebookSavedGroups
    }

    return notebookSavedGroups.filter((group) => group.name.toLowerCase().includes(query))
  }, [groupsSearchText, notebookSavedGroups])

  const resetPanelState = useCallback(() => {
    setSearchText("")
    setActiveFilters(new Set(["ALL"]))
    setIsVisible(true)
    dispatchSourcePanelToggle(true)
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

  useEffect(() => {
    setSavedSelectionGroups(loadSavedSourceSelectionGroups())
  }, [])

  useEffect(() => {
    persistSavedSourceSelectionGroups(savedSelectionGroups)
  }, [savedSelectionGroups])

  useEffect(() => {
    if (!isGroupsMenuOpen) {
      return
    }

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }
      if (groupsMenuRef.current?.contains(target)) {
        return
      }
      setIsGroupsMenuOpen(false)
    }

    document.addEventListener("mousedown", onPointerDown, true)
    return () => document.removeEventListener("mousedown", onPointerDown, true)
  }, [isGroupsMenuOpen])

  useEffect(() => {
    if (deleteToast.status === "idle" || deleteToast.status === "running") {
      return
    }

    const timeout = window.setTimeout(() => {
      setDeleteToast({ status: "idle", message: "", progress: 0 })
    }, deleteToast.status === "error" ? 5200 : 3200)

    return () => window.clearTimeout(timeout)
  }, [deleteToast.status])

  useEffect(() => {
    if (!isDeletingSources || deleteToast.status !== "running") {
      return
    }

    const timer = window.setInterval(() => {
      setDeleteToast((currentToast) => {
        if (currentToast.status !== "running") {
          return currentToast
        }
        const nextProgress = Math.min(90, currentToast.progress + (currentToast.progress < 60 ? 8 : 4))
        return {
          ...currentToast,
          progress: nextProgress
        }
      })
    }, 260)

    return () => window.clearInterval(timer)
  }, [isDeletingSources, deleteToast.status])

  const openSaveSelectionDialog = () => {
    if (!notebookId) {
      window.alert(uiCopy.notebookIdMissing)
      return
    }

    const selectedSourceRows = collectSelectedSourceRows()
    if (selectedSourceRows.length === 0) {
      window.alert(uiCopy.selectAtLeastOneToSave)
      return
    }

    const suggestedName = uiCopy.suggestedGroupName(notebookSavedGroups.length + 1).slice(0, 50)
    setSaveSelectionName(suggestedName)
    setIsSaveSelectionDialogOpen(true)
    setIsGroupsMenuOpen(false)
    setGroupsSearchText("")
  }

  const openExportPanel = () => {
    dispatchSourcePanelExport()
  }

  const refreshSources = () => {
    dispatchSourcePanelRefresh({
      gdocSources: collectGDocRefreshCandidates()
    })
  }

  const toggleSavedSourceGroupsMenu = () => {
    setSavedSelectionGroups(loadSavedSourceSelectionGroups())
    setGroupsSearchText("")
    setIsGroupsMenuOpen((currentValue) => !currentValue)
  }

  const closeSaveSelectionDialog = () => {
    setIsSaveSelectionDialogOpen(false)
    setSaveSelectionName("")
  }

  const saveCurrentSelectionAsGroup = () => {
    const groupName = normalizeGroupName(saveSelectionName).slice(0, 50)
    if (!groupName) {
      window.alert(uiCopy.saveGroupNameRequired)
      return
    }

    if (!notebookId) {
      window.alert(uiCopy.notebookIdMissing)
      return
    }

    const selectedSourceRows = collectSelectedSourceRows()
    if (selectedSourceRows.length === 0) {
      window.alert(uiCopy.selectAtLeastOneToSave)
      return
    }

    const entries = buildSavedSelectionEntriesFromSources(selectedSourceRows)
    if (entries.length === 0) {
      window.alert(uiCopy.saveGroupFailed)
      return
    }

    const result = upsertSavedSourceSelectionGroup({
      notebookId,
      groupName,
      entries,
      selectionCount: selectedSourceRows.length,
      groups: savedSelectionGroups
    })
    setSavedSelectionGroups(result.groups)
    dispatchSourcePanelSavedGroupsUpdated()
    setIsSaveSelectionDialogOpen(false)
    setSaveSelectionName("")
    setIsGroupsMenuOpen(true)
    setGroupsSearchText("")
  }

  const removeSavedSelectionGroup = (groupId: string) => {
    const targetId = String(groupId ?? "").trim()
    if (!targetId) {
      return
    }
    const nextGroups = deleteSavedSourceSelectionGroup(savedSelectionGroups, targetId)
    if (nextGroups.length === savedSelectionGroups.length) {
      return
    }
    setSavedSelectionGroups(nextGroups)
    dispatchSourcePanelSavedGroupsUpdated()
  }

  const applySavedSelectionGroup = (groupId: string) => {
    const targetId = String(groupId ?? "").trim()
    if (!targetId) {
      return
    }

    const group = notebookSavedGroups.find((item) => item.id === targetId)
    if (!group) {
      window.alert(uiCopy.groupNotFound)
      return
    }

    const rows = collectSelectedSourceRows(true)
    if (rows.length === 0) {
      window.alert(uiCopy.noSourcesToApplyGroup)
      return
    }

    const matchingIds = resolveMatchingSourceIdsForGroup(group, rows)
    let appliedChanges = 0
    for (const row of rows) {
      const shouldBeChecked = matchingIds.has(row.sourceId)
      if (row.isChecked === shouldBeChecked) {
        continue
      }
      if (toggleRowSelection(row.row, shouldBeChecked)) {
        appliedChanges += 1
      }
    }

    if (matchingIds.size === 0) {
      window.alert(uiCopy.noGroupSourcesFound(group.name))
      return
    }

    setIsGroupsMenuOpen(false)
    setGroupsSearchText("")
    // Se o grupo ja estiver aplicado, mantem fluxo silencioso (sem popup).
    if (appliedChanges === 0) {
      return
    }
  }

  const dismissDeleteToast = useCallback(() => {
    setDeleteToast({ status: "idle", message: "", progress: 0 })
  }, [])

  const closeDeleteConfirmDialog = useCallback(() => {
    if (isDeletingSources) {
      return
    }
    setIsDeleteConfirmOpen(false)
    setPendingDeleteRows([])
  }, [isDeletingSources])

  const requestDeleteSelectedSources = useCallback(() => {
    if (isDeletingSources) {
      return
    }

    const currentNotebookId = resolveNotebookIdFromRoute() ?? notebookId
    if (!currentNotebookId) {
      setDeleteToast({
        status: "error",
        message: deleteCopy.notebookMissing,
        progress: 0
      })
      return
    }

    const selectedRows = collectSelectedSourceRows()
    if (selectedRows.length === 0) {
      setDeleteToast({
        status: "info",
        message: deleteCopy.selectAtLeastOne,
        progress: 0
      })
      return
    }

    setPendingDeleteRows(selectedRows)
    setIsDeleteConfirmOpen(true)
  }, [deleteCopy, isDeletingSources, notebookId])

  const deleteSelectedSources = useCallback(async () => {
    if (isDeletingSources) {
      return
    }

    const currentNotebookId = resolveNotebookIdFromRoute() ?? notebookId
    if (!currentNotebookId) {
      setDeleteToast({
        status: "error",
        message: deleteCopy.notebookMissing,
        progress: 0
      })
      setIsDeleteConfirmOpen(false)
      setPendingDeleteRows([])
      return
    }

    const selectedRows = pendingDeleteRows
    if (selectedRows.length === 0) {
      setDeleteToast({
        status: "info",
        message: deleteCopy.selectAtLeastOne,
        progress: 0
      })
      setIsDeleteConfirmOpen(false)
      return
    }

    setIsDeleteConfirmOpen(false)
    setDeleteToast({
      status: "running",
      message: deleteCopy.deletingMessage(selectedRows.length),
      progress: 10
    })
    setIsDeletingSources(true)
    try {
      const explicitBackendSourceIds = selectedRows
        .map((row) => String(row.backendId ?? "").trim())
        .filter(Boolean)

      const response = await sendBackgroundCommand<{
        deletedCount?: number
        total?: number
        deletedCandidateIndexList?: number[]
        deletedSourceIdList?: string[]
        deletedSourceTitleList?: string[]
        skippedSourceTitleList?: string[]
        failedSourceTitleList?: string[]
        message?: string
      }>(MESSAGE_ACTIONS.CMD_DELETE_NOTEBOOK_SOURCES, {
        notebookId: currentNotebookId,
        sourceIds: explicitBackendSourceIds,
        sources: selectedRows.map((row) => ({
          sourceId: row.sourceId,
          backendId: row.backendId ?? undefined,
          sourceTitle: row.sourceTitle,
          rowIndex: row.sourceIndex
        }))
      })

      if (!response.success) {
        throw new Error(response.error ?? deleteCopy.genericDeleteError)
      }

      const payload = response.payload ?? response.data
      const deletedSourceIds = Array.isArray(payload?.deletedSourceIdList)
        ? payload.deletedSourceIdList
        : []
      const deletedCandidateIndexes = Array.isArray(payload?.deletedCandidateIndexList)
        ? payload.deletedCandidateIndexList.filter((value) => Number.isInteger(value) && value >= 0)
        : []
      const deletedSet = new Set(deletedSourceIds)
      const deletedIndexSet = new Set(deletedCandidateIndexes)
      for (let index = 0; index < selectedRows.length; index += 1) {
        const selectedRow = selectedRows[index]
        const backendId = String(selectedRow.backendId ?? "").trim()
        const matchedByBackendId = backendId ? deletedSet.has(backendId) : false
        const matchedByCandidateIndex = deletedIndexSet.has(index)
        if (matchedByBackendId || matchedByCandidateIndex) {
          selectedRow.row.remove()
        }
      }

      const deletedCount = Number(payload?.deletedCount ?? 0)
      const skippedCount = Array.isArray(payload?.skippedSourceTitleList)
        ? payload.skippedSourceTitleList.length
        : 0
      const failedCount = Array.isArray(payload?.failedSourceTitleList)
        ? payload.failedSourceTitleList.length
        : 0

      if (deletedCount > 0) {
        const parts = [deleteCopy.deletedMessage(deletedCount)]
        if (skippedCount > 0) {
          parts.push(deleteCopy.unmappedMessage(skippedCount))
        }
        if (failedCount > 0) {
          parts.push(deleteCopy.failedMessage(failedCount))
        }
        setDeleteToast({
          status: failedCount > 0 ? "info" : "success",
          message: parts.join(" "),
          progress: 100
        })
      } else {
        setDeleteToast({
          status: failedCount > 0 ? "error" : "info",
          message: String(payload?.message ?? deleteCopy.noneDeletedMessage),
          progress: failedCount > 0 ? 0 : 100
        })
      }
    } catch (error) {
      setDeleteToast({
        status: "error",
        message: error instanceof Error ? error.message : deleteCopy.genericDeleteError,
        progress: 0
      })
    } finally {
      setIsDeletingSources(false)
      setPendingDeleteRows([])
    }
  }, [deleteCopy, isDeletingSources, notebookId, pendingDeleteRows])

  if (!isVisible) {
    return null
  }

  return (
    <section
      onMouseDown={stopPanelEventPropagation}
      onClick={stopPanelEventPropagation}
      className="relative mt-2 w-full overflow-visible rounded-[22px] border border-white/[0.06] bg-[#08090b] p-3.5 shadow-[0_12px_28px_rgba(0,0,0,0.18)]">
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
              placeholder={uiCopy.searchPlaceholder}
              className="w-full bg-transparent text-[12px] text-white outline-none placeholder:text-[#6f7580]"
            />
          </div>

          <div className="inline-flex shrink-0 items-center gap-1 rounded-[16px] border border-white/[0.06] bg-[#0d0f12] p-1">
            <DownloadSourcesButton onClick={openExportPanel} />
            <PanelActionButton title={uiCopy.refreshGoogleDocsTitle} onClick={refreshSources}>
              <RefreshCw size={15} strokeWidth={1.8} />
            </PanelActionButton>
            <div ref={groupsMenuRef} className="relative">
              <PanelActionButton
                title={uiCopy.sourceGroupsTitle}
                onClick={toggleSavedSourceGroupsMenu}
                active={isGroupsMenuOpen}>
                <SquareCheck size={15} strokeWidth={1.8} />
              </PanelActionButton>
              {isGroupsMenuOpen ? (
                <div className="absolute right-0 top-[calc(100%+8px)] z-[9999] w-[310px] rounded-[16px] border border-white/[0.08] bg-[#0d1015] p-2 shadow-[0_18px_40px_rgba(0,0,0,0.45)]">
                  <div className="mb-2 flex items-center gap-2 rounded-[11px] border border-white/[0.08] bg-[#0a0d12] px-2.5 py-2">
                    <Search size={13} strokeWidth={1.8} className="text-[#7f8794]" />
                    <input
                      type="search"
                      value={groupsSearchText}
                      onChange={(event) => setGroupsSearchText(event.target.value)}
                      placeholder={uiCopy.groupsSearchPlaceholder}
                      className="w-full bg-transparent text-[11px] text-white outline-none placeholder:text-[#6d7380]"
                    />
                  </div>
                  <div className="max-h-[112px] space-y-1 overflow-y-auto pr-0.5">
                    {filteredNotebookSavedGroups.length === 0 ? (
                      <p className="px-2 py-1.5 text-[11px] text-[#9aa2af]">{uiCopy.noSavedGroups}</p>
                    ) : (
                      filteredNotebookSavedGroups.map((group) => (
                        <div
                          key={group.id}
                          className="group relative rounded-[10px] border border-transparent transition-colors hover:border-white/[0.08] hover:bg-[#131823]">
                          <button
                            type="button"
                            onClick={() => applySavedSelectionGroup(group.id)}
                            className="block w-full px-2.5 py-2 pr-10 text-left text-[12px] text-white">
                            <span className="block truncate font-medium">{group.name}</span>
                            <span className="block text-[10px] text-[#8590a0]">
                              {uiCopy.groupCountLabel(resolveSavedGroupSelectionCount(group))}
                            </span>
                          </button>
                          <button
                            type="button"
                            title={uiCopy.deleteGroupTitle}
                            aria-label={uiCopy.deleteGroupAriaLabel(group.name)}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              removeSavedSelectionGroup(group.id)
                            }}
                            className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[8px] border border-transparent text-[#6f7784] opacity-0 transition-all group-hover:opacity-100 hover:border-[#facc15]/30 hover:bg-[#2a2208] hover:text-[#facc15]">
                            <Trash2 size={13} strokeWidth={1.9} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            <PanelActionButton
              title={deleteCopy.deleteActionLabel}
              onClick={() => {
                requestDeleteSelectedSources()
              }}
              disabled={isDeletingSources}>
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
                  {uiCopy.filterLabels[filter.labelKey]}
                </button>
              )
            })}

            <button
              type="button"
              onClick={openSaveSelectionDialog}
                className={[
                  "ml-auto rounded-full border px-3.5 py-1.5 text-[11px] font-medium transition-colors",
                  "mt-0 ml-6",
                isSaveSelectionDialogOpen
                  ? "border-[#facc15]/45 bg-[#3a300b] text-[#fff3b8] hover:bg-[#46380d]"
                  : "border-white/[0.06] bg-[#101216] text-white hover:bg-[#14171c]"
              ].join(" ")}>
              {uiCopy.saveViewButton}
            </button>
          </div>
        </div>
      </div>
      {isSaveSelectionDialogOpen ? (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 px-4"
          onMouseDown={closeSaveSelectionDialog}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={uiCopy.saveDialogAriaLabel}
            onMouseDown={(event) => event.stopPropagation()}
            className="w-full max-w-[480px] rounded-[16px] border border-white/[0.08] bg-[#0d1015] p-5 shadow-[0_18px_40px_rgba(0,0,0,0.45)]">
            <div className="mb-3 flex items-center gap-2">
              <SquareCheck size={14} strokeWidth={1.9} className="text-[#facc15]" />
              <h3 className="text-[15px] font-semibold text-white">{uiCopy.saveDialogTitle}</h3>
            </div>
            <div className="rounded-[11px] border border-white/[0.08] bg-[#0a0d12] px-3 py-2.5">
              <input
                autoFocus
                maxLength={50}
                value={saveSelectionName}
                onChange={(event) => setSaveSelectionName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    saveCurrentSelectionAsGroup()
                  } else if (event.key === "Escape") {
                    event.preventDefault()
                    closeSaveSelectionDialog()
                  }
                }}
                placeholder={uiCopy.saveDialogPlaceholder}
                className="w-full bg-transparent text-[12px] text-white outline-none placeholder:text-[#727a88]"
              />
            </div>
            <div className="mt-1 text-right text-[10px] text-[#7f8794]">
              {Math.min(50, saveSelectionName.length)}/50
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeSaveSelectionDialog}
                className="rounded-full border border-white/[0.1] bg-[#12161d] px-4 py-1.5 text-[12px] text-white transition-colors hover:bg-[#171c25]">
                {uiCopy.saveDialogCancel}
              </button>
              <button
                type="button"
                onClick={saveCurrentSelectionAsGroup}
                className="rounded-full border border-[#facc15]/35 bg-[#2a2208] px-4 py-1.5 text-[12px] font-semibold text-[#fff1a6] transition-colors hover:bg-[#33290a]">
                {uiCopy.saveDialogSave}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isDeleteConfirmOpen ? (
        <div
          className="fixed inset-0 z-[160] flex items-center justify-center bg-black/45 px-4"
          onMouseDown={closeDeleteConfirmDialog}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={deleteCopy.confirmAriaLabel}
            onMouseDown={(event) => event.stopPropagation()}
            className="w-full max-w-[500px] rounded-[16px] border border-white/[0.08] bg-[#0d1015] p-5 shadow-[0_18px_40px_rgba(0,0,0,0.45)]">
            <div className="mb-3 flex items-center gap-2">
              <Trash2 size={14} strokeWidth={1.9} className="text-[#facc15]" />
              <h3 className="text-[15px] font-semibold text-white">{deleteCopy.confirmTitle}</h3>
            </div>
            <p className="text-[12px] leading-relaxed text-[#b7beca]">
              {deleteCopy.confirmBody(pendingDeleteRows.length)}
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeDeleteConfirmDialog}
                disabled={isDeletingSources}
                className="rounded-full border border-white/[0.1] bg-[#12161d] px-4 py-1.5 text-[12px] text-white transition-colors hover:bg-[#171c25] disabled:cursor-not-allowed disabled:opacity-50">
                {deleteCopy.cancelLabel}
              </button>
              <button
                type="button"
                onClick={() => {
                  void deleteSelectedSources()
                }}
                disabled={isDeletingSources}
                className="rounded-full border border-[#facc15]/35 bg-[#2a2208] px-4 py-1.5 text-[12px] font-semibold text-[#fff1a6] transition-colors hover:bg-[#33290a] disabled:cursor-not-allowed disabled:opacity-50">
                {isDeletingSources ? deleteCopy.deletingLabel : deleteCopy.confirmDeleteLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {deleteToast.status !== "idle" ? (
        <aside className="fixed bottom-4 right-4 z-[2147483647] w-[min(370px,calc(100vw-28px))] overflow-hidden rounded-[18px] border border-white/[0.1] bg-[#08090b] text-[#d6dae0] shadow-[0_18px_44px_rgba(0,0,0,0.5)]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-85"
            style={{
              backgroundImage: "radial-gradient(circle, rgba(255, 255, 255, 0.065) 1px, transparent 1px)",
              backgroundSize: "14px 14px",
              backgroundPosition: "0 0"
            }}
          />
          <div className="relative z-[1] p-3.5">
            <header className="mb-2 flex items-center justify-between gap-2">
              <strong className="text-[20px] font-semibold leading-none tracking-tight text-white">
                {deleteCopy.toastTitle}
              </strong>
              <button
                type="button"
                aria-label={deleteCopy.closeToastLabel}
                onClick={dismissDeleteToast}
                className="inline-flex h-7 w-7 items-center justify-center rounded-[10px] border border-white/[0.12] bg-[#101319] text-[#8f98a6] transition-colors hover:text-white">
                <X size={14} strokeWidth={1.8} />
              </button>
            </header>
            <p className="mb-2 text-sm text-[#b5bcc8]">{deleteToast.message}</p>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.1]">
              <div
                className={[
                  "h-full rounded-full transition-all duration-200",
                  deleteToast.status === "error"
                    ? "bg-[linear-gradient(90deg,#ef4444_0%,#f97316_100%)]"
                    : "bg-[linear-gradient(90deg,#60a5fa_0%,#22c55e_100%)]"
                ].join(" ")}
                style={{ width: `${Math.max(0, Math.min(100, deleteToast.progress))}%` }}
              />
            </div>
          </div>
        </aside>
      ) : null}
    </section>
  )
}

function stopPanelEventPropagation(event: { stopPropagation: () => void; nativeEvent?: Event }): void {
  event.stopPropagation()
  const native = event.nativeEvent as Event & { stopImmediatePropagation?: () => void }
  native?.stopImmediatePropagation?.()
}

function collectGDocRefreshCandidates(): SourcePanelRefreshCandidate[] {
  const rows = resolveSourceRows()
  const candidates: SourcePanelRefreshCandidate[] = []
  const seen = new Set<string>()

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const sourceType = inferSourceType(row)
    const title = String(extractSourceTitle(row) ?? "").trim() || `Google Doc ${index + 1}`
    const sourceUrl = resolveGoogleDocReferenceFromRow(row)
    const sourceId = resolveBackendSourceIdFromRow(row)
    const rowSignalSnapshot = String(row.innerText || row.textContent || "").toLowerCase()
    const hasWorkspaceIconToken =
      /\b(article|drive_spreadsheet|drive_presentation)\b/u.test(rowSignalSnapshot)
    const hasEditableDocExtension = /\.(docx?|odt|rtf)\b/u.test(title.toLowerCase())

    const isLikelyGDoc =
      sourceType === "GDocs" ||
      hasWorkspaceIconToken ||
      hasEditableDocExtension ||
      /google\s*docs?|docs\.google\.com|drive\.google\.com/iu.test(
        `${title} ${String(sourceUrl ?? "").trim()} ${String(row.textContent ?? "")}`
      )

    if (!isLikelyGDoc) {
      continue
    }

    const dedupeUrl = String(sourceUrl ?? "").trim().toLowerCase()
    const key = `${title.toLowerCase()}::${dedupeUrl}::${String(sourceId ?? "").toLowerCase()}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)

    candidates.push({
      title,
      docReference: sourceUrl || undefined,
      sourceUrl: sourceUrl || undefined,
      sourceId: sourceId ?? undefined
    })
  }

  return candidates
}

function resolveGoogleDocReferenceFromRow(row: HTMLElement): string | null {
  const directUrl = String(extractSourceUrl(row) ?? "").trim()
  if (directUrl && /docs\.google\.com|drive\.google\.com/iu.test(directUrl)) {
    return directUrl
  }

  const rowAttrs = [
    row.getAttribute("data-doc-id"),
    row.getAttribute("doc-id"),
    row.getAttribute("data-source-url"),
    row.getAttribute("data-url"),
    row.getAttribute("href"),
    row.getAttribute("data-href")
  ]

  for (const attrValue of rowAttrs) {
    const value = String(attrValue ?? "").trim()
    if (!value) {
      continue
    }
    if (/^[A-Za-z0-9_-]{20,}$/u.test(value)) {
      return value
    }
    if (/docs\.google\.com|drive\.google\.com/iu.test(value)) {
      return value
    }
  }

  const nestedWithDocId = row.querySelector<HTMLElement>("[data-doc-id],[doc-id]")
  if (nestedWithDocId) {
    const nestedDocId = String(
      nestedWithDocId.getAttribute("data-doc-id") ?? nestedWithDocId.getAttribute("doc-id") ?? ""
    ).trim()
    if (nestedDocId && /^[A-Za-z0-9_-]{20,}$/u.test(nestedDocId)) {
      return nestedDocId
    }
  }

  const fullText = String(row.innerText || row.textContent || "")
  const urlMatch = fullText.match(/https?:\/\/[^\s)\]}>"']+/iu)
  if (urlMatch?.[0] && /docs\.google\.com|drive\.google\.com/iu.test(urlMatch[0])) {
    return String(urlMatch[0]).trim()
  }

  const docIdMatch = fullText.match(/\b([A-Za-z0-9_-]{25,})\b/u)
  if (docIdMatch?.[1]) {
    return String(docIdMatch[1]).trim()
  }

  return null
}

function resolveBackendSourceIdFromRow(row: HTMLElement): string | null {
  const directCandidates = [
    row.getAttribute("data-source-id"),
    row.getAttribute("source-id"),
    row.getAttribute("data-id"),
    row.getAttribute("data-doc-id"),
    row.getAttribute("data-resource-id"),
    row.getAttribute("data-source"),
    row.getAttribute("id")
  ]

  for (const candidate of directCandidates) {
    const value = String(candidate ?? "").trim()
    if (value && !value.startsWith("minddock-") && !value.startsWith("source-picker")) {
      return value
    }
  }

  const nestedNode = row.querySelector<HTMLElement>(
    "[data-source-id],[source-id],[data-id],[data-doc-id],[data-resource-id],[data-source]"
  )
  if (!nestedNode) {
    return null
  }

  const nestedCandidates = [
    nestedNode.getAttribute("data-source-id"),
    nestedNode.getAttribute("source-id"),
    nestedNode.getAttribute("data-id"),
    nestedNode.getAttribute("data-doc-id"),
    nestedNode.getAttribute("data-resource-id"),
    nestedNode.getAttribute("data-source")
  ]

  for (const candidate of nestedCandidates) {
    const value = String(candidate ?? "").trim()
    if (value && !value.startsWith("minddock-")) {
      return value
    }
  }

  return null
}

interface SelectableSourceRow {
  sourceId: string
  backendId: string | null
  sourceTitle: string
  sourceIndex: number
  row: HTMLElement
  isChecked: boolean
}

function resolveRowCheckboxControl(row: HTMLElement): HTMLElement | null {
  const input = row.querySelector<HTMLInputElement>("input[type='checkbox']")
  if (input) {
    return input
  }
  const roleCheckbox = row.querySelector<HTMLElement>("[role='checkbox']")
  if (roleCheckbox) {
    return roleCheckbox
  }
  return null
}

function readCheckboxCheckedState(control: HTMLElement | null): boolean {
  if (!control) {
    return false
  }
  if (control instanceof HTMLInputElement) {
    return control.checked
  }
  const ariaChecked = String(control.getAttribute("aria-checked") ?? "").toLowerCase()
  return ariaChecked === "true"
}

function collectSelectedSourceRows(includeUnchecked = false): SelectableSourceRow[] {
  const rows = resolveSourceRows()
  const selected: SelectableSourceRow[] = []

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (isIgnoredUiRow(row)) {
      continue
    }

    const control = resolveRowCheckboxControl(row)
    if (!control) {
      continue
    }

    const sourceTitle = resolveSourceTitleForSelectionRow(row, index)
    const backendId = resolveBackendSourceIdFromRow(row)
    const sourceId = resolveStableSourceSelectionId(row, sourceTitle, index)
    if (!sourceId) {
      continue
    }

    const isChecked = readCheckboxCheckedState(control)
    if (!includeUnchecked && !isChecked) {
      continue
    }

    selected.push({
      row,
      sourceId,
      backendId,
      sourceTitle,
      sourceIndex: index,
      isChecked
    })
  }

  return selected
}

function resolveSourceTitleForSelectionRow(row: HTMLElement, index: number): string {
  const extractedTitle = String(extractSourceTitle(row) ?? "").trim()
  if (extractedTitle) {
    return extractedTitle
  }

  const rawText = String(row.innerText || row.textContent || "")
  const lines = rawText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    const normalized = normalizeSnapshotValue(line)
    if (!normalized) {
      continue
    }
    if (SOURCE_ICON_TOKEN_ONLY_REGEX.test(normalized)) {
      continue
    }
    return line
  }

  return `Fonte ${index + 1}`
}

function resolveSemanticSourceTextForDetection(row: HTMLElement): string {
  const extractedTitle = String(extractSourceTitle(row) ?? "").trim()
  if (extractedTitle) {
    const normalizedExtracted = normalizeSnapshotValue(extractedTitle)
    if (normalizedExtracted && !SOURCE_ICON_TOKEN_ONLY_REGEX.test(normalizedExtracted)) {
      return extractedTitle
    }
  }

  const rawText = String(row.innerText || row.textContent || "")
  const lines = rawText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    const normalized = normalizeSnapshotValue(line)
    if (!normalized || SOURCE_ICON_TOKEN_ONLY_REGEX.test(normalized)) {
      continue
    }
    return line
  }

  return extractedTitle || rawText.trim()
}

function resolveStableSourceSelectionId(row: HTMLElement, sourceTitle: string, index: number): string {
  const preferred = [
    row.getAttribute("data-source-id"),
    row.getAttribute("source-id"),
    row.getAttribute("data-id"),
    row.getAttribute("data-resource-id")
  ]
  for (const candidate of preferred) {
    const normalized = String(candidate ?? "").trim()
    if (normalized) {
      return normalized
    }
  }

  return `dom-${normalizeSnapshotValue(sourceTitle)}-${index + 1}`
}

function toggleRowSelection(row: HTMLElement, shouldBeChecked: boolean): boolean {
  const control = resolveRowCheckboxControl(row)
  if (!control) {
    return false
  }

  const currentChecked = readCheckboxCheckedState(control)
  if (currentChecked === shouldBeChecked) {
    return false
  }

  control.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
  control.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }))
  control.click()

  let nextChecked = readCheckboxCheckedState(control)
  if (nextChecked === shouldBeChecked) {
    return true
  }

  if (control instanceof HTMLInputElement) {
    control.checked = shouldBeChecked
    control.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }))
    control.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }))
    nextChecked = readCheckboxCheckedState(control)
  }

  if (nextChecked === shouldBeChecked) {
    return true
  }

  const fallbackClickable = control.closest<HTMLElement>("label, button, [role='checkbox'], div")
  if (fallbackClickable && fallbackClickable !== control) {
    fallbackClickable.click()
    nextChecked = readCheckboxCheckedState(control)
    return nextChecked === shouldBeChecked
  }

  return false
}

function normalizeSnapshotValue(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function resolveSavedGroupSelectionCount(group: SavedSourceSelectionGroup): number {
  const parsed = Number(group.selectionCount)
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.max(1, Math.round(parsed))
  }
  return Math.max(1, group.entries.length)
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
  const semanticText = normalizeSnapshotValue(resolveSemanticSourceTextForDetection(row))
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
  const firstWord = String(text.split(" ")[0] ?? "").trim()
  const textLeaningSnapshot = `${semanticText} ${rawTypeSignals} ${title}`.trim()
  const hasTextSelectionSignal =
    /\[?\s*(selecao|selecaoes|selection|selections)\s*\]?|\bcopied text\b|\bpasted text\b|\btexto\b|\btext\b/u.test(
      textLeaningSnapshot
    )
  const hasConcreteImageSignal =
    /(\.png(\?|$)|\.jpe?g(\?|$)|\.gif(\?|$)|\.webp(\?|$)|\.svg(\?|$)|\bimage\/(png|jpeg|gif|webp|svg)\b)/.test(
      `${hrefSnapshot} ${mediaSnapshot} ${extractedUrl} ${rawTypeSignals}`
    ) ||
    row.querySelector("img[src*='.png'], img[src*='.jpg'], img[src*='.jpeg'], img[src*='.gif'], img[src*='.webp'], img[src*='.svg']") !== null
  
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
    if (hasTextSelectionSignal && !hasConcreteImageSignal) {
      return "TEXT"
    }
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
    return "GDOC"
  }

  // If the DOM exposes a direct type-like value, normalize it first.
  const normalizedFromRawType = normalizeRawSourceType(rawTypeSignals)
  if (normalizedFromRawType) {
    if (normalizedFromRawType === "IMAGE" && !hasConcreteImageSignal) {
      return "TEXT"
    }
    return normalizedFromRawType
  }

  // Fallback priority pass on whole snapshot.
  const normalizedFromSnapshot = normalizeRawSourceType(fullSnapshot)
  if (normalizedFromSnapshot) {
    if (normalizedFromSnapshot === "IMAGE" && !hasConcreteImageSignal) {
      return "TEXT"
    }
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

  return /search sources|filtrar fontes|filter sources|save view|salvar visualizacao|source groups|grupos de fontes|download sources|baixar fontes|export visible sources|refresh google docs sources|atualizar fontes do google docs|clear filters and reset panel/.test(
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
    /adicionar fontes|add sources|search sources|filtrar fontes|save view|salvar visualizacao|source groups|grupos de fontes|export visible sources|download sources|baixar fontes|refresh google docs sources|atualizar fontes do google docs|clear filters and reset panel/.test(
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

  for (const row of visibleSourceNodes) {
    if (isIgnoredUiRow(row)) {
      continue
    }

    const detectedType = detectSourceTypeFromRow(row)
    const matchesType = filterSet.has("ALL") || filterSet.has(detectedType)
    const rowSearchSnapshot = hasSearch ? collectRowSearchSnapshot(row) : ""
    const matchesSearch = !hasSearch || rowSearchSnapshot.includes(normalizedSearch)
    const shouldShow = matchesType && matchesSearch

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
  disabled?: boolean
}) {
  const { title, onClick, children, active = false, disabled = false } = props

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={swallowPanelActionClick}
      onClick={(event) => {
        swallowPanelActionClick(event)
        if (disabled) {
          return
        }
        onClick()
      }}
      className={[
        "inline-flex h-8 w-8 items-center justify-center rounded-[11px] border text-[#8e959e] transition-colors",
        disabled ? "cursor-not-allowed opacity-50" : "",
        active
          ? "border-[#facc15]/30 bg-[#221c08] text-[#facc15]"
          : "border-white/[0.06] bg-[#131519] hover:bg-[#171a1f] hover:text-white"
      ].join(" ")}>
      {children}
    </button>
  )
}

function swallowPanelActionClick(event: {
  preventDefault: () => void
  stopPropagation: () => void
  nativeEvent?: Event
}): void {
  event.preventDefault()
  event.stopPropagation()
  const native = event.nativeEvent as Event & { stopImmediatePropagation?: () => void }
  native?.stopImmediatePropagation?.()
}

async function sendBackgroundCommand<T = unknown>(
  action: string,
  payload?: Record<string, unknown>
): Promise<StandardResponse<T>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        action,
        command: action,
        payload
      },
      (response: StandardResponse<T> & { data?: T }) => {
        if (chrome.runtime.lastError?.message) {
          resolve({
            success: false,
            error: chrome.runtime.lastError.message
          })
          return
        }

        resolve(response ?? { success: false, error: "No response from the background script." })
      }
    )
  })
}
