import { useEffect, useState, useCallback } from "react"
import type { UserProfile, AuthState } from "~/lib/types"

export function useAuth(): AuthState & {
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
  error: string | null
} {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false
  })
  const [error, setError] = useState<string | null>(null)

  const fetchAuth = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true }))
    try {
      const response = await chrome.runtime.sendMessage({
        command: "MINDDOCK_CMD_AUTH_GET_STATUS"
      })

      if (response?.success === false) {
        setError(String(response.error ?? "Falha ao verificar autenticacao."))
        setState({ user: null, isLoading: false, isAuthenticated: false })
        return
      }

      const payload = (response?.payload ?? response?.data) as
        | { user?: UserProfile | null; isAuthenticated?: boolean }
        | undefined
      const user = payload?.user ?? null
      setError(null)
      setState({ user, isLoading: false, isAuthenticated: !!user })
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Falha ao consultar autenticacao.")
      setState({ user: null, isLoading: false, isAuthenticated: false })
    }
  }, [])

  useEffect(() => {
    fetchAuth()

    // Escuta mudanças de auth do background
    const listener = (msg: { command?: string; payload?: { user: UserProfile | null } }) => {
      if (msg.command === "MINDDOCK_AUTH_CHANGED") {
        const user = msg.payload?.user ?? null
        setState({ user, isLoading: false, isAuthenticated: !!user })
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [fetchAuth])

  const signIn = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true }))
    setError(null)

    try {
      const response = await chrome.runtime.sendMessage({ command: "MINDDOCK_SIGN_IN" })
      if (response?.success === false) {
        throw new Error(String(response.error ?? "Falha ao iniciar login com Google."))
      }

      await fetchAuth()
    } catch (signInError) {
      const message =
        signInError instanceof Error ? signInError.message : "Falha ao iniciar login com Google."
      setError(message)
      setState((s) => ({ ...s, isLoading: false, isAuthenticated: false }))
      throw signInError
    }
  }, [fetchAuth])

  const signOut = useCallback(async () => {
    await chrome.runtime.sendMessage({ command: "MINDDOCK_CMD_AUTH_SIGN_OUT" })
    setError(null)
    setState({ user: null, isLoading: false, isAuthenticated: false })
  }, [])

  return { ...state, signIn, signOut, refresh: fetchAuth, error }
}
