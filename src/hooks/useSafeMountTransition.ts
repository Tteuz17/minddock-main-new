import { useEffect, useMemo, useState } from "react"

/**
 * Mantem o componente montado por um pequeno intervalo durante o fechamento,
 * permitindo animacao CSS de saida antes do unmount real.
 */
export function useSafeMountTransition(isMounted: boolean, unmountDelay: number): boolean {
  const normalizedDelay = useMemo(() => {
    if (!Number.isFinite(unmountDelay) || unmountDelay < 0) {
      return 0
    }
    return Math.floor(unmountDelay)
  }, [unmountDelay])

  const [hasTransitionedIn, setHasTransitionedIn] = useState<boolean>(isMounted)

  useEffect(() => {
    if (isMounted) {
      setHasTransitionedIn(true)
      return
    }

    if (normalizedDelay === 0) {
      setHasTransitionedIn(false)
      return
    }

    const timeoutId = globalThis.setTimeout(() => {
      setHasTransitionedIn(false)
    }, normalizedDelay)

    return () => {
      globalThis.clearTimeout(timeoutId)
    }
  }, [isMounted, normalizedDelay])

  return hasTransitionedIn
}
