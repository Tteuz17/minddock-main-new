import { ArrowLeft, Link2, Loader2, Save, Tag, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"

import { useNotes } from "~/hooks/useNotes"
import { Button } from "~/components/ui/button"
import { Badge } from "~/components/ui/badge"
import { extractWikilinks } from "~/lib/utils"

interface NoteEditorProps {
  noteId: string | null
  draftMode?: "blank" | "link"
  onBack: () => void
}

const DRAFT_SEEDS = {
  blank: {
    title: "",
    content: ""
  },
  link: {
    title: "Ponte entre ideias",
    content:
      "Ideia central:\n\nRelacao principal:\n- Conecta com [[Outra nota]]\n- Explica por que essa ponte importa\n"
  }
} as const

export function NoteEditor({
  noteId,
  draftMode = "blank",
  onBack
}: NoteEditorProps) {
  const { notes, createNote, updateNote, deleteNote } = useNotes()
  const note = noteId ? notes.find((entry) => entry.id === noteId) : null

  const [title, setTitle] = useState(note?.title ?? DRAFT_SEEDS[draftMode].title)
  const [content, setContent] = useState(note?.content ?? DRAFT_SEEDS[draftMode].content)
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
      setTagInput("")
      setHasChanges(false)
      return
    }

    if (!noteId) {
      setTitle(DRAFT_SEEDS[draftMode].title)
      setContent(DRAFT_SEEDS[draftMode].content)
      setTags([])
      setTagInput("")
      setHasChanges(false)
    }
  }, [note?.id, noteId, draftMode])

  useEffect(() => {
    if (!hasChanges) return
    if (saveTimeout.current) clearTimeout(saveTimeout.current)

    saveTimeout.current = setTimeout(() => {
      void handleSave()
    }, 1500)

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
    if (!tag || tags.includes(tag)) return

    setTags((current) => [...current, tag])
    setTagInput("")
    setHasChanges(true)
  }

  function removeTag(tag: string) {
    setTags((current) => current.filter((entry) => entry !== tag))
    setHasChanges(true)
  }

  const wikilinks = extractWikilinks(content)
  const isLinkDraft = !noteId && draftMode === "link"
  const toolbarLabel = hasChanges
    ? "Mudancas pendentes"
    : noteId
      ? "Salvo"
      : isLinkDraft
        ? "Nova ponte"
        : "Nova nota"
  const contentPlaceholder = isLinkDraft
    ? "Descreva a conexao e use [[Nome da nota]] para costurar ideias."
    : "Escreva sua nota em Markdown...\n\nUse [[Nome da nota]] para criar links bidirecionais."

  return (
    <motion.div
      className="flex h-full flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}>
      <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={1.5} />
        </Button>
        <span className="flex-1 text-xs text-text-tertiary">{toolbarLabel}</span>
        {isSaving && (
          <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-action" />
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void handleSave()}>
          <Save size={14} strokeWidth={1.5} />
        </Button>
        {noteId && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 hover:text-error"
            onClick={() => void handleDelete()}>
            <Trash2 size={14} strokeWidth={1.5} />
          </Button>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3 scrollbar-thin">
        <input
          type="text"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            setHasChanges(true)
          }}
          placeholder="Titulo da nota..."
          className="w-full bg-transparent text-base font-semibold text-white placeholder:text-text-tertiary focus:outline-none"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <Badge
              key={tag}
              variant="yellow"
              className="cursor-pointer"
              onClick={() => removeTag(tag)}>
              <Tag size={9} strokeWidth={1.5} />
              {tag} x
            </Badge>
          ))}
          <input
            type="text"
            value={tagInput}
            onChange={(event) => setTagInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault()
                addTag()
              }
            }}
            placeholder="+ tag"
            className="w-16 bg-transparent text-xs text-text-secondary placeholder:text-text-tertiary focus:outline-none"
          />
        </div>

        <div className="border-t border-white/8" />

        {isLinkDraft && (
          <div className="rounded-lg border border-info/15 bg-info/5 p-2.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-info">
              <Link2 size={11} strokeWidth={1.5} />
              Draft de conexao
            </div>
            <p className="mt-1 text-xs leading-5 text-text-secondary">
              Use esse rascunho para criar uma nota-ponte. Os links em [[ ]] vao virar
              relacoes no grafo.
            </p>
          </div>
        )}

        <textarea
          value={content}
          onChange={(event) => {
            setContent(event.target.value)
            setHasChanges(true)
          }}
          placeholder={contentPlaceholder}
          className="min-h-[200px] w-full resize-none bg-transparent font-mono text-sm leading-relaxed text-text-secondary placeholder:text-text-tertiary focus:outline-none"
        />

        {wikilinks.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-info/15 bg-info/5 p-2.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-info">
              <Link2 size={11} strokeWidth={1.5} />
              Links detectados
            </div>
            {wikilinks.map((link) => (
              <span key={link} className="pl-4 text-xs text-text-secondary">
                [[{link}]]
              </span>
            ))}
          </div>
        )}

        {note && note.backlinks.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-white/8 bg-white/3 p-2.5">
            <span className="text-xs font-medium text-text-tertiary">
              Backlinks ({note.backlinks.length})
            </span>
            {note.backlinks.map((backlink) => (
              <span
                key={backlink.noteId}
                className="cursor-pointer pl-4 text-xs text-text-secondary transition-colors hover:text-white">
                {backlink.noteTitle}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}
