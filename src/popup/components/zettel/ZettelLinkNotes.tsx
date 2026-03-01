import { useState, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  GitBranchPlus,
  Search,
  Loader2,
  Check,
  Sparkles,
  Link2,
  Unlink
} from "lucide-react"

import { useNotes } from "~/hooks/useNotes"
import { useAuth } from "~/hooks/useAuth"
import { zettelkastenService } from "~/services/zettelkasten"
import { LoadingSpinner } from "~/components/LoadingSpinner"
import type { Note } from "~/lib/types"

interface LinkSuggestion {
  noteId: string
  noteTitle: string
  relevance: number
}

export function ZettelLinkNotes() {
  const { user } = useAuth()
  const { notes, isLoading, refetch } = useNotes()
  const [noteA, setNoteA] = useState<Note | null>(null)
  const [noteB, setNoteB] = useState<Note | null>(null)
  const [searchA, setSearchA] = useState("")
  const [searchB, setSearchB] = useState("")
  const [focusedSelector, setFocusedSelector] = useState<"a" | "b" | null>(null)
  const [isLinking, setIsLinking] = useState(false)
  const [isUnlinking, setIsUnlinking] = useState(false)
  const [suggestions, setSuggestions] = useState<LinkSuggestion[]>([])
  const [isSuggesting, setIsSuggesting] = useState(false)
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null)

  const areLinked =
    noteA && noteB
      ? noteA.linkedNoteIds.includes(noteB.id) || noteB.linkedNoteIds.includes(noteA.id)
      : false

  const filteredA = searchA.trim()
    ? notes.filter(
        (n) =>
          n.id !== noteB?.id &&
          (n.title.toLowerCase().includes(searchA.toLowerCase()) ||
            n.tags.some((t) => t.toLowerCase().includes(searchA.toLowerCase())))
      )
    : notes.filter((n) => n.id !== noteB?.id)

  const filteredB = searchB.trim()
    ? notes.filter(
        (n) =>
          n.id !== noteA?.id &&
          (n.title.toLowerCase().includes(searchB.toLowerCase()) ||
            n.tags.some((t) => t.toLowerCase().includes(searchB.toLowerCase())))
      )
    : notes.filter((n) => n.id !== noteA?.id)

  const handleLink = useCallback(async () => {
    if (!noteA || !noteB || !user) return
    setIsLinking(true)
    setFeedback(null)
    try {
      await zettelkastenService.createLink(noteA.id, noteB.id, user.id)
      await refetch()
      setFeedback({ type: "success", msg: "Notas conectadas!" })
    } catch (err) {
      setFeedback({
        type: "error",
        msg: err instanceof Error ? err.message : "Erro ao conectar."
      })
    } finally {
      setIsLinking(false)
    }
  }, [noteA, noteB, user, refetch])

  const handleUnlink = useCallback(async () => {
    if (!noteA || !noteB) return
    setIsUnlinking(true)
    setFeedback(null)
    try {
      await zettelkastenService.deleteLink(noteA.id, noteB.id)
      await zettelkastenService.deleteLink(noteB.id, noteA.id)
      await refetch()
      setFeedback({ type: "success", msg: "Link removido." })
    } catch (err) {
      setFeedback({
        type: "error",
        msg: err instanceof Error ? err.message : "Erro ao desconectar."
      })
    } finally {
      setIsUnlinking(false)
    }
  }, [noteA, noteB, refetch])

  const handleSuggest = useCallback(async () => {
    if (!noteA) return
    setIsSuggesting(true)
    setSuggestions([])
    try {
      const response = await chrome.runtime.sendMessage({
        command: "MINDDOCK_IMPROVE_PROMPT",
        payload: { prompt: "__SUGGEST_LINKS__" }
      })
      // Use ai-service directly via background is complex,
      // so we call suggestLinks through the service import
      const { aiService } = await import("~/services/ai-service")
      const result = await aiService.suggestLinks(
        noteA.content,
        notes.filter((n) => n.id !== noteA.id).map((n) => ({
          id: n.id,
          title: n.title,
          content: n.content.slice(0, 200)
        }))
      )
      setSuggestions(result)
    } catch {
      setFeedback({ type: "error", msg: "Erro ao buscar sugestoes de IA." })
    } finally {
      setIsSuggesting(false)
    }
  }, [noteA, notes])

  const handleAcceptSuggestion = useCallback(
    async (suggestion: LinkSuggestion) => {
      if (!noteA || !user) return
      try {
        await zettelkastenService.createLink(noteA.id, suggestion.noteId, user.id)
        await refetch()
        setSuggestions((prev) => prev.filter((s) => s.noteId !== suggestion.noteId))
        setFeedback({ type: "success", msg: `Conectada a "${suggestion.noteTitle}"` })
      } catch {
        setFeedback({ type: "error", msg: "Erro ao conectar sugestao." })
      }
    },
    [noteA, user, refetch]
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size={18} />
      </div>
    )
  }

  if (notes.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10">
        <GitBranchPlus size={20} className="text-zinc-600" />
        <p className="text-[11px] text-zinc-400">
          Crie pelo menos 2 notas para conecta-las.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-3 py-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/5">
      <div className="mb-2 flex items-center gap-2">
        <GitBranchPlus size={12} className="text-green-400" />
        <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          Conectar Notas
        </p>
      </div>

      {/* Selector A */}
      <NoteSelector
        label="Nota A"
        selected={noteA}
        search={searchA}
        onSearchChange={setSearchA}
        filtered={filteredA}
        onSelect={(n) => {
          setNoteA(n)
          setSearchA("")
          setFocusedSelector(null)
          setSuggestions([])
        }}
        onFocus={() => setFocusedSelector("a")}
        isFocused={focusedSelector === "a"}
        onClear={() => {
          setNoteA(null)
          setSuggestions([])
        }}
      />

      {/* Connection indicator */}
      <div className="my-1.5 flex items-center justify-center">
        <div
          className={[
            "flex h-6 w-6 items-center justify-center rounded-full border transition",
            areLinked
              ? "border-green-500/30 bg-green-500/10 text-green-400"
              : "border-white/[0.06] text-zinc-600"
          ].join(" ")}>
          <Link2 size={10} />
        </div>
      </div>

      {/* Selector B */}
      <NoteSelector
        label="Nota B"
        selected={noteB}
        search={searchB}
        onSearchChange={setSearchB}
        filtered={filteredB}
        onSelect={(n) => {
          setNoteB(n)
          setSearchB("")
          setFocusedSelector(null)
        }}
        onFocus={() => setFocusedSelector("b")}
        isFocused={focusedSelector === "b"}
        onClear={() => setNoteB(null)}
      />

      {/* Action buttons */}
      {noteA && noteB && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 flex items-center gap-2">
          {areLinked ? (
            <button
              type="button"
              onClick={handleUnlink}
              disabled={isUnlinking}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/8 px-3 py-2 text-[11px] font-medium text-red-400 transition hover:bg-red-500/15">
              {isUnlinking ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Unlink size={12} />
              )}
              Desconectar
            </button>
          ) : (
            <button
              type="button"
              onClick={handleLink}
              disabled={isLinking}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-action/90 px-3 py-2 text-[11px] font-semibold text-black transition hover:bg-action">
              {isLinking ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <GitBranchPlus size={12} />
              )}
              Conectar
            </button>
          )}
        </motion.div>
      )}

      {/* AI suggestions */}
      {noteA && (
        <div className="mt-3 border-t border-white/[0.04] pt-2">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-medium uppercase tracking-wider text-zinc-600">
              Sugestoes de IA
            </p>
            <button
              type="button"
              onClick={handleSuggest}
              disabled={isSuggesting}
              className="flex items-center gap-1 text-[9px] text-action/80 transition hover:text-action">
              {isSuggesting ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Sparkles size={10} />
              )}
              {isSuggesting ? "Analisando..." : "Sugerir links"}
            </button>
          </div>

          <AnimatePresence>
            {suggestions.map((s) => (
              <motion.div
                key={s.noteId}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-1.5 flex items-center justify-between rounded-xl bg-white/[0.03] px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10px] font-medium text-zinc-300">
                    {s.noteTitle}
                  </p>
                  <p className="text-[8px] text-zinc-600">
                    Relevancia: {Math.round(s.relevance * 100)}%
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleAcceptSuggestion(s)}
                  className="ml-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-action/15 text-action transition hover:bg-action/25">
                  <Check size={11} />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Feedback */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={[
              "mt-2 rounded-xl px-3 py-2 text-[10px]",
              feedback.type === "success"
                ? "bg-green-500/8 text-green-400"
                : "bg-red-500/8 text-red-400"
            ].join(" ")}>
            {feedback.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function NoteSelector({
  label,
  selected,
  search,
  onSearchChange,
  filtered,
  onSelect,
  onFocus,
  isFocused,
  onClear
}: {
  label: string
  selected: Note | null
  search: string
  onSearchChange: (q: string) => void
  filtered: Note[]
  onSelect: (n: Note) => void
  onFocus: () => void
  isFocused: boolean
  onClear: () => void
}) {
  return (
    <div>
      <p className="mb-1 text-[9px] font-medium uppercase tracking-wider text-zinc-600">
        {label}
      </p>
      {selected ? (
        <div className="liquid-glass-panel flex items-center justify-between rounded-xl p-2">
          <div className="liquid-glass-content min-w-0 flex-1">
            <p className="truncate text-[11px] font-medium text-white">
              {selected.title}
            </p>
            <p className="text-[9px] text-zinc-500">
              {selected.tags.slice(0, 2).join(", ")}
              {selected.linkedNoteIds.length > 0 &&
                ` · ${selected.linkedNoteIds.length} links`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="ml-2 text-[9px] text-zinc-600 hover:text-zinc-300">
            trocar
          </button>
        </div>
      ) : (
        <div className="relative">
          <div className="liquid-glass-soft flex items-center gap-2 rounded-xl px-2.5 py-1.5">
            <Search size={11} className="text-zinc-600" />
            <input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              onFocus={onFocus}
              placeholder={`Buscar ${label.toLowerCase()}...`}
              className="flex-1 bg-transparent text-[10px] text-white placeholder:text-zinc-700 focus:outline-none"
            />
          </div>
          {isFocused && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-[120px] overflow-y-auto rounded-xl border border-white/[0.06] bg-[#0a0a0a] p-1 shadow-xl">
              {filtered.slice(0, 8).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onSelect(n)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/[0.04]">
                  <span className="truncate text-[10px] text-zinc-300">{n.title}</span>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-2 py-1.5 text-[10px] text-zinc-600">
                  Nenhuma nota encontrada
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
