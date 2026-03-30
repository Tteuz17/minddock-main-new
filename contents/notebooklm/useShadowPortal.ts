/**
 * useShadowPortal
 *
 * Reusable hook to create an isolated Shadow DOM portal on document.body.
 * Used by extension modals to avoid collisions with the host React tree.
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react"

type PortalContainer = ShadowRoot | HTMLElement

function scopeCssToHost(cssText: string, hostAttr: string): string {
  const scopeSelector = `[data-minddock-shadow-host="${hostAttr}"]`
  return cssText.replace(/(^|[}\n])(\s*)([^@{}\n][^{}\n]*)\{/g, (match, prefix, whitespace, selectorGroup) => {
    const selectors = String(selectorGroup ?? "")
      .split(",")
      .map((selector) => selector.trim())
      .filter(Boolean)
    if (selectors.length === 0) {
      return match
    }

    const scopedSelectors = selectors.map((selector) => {
      const hostNormalized = selector.replace(/:host/gi, scopeSelector)
      if (/^(from|to|\d+%)$/i.test(hostNormalized)) {
        return hostNormalized
      }
      if (hostNormalized.startsWith(scopeSelector)) {
        return hostNormalized
      }
      return `${scopeSelector} ${hostNormalized}`
    })

    return `${prefix}${whitespace}${scopedSelectors.join(", ")} {`
  })
}

export function useShadowPortal(
  hostAttr: string,
  active: boolean,
  zIndex = 2147483647
): { shadowRoot: PortalContainer | null; injectCSS: (css: string) => void } {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const shadowRef = useRef<PortalContainer | null>(null)
  const [shadowRoot, setShadowRoot] = useState<PortalContainer | null>(null)
  const injectedCSSRef = useRef(false)

  useLayoutEffect(() => {
    if (!active) {
      if (hostRef.current?.parentNode) {
        hostRef.current.parentNode.removeChild(hostRef.current)
      }
      hostRef.current = null
      shadowRef.current = null
      setShadowRoot(null)
      injectedCSSRef.current = false
      return
    }

    const host = document.createElement("div")
    host.setAttribute("data-minddock-shadow-host", hostAttr)
    host.style.cssText =
      `position:fixed;top:0;left:0;width:100%;height:100%;z-index:${zIndex};pointer-events:auto;will-change:transform;isolation:isolate;`
    document.body.appendChild(host)
    hostRef.current = host

    const shadow: PortalContainer = host
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
  }, [active, hostAttr, zIndex])

  const injectCSS = useCallback((css: string) => {
    const shadow = shadowRef.current
    if (!shadow || injectedCSSRef.current) {
      return
    }
    const style = document.createElement("style")
    style.textContent = shadow instanceof ShadowRoot ? css : scopeCssToHost(css, hostAttr)
    shadow.appendChild(style)
    injectedCSSRef.current = true
  }, [hostAttr])

  return { shadowRoot, injectCSS }
}
