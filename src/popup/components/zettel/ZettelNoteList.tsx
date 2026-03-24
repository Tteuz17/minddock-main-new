import { useState } from "react"
import { motion } from "framer-motion"
import { Search, FileText, Link2, Plus } from "lucide-react"

import { useNotes } from "~/hooks/useNotes"
import { LoadingSpinner } from "~/components/LoadingSpinner"

interface ZettelNoteListProps {
  onSelectNote: (noteId: string) => void
}

export function ZettelNoteList({ onSelectNote }: ZettelNoteListProps) {
  const { notes, isLoading, error, createNote } = useNotes()
  const [query, setQuery] = useState("")

  const filtered = query.trim()
    ? notes.filter(
        (n) =>
          n.title.toLowerCase().includes(query.toLowerCase()) ||
          n.content.toLowerCase().includes(query.toLowerCase()) ||
          n.tags.some((t) => t.toLowerCase().includes(query.toLowerCase()))
      )
    : notes

  const handleCreateNote = async () => {
    const note = await createNote({
      title: "New note",
      content: "",
      tags: [],
      source: "manual" as const
    })
    if (note) onSelectNote(note.id)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Search + Create */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="liquid-glass-soft flex flex-1 items-center gap-2 rounded-xl px-2.5 py-1.5">
          <Search size={12} className="text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes..."
            className="flex-1 bg-transparent text-[11px] text-white placeholder:text-zinc-600 focus:outline-none"
          />
          {query && (
            <span className="text-[9px] text-zinc-600">
              {filtered.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleCreateNote}
          className="liquid-glass-soft flex h-7 w-7 items-center justify-center rounded-xl text-zinc-400 transition hover:text-action">
          <Plus size={14} strokeWidth={2} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/5">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner size={18} />
          </div>
        ) : error ? (
          <div className="py-8 text-center text-[11px] text-red-400">{error}</div>
        ) : filtered.length === 0 ? (
          <EmptyState hasQuery={!!query.trim()} onCreate={handleCreateNote} />
        ) : (
          <div className="flex flex-col gap-1.5">
            {filtered.map((note, index) => (
              <motion.button
                key={note.id}
                type="button"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.12, delay: index * 0.02 }}
                onClick={() => onSelectNote(note.id)}
                className="liquid-glass-panel group w-full rounded-[14px] p-2.5 text-left transition hover:border-white/[0.08]">
                <div className="liquid-glass-content">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-[11px] font-semibold leading-tight text-white group-hover:text-action">
                      {note.title || "Untitled"}
                    </h3>
                    {(note.linkedNoteIds.length > 0 || note.backlinks.length > 0) && (
                      <div className="flex items-center gap-0.5 text-zinc-600">
                        <Link2 size={10} />
                        <span className="text-[9px]">
                          {note.linkedNoteIds.length + note.backlinks.length}
                        </span>
                      </div>
                    )}
                  </div>

                  {note.content && (
                    <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-zinc-500">
                      {note.content.slice(0, 120)}
                    </p>
                  )}

                  {note.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {note.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[8px] text-zinc-500">
                          {tag}
                        </span>
                      ))}
                      {note.tags.length > 3 && (
                        <span className="text-[8px] text-zinc-600">
                          +{note.tags.length - 3}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[8px] text-zinc-600">
                      {formatRelativeTime(note.updatedAt)}
                    </span>
                    {note.source === "zettel_maker" && (
                      <span className="rounded bg-action/10 px-1 py-0.5 text-[7px] font-semibold text-action">
                        AI
                      </span>
                    )}
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({
  hasQuery,
  onCreate
}: {
  hasQuery: boolean
  onCreate: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10">
      <div className="liquid-glass-soft flex h-10 w-10 items-center justify-center rounded-2xl">
        <FileText size={16} className="text-zinc-500" />
      </div>
      <p className="text-[11px] font-medium text-zinc-400">
        {hasQuery ? "No notes found" : "No notes yet"}
      </p>
      {!hasQuery && (
        <button
          type="button"
          onClick={onCreate}
          className="mt-1 rounded-xl bg-action/90 px-3 py-1.5 text-[10px] font-semibold text-black transition hover:bg-action">
          Create first note
        </button>
      )}
    </div>
  )
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "now"
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

