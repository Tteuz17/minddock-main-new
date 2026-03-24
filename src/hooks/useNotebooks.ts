import { useCallback, useEffect, useRef, useState } from "react"
import type { Notebook } from "~/lib/types"
import { useAuth } from "./useAuth"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim()
}

function normalizeNotebookArray(value: unknown): Notebook[] {
  const rawItems = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.notebooks)
    ? value.notebooks
    : []

  const nowIso = new Date().toISOString()
  const deduped = new Map<string, Notebook>()

  for (const rawItem of rawItems) {
    if (!isRecord(rawItem)) {
      continue
    }

    const id = normalizeString(rawItem.id)
    const title = normalizeString(rawItem.title ?? rawItem.name)
    if (!id || !title) {
      continue
    }

    const createTime = normalizeString(rawItem.createTime) || nowIso
    const updateTime = normalizeString(rawItem.updateTime) || createTime
    const sourceCount =
      typeof rawItem.sourceCount === "number" && Number.isFinite(rawItem.sourceCount)
        ? rawItem.sourceCount
        : 0

    const normalizedNotebook: Notebook = {
      id,
      title,
      createTime,
      updateTime,
      sourceCount
    }

    if (!deduped.has(id)) {
      deduped.set(id, normalizedNotebook)
    }
  }

  return Array.from(deduped.values())
}

function extractNotebooksFromResponse(response: unknown): Notebook[] {
  if (!isRecord(response)) {
    return []
  }

  const payload =
    response.payload !== undefined ? response.payload : response.data !== undefined ? response.data : response

  return normalizeNotebookArray(payload)
}

function mergeNotebookLists(primary: Notebook[], secondary: Notebook[]): Notebook[] {
  const merged = new Map<string, Notebook>()

  const upsert = (item: Notebook): void => {
    const id = normalizeString(item.id)
    const title = normalizeString(item.title)
    if (!id || !title) {
      return
    }

    const existing = merged.get(id)
    if (!existing) {
      merged.set(id, item)
      return
    }

    const existingTitle = normalizeString(existing.title)
    const incomingTitle = normalizeString(item.title)
    const keepIncoming = incomingTitle.length > existingTitle.length

    merged.set(id, keepIncoming ? item : existing)
  }

  for (const item of primary) {
    upsert(item)
  }
  for (const item of secondary) {
    upsert(item)
  }

  return Array.from(merged.values())
}

export function useNotebooks() {
  const { isAuthenticated } = useAuth()
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isFetchingRef = useRef(false)

  const fetchNotebooks = useCallback(async (options?: { silent?: boolean }) => {
    if (!isAuthenticated) {
      setNotebooks([])
      setError(null)
      setIsLoading(false)
      return
    }

    if (isFetchingRef.current) {
      return
    }

    isFetchingRef.current = true
    const isSilent = options?.silent === true
    if (!isSilent) {
      setIsLoading(true)
    }
    setError(null)

    try {
      const primaryResponse = await chrome.runtime.sendMessage({
        command: "MINDDOCK_CMD_GET_NOTEBOOKS"
      })
      const primaryNotebooks = primaryResponse?.success
        ? extractNotebooksFromResponse(primaryResponse)
        : []

      if (primaryNotebooks.length > 1) {
        setNotebooks(primaryNotebooks)
        return
      }

      let fallbackNotebooks: Notebook[] = []
      let fallbackError: unknown = null

      try {
        const fallbackResponse = await chrome.runtime.sendMessage({
          type: "FETCH_NOTEBOOKS"
        })

        if (fallbackResponse?.success) {
          fallbackNotebooks = extractNotebooksFromResponse(fallbackResponse)
        } else {
          fallbackError = fallbackResponse?.error
        }
      } catch (error) {
        fallbackError = error
      }

      const mergedNotebooks = mergeNotebookLists(primaryNotebooks, fallbackNotebooks)

      if (mergedNotebooks.length > 0) {
        setNotebooks(mergedNotebooks)
        return
      }

      if (primaryNotebooks.length > 0) {
        setNotebooks(primaryNotebooks)
        return
      }

      if (fallbackNotebooks.length > 0) {
        setNotebooks(fallbackNotebooks)
        return
      }

      if (primaryResponse?.success) {
        setNotebooks([])
        return
      }

      const fallbackErrorMessage =
        fallbackError instanceof Error
          ? fallbackError.message
          : normalizeString(fallbackError)

      setError(
        primaryResponse?.error ??
          fallbackErrorMessage ??
          "Erro ao carregar notebooks"
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao carregar notebooks"
      setError(message)
    } finally {
      isFetchingRef.current = false
      if (!isSilent) {
        setIsLoading(false)
      }
    }
  }, [isAuthenticated])

  useEffect(() => {
    void fetchNotebooks()
  }, [fetchNotebooks])

  useEffect(() => {
    if (!isAuthenticated) {
      return
    }

    const refreshSilently = () => {
      void fetchNotebooks({ silent: true })
    }

    const intervalId = window.setInterval(refreshSilently, 10_000)
    const handleFocus = () => refreshSilently()
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshSilently()
      }
    }

    window.addEventListener("focus", handleFocus)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener("focus", handleFocus)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [fetchNotebooks, isAuthenticated])

  const refetch = useCallback(() => {
    void fetchNotebooks()
  }, [fetchNotebooks])

  return { notebooks, isLoading, error, refetch }
}
