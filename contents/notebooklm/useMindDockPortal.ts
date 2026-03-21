/**
 * useMindDockPortal
 *
 * Reusable hook to create an isolated portal on document.body.
 * Uses scoped CSS classes (no Shadow DOM) to avoid the React
 * reconciler insertBefore bug that occurs inside Shadow roots.
 */

import { useLayoutEffect, useRef, useState } from "react"

export function useMindDockPortal(
  hostAttr: string,
  zIndex = 2147483647
): HTMLElement | null {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const hostRef = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const host = document.createElement("div")
    host.setAttribute("data-minddock-host", hostAttr)
    host.style.cssText =
      `position:fixed;top:0;left:0;width:0;height:0;z-index:${zIndex};pointer-events:auto;`
    document.body.appendChild(host)
    hostRef.current = host
    setContainer(host)

    return () => {
      if (host.parentNode) {
        host.parentNode.removeChild(host)
      }
      hostRef.current = null
      setContainer(null)
    }
  }, [hostAttr, zIndex])

  return container
}
