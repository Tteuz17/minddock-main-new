import { useCallback, useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"
import { ArrowLeft, Trash2, Link2, Save } from "lucide-react"

import { useNotes } from "~/hooks/useNotes"
import { LoadingSpinner } from "~/components/LoadingSpinner"
import type { Note } from "~/lib/types"

interface ZettelNoteDetailProps {
  noteId: string
  onBack: () => void
}

export function ZettelNoteDetail({ noteId, onBack }: ZettelNoteDetailProps) {
  const { notes, updateNote, deleteNote } = useNotes()
  const note = notes.find((n) => n.id === noteId)

  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [tagInput, setTagInput] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (note) {
      setTitle(note.title)
      setContent(note.content)
      setTags(note.tags)
    }
  }, [note?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleAutoSave = useCallback(
    (updates: Partial<Pick<Note, "title" | "content" | "tags">>) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(async () => {
        setIsSaving(true)
        try {
          await updateNote(noteId, updates)
        } catch {
          // silently fail — user can retry
        } finally {
          setIsSaving(false)
        }
      }, 1500)
    },
    [noteId, updateNote]
  )

  const handleTitleChange = (val: string) => {
    setTitle(val)
    scheduleAutoSave({ title: val, content, tags })
  }

  const handleContentChange = (val: string) => {
    setContent(val)
    scheduleAutoSave({ title, content: val, tags })
  }

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
      e.preventDefault()
      const newTag = tagInput.trim().toLowerCase()
      if (!tags.includes(newTag)) {
        const newTags = [...tags, newTag]
        setTags(newTags)
        scheduleAutoSave({ title, content, tags: newTags })
      }
      setTagInput("")
    }
  }

  const handleRemoveTag = (tag: string) => {
    const newTags = tags.filter((t) => t !== tag)
    setTags(newTags)
    scheduleAutoSave({ title, content, tags: newTags })
  }

  const handleDelete = async () => {
    if (isDeleting) return
    setIsDeleting(true)
    try {
      await deleteNote(noteId)
      onBack()
    } catch {
      setIsDeleting(false)
    }
  }

  if (!note) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size={18} />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.04] px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-[10px] text-zinc-400 transition hover:text-white">
          <ArrowLeft size={13} />
          <span>Voltar</span>
        </button>
        <div className="flex items-center gap-2">
          {isSaving && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-1 text-[9px] text-zinc-500">
              <Save size={10} />
              <span>Salvando...</span>
            </motion.div>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="flex h-6 w-6 items-center justify-center rounded-lg text-zinc-600 transition hover:bg-red-500/10 hover:text-red-400">
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto px-3 py-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/5">
        {/* Source badge */}
        {note.source === "zettel_maker" && (
          <div className="mb-2 flex items-center gap-1.5">
            <span className="rounded-md bg-action/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-action">
              Gerada por IA
            </span>
          </div>
        )}

        {/* Title */}
        <input
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Titulo da nota..."
          className="w-full bg-transparent text-[14px] font-bold tracking-[-0.02em] text-white placeholder:text-zinc-600 focus:outline-none"
        />

        {/* Content */}
        <textarea
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          placeholder="Escreva sua nota em markdown..."
          className="mt-2 min-h-[160px] w-full resize-none bg-transparent text-[11px] leading-relaxed text-zinc-300 placeholder:text-zinc-700 focus:outline-none"
        />

        {/* Tags */}
        <div className="mt-3 border-t border-white/[0.04] pt-2">
          <p className="text-[9px] font-medium uppercase tracking-wider text-zinc-600">
            Tags
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => handleRemoveTag(tag)}
                className="group flex items-center gap-1 rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[9px] text-zinc-400 transition hover:bg-red-500/10 hover:text-red-400">
                {tag}
                <span className="text-[7px] opacity-0 transition group-hover:opacity-100">
                  ×
                </span>
              </button>
            ))}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleAddTag}
              placeholder="+ tag"
              className="w-16 bg-transparent text-[9px] text-zinc-400 placeholder:text-zinc-700 focus:outline-none"
            />
          </div>
        </div>

        {/* Backlinks */}
        {note.backlinks.length > 0 && (
          <div className="mt-3 border-t border-white/[0.04] pt-2">
            <p className="text-[9px] font-medium uppercase tracking-wider text-zinc-600">
              <Link2 size={9} className="mr-1 inline" />
              Backlinks ({note.backlinks.length})
            </p>
            <div className="mt-1 flex flex-col gap-1">
              {note.backlinks.map((bl) => (
                <span
                  key={bl.noteId}
                  className="text-[10px] text-zinc-500">
                  ← {bl.noteTitle}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
