import { useCallback, useEffect, useRef, useState } from "react"
import {
  Braces,
  ChevronDown,
  Code2,
  Copy,
  Download,
  Eye,
  File,
  FileCode2,
  FileText,
  Loader2,
  Wand2,
  X
} from "lucide-react"
import { zipSync } from "fflate"
import { DocsExportAction } from "~/content/features/Export/DocsExportAction"
import { NotionExportAction } from "~/content/features/Export/NotionExportAction"
import { base64ToBytes } from "~/lib/base64-bytes"
import { MESSAGE_ACTIONS, type StandardResponse } from "~/lib/contracts"
import { buildDocxBytesFromText, triggerDownload } from "~/lib/source-download"
import { showMindDockToast } from "../common/minddock-ui"
import {
  captureVisibleMessages,
  isVisible,
  queryDeepAll
} from "./sourceDom"

type ExportFormat = "markdown" | "html" | "text" | "word" | "epub" | "pdf" | "json"

interface FormatOption {
  id: ExportFormat
  label: string
  icon: typeof FileCode2
}

interface ExportTurn {
  role: "user" | "assistant"
  content: string
}

interface ExportBundle {
  title: string
  generatedAtIso: string
  includeUserTurns: boolean
  includeSources: boolean
  turns: ExportTurn[]
}

interface ChatMessageBlock {
  role: "user" | "assistant"
  content: string
  top: number
  left: number
  anchor: HTMLElement
}

interface ConversationTurnRecord {
  id: string
  top: number
  assistantContent: string
  userContent?: string
  assistantAnchor: HTMLElement
  saveControl: HTMLElement | null
}

interface CachedTurnRecord {
  id: string
  assistantContent: string
  userContent?: string
  capturedAt: number
}

interface SelectionControlSyncOptions {
  selectedTurnIds: Set<string>
  onToggleTurn: (turnId: string) => void
  onPruneSelection: (validTurnIds: Set<string>) => void
  onObserveTurn: (turn: ConversationTurnRecord) => void
}

interface RenderedTurnRecord {
  role: "user" | "assistant"
  roleLabel: string
  content: string
}

interface RenderedExportBundle {
  title: string
  generatedAtIso: string
  turns: RenderedTurnRecord[]
}

interface PreviewDraft {
  title: string
  generatedAtIso: string
  filenameBase: string
  initialContent: string
}

interface ModalPreviewRenderState {
  mode: "html" | "text"
  html: string
  text: string
  error?: string
}

interface EpubChapter {
  id: string
  filename: string
  title: string
  htmlFragment: string
}

interface EpubBuildOptions {
  title: string
  generatedAtIso: string
  chapters: EpubChapter[]
  author?: string
  language?: string
  identifier?: string
}

const FORMAT_OPTIONS: readonly FormatOption[] = [
  { id: "markdown", label: "Markdown", icon: FileCode2 },
  { id: "html", label: "HTML", icon: Code2 },
  { id: "text", label: "Plain text", icon: FileText },
  { id: "word", label: "Word", icon: FileText },
  { id: "epub", label: "EPUB", icon: FileText },
  { id: "pdf", label: "PDF", icon: File },
  { id: "json", label: "JSON", icon: Braces }
]

const ASSISTANT_TURN_SELECTORS = [
  "[data-testid='chat-message-assistant']",
  "[data-testid='response-text']",
  ".response-container .message-content",
  ".response-container"
] as const

const USER_TURN_SELECTORS = [
  "[data-testid='chat-message-user']",
  "[data-testid='user-query']",
  "[data-testid='query-text']",
  ".user-query-text",
  ".query-container .query-text",
  ".query-container"
] as const

const TURN_PAIR_SELECTORS = [".chat-message-pair"] as const
const TURN_KEY_ATTRS = ["data-turn-id", "data-message-id", "data-id", "id"] as const
const USER_CONTENT_SELECTORS = [
  ".from-user-container .message-text-content",
  "[data-testid='query-text']",
  "[data-testid='user-query']",
  ".query-container .query-text",
  ".user-query-text"
] as const
const ASSISTANT_CONTENT_SELECTORS = [
  ".to-user-container .message-text-content",
  "[data-testid='response-text']",
  "[data-testid='chat-message-assistant'] [data-testid='response-text']",
  ".response-container .message-content",
  ".response-content"
] as const
const STRICT_USER_TURN_CONTAINER_SELECTORS = [".from-user-container", "[data-testid='chat-message-user']"] as const
const CITATION_MARKER_SELECTORS = [
  "button.citation-marker",
  "button[aria-label*='Source' i]",
  "button[aria-label*='Fonte' i]",
  "[data-testid*='citation' i]",
  "[class*='citation-marker']"
] as const

const PDF_EXTENSION = ".pdf"
const MARKDOWN_EXTENSION = ".md"
const HTML_EXTENSION = ".html"
const TEXT_EXTENSION = ".txt"
const WORD_EXTENSION = ".docx"
const EPUB_EXTENSION = ".epub"
const JSON_EXTENSION = ".json"
const EPUB_MIME_TYPE = "application/epub+zip"
const EPUB_DEFAULT_AUTHOR = "MindDock"
const EPUB_DEFAULT_LANGUAGE = "pt-BR"
const PREVIEW_DEBOUNCE_MS = 180
const STORAGE_KEY_INCLUDE_USER_TURNS = "minddock:chat-export:include-user-turns"
const STORAGE_KEY_INCLUDE_SOURCES = "minddock:chat-export:include-sources"
const TURN_SELECTION_BUTTON_SELECTOR = "button[data-minddock-turn-select='true']"
const TURN_SELECTION_STYLE_ID = "minddock-turn-selection-style"
const TURN_SELECTION_STALE_GRACE_MS = 2600
const SOURCE_TOKEN_REGEX = /\[(?:source|fonte)\s*:\s*([^\]]+)\]/gi
const SOURCE_NUMBER_REGEX = /\d{1,4}/
const BAD_SOURCE_NAMES_REGEX = /^(video_audio_call|video_youtube|article|drive_presentation|web|text|pdf)$/i
const GENERIC_SOURCE_TITLE_REGEX = /^(documento|document|source|fonte|untitled source|fonte sem titulo|article|arquivo)$/i
const GENERIC_CITATION_LABEL_REGEX =
  /^(source|fonte|citation|citacao|citar|reference|referencia)\s*[:#-]?\s*\d*\s*$/i
const MINDDOCK_WORDMARK_SRC = new URL("../../public/images/logo/logo minddock sem fundo.png", import.meta.url).href

function isExtensionContextInvalidatedError(error: unknown): boolean {
  const normalizedMessage = String(error instanceof Error ? error.message : error ?? "")
    .toLowerCase()
    .trim()
  return normalizedMessage.includes("extension context invalidated")
}

function hasActiveExtensionRuntime(): boolean {
  try {
    return Boolean(chrome?.runtime?.id && chrome?.storage?.local)
  } catch {
    return false
  }
}

export function ConversationExportMenu() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [includeUserTurns, setIncludeUserTurns] = useState(true)
  const [includeSources, setIncludeSources] = useState(false)
  const [busyFormat, setBusyFormat] = useState<ExportFormat | null>(null)
  const [isCopying, setIsCopying] = useState(false)
  const [copyDone, setCopyDone] = useState(false)
  const [selectedTurnIds, setSelectedTurnIds] = useState<Set<string>>(new Set())
  const selectedTurnIdsRef = useRef<Set<string>>(new Set())
  const selectedTurnCacheRef = useRef<Map<string, CachedTurnRecord>>(new Map())
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewDraft, setPreviewDraft] = useState<PreviewDraft | null>(null)
  const [previewText, setPreviewText] = useState("")
  const [previewDebouncedText, setPreviewDebouncedText] = useState("")
  const [previewFormat, setPreviewFormat] = useState<ExportFormat>("markdown")
  const [isPreviewExporting, setIsPreviewExporting] = useState(false)

  const toggleTurnSelection = useCallback((turnId: string): void => {
    if (!turnId) {
      return
    }

    setSelectedTurnIds((current) => {
      const next = new Set(current)
      if (next.has(turnId)) {
        next.delete(turnId)
      } else {
        next.add(turnId)
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (!hasActiveExtensionRuntime()) {
      return
    }

    try {
      chrome.storage.local.get([STORAGE_KEY_INCLUDE_USER_TURNS, STORAGE_KEY_INCLUDE_SOURCES], (snapshot) => {
        const runtimeErrorMessage = String(chrome.runtime?.lastError?.message ?? "").trim()
        if (runtimeErrorMessage) {
          if (!isExtensionContextInvalidatedError(runtimeErrorMessage)) {
            console.debug("[MindDock] Falha ao carregar preferencias de exportacao", runtimeErrorMessage)
          }
          return
        }

        const storedIncludeUser = snapshot?.[STORAGE_KEY_INCLUDE_USER_TURNS]
        const storedIncludeSources = snapshot?.[STORAGE_KEY_INCLUDE_SOURCES]

        if (typeof storedIncludeUser === "boolean") {
          setIncludeUserTurns(storedIncludeUser)
        }
        if (typeof storedIncludeSources === "boolean") {
          setIncludeSources(storedIncludeSources)
        }
      })
    } catch (error) {
      if (!isExtensionContextInvalidatedError(error)) {
        console.debug("[MindDock] Falha ao iniciar leitura de preferencias de exportacao", error)
      }
    }
  }, [])

  useEffect(() => {
    if (!hasActiveExtensionRuntime()) {
      return
    }

    try {
      chrome.storage.local.set(
        {
          [STORAGE_KEY_INCLUDE_USER_TURNS]: includeUserTurns
        },
        () => {
          const runtimeErrorMessage = String(chrome.runtime?.lastError?.message ?? "").trim()
          if (runtimeErrorMessage && !isExtensionContextInvalidatedError(runtimeErrorMessage)) {
            console.debug("[MindDock] Falha ao salvar preferencia includeUserTurns", runtimeErrorMessage)
          }
        }
      )
    } catch (error) {
      if (!isExtensionContextInvalidatedError(error)) {
        console.debug("[MindDock] Falha ao iniciar persistencia includeUserTurns", error)
      }
    }
  }, [includeUserTurns])

  useEffect(() => {
    if (!hasActiveExtensionRuntime()) {
      return
    }

    try {
      chrome.storage.local.set(
        {
          [STORAGE_KEY_INCLUDE_SOURCES]: includeSources
        },
        () => {
          const runtimeErrorMessage = String(chrome.runtime?.lastError?.message ?? "").trim()
          if (runtimeErrorMessage && !isExtensionContextInvalidatedError(runtimeErrorMessage)) {
            console.debug("[MindDock] Falha ao salvar preferencia includeSources", runtimeErrorMessage)
          }
        }
      )
    } catch (error) {
      if (!isExtensionContextInvalidatedError(error)) {
        console.debug("[MindDock] Falha ao iniciar persistencia includeSources", error)
      }
    }
  }, [includeSources])

  useEffect(() => {
    selectedTurnIdsRef.current = selectedTurnIds
  }, [selectedTurnIds])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) {
        return
      }

      if (!containerRef.current?.contains(event.target)) {
        setIsOpen(false)
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false)
      }
    }

    document.addEventListener("mousedown", onPointerDown, true)
    document.addEventListener("keydown", onKeyDown, true)

    return () => {
      document.removeEventListener("mousedown", onPointerDown, true)
      document.removeEventListener("keydown", onKeyDown, true)
    }
  }, [isOpen])

  useEffect(() => {
    if (!copyDone) {
      return
    }

    const timer = window.setTimeout(() => setCopyDone(false), 1200)
    return () => window.clearTimeout(timer)
  }, [copyDone])

  useEffect(() => {
    if (!isPreviewOpen) {
      setPreviewDebouncedText("")
      return
    }

    const timer = window.setTimeout(() => {
      setPreviewDebouncedText(previewText)
    }, PREVIEW_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [isPreviewOpen, previewText])

  useEffect(() => {
    if (!isPreviewOpen) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return
      }
      stopEventPropagation(event)
      setIsPreviewOpen(false)
    }

    document.addEventListener("keydown", onKeyDown, true)
    return () => {
      document.removeEventListener("keydown", onKeyDown, true)
    }
  }, [isPreviewOpen])

  useEffect(() => {
    ensureTurnSelectionStyles()

    let frameHandle: number | null = null
    const scheduleSync = () => {
      if (frameHandle !== null) {
        return
      }
      frameHandle = window.requestAnimationFrame(() => {
        frameHandle = null
        syncTurnSelectionControls({
          selectedTurnIds: selectedTurnIdsRef.current,
          onToggleTurn: toggleTurnSelection,
          onObserveTurn: (turn) => {
            const cache = selectedTurnCacheRef.current
            cache.set(turn.id, {
              id: turn.id,
              assistantContent: turn.assistantContent,
              userContent: turn.userContent,
              capturedAt: Date.now()
            })

            if (cache.size > 450) {
              const ordered = Array.from(cache.values()).sort((left, right) => right.capturedAt - left.capturedAt)
              const keep = new Set(ordered.slice(0, 350).map((item) => item.id))
              for (const key of Array.from(cache.keys())) {
                if (!keep.has(key)) {
                  cache.delete(key)
                }
              }
            }
          },
          onPruneSelection: (validTurnIds) => {
            setSelectedTurnIds((current) => {
              const cache = selectedTurnCacheRef.current
              const next = new Set(Array.from(current).filter((turnId) => validTurnIds.has(turnId) || cache.has(turnId)))
              if (next.size === current.size) {
                return current
              }
              return next
            })
          }
        })
      })
    }

    scheduleSync()
    const observer = new MutationObserver((mutations) => {
      if (
        mutations.some((mutation) => {
          if (mutation.target instanceof Element && mutation.target.closest("#minddock-conversation-export-root")) {
            return false
          }

          const hasRelevantNode = [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
            if (!(node instanceof Element)) {
              return false
            }
            if (node.closest("#minddock-conversation-export-root")) {
              return false
            }
            if (isTurnSelectionControlElement(node)) {
              return false
            }
            return true
          })

          return hasRelevantNode
        })
      ) {
        scheduleSync()
      }
    })

    if (document.body instanceof HTMLBodyElement) {
      observer.observe(document.body, { childList: true, subtree: true })
    }

    const onScroll = () => {
      scheduleSync()
    }
    const onResize = () => {
      scheduleSync()
    }
    const onVisibilityChange = () => {
      if (!document.hidden) {
        scheduleSync()
      }
    }
    document.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", onResize, { passive: true })
    document.addEventListener("visibilitychange", onVisibilityChange)

    const timer = window.setInterval(scheduleSync, 500)
    return () => {
      observer.disconnect()
      document.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", onResize)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.clearInterval(timer)
      if (frameHandle !== null) {
        window.cancelAnimationFrame(frameHandle)
      }
    }
  }, [toggleTurnSelection])

  const isBusy = busyFormat !== null || isCopying || isPreviewLoading || isPreviewExporting
  const selectedCount = selectedTurnIds.size
  const exportLabel = selectedCount > 0 ? `Export (${selectedCount})` : "Export"
  const copyLabel = selectedCount > 0 ? `Copy (${selectedCount})` : "Copy"
  const previewRenderState = buildModalPreviewRenderState(previewDebouncedText, previewFormat)

  const handleFormatExport = async (format: ExportFormat): Promise<void> => {
    if (isBusy) {
      return
    }

    setBusyFormat(format)
    try {
      const bundle = buildExportBundle({
        includeUserTurns,
        includeSources,
        selectedTurnIds,
        selectedTurnCache: selectedTurnCacheRef.current
      })
      await downloadBundleByFormat(bundle, format)
      setIsOpen(false)
    } catch (error) {
      console.error("[MindDock] Exportacao do chat falhou", error)
    } finally {
      setBusyFormat(null)
    }
  }

  const handleCopyCurrent = async (): Promise<void> => {
    if (isBusy || !navigator.clipboard) {
      return
    }

    setIsCopying(true)
    try {
      // Keep selected turn payload stable even when NotebookLM virtualizes the DOM.
      const stableBundle = buildCopyBundle(selectedTurnIds, selectedTurnCacheRef.current)
      const textToCopy = buildCopyText(stableBundle)
      await navigator.clipboard.writeText(textToCopy)
      setCopyDone(true)
    } catch (error) {
      console.error("[MindDock] Copia do chat falhou", error)
      setCopyDone(false)
    } finally {
      setIsCopying(false)
    }
  }

  const handleOpenPreviewEditor = async (): Promise<void> => {
    if (isBusy) {
      return
    }

    setIsPreviewLoading(true)
    try {
      const bundle = buildExportBundle({
        includeUserTurns,
        includeSources,
        selectedTurnIds,
        selectedTurnCache: selectedTurnCacheRef.current
      })
      const initialContent = buildMarkdown(bundle)

      setPreviewDraft({
        title: bundle.title,
        generatedAtIso: bundle.generatedAtIso,
        filenameBase: buildFilenameBase(bundle.title),
        initialContent
      })
      setPreviewText(initialContent)
      setPreviewDebouncedText(initialContent)
      setPreviewFormat("markdown")
      setIsOpen(false)
      setIsPreviewOpen(true)
    } catch (error) {
      console.error("[MindDock] Nao foi possivel abrir preview de exportacao", error)
      showMindDockToast({
        message: error instanceof Error ? error.message : "Failed to open export preview.",
        variant: "error",
        timeoutMs: 3200
      })
    } finally {
      setIsPreviewLoading(false)
    }
  }

  const handleClosePreviewEditor = (): void => {
    setIsPreviewOpen(false)
    setPreviewDraft(null)
    setPreviewText("")
    setPreviewDebouncedText("")
  }

  const handleResetPreviewEditor = (): void => {
    if (!previewDraft) {
      return
    }
    setPreviewText(previewDraft.initialContent)
    setPreviewDebouncedText(previewDraft.initialContent)
  }

  const handleExportFromPreview = async (): Promise<void> => {
    if (!previewDraft || isPreviewExporting) {
      return
    }

    const cleaned = normalizeForExportDisplay(previewText)
    if (!cleaned) {
      showMindDockToast({
        message: "Content is empty. Edit the text before exporting.",
        variant: "error",
        timeoutMs: 3000
      })
      return
    }

    setIsPreviewExporting(true)
    try {
      await downloadEditedContentByFormat({
        title: previewDraft.title,
        generatedAtIso: previewDraft.generatedAtIso,
        filenameBase: previewDraft.filenameBase,
        content: cleaned,
        format: previewFormat
      })
      showMindDockToast({
        message: "Export completed.",
        variant: "success"
      })
      handleClosePreviewEditor()
    } catch (error) {
      console.error("[MindDock] Exportacao via preview falhou", error)
      showMindDockToast({
        message: error instanceof Error ? error.message : "Failed to export edited content.",
        variant: "error",
        timeoutMs: 3200
      })
    } finally {
      setIsPreviewExporting(false)
    }
  }

  return (
    <div
      ref={containerRef}
      data-minddock-conversation-export="true"
      className="relative mr-1 inline-flex shrink-0 items-center">
      <div className="inline-flex shrink-0 items-center gap-1 rounded-[12px] border border-white/[0.08] bg-[#06080c] p-[3px]">
        <button
          type="button"
          title={exportLabel}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onMouseDown={swallowInteraction}
          onClick={(event) => {
            swallowInteraction(event)
            if (!isBusy) {
              setIsOpen((previous) => !previous)
            }
          }}
          disabled={isBusy}
          className={[
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] border px-3 text-[13px] font-medium transition-colors",
            isOpen
              ? "border-white/[0.16] bg-[#11151c] text-white"
              : "border-transparent bg-transparent text-[#cfd6e3] hover:bg-white/[0.04] hover:text-white",
            isBusy ? "cursor-not-allowed opacity-70" : "cursor-pointer"
          ].join(" ")}>
          {busyFormat ? (
            <Loader2 size={14} strokeWidth={2} className="animate-spin" />
          ) : (
            <Download size={14} strokeWidth={1.9} className={isOpen ? "text-[#facc15]" : "text-[#d7deea]"} />
          )}
          <span className="whitespace-nowrap">{exportLabel}</span>
          <ChevronDown size={14} strokeWidth={1.9} className={["transition-transform", isOpen ? "rotate-180" : ""].join(" ")} />
        </button>

        <button
          type="button"
          title={copyDone ? "Copied!" : copyLabel}
          aria-label={copyDone ? "Copied!" : copyLabel}
          onMouseDown={swallowInteraction}
          onClick={(event) => {
            swallowInteraction(event)
            void handleCopyCurrent()
          }}
          disabled={isBusy}
          className={[
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] border border-transparent bg-transparent px-3 text-[13px] font-medium transition-colors",
            copyDone
              ? "text-[#facc15]"
              : "text-[#cfd6e3] hover:bg-white/[0.04] hover:text-white",
            isBusy ? "cursor-not-allowed opacity-70" : "cursor-pointer"
          ].join(" ")}>
          {isCopying ? (
            <Loader2 size={14} strokeWidth={2} className="animate-spin" />
          ) : (
            <Copy size={14} strokeWidth={1.9} className={copyDone ? "text-[#facc15]" : "text-[#aab4c7]"} />
          )}
          <span className="whitespace-nowrap">{copyDone ? "Copied!" : copyLabel}</span>
        </button>
      </div>

      {isOpen ? (
        <section
          role="menu"
          aria-label="Export menu"
          className="absolute right-0 top-[calc(100%+10px)] z-[2147483646] w-[324px] rounded-[18px] border border-white/[0.08] bg-[#000000] p-2 shadow-[0_24px_56px_rgba(0,0,0,0.52)]">
          <div className="space-y-2">
            <div className="rounded-[14px] border border-white/[0.08] bg-[#050505] p-2.5">
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.03] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#93a0b6]">
                <Download size={11} strokeWidth={2} className="text-[#facc15]" />
                Configuration
              </div>
              <div className="space-y-1.5">
                <MenuToggleRow
                  label="Include user turns"
                  description="Adds your prompts and commands to the export."
                  kind="turns"
                  checked={includeUserTurns}
                  onToggle={() => setIncludeUserTurns((previous) => !previous)}
                />
                <MenuToggleRow
                  label="Include sources"
                  description="Attaches citations and source references."
                  kind="sources"
                  checked={includeSources}
                  onToggle={() => setIncludeSources((previous) => !previous)}
                />
              </div>
            </div>

            <button
              type="button"
              role="menuitem"
              onMouseDown={swallowInteraction}
              onClick={(event) => {
                swallowInteraction(event)
                void handleOpenPreviewEditor()
              }}
              disabled={isBusy}
              className={[
                "flex w-full items-center justify-between rounded-[12px] border border-[#eab308] bg-[#facc15] px-3 py-2.5 text-left text-[13px] text-[#0f0b00] shadow-[0_10px_26px_rgba(250,204,21,0.24)] transition-colors",
                isBusy ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-[#fbbf24]"
              ].join(" ")}>
              <span className="inline-flex items-center gap-2.5 font-semibold">
                {isPreviewLoading ? (
                  <Loader2 size={15} strokeWidth={1.8} className="animate-spin text-[#0f0b00]" />
                ) : (
                  <Wand2 size={15} strokeWidth={1.9} className="text-[#0f0b00]" />
                )}
                <span>Preview and edit</span>
              </span>
              <span className="rounded-full border border-black/55 bg-black/85 px-2 py-[1px] text-[10px] font-semibold tracking-[0.04em] text-[#facc15]">
                PRO
              </span>
            </button>

            <div className="rounded-[14px] border border-white/[0.08] bg-[#050505] p-2">
              <div className="mb-1 px-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8390a5]">
                Integrations
              </div>
              <DocsExportAction
                className="border-white/[0.08] bg-[#050505] hover:border-[#facc15]/20 hover:bg-[#121212]"
                disabled={isBusy}
                onExportFinished={() => {
                  setIsOpen(false)
                }}
              />

              <NotionExportAction
                className="mt-1.5 border-white/[0.08] bg-[#050505] hover:border-[#facc15]/20 hover:bg-[#121212]"
                disabled={isBusy}
                includeUserTurns={includeUserTurns}
                includeSources={includeSources}
                onExportFinished={() => {
                  setIsOpen(false)
                }}
              />
            </div>

            <div className="overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#050505]">
              <div className="flex items-center justify-between border-b border-white/[0.08] px-3 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8390a5]">Formats</span>
                <span className="text-[10px] text-[#728098]">{FORMAT_OPTIONS.length} options</span>
              </div>
              {FORMAT_OPTIONS.map((option) => {
                const Icon = option.icon
                const isRunning = busyFormat === option.id

                return (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitem"
                    onMouseDown={swallowInteraction}
                    onClick={(event) => {
                      swallowInteraction(event)
                      void handleFormatExport(option.id)
                    }}
                    disabled={isBusy}
                    className={[
                      "group flex w-full items-center gap-3 border-t border-white/[0.06] px-3 py-2.5 text-left text-[13px] transition-colors first:border-t-0",
                      "text-[#d0d6e1]",
                      isBusy ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-[#121212] hover:text-white"
                    ].join(" ")}>
                    <span className="inline-flex h-[20px] w-[20px] items-center justify-center rounded-[6px] border border-white/[0.12] bg-[#0a0f16] text-[#facc15] transition-colors group-hover:border-[#facc15]/35 group-hover:bg-[#1f1a08]">
                      <Icon size={12} strokeWidth={2} />
                    </span>
                    <span className="flex-1" translate={option.id === "word" || option.id === "epub" ? "no" : "yes"}>
                      {option.label}
                    </span>
                    {isRunning ? <Loader2 size={13} strokeWidth={2} className="animate-spin text-[#facc15]" /> : null}
                  </button>
                )
              })}
            </div>

            <div className="flex items-center justify-between rounded-[10px] border border-white/[0.06] bg-[#050505] px-3 py-2">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[#6f7c93]">Powered by</span>
              <img src={MINDDOCK_WORDMARK_SRC} alt="MindDock" className="h-4 w-auto object-contain opacity-95" />
            </div>
          </div>
        </section>
      ) : null}

      {isPreviewOpen && previewDraft ? (
        <PreviewExportModal
          title={previewDraft.title}
          generatedAtIso={previewDraft.generatedAtIso}
          format={previewFormat}
          text={previewText}
          renderState={previewRenderState}
          busy={isPreviewExporting}
          onTextChange={setPreviewText}
          onChangeFormat={setPreviewFormat}
          onClose={handleClosePreviewEditor}
          onReset={handleResetPreviewEditor}
          onExport={handleExportFromPreview}
        />
      ) : null}
    </div>
  )
}

interface MenuToggleRowProps {
  label: string
  description?: string
  kind?: "turns" | "sources"
  checked: boolean
  onToggle: () => void
}

function MenuToggleRow(props: MenuToggleRowProps) {
  const { label, description, kind = "turns", checked, onToggle } = props
  const Icon = kind === "sources" ? File : FileText

  return (
    <div className="flex items-center justify-between gap-3 rounded-[11px] border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
      <div className="min-w-0 flex items-center gap-2.5">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-white/[0.1] bg-[#0a0a0a]">
          <Icon size={13} strokeWidth={2} className="text-[#facc15]" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[12px] font-medium text-[#dfe5f1]">{label}</span>
          {description ? <span className="mt-[1px] block text-[10px] text-[#7f8aa0]">{description}</span> : null}
        </span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onMouseDown={swallowInteraction}
        onClick={(event) => {
          swallowInteraction(event)
          onToggle()
        }}
        className={[
          "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
          checked ? "border-[#eab308] bg-[#facc15]" : "border-white/[0.14] bg-[#161a21]"
        ].join(" ")}>
        <span
          className={[
            "absolute left-[1.5px] top-[1.5px] h-[14px] w-[14px] rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.4)] transition-transform",
            checked ? "bg-[#120f08]" : "bg-[#e4ebf8]",
            checked ? "translate-x-[14px]" : ""
          ].join(" ")}
        />
      </button>
    </div>
  )
}

interface PreviewExportModalProps {
  title: string
  generatedAtIso: string
  format: ExportFormat
  text: string
  renderState: ModalPreviewRenderState
  busy: boolean
  onTextChange: (value: string) => void
  onChangeFormat: (format: ExportFormat) => void
  onClose: () => void
  onReset: () => void
  onExport: () => void
}

function PreviewExportModal(props: PreviewExportModalProps) {
  const {
    title,
    generatedAtIso,
    format,
    text,
    renderState,
    busy,
    onTextChange,
    onChangeFormat,
    onClose,
    onReset,
    onExport
  } = props

  return (
    <div
      className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-[#070b12]/80 p-4 backdrop-blur-[2px]"
      onMouseDown={stopEventPropagation}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Preview and edit export"
        onMouseDown={stopEventPropagation}
        className="flex h-[min(82vh,760px)] w-[min(1100px,96vw)] flex-col overflow-hidden rounded-[18px] border border-white/[0.11] bg-[#0d131d] shadow-[0_24px_56px_rgba(0,0,0,0.54)]">
        <header className="border-b border-white/[0.08] bg-[#101824] px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-[14px] font-semibold text-[#e9edf7]">Preview and edit</h3>
              <p className="mt-0.5 truncate text-[12px] text-[#9ca8bf]">
                {title} · {formatExportTimestamp(generatedAtIso)}
              </p>
            </div>
            <button
              type="button"
              title="Close"
              onClick={onClose}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-white/[0.1] bg-[#111b29] text-[#b7c2d8] transition-colors hover:bg-[#1a2536] hover:text-white">
              <X size={14} strokeWidth={2} />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {FORMAT_OPTIONS.map((option) => {
              const Icon = option.icon
              const selected = option.id === format
              return (
                <button
                  key={`preview-format-${option.id}`}
                  type="button"
                  onClick={() => onChangeFormat(option.id)}
                  className={[
                    "inline-flex h-7 items-center gap-1.5 rounded-[9px] border px-2.5 text-[12px] font-medium transition-colors",
                    selected
                      ? "border-[#8ab4f8]/50 bg-[#18253a] text-[#dce8ff]"
                      : "border-white/[0.08] bg-[#101722] text-[#adb7ca] hover:bg-[#151f2e] hover:text-[#e7edf9]"
                  ].join(" ")}>
                  <Icon size={12} strokeWidth={2} />
                  <span translate={option.id === "word" || option.id === "epub" ? "no" : "yes"}>{option.label}</span>
                </button>
              )
            })}
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 border-t border-white/[0.04] md:grid-cols-2">
          <div className="min-h-0 border-b border-white/[0.07] bg-[#0d141f] md:border-b-0 md:border-r">
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-white/[0.08] px-4 py-2 text-[12px] font-medium text-[#9eabc0]">Editor</div>
              <textarea
                value={text}
                onChange={(event) => onTextChange(event.target.value)}
                spellCheck={false}
                className="h-full min-h-0 w-full resize-none bg-transparent px-4 py-3 text-[13px] leading-relaxed text-[#dce4f2] outline-none placeholder:text-[#6f7f97]"
              />
            </div>
          </div>

          <div className="min-h-0 bg-[#0a111a]">
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-white/[0.08] px-4 py-2 text-[12px] font-medium text-[#9eabc0]">Preview</div>
              <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
                {renderState.error ? <p className="mb-2 text-[12px] text-[#fca5a5]">{renderState.error}</p> : null}
                {renderState.mode === "html" ? (
                  <div
                    className="prose prose-invert max-w-none text-[13px] text-[#dbe4f5] [&_a]:text-[#93c5fd] [&_code]:rounded [&_code]:bg-[#162238] [&_code]:px-1 [&_code]:py-0.5 [&_h1]:text-[22px] [&_h2]:text-[18px] [&_h3]:text-[15px] [&_li]:my-1 [&_pre]:rounded-[10px] [&_pre]:bg-[#0e1828] [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:pl-5"
                    dangerouslySetInnerHTML={{ __html: renderState.html }}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[#dbe4f5]">{renderState.text}</pre>
                )}
              </div>
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-white/[0.08] bg-[#0f1724] px-4 py-3">
          <button
            type="button"
            onClick={onReset}
            disabled={busy}
            className={[
              "inline-flex h-8 items-center rounded-[9px] border px-3 text-[12px] font-medium transition-colors",
              busy
                ? "cursor-not-allowed border-white/[0.08] bg-[#101722] text-[#7f8aa0] opacity-70"
                : "border-white/[0.1] bg-[#121b29] text-[#cad5e8] hover:bg-[#182436] hover:text-white"
            ].join(" ")}>
            Reset
          </button>
          <div className="inline-flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className={[
                "inline-flex h-8 items-center rounded-[9px] border px-3 text-[12px] font-medium transition-colors",
                busy
                  ? "cursor-not-allowed border-white/[0.08] bg-[#101722] text-[#7f8aa0] opacity-70"
                  : "border-white/[0.1] bg-[#121b29] text-[#cad5e8] hover:bg-[#182436] hover:text-white"
              ].join(" ")}>
              Close
            </button>
            <button
              type="button"
              onClick={onExport}
              disabled={busy}
              className={[
                "inline-flex h-8 min-w-[118px] items-center justify-center gap-2 rounded-[9px] border px-3 text-[12px] font-semibold transition-colors",
                busy
                  ? "cursor-not-allowed border-[#8ab4f8]/35 bg-[#18335c] text-[#d4e3fd] opacity-75"
                  : "border-[#8ab4f8]/45 bg-[#1d3d69] text-[#e6f0ff] hover:bg-[#274b7d]"
              ].join(" ")}>
              {busy ? <Loader2 size={13} strokeWidth={2} className="animate-spin" /> : <Download size={13} strokeWidth={2} />}
              <span>Export</span>
            </button>
          </div>
        </footer>
      </section>
    </div>
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

function stopEventPropagation(event: {
  stopPropagation: () => void
  nativeEvent?: Event
}): void {
  event.stopPropagation()
  const native = event.nativeEvent as Event & { stopImmediatePropagation?: () => void }
  native?.stopImmediatePropagation?.()
}

function buildModalPreviewRenderState(rawValue: string, format: ExportFormat): ModalPreviewRenderState {
  const normalized = String(rawValue ?? "").replace(/\r\n?/g, "\n")
  if (!normalized.trim()) {
    return {
      mode: "text",
      html: "",
      text: "No content available for preview."
    }
  }

  if (format === "json") {
    try {
      const parsed = JSON.parse(normalized)
      return {
        mode: "text",
        html: "",
        text: JSON.stringify(parsed, null, 2)
      }
    } catch (error) {
      return {
        mode: "text",
        html: "",
        text: normalized,
        error: error instanceof Error ? error.message : "JSON invalido."
      }
    }
  }

  if (format === "html") {
    return {
      mode: "html",
      html: buildPreviewHtmlFragment(normalized),
      text: ""
    }
  }

  if (format === "text" || format === "word" || format === "pdf") {
    return {
      mode: "text",
      html: "",
      text: toPlainTextFromEditableContent(normalized)
    }
  }

  return {
    mode: "html",
    html: renderMarkdownToPreviewHtml(normalized),
    text: ""
  }
}

function buildPreviewHtmlFragment(content: string): string {
  const sanitized = sanitizeHtmlForPreview(content)
  if (looksLikeHtml(content)) {
    const bodyMatch = sanitized.match(/<body[^>]*>([\s\S]*)<\/body>/i)
    if (bodyMatch?.[1]) {
      return bodyMatch[1]
    }
    return sanitized
  }
  return renderMarkdownToPreviewHtml(content)
}

function renderMarkdownToPreviewHtml(rawMarkdown: string): string {
  const lines = String(rawMarkdown ?? "").replace(/\r\n?/g, "\n").split("\n")
  const out: string[] = []
  let inList = false
  let inCode = false
  const codeBuffer: string[] = []

  const flushList = () => {
    if (!inList) {
      return
    }
    out.push("</ul>")
    inList = false
  }

  const flushCode = () => {
    if (!inCode) {
      return
    }
    out.push(`<pre><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`)
    codeBuffer.length = 0
    inCode = false
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith("```")) {
      if (inCode) {
        flushCode()
      } else {
        flushList()
        inCode = true
      }
      continue
    }

    if (inCode) {
      codeBuffer.push(line)
      continue
    }

    if (!trimmed) {
      flushList()
      continue
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed)
    if (headingMatch) {
      flushList()
      const depth = Math.min(6, headingMatch[1].length)
      out.push(`<h${depth}>${renderMarkdownInline(headingMatch[2])}</h${depth}>`)
      continue
    }

    const bulletMatch = /^[-*]\s+(.+)$/.exec(trimmed)
    if (bulletMatch) {
      if (!inList) {
        out.push("<ul>")
        inList = true
      }
      out.push(`<li>${renderMarkdownInline(bulletMatch[1])}</li>`)
      continue
    }

    flushList()
    out.push(`<p>${renderMarkdownInline(trimmed)}</p>`)
  }

  flushList()
  flushCode()

  return out.join("\n").trim() || "<p>No content.</p>"
}

function renderMarkdownInline(rawLine: string): string {
  return escapeHtml(rawLine)
    .replace(/\[(\d+):\s*([^\]]+)\]/g, `<span class="md-citation">[$1: $2]</span>`)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
}

function looksLikeHtml(rawValue: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(String(rawValue ?? ""))
}

function sanitizeHtmlForPreview(rawValue: string): string {
  return String(rawValue ?? "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/\s+href\s*=\s*(['"])javascript:[\s\S]*?\1/gi, "")
}

function toPlainTextFromEditableContent(rawValue: string): string {
  return String(rawValue ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/```([\s\S]*?)```/g, (_match, code) => String(code ?? "").trim())
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*]\s+/gm, "- ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function buildEditedHtmlDocument(title: string, generatedAtIso: string, content: string, sourceFormat: ExportFormat): string {
  const preparedHtml = sourceFormat === "html" && looksLikeHtml(content)
    ? buildPreviewHtmlFragment(content)
    : renderMarkdownToPreviewHtml(content)

  return [
    "<!doctype html>",
    "<html lang=\"pt-BR\">",
    "<head>",
    "  <meta charset=\"utf-8\"/>",
    "  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/>",
    `  <title>${escapeHtml(title)}</title>`,
    "  <style>",
    "    :root{--bg:#0b1220;--card:#111a2b;--line:#263247;--text:#e5e7eb;--muted:#9ca3af;--accent:#8ab4f8;}",
    "    *{box-sizing:border-box;}",
    "    body{margin:0;padding:28px;background:var(--bg);color:var(--text);font:15px/1.68 'Segoe UI',Arial,sans-serif;}",
    "    .wrap{max-width:980px;margin:0 auto;}",
    "    h1{margin:0;font-size:30px;}",
    "    .meta{margin:6px 0 18px;color:var(--muted);font-size:12px;}",
    "    .paper{border:1px solid var(--line);border-radius:14px;background:var(--card);padding:16px 18px;}",
    "    p{margin:0 0 10px;white-space:pre-wrap;}",
    "    h2,h3,h4,h5,h6{margin:14px 0 8px;}",
    "    ul{margin:0 0 10px;padding-left:20px;}",
    "    code{background:#0f172a;border-radius:5px;padding:1px 5px;}",
    "    pre{margin:0 0 12px;white-space:pre-wrap;background:#0f172a;border:1px solid #20304a;border-radius:10px;padding:10px;}",
    "    .md-citation{color:var(--accent);font-weight:600;}",
    "  </style>",
    "</head>",
    "<body>",
    "  <main class=\"wrap\">",
    `    <h1>${escapeHtml(title)}</h1>`,
    `    <p class="meta">Exported at: ${escapeHtml(formatExportTimestamp(generatedAtIso))}</p>`,
    `    <section class="paper">${preparedHtml}</section>`,
    "  </main>",
    "</body>",
    "</html>"
  ].join("\n")
}

function buildEditedJsonContent(title: string, generatedAtIso: string, content: string): string {
  const normalized = normalizeForExportDisplay(content)
  try {
    const parsed = JSON.parse(normalized)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return JSON.stringify(
      {
        version: "1.0",
        title,
        exportedAt: generatedAtIso,
        messages: [
          {
            id: "m1",
            role: "assistant",
            label: "NotebookLM",
            text: toPlainTextFromEditableContent(normalized),
            citations: extractCitations(normalized)
          }
        ]
      },
      null,
      2
    )
  }
}

function buildEpubBytes(options: EpubBuildOptions): Uint8Array {
  const title = String(options.title ?? "").trim() || "NotebookLM"
  const generatedAtIso = resolveUtcIsoTimestamp(options.generatedAtIso)
  const language = String(options.language ?? EPUB_DEFAULT_LANGUAGE).trim() || EPUB_DEFAULT_LANGUAGE
  const author = String(options.author ?? EPUB_DEFAULT_AUTHOR).trim() || EPUB_DEFAULT_AUTHOR
  const identifier =
    String(options.identifier ?? "").trim() ||
    `urn:minddock:chat:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const chapters = options.chapters.length > 0
    ? options.chapters
    : [
        {
          id: "chapter-1",
          filename: "chapter-1.xhtml",
          title,
          htmlFragment: "<p>No content.</p>"
        }
      ]

  const chapterDocs = chapters.map((chapter, index) => ({
    ...chapter,
    id: chapter.id || `chapter-${index + 1}`,
    filename: chapter.filename || `chapter-${index + 1}.xhtml`,
    title: chapter.title || `Capitulo ${index + 1}`,
    htmlFragment: normalizeHtmlFragmentForEpub(chapter.htmlFragment)
  }))

  const manifestChapterEntries = chapterDocs
    .map((chapter) => `    <item id="${escapeXml(chapter.id)}" href="${escapeXml(chapter.filename)}" media-type="application/xhtml+xml"/>`)
    .join("\n")
  const spineEntries = chapterDocs.map((chapter) => `    <itemref idref="${escapeXml(chapter.id)}"/>`).join("\n")
  const navEntries = chapterDocs
    .map((chapter) => `        <li><a href="${escapeXml(chapter.filename)}">${escapeXml(chapter.title)}</a></li>`)
    .join("\n")

  const navXhtml = [
    "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
    "<!DOCTYPE html>",
    `<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(language)}" lang="${escapeXml(language)}">`,
    "<head>",
    "  <meta charset=\"utf-8\"/>",
    `  <title>${escapeXml(title)} - Navegacao</title>`,
    "  <link rel=\"stylesheet\" type=\"text/css\" href=\"styles.css\"/>",
    "</head>",
    "<body>",
    "  <nav epub:type=\"toc\" id=\"toc\">",
    `    <h1>${escapeXml(title)}</h1>`,
    "    <ol>",
    navEntries,
    "    </ol>",
    "  </nav>",
    "</body>",
    "</html>"
  ].join("\n")

  const packageOpf = [
    "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
    `<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0" xml:lang="${escapeXml(language)}">`,
    "  <metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">",
    `    <dc:identifier id="bookid">${escapeXml(identifier)}</dc:identifier>`,
    `    <dc:title>${escapeXml(title)}</dc:title>`,
    `    <dc:language>${escapeXml(language)}</dc:language>`,
    `    <dc:creator>${escapeXml(author)}</dc:creator>`,
    `    <meta property="dcterms:modified">${escapeXml(generatedAtIso)}</meta>`,
    "  </metadata>",
    "  <manifest>",
    "    <item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>",
    "    <item id=\"styles\" href=\"styles.css\" media-type=\"text/css\"/>",
    manifestChapterEntries,
    "  </manifest>",
    "  <spine>",
    spineEntries,
    "  </spine>",
    "</package>"
  ].join("\n")

  const css = [
    "body{font-family:'Segoe UI',Arial,sans-serif;color:#111827;line-height:1.65;margin:0;padding:1.2rem;}",
    "h1,h2,h3{line-height:1.3;margin:1rem 0 .6rem;}",
    "p{margin:.55rem 0;}",
    "ul,ol{margin:.4rem 0 .7rem 1.2rem;}",
    "pre{background:#f3f4f6;border:1px solid #e5e7eb;border-radius:.45rem;padding:.75rem;overflow:auto;white-space:pre-wrap;}",
    "code{background:#f3f4f6;border-radius:.3rem;padding:.08rem .3rem;}",
    ".md-citation{color:#1d4ed8;font-weight:600;}"
  ].join("")

  const encoder = new TextEncoder()
  const zipEntries: Record<string, Uint8Array> = {}
  zipEntries["mimetype"] = encoder.encode(EPUB_MIME_TYPE)
  zipEntries["META-INF/container.xml"] = encoder.encode(
    [
      "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
      "<container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">",
      "  <rootfiles>",
      "    <rootfile full-path=\"OEBPS/package.opf\" media-type=\"application/oebps-package+xml\"/>",
      "  </rootfiles>",
      "</container>"
    ].join("\n")
  )
  zipEntries["OEBPS/package.opf"] = encoder.encode(packageOpf)
  zipEntries["OEBPS/nav.xhtml"] = encoder.encode(navXhtml)
  zipEntries["OEBPS/styles.css"] = encoder.encode(css)

  chapterDocs.forEach((chapter) => {
    zipEntries[`OEBPS/${chapter.filename}`] = encoder.encode(buildEpubChapterDocument(chapter, language))
  })

  return zipSync(zipEntries, { level: 0 })
}

function buildEpubChapterDocument(chapter: EpubChapter, language: string): string {
  const chapterBody = chapter.htmlFragment.trim() || "<p>No content.</p>"
  return [
    "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
    "<!DOCTYPE html>",
    `<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(language)}" lang="${escapeXml(language)}">`,
    "<head>",
    "  <meta charset=\"utf-8\"/>",
    `  <title>${escapeXml(chapter.title)}</title>`,
    "  <link rel=\"stylesheet\" type=\"text/css\" href=\"styles.css\"/>",
    "</head>",
    "<body>",
    `  <section id="${escapeXml(chapter.id)}">`,
    `    <h1>${escapeXml(chapter.title)}</h1>`,
    `    ${chapterBody}`,
    "  </section>",
    "</body>",
    "</html>"
  ].join("\n")
}

function resolveEpubHtmlFragment(content: string, sourceFormat: ExportFormat): string {
  const html =
    sourceFormat === "html" && looksLikeHtml(content)
      ? buildPreviewHtmlFragment(content)
      : renderMarkdownToPreviewHtml(content)
  return normalizeHtmlFragmentForEpub(html)
}

function normalizeHtmlFragmentForEpub(rawHtml: string): string {
  const parser = new DOMParser()
  const parsed = parser.parseFromString(`<main>${String(rawHtml ?? "")}</main>`, "text/html")
  const root = parsed.body.firstElementChild instanceof HTMLElement ? parsed.body.firstElementChild : parsed.body

  root.querySelectorAll("script,style,iframe,object,embed,form,input,textarea,select,button,link,meta").forEach((node) => {
    node.remove()
  })

  root.querySelectorAll("a[href]").forEach((anchor) => {
    const href = String(anchor.getAttribute("href") ?? "").trim()
    if (!href || href.toLowerCase().startsWith("javascript:")) {
      anchor.removeAttribute("href")
    }
  })

  let html = root.innerHTML.trim()
  if (!html) {
    html = "<p>No content.</p>"
  }

  html = closeXhtmlVoidTag(html, "br")
  html = closeXhtmlVoidTag(html, "hr")
  html = closeXhtmlVoidTag(html, "img")
  html = closeXhtmlVoidTag(html, "source")
  html = closeXhtmlVoidTag(html, "track")
  html = closeXhtmlVoidTag(html, "wbr")

  return html
}

function closeXhtmlVoidTag(html: string, tagName: string): string {
  const pattern = new RegExp(`<${tagName}([^>]*)>`, "gi")
  return html.replace(pattern, (full, attrs: string) => {
    if (/\/\s*>$/.test(full)) {
      return full
    }
    return `<${tagName}${attrs} />`
  })
}

function resolveUtcIsoTimestamp(rawIso: string): string {
  const date = new Date(rawIso)
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
  }
  return date.toISOString().replace(/\.\d{3}Z$/, "Z")
}

async function downloadEditedContentByFormat(options: {
  title: string
  generatedAtIso: string
  filenameBase: string
  content: string
  format: ExportFormat
}): Promise<void> {
  const text = normalizeForExportDisplay(options.content)
  if (!text) {
    throw new Error("Empty content for export.")
  }

  if (options.format === "markdown") {
    triggerDownload(new Blob([text], { type: "text/markdown;charset=utf-8" }), `${options.filenameBase}${MARKDOWN_EXTENSION}`)
    return
  }

  if (options.format === "html") {
    const html = buildEditedHtmlDocument(options.title, options.generatedAtIso, text, options.format)
    triggerDownload(new Blob([html], { type: "text/html;charset=utf-8" }), `${options.filenameBase}${HTML_EXTENSION}`)
    return
  }

  if (options.format === "text") {
    const plain = toPlainTextFromEditableContent(text)
    triggerDownload(new Blob([plain], { type: "text/plain;charset=utf-8" }), `${options.filenameBase}${TEXT_EXTENSION}`)
    return
  }

  if (options.format === "word") {
    const plain = toPlainTextFromEditableContent(text)
    const docxBytes = await buildDocxBytesFromText(plain)
    triggerDownload(
      new Blob([toArrayBuffer(docxBytes)], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      }),
      `${options.filenameBase}${WORD_EXTENSION}`
    )
    return
  }

  if (options.format === "epub") {
    const chapter: EpubChapter = {
      id: "chapter-1",
      filename: "chapter-1.xhtml",
      title: options.title,
      htmlFragment: resolveEpubHtmlFragment(text, looksLikeHtml(text) ? "html" : "markdown")
    }
    const epubBytes = buildEpubBytes({
      title: options.title,
      generatedAtIso: options.generatedAtIso,
      chapters: [chapter]
    })
    triggerDownload(new Blob([toArrayBuffer(epubBytes)], { type: EPUB_MIME_TYPE }), `${options.filenameBase}${EPUB_EXTENSION}`)
    return
  }

  if (options.format === "json") {
    const json = buildEditedJsonContent(options.title, options.generatedAtIso, text)
    triggerDownload(new Blob([json], { type: "application/json;charset=utf-8" }), `${options.filenameBase}${JSON_EXTENSION}`)
    return
  }

  const pdfInputText = toPlainTextFromEditableContent(text)
  const pdfBytes = await buildPdfBytesViaBackground(pdfInputText)
  triggerDownload(
    new Blob([toArrayBuffer(pdfBytes)], { type: "application/pdf" }),
    `${options.filenameBase}${PDF_EXTENSION}`
  )
}

function buildExportBundle(options: {
  includeUserTurns: boolean
  includeSources: boolean
  selectedTurnIds: Set<string>
  selectedTurnCache: Map<string, CachedTurnRecord>
}): ExportBundle {
  const turnRecords = resolveConversationTurnRecords(options.includeSources)
  const scopedTurns = filterTurnsBySelection(turnRecords, options.selectedTurnIds, options.selectedTurnCache, options.includeSources)
  const turns = flattenTurnsForExport(scopedTurns, options.includeUserTurns)
  if (turns.length === 0) {
    throw new Error("No visible messages found for export.")
  }

  return {
    title: resolveNotebookTitle(),
    generatedAtIso: new Date().toISOString(),
    includeUserTurns: options.includeUserTurns,
    includeSources: options.includeSources,
    turns
  }
}

function buildCopyBundle(selectedTurnIds: Set<string>, selectedTurnCache: Map<string, CachedTurnRecord>): ExportBundle {
  const turnRecords = resolveConversationTurnRecords(true)
  const scopedTurns = filterTurnsBySelection(turnRecords, selectedTurnIds, selectedTurnCache, true)
  const turns = flattenTurnsForCopy(scopedTurns)
  if (turns.length === 0) {
    throw new Error("No visible messages found for copy.")
  }

  return {
    title: resolveNotebookTitle(),
    generatedAtIso: new Date().toISOString(),
    includeUserTurns: true,
    includeSources: true,
    turns
  }
}

function flattenTurnsForExport(turns: ConversationTurnRecord[], includeUserTurns: boolean): ExportTurn[] {
  const out: ExportTurn[] = []
  for (const turn of turns) {
    if (includeUserTurns && turn.userContent) {
      out.push({ role: "user", content: turn.userContent })
    }
    if (turn.assistantContent) {
      out.push({ role: "assistant", content: turn.assistantContent })
    }
  }
  return out
}

function flattenTurnsForCopy(turns: ConversationTurnRecord[]): ExportTurn[] {
  return flattenTurnsForExport(turns, true)
}

function filterTurnsBySelection(
  turns: ConversationTurnRecord[],
  selectedTurnIds: Set<string>,
  selectedTurnCache: Map<string, CachedTurnRecord>,
  includeSources: boolean
): ConversationTurnRecord[] {
  if (!(selectedTurnIds instanceof Set) || selectedTurnIds.size === 0) {
    return turns
  }

  const turnById = new Map<string, ConversationTurnRecord>()
  for (const turn of turns) {
    turnById.set(turn.id, turn)
  }

  const selected: ConversationTurnRecord[] = []
  for (const turnId of Array.from(selectedTurnIds)) {
    const liveTurn = turnById.get(turnId)
    if (liveTurn) {
      selected.push(liveTurn)
      continue
    }

    const cachedTurn = selectedTurnCache.get(turnId)
    if (!cachedTurn) {
      continue
    }

    selected.push(materializeTurnFromCache(cachedTurn, includeSources))
  }

  return selected
}

function materializeTurnFromCache(cacheItem: CachedTurnRecord, includeSources: boolean): ConversationTurnRecord {
  return {
    id: cacheItem.id,
    top: Number.MAX_SAFE_INTEGER,
    assistantContent: normalizeTurnContent(cacheItem.assistantContent, includeSources),
    userContent: cacheItem.userContent ? normalizeTurnContent(cacheItem.userContent, true) : undefined,
    assistantAnchor: document.body as HTMLElement,
    saveControl: null
  }
}

function resolveConversationTurnRecords(includeSources: boolean): ConversationTurnRecord[] {
  const pairTurns = collectTurnRecordsFromPairs(includeSources)
  if (pairTurns.length > 0) {
    return pairTurns
  }

  const blocks = collectMessageBlocks(includeSources)
  const orderedBlocks = blocks.sort((left, right) => {
    if (Math.abs(left.top - right.top) <= 6) {
      return left.left - right.left
    }
    return left.top - right.top
  })

  const turns: ConversationTurnRecord[] = []
  let pendingUser: ChatMessageBlock | null = null
  for (const block of orderedBlocks) {
    if (block.role === "user") {
      pendingUser = block
      continue
    }

    turns.push({
      id: resolveStableTurnKey(block.anchor, pendingUser?.content, block.content),
      top: block.top,
      assistantContent: block.content,
      userContent: pendingUser?.content,
      assistantAnchor: block.anchor,
      saveControl: resolveSaveToNotesControl(block.anchor)
    })
    pendingUser = null
  }

  if (turns.length > 0) {
    return turns
  }

  const fallbackMessages = captureVisibleMessages()
    .map((message) => ({
      ...message,
      content: normalizeTurnContent(message.content, includeSources)
    }))
    .filter((message) => message.content.length > 0)

  const fallbackTurns: ConversationTurnRecord[] = []
  let pendingFallbackUser: string | null = null
  let fallbackIndex = 0
  for (const message of fallbackMessages) {
    if (message.role === "user") {
      pendingFallbackUser = message.content
      continue
    }

    fallbackIndex += 1
    fallbackTurns.push({
      id: `minddock-fallback-turn-${fallbackIndex}`,
      top: fallbackIndex * 100,
      assistantContent: message.content,
      userContent: pendingFallbackUser ?? undefined,
      assistantAnchor: document.body as HTMLElement,
      saveControl: null
    })
    pendingFallbackUser = null
  }

  return fallbackTurns
}

function collectTurnRecordsFromPairs(includeSources: boolean): ConversationTurnRecord[] {
  const turns: ConversationTurnRecord[] = []

  for (const pair of queryDeepAll<HTMLElement>(TURN_PAIR_SELECTORS)) {
    if (!(pair instanceof HTMLElement) || !isVisible(pair)) {
      continue
    }
    if (pair.closest("#minddock-conversation-export-root")) {
      continue
    }

    const assistantNode = resolveFirstVisibleDescendant(pair, ASSISTANT_CONTENT_SELECTORS)
    if (!(assistantNode instanceof HTMLElement)) {
      continue
    }

    const assistantContent = normalizeTurnContent(resolveAssistantTextWithSourceTokens(assistantNode), includeSources)
    if (!assistantContent) {
      continue
    }

    const userNode = resolveFirstVisibleDescendant(pair, USER_CONTENT_SELECTORS)
    const userContent = userNode ? normalizeTurnContent(resolveElementReadableText(userNode), true) : ""
    const assistantAnchor = resolveRoleAnchorNode(assistantNode, "assistant")
    const rect = pair.getBoundingClientRect()

    turns.push({
      id: resolveStableTurnKey(pair, userContent || undefined, assistantContent),
      top: rect.top,
      assistantContent,
      userContent: userContent || undefined,
      assistantAnchor,
      saveControl: resolveSaveToNotesControl(pair) ?? resolveSaveToNotesControl(assistantAnchor)
    })
  }

  return turns.sort((left, right) => left.top - right.top)
}

function collectMessageBlocks(includeSources: boolean): ChatMessageBlock[] {
  const blocks: ChatMessageBlock[] = []
  const seenAnchors = new Set<HTMLElement>()

  const collectByRole = (selectors: readonly string[], role: "user" | "assistant"): void => {
    for (const node of queryDeepAll<HTMLElement>(selectors)) {
      if (!(node instanceof HTMLElement) || !isVisible(node)) {
        continue
      }
      if (node.closest("#minddock-conversation-export-root")) {
        continue
      }

      const anchor = resolveRoleAnchorNode(node, role)
      if (!isVisible(anchor) || seenAnchors.has(anchor)) {
        continue
      }

      const rawText =
        role === "assistant"
          ? resolveAssistantTextWithSourceTokens(node) || resolveAnchorRawText(anchor, role)
          : resolveAnchorRawText(anchor, role)
      const content = normalizeTurnContent(rawText, includeSources)
      if (!content) {
        continue
      }

      seenAnchors.add(anchor)
      const rect = anchor.getBoundingClientRect()
      blocks.push({
        role,
        content,
        top: rect.top,
        left: rect.left,
        anchor
      })
    }
  }

  collectByRole(USER_TURN_SELECTORS, "user")
  collectByRole(ASSISTANT_TURN_SELECTORS, "assistant")
  return blocks
}

function resolveFirstVisibleDescendant(root: HTMLElement, selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    if (root.matches(selector) && isVisible(root)) {
      return root
    }

    const candidate = root.querySelector<HTMLElement>(selector)
    if (candidate instanceof HTMLElement && isVisible(candidate)) {
      return candidate
    }
  }

  return null
}

function resolveRoleAnchorNode(node: HTMLElement, role: "user" | "assistant"): HTMLElement {
  const roleAnchorSelector =
    role === "assistant"
      ? "[data-testid='chat-message-assistant'], model-response, .response-container, [data-testid='response-text']"
      : "[data-testid='chat-message-user'], user-query, .query-container, [data-testid='user-query'], [data-testid='query-text']"

  const closestAnchor = node.closest(roleAnchorSelector)
  if (closestAnchor instanceof HTMLElement) {
    return closestAnchor
  }

  return node
}

function resolveAssistantTextWithSourceTokens(node: HTMLElement): string {
  const clone = node.cloneNode(true) as HTMLElement
  const selector = CITATION_MARKER_SELECTORS.join(", ")
  for (const marker of Array.from(clone.querySelectorAll<HTMLElement>(selector))) {
    const label = resolveCitationLabel(marker)
    if (!label) {
      marker.remove()
      continue
    }
    marker.replaceWith(document.createTextNode(` [Source: ${label}] `))
  }

  return resolveElementReadableText(clone)
}

function resolveCitationLabel(marker: HTMLElement): string {
  const candidates: string[] = []
  const pushCandidate = (value: unknown): void => {
    const cleaned = sanitizeCitationCandidate(value)
    if (cleaned) {
      candidates.push(cleaned)
    }
  }

  const descendants = Array.from(
    marker.querySelectorAll<HTMLElement>("[aria-label], [title], [data-source-title], [data-source-name], span, div, a")
  )
  for (const descendant of descendants) {
    pushCandidate(descendant.getAttribute("data-source-title"))
    pushCandidate(descendant.getAttribute("data-source-name"))
    pushCandidate(descendant.getAttribute("aria-label"))
    pushCandidate(descendant.getAttribute("title"))
    pushCandidate(descendant.textContent)
  }

  pushCandidate(marker.getAttribute("data-source-title"))
  pushCandidate(marker.getAttribute("data-source-name"))
  pushCandidate(marker.getAttribute("aria-label"))
  pushCandidate(marker.getAttribute("title"))
  pushCandidate(marker.textContent)

  for (const candidate of candidates) {
    if (!isLikelyGenericCitationLabel(candidate)) {
      return candidate
    }
  }

  return candidates[0] ?? ""
}

function sanitizeCitationCandidate(value: unknown): string {
  const cleaned = String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:;,.()[\]{}"'`]+|[\s:;,.()[\]{}"'`]+$/g, "")
    .trim()
  if (!cleaned || cleaned.length > 180) {
    return ""
  }
  return cleaned
}

function isLikelyGenericCitationLabel(value: string): boolean {
  const normalized = normalizeSourceLookupKey(value)
  if (!normalized) {
    return true
  }
  if (/^\d{1,4}$/.test(normalized)) {
    return false
  }
  if (GENERIC_CITATION_LABEL_REGEX.test(normalized)) {
    return true
  }
  if (/^(source|fonte)\s+\d{1,4}$/.test(normalized)) {
    return true
  }
  if (BAD_SOURCE_NAMES_REGEX.test(normalized)) {
    return true
  }
  return false
}

function resolveElementReadableText(node: HTMLElement): string {
  return String(node.innerText || node.textContent || "").trim()
}

function resolveAnchorRawText(anchor: HTMLElement, role: "user" | "assistant"): string {
  const selectors =
    role === "assistant"
      ? [
          "[data-testid='response-text']",
          ".model-response-text",
          ".response-container .message-content",
          ".response-content",
          "[class*='markdown']"
        ]
      : [
          "[data-testid='query-text']",
          "[data-testid='user-query']",
          ".query-container .query-text",
          ".user-query-text",
          "[class*='query-text']"
        ]

  for (const selector of selectors) {
    const candidate = anchor.querySelector<HTMLElement>(selector)
    if (!(candidate instanceof HTMLElement) || !isVisible(candidate)) {
      continue
    }
    const text =
      role === "assistant"
        ? resolveAssistantTextWithSourceTokens(candidate)
        : String(candidate.innerText || candidate.textContent || "").trim()
    if (text) {
      return text
    }
  }

  return role === "assistant" ? resolveAssistantTextWithSourceTokens(anchor) : String(anchor.innerText || anchor.textContent || "")
}

function normalizeTurnContent(rawValue: string, includeSources: boolean): string {
  let value = String(rawValue ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  if (!includeSources) {
    value = value
      .replace(/\[\d{1,3}\]/g, "")
      .replace(/\[source:[^\]]+\]/gi, "")
      .replace(/\[fonte:[^\]]+\]/gi, "")
      .replace(/(?:^|\n)\s*fonte(?:s)?\s*:\s*.+$/gim, "")
      .replace(/(?:^|\n)\s*\d+\s+fontes?\b.*$/gim, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  }

  return value
}

function resolveNotebookTitle(): string {
  const raw = String(document.title ?? "").trim()
  if (!raw) {
    return "NotebookLM"
  }

  return raw
    .replace(/\s*[-|]\s*NotebookLM.*$/i, "")
    .trim()
}

function resolveRoleLabel(role: "user" | "assistant"): string {
  return role === "user" ? "User" : "NotebookLM"
}

function prepareRenderedBundle(bundle: ExportBundle): RenderedExportBundle {
  const sourceMap = bundle.includeSources ? buildSidebarSourceMap() : {}

  const turns: RenderedTurnRecord[] = bundle.turns
    .map((turn) => {
      let content = normalizeForExportDisplay(turn.content)

      if (bundle.includeSources) {
        content = replaceSourcesInline(content, sourceMap)
      } else {
        content = removeSourceTokensFromText(content)
      }

      content = formatReadableMessage(content, turn.role)
      if (!content) {
        return null
      }

      return {
        role: turn.role,
        roleLabel: resolveRoleLabel(turn.role),
        content
      } satisfies RenderedTurnRecord
    })
    .filter((turn): turn is RenderedTurnRecord => turn !== null)

  return {
    title: bundle.title,
    generatedAtIso: bundle.generatedAtIso,
    turns
  }
}

function buildSidebarSourceMap(): Record<string, string> {
  const map: Record<string, string> = {}
  const rows = queryDeepAll<HTMLElement>(["div.single-source-container"])
    .filter((row) => row.isConnected && isVisible(row) && !row.closest("#minddock-conversation-export-root"))
    .sort((left, right) => {
      const leftRect = left.getBoundingClientRect()
      const rightRect = right.getBoundingClientRect()
      if (Math.abs(leftRect.top - rightRect.top) <= 4) {
        return leftRect.left - rightRect.left
      }
      return leftRect.top - rightRect.top
    })

  let idx = 1
  for (const row of rows) {
    const rawTitle = row.querySelector<HTMLElement>("div.source-title")?.textContent
    const title = sanitizeCitationCandidate(rawTitle)
    if (!title) {
      continue
    }
    map[String(idx)] = title
    idx += 1
  }

  return map
}

function normalizeSourceName(nameRaw: string, tokenRaw: string, sourceMap: Record<string, string>): string {
  const token = String(tokenRaw ?? "").trim()
  const fromMap = sanitizeCitationCandidate(stripLeadingSourceToken(sourceMap[token]))
  const candidate = sanitizeCitationCandidate(stripLeadingSourceToken(nameRaw))
  const tokenPrefixRegex = new RegExp(`^\\[?${escapeRegex(token)}\\]?\\s*[:.)-]?\\s*`, "i")
  const cleanedCandidate = sanitizeCitationCandidate(String(candidate ?? "").replace(tokenPrefixRegex, ""))
  const normalizedCandidate = normalizeSourceLookupKey(candidate)

  if (
    !cleanedCandidate ||
    /^\d{1,4}$/.test(normalizedCandidate) ||
    BAD_SOURCE_NAMES_REGEX.test(normalizedCandidate) ||
    GENERIC_SOURCE_TITLE_REGEX.test(normalizedCandidate) ||
    isLikelyGenericCitationLabel(candidate)
  ) {
    return fromMap || `Fonte ${token}`
  }

  return cleanedCandidate
}

function replaceSourcesInline(rawText: string, sourceMap: Record<string, string>): string {
  let fallbackTokenCursor = 1

  return String(rawText ?? "").replace(SOURCE_TOKEN_REGEX, (_match, rawToken: string) => {
    const tokenText = String(rawToken ?? "").trim()
    const numericToken = tokenText.match(SOURCE_NUMBER_REGEX)?.[0]
    const token = numericToken ? String(Number(numericToken)) : String(fallbackTokenCursor++)
    const explicitName = extractExplicitSourceNameFromToken(tokenText)
    const sourceName = normalizeSourceName(explicitName, token, sourceMap)
    return `[${token}: ${sourceName}]`
  })
}

function stripLeadingSourceToken(valueRaw: string): string {
  return String(valueRaw ?? "")
    .replace(/^\s*(?:source|fonte)\s*[:#-]?\s*/i, "")
    .replace(/^\s*\[?\d{1,4}\]?\s*[:.)-]\s*/, "")
    .replace(/^\s*\[?\d{1,4}\]?\s+/, "")
    .trim()
}

function extractExplicitSourceNameFromToken(tokenRaw: string): string {
  const tokenText = String(tokenRaw ?? "").trim()
  if (!tokenText) {
    return ""
  }

  const withoutPrefix = tokenText
    .replace(/^\s*(?:source|fonte)\s*[:#-]?\s*/i, "")
    .trim()

  return stripLeadingSourceToken(withoutPrefix)
}

function normalizeSourceLookupKey(valueRaw: string): string {
  return String(valueRaw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s[\](){}`"'“”‘’#]+|[\s[\](){}`"'“”‘’#]+$/g, "")
    .trim()
}

function normalizeForExportDisplay(rawValue: string): string {
  return String(rawValue ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function removeSourceTokensFromText(rawValue: string): string {
  return String(rawValue ?? "")
    .replace(SOURCE_TOKEN_REGEX, "")
    .replace(/\[(?:source|fonte)\s*:[^\]]+\]/gi, "")
    .replace(/\[\s*\d{1,4}\s*:[^\]]+\]/g, "")
    .replace(/\[\d{1,4}\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function cleanFlow(rawValue: string): string {
  return String(rawValue ?? "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([:;,.!?])(?=[A-Za-zÀ-ÿ])/g, "$1 ")
    .replace(/([(\[])\s+/g, "$1")
    .replace(/\s+([\])])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\[\s*(\d{1,4})\s*:\s*/g, "[$1: ")
    .trim()
}

function formatReadableMessage(textRaw: string, role: "user" | "assistant"): string {
  const cleaned = cleanFlow(textRaw)
  if (role === "user") {
    return cleaned
  }

  return splitLongParagraphs(cleaned)
}

function splitLongParagraphs(textRaw: string): string {
  const paragraphs = String(textRaw ?? "")
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean)

  const out: string[] = []
  for (const paragraph of paragraphs) {
    if (paragraph.length < 360) {
      out.push(paragraph)
      continue
    }

    const sentences = paragraph
      .split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý0-9])/g)
      .map((sentence) => sentence.trim())
      .filter(Boolean)

    if (sentences.length < 3) {
      out.push(paragraph)
      continue
    }

    let chunk = ""
    for (const sentence of sentences) {
      const candidate = chunk ? `${chunk} ${sentence}` : sentence
      if (candidate.length > 280 && chunk) {
        out.push(chunk)
        chunk = sentence
      } else {
        chunk = candidate
      }
    }
    if (chunk) {
      out.push(chunk)
    }
  }

  return out.join("\n\n").trim()
}

function buildMarkdown(bundle: ExportBundle): string {
  const rendered = prepareRenderedBundle(bundle)
  const lines: string[] = []
  lines.push(`# ${rendered.title}`)
  lines.push("")
  lines.push(`Exported at: ${formatExportTimestamp(rendered.generatedAtIso)}`)
  lines.push("")
  lines.push("---")
  lines.push("")

  rendered.turns.forEach((turn, index) => {
    if (index > 0) {
      lines.push("---")
      lines.push("")
    }
    lines.push(`## ${turn.roleLabel}`)
    lines.push("")
    lines.push(turn.content)
    lines.push("")
  })

  return lines.join("\n").trim()
}

function buildText(bundle: ExportBundle): string {
  const rendered = prepareRenderedBundle(bundle)
  const lines: string[] = []

  lines.push(rendered.title.toUpperCase())
  lines.push("=".repeat(Math.max(22, rendered.title.length)))
  lines.push(`Exported at: ${formatExportTimestamp(rendered.generatedAtIso)}`)
  lines.push(`Mensagens: ${rendered.turns.length}`)
  lines.push("")

  rendered.turns.forEach((turn, index) => {
    lines.push("-".repeat(64))
    lines.push(`${index + 1}. ${turn.roleLabel}`)
    lines.push("")
    lines.push(turn.content)
    lines.push("")
  })

  return lines.join("\n").trim()
}

function buildHtml(bundle: ExportBundle): string {
  const rendered = prepareRenderedBundle(bundle)
  const renderedTurns = rendered.turns
    .map((turn, index) => {
      return [
        `<article class="turn-card ${turn.role === "user" ? "turn-user" : "turn-model"}">`,
        `  <header class="turn-head">`,
        `    <span class="turn-index">#${index + 1}</span>`,
        `    <h2>${escapeHtml(turn.roleLabel)}</h2>`,
        "  </header>",
        `  <pre>${escapeHtml(turn.content)}</pre>`,
        "</article>"
      ].join("\n")
    })
    .join("\n")

  return [
    "<!doctype html>",
    "<html lang=\"pt-BR\">",
    "<head>",
    "  <meta charset=\"utf-8\"/>",
    `  <title>${escapeHtml(bundle.title)}</title>`,
    "  <style>",
    "    :root{--bg:#0b1018;--panel:#111827;--card:#162132;--line:rgba(148,163,184,.28);--text:#e5e7eb;--muted:#94a3b8;--user:#8ab4f8;--model:#34d399;}",
    "    *{box-sizing:border-box;}",
    "    body{margin:0;padding:32px;background:var(--bg);color:var(--text);font:16px/1.65 'Segoe UI',Roboto,Arial,sans-serif;}",
    "    .wrap{max-width:980px;margin:0 auto;}",
    "    h1{margin:0;font-size:30px;letter-spacing:.01em;}",
    "    .meta{margin:6px 0 20px;color:var(--muted);font-size:13px;}",
    "    .turn-card{border:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.02),rgba(255,255,255,.01));border-radius:14px;padding:14px 16px;margin:0 0 12px;}",
    "    .turn-user{box-shadow:inset 3px 0 0 0 var(--user);}",
    "    .turn-model{box-shadow:inset 3px 0 0 0 var(--model);}",
    "    .turn-head{display:flex;align-items:center;gap:8px;margin:0 0 10px;}",
    "    .turn-index{font-size:11px;color:var(--muted);padding:2px 6px;border:1px solid var(--line);border-radius:999px;}",
    "    .turn-head h2{margin:0;font-size:15px;}",
    "    pre{margin:0;white-space:pre-wrap;word-break:break-word;font:inherit;}",
    "    @media (max-width:720px){body{padding:16px}.turn-card{border-radius:12px;padding:12px;}}",
    "  </style>",
    "</head>",
    "<body>",
    "  <div class=\"wrap\">",
    `    <h1>${escapeHtml(rendered.title)}</h1>`,
    `    <p class="meta">Exported at: ${escapeHtml(formatExportTimestamp(rendered.generatedAtIso))}</p>`,
    `    ${renderedTurns}`,
    "  </div>",
    "</body>",
    "</html>"
  ].join("\n")
}

function buildJson(bundle: ExportBundle): string {
  const rendered = prepareRenderedBundle(bundle)
  return JSON.stringify(
    {
      version: "1.0",
      title: rendered.title,
      exportedAt: rendered.generatedAtIso,
      messages: rendered.turns.map((turn, index) => ({
        id: `m${index + 1}`,
        role: turn.role,
        label: turn.roleLabel,
        text: turn.content,
        citations: extractCitations(turn.content)
      }))
    },
    null,
    2
  )
}

function extractCitations(textRaw: string): Array<{ index: number; name: string }> {
  const text = String(textRaw ?? "")
  const regex = /\[(\d+):\s*([^\]]+)\]/g
  const citations: Array<{ index: number; name: string }> = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null = null

  while ((match = regex.exec(text)) !== null) {
    const index = Number(match[1])
    const name = String(match[2] ?? "").trim()
    if (!Number.isFinite(index) || index <= 0 || !name) {
      continue
    }
    const key = `${index}:${name.toLowerCase()}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    citations.push({ index, name })
  }

  return citations
}

function buildCopyText(bundle: ExportBundle): string {
  return buildText(bundle)
}

async function downloadBundleByFormat(bundle: ExportBundle, format: ExportFormat): Promise<void> {
  const filenameBase = buildFilenameBase(bundle.title)

  if (format === "markdown") {
    const content = buildMarkdown(bundle)
    triggerDownload(new Blob([content], { type: "text/markdown;charset=utf-8" }), `${filenameBase}${MARKDOWN_EXTENSION}`)
    return
  }

  if (format === "html") {
    const content = buildHtml(bundle)
    triggerDownload(new Blob([content], { type: "text/html;charset=utf-8" }), `${filenameBase}${HTML_EXTENSION}`)
    return
  }

  if (format === "text") {
    const content = buildText(bundle)
    triggerDownload(new Blob([content], { type: "text/plain;charset=utf-8" }), `${filenameBase}${TEXT_EXTENSION}`)
    return
  }

  if (format === "word") {
    const content = buildText(bundle)
    const docxBytes = await buildDocxBytesFromText(content)
    triggerDownload(
      new Blob([toArrayBuffer(docxBytes)], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      }),
      `${filenameBase}${WORD_EXTENSION}`
    )
    return
  }

  if (format === "epub") {
    const chapter: EpubChapter = {
      id: "chapter-1",
      filename: "chapter-1.xhtml",
      title: bundle.title,
      htmlFragment: resolveEpubHtmlFragment(buildMarkdown(bundle), "markdown")
    }
    const epubBytes = buildEpubBytes({
      title: bundle.title,
      generatedAtIso: bundle.generatedAtIso,
      chapters: [chapter]
    })
    triggerDownload(new Blob([toArrayBuffer(epubBytes)], { type: EPUB_MIME_TYPE }), `${filenameBase}${EPUB_EXTENSION}`)
    return
  }

  if (format === "json") {
    const content = buildJson(bundle)
    triggerDownload(new Blob([content], { type: "application/json;charset=utf-8" }), `${filenameBase}${JSON_EXTENSION}`)
    return
  }

  const pdfText = buildMarkdown(bundle)
  const pdfBytes = await buildPdfBytesViaBackground(pdfText)
  triggerDownload(
    new Blob([toArrayBuffer(pdfBytes)], { type: "application/pdf" }),
    `${filenameBase}${PDF_EXTENSION}`
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

async function buildPdfBytesViaBackground(text: string): Promise<Uint8Array> {
  const response = await sendBackgroundCommand<{ base64?: string }>(
    MESSAGE_ACTIONS.CMD_RENDER_PDF_OFFSCREEN,
    { text }
  )

  if (!response.success) {
    throw new Error(response.error ?? "Failed to generate PDF.")
  }

  const payload = response.payload ?? response.data
  const base64 = String(payload?.base64 ?? "").trim()
  if (!base64) {
    throw new Error("Resposta PDF vazia.")
  }

  return base64ToBytes(base64)
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function escapeXml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function escapeRegex(value: string): string {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function formatExportTimestamp(isoDate: string): string {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) {
    return isoDate
  }
  return date.toLocaleString("pt-BR")
}

function buildFilenameBase(title: string): string {
  const slug = String(title ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)

  return `minddock-chat-${slug || "notebooklm"}-${Date.now()}`
}

function resolveStableTurnKey(anchor: HTMLElement, userContent?: string, assistantContent?: string): string {
  const turnRoot =
    anchor.closest<HTMLElement>(".chat-message-pair, model-response, [data-testid='chat-message-assistant'], .response-container") ?? anchor

  const identityNodes = [turnRoot, anchor, anchor.parentElement, anchor.parentElement?.parentElement].filter(
    (value, index, array): value is HTMLElement => value instanceof HTMLElement && array.indexOf(value) === index
  )

  for (const node of identityNodes) {
    for (const attr of TURN_KEY_ATTRS) {
      const value = String(node.getAttribute(attr) ?? "").trim()
      if (value) {
        return `${attr}:${value}`
      }
    }
  }

  const userText = normalizeTurnFingerprintText(userContent)
  const modelText = normalizeTurnFingerprintText(assistantContent)
  const raw = `${userText.slice(0, 240)}||${modelText.slice(0, 480)}`
  const hash = hashFowlerNollVo(raw)
  return `fp:${hash}:${raw.length}`
}

function normalizeTurnFingerprintText(value: unknown): string {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function hashFowlerNollVo(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function resolveSaveToNotesControl(anchor: HTMLElement): HTMLElement | null {
  const turnPair = anchor.closest<HTMLElement>(".chat-message-pair")
  const turnRoot =
    turnPair ?? anchor.closest<HTMLElement>("model-response, [data-testid='chat-message-assistant'], .response-container") ?? anchor
  const roots = [turnRoot, anchor, anchor.parentElement].filter(
    (value, index, array): value is HTMLElement => value instanceof HTMLElement && array.indexOf(value) === index
  )

  const anchorRect = anchor.getBoundingClientRect()
  const seen = new Set<HTMLElement>()
  const rankedControls: Array<{
    control: HTMLElement
    host: HTMLElement
    score: number
    isBad: boolean
    isSave: boolean
  }> = []

  for (const root of roots) {
    const controls = Array.from(root.querySelectorAll<HTMLElement>("button, [role='button']"))
    for (const control of controls) {
      if (!isVisible(control) || seen.has(control)) {
        continue
      }
      seen.add(control)

      if (control.closest("#minddock-conversation-export-root")) {
        continue
      }

      if (turnPair) {
        const controlPair = control.closest<HTMLElement>(".chat-message-pair")
        if (controlPair !== turnPair) {
          continue
        }
      }

      const token = normalizeActionToken(
        String(control.getAttribute("aria-label") ?? control.getAttribute("title") ?? control.innerText ?? control.textContent ?? "")
      )
      const isBad = isBadResponseActionToken(token)
      const isSave = isSaveToNotesActionToken(token)
      const rect = control.getBoundingClientRect()
      const host = resolveActionHostForSaveControl(control, anchor)
      if (turnPair) {
        const hostPair = host.closest<HTMLElement>(".chat-message-pair")
        if (hostPair !== turnPair) {
          continue
        }
      }

      const verticalPenalty = rect.top < anchorRect.top - 18 ? 1600 : 0
      const tooFarBelowPenalty = rect.top > anchorRect.bottom + 280 ? 420 : 0
      const topDistance = Math.abs(rect.top - anchorRect.bottom)
      const leftDistance = Math.abs(rect.left - anchorRect.left) * 0.14
      const score = verticalPenalty + tooFarBelowPenalty + topDistance + leftDistance

      rankedControls.push({ control, host, score, isBad, isSave })
    }
  }

  const bestBad = rankedControls.filter((entry) => entry.isBad).sort((a, b) => a.score - b.score)[0]
  if (bestBad) {
    return bestBad.control
  }

  const bestSave = rankedControls.filter((entry) => entry.isSave).sort((a, b) => a.score - b.score)[0]
  if (bestSave) {
    return bestSave.control
  }

  if (rankedControls.length === 0) {
    return null
  }

  const hostBuckets = new Map<HTMLElement, Array<typeof rankedControls[number]>>()
  for (const entry of rankedControls) {
    const bucket = hostBuckets.get(entry.host)
    if (bucket) {
      bucket.push(entry)
    } else {
      hostBuckets.set(entry.host, [entry])
    }
  }

  let bestHost: HTMLElement | null = null
  let bestHostScore = Number.POSITIVE_INFINITY
  for (const [host, entries] of hostBuckets) {
    const hostRect = host.getBoundingClientRect()
    const hostTopPenalty = hostRect.top < anchorRect.top - 22 ? 1000 : 0
    const hostDistance = Math.abs(hostRect.top - anchorRect.bottom)
    const densityPenalty = entries.length < 2 ? 280 : entries.length > 10 ? 180 : 0
    const score = hostTopPenalty + hostDistance + densityPenalty
    if (score < bestHostScore) {
      bestHostScore = score
      bestHost = host
    }
  }

  if (!bestHost) {
    return rankedControls.sort((a, b) => a.score - b.score)[0]?.control ?? null
  }

  const bestHostControls = rankedControls
    .filter((entry) => entry.host === bestHost)
    .sort((a, b) => b.control.getBoundingClientRect().right - a.control.getBoundingClientRect().right)

  return bestHostControls[0]?.control ?? null
}

function resolveActionHostForSaveControl(saveControl: HTMLElement, assistantAnchor: HTMLElement): HTMLElement {
  const defaultHost = saveControl.parentElement ?? saveControl
  const turnPair = assistantAnchor.closest<HTMLElement>(".chat-message-pair")
  const fallbackHost = turnPair && !turnPair.contains(defaultHost) ? turnPair : defaultHost
  const controlRect = saveControl.getBoundingClientRect()
  const anchorRect = assistantAnchor.getBoundingClientRect()
  let current: HTMLElement | null = saveControl.parentElement
  let depth = 0

  while (current && depth < 4) {
    if (turnPair && !turnPair.contains(current)) {
      break
    }

    if (current.closest("#minddock-conversation-export-root")) {
      current = current.parentElement
      depth += 1
      continue
    }

    const rect = current.getBoundingClientRect()
    const directCount = countVisibleDirectActionControls(current)
    const allCount = countVisibleActionControls(current)
    const closeToControl = Math.abs(rect.top - controlRect.top) <= 26 && Math.abs(rect.bottom - controlRect.bottom) <= 34
    const nearTurnBottom = rect.top >= anchorRect.top - 24 && rect.top <= anchorRect.bottom + 260
    const compact = rect.height >= 18 && rect.height <= 98

    if (compact && nearTurnBottom && closeToControl && (directCount >= 2 || allCount >= 2)) {
      return current
    }

    current = current.parentElement
    depth += 1
  }

  return fallbackHost
}

function hasExplicitUserTurnContainer(pair: HTMLElement): boolean {
  for (const selector of STRICT_USER_TURN_CONTAINER_SELECTORS) {
    const node = pair.querySelector<HTMLElement>(selector)
    if (node instanceof HTMLElement && isVisible(node)) {
      return true
    }
  }
  return false
}

function shouldRenderTurnSelection(turn: ConversationTurnRecord): boolean {
  if (!(turn.assistantAnchor instanceof HTMLElement) || !turn.assistantAnchor.isConnected || !isVisible(turn.assistantAnchor)) {
    return false
  }

  const pair = turn.assistantAnchor.closest(".chat-message-pair")
  if (!(pair instanceof HTMLElement)) {
    return false
  }

  // Exige container real de usuario para bloquear o resumo inicial.
  if (!hasExplicitUserTurnContainer(pair)) {
    return false
  }

  const userText = String(turn.userContent ?? "").replace(/\s+/g, " ").trim()
  if (!userText) {
    return false
  }

  return true
}

function countVisibleActionControls(root: HTMLElement): number {
  return Array.from(root.querySelectorAll<HTMLElement>("button, [role='button']")).filter((element) => isVisible(element)).length
}

function countVisibleDirectActionControls(root: HTMLElement): number {
  return Array.from(root.children).filter((child) => {
    if (!(child instanceof HTMLElement) || !isVisible(child)) {
      return false
    }
    if (child.matches("button, [role='button']")) {
      return true
    }
    const nestedControl = child.querySelector<HTMLElement>(":scope > button, :scope > [role='button']")
    return nestedControl instanceof HTMLElement && isVisible(nestedControl)
  }).length
}

function syncTurnSelectionControls(options: SelectionControlSyncOptions): void {
  const turns = collectTurnRecordsFromPairs(true).filter((turn) => shouldRenderTurnSelection(turn))
  if (turns.length === 0) {
    return
  }
  const now = Date.now()

  const validTurnIds = new Set(turns.map((turn) => turn.id))
  options.onPruneSelection(validTurnIds)

  const usedAnchorControls = new Set<HTMLElement>()
  const placementsByTurn = new Map<
    string,
    {
      turnId: string
      anchorControl: HTMLElement
      actionHost: HTMLElement
      insertMode: "before-anchor" | "append-end"
      distance: number
    }
  >()

  for (const turn of turns) {
    options.onObserveTurn(turn)

    if (!(turn.assistantAnchor instanceof HTMLElement) || !turn.assistantAnchor.isConnected) {
      continue
    }

    if (!(turn.saveControl instanceof HTMLElement) || !turn.saveControl.isConnected) {
      continue
    }

    const anchorControl = turn.saveControl
    const turnPair = turn.assistantAnchor.closest<HTMLElement>(".chat-message-pair")
    if (!(turnPair instanceof HTMLElement) || !hasExplicitUserTurnContainer(turnPair)) {
      continue
    }
    if (anchorControl.closest<HTMLElement>(".chat-message-pair") !== turnPair) {
      continue
    }
    if (usedAnchorControls.has(anchorControl)) {
      continue
    }

    const actionHost = resolveActionHostForSaveControl(anchorControl, turn.assistantAnchor)
    if (actionHost.closest<HTMLElement>(".chat-message-pair") !== turnPair) {
      continue
    }
    const hostRect = actionHost.getBoundingClientRect()
    const turnRect = turn.assistantAnchor.getBoundingClientRect()
    const distance = Math.abs(hostRect.top - turnRect.bottom) + Math.abs(hostRect.left - turnRect.left) * 0.12

    const existingPlacement = placementsByTurn.get(turn.id)
    if (!existingPlacement || distance < existingPlacement.distance) {
      placementsByTurn.set(turn.id, {
        turnId: turn.id,
        anchorControl,
        actionHost,
        insertMode: "before-anchor",
        distance
      })
    }

    usedAnchorControls.add(anchorControl)
  }

  const existingByTurn = new Map<string, HTMLButtonElement>()
  const plannedHostByTurn = new Map<string, HTMLElement>()
  const plannedHostPick = new Map<HTMLElement, { turnId: string; distance: number }>()
  for (const placement of placementsByTurn.values()) {
    plannedHostByTurn.set(placement.turnId, placement.actionHost)
    const currentPick = plannedHostPick.get(placement.actionHost)
    if (!currentPick || placement.distance < currentPick.distance) {
      plannedHostPick.set(placement.actionHost, { turnId: placement.turnId, distance: placement.distance })
    }
  }
  const desiredTurnIds = new Set(Array.from(placementsByTurn.keys()))

  for (const existing of Array.from(document.querySelectorAll<HTMLButtonElement>(TURN_SELECTION_BUTTON_SELECTOR))) {
    if (!existing.isConnected) {
      existing.remove()
      continue
    }

    const existingPair = existing.closest<HTMLElement>(".chat-message-pair")
    if (!(existingPair instanceof HTMLElement)) {
      existing.remove()
      continue
    }
    if (!hasExplicitUserTurnContainer(existingPair)) {
      existing.remove()
      continue
    }

    const turnId = String(existing.dataset.turnId ?? "").trim()
    if (!turnId) {
      existing.remove()
      continue
    }

    if (!desiredTurnIds.has(turnId)) {
      const lastSeenAt = Number(existing.dataset.lastSeenAt ?? "0")
      const isSelected = options.selectedTurnIds.has(turnId)
      if (!Number.isFinite(lastSeenAt) || lastSeenAt <= 0) {
        existing.dataset.lastSeenAt = String(now)
        continue
      }
      if (!isSelected && now - lastSeenAt > TURN_SELECTION_STALE_GRACE_MS) {
        existing.remove()
      }
      continue
    }
    existing.dataset.lastSeenAt = String(now)

    const existingHost = existing.parentElement instanceof HTMLElement ? existing.parentElement : null
    const expectedTurnOnHost = existingHost ? plannedHostPick.get(existingHost)?.turnId : null
    if (expectedTurnOnHost && expectedTurnOnHost !== turnId) {
      existing.remove()
      continue
    }

    if (existingByTurn.has(turnId)) {
      const current = existingByTurn.get(turnId)!
      const desiredHost = plannedHostByTurn.get(turnId) ?? null
      const currentOnDesiredHost = desiredHost ? current.parentElement === desiredHost : false
      const nextOnDesiredHost = desiredHost ? existing.parentElement === desiredHost : false

      if (!currentOnDesiredHost && nextOnDesiredHost) {
        current.remove()
        existingByTurn.set(turnId, existing)
      } else {
        existing.remove()
      }
      continue
    }

    existingByTurn.set(turnId, existing)
  }

  for (const placement of placementsByTurn.values()) {
    const existing = existingByTurn.get(placement.turnId)
    const button = existing ?? createTurnSelectionButton(placement.turnId, options.onToggleTurn)
    button.dataset.lastSeenAt = String(now)
    insertSelectionButtonNearAnchor(placement.actionHost, placement.anchorControl, button, placement.insertMode)
    setTurnSelectionButtonState(button, options.selectedTurnIds.has(placement.turnId))
  }
}

function insertSelectionButtonNearAnchor(
  actionHost: HTMLElement,
  anchorControl: HTMLElement,
  selectionButton: HTMLButtonElement,
  insertMode: "before-anchor" | "append-end"
): void {
  if (insertMode === "before-anchor" && anchorControl.parentElement === actionHost) {
    if (selectionButton.parentElement === actionHost && selectionButton.nextSibling === anchorControl) {
      return
    }
    actionHost.insertBefore(selectionButton, anchorControl)
    return
  }

  if (selectionButton.parentElement === actionHost && selectionButton === actionHost.lastElementChild) {
    return
  }
  actionHost.appendChild(selectionButton)
}

function createTurnSelectionButton(turnId: string, onToggleTurn: (turnId: string) => void): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.setAttribute("data-minddock-turn-select", "true")
  button.dataset.turnId = turnId
  button.className = "minddock-turn-select-btn"
  button.innerHTML = `<span class="minddock-turn-select-box"></span>`

  button.addEventListener("mousedown", (event) => {
    stopDomInteractionEvent(event)
  })
  button.addEventListener("click", (event) => {
    stopDomInteractionEvent(event)
    const currentlySelected = button.getAttribute("data-selected") === "true"
    setTurnSelectionButtonState(button, !currentlySelected)
    onToggleTurn(turnId)
  })
  return button
}

function setTurnSelectionButtonState(button: HTMLElement, isSelected: boolean): void {
  button.setAttribute("data-selected", isSelected ? "true" : "false")
  button.setAttribute("aria-pressed", isSelected ? "true" : "false")
  button.setAttribute("title", isSelected ? "Desmarcar turno" : "Selecionar turno")
}

function stopDomInteractionEvent(event: Event): void {
  event.preventDefault()
  event.stopPropagation()
  const native = event as Event & { stopImmediatePropagation?: () => void }
  native.stopImmediatePropagation?.()
}

function isTurnSelectionControlElement(node: Element): boolean {
  if (node.matches(TURN_SELECTION_BUTTON_SELECTOR)) {
    return true
  }
  if (node.id === TURN_SELECTION_STYLE_ID) {
    return true
  }
  if (node.closest(TURN_SELECTION_BUTTON_SELECTOR)) {
    return true
  }
  return false
}

function normalizeActionToken(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function isBadResponseActionToken(token: string): boolean {
  if (!token) {
    return false
  }

  return (
    token.includes("resposta ruim") ||
    token.includes("ruim resposta") ||
    token.includes("nao gostei") ||
    token.includes("dislike") ||
    token.includes("bad response") ||
    token.includes("thumb down") ||
    token.includes("thumbs down") ||
    token.includes("thumb_down")
  )
}

function isSaveToNotesActionToken(token: string): boolean {
  if (!token) {
    return false
  }

  return (
    token.includes("salvar em notas") ||
    token.includes("save to notes") ||
    token.includes("salvar notas") ||
    token.includes("save notes")
  )
}

function ensureTurnSelectionStyles(): void {
  if (document.getElementById(TURN_SELECTION_STYLE_ID)) {
    return
  }

  const style = document.createElement("style")
  style.id = TURN_SELECTION_STYLE_ID
  style.textContent = `
    .minddock-turn-select-btn {
      width: 28px;
      height: 28px;
      min-width: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-right: 6px;
      margin-left: 4px;
      vertical-align: middle;
      align-self: center;
      transform: translateY(0);
      border-radius: 8px;
      border: 1px solid transparent;
      background: transparent;
      cursor: pointer;
      transition: border-color .16s ease, background-color .16s ease, transform .12s ease;
    }
    .minddock-turn-select-btn:hover {
      border-color: rgba(255, 255, 255, 0.16);
      background: rgba(255, 255, 255, 0.03);
    }
    .minddock-turn-select-btn[data-selected='true'] {
      border-color: rgba(250, 204, 21, 0.62);
      background: rgba(250, 204, 21, 0.16);
    }
    .minddock-turn-select-btn:active {
      transform: scale(.96);
    }
    .minddock-turn-select-box {
      width: 14px;
      height: 14px;
      border-radius: 3.5px;
      border: 1.6px solid rgba(211, 218, 230, 0.78);
      background: transparent;
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .minddock-turn-select-btn:hover .minddock-turn-select-box {
      border-color: rgba(233, 237, 246, 0.9);
    }
    .minddock-turn-select-btn[data-selected='true'] .minddock-turn-select-box {
      border-color: #facc15;
      background: #facc15;
    }
    .minddock-turn-select-btn[data-selected='true'] .minddock-turn-select-box::after {
      content: "";
      width: 7px;
      height: 4px;
      border-left: 1.7px solid #0c1422;
      border-bottom: 1.7px solid #0c1422;
      transform: rotate(-45deg) translateY(-0.5px);
    }
  `
  document.head.appendChild(style)
}
