import { useCallback, useEffect, useState } from "react"
import type { Note } from "~/lib/types"
import { useAuth } from "./useAuth"
import { zettelkastenService } from "~/services/zettelkasten"

export function useNotes() {
  const { user } = useAuth()
  const [notes, setNotes] = useState<Note[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchNotes = useCallback(async () => {
    if (!user) return
    setIsLoading(true)
    setError(null)
    try {
      const data = await zettelkastenService.getNotes(user.id)
      setNotes(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar notas")
    } finally {
      setIsLoading(false)
    }
  }, [user])

  useEffect(() => {
    fetchNotes()
  }, [fetchNotes])

  const createNote = useCallback(
    async (data: Pick<Note, "title" | "content" | "tags" | "source">) => {
      if (!user) return null
      const note = await zettelkastenService.createNote(user.id, { ...data, notebookId: undefined })
      setNotes((prev) => [note, ...prev])
      return note
    },
    [user]
  )

  const updateNote = useCallback(
    async (noteId: string, updates: Partial<Pick<Note, "title" | "content" | "tags">>) => {
      const note = await zettelkastenService.updateNote(noteId, updates)
      setNotes((prev) => prev.map((n) => (n.id === noteId ? note : n)))
      return note
    },
    []
  )

  const deleteNote = useCallback(async (noteId: string) => {
    await zettelkastenService.deleteNote(noteId)
    setNotes((prev) => prev.filter((n) => n.id !== noteId))
  }, [])

  return { notes, isLoading, error, refetch: fetchNotes, createNote, updateNote, deleteNote }
}
