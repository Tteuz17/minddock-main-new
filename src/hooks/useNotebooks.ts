import { useCallback, useEffect, useRef, useState } from "react"
import type { Notebook } from "~/lib/types"
import { useAuth } from "./useAuth"

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
      const response = await chrome.runtime.sendMessage({
        command: "MINDDOCK_CMD_GET_NOTEBOOKS"
      })

      if (response?.success) {
        setNotebooks((response.payload ?? response.data) as Notebook[])
      } else {
        setError(response?.error ?? "Erro ao carregar notebooks")
      }
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
