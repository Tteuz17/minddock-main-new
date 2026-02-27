import { Plus, Search, StickyNote } from "lucide-react"
import { useState } from "react"
import { motion } from "framer-motion"
import { useNotes } from "~/hooks/useNotes"
import { LoadingSpinner } from "~/components/LoadingSpinner"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Badge } from "~/components/ui/badge"
import { formatRelativeTime, truncate } from "~/lib/utils"

interface NoteListProps {
  onSelectNote: (id: string) => void
  onCreateNote: () => void
}

export function NoteList({ onSelectNote, onCreateNote }: NoteListProps) {
  const { notes, isLoading } = useNotes()
  const [query, setQuery] = useState("")

  const filtered = query
    ? notes.filter(
        (n) =>
          n.title.toLowerCase().includes(query.toLowerCase()) ||
          n.content.toLowerCase().includes(query.toLowerCase())
      )
    : notes

  if (isLoading) {
    return <div className="py-12"><LoadingSpinner /></div>
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/8">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar notas..."
          leftIcon={<Search size={12} strokeWidth={1.5} />}
          className="flex-1 h-7 text-xs"
        />
        <Button variant="primary" size="icon" className="h-7 w-7" onClick={onCreateNote}>
          <Plus size={14} strokeWidth={1.5} />
        </Button>
      </div>

      {/* Count */}
      {filtered.length > 0 && (
        <div className="px-3 py-1.5">
          <span className="text-xs text-text-tertiary">
            {filtered.length} nota{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Empty */}
      {filtered.length === 0 && (
        <div className="empty-state flex-1">
          <StickyNote size={24} strokeWidth={1} className="text-text-tertiary" />
          <div>
            <p className="text-sm text-text-secondary font-medium">
              {query ? "Nenhuma nota encontrada" : "Nenhuma nota ainda"}
            </p>
            <p className="text-xs text-text-tertiary mt-1">
              {query
                ? `Sem notas com "${query}"`
                : "Crie sua primeira nota ou atomize uma resposta do NotebookLM."}
            </p>
          </div>
          {!query && (
            <Button variant="secondary" size="sm" onClick={onCreateNote}>
              <Plus size={13} strokeWidth={1.5} />
              Nova nota
            </Button>
          )}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {filtered.map((note, i) => (
          <motion.button
            key={note.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15, delay: i * 0.03 }}
            onClick={() => onSelectNote(note.id)}
            className="w-full flex flex-col gap-1 px-3 py-2.5 hover:bg-white/5 border-b border-white/5 text-left group transition-colors">
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium text-text-secondary group-hover:text-white transition-colors line-clamp-1 flex-1">
                {note.title}
              </span>
              <span className="text-[10px] text-text-tertiary flex-shrink-0 mt-0.5">
                {formatRelativeTime(note.updatedAt)}
              </span>
            </div>
            <p className="text-xs text-text-tertiary line-clamp-2">
              {truncate(note.content.replace(/[#*`]/g, ""), 100)}
            </p>
            {note.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {note.tags.slice(0, 3).map((tag) => (
                  <Badge key={tag} variant="default" className="text-[9px] px-1 py-0">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
            {note.backlinks.length > 0 && (
              <span className="text-[10px] text-text-tertiary">
                ← {note.backlinks.length} backlink{note.backlinks.length !== 1 ? "s" : ""}
              </span>
            )}
          </motion.button>
        ))}
      </div>
    </div>
  )
}
