import { ArrowLeft, Save, Trash2, Link2, Tag, Loader2 } from "lucide-react"
import { useState, useEffect, useRef } from "react"
import { motion } from "framer-motion"
import { useNotes } from "~/hooks/useNotes"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Badge } from "~/components/ui/badge"
import { extractWikilinks } from "~/lib/utils"
import type { Note } from "~/lib/types"

interface NoteEditorProps {
  noteId: string | null
  onBack: () => void
}

export function NoteEditor({ noteId, onBack }: NoteEditorProps) {
  const { notes, createNote, updateNote, deleteNote } = useNotes()
  const note = noteId ? notes.find((n) => n.id === noteId) : null

  const [title, setTitle] = useState(note?.title ?? "")
  const [content, setContent] = useState(note?.content ?? "")
  const [tagInput, setTagInput] = useState("")
  const [tags, setTags] = useState<string[]>(note?.tags ?? [])
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (note) {
      setTitle(note.title)
      setContent(note.content)
      setTags(note.tags)
    }
  }, [note?.id])

  // Auto-save com debounce
  useEffect(() => {
    if (!hasChanges) return
    if (saveTimeout.current) clearTimeout(saveTimeout.current)
    saveTimeout.current = setTimeout(() => handleSave(), 1500)
    return () => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current)
    }
  }, [title, content, tags, hasChanges])

  async function handleSave() {
    if (!title.trim()) return
    setIsSaving(true)
    try {
      if (noteId) {
        await updateNote(noteId, { title, content, tags })
      } else {
        await createNote({ title, content, tags, source: "manual" })
        onBack()
      }
      setHasChanges(false)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete() {
    if (!noteId) return
    await deleteNote(noteId)
    onBack()
  }

  function addTag() {
    const tag = tagInput.trim().toLowerCase()
    if (tag && !tags.includes(tag)) {
      const newTags = [...tags, tag]
      setTags(newTags)
      setTagInput("")
      setHasChanges(true)
    }
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag))
    setHasChanges(true)
  }

  const wikilinks = extractWikilinks(content)

  return (
    <motion.div
      className="flex flex-col h-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/8">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={1.5} />
        </Button>
        <span className="text-xs text-text-tertiary flex-1">
          {hasChanges ? "Alterações não salvas" : noteId ? "Salvo" : "Nova nota"}
        </span>
        {isSaving && <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-action" />}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSave}>
          <Save size={14} strokeWidth={1.5} />
        </Button>
        {noteId && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 hover:text-error"
            onClick={handleDelete}>
            <Trash2 size={14} strokeWidth={1.5} />
          </Button>
        )}
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3">
        {/* Title */}
        <input
          type="text"
          value={title}
          onChange={(e) => { setTitle(e.target.value); setHasChanges(true) }}
          placeholder="Título da nota..."
          className="w-full bg-transparent text-base font-semibold text-white placeholder:text-text-tertiary focus:outline-none"
        />

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5 items-center">
          {tags.map((tag) => (
            <Badge
              key={tag}
              variant="yellow"
              className="cursor-pointer"
              onClick={() => removeTag(tag)}>
              <Tag size={9} strokeWidth={1.5} />
              {tag} ×
            </Badge>
          ))}
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault()
                addTag()
              }
            }}
            placeholder="+ tag"
            className="text-xs bg-transparent text-text-secondary placeholder:text-text-tertiary focus:outline-none w-16"
          />
        </div>

        {/* Divider */}
        <div className="border-t border-white/8" />

        {/* Content */}
        <textarea
          value={content}
          onChange={(e) => { setContent(e.target.value); setHasChanges(true) }}
          placeholder={`Escreva sua nota em Markdown...\n\nUse [[Nome da nota]] para criar links bidirecionais.`}
          className="w-full min-h-[200px] bg-transparent text-sm text-text-secondary placeholder:text-text-tertiary focus:outline-none resize-none leading-relaxed font-mono"
        />

        {/* Wikilinks detectados */}
        {wikilinks.length > 0 && (
          <div className="flex flex-col gap-1.5 p-2.5 bg-info/5 border border-info/15 rounded-lg">
            <div className="flex items-center gap-1.5 text-xs text-info font-medium">
              <Link2 size={11} strokeWidth={1.5} />
              Links detectados
            </div>
            {wikilinks.map((link) => (
              <span key={link} className="text-xs text-text-secondary pl-4">
                [[{link}]]
              </span>
            ))}
          </div>
        )}

        {/* Backlinks */}
        {note && note.backlinks.length > 0 && (
          <div className="flex flex-col gap-1.5 p-2.5 bg-white/3 border border-white/8 rounded-lg">
            <span className="text-xs text-text-tertiary font-medium">
              ← Backlinks ({note.backlinks.length})
            </span>
            {note.backlinks.map((bl) => (
              <span key={bl.noteId} className="text-xs text-text-secondary hover:text-white cursor-pointer pl-4 transition-colors">
                {bl.noteTitle}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}
