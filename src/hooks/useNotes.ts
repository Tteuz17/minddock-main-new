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
      const msg = err instanceof Error ? err.message : ""
      // Erros de auth/RLS (ex: usuário dev sem sessão Supabase real) → lista vazia silenciosa
      const isAuthError =
        msg.toLowerCase().includes("jwt") ||
        msg.toLowerCase().includes("auth") ||
        msg.toLowerCase().includes("anon") ||
        msg.toLowerCase().includes("row-level") ||
        msg.toLowerCase().includes("permission") ||
        msg.toLowerCase().includes("not authenticated") ||
        msg.toLowerCase().includes("pgrst")
      if (isAuthError) {
        setNotes([])
      } else {
        setError(msg || "Erro ao carregar notas")
      }
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

  const atomizePreview = useCallback(
    async (content: string) => {
      const response = await chrome.runtime.sendMessage({
        command: "MINDDOCK_ATOMIZE_PREVIEW",
        payload: { content }
      })
      if (!response?.success) {
        throw new Error(response?.error ?? "Erro ao atomizar conteudo")
      }
      return response.payload?.notes ?? response.data?.notes ?? []
    },
    []
  )

  const saveAtomicNotes = useCallback(
    async (notesToSave: Array<{ title: string; content: string; tags: string[] }>) => {
      const response = await chrome.runtime.sendMessage({
        command: "MINDDOCK_SAVE_ATOMIC_NOTES",
        payload: { notes: notesToSave }
      })
      if (!response?.success) {
        throw new Error(response?.error ?? "Erro ao salvar notas")
      }
      const savedNotes = response.payload?.notes ?? response.data?.notes ?? []
      setNotes((prev) => [...savedNotes, ...prev])
      return savedNotes
    },
    []
  )

  return {
    notes, isLoading, error, refetch: fetchNotes,
    createNote, updateNote, deleteNote,
    atomizePreview, saveAtomicNotes
  }
}
