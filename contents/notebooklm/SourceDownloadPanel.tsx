import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Eye, ListFilter, X } from "lucide-react"
import {
  MESSAGE_ACTIONS,
  type StandardResponse
} from "~/lib/contracts"
import { base64ToBytes } from "~/lib/base64-bytes"
import type { Source } from "~/lib/types"
import {
  buildDocxBytesFromText,
  buildUniqueFilename,
  formatAsDocxText,
  formatAsPdfText,
  buildZip,
  formatAsMarkdown,
  formatAsText,
  snippetsToSummaryText,
  triggerDownload,
  type DownloadFormat,
  type SourceExportRecord
} from "~/lib/source-download"
import {
  SOURCE_DOWNLOAD_MODAL_STATE_EVENT,
  SOURCE_PANEL_EXPORT_EVENT,
  SOURCE_PANEL_REFRESH_EVENT,
  dispatchSourcePanelToggle,
  extractSourceTitle,
  extractSourceUrl,
  extractUrlFromSnippets,
  formatTitleList,
  inferSourceType,
  resolveNotebookIdFromRoute,
  resolveSourceActionsHost,
  resolveSourceRows,
  type SourcePanelRefreshCandidate,
  type SourcePanelRefreshDetail
} from "./sourceDom"
import {
  IsolatedResourceViewerDialog,
  type IsolatedResourceAssetData
} from "./IsolatedResourceViewerDialog"
import { resolveSourceDownloadUiCopy } from "./notebooklmI18n"

interface SourceRow {
  sourceId: string
  backendId: string | null
  sourceTitle: string
  sourceUrl?: string
  sourceKind: "youtube" | "document"
  isGDoc: boolean
}

interface DownloadPreparedFile {
  filename: string
  bytes: Uint8Array
  mimeType: string
}

interface PreviewDraft extends SourceExportRecord {
  editableContent: string
}

type ToastStatus = "idle" | "running" | "success" | "error"

interface ToastState {
  status: ToastStatus
  message: string
  progress: number
}

interface IAssetMetadata extends IsolatedResourceAssetData {}
type GDocRefreshCandidate = SourcePanelRefreshCandidate

const encoder = new TextEncoder()
const DOWNLOAD_FORMAT_OPTIONS: DownloadFormat[] = ["markdown", "text", "pdf", "docx"]
const DOWNLOAD_FORMAT_SUBTITLES: Record<DownloadFormat, string> = {
  markdown: ".md",
  text: ".txt",
  pdf: ".pdf",
  docx: ".docx"
}

export function SourceDownloadPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [isNativePanelCollapsed, setIsNativePanelCollapsed] = useState(false)
  const [isFilterPanelVisible, setIsFilterPanelVisible] = useState(true)
  const [isLoadingSources, setIsLoadingSources] = useState(false)
  const [isRunningDownload, setIsRunningDownload] = useState(false)
  const [isSyncingGDocs, setIsSyncingGDocs] = useState(false)
  const [format, setFormat] = useState<DownloadFormat>("markdown")
  const [sourceSearch, setSourceSearch] = useState("")
  const [sources, setSources] = useState<SourceRow[]>([])
  const [sourceLoadError, setSourceLoadError] = useState<string | null>(null)
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set())
  const [isPreparingPreview, setIsPreparingPreview] = useState(false)
  const [isPreviewMode, setIsPreviewMode] = useState(false)
  const [previewDrafts, setPreviewDrafts] = useState<PreviewDraft[]>([])
  const [previewLoadError, setPreviewLoadError] = useState<string | null>(null)
  const [previewSkippedCount, setPreviewSkippedCount] = useState(0)
  const [activePreviewAsset, setActivePreviewAsset] = useState<IAssetMetadata | null>(null)
  const [toast, setToast] = useState<ToastState>({
    status: "idle",
    message: "",
    progress: 0
  })
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null)
  const previewBlobUrlRef = useRef<string | null>(null)
  const uiCopy = useMemo(() => resolveSourceDownloadUiCopy(), [])

  const selectedCount = selectedSourceIds.size
  const downloadFormatMeta = useMemo<Record<DownloadFormat, { label: string; subtitle: string; noTranslate?: boolean }>>(
    () => ({
      markdown: { label: uiCopy.formatLabelMarkdown, subtitle: DOWNLOAD_FORMAT_SUBTITLES.markdown },
      text: { label: uiCopy.formatLabelText, subtitle: DOWNLOAD_FORMAT_SUBTITLES.text },
      pdf: { label: uiCopy.formatLabelPdf, subtitle: DOWNLOAD_FORMAT_SUBTITLES.pdf },
      docx: { label: uiCopy.formatLabelDocx, subtitle: DOWNLOAD_FORMAT_SUBTITLES.docx, noTranslate: true }
    }),
    [uiCopy]
  )

  const filteredSources = useMemo(() => {
    const query = sourceSearch.trim().toLowerCase()
    if (!query) {
      return sources
    }

    return sources.filter((source) => source.sourceTitle.toLowerCase().includes(query))
  }, [sourceSearch, sources])
  const filteredSelectedCount = useMemo(
    () => filteredSources.filter((source) => selectedSourceIds.has(source.sourceId)).length,
    [filteredSources, selectedSourceIds]
  )
  const hasFilteredSources = filteredSources.length > 0
  const areAllFilteredSourcesSelected = hasFilteredSources && filteredSelectedCount === filteredSources.length
  const hasPartialFilteredSelection = filteredSelectedCount > 0 && !areAllFilteredSourcesSelected

  useEffect(() => {
    const checkbox = selectAllCheckboxRef.current
    if (!checkbox) {
      return
    }
    checkbox.indeterminate = hasPartialFilteredSelection
  }, [hasPartialFilteredSelection])

  useEffect(() => {
    const evaluateSourcePanelCollapsed = (): void => {
      const host = resolveSourceActionsHost()
      if (!host) {
        setIsNativePanelCollapsed(false)
        return
      }

      const width = host.getBoundingClientRect().width
      setIsNativePanelCollapsed(width > 0 && width <= 88)
    }

    evaluateSourcePanelCollapsed()
    const timer = window.setInterval(evaluateSourcePanelCollapsed, 360)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (toast.status === "idle" || toast.status === "running") {
      return
    }

    const timeout = window.setTimeout(() => {
      setToast({ status: "idle", message: "", progress: 0 })
    }, toast.status === "error" ? 5200 : 3000)

    return () => window.clearTimeout(timeout)
  }, [toast.status])

  useEffect(() => {
    if (!isSyncingGDocs) {
      return
    }

    const timer = window.setInterval(() => {
      setToast((currentToast) => {
        if (currentToast.status !== "running") {
          return currentToast
        }

        const nextProgress = Math.min(88, currentToast.progress + (currentToast.progress < 58 ? 8 : 4))
        return {
          ...currentToast,
          progress: nextProgress
        }
      })
    }, 260)

    return () => window.clearInterval(timer)
  }, [isSyncingGDocs])

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(SOURCE_DOWNLOAD_MODAL_STATE_EVENT, {
        detail: { isOpen }
      })
    )
  }, [isOpen])

  useEffect(
    () => () => {
      window.dispatchEvent(
        new CustomEvent(SOURCE_DOWNLOAD_MODAL_STATE_EVENT, {
          detail: { isOpen: false }
        })
      )
    },
    []
  )

  const releaseManagedPreviewBlob = useCallback(() => {
    const currentBlobUrl = previewBlobUrlRef.current
    if (currentBlobUrl && currentBlobUrl.startsWith("blob:")) {
      URL.revokeObjectURL(currentBlobUrl)
    }
    previewBlobUrlRef.current = null
  }, [])

  const dismissPreviewOverlay = useCallback(() => {
    setActivePreviewAsset(null)
  }, [])

  useEffect(() => {
    if (activePreviewAsset !== null) {
      return
    }
    releaseManagedPreviewBlob()
  }, [activePreviewAsset, releaseManagedPreviewBlob])

  useEffect(
    () => () => {
      releaseManagedPreviewBlob()
    },
    [releaseManagedPreviewBlob]
  )

  const loadSources = useCallback(async (): Promise<string> => {
    const notebookId = resolveNotebookIdFromRoute()
    if (!notebookId) {
      throw new Error(uiCopy.routeNotebookMissing)
    }

    setIsLoadingSources(true)
    setSourceLoadError(null)
    try {
      const response = await sendBackgroundCommand(MESSAGE_ACTIONS.CMD_GET_NOTEBOOK_SOURCES, {
        notebookId
      })
      if (!response.success) {
        throw new Error(response.error ?? uiCopy.backendListFailed)
      }

      const responsePayload = response.payload ?? response.data
      const sourceList = resolveSourcePayloadList(responsePayload).map(toSourceRow)
      const validSources = sourceList.filter(
        (source) => source.sourceTitle.trim().length > 0
      )

      if (validSources.length === 0) {
        throw new Error(uiCopy.backendNoSources)
      }

      console.debug(
        "[sources:backend]",
        validSources.map((source) => ({ id: source.backendId, title: source.sourceTitle }))
      )

      setSources(validSources)
      setSelectedSourceIds(new Set())
      setSourceLoadError(null)

      return notebookId
    } catch (error) {
      const fallbackSources = resolveSourceRowsFromDom()
      if (fallbackSources.length > 0) {
        setSources(fallbackSources)
        setSelectedSourceIds(new Set())
        setSourceLoadError(null)
        const fallbackReason = error instanceof Error ? error.message : String(error)
        console.debug(
          `[sources:backend] fallback to DOM source rows | reason: ${fallbackReason} | count: ${fallbackSources.length}`
        )
        return notebookId
      }

      const message = error instanceof Error ? error.message : uiCopy.loadSourcesFailed
      setSources([])
      setSelectedSourceIds(new Set())
      setSourceLoadError(message)
      throw error
    } finally {
      setIsLoadingSources(false)
    }
  }, [uiCopy.backendListFailed, uiCopy.backendNoSources, uiCopy.loadSourcesFailed, uiCopy.routeNotebookMissing])

  const openModal = useCallback(async () => {
    setSourceSearch("")
    setIsOpen(true)
    setIsPreviewMode(false)
    setPreviewDrafts([])
    setPreviewLoadError(null)
    setPreviewSkippedCount(0)
    setActivePreviewAsset(null)
    setSourceLoadError(null)
    setToast({ status: "idle", message: "", progress: 0 })

    try {
      await loadSources()
    } catch (error) {
      setToast({
        status: "error",
        message: error instanceof Error ? error.message : uiCopy.openModalFailed,
        progress: 0
      })
    }
  }, [loadSources, uiCopy.openModalFailed])

  const closeModal = useCallback(() => {
    if (isRunningDownload || isSyncingGDocs) {
      return
    }

    setActivePreviewAsset(null)
    setIsOpen(false)
  }, [isRunningDownload, isSyncingGDocs])

  const toggleSourceSelection = (sourceId: string): void => {
    setSelectedSourceIds((currentSet) => {
      const next = new Set(currentSet)
      if (next.has(sourceId)) {
        next.delete(sourceId)
      } else {
        next.add(sourceId)
      }

      return next
    })
  }

  const toggleSelectAllFilteredSources = useCallback((): void => {
    if (filteredSources.length === 0) {
      return
    }

    setSelectedSourceIds((currentSet) => {
      const next = new Set(currentSet)
      const shouldSelectAll = filteredSources.some((source) => !next.has(source.sourceId))
      for (const source of filteredSources) {
        if (shouldSelectAll) {
          next.add(source.sourceId)
        } else {
          next.delete(source.sourceId)
        }
      }
      return next
    })
  }, [filteredSources])

  const toggleFilterPanelVisibility = (): void => {
    const nextVisible = !isFilterPanelVisible
    setIsFilterPanelVisible(nextVisible)
    dispatchSourcePanelToggle(nextVisible)
  }

  const refreshGDocSources = useCallback(async (eventCandidates?: GDocRefreshCandidate[]) => {
    if (isSyncingGDocs) {
      return
    }

    const notebookId = resolveNotebookIdFromRoute()
    if (!notebookId) {
      console.log("[DIAG UI] sync abortado: notebookId ausente")
      setToast({
        status: "error",
        message: uiCopy.syncNotebookMissing,
        progress: 0
      })
      return
    }

    const refreshCandidates = resolveGDocRefreshCandidates(
      eventCandidates,
      sources,
      resolveSourceRowsFromDom()
    )

    console.log("[DIAG UI] requisicao sync iniciada", {
      notebookId,
      candidatesCount: refreshCandidates.length,
      candidates: refreshCandidates
    })

    setIsSyncingGDocs(true)
    setToast({
      status: "running",
      message:
        refreshCandidates.length > 0
          ? uiCopy.syncRefreshing
          : uiCopy.syncDetecting,
      progress: 10
    })

    try {
      const response = await sendBackgroundCommand(MESSAGE_ACTIONS.CMD_REFRESH_GDOC_SOURCES, {
        notebookId,
        gdocSources: refreshCandidates
      })
      console.log("[DIAG UI] resposta bruta sync", response)
      if (!response.success) {
        throw new Error(response.error ?? uiCopy.syncFailed)
      }

      const payload = (response.payload ?? response.data) as
        | {
            syncedCount?: number
            total?: number
            syncedSourceTitleList?: string[]
            skippedSourceTitleList?: string[]
            failedSourceTitleList?: string[]
            message?: string
          }
        | undefined

      const syncedCount = Number(payload?.syncedCount ?? 0)
      const total = Number(payload?.total ?? 0)
      const syncedSourceTitleList = Array.isArray(payload?.syncedSourceTitleList)
        ? payload.syncedSourceTitleList
        : []
      const skippedSourceTitleList = Array.isArray(payload?.skippedSourceTitleList)
        ? payload.skippedSourceTitleList
        : []
      const failedSourceTitleList = Array.isArray(payload?.failedSourceTitleList)
        ? payload.failedSourceTitleList
        : []

      console.log("[DIAG UI] payload sync parseado", {
        synced: syncedCount,
        total,
        message: payload?.message ?? null,
        syncedTitles: syncedSourceTitleList,
        skippedTitles: skippedSourceTitleList,
        failedTitles: failedSourceTitleList
      })

      if (syncedCount > 0) {
        setToast({
          status: "success",
          message: uiCopy.syncSuccess(syncedCount, total),
          progress: 100
        })
        // Aguarda o toast aparecer e recarrega para refletir o estado atualizado.
        await new Promise<void>((resolve) => setTimeout(resolve, 1500))
        window.location.reload()
      } else if (
        skippedSourceTitleList.length > 0 &&
        failedSourceTitleList.length === 0
      ) {
        setToast({
          status: "error",
          message: uiCopy.syncNoLinkedDocs,
          progress: 100
        })
      } else if (failedSourceTitleList.length > 0) {
        setToast({
          status: "error",
          message: `${uiCopy.syncFailed}: ${failedSourceTitleList.join(", ")}`,
          progress: 0
        })
      } else {
        setToast({
          status: "success",
          message: String(payload?.message ?? uiCopy.syncNoSources),
          progress: 100
        })
      }

      if (isOpen) {
        await loadSources().catch(() => undefined)
      }
    } catch (error) {
      console.log("[DIAG UI] erro no sync", error)
      setToast({
        status: "error",
        message: error instanceof Error ? error.message : uiCopy.syncFailed,
        progress: 0
      })
    } finally {
      setIsSyncingGDocs(false)
    }
  }, [
    isOpen,
    isSyncingGDocs,
    loadSources,
    sources,
    uiCopy.syncDetecting,
    uiCopy.syncFailed,
    uiCopy.syncNoLinkedDocs,
    uiCopy.syncNoSources,
    uiCopy.syncNotebookMissing,
    uiCopy.syncRefreshing,
    uiCopy.syncSuccess
  ])

  useEffect(() => {
    const onExport = () => {
      void openModal()
    }

    const onRefresh = (event: Event) => {
      const customEvent = event as CustomEvent<SourcePanelRefreshDetail | undefined>
      const eventCandidates = Array.isArray(customEvent.detail?.gdocSources)
        ? customEvent.detail?.gdocSources
        : undefined
      void refreshGDocSources(eventCandidates)
    }

    window.addEventListener(SOURCE_PANEL_EXPORT_EVENT, onExport)
    window.addEventListener(SOURCE_PANEL_REFRESH_EVENT, onRefresh)

    return () => {
      window.removeEventListener(SOURCE_PANEL_EXPORT_EVENT, onExport)
      window.removeEventListener(SOURCE_PANEL_REFRESH_EVENT, onRefresh)
    }
  }, [openModal, refreshGDocSources])

  const fetchExportRecordsForSelection = useCallback(async (selected: SourceRow[]): Promise<SourceExportRecord[]> => {
    const notebookId = resolveNotebookIdFromRoute()
    if (!notebookId) {
      throw new Error(uiCopy.fetchNotebookMissing)
    }

    const withValidBackend = selected.filter(
      (source) =>
        !!source.backendId &&
        String(source.backendId).trim().length > 0 &&
        !String(source.backendId).startsWith("minddock-source-")
    )
    const missingBackend = selected.filter(
      (source) =>
        !source.backendId ||
        String(source.backendId).trim().length === 0 ||
        String(source.backendId).startsWith("minddock-source-")
    )

    const selectedBackendIds = withValidBackend
      .map((source) => source.backendId)
      .filter((sourceId): sourceId is string => !!sourceId)
    console.debug("[download:selected]", {
      notebookId,
      sourceIds: selectedBackendIds,
      titles: selected.map((source) => source.sourceTitle)
    })

    let sourceSnippets: Record<string, string[]> = {}
    const failedSet = new Set<string>()
    if (selectedBackendIds.length > 0) {
      try {
        const response = await sendBackgroundCommand(MESSAGE_ACTIONS.CMD_GET_SOURCE_CONTENTS, {
          notebookId,
          sourceIds: selectedBackendIds
        })
        if (!response.success) {
          throw new Error(response.error ?? uiCopy.fetchSourceContentsFailed)
        }

        const payload = (response.payload ?? response.data) as
          | {
              sourceSnippets?: Record<string, string[]>
              failedSourceIds?: string[]
            }
          | undefined

        sourceSnippets = payload?.sourceSnippets ?? {}
        const failedSourceIds = Array.isArray(payload?.failedSourceIds) ? payload!.failedSourceIds : []
        for (const sourceId of failedSourceIds) {
          failedSet.add(sourceId)
        }
      } catch (error) {
        for (const sourceId of selectedBackendIds) {
          failedSet.add(sourceId)
        }
        const fallbackReason = error instanceof Error ? error.message : String(error)
        console.debug(
          `[content:fallback] using local fallback content | reason: ${fallbackReason} | sourceIds: ${selectedBackendIds.length}`
        )
      }
    }

    const exportRecords: SourceExportRecord[] = []
    const fallbackTitles: string[] = []
    const domFallbackIndex = buildDomSourceFallbackIndex()

    for (const source of selected) {
      const domFallback = resolveDomFallbackForSource(source, domFallbackIndex)
      const snippetsFromApi = resolveSourceSnippets(source, sourceSnippets)
      const snippets =
        snippetsFromApi.length > 0
          ? snippetsFromApi
          : domFallback?.contentLines ?? []

      if (snippets.length === 0) {
        fallbackTitles.push(source.sourceTitle)
        exportRecords.push(buildFallbackRecord(source, domFallback))
        continue
      }

      console.debug("[content:result]", {
        sourceId: source.sourceId,
        backendId: source.backendId,
        snippets: snippets.length,
        strategy: snippetsFromApi.length > 0 ? "api" : "dom-fallback"
      })

      let summaryText = ""
      try {
        summaryText = snippetsToSummaryText(snippets, source.sourceKind)
      } catch {
        summaryText = buildLooseSummaryText(snippets, source.sourceKind)
      }

      if (!summaryText.trim()) {
        fallbackTitles.push(source.sourceTitle)
        exportRecords.push(buildFallbackRecord(source, domFallback))
        continue
      }

      exportRecords.push({
        sourceId: source.sourceId,
        sourceTitle: source.sourceTitle,
        sourceUrl: source.sourceUrl || domFallback?.sourceUrl || extractUrlFromSnippets(snippets) || undefined,
        sourceKind: source.sourceKind,
        summaryText
      })
    }

    if (exportRecords.length === 0) {
      throw new Error(uiCopy.noContentForPreview)
    }

    if (fallbackTitles.length > 0 || missingBackend.length > 0) {
      console.debug(
        `[content:partial] fallbackCount: ${fallbackTitles.length} | missingBackendCount: ${missingBackend.length}`
      )
    }

    return exportRecords
  }, [uiCopy.fetchNotebookMissing, uiCopy.fetchSourceContentsFailed, uiCopy.noContentForPreview])

  const updateFormat = useCallback((nextFormat: DownloadFormat) => {
    setFormat(nextFormat)
    setPreviewDrafts((currentDrafts) =>
      currentDrafts.map((draft) => ({
        ...draft,
        editableContent: buildPreviewText(draft, nextFormat)
      }))
    )
  }, [])

  const handleTriggerPreview = useCallback(async () => {
    if (isPreparingPreview || isRunningDownload) {
      return
    }

    setToast({ status: "idle", message: "", progress: 0 })
    const selectedSources = sources.filter((source) => selectedSourceIds.has(source.sourceId))
    if (selectedSources.length === 0) {
      setToast({
        status: "error",
        message: uiCopy.selectAtLeastOnePreview,
        progress: 0
      })
      return
    }

    const focusedSource = selectedSources[0]
    setIsPreparingPreview(true)
    setPreviewLoadError(null)

    try {
      const exportRecords = await fetchExportRecordsForSelection([focusedSource])
      const primaryRecord = exportRecords[0]
      if (!primaryRecord) {
        throw new Error(uiCopy.previewBuildDataFailed)
      }

      const resolvedAsset = await resolvePreviewAssetMetadata(focusedSource, primaryRecord)
      releaseManagedPreviewBlob()
      if (resolvedAsset.managedBlobUrl) {
        previewBlobUrlRef.current = resolvedAsset.managedBlobUrl
      }
      setActivePreviewAsset(resolvedAsset.asset)
    } catch (error) {
      setToast({
        status: "error",
        message: error instanceof Error ? error.message : uiCopy.previewOpenFailed,
        progress: 0
      })
    } finally {
      setIsPreparingPreview(false)
    }
  }, [
    fetchExportRecordsForSelection,
    isPreparingPreview,
    isRunningDownload,
    releaseManagedPreviewBlob,
    selectedSourceIds,
    sources,
    uiCopy.previewBuildDataFailed,
    uiCopy.previewOpenFailed,
    uiCopy.selectAtLeastOnePreview
  ])

  const handlePreparePreview = useCallback(async () => {
    if (isPreparingPreview || isRunningDownload) {
      return
    }

    setToast({ status: "idle", message: "", progress: 0 })
    setPreviewLoadError(null)
    setPreviewSkippedCount(0)
    setIsPreviewMode(true)
    setPreviewDrafts([])
    setIsPreparingPreview(true)

    try {
      const selected =
        selectedCount > 0
          ? sources.filter((source) => selectedSourceIds.has(source.sourceId))
          : sources
      if (selected.length === 0) {
        throw new Error(uiCopy.noSourcesAvailablePreview)
      }
      if (selectedCount === 0) {
        setSelectedSourceIds(new Set(selected.map((source) => source.sourceId)))
      }

      const previewSupportedSources = selected.filter(isSourceSupportedForStructuredPreview)
      const previewSkippedSources = selected.filter((source) => !isSourceSupportedForStructuredPreview(source))
      setPreviewSkippedCount(previewSkippedSources.length)

      if (previewSupportedSources.length === 0) {
        throw new Error(uiCopy.previewSupportedOnly)
      }

      const exportRecords = await fetchExportRecordsForSelection(previewSupportedSources)
      const nextDrafts: PreviewDraft[] = exportRecords.map((record) => ({
        ...record,
        editableContent: buildPreviewText(record, format)
      }))
      if (nextDrafts.length === 0) {
        throw new Error(uiCopy.noPreviewContentReturned)
      }

      setPreviewDrafts(nextDrafts)
    } catch (error) {
      setPreviewLoadError(error instanceof Error ? error.message : uiCopy.previewBuildFailed)
    } finally {
      setIsPreparingPreview(false)
    }
  }, [
    fetchExportRecordsForSelection,
    format,
    isPreparingPreview,
    isRunningDownload,
    selectedCount,
    selectedSourceIds,
    sources,
    uiCopy.noPreviewContentReturned,
    uiCopy.noSourcesAvailablePreview,
    uiCopy.previewBuildFailed,
    uiCopy.previewSupportedOnly
  ])

  const handlePreviewContentChange = useCallback((sourceId: string, nextContent: string) => {
    setPreviewDrafts((currentDrafts) =>
      currentDrafts.map((draft) =>
        draft.sourceId === sourceId
          ? {
              ...draft,
              editableContent: nextContent
            }
          : draft
      )
    )
  }, [])

  const goBackToSelection = useCallback(() => {
    if (isRunningDownload) {
      return
    }
    setIsPreviewMode(false)
    setPreviewLoadError(null)
    setPreviewSkippedCount(0)
  }, [isRunningDownload])

  const handleDownloadSelected = useCallback(async () => {
    if (isRunningDownload) {
      return
    }

    setIsRunningDownload(true)
    setToast({
      status: "running",
      message: uiCopy.preparingDownloadFiles,
      progress: 4
    })

    try {
      let draftsToExport: PreviewDraft[] = []
      if (isPreviewMode) {
        const selectedInOrder = sources.filter((source) => selectedSourceIds.has(source.sourceId))
        if (selectedInOrder.length === 0) {
          throw new Error(uiCopy.selectAtLeastOneDownload)
        }

        const editableDraftBySourceId = new Map<string, PreviewDraft>(
          previewDrafts.map((draft) => [draft.sourceId, draft])
        )
        const sourcesWithoutEditablePreview = selectedInOrder.filter(
          (source) => !editableDraftBySourceId.has(source.sourceId)
        )

        const nonPreviewDraftBySourceId = new Map<string, PreviewDraft>()
        if (sourcesWithoutEditablePreview.length > 0) {
          const nonPreviewRecords = await fetchExportRecordsForSelection(sourcesWithoutEditablePreview)
          for (const record of nonPreviewRecords) {
            nonPreviewDraftBySourceId.set(record.sourceId, {
              ...record,
              editableContent: buildPreviewText(record, format)
            })
          }
        }

        for (const source of selectedInOrder) {
          const editable = editableDraftBySourceId.get(source.sourceId)
          if (editable) {
            draftsToExport.push(editable)
            continue
          }

          const fallback = nonPreviewDraftBySourceId.get(source.sourceId)
          if (fallback) {
            draftsToExport.push(fallback)
          }
        }

        if (draftsToExport.length === 0) {
          throw new Error(uiCopy.selectedNoDownloadContent)
        }
      } else {
        const selected = sources.filter((source) => selectedSourceIds.has(source.sourceId))
        if (selected.length === 0) {
          throw new Error(uiCopy.selectAtLeastOneDownload)
        }

        const exportRecords = await fetchExportRecordsForSelection(selected)
        draftsToExport = exportRecords.map((record) => ({
          ...record,
          editableContent: buildPreviewText(record, format)
        }))
      }

      if (draftsToExport.length === 1) {
        const singleDraft = draftsToExport[0]
        const singleFile = await buildPreparedFile(singleDraft, format, new Set(), singleDraft.editableContent)
        triggerDownload(
          new Blob([toArrayBuffer(singleFile.bytes)], { type: singleFile.mimeType }),
          singleFile.filename
        )
        setToast({
          status: "success",
          message: uiCopy.downloadSuccess,
          progress: 100
        })
        return
      }

      const files: DownloadPreparedFile[] = []
      const usedNames = new Set<string>()
      for (let index = 0; index < draftsToExport.length; index += 1) {
        const draft = draftsToExport[index]
        files.push(await buildPreparedFile(draft, format, usedNames, draft.editableContent))
        setToast({
          status: "running",
          message: uiCopy.preparingProgress(index + 1, draftsToExport.length),
          progress: Math.round(((index + 1) / draftsToExport.length) * 88)
        })
      }

      setToast({
        status: "running",
        message: uiCopy.zippingFiles,
        progress: 96
      })
      const zipBytes = await buildZip(files.map((file) => ({ filename: file.filename, bytes: file.bytes })))
      triggerDownload(
        new Blob([toArrayBuffer(zipBytes)], { type: "application/zip" }),
        `minddock_fontes_${Date.now()}.zip`
      )

      setToast({
        status: "success",
        message: uiCopy.downloadSuccess,
        progress: 100
      })
    } catch (error) {
      setToast({
        status: "error",
        message: error instanceof Error ? error.message : uiCopy.downloadFailed,
        progress: 0
      })
    } finally {
      setIsRunningDownload(false)
    }
  }, [
    fetchExportRecordsForSelection,
    format,
    isPreviewMode,
    isRunningDownload,
    previewDrafts,
    selectedSourceIds,
    sources,
    uiCopy.downloadFailed,
    uiCopy.downloadSuccess,
    uiCopy.preparingDownloadFiles,
    uiCopy.preparingProgress,
    uiCopy.selectAtLeastOneDownload,
    uiCopy.selectedNoDownloadContent,
    uiCopy.zippingFiles
  ])

  const fallbackToastMessage =
    toast.status === "error"
      ? uiCopy.fallbackToastError
      : toast.status === "success"
        ? uiCopy.fallbackToastSuccess
        : uiCopy.fallbackToastRunning
  const toastDisplayMessage = String(toast.message || fallbackToastMessage)
    .replace(/\bbaixe\b/gi, "Download")
    .replace(/\bbaixado\b/gi, "Download")
  const isPreviewToast = /\bpre[-\s]?visual/i.test(toastDisplayMessage)

  return (
    <>
      {!isNativePanelCollapsed && (
        <div className="liquid-metal-toolbar whitespace-nowrap">
          <ActionIconButton
            title={uiCopy.panelToggleTitle}
            onClick={toggleFilterPanelVisibility}
            active={!isFilterPanelVisible}>
            <ListFilter size={16} strokeWidth={1.8} />
          </ActionIconButton>
        </div>
      )}

      {isOpen && (
        <div
            data-minddock-source-overlay="true"
            className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-[#020204]/80 px-4 backdrop-blur-sm"
            onClick={(event) => {
              event.stopPropagation()
            }}
            onMouseDown={(event) => {
              event.stopPropagation()
              if (event.target === event.currentTarget) {
                closeModal()
              }
            }}>
            <section
              role="dialog"
              aria-modal="true"
              aria-label={uiCopy.modalAriaLabel}
              onClick={(event) => {
                event.stopPropagation()
              }}
              onMouseDown={(event) => {
                event.stopPropagation()
              }}
              className="relative flex max-h-[88vh] w-full max-w-[960px] flex-col overflow-hidden rounded-[22px] border border-white/[0.08] bg-[#08090b] text-[#d6dae0] shadow-[0_24px_64px_rgba(0,0,0,0.45)]">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-90"
                style={{
                  backgroundImage: "radial-gradient(circle, rgba(255, 255, 255, 0.07) 1px, transparent 1px)",
                  backgroundSize: "14px 14px",
                  backgroundPosition: "0 0"
                }}
              />

              <div className="relative z-[1] flex flex-1 flex-col">
                <header className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-5 pb-3 pt-5">
                  <div>
                    <h2 className="text-[28px] font-semibold leading-none tracking-tight text-white">
                      {uiCopy.modalTitle}
                    </h2>
                    <p className="mt-1 text-sm text-[#9ca3af]">
                      {isPreviewMode
                        ? uiCopy.modalSubtitlePreview
                        : uiCopy.modalSubtitleSelection}
                    </p>
                  </div>
                  <button
                    type="button"
                    onMouseDown={swallowInteraction}
                    onClick={(event) => {
                      swallowInteraction(event)
                      closeModal()
                    }}
                    disabled={isRunningDownload || isSyncingGDocs || isPreparingPreview}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-[11px] border border-white/[0.12] bg-[#111318] text-[#a5acb8] transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
                    <X size={15} strokeWidth={1.8} />
                  </button>
                </header>

                <div className="px-5 pb-2 pt-3">
                  {!isPreviewMode && (
                    <div className="rounded-xl border border-white/[0.1] bg-[#0e1116] px-3 py-2">
                      <input
                        type="search"
                        value={sourceSearch}
                        onChange={(event) => setSourceSearch(event.target.value)}
                        placeholder={uiCopy.sourceFilterPlaceholder}
                        className="w-full bg-transparent text-sm text-[#e5e7eb] outline-none placeholder:text-[#6b7280]"
                      />
                    </div>
                  )}

                  <div className={isPreviewMode ? "mt-0" : "mt-3"}>
                    <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/[0.1] bg-[#0e1116] p-2 sm:grid-cols-4">
                      {DOWNLOAD_FORMAT_OPTIONS.map((item) => {
                        const active = format === item
                        const itemMeta = downloadFormatMeta[item]
                        const preventTranslation = Boolean(itemMeta.noTranslate)

                        return (
                          <button
                            key={item}
                            type="button"
                            translate={preventTranslation ? "no" : undefined}
                            lang={preventTranslation ? "en" : undefined}
                            onMouseDown={swallowInteraction}
                            onClick={(event) => {
                              swallowInteraction(event)
                              updateFormat(item)
                            }}
                            className={[
                              "flex min-h-[48px] flex-col justify-center gap-0.5 rounded-lg border px-2.5 py-2 text-left",
                              preventTranslation ? "notranslate" : "",
                              active
                                ? "border-[#facc15]/40 bg-[#2a2208] text-[#fff1a6]"
                                : "border-transparent bg-[#12161d] text-[#c7ced8]"
                            ].join(" ")}>
                            <span
                              translate={preventTranslation ? "no" : undefined}
                              className={["text-sm font-semibold leading-none", preventTranslation ? "notranslate" : ""].join(" ")}>
                              {itemMeta.label}
                            </span>
                            <span
                              translate={preventTranslation ? "no" : undefined}
                              className={["text-[11px] leading-tight opacity-85", preventTranslation ? "notranslate" : ""].join(" ")}>
                              {itemMeta.subtitle}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {!isPreviewMode && (
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[#a5acb8]">
                      <label className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-[#c8d0db]">
                        <input
                          ref={selectAllCheckboxRef}
                          type="checkbox"
                          checked={areAllFilteredSourcesSelected}
                          onChange={toggleSelectAllFilteredSources}
                          disabled={!hasFilteredSources}
                          className="h-4 w-4 cursor-pointer accent-[#facc15] disabled:cursor-not-allowed"
                        />
                        <span>{uiCopy.selectAllLabel}</span>
                        <span className="text-[#7f8795]">
                          ({`${filteredSelectedCount}/${filteredSources.length}`})
                        </span>
                      </label>
                    </div>
                  )}
                </div>

                {!isPreviewMode && (
                  <div className="mx-5 mt-2 min-h-[210px] max-h-[320px] overflow-y-auto rounded-xl border border-white/[0.1] bg-[#0e1116]/90 p-1.5 scrollbar-thin">
                    {isLoadingSources && (
                      <div className="px-3 py-6 text-sm text-[#9ca3af]">{uiCopy.loadingBackendSources}</div>
                    )}

                    {!isLoadingSources && sourceLoadError && (
                      <div className="px-3 py-6 text-sm text-red-300">{sourceLoadError}</div>
                    )}

                    {!isLoadingSources && !sourceLoadError && filteredSources.length === 0 && (
                      <div className="px-3 py-6 text-sm text-[#9ca3af]">{uiCopy.noSourcesForFilter}</div>
                    )}

                    {!isLoadingSources &&
                      !sourceLoadError &&
                      filteredSources.map((source) => {
                        const isChecked = selectedSourceIds.has(source.sourceId)

                        return (
                          <label
                            key={source.sourceId}
                            className="grid cursor-pointer grid-cols-[20px_minmax(0,1fr)] items-start gap-2 border-t border-white/[0.06] px-2 py-2.5">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleSourceSelection(source.sourceId)}
                              className="mt-0.5 h-4 w-4 cursor-pointer accent-[#facc15]"
                            />

                            <span className="min-w-0">
                              <span className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-[#f3f4f6]">
                                <span className="truncate" title={source.sourceTitle}>
                                  {source.sourceTitle}
                                </span>
                              </span>
                              <span className="mt-0.5 block text-xs text-[#9ca3af]">
                                {source.sourceKind === "youtube"
                                  ? uiCopy.sourceKindYoutube
                                  : uiCopy.sourceKindDocument}
                                {source.isGDoc ? " - GDoc" : ""}
                              </span>
                            </span>
                          </label>
                        )
                      })}
                  </div>
                )}

                {isPreviewMode && (
                  <div className="mx-5 mt-2 min-h-[320px] max-h-[420px] overflow-y-auto rounded-xl border border-white/[0.1] bg-[#0e1116]/90 p-2.5 scrollbar-thin">
                    {previewSkippedCount > 0 && (
                      <div className="mb-2 rounded-lg border border-white/[0.08] bg-[#10151d] px-3 py-2 text-xs text-[#c7ced8]">
                        {uiCopy.previewSkippedLabel(previewSkippedCount)}
                      </div>
                    )}
                    {isPreparingPreview ? (
                      <div className="px-3 py-6 text-sm text-[#9ca3af]">{uiCopy.loadingPreview}</div>
                    ) : previewLoadError ? (
                      <div className="px-3 py-6 text-sm text-red-300">{previewLoadError}</div>
                    ) : previewDrafts.length === 0 ? (
                      <div className="px-3 py-6 text-sm text-[#9ca3af]">
                        {uiCopy.noPreviewAvailable}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {previewDrafts.map((draft) => (
                          <article
                            key={draft.sourceId}
                            className="flex h-[320px] flex-col overflow-hidden rounded-lg border border-white/[0.08] bg-[#12161d]">
                            <header className="flex items-center justify-between gap-2 border-b border-white/[0.08] px-3 py-2">
                              <div className="min-w-0">
                                <h3 className="truncate text-sm font-semibold text-white">{draft.sourceTitle}</h3>
                                <p className="text-xs text-[#9ca3af]">
                                  {draft.sourceKind === "youtube"
                                    ? uiCopy.sourceKindYoutube
                                    : uiCopy.sourceKindDocument}{" "}
                                  |{" "}
                                  {format === "markdown"
                                    ? uiCopy.formatLabelMarkdown
                                    : format === "text"
                                      ? uiCopy.formatLabelText
                                      : format === "pdf"
                                        ? uiCopy.formatLabelPdf
                                        : uiCopy.formatLabelDocx}
                                </p>
                              </div>
                            </header>
                            <textarea
                              value={draft.editableContent}
                              onChange={(event) => handlePreviewContentChange(draft.sourceId, event.target.value)}
                              placeholder={uiCopy.previewTextareaPlaceholder}
                              className="flex-1 resize-none overflow-y-auto bg-transparent px-3 py-3 text-[13px] leading-6 text-[#e5e7eb] outline-none placeholder:text-[#6b7280]"
                            />
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {(() => {
                  const downloadCount = selectedCount
                  return (
                    <footer className="mt-3 grid grid-cols-[250px_minmax(0,1fr)] gap-3 px-5 pb-5 pt-1">
                      <button
                        type="button"
                        onMouseDown={swallowInteraction}
                        onClick={(event) => {
                          swallowInteraction(event)
                          if (isPreviewMode) {
                            goBackToSelection()
                            return
                          }
                          void handlePreparePreview()
                        }}
                        disabled={
                          isLoadingSources ||
                          isRunningDownload ||
                          isPreparingPreview ||
                          sources.length === 0
                        }
                        className="inline-flex min-h-[54px] items-center justify-center gap-1.5 rounded-xl border border-white/[0.1] bg-[#12161d] px-5 text-base font-semibold text-[#d6dae0] disabled:cursor-not-allowed disabled:opacity-45">
                        <Eye size={16} />
                        {isPreviewMode ? uiCopy.backButton : uiCopy.previewButton}
                      </button>

                      <button
                        type="button"
                        onMouseDown={swallowInteraction}
                        onClick={(event) => {
                          swallowInteraction(event)
                          void handleDownloadSelected()
                        }}
                        disabled={
                          isRunningDownload ||
                          isPreparingPreview ||
                          downloadCount === 0
                        }
                        className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-xl bg-[#16a34a] px-4 text-base font-semibold text-[#052e16] shadow-[0_10px_24px_rgba(22,163,74,0.25)] disabled:cursor-not-allowed disabled:opacity-45">
                        {isRunningDownload ? uiCopy.downloadRunningButton : uiCopy.downloadButton(downloadCount)}
                      </button>
                    </footer>
                  )
                })()}
              </div>
            </section>
          </div>
      )}

      {toast.status !== "idle" && !isPreviewMode && (
        <aside
          data-minddock-source-toast="true"
          className="fixed bottom-4 right-4 z-[2147483647] w-[min(370px,calc(100vw-28px))] overflow-hidden rounded-[18px] border border-white/[0.1] bg-[#08090b] text-[#d6dae0] shadow-[0_18px_44px_rgba(0,0,0,0.5)]">
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
                {isSyncingGDocs
                  ? uiCopy.toastTitleUpdatingSources
                  : isPreparingPreview || isPreviewToast
                    ? uiCopy.toastTitlePreviewSources
                    : isRunningDownload
                      ? uiCopy.toastTitleDownloadingSources
                      : uiCopy.toastTitleDownloadSources}
              </strong>
              <button
                type="button"
                aria-label={uiCopy.closeNoticeAriaLabel}
                onMouseDown={swallowInteraction}
                onClick={(event) => {
                  swallowInteraction(event)
                  setToast({ status: "idle", message: "", progress: 0 })
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-[10px] border border-white/[0.12] bg-[#101319] text-[#8f98a6] transition-colors hover:text-white">
                <X size={14} strokeWidth={1.8} />
              </button>
            </header>

            <p className="mb-2 text-sm text-[#b5bcc8]">{toastDisplayMessage}</p>

            <div className="h-2 overflow-hidden rounded-full bg-white/[0.1]">
              <div
                className={[
                  "h-full rounded-full transition-all duration-200",
                  toast.status === "error"
                    ? "bg-[linear-gradient(90deg,#ef4444_0%,#f97316_100%)]"
                    : "bg-[linear-gradient(90deg,#60a5fa_0%,#22c55e_100%)]"
                ].join(" ")}
                style={{
                  width: `${Math.max(0, Math.min(100, toast.progress))}%`
                }}
              />
            </div>
          </div>
        </aside>
      )}

      <IsolatedResourceViewerDialog
        isOpen={activePreviewAsset !== null}
        assetData={activePreviewAsset}
        onCloseRequest={dismissPreviewOverlay}
      />
    </>
  )
}

function swallowInteraction(event: {
  preventDefault: () => void
  stopPropagation: () => void
  nativeEvent?: Event
}): void {
  event.preventDefault()
  event.stopPropagation()
  const native = event.nativeEvent as Event & { stopImmediatePropagation?: () => void }
  native?.stopImmediatePropagation?.()
}

function ActionIconButton(props: {
  title: string
  children: JSX.Element
  onClick: () => void
  active?: boolean
  disabled?: boolean
}) {
  const { title, children, onClick, active = false, disabled = false } = props

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={swallowInteraction}
      onClick={(event) => {
        swallowInteraction(event)
        onClick()
      }}
      disabled={disabled}
      data-active={active ? "true" : "false"}
      className={[
        "liquid-metal-button",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      ].join(" ")}>
      {children}
    </button>
  )
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

function resolveSourcePayloadList(payload: unknown): Array<Partial<Source>> {
  if (Array.isArray(payload)) {
    return payload as Array<Partial<Source>>
  }

  if (payload && typeof payload === "object" && Array.isArray((payload as { sources?: unknown[] }).sources)) {
    return (payload as { sources: Array<Partial<Source>> }).sources
  }

  return []
}

function normalizeTitleCandidate(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function isNoiseTitleCandidate(value: string): boolean {
  const normalized = normalizeTitleCandidate(value)
  if (!normalized) {
    return true
  }

  if (
    /^(article|drive_pdf|drive_spreadsheet|drive_presentation|video_audio_call|image|description|documento?|youtube|web|texto?|audio|gdoc|pdf)$/.test(
      normalized
    )
  ) {
    return true
  }

  if (
    /^(selecionar todas as fontes|select all sources|adicionar fontes|add sources|pesquise na internet|search sources|fontes de pesquisa)$/.test(
      normalized
    )
  ) {
    return true
  }

  if (/^source\s+\d+$/.test(normalized)) {
    return true
  }

  return false
}

function scoreTitleCandidate(value: string): number {
  const trimmed = String(value ?? "").trim()
  const normalized = normalizeTitleCandidate(trimmed)
  if (!trimmed || isNoiseTitleCandidate(trimmed)) {
    return -1
  }

  let score = 0
  if (/\s/.test(trimmed)) {
    score += 6
  }
  if (trimmed.length >= 8) {
    score += 6
  }
  if (/[A-Z\u00C0-\u00DD]/.test(trimmed)) {
    score += 3
  }
  if (/https?:\/\//.test(normalized)) {
    score -= 10
  }
  if (/^[a-z_]+$/.test(normalized) && normalized.includes("_")) {
    score -= 8
  }

  score += Math.min(12, Math.floor(trimmed.length / 6))
  return score
}

function pickBestTitleFromCandidates(candidates: string[], fallback: string): string {
  let best = ""
  let bestScore = -1

  for (const candidate of candidates) {
    const trimmed = String(candidate ?? "").trim()
    const score = scoreTitleCandidate(trimmed)
    if (score > bestScore) {
      best = trimmed
      bestScore = score
    }
  }

  if (bestScore >= 0 && best) {
    return best
  }

  const normalizedFallback = String(fallback ?? "").trim()
  if (normalizedFallback && !isNoiseTitleCandidate(normalizedFallback)) {
    return normalizedFallback
  }

  return resolveSourceDownloadUiCopy().untitledSource
}

function resolveDisplayTitleFromDomRow(row: HTMLElement, index: number): string {
  const candidateSet = new Set<string>()
  const add = (value: unknown) => {
    const text = String(value ?? "").trim()
    if (text) {
      candidateSet.add(text)
    }
  }

  add(extractSourceTitle(row))
  add(row.getAttribute("title"))
  add(row.getAttribute("aria-label"))

  const titleNodes = Array.from(
    row.querySelectorAll<HTMLElement>("[data-testid*='title'], [title], a, h1, h2, h3, h4, h5, h6, span, p, div")
  ).slice(0, 80)
  for (const node of titleNodes) {
    add(node.getAttribute("title"))
    add(node.getAttribute("aria-label"))
    add(node.innerText)
    add(node.textContent)
  }

  const rowLines = String(row.innerText || row.textContent || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  for (const line of rowLines) {
    add(line)
  }

  const best = pickBestTitleFromCandidates(Array.from(candidateSet), `${resolveSourceDownloadUiCopy().untitledSource} ${index + 1}`)
  return best
}

function resolveDisplayTitleFromPayload(source: Partial<Source>, index: number): string {
  const sourceRecord = source as Record<string, unknown>
  const candidates = [
    source.title,
    sourceRecord.sourceTitle,
    sourceRecord.name,
    sourceRecord.displayName,
    sourceRecord.label,
    sourceRecord.filename
  ].map((value) => String(value ?? "").trim())

  const urlCandidate = String(source.url ?? "").trim()
  if (urlCandidate) {
    try {
      const parsed = new URL(urlCandidate)
      const tail = parsed.pathname.split("/").filter(Boolean).pop() ?? parsed.hostname
      candidates.push(decodeURIComponent(tail))
    } catch {
      candidates.push(urlCandidate)
    }
  }

  const fallback = `${resolveSourceDownloadUiCopy().untitledSource} ${index + 1}`
  return pickBestTitleFromCandidates(candidates, fallback)
}

function toSourceRow(source: Partial<Source>, index: number): SourceRow {
  const backendId = typeof source.id === "string" && source.id.trim() ? source.id.trim() : null
  const sourceId = backendId ?? `minddock-source-${index}`
  const sourceTitle = resolveDisplayTitleFromPayload(source, index)
  const sourceUrl = typeof source.url === "string" && source.url.trim() ? source.url.trim() : undefined

  const isYoutube =
    source.type === "youtube" ||
    source.isYoutube === true ||
    !!sourceUrl?.match(/youtube\.com|youtu\.be/i) ||
    /youtube|youtu\.be/i.test(sourceTitle)

  return {
    sourceId,
    backendId,
    sourceTitle,
    sourceUrl,
    sourceKind: isYoutube ? "youtube" : "document",
    isGDoc: source.isGDoc === true || source.type === "gdoc"
  }
}

function resolveSourceRowsFromDom(): SourceRow[] {
  const rows = resolveSourceRows()
  const results: SourceRow[] = []
  const usedIds = new Set<string>()

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const sourceTitle = resolveDisplayTitleFromDomRow(row, index)
    if (isNoiseTitleCandidate(sourceTitle)) {
      continue
    }
    const sourceUrl = extractSourceUrl(row).trim() || undefined
    const inferredType = inferSourceType(row)
    const rowSignalSnapshot = String(row.innerText || row.textContent || "").toLowerCase()
    const hasWorkspaceIconToken =
      /\b(article|drive_spreadsheet|drive_presentation)\b/u.test(rowSignalSnapshot)
    const hasEditableDocExtension = /\.(docx?|odt|rtf)\b/u.test(sourceTitle.toLowerCase())
    const isYoutube =
      inferredType === "YouTube" ||
      !!sourceUrl?.match(/youtube\.com|youtu\.be/i) ||
      /youtube|youtu\.be/i.test(sourceTitle)

    const backendCandidate = resolveBackendIdFromDomRow(row)
    const baseId = backendCandidate || `minddock-source-dom-${index}`
    let sourceId = baseId
    let dedupe = 2
    while (usedIds.has(sourceId)) {
      sourceId = `${baseId}-${dedupe}`
      dedupe += 1
    }
    usedIds.add(sourceId)

    results.push({
      sourceId,
      backendId: backendCandidate,
      sourceTitle,
      sourceUrl,
      sourceKind: isYoutube ? "youtube" : "document",
      isGDoc:
        inferredType === "GDocs" ||
        hasWorkspaceIconToken ||
        hasEditableDocExtension ||
        !!sourceUrl?.match(/docs\.google\.com|drive\.google\.com/i)
    })
  }

  return results
}

function resolveGDocRefreshCandidates(
  eventCandidates: GDocRefreshCandidate[] | undefined,
  loadedSources: SourceRow[],
  domSources: SourceRow[]
): GDocRefreshCandidate[] {
  const candidates: GDocRefreshCandidate[] = []
  const seen = new Set<string>()

  const appendCandidate = (candidateRaw: Partial<GDocRefreshCandidate> | null | undefined): void => {
    if (!candidateRaw) {
      return
    }

    const title = String(candidateRaw.title ?? "").trim()
    const sourceUrl = String(candidateRaw.sourceUrl ?? "").trim()
    const docReference = String(candidateRaw.docReference ?? sourceUrl).trim()
    const sourceId = String(candidateRaw.sourceId ?? "").trim()
    if (!title && !docReference && !sourceId) {
      return
    }

    const key = `${title.toLowerCase()}::${docReference.toLowerCase()}::${sourceId.toLowerCase()}`
    if (seen.has(key)) {
      return
    }
    seen.add(key)

    candidates.push({
      title: title || resolveSourceDownloadUiCopy().defaultGoogleDocTitle,
      docReference: docReference || undefined,
      sourceUrl: sourceUrl || undefined,
      sourceId: sourceId || undefined
    })
  }

  if (Array.isArray(eventCandidates)) {
    for (const candidate of eventCandidates) {
      appendCandidate(candidate)
    }
  }

  for (const source of loadedSources) {
    if (!source.isGDoc) {
      continue
    }
    appendCandidate({
      title: source.sourceTitle,
      docReference: source.sourceUrl || undefined,
      sourceUrl: source.sourceUrl,
      sourceId: source.backendId ?? undefined
    })
  }

  for (const source of domSources) {
    if (!source.isGDoc) {
      continue
    }
    appendCandidate({
      title: source.sourceTitle,
      docReference: source.sourceUrl || undefined,
      sourceUrl: source.sourceUrl,
      sourceId: source.backendId ?? undefined
    })
  }

  return candidates
}

function resolveBackendIdFromDomRow(row: HTMLElement): string | null {
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
  if (nestedNode) {
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
  }

  return null
}

interface DomSourceFallbackEntry {
  backendId: string | null
  titleKey: string
  sourceTitle: string
  sourceUrl?: string
  contentLines: string[]
}

interface DomSourceFallbackIndex {
  byBackendId: Map<string, DomSourceFallbackEntry>
  byTitleKey: Map<string, DomSourceFallbackEntry>
  entries: DomSourceFallbackEntry[]
}

function buildDomSourceFallbackIndex(): DomSourceFallbackIndex {
  const byBackendId = new Map<string, DomSourceFallbackEntry>()
  const byTitleKey = new Map<string, DomSourceFallbackEntry>()
  const entries: DomSourceFallbackEntry[] = []
  const rows = resolveSourceRows()

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const sourceTitle = resolveDisplayTitleFromDomRow(row, index)
    const titleKey = normalizeTitleCandidate(sourceTitle)
    if (!titleKey || isNoiseTitleCandidate(sourceTitle)) {
      continue
    }

    const backendId = resolveBackendIdFromDomRow(row)
    const sourceUrl = extractSourceUrl(row).trim() || undefined
    const contentLines = extractDomContentLines(row, sourceTitle)
    const entry: DomSourceFallbackEntry = {
      backendId,
      titleKey,
      sourceTitle,
      sourceUrl,
      contentLines
    }

    entries.push(entry)
    if (backendId) {
      const previous = byBackendId.get(backendId)
      if (!previous || scoreDomFallbackEntry(entry) > scoreDomFallbackEntry(previous)) {
        byBackendId.set(backendId, entry)
      }
    }

    const previousByTitle = byTitleKey.get(titleKey)
    if (!previousByTitle || scoreDomFallbackEntry(entry) > scoreDomFallbackEntry(previousByTitle)) {
      byTitleKey.set(titleKey, entry)
    }
  }

  return {
    byBackendId,
    byTitleKey,
    entries
  }
}

function scoreDomFallbackEntry(entry: DomSourceFallbackEntry): number {
  const totalChars = entry.contentLines.reduce((sum, line) => sum + line.length, 0)
  return totalChars + (entry.sourceUrl ? 120 : 0)
}

function extractDomContentLines(row: HTMLElement, sourceTitle: string): string[] {
  const titleKey = normalizeTitleCandidate(sourceTitle)
  const lineSet = new Set<string>()
  const lines = String(row.innerText || row.textContent || "")
    .split(/\r?\n/)
    .map((line) => String(line ?? "").trim())
    .filter(Boolean)

  for (const line of lines) {
    const normalized = normalizeTitleCandidate(line)
    if (!normalized || normalized === titleKey) {
      continue
    }
    if (isDomNoiseLine(normalized)) {
      continue
    }

    if (!lineSet.has(line)) {
      lineSet.add(line)
    }
  }

  return Array.from(lineSet).slice(0, 24)
}

function isDomNoiseLine(normalizedLine: string): boolean {
  if (!normalizedLine) {
    return true
  }

  if (
    /^(documento|document|youtube|pdf|gdoc|gdocs|web|texto|text|audio|image|imagem|fonte|source)$/.test(
      normalizedLine
    )
  ) {
    return true
  }

  if (/^(selecionar todos|todos|limpar|download|baixar|previa|pre visualizacao)$/.test(normalizedLine)) {
    return true
  }

  if (/^\d+\s*\/\s*\d+$/.test(normalizedLine)) {
    return true
  }

  return false
}

function resolveDomFallbackForSource(
  source: SourceRow,
  index: DomSourceFallbackIndex
): DomSourceFallbackEntry | null {
  if (source.backendId) {
    const byBackend = index.byBackendId.get(source.backendId)
    if (byBackend) {
      return byBackend
    }
  }

  const titleKey = normalizeTitleCandidate(source.sourceTitle)
  if (titleKey) {
    const byTitle = index.byTitleKey.get(titleKey)
    if (byTitle) {
      return byTitle
    }

    for (const entry of index.entries) {
      if (!entry.titleKey) {
        continue
      }
      if (entry.titleKey.includes(titleKey) || titleKey.includes(entry.titleKey)) {
        return entry
      }
    }
  }

  return null
}

function resolveSourceSnippets(
  source: SourceRow,
  sourceSnippets: Record<string, string[]>
): string[] {
  const sourceEntries = Object.entries(sourceSnippets ?? {})
  if (sourceEntries.length === 0) {
    return []
  }

  const candidateKeys = [source.backendId, source.sourceId]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)

  for (const key of candidateKeys) {
    const direct = normalizeSnippetArray(sourceSnippets[key])
    if (direct.length > 0) {
      return direct
    }
  }

  for (const key of candidateKeys) {
    const normalizedCandidate = normalizeTitleCandidate(key)
    if (!normalizedCandidate) {
      continue
    }

    for (const [snippetKey, snippetValues] of sourceEntries) {
      const normalizedSnippetKey = normalizeTitleCandidate(snippetKey)
      if (!normalizedSnippetKey) {
        continue
      }

      if (
        normalizedSnippetKey === normalizedCandidate ||
        normalizedSnippetKey.endsWith(normalizedCandidate) ||
        normalizedCandidate.endsWith(normalizedSnippetKey) ||
        normalizedSnippetKey.includes(normalizedCandidate) ||
        normalizedCandidate.includes(normalizedSnippetKey)
      ) {
        const resolved = normalizeSnippetArray(snippetValues)
        if (resolved.length > 0) {
          return resolved
        }
      }
    }
  }

  return []
}

function normalizeSnippetArray(snippetsRaw: unknown): string[] {
  if (!Array.isArray(snippetsRaw)) {
    return []
  }

  return snippetsRaw
    .map((value) => String(value ?? "").trim())
    .filter((value) => value.length > 0)
}

function buildLooseSummaryText(
  snippets: string[],
  sourceKind: SourceExportRecord["sourceKind"]
): string {
  const unique = new Set<string>()
  const lines: string[] = []

  for (const snippet of snippets) {
    const normalized = String(snippet ?? "").replace(/\s+/g, " ").trim()
    if (!normalized || unique.has(normalized)) {
      continue
    }
    unique.add(normalized)
    lines.push(normalized)
  }

  if (lines.length === 0) {
    return ""
  }

  if (sourceKind === "youtube") {
    return lines.join(" ")
  }

  return lines.join("\n\n")
}

function buildFallbackRecord(
  source: SourceRow,
  domFallback?: DomSourceFallbackEntry | null
): SourceExportRecord {
  const uiCopy = resolveSourceDownloadUiCopy()
  const fallbackContentLines = domFallback?.contentLines ?? []
  const summaryLines = [
    uiCopy.fallbackSummaryTitle,
    "",
    `${uiCopy.fallbackSummarySourcePrefix}: ${source.sourceTitle}`,
    `${uiCopy.fallbackSummaryTypePrefix}: ${source.sourceKind === "youtube" ? uiCopy.fallbackTypeYoutube : uiCopy.fallbackTypeDocument}`,
    source.sourceUrl || domFallback?.sourceUrl ? `URL: ${source.sourceUrl || domFallback?.sourceUrl}` : "",
    "",
    fallbackContentLines.length > 0
      ? uiCopy.fallbackSummaryDetected
      : uiCopy.fallbackSummaryUnavailable,
    ...fallbackContentLines.map((line, index) => `${index + 1}. ${line}`),
    "",
    uiCopy.fallbackSummaryTip
  ].filter(Boolean)

  return {
    sourceId: source.sourceId,
    sourceTitle: source.sourceTitle,
    sourceUrl: source.sourceUrl || domFallback?.sourceUrl,
    sourceKind: source.sourceKind,
    summaryText: summaryLines.join("\n")
  }
}

function buildPreviewText(record: SourceExportRecord, format: DownloadFormat): string {
  if (format === "pdf") {
    return formatAsPdfText(record)
  }

  if (format === "markdown") {
    return formatAsMarkdown(record)
  }

  if (format === "docx") {
    return formatAsDocxText(record)
  }

  // TXT keeps a simple editable text body.
  return formatAsText(record)
}

interface PreviewAssetResolution {
  asset: IAssetMetadata
  managedBlobUrl: string | null
}

async function resolvePreviewAssetMetadata(
  source: SourceRow,
  record: SourceExportRecord
): Promise<PreviewAssetResolution> {
  const mimeType = inferPreviewMimeTypeFromSource(source)
  const title = source.sourceTitle || record.sourceTitle || resolveSourceDownloadUiCopy().untitledSource
  const normalizedSourceUrl = String(source.sourceUrl ?? "").trim()

  if (normalizedSourceUrl && (mimeType.startsWith("image/") || mimeType.startsWith("audio/"))) {
    return {
      asset: {
        id: source.sourceId,
        title,
        mimeType,
        secureUrl: normalizedSourceUrl
      },
      managedBlobUrl: null
    }
  }

  if (mimeType === "application/pdf") {
    if (normalizedSourceUrl) {
      return {
        asset: {
          id: source.sourceId,
          title,
          mimeType: "application/pdf",
          secureUrl: normalizedSourceUrl
        },
        managedBlobUrl: null
      }
    }

    const pdfText = formatAsPdfText(record)
    const pdfBytes = await buildPdfBytesViaBackground(pdfText)
    const blobUrl = URL.createObjectURL(new Blob([toArrayBuffer(pdfBytes)], { type: "application/pdf" }))

    return {
      asset: {
        id: source.sourceId,
        title,
        mimeType: "application/pdf",
        secureUrl: blobUrl
      },
      managedBlobUrl: blobUrl
    }
  }

  return {
    asset: {
      id: source.sourceId,
      title,
      mimeType: "text/markdown",
      secureUrl: formatAsMarkdown(record)
    },
    managedBlobUrl: null
  }
}

function inferPreviewMimeTypeFromSource(source: SourceRow): string {
  const sourceTitle = String(source.sourceTitle ?? "").toLowerCase()
  const sourceUrl = String(source.sourceUrl ?? "").toLowerCase()
  const signature = `${sourceTitle} ${sourceUrl}`

  if (/\.(png)(\?|#|$)/.test(signature)) {
    return "image/png"
  }
  if (/\.(jpe?g|webp|gif|bmp|svg)(\?|#|$)/.test(signature)) {
    return "image/jpeg"
  }
  if (/\.(mp3|mpeg|wav|m4a|ogg)(\?|#|$)/.test(signature)) {
    return "audio/mpeg"
  }
  if (/\.(pdf)(\?|#|$)/.test(signature)) {
    return "application/pdf"
  }
  if (/\.(md|markdown)(\?|#|$)/.test(signature)) {
    return "text/markdown"
  }
  if (/\.(txt)(\?|#|$)/.test(signature)) {
    return "text/plain"
  }

  if (source.sourceKind === "youtube") {
    return "text/plain"
  }

  return "text/markdown"
}

function isSourceSupportedForStructuredPreview(source: SourceRow): boolean {
  const sourceTitle = String(source.sourceTitle ?? "").toLowerCase()
  const sourceUrl = String(source.sourceUrl ?? "").trim().toLowerCase()
  const signature = `${sourceTitle} ${sourceUrl}`
  const disallowedBinaryExtensions =
    /\.(png|jpe?g|gif|webp|bmp|svg|mp3|wav|ogg|m4a|aac|flac|mp4|mkv|webm|mov|avi|zip|rar|7z|exe|dmg|apk|iso)$/i

  // Bloqueia somente formatos claramente nao textuais.
  if (disallowedBinaryExtensions.test(signature)) {
    return false
  }

  if (source.sourceKind === "youtube" || /youtube\.com|youtu\.be/.test(signature)) {
    return true
  }

  if (source.isGDoc) {
    return true
  }

  if (/docs\.google\.com\/(document|spreadsheets|presentation)\//.test(sourceUrl)) {
    return true
  }

  if (/\.(pdf)(\?|#|$)/.test(sourceUrl) || /\.pdf\b/.test(sourceTitle)) {
    return true
  }

  const parsedUrl = tryParseHttpUrl(sourceUrl)
  if (parsedUrl) {
    const host = parsedUrl.hostname.toLowerCase()
    const path = parsedUrl.pathname.toLowerCase()
    if (/youtube\.com|youtu\.be/.test(host)) {
      return true
    }
    if (/docs\.google\.com/.test(host) && /\/(document|spreadsheets|presentation)\//.test(path)) {
      return true
    }
    if (/\.pdf$/.test(path)) {
      return true
    }
    if (disallowedBinaryExtensions.test(path)) {
      return false
    }

    // Qualquer pagina HTTP/HTTPS sem extensao binaria entra como conteudo web textual.
    return true
  }

  // Em NotebookLM, varias fontes aparecem como "Documento" sem URL completa.
  // Se nao for binario conhecido, permitimos previa textual.
  if (source.sourceKind === "document") {
    return true
  }

  return /\b(google docs|google sheets|google slides|youtube|pdf|web|pagina|site|documento|texto)\b/.test(sourceTitle)
}

function tryParseHttpUrl(rawUrl: string): URL | null {
  const normalized = String(rawUrl ?? "").trim()
  if (!/^https?:\/\//i.test(normalized)) {
    return null
  }

  try {
    return new URL(normalized)
  } catch {
    return null
  }
}

async function buildPdfBytesViaBackground(text: string): Promise<Uint8Array> {
  const response = await sendBackgroundCommand<{ base64?: string }>(
    MESSAGE_ACTIONS.CMD_RENDER_PDF_OFFSCREEN,
    {
      text
    }
  )

  if (!response.success) {
    throw new Error(response.error ?? resolveSourceDownloadUiCopy().pdfBuildFailed)
  }

  const payload = response.payload ?? response.data
  const base64 = String(payload?.base64 ?? "").trim()
  if (!base64) {
    throw new Error(resolveSourceDownloadUiCopy().pdfEmptyResponse)
  }

  return base64ToBytes(base64)
}

async function buildPreparedFile(
  record: SourceExportRecord,
  format: DownloadFormat,
  usedNames: Set<string>,
  overrideContent?: string
): Promise<DownloadPreparedFile> {
  if (format === "markdown") {
    const content = overrideContent ?? formatAsMarkdown(record)
    return {
      filename: buildUniqueFilename(record.sourceTitle, ".md", usedNames),
      bytes: encoder.encode(content),
      mimeType: "text/markdown;charset=utf-8"
    }
  }

  if (format === "text") {
    const content = overrideContent ?? formatAsText(record)
    return {
      filename: buildUniqueFilename(record.sourceTitle, ".txt", usedNames),
      bytes: encoder.encode(content),
      mimeType: "text/plain;charset=utf-8"
    }
  }

  if (format === "docx") {
    const content = overrideContent ?? formatAsDocxText(record)
    return {
      filename: buildUniqueFilename(record.sourceTitle, ".docx", usedNames),
      bytes: await buildDocxBytesFromText(content),
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    }
  }

  const pdfText = overrideContent ?? formatAsPdfText(record)
  return {
    filename: buildUniqueFilename(record.sourceTitle, ".pdf", usedNames),
    bytes: await buildPdfBytesViaBackground(pdfText),
    mimeType: "application/pdf"
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
