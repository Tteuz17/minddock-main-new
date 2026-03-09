import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, Eye, ListFilter, RotateCcw, X } from "lucide-react"
import {
  MESSAGE_ACTIONS,
  type StandardResponse
} from "~/lib/contracts"
import type { Source } from "~/lib/types"
import {
  buildPdfBytesFromText,
  buildUniqueFilename,
  buildZip,
  formatAsMarkdown,
  formatAsText,
  snippetsToSummaryText,
  triggerDownload,
  type DownloadFormat,
  type SourceExportRecord
} from "~/lib/source-download"
import {
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
  resolveSourceRows
} from "./sourceDom"

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

const encoder = new TextEncoder()

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
  const [activePreviewSourceId, setActivePreviewSourceId] = useState<string | null>(null)
  const [previewDrafts, setPreviewDrafts] = useState<PreviewDraft[]>([])
  const [toast, setToast] = useState<ToastState>({
    status: "idle",
    message: "",
    progress: 0
  })

  const selectedCount = selectedSourceIds.size

  const filteredSources = useMemo(() => {
    const query = sourceSearch.trim().toLowerCase()
    if (!query) {
      return sources
    }

    return sources.filter((source) => source.sourceTitle.toLowerCase().includes(query))
  }, [sourceSearch, sources])

  const activePreviewDraft = useMemo(
    () =>
      previewDrafts.find(
        (draft) => draft.sourceId === activePreviewSourceId
      ) ?? previewDrafts[0] ?? null,
    [activePreviewSourceId, previewDrafts]
  )

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

  const loadSources = useCallback(async (): Promise<string> => {
    const notebookId = resolveNotebookIdFromRoute()
    if (!notebookId) {
      throw new Error("Notebook ID was not found in the current NotebookLM route.")
    }

    setIsLoadingSources(true)
    setSourceLoadError(null)
    try {
      const response = await sendBackgroundCommand(MESSAGE_ACTIONS.CMD_GET_NOTEBOOK_SOURCES, {
        notebookId
      })
      if (!response.success) {
        throw new Error(response.error ?? "Failed to list notebook sources.")
      }

      const responsePayload = response.payload ?? response.data
      const sourceList = resolveSourcePayloadList(responsePayload).map(toSourceRow)
      const validSources = sourceList.filter(
        (source) => source.sourceTitle.trim().length > 0
      )

      if (validSources.length === 0) {
        throw new Error("No sources were returned by the backend.")
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

      const message = error instanceof Error ? error.message : "Failed to load notebook sources."
      setSources([])
      setSelectedSourceIds(new Set())
      setSourceLoadError(message)
      throw error
    } finally {
      setIsLoadingSources(false)
    }
  }, [])

  const openModal = useCallback(async () => {
    setSourceSearch("")
    setIsOpen(true)
    setIsPreviewMode(false)
    setPreviewDrafts([])
    setActivePreviewSourceId(null)
    setSourceLoadError(null)
    setToast({ status: "idle", message: "", progress: 0 })

    try {
      await loadSources()
    } catch (error) {
      setToast({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to open the download modal.",
        progress: 0
      })
    }
  }, [loadSources])

  const closeModal = useCallback(() => {
    if (isRunningDownload || isSyncingGDocs) {
      return
    }

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

  const clearSourceSelection = (): void => {
    setSelectedSourceIds(new Set())
  }

  const toggleFilterPanelVisibility = (): void => {
    const nextVisible = !isFilterPanelVisible
    setIsFilterPanelVisible(nextVisible)
    dispatchSourcePanelToggle(nextVisible)
  }

  const refreshGDocSources = useCallback(async () => {
    if (isSyncingGDocs) {
      return
    }

    const notebookId = resolveNotebookIdFromRoute()
    if (!notebookId) {
      setToast({
        status: "error",
        message: "Notebook ID was not found for Google Docs sync.",
        progress: 0
      })
      return
    }

    setIsSyncingGDocs(true)
    setToast({
      status: "running",
      message: "Refreshing Google Docs sources...",
      progress: 10
    })

    try {
      const response = await sendBackgroundCommand(MESSAGE_ACTIONS.CMD_REFRESH_GDOC_SOURCES, {
        notebookId
      })
      if (!response.success) {
        throw new Error(response.error ?? "Failed to sync Google Docs sources.")
      }

      const payload = (response.payload ?? response.data) as
        | {
            syncedCount?: number
            total?: number
            failedSourceTitleList?: string[]
            message?: string
          }
        | undefined

      const syncedCount = Number(payload?.syncedCount ?? 0)
      const total = Number(payload?.total ?? 0)
      const failedSourceTitleList = Array.isArray(payload?.failedSourceTitleList)
        ? payload!.failedSourceTitleList
        : []

      console.debug("[sync:gdoc]", {
        synced: syncedCount,
        total,
        failures: failedSourceTitleList.length
      })

      setToast({
        status: "success",
        message: String(
          payload?.message ??
            (total === 0
              ? "There are no Google Docs sources to refresh."
              : failedSourceTitleList.length > 0
                ? `Partial refresh: ${syncedCount}/${total}.`
                : `Refreshed ${syncedCount}/${total} sources.`)
        ),
        progress: 100
      })

      if (isOpen) {
        await loadSources().catch(() => undefined)
      }
    } catch (error) {
      setToast({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to sync Google Docs sources.",
        progress: 0
      })
    } finally {
      setIsSyncingGDocs(false)
    }
  }, [isOpen, isSyncingGDocs, loadSources])

  useEffect(() => {
    const onExport = () => {
      void openModal()
    }

    const onRefresh = () => {
      void refreshGDocSources()
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
      throw new Error("Notebook ID was not found.")
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
          throw new Error(response.error ?? "Failed to fetch source content.")
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

    for (const source of selected) {
      if (!source.backendId) {
        fallbackTitles.push(source.sourceTitle)
        exportRecords.push(buildFallbackRecord(source))
        continue
      }

      const snippetsRaw = sourceSnippets[source.backendId]
      const snippets = Array.isArray(snippetsRaw)
        ? snippetsRaw.map((value) => String(value ?? "").trim()).filter(Boolean)
        : []

      if (snippets.length === 0) {
        fallbackTitles.push(source.sourceTitle)
        exportRecords.push(buildFallbackRecord(source))
        continue
      }

      console.debug("[content:result]", {
        sourceId: source.backendId,
        snippets: snippets.length
      })

      const summaryText = snippetsToSummaryText(snippets, source.sourceKind)
      exportRecords.push({
        sourceId: source.backendId,
        sourceTitle: source.sourceTitle,
        sourceUrl: source.sourceUrl || extractUrlFromSnippets(snippets) || undefined,
        sourceKind: source.sourceKind,
        summaryText
      })
    }

    if (exportRecords.length === 0) {
      throw new Error("No source content was available to preview.")
    }

    if (fallbackTitles.length > 0 || missingBackend.length > 0) {
      console.debug(
        `[content:partial] fallbackCount: ${fallbackTitles.length} | missingBackendCount: ${missingBackend.length}`
      )
    }

    return exportRecords
  }, [])

  const updateFormat = useCallback((nextFormat: DownloadFormat) => {
    setFormat(nextFormat)
    setPreviewDrafts((currentDrafts) =>
      currentDrafts.map((draft) => ({
        ...draft,
        editableContent: buildPreviewText(draft, nextFormat)
      }))
    )
  }, [])

  const handlePreparePreview = useCallback(async () => {
    if (isPreparingPreview || isRunningDownload) {
      return
    }

    if (selectedCount === 0) {
      setToast({
        status: "error",
        message: "Selecione pelo menos 1 fonte para pre-visualizar.",
        progress: 0
      })
      return
    }

    setIsPreparingPreview(true)
    setToast({
      status: "running",
      message: "Buscando conteudo das fontes...",
      progress: 20
    })

    try {
      const selected = sources.filter((source) => selectedSourceIds.has(source.sourceId))
      const exportRecords = await fetchExportRecordsForSelection(selected)
      const nextDrafts: PreviewDraft[] = exportRecords.map((record) => ({
        ...record,
        editableContent: buildPreviewText(record, format)
      }))

      setPreviewDrafts(nextDrafts)
      setActivePreviewSourceId(nextDrafts[0]?.sourceId ?? null)
      setIsPreviewMode(true)
      setToast({
        status: "success",
        message: "Pre-visualizacao pronta. Voce pode editar antes de baixar.",
        progress: 100
      })
    } catch (error) {
      setToast({
        status: "error",
        message: error instanceof Error ? error.message : "Nao foi possivel montar a pre-visualizacao.",
        progress: 0
      })
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
    sources
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
  }, [isRunningDownload])

  const resetActiveDraftContent = useCallback(() => {
    if (!activePreviewDraft) {
      return
    }

    const targetSourceId = activePreviewDraft.sourceId
    setPreviewDrafts((currentDrafts) =>
      currentDrafts.map((draft) =>
        draft.sourceId === targetSourceId
          ? {
              ...draft,
              editableContent: buildPreviewText(draft, format)
            }
          : draft
      )
    )
  }, [activePreviewDraft, format])

  const handleDownloadSelected = useCallback(async () => {
    if (isRunningDownload) {
      return
    }

    setIsRunningDownload(true)
    setToast({
      status: "running",
      message: "Preparando arquivos para download...",
      progress: 4
    })

    try {
      let draftsToExport: PreviewDraft[] = []
      if (isPreviewMode && previewDrafts.length > 0) {
        draftsToExport = previewDrafts
      } else {
        const selected = sources.filter((source) => selectedSourceIds.has(source.sourceId))
        if (selected.length === 0) {
          throw new Error("Selecione pelo menos 1 fonte para baixar.")
        }

        const exportRecords = await fetchExportRecordsForSelection(selected)
        draftsToExport = exportRecords.map((record) => ({
          ...record,
          editableContent: buildPreviewText(record, format)
        }))
      }

      if (draftsToExport.length === 1) {
        const singleDraft = draftsToExport[0]
        const singleFile = buildPreparedFile(singleDraft, format, new Set(), singleDraft.editableContent)
        triggerDownload(
          new Blob([toArrayBuffer(singleFile.bytes)], { type: singleFile.mimeType }),
          singleFile.filename
        )
        setToast({
          status: "success",
          message: "Download concluido com sucesso...",
          progress: 100
        })
        return
      }

      const files: DownloadPreparedFile[] = []
      const usedNames = new Set<string>()
      for (let index = 0; index < draftsToExport.length; index += 1) {
        const draft = draftsToExport[index]
        files.push(buildPreparedFile(draft, format, usedNames, draft.editableContent))
        setToast({
          status: "running",
          message: `Preparando ${index + 1}/${draftsToExport.length}...`,
          progress: Math.round(((index + 1) / draftsToExport.length) * 88)
        })
      }

      setToast({
        status: "running",
        message: "Compactando arquivos...",
        progress: 96
      })
      const zipBytes = buildZip(files.map((file) => ({ filename: file.filename, bytes: file.bytes })))
      triggerDownload(
        new Blob([toArrayBuffer(zipBytes)], { type: "application/zip" }),
        `minddock_fontes_${Date.now()}.zip`
      )

      setToast({
        status: "success",
        message: "Download concluido com sucesso...",
        progress: 100
      })
    } catch (error) {
      setToast({
        status: "error",
        message: error instanceof Error ? error.message : "O download nao pode ser concluido.",
        progress: 0
      })
    } finally {
      setIsRunningDownload(false)
    }
  }, [fetchExportRecordsForSelection, format, isPreviewMode, isRunningDownload, previewDrafts, selectedSourceIds, sources])

  const toastDisplayMessage =
    toast.status === "success"
      ? "Download concluido com sucesso..."
      : toast.message.replace(/\bbaixe\b/gi, "Download").replace(/\bbaixado\b/gi, "Download")

  return (
    <>
      {!isNativePanelCollapsed && (
        <div className="liquid-metal-toolbar whitespace-nowrap">
          <ActionIconButton
            title="Show or hide the filters panel"
            onClick={toggleFilterPanelVisibility}
            active={!isFilterPanelVisible}>
            <ListFilter size={16} strokeWidth={1.8} />
          </ActionIconButton>
        </div>
      )}

      {isOpen && (
        <div
          className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-[#020204]/80 px-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeModal()
            }
          }}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Download de fontes"
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
                    Baixar fontes
                  </h2>
                  <p className="mt-1 text-sm text-[#9ca3af]">
                    {isPreviewMode
                      ? "Revise e edite cada fonte antes de baixar."
                      : "Selecione as fontes para baixar ou abra a previa para revisar antes do download."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
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
                      placeholder="Filtrar fontes..."
                      className="w-full bg-transparent text-sm text-[#e5e7eb] outline-none placeholder:text-[#6b7280]"
                    />
                  </div>
                )}

                <div className={isPreviewMode ? "mt-0" : "mt-3"}>
                  <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/[0.1] bg-[#0e1116] p-2">
                    {(["markdown", "text", "pdf"] as DownloadFormat[]).map((item) => {
                      const active = format === item
                      const label = item === "markdown" ? "Markdown" : item === "text" ? "Texto" : "PDF"
                      const subtitle = item === "markdown" ? ".md" : item === "text" ? ".txt" : ".pdf"

                      return (
                        <button
                          key={item}
                          type="button"
                          onClick={() => updateFormat(item)}
                          className={[
                            "flex min-h-[48px] flex-col justify-center gap-0.5 rounded-lg border px-2.5 py-2 text-left",
                            active
                              ? "border-[#facc15]/40 bg-[#2a2208] text-[#fff1a6]"
                              : "border-transparent bg-[#12161d] text-[#c7ced8]"
                          ].join(" ")}>
                          <span className="text-sm font-semibold leading-none">{label}</span>
                          <span className="text-xs opacity-85">{subtitle}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {!isPreviewMode && (
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[#a5acb8]">
                    <div className="ml-auto flex items-center gap-2">
                      <button
                        type="button"
                        onClick={clearSourceSelection}
                        disabled={selectedCount === 0}
                        className="rounded-md border border-white/[0.1] bg-[#12161d] px-2.5 py-1 text-[#d6dae0] disabled:cursor-not-allowed disabled:opacity-45">
                        Limpar
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {!isPreviewMode && (
                <div className="mx-5 mt-2 min-h-[210px] max-h-[320px] overflow-y-auto rounded-xl border border-white/[0.1] bg-[#0e1116]/90 p-1.5 scrollbar-thin">
                  {isLoadingSources && (
                    <div className="px-3 py-6 text-sm text-[#9ca3af]">Carregando fontes do backend...</div>
                  )}

                  {!isLoadingSources && sourceLoadError && (
                    <div className="px-3 py-6 text-sm text-red-300">{sourceLoadError}</div>
                  )}

                  {!isLoadingSources && !sourceLoadError && filteredSources.length === 0 && (
                    <div className="px-3 py-6 text-sm text-[#9ca3af]">Nenhuma fonte encontrada para este filtro.</div>
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
                              {source.sourceKind === "youtube" ? "YouTube" : "Documento"}
                              {source.isGDoc ? " - GDoc" : ""}
                            </span>
                          </span>
                        </label>
                      )
                    })}
                </div>
              )}

              {isPreviewMode && (
                <div className="mx-5 mt-2 grid min-h-[320px] grid-cols-[260px_minmax(0,1fr)] gap-3">
                  <aside className="overflow-y-auto rounded-xl border border-white/[0.1] bg-[#0e1116]/90 p-1.5">
                    {previewDrafts.map((draft) => {
                      const active = draft.sourceId === activePreviewDraft?.sourceId
                      return (
                        <button
                          key={draft.sourceId}
                          type="button"
                          onClick={() => setActivePreviewSourceId(draft.sourceId)}
                          className={[
                            "mb-1 w-full rounded-lg border px-2.5 py-2 text-left transition-colors last:mb-0",
                            active
                              ? "border-[#facc15]/40 bg-[#2a2208] text-[#fff1a6]"
                              : "border-white/[0.08] bg-[#12161d] text-[#d6dae0]"
                          ].join(" ")}>
                          <div className="truncate text-sm font-semibold">{draft.sourceTitle}</div>
                          <div className="mt-0.5 text-xs text-[#9ca3af]">
                            {draft.sourceKind === "youtube" ? "YouTube" : "Documento"}
                          </div>
                        </button>
                      )
                    })}
                  </aside>

                  <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/[0.1] bg-[#0e1116]/90">
                    <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-3 py-2.5">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-white">
                          {activePreviewDraft?.sourceTitle ?? "Selecione uma fonte"}
                        </h3>
                        <p className="text-xs text-[#9ca3af]">
                          Formato: {format === "markdown" ? "Markdown" : format === "text" ? "Texto" : "PDF"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={resetActiveDraftContent}
                        disabled={!activePreviewDraft}
                        className="inline-flex items-center gap-1 rounded-md border border-white/[0.1] bg-[#12161d] px-2 py-1 text-xs text-[#d6dae0] disabled:cursor-not-allowed disabled:opacity-45">
                        <RotateCcw size={12} />
                        Restaurar
                      </button>
                    </div>
                    <textarea
                      value={activePreviewDraft?.editableContent ?? ""}
                      onChange={(event) => {
                        if (!activePreviewDraft) {
                          return
                        }
                        handlePreviewContentChange(activePreviewDraft.sourceId, event.target.value)
                      }}
                      placeholder="Selecione uma fonte para editar o conteudo."
                      className="min-h-0 flex-1 resize-none bg-transparent px-3 py-3 text-sm leading-6 text-[#e5e7eb] outline-none placeholder:text-[#6b7280]"
                    />
                  </section>
                </div>
              )}

              {(() => {
                const downloadCount = isPreviewMode && previewDrafts.length > 0 ? previewDrafts.length : selectedCount
                return (
              <footer className="mt-3 grid grid-cols-[250px_minmax(0,1fr)] gap-3 px-5 pb-5 pt-1">
                <button
                  type="button"
                  onClick={() => {
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
                    (!isPreviewMode && selectedCount === 0)
                  }
                  className="inline-flex min-h-[54px] items-center justify-center gap-1.5 rounded-xl border border-white/[0.1] bg-[#12161d] px-5 text-base font-semibold text-[#d6dae0] disabled:cursor-not-allowed disabled:opacity-45">
                  {isPreviewMode ? <ArrowLeft size={15} /> : <Eye size={16} />}
                  {isPreviewMode ? "Voltar" : "Previa"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    void handleDownloadSelected()
                  }}
                  disabled={
                    isRunningDownload ||
                    isPreparingPreview ||
                    downloadCount === 0
                  }
                  className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-xl bg-[#16a34a] px-4 text-base font-semibold text-[#052e16] shadow-[0_10px_24px_rgba(22,163,74,0.25)] disabled:cursor-not-allowed disabled:opacity-45">
                  {isRunningDownload ? "Baixando..." : `Download ${downloadCount}`}
                </button>
              </footer>
                )
              })()}
            </div>
          </section>
        </div>
      )}

      {toast.status !== "idle" && (
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
                {isSyncingGDocs ? "Atualizando fontes" : "Baixando fontes"}
              </strong>
              <button
                type="button"
                aria-label="Fechar aviso"
                onClick={() => setToast({ status: "idle", message: "", progress: 0 })}
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
    </>
  )
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
      onClick={onClick}
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
  if (/[A-ZÀ-Ý]/.test(trimmed)) {
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

  return "Fonte sem titulo"
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

  const best = pickBestTitleFromCandidates(Array.from(candidateSet), `Fonte ${index + 1}`)
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

  const fallback = `Fonte ${index + 1}`
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
        !!sourceUrl?.match(/docs\.google\.com|drive\.google\.com/i)
    })
  }

  return results
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

function buildFallbackRecord(source: SourceRow): SourceExportRecord {
  const summaryLines = [
    `Fonte: ${source.sourceTitle}`,
    source.sourceUrl ? `URL: ${source.sourceUrl}` : "",
    "",
    "Conteudo bruto indisponivel no modo atual.",
    "Use a pre-visualizacao para editar manualmente antes do download."
  ].filter(Boolean)

  return {
    sourceId: source.backendId || source.sourceId,
    sourceTitle: source.sourceTitle,
    sourceUrl: source.sourceUrl,
    sourceKind: source.sourceKind,
    summaryText: summaryLines.join("\n")
  }
}

function buildPreviewText(record: SourceExportRecord, format: DownloadFormat): string {
  if (format === "markdown") {
    return formatAsMarkdown(record)
  }

  // For TXT and PDF we keep the same editable plain text body.
  return formatAsText(record)
}

function buildPreparedFile(
  record: SourceExportRecord,
  format: DownloadFormat,
  usedNames: Set<string>,
  overrideContent?: string
): DownloadPreparedFile {
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

  const pdfText = overrideContent ?? formatAsText(record)
  return {
    filename: buildUniqueFilename(record.sourceTitle, ".pdf", usedNames),
    bytes: buildPdfBytesFromText(pdfText),
    mimeType: "application/pdf"
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

