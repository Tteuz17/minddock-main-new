import { useCallback, useEffect, useMemo, useState } from "react"
import { Download, ListFilter, RefreshCw, Trash2, X } from "lucide-react"
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
  clearNativeSourceSearchInputs,
  dispatchSourcePanelReset,
  dispatchSourcePanelToggle,
  extractUrlFromSnippets,
  formatTitleList,
  resolveNotebookIdFromRoute,
  resolveSourceActionsHost
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
  const [toast, setToast] = useState<ToastState>({
    status: "idle",
    message: "",
    progress: 0
  })

  const selectedSources = useMemo(
    () => sources.filter((source) => selectedSourceIds.has(source.sourceId)),
    [sources, selectedSourceIds]
  )

  const filteredSources = useMemo(() => {
    const query = sourceSearch.trim().toLowerCase()
    if (!query) {
      return sources
    }

    return sources.filter((source) => source.sourceTitle.toLowerCase().includes(query))
  }, [sourceSearch, sources])

  const allFilteredSelected =
    filteredSources.length > 0 &&
    filteredSources.every((source) => selectedSourceIds.has(source.sourceId))

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
      throw new Error("Notebook ID nao encontrado na rota atual do NotebookLM.")
    }

    setIsLoadingSources(true)
    setSourceLoadError(null)
    try {
      const response = await sendBackgroundCommand(MESSAGE_ACTIONS.CMD_GET_NOTEBOOK_SOURCES, {
        notebookId
      })
      if (!response.success) {
        throw new Error(response.error ?? "Falha ao listar fontes do notebook.")
      }

      const responsePayload = response.payload ?? response.data
      const sourceList = resolveSourcePayloadList(responsePayload).map(toSourceRow)
      const validSources = sourceList.filter(
        (source) => source.sourceTitle.trim().length > 0
      )

      if (validSources.length === 0) {
        const message =
          "Nenhuma fonte foi retornada pelo backend. Verifique a sessao da conta correta no NotebookLM."
        setSources([])
        setSelectedSourceIds(new Set())
        setSourceLoadError(message)
        throw new Error(message)
      }

      console.debug(
        "[sources:backend]",
        validSources.map((source) => ({ id: source.backendId, title: source.sourceTitle }))
      )

      setSources(validSources)
      setSelectedSourceIds(new Set(validSources.map((source) => source.sourceId)))

      return notebookId
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha ao carregar fontes do notebook."
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
    setSourceLoadError(null)
    setToast({ status: "idle", message: "", progress: 0 })

    try {
      await loadSources()
    } catch (error) {
      setToast({
        status: "error",
        message: error instanceof Error ? error.message : "Erro ao abrir modal de download.",
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

  const toggleSelectAllFilteredSources = (): void => {
    setSelectedSourceIds((currentSet) => {
      const next = new Set(currentSet)

      if (allFilteredSelected) {
        filteredSources.forEach((source) => next.delete(source.sourceId))
      } else {
        filteredSources.forEach((source) => next.add(source.sourceId))
      }

      return next
    })
  }

  const toggleFilterPanelVisibility = (): void => {
    const nextVisible = !isFilterPanelVisible
    setIsFilterPanelVisible(nextVisible)
    dispatchSourcePanelToggle(nextVisible)
  }

  const resetSourcePanelState = (): void => {
    clearNativeSourceSearchInputs()
    dispatchSourcePanelReset()
    dispatchSourcePanelToggle(true)
    setIsFilterPanelVisible(true)
  }

  const refreshGDocSources = useCallback(async () => {
    if (isSyncingGDocs) {
      return
    }

    const notebookId = resolveNotebookIdFromRoute()
    if (!notebookId) {
      setToast({
        status: "error",
        message: "Notebook ID nao encontrado para sincronizar Google Docs.",
        progress: 0
      })
      return
    }

    setIsSyncingGDocs(true)
    setToast({
      status: "running",
      message: "Atualizando fontes Google Docs...",
      progress: 10
    })

    try {
      const response = await sendBackgroundCommand(MESSAGE_ACTIONS.CMD_REFRESH_GDOC_SOURCES, {
        notebookId
      })
      if (!response.success) {
        throw new Error(response.error ?? "Falha ao sincronizar fontes Google Docs.")
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
              ? "Nao ha fontes Google Docs para atualizar."
              : failedSourceTitleList.length > 0
                ? `Atualizacao parcial: ${syncedCount}/${total}.`
                : `Atualizadas ${syncedCount}/${total} fontes.`)
        ),
        progress: 100
      })

      if (isOpen) {
        await loadSources().catch(() => undefined)
      }
    } catch (error) {
      setToast({
        status: "error",
        message: error instanceof Error ? error.message : "Falha ao sincronizar Google Docs.",
        progress: 0
      })
    } finally {
      setIsSyncingGDocs(false)
    }
  }, [isOpen, isSyncingGDocs, loadSources])

  const handleDownloadSelected = useCallback(async () => {
    if (isRunningDownload) {
      return
    }

    setIsRunningDownload(true)
    setToast({
      status: "running",
      message: "Comecando download das fontes...",
      progress: 0
    })

    try {
      const notebookId = resolveNotebookIdFromRoute()
      if (!notebookId) {
        throw new Error("Notebook ID nao encontrado.")
      }

      const selected = sources.filter((source) => selectedSourceIds.has(source.sourceId))
      if (selected.length === 0) {
        throw new Error("Selecione pelo menos uma fonte para baixar.")
      }

      const missingBackend = selected.filter(
        (source) =>
          !source.backendId ||
          String(source.backendId).trim().length === 0 ||
          String(source.backendId).startsWith("minddock-source-")
      )
      if (missingBackend.length > 0) {
        throw new Error(
          `Algumas fontes nao possuem ID valido para exportacao: ${formatTitleList(
            missingBackend.map((source) => source.sourceTitle)
          )}`
        )
      }

      const selectedBackendIds = selected
        .map((source) => source.backendId)
        .filter((sourceId): sourceId is string => !!sourceId)
      console.debug("[download:selected]", {
        notebookId,
        sourceIds: selectedBackendIds,
        titles: selected.map((source) => source.sourceTitle)
      })

      setToast({
        status: "running",
        message: "Buscando conteudo das fontes...",
        progress: 24
      })

      const response = await sendBackgroundCommand(MESSAGE_ACTIONS.CMD_GET_SOURCE_CONTENTS, {
        notebookId,
        sourceIds: selectedBackendIds
      })
      if (!response.success) {
        throw new Error(response.error ?? "Falha ao buscar conteudo das fontes.")
      }

      const payload = (response.payload ?? response.data) as
        | {
            sourceSnippets?: Record<string, string[]>
            failedSourceIds?: string[]
          }
        | undefined

      const sourceSnippets = payload?.sourceSnippets ?? {}
      const failedSourceIds = Array.isArray(payload?.failedSourceIds) ? payload!.failedSourceIds : []

      const withoutContentTitles: string[] = []
      const failedSet = new Set(failedSourceIds)
      const exportRecords: SourceExportRecord[] = []

      for (const source of selected) {
        if (!source.backendId) {
          withoutContentTitles.push(source.sourceTitle)
          continue
        }

        const snippetsRaw = sourceSnippets[source.backendId]
        const snippets = Array.isArray(snippetsRaw)
          ? snippetsRaw.map((value) => String(value ?? "").trim()).filter(Boolean)
          : []

        if (snippets.length === 0) {
          failedSet.add(source.backendId)
          withoutContentTitles.push(source.sourceTitle)
          console.debug("[content:error]", {
            sourceId: source.backendId,
            error: "NO_REAL_CONTENT"
          })
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

      if (failedSet.size > 0 || exportRecords.length === 0) {
        const titles = selected
          .filter((source) => source.backendId && failedSet.has(source.backendId))
          .map((source) => source.sourceTitle)

        throw new Error(
          `Nao foi encontrado conteudo real para: ${formatTitleList(
            titles.length > 0 ? titles : withoutContentTitles
          )}`
        )
      }

      if (exportRecords.length === 1) {
        const singleFile = buildPreparedFile(exportRecords[0], format, new Set())
        triggerDownload(
          new Blob([toArrayBuffer(singleFile.bytes)], { type: singleFile.mimeType }),
          singleFile.filename
        )
        setToast({
          status: "success",
          message: "Download concluido com sucesso.",
          progress: 100
        })
        return
      }

      const files: DownloadPreparedFile[] = []
      const usedNames = new Set<string>()

      for (let index = 0; index < exportRecords.length; index += 1) {
        const record = exportRecords[index]
        files.push(buildPreparedFile(record, format, usedNames))

        setToast({
          status: "running",
          message: `Preparando ${index + 1}/${exportRecords.length}...`,
          progress: Math.round(((index + 1) / exportRecords.length) * 88)
        })
      }

      setToast({
        status: "running",
        message: "Compactando ZIP...",
        progress: 96
      })

      const zipBytes = buildZip(files.map((file) => ({ filename: file.filename, bytes: file.bytes })))
      triggerDownload(
        new Blob([toArrayBuffer(zipBytes)], { type: "application/zip" }),
        `minddock_fontes_${Date.now()}.zip`
      )

      setToast({
        status: "success",
        message: "Download ZIP concluido com sucesso.",
        progress: 100
      })
    } catch (error) {
      setToast({
        status: "error",
        message: error instanceof Error ? error.message : "Nao foi possivel concluir o download.",
        progress: 0
      })
    } finally {
      setIsRunningDownload(false)
    }
  }, [format, isRunningDownload, selectedSourceIds, sources])

  if (isNativePanelCollapsed) {
    return null
  }

  return (
    <>
      <div className="inline-flex items-center gap-2 whitespace-nowrap">
        <ActionIconButton
          title="Exportar fontes visiveis"
          onClick={openModal}
          disabled={isRunningDownload || isLoadingSources}
          active={isOpen}>
          <Download size={16} strokeWidth={1.8} />
        </ActionIconButton>

        <ActionIconButton
          title={isSyncingGDocs ? "Atualizando Google Docs..." : "Atualizar fontes Google Docs"}
          onClick={() => {
            void refreshGDocSources()
          }}
          disabled={isSyncingGDocs}
          active={isSyncingGDocs}>
          <RefreshCw size={16} strokeWidth={1.8} className={isSyncingGDocs ? "animate-spin" : ""} />
        </ActionIconButton>

        <ActionIconButton
          title="Mostrar ou ocultar painel de filtros"
          onClick={toggleFilterPanelVisibility}
          active={!isFilterPanelVisible}>
          <ListFilter size={16} strokeWidth={1.8} />
        </ActionIconButton>

        <ActionIconButton title="Limpar filtros e restaurar painel" onClick={resetSourcePanelState}>
          <Trash2 size={16} strokeWidth={1.8} />
        </ActionIconButton>
      </div>

      {isOpen && (
        <div
          className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeModal()
            }
          }}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Baixar fontes"
            className="flex max-h-[86vh] w-full max-w-[620px] flex-col overflow-hidden rounded-2xl border border-slate-400/35 bg-[linear-gradient(180deg,rgba(31,41,59,0.98)_0%,rgba(17,24,39,0.98)_100%)] text-slate-100 shadow-2xl">
            <header className="flex items-center justify-between gap-3 border-b border-slate-400/25 px-5 pb-3 pt-5">
              <h2 className="text-[30px] font-semibold leading-none tracking-tight text-slate-50">
                Baixar fontes
              </h2>
              <button
                type="button"
                onClick={closeModal}
                disabled={isRunningDownload || isSyncingGDocs}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-400/35 bg-slate-900/60 text-slate-300 disabled:cursor-not-allowed disabled:opacity-55">
                <X size={15} strokeWidth={1.8} />
              </button>
            </header>

            <div className="flex flex-col gap-3 px-5 pt-3">
              <div className="rounded-xl border border-slate-400/30 bg-slate-900/55 px-3 py-2">
                <input
                  type="search"
                  value={sourceSearch}
                  onChange={(event) => setSourceSearch(event.target.value)}
                  placeholder="Fontes de filtro..."
                  className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-400"
                />
              </div>

              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-blue-100">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleSelectAllFilteredSources}
                  className="h-4 w-4 cursor-pointer accent-emerald-500"
                />
                Selecionar todas as fontes
              </label>

              <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-400/30 bg-slate-800/55 p-2">
                {(["markdown", "text", "pdf"] as DownloadFormat[]).map((item) => {
                  const active = format === item
                  const label = item === "markdown" ? "Markdown" : item === "text" ? "Texto simples" : "PDF"
                  const subtitle = item === "markdown" ? "(.md)" : item === "text" ? "(.txt)" : "(.pdf)"

                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setFormat(item)}
                      className={[
                        "flex min-h-[48px] flex-col justify-center gap-0.5 rounded-lg border px-2.5 py-2 text-left",
                        active
                          ? "border-emerald-500/80 bg-emerald-500/20 text-emerald-200"
                          : "border-transparent bg-slate-900/55 text-slate-200"
                      ].join(" ")}>
                      <span className="text-sm font-semibold leading-none">{label}</span>
                      <span className="text-xs opacity-90">{subtitle}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="mx-5 mt-3 min-h-[152px] max-h-[260px] overflow-y-auto rounded-xl border border-slate-400/30 bg-slate-900/45 p-1.5 scrollbar-thin">
              {isLoadingSources && (
                <div className="px-3 py-6 text-sm text-slate-400">Carregando fontes do backend...</div>
              )}

              {!isLoadingSources && sourceLoadError && (
                <div className="px-3 py-6 text-sm text-red-300">
                  {sourceLoadError}
                </div>
              )}

              {!isLoadingSources && !sourceLoadError && filteredSources.length === 0 && (
                <div className="px-3 py-6 text-sm text-slate-400">
                  Nenhuma fonte encontrada com esse filtro.
                </div>
              )}

              {!isLoadingSources &&
                !sourceLoadError &&
                filteredSources.map((source) => (
                  <label
                    key={source.sourceId}
                    className="grid cursor-pointer grid-cols-[20px_minmax(0,1fr)] items-start gap-2 border-t border-slate-400/15 px-2 py-2.5">
                    <input
                      type="checkbox"
                      checked={selectedSourceIds.has(source.sourceId)}
                      onChange={() => toggleSourceSelection(source.sourceId)}
                      className="mt-0.5 h-4 w-4 cursor-pointer accent-emerald-500"
                    />

                    <span className="min-w-0">
                      <span className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-50">
                        <span className="truncate" title={source.sourceTitle}>
                          {source.sourceTitle}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-400">
                        {source.sourceKind === "youtube" ? "YouTube" : "Documento"}
                        {source.isGDoc ? " • GDoc" : ""}
                      </span>
                    </span>
                  </label>
                ))}
            </div>

            <footer className="grid grid-cols-[170px_minmax(0,1fr)] gap-3 px-5 pb-5 pt-4">
              <button
                type="button"
                onClick={() => {
                  void refreshGDocSources()
                }}
                disabled={isSyncingGDocs || isRunningDownload}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-indigo-400/70 bg-indigo-600/80 px-4 text-sm font-semibold text-indigo-100 disabled:cursor-not-allowed disabled:opacity-55">
                {isSyncingGDocs ? "Sincronizando..." : "Atualizar GDocs"}
              </button>

              <button
                type="button"
                onClick={() => {
                  void handleDownloadSelected()
                }}
                disabled={selectedSources.length === 0 || isRunningDownload || isLoadingSources}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-emerald-500 px-4 text-base font-semibold text-emerald-950 shadow-[0_10px_24px_rgba(16,185,129,0.25)] disabled:cursor-not-allowed disabled:opacity-55">
                {isRunningDownload
                  ? "Baixando..."
                  : `Baixar selecionado (${selectedSources.length})`}
              </button>
            </footer>
          </section>
        </div>
      )}

      {toast.status !== "idle" && (
        <aside className="fixed bottom-4 right-4 z-[2147483647] w-[min(360px,calc(100vw-32px))] rounded-2xl border border-slate-400/35 bg-slate-900/95 p-3 text-slate-100 shadow-2xl">
          <header className="mb-2 flex items-center justify-between gap-2">
            <strong className="text-base leading-none">
              {isSyncingGDocs ? "Atualizacao de fontes" : "Baixando fontes"}
            </strong>
            <button
              type="button"
              aria-label="Fechar aviso"
              onClick={() => setToast({ status: "idle", message: "", progress: 0 })}
              className="inline-flex h-5 w-5 items-center justify-center text-slate-400 hover:text-slate-100">
              <X size={14} strokeWidth={1.8} />
            </button>
          </header>

          <p className="mb-2 text-sm text-slate-300">{toast.message}</p>

          <div className="h-2 overflow-hidden rounded-full bg-slate-400/25">
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
      onClick={onClick}
      disabled={disabled}
      className={[
        "inline-flex h-6 w-6 items-center justify-center rounded border border-transparent bg-transparent text-slate-200 transition-colors",
        "hover:border-slate-400/45 hover:bg-slate-700/35",
        active ? "border-blue-400/75 bg-blue-800/35" : "",
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

        resolve(response ?? { success: false, error: "Sem resposta do background." })
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

function toSourceRow(source: Partial<Source>, index: number): SourceRow {
  const backendId = typeof source.id === "string" && source.id.trim() ? source.id.trim() : null
  const sourceId = backendId ?? `minddock-source-${index}`
  const sourceTitle =
    typeof source.title === "string" && source.title.trim()
      ? source.title.trim()
      : `Fonte ${index + 1}`
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

function buildPreparedFile(
  record: SourceExportRecord,
  format: DownloadFormat,
  usedNames: Set<string>
): DownloadPreparedFile {
  if (format === "markdown") {
    const content = formatAsMarkdown(record)
    return {
      filename: buildUniqueFilename(record.sourceTitle, ".md", usedNames),
      bytes: encoder.encode(content),
      mimeType: "text/markdown;charset=utf-8"
    }
  }

  if (format === "text") {
    const content = formatAsText(record)
    return {
      filename: buildUniqueFilename(record.sourceTitle, ".txt", usedNames),
      bytes: encoder.encode(content),
      mimeType: "text/plain;charset=utf-8"
    }
  }

  const pdfText = formatAsText(record)
  return {
    filename: buildUniqueFilename(record.sourceTitle, ".pdf", usedNames),
    bytes: buildPdfBytesFromText(pdfText),
    mimeType: "application/pdf"
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
