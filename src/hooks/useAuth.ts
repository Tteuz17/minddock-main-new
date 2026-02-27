import { useEffect, useState, useCallback } from "react"
import type { UserProfile, AuthState } from "~/lib/types"

export function useAuth(): AuthState & {
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
} {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false
  })

  const fetchAuth = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true }))
    const response = await chrome.runtime.sendMessage({
      command: "MINDDOCK_CMD_AUTH_GET_STATUS"
    })
    const payload = (response?.payload ?? response?.data) as
      | { user?: UserProfile | null; isAuthenticated?: boolean }
      | undefined
    const user = payload?.user ?? null
    setState({ user, isLoading: false, isAuthenticated: !!user })
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
    await chrome.runtime.sendMessage({ command: "MINDDOCK_SIGN_IN" })
    await fetchAuth()
  }, [fetchAuth])

  const signOut = useCallback(async () => {
    await chrome.runtime.sendMessage({ command: "MINDDOCK_CMD_AUTH_SIGN_OUT" })
    setState({ user: null, isLoading: false, isAuthenticated: false })
  }, [])

  return { ...state, signIn, signOut, refresh: fetchAuth }
}
