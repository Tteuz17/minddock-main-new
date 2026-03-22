/**
 * useShadowPortal
 *
 * Reusable hook to create an isolated Shadow DOM portal on document.body.
 * Used by extension modals to avoid collisions with the host React tree.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

export function useShadowPortal(
  hostAttr: string,
  active: boolean,
  zIndex = 2147483647
): { shadowRoot: ShadowRoot | null; injectCSS: (css: string) => void } {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const shadowRef = useRef<ShadowRoot | null>(null)
  const [shadowRoot, setShadowRoot] = useState<ShadowRoot | null>(null)
  const injectedCSSRef = useRef(false)

  useLayoutEffect(() => {
    const host = document.createElement("div")
    host.setAttribute("data-minddock-shadow-host", hostAttr)
    host.style.cssText =
      `position:fixed;top:0;left:0;width:100%;height:100%;z-index:${zIndex};pointer-events:none;will-change:transform;isolation:isolate;`
    document.body.appendChild(host)
    hostRef.current = host

    const shadow = host.attachShadow({ mode: "open" })
    shadowRef.current = shadow
    setShadowRoot(shadow)

    return () => {
      if (host.parentNode) {
        host.parentNode.removeChild(host)
      }
      hostRef.current = null
      shadowRef.current = null
      setShadowRoot(null)
      injectedCSSRef.current = false
    }
  }, [hostAttr, zIndex])

  useEffect(() => {
    if (!active) {
      return
    }
    const host = hostRef.current
    if (!host) {
      return
    }
    if (!document.body.contains(host)) {
      document.body.appendChild(host)
    }
  }, [active])

  const injectCSS = useCallback((css: string) => {
    const shadow = shadowRef.current
    if (!shadow || injectedCSSRef.current) {
      return
    }
    const style = document.createElement("style")
    style.textContent = css
    shadow.appendChild(style)
    injectedCSSRef.current = true
  }, [])

  return { shadowRoot, injectCSS }
}
