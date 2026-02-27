import { useCallback, useEffect, useState } from "react"
import type { Notebook } from "~/lib/types"
import { useAuth } from "./useAuth"

export function useNotebooks() {
  const { isAuthenticated } = useAuth()
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchNotebooks = useCallback(async () => {
    if (!isAuthenticated) return
    setIsLoading(true)
    setError(null)

    const response = await chrome.runtime.sendMessage({
      command: "MINDDOCK_CMD_GET_NOTEBOOKS"
    })

    if (response?.success) {
      setNotebooks((response.payload ?? response.data) as Notebook[])
    } else {
      setError(response?.error ?? "Erro ao carregar notebooks")
    }
    setIsLoading(false)
  }, [isAuthenticated])

  useEffect(() => {
    fetchNotebooks()
  }, [fetchNotebooks])

  return { notebooks, isLoading, error, refetch: fetchNotebooks }
}
