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
  Loader2
} from "lucide-react"
import { base64ToBytes } from "~/lib/base64-bytes"
import { MESSAGE_ACTIONS, type StandardResponse } from "~/lib/contracts"
import { triggerDownload } from "~/lib/source-download"
import { captureVisibleMessages, isVisible, queryDeepAll } from "./sourceDom"

type ExportFormat = "markdown" | "html" | "text" | "pdf" | "json"

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

interface SelectionControlSyncOptions {
  selectedTurnIds: Set<string>
  onToggleTurn: (turnId: string) => void
  onPruneSelection: (validTurnIds: Set<string>) => void
}

const FORMAT_OPTIONS: readonly FormatOption[] = [
  { id: "markdown", label: "Markdown", icon: FileCode2 },
  { id: "html", label: "HTML", icon: Code2 },
  { id: "text", label: "Texto simples", icon: FileText },
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
const JSON_EXTENSION = ".json"
const STORAGE_KEY_INCLUDE_USER_TURNS = "minddock:chat-export:include-user-turns"
const STORAGE_KEY_INCLUDE_SOURCES = "minddock:chat-export:include-sources"
const TURN_ID_DATA_ATTRIBUTE = "minddockTurnId"
const TURN_SELECTION_BUTTON_SELECTOR = "button[data-minddock-turn-select='true']"
const TURN_SELECTION_STYLE_ID = "minddock-turn-selection-style"
let turnIdSequence = 0

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
    chrome.storage.local.get(
      [STORAGE_KEY_INCLUDE_USER_TURNS, STORAGE_KEY_INCLUDE_SOURCES],
      (snapshot) => {
        const storedIncludeUser = snapshot?.[STORAGE_KEY_INCLUDE_USER_TURNS]
        const storedIncludeSources = snapshot?.[STORAGE_KEY_INCLUDE_SOURCES]

        if (typeof storedIncludeUser === "boolean") {
          setIncludeUserTurns(storedIncludeUser)
        }
        if (typeof storedIncludeSources === "boolean") {
          setIncludeSources(storedIncludeSources)
        }
      }
    )
  }, [])

  useEffect(() => {
    chrome.storage.local.set({
      [STORAGE_KEY_INCLUDE_USER_TURNS]: includeUserTurns
    })
  }, [includeUserTurns])

  useEffect(() => {
    chrome.storage.local.set({
      [STORAGE_KEY_INCLUDE_SOURCES]: includeSources
    })
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
          onPruneSelection: (validTurnIds) => {
            setSelectedTurnIds((current) => {
              const next = new Set(Array.from(current).filter((turnId) => validTurnIds.has(turnId)))
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

    const timer = window.setInterval(scheduleSync, 1500)
    return () => {
      observer.disconnect()
      window.clearInterval(timer)
      if (frameHandle !== null) {
        window.cancelAnimationFrame(frameHandle)
      }
    }
  }, [toggleTurnSelection])

  const isBusy = busyFormat !== null || isCopying
  const selectedCount = selectedTurnIds.size
  const exportLabel = selectedCount > 0 ? `Exportar (${selectedCount})` : "Exportar"
  const copyLabel = selectedCount > 0 ? `Copia (${selectedCount})` : "Copia"

  const handleFormatExport = async (format: ExportFormat): Promise<void> => {
    if (isBusy) {
      return
    }

    setBusyFormat(format)
    try {
      const bundle = buildExportBundle({
        includeUserTurns,
        includeSources,
        selectedTurnIds
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
      const bundle = buildCopyBundle(selectedTurnIds)
      const textToCopy = buildCopyText(bundle)
      await navigator.clipboard.writeText(textToCopy)
      setCopyDone(true)
    } catch (error) {
      console.error("[MindDock] Copia do chat falhou", error)
      setCopyDone(false)
    } finally {
      setIsCopying(false)
    }
  }

  return (
    <div
      ref={containerRef}
      data-minddock-conversation-export="true"
      className="relative mr-1 inline-flex shrink-0 items-center">
      <div className="inline-flex shrink-0 items-center gap-1 rounded-[16px] border border-white/[0.08] bg-[#11161e] p-1">
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
            "inline-flex h-8 shrink-0 items-center gap-2 rounded-[11px] border px-3 text-[13px] font-medium transition-colors",
            isOpen
              ? "border-white/[0.2] bg-[#1a2230] text-white"
              : "border-white/[0.08] bg-[#131a24] text-[#d5dbe7] hover:bg-[#1a2230] hover:text-white",
            isBusy ? "cursor-not-allowed opacity-70" : "cursor-pointer"
          ].join(" ")}>
          {busyFormat ? <Loader2 size={14} strokeWidth={2} className="animate-spin" /> : <Download size={14} strokeWidth={1.9} />}
          <span className="whitespace-nowrap">{exportLabel}</span>
          <ChevronDown size={14} strokeWidth={1.9} className={["transition-transform", isOpen ? "rotate-180" : ""].join(" ")} />
        </button>

        <button
          type="button"
          title={copyDone ? "Copiado!" : copyLabel}
          aria-label={copyDone ? "Copiado!" : copyLabel}
          onMouseDown={swallowInteraction}
          onClick={(event) => {
            swallowInteraction(event)
            void handleCopyCurrent()
          }}
          disabled={isBusy}
          className={[
            "inline-flex h-8 shrink-0 items-center gap-2 rounded-[11px] border border-white/[0.08] bg-[#131a24] px-3 text-[13px] font-medium transition-colors",
            copyDone ? "text-[#8fd6ff]" : "text-[#d5dbe7] hover:bg-[#1a2230] hover:text-white",
            isBusy ? "cursor-not-allowed opacity-70" : "cursor-pointer"
          ].join(" ")}>
          {isCopying ? <Loader2 size={14} strokeWidth={2} className="animate-spin" /> : <Copy size={14} strokeWidth={1.9} />}
          <span className="whitespace-nowrap">{copyDone ? "Copiado!" : copyLabel}</span>
        </button>
      </div>

      {isOpen ? (
        <section
          role="menu"
          aria-label="Menu de exportacao"
          className="absolute right-0 top-[calc(100%+8px)] z-[2147483646] w-[296px] rounded-[16px] border border-white/[0.1] bg-[#11161e] p-2 shadow-[0_18px_40px_rgba(0,0,0,0.45)]">
          <div className="overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#0f141c]">
            <MenuToggleRow
              label="Incluir turnos do usuario"
              checked={includeUserTurns}
              onToggle={() => setIncludeUserTurns((previous) => !previous)}
            />
            <MenuToggleRow
              label="Incluir fontes"
              checked={includeSources}
              onToggle={() => setIncludeSources((previous) => !previous)}
            />
          </div>

          <button
            type="button"
            role="menuitem"
            onMouseDown={swallowInteraction}
            onClick={swallowInteraction}
            className="mt-2 flex w-full items-center justify-between rounded-[11px] border border-white/[0.08] bg-[#101722] px-3 py-2.5 text-left text-[13px] text-[#d6dce8] transition-colors hover:bg-[#151b24]">
            <span className="inline-flex items-center gap-2.5">
              <Eye size={15} strokeWidth={1.8} className="text-[#9aa5ba]" />
              <span>Pre-visualizar e editar</span>
            </span>
            <span className="rounded-full border border-[#facc15]/30 bg-[#2a2208] px-2 py-[1px] text-[10px] font-semibold tracking-[0.04em] text-[#f6d860]">
              PRO
            </span>
          </button>

          <div className="mt-2 overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#0f141c]">
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
                    "flex w-full items-center gap-3 border-t border-white/[0.06] px-3 py-2.5 text-left text-[13px] transition-colors first:border-t-0",
                    "text-[#d0d6e1]",
                    isBusy ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-[#151b24] hover:text-white"
                  ].join(" ")}>
                  <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-[6px] border border-white/[0.12] bg-[#0a0f16] text-[#a8b2c6]">
                    <Icon size={12} strokeWidth={2} />
                  </span>
                  <span className="flex-1">{option.label}</span>
                  {isRunning ? <Loader2 size={13} strokeWidth={2} className="animate-spin text-[#8fd6ff]" /> : null}
                </button>
              )
            })}
          </div>
        </section>
      ) : null}
    </div>
  )
}

interface MenuToggleRowProps {
  label: string
  checked: boolean
  onToggle: () => void
}

function MenuToggleRow(props: MenuToggleRowProps) {
  const { label, checked, onToggle } = props
  return (
    <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-2.5 first:border-t-0">
      <span className="text-[13px] font-medium text-[#d1d7e2]">{label}</span>
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
          "relative h-5 w-9 rounded-full border transition-colors",
          checked
            ? "border-[#60a5fa]/45 bg-[#1d2a3a]"
            : "border-white/[0.14] bg-[#161d28]"
        ].join(" ")}>
        <span
          className={[
            "absolute left-[1.5px] top-[1.5px] h-[14px] w-[14px] rounded-full bg-[#e4ebf8] shadow-[0_1px_2px_rgba(0,0,0,0.4)] transition-transform",
            checked ? "translate-x-[14px]" : ""
          ].join(" ")}
        />
      </button>
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

function buildExportBundle(options: {
  includeUserTurns: boolean
  includeSources: boolean
  selectedTurnIds: Set<string>
}): ExportBundle {
  const turnRecords = resolveConversationTurnRecords(options.includeSources)
  const scopedTurns = filterTurnsBySelection(turnRecords, options.selectedTurnIds)
  const turns = flattenTurnsForExport(scopedTurns, options.includeUserTurns)
  if (turns.length === 0) {
    throw new Error("Nenhuma mensagem visivel encontrada para exportacao.")
  }

  return {
    title: resolveNotebookTitle(),
    generatedAtIso: new Date().toISOString(),
    includeUserTurns: options.includeUserTurns,
    includeSources: options.includeSources,
    turns
  }
}

function buildCopyBundle(selectedTurnIds: Set<string>): ExportBundle {
  const turnRecords = resolveConversationTurnRecords(true)
  const scopedTurns = filterTurnsBySelection(turnRecords, selectedTurnIds)
  const turns = flattenTurnsForCopy(scopedTurns)
  if (turns.length === 0) {
    throw new Error("Nenhuma mensagem visivel encontrada para copia.")
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

function filterTurnsBySelection(turns: ConversationTurnRecord[], selectedTurnIds: Set<string>): ConversationTurnRecord[] {
  if (!(selectedTurnIds instanceof Set) || selectedTurnIds.size === 0) {
    return turns
  }

  return turns.filter((turn) => selectedTurnIds.has(turn.id))
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
      id: resolveOrCreateTurnId(block.anchor),
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
      id: resolveOrCreateTurnId(pair),
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
  const direct = [
    marker.getAttribute("aria-label"),
    marker.getAttribute("title"),
    marker.textContent
  ]
  for (const candidate of direct) {
    const text = String(candidate ?? "")
      .replace(/\s+/g, " ")
      .trim()
    if (text) {
      return text
    }
  }

  const descendants = Array.from(marker.querySelectorAll<HTMLElement>("[aria-label], [title], span, div"))
  for (const descendant of descendants) {
    const candidates = [
      descendant.getAttribute("aria-label"),
      descendant.getAttribute("title"),
      descendant.textContent
    ]
    for (const candidate of candidates) {
      const text = String(candidate ?? "")
        .replace(/\s+/g, " ")
        .trim()
      if (text) {
        return text
      }
    }
  }

  return ""
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

function buildMarkdown(bundle: ExportBundle): string {
  const lines: string[] = [
    `# ${bundle.title}`,
    "",
    `Exportado em: ${formatExportTimestamp(bundle.generatedAtIso)}`,
    ""
  ]

  for (const turn of bundle.turns) {
    lines.push(`## ${turn.role === "user" ? "Usuario" : "NotebookLM"}`)
    lines.push("")
    lines.push(turn.content)
    lines.push("")
  }

  return lines.join("\n").trim()
}

function buildText(bundle: ExportBundle): string {
  const lines: string[] = [
    bundle.title.toUpperCase(),
    "=".repeat(Math.max(18, bundle.title.length)),
    "",
    `Exportado em: ${formatExportTimestamp(bundle.generatedAtIso)}`,
    ""
  ]

  for (const turn of bundle.turns) {
    lines.push(`${turn.role === "user" ? "Usuario" : "NotebookLM"}:`)
    lines.push(turn.content)
    lines.push("")
  }

  return lines.join("\n").trim()
}

function buildHtml(bundle: ExportBundle): string {
  const renderedTurns = bundle.turns
    .map((turn) => {
      const role = turn.role === "user" ? "Usuario" : "NotebookLM"
      return `<article class="turn"><h2>${escapeHtml(role)}</h2><pre>${escapeHtml(turn.content)}</pre></article>`
    })
    .join("\n")

  return [
    "<!doctype html>",
    "<html lang=\"pt-BR\">",
    "<head>",
    "  <meta charset=\"utf-8\"/>",
    `  <title>${escapeHtml(bundle.title)}</title>`,
    "  <style>",
    "    body{font-family:'Plus Jakarta Sans',system-ui,sans-serif;background:#0b0f14;color:#e5e7eb;padding:28px;line-height:1.55;}",
    "    h1{margin:0 0 8px;font-size:26px;}",
    "    .meta{opacity:.75;font-size:13px;margin-bottom:22px;}",
    "    .turn{border:1px solid rgba(255,255,255,.12);background:#121821;border-radius:12px;padding:12px 14px;margin-bottom:10px;}",
    "    .turn h2{margin:0 0 8px;font-size:14px;color:#facc15;}",
    "    .turn pre{margin:0;white-space:pre-wrap;word-wrap:break-word;font:inherit;}",
    "  </style>",
    "</head>",
    "<body>",
    `  <h1>${escapeHtml(bundle.title)}</h1>`,
    `  <p class="meta">Exportado em: ${escapeHtml(formatExportTimestamp(bundle.generatedAtIso))}</p>`,
    `  ${renderedTurns}`,
    "</body>",
    "</html>"
  ].join("\n")
}

function buildJson(bundle: ExportBundle): string {
  return JSON.stringify(
    {
      title: bundle.title,
      exportedAt: bundle.generatedAtIso,
      options: {
        includeUserTurns: bundle.includeUserTurns,
        includeSources: bundle.includeSources
      },
      messages: bundle.turns
    },
    null,
    2
  )
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

  if (format === "json") {
    const content = buildJson(bundle)
    triggerDownload(new Blob([content], { type: "application/json;charset=utf-8" }), `${filenameBase}${JSON_EXTENSION}`)
    return
  }

  const pdfText = buildText(bundle)
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
    throw new Error(response.error ?? "Falha ao gerar PDF.")
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

function resolveOrCreateTurnId(anchor: HTMLElement): string {
  const existing = String(anchor.dataset[TURN_ID_DATA_ATTRIBUTE] ?? "").trim()
  if (existing) {
    return existing
  }

  turnIdSequence += 1
  const next = `minddock-turn-${turnIdSequence}`
  anchor.dataset[TURN_ID_DATA_ATTRIBUTE] = next
  return next
}

function resolveSaveToNotesControl(anchor: HTMLElement): HTMLElement | null {
  const roots = [anchor, anchor.parentElement, anchor.parentElement?.parentElement].filter(
    (value): value is HTMLElement => value instanceof HTMLElement
  )
  const seen = new Set<HTMLElement>()

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

      const token = normalizeActionToken(
        String(control.getAttribute("aria-label") ?? control.getAttribute("title") ?? control.innerText ?? control.textContent ?? "")
      )

      if (
        token.includes("salvar em notas") ||
        token.includes("save to notes") ||
        token.includes("salvar notas") ||
        token.includes("save notes")
      ) {
        return control
      }
    }
  }

  return null
}

function resolveActionHostForSaveControl(saveControl: HTMLElement): HTMLElement {
  let current: HTMLElement | null = saveControl.parentElement
  let depth = 0
  while (current && depth < 5) {
    if (countVisibleActionControls(current) >= 2) {
      return current
    }
    current = current.parentElement
    depth += 1
  }
  return saveControl.parentElement ?? saveControl
}

function countVisibleActionControls(root: HTMLElement): number {
  return Array.from(root.querySelectorAll<HTMLElement>("button, [role='button']")).filter((element) => isVisible(element)).length
}

function syncTurnSelectionControls(options: SelectionControlSyncOptions): void {
  const turns = resolveConversationTurnRecords(true)
  const validTurnIds = new Set(turns.map((turn) => turn.id))
  options.onPruneSelection(validTurnIds)

  for (const button of Array.from(document.querySelectorAll<HTMLElement>(TURN_SELECTION_BUTTON_SELECTOR))) {
    button.remove()
  }

  for (const turn of turns) {
    if (!(turn.saveControl instanceof HTMLElement) || !isVisible(turn.saveControl)) {
      continue
    }

    const actionHost = resolveActionHostForSaveControl(turn.saveControl)
    const button = createTurnSelectionButton(turn.id, options.onToggleTurn)
    actionHost.insertBefore(button, turn.saveControl)

    setTurnSelectionButtonState(button, options.selectedTurnIds.has(turn.id))
  }
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

function normalizeActionToken(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function ensureTurnSelectionStyles(): void {
  if (document.getElementById(TURN_SELECTION_STYLE_ID)) {
    return
  }

  const style = document.createElement("style")
  style.id = TURN_SELECTION_STYLE_ID
  style.textContent = `
    .minddock-turn-select-btn {
      width: 22px;
      height: 22px;
      min-width: 22px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-right: 4px;
      border-radius: 6px;
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
      border-color: rgba(138, 180, 248, 0.55);
      background: rgba(138, 180, 248, 0.12);
    }
    .minddock-turn-select-btn:active {
      transform: scale(.96);
    }
    .minddock-turn-select-box {
      width: 12px;
      height: 12px;
      border-radius: 3px;
      border: 1.5px solid rgba(211, 218, 230, 0.72);
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
      border-color: #8ab4f8;
      background: #8ab4f8;
    }
    .minddock-turn-select-btn[data-selected='true'] .minddock-turn-select-box::after {
      content: "";
      width: 6px;
      height: 3.5px;
      border-left: 1.7px solid #0c1422;
      border-bottom: 1.7px solid #0c1422;
      transform: rotate(-45deg) translateY(-0.5px);
    }
  `
  document.head.appendChild(style)
}


