import { useCallback, useEffect, useState } from "react"
import type { AuthState, UserProfile } from "~/lib/types"

function getSafeRuntime(): typeof chrome.runtime | null {
  if (typeof chrome === "undefined") {
    return null
  }

  try {
    const runtime = chrome.runtime
    if (!runtime?.id) {
      return null
    }

    return runtime
  } catch {
    return null
  }
}

export function useAuth(): AuthState & {
  signIn: () => Promise<void>
  signInBypassThinker: () => Promise<void>
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
    setState((currentState) => ({ ...currentState, isLoading: true }))

    try {
      const runtime = getSafeRuntime()
      if (!runtime?.sendMessage) {
        setError("Contexto da extensao indisponivel. Recarregue a pagina.")
        setState({ user: null, isLoading: false, isAuthenticated: false })
        return
      }

      const response = await runtime.sendMessage({
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
      const message =
        fetchError instanceof Error ? fetchError.message : "Falha ao consultar autenticacao."
      setError(message)
      setState({ user: null, isLoading: false, isAuthenticated: false })
    }
  }, [])

  useEffect(() => {
    void fetchAuth()

    const listener = (message: {
      command?: string
      payload?: { user: UserProfile | null }
    }) => {
      if (message.command !== "MINDDOCK_AUTH_CHANGED") {
        return
      }

      const user = message.payload?.user ?? null
      setState({ user, isLoading: false, isAuthenticated: !!user })
    }

    const runtime = getSafeRuntime()
    if (!runtime?.onMessage) {
      return
    }

    runtime.onMessage.addListener(listener)

    return () => {
      try {
        runtime.onMessage.removeListener(listener)
      } catch {
        // Ignora contextos invalidados apos reload da extensao.
      }
    }
  }, [fetchAuth])

  const signIn = useCallback(async () => {
    setState((currentState) => ({ ...currentState, isLoading: true }))
    setError(null)

    try {
      const runtime = getSafeRuntime()
      if (!runtime?.sendMessage) {
        throw new Error("Contexto da extensao indisponivel. Recarregue a pagina.")
      }

      const response = await runtime.sendMessage({ command: "MINDDOCK_SIGN_IN" })
      if (response?.success === false) {
        throw new Error(String(response.error ?? "Falha ao iniciar login com Google."))
      }

      await fetchAuth()
    } catch (signInError) {
      const message =
        signInError instanceof Error ? signInError.message : "Falha ao iniciar login com Google."
      setError(message)
      setState((currentState) => ({
        ...currentState,
        isLoading: false,
        isAuthenticated: false
      }))
      throw signInError
    }
  }, [fetchAuth])

  const signOut = useCallback(async () => {
    const runtime = getSafeRuntime()
    if (!runtime?.sendMessage) {
      setError("Contexto da extensao indisponivel. Recarregue a pagina.")
      setState({ user: null, isLoading: false, isAuthenticated: false })
      return
    }

    await runtime.sendMessage({ command: "MINDDOCK_CMD_AUTH_SIGN_OUT" })
    setError(null)
    setState({ user: null, isLoading: false, isAuthenticated: false })
  }, [])

  const signInBypassThinker = useCallback(async () => {
    setState((currentState) => ({ ...currentState, isLoading: true }))
    setError(null)

    try {
      const runtime = getSafeRuntime()
      if (!runtime?.sendMessage) {
        throw new Error("Contexto da extensao indisponivel. Recarregue a pagina.")
      }

      const response = await runtime.sendMessage({
        command: "MINDDOCK_DEV_BYPASS_SIGN_IN",
        payload: { tier: "thinker" }
      })
      if (response?.success === false) {
        throw new Error(String(response.error ?? "Falha ao ativar bypass Thinker."))
      }

      await fetchAuth()
    } catch (bypassError) {
      const message =
        bypassError instanceof Error ? bypassError.message : "Falha ao ativar bypass Thinker."
      setError(message)
      setState((currentState) => ({
        ...currentState,
        isLoading: false,
        isAuthenticated: false
      }))
      throw bypassError
    }
  }, [fetchAuth])

  return { ...state, signIn, signInBypassThinker, signOut, refresh: fetchAuth, error }
}
