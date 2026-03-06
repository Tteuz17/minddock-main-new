import { useCallback, useEffect, useRef, useState } from "react"

interface NotebookListItem {
  id: string
  title: string
}

interface UseNotebookListResult {
  notebooks: NotebookListItem[]
  isLoading: boolean
  error: Error | null
  reload: () => Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim()
}

function normalizeNotebookArray(value: unknown): NotebookListItem[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      id: normalizeString(item.id),
      title: normalizeString(item.name ?? item.title) || "Sem Titulo"
    }))
    .filter((item) => item.id.length > 0)
}

export function useNotebookList(): UseNotebookListResult {
  const abortControllerRef = useRef<AbortController | null>(null)
  const [notebooks, setNotebooks] = useState<NotebookListItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const load = useCallback(async (): Promise<void> => {
    abortControllerRef.current?.abort()
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    setIsLoading(true)
    setError(null)

    try {
      if (!chrome.runtime?.sendMessage) {
        throw new Error("Chrome runtime indisponivel.")
      }

      const response = await chrome.runtime.sendMessage({ type: "FETCH_NOTEBOOKS" })
      if (abortController.signal.aborted) {
        return
      }

      const rawPayload =
        isRecord(response) && isRecord(response.payload)
          ? response.payload
          : isRecord(response) && isRecord(response.data)
          ? response.data
          : {}

      const nextNotebooks = normalizeNotebookArray(rawPayload.notebooks)
      const success = isRecord(response) && response.success === true

      if (!success) {
        const errorMessage =
          isRecord(response) && normalizeString(response.error)
            ? normalizeString(response.error)
            : "Erro ao carregar cadernos."
        throw new Error(errorMessage)
      }

      setNotebooks(nextNotebooks)
    } catch (rawError) {
      if (abortController.signal.aborted) {
        return
      }

      setNotebooks([])
      setError(rawError instanceof Error ? rawError : new Error("Erro ao carregar cadernos."))
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null
      }

      if (!abortController.signal.aborted) {
        setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void load()

    return () => {
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
    }
  }, [load])

  return {
    notebooks,
    isLoading,
    error,
    reload: load
  }
}
