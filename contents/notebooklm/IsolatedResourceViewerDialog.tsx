/**
 * IsolatedResourceViewerDialog
 *
 * Modal de pre-visualizacao completamente isolado do DOM do NotebookLM.
 * Usa Shadow DOM + container proprio no document.body - o React do NotebookLM
 * nunca toca neste no, eliminando o DOMException de insertBefore/removeChild.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode
} from "react"
import * as ReactDOM from "react-dom"
import { resolveResourceViewerUiCopy } from "./notebooklmI18n"

// ---------------------------------------------------------------------------
// Tipos publicos
// ---------------------------------------------------------------------------

export interface IsolatedResourceAssetData {
  id: string
  title: string
  mimeType: string
  secureUrl: string
}

export interface IsolatedResourceViewerDialogProps {
  isOpen: boolean
  onCloseRequest: () => void
  assetData: IsolatedResourceAssetData | null
}

// ---------------------------------------------------------------------------
// Constantes de transicao
// ---------------------------------------------------------------------------

const TRANSITION_MS = 280

// ---------------------------------------------------------------------------
// Hook: cria e mantem um Shadow DOM host isolado no document.body
// Retorna o shadowRoot para uso como portal target.
// ---------------------------------------------------------------------------

function useShadowPortal(enabled: boolean): ShadowRoot | null {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const shadowRef = useRef<ShadowRoot | null>(null)
  const [shadowRoot, setShadowRoot] = useState<ShadowRoot | null>(null)

  useLayoutEffect(() => {
    const host = document.createElement("div")
    host.setAttribute("data-minddock-shadow-host", "preview-dialog")
    host.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;"
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
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    const host = hostRef.current
    if (!host) return
    if (!document.body.contains(host)) {
      document.body.appendChild(host)
    }
  }, [enabled])

  return shadowRoot
}

// ---------------------------------------------------------------------------
// Hook: transicao de montagem segura
// ---------------------------------------------------------------------------

function useMountTransition(isOpen: boolean, durationMs: number): boolean {
  const [hasTransitioned, setHasTransitioned] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setHasTransitioned(true)
      return
    }
    const timer = window.setTimeout(() => setHasTransitioned(false), durationMs)
    return () => window.clearTimeout(timer)
  }, [isOpen, durationMs])

  return hasTransitioned
}

// ---------------------------------------------------------------------------
// Estilos injetados no Shadow DOM (isolados do NotebookLM)
// ---------------------------------------------------------------------------

const SHADOW_CSS = `
  *,
  *::before,
  *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :host {
    all: initial;
    font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
  }

  .md-overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(0, 0, 0, 0.82);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    opacity: 0;
    pointer-events: none;
    transition: opacity ${TRANSITION_MS}ms ease;
  }

  .md-overlay.is-open {
    opacity: 1;
    pointer-events: auto;
  }

  .md-panel {
    position: relative;
    width: min(960px, 100%);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.13);
    background: #0a0a0a;
    color: #e2e6ee;
    box-shadow: 0 32px 80px rgba(0, 0, 0, 0.72), 0 0 0 1px rgba(250, 204, 21, 0.06);
    transform: scale(0.95) translateY(12px);
    opacity: 0;
    transition:
      transform ${TRANSITION_MS}ms cubic-bezier(0.16, 1, 0.3, 1),
      opacity ${TRANSITION_MS}ms ease;
  }

  .md-overlay.is-open .md-panel {
    transform: scale(1) translateY(0);
    opacity: 1;
  }

  .md-panel::before {
    content: '';
    position: absolute;
    inset-x: 0;
    top: 0;
    height: 2px;
    background: linear-gradient(90deg, transparent 0%, #facc15 40%, #fbbf24 60%, transparent 100%);
    border-radius: 16px 16px 0 0;
    z-index: 1;
  }

  .md-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 18px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    background: #060606;
    flex-shrink: 0;
  }

  .md-header-left {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .md-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: #111;
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #b7c0cf;
    width: fit-content;
  }

  .md-badge-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #facc15;
    flex-shrink: 0;
  }

  .md-title {
    font-size: 17px;
    font-weight: 600;
    line-height: 1.3;
    color: #f3f4f6;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 700px;
  }

  .md-close-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: #111;
    color: #9aa6b8;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    font-weight: 400;
    transition: border-color 160ms, background 160ms, color 160ms;
  }

  .md-close-btn:hover {
    border-color: rgba(250, 204, 21, 0.5);
    background: #191207;
    color: #facc15;
  }

  .md-body {
    padding: 16px;
    overflow: auto;
    flex: 1;
    background: #0a0a0a;
  }

  .md-pre {
    margin: 0;
    max-height: 68vh;
    overflow: auto;
    padding: 16px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: #050505;
    color: #e2e8f0;
    font-size: 13px;
    line-height: 1.65;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  }

  .md-image {
    display: block;
    width: 100%;
    max-height: 70vh;
    object-fit: contain;
    border-radius: 10px;
    background: #111;
  }

  .md-audio {
    width: 100%;
    filter: invert(1) hue-rotate(180deg);
  }

  .md-iframe {
    width: 100%;
    height: 520px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    background: #fff;
  }

  .md-fallback {
    font-size: 14px;
    color: #9aa6b8;
    padding: 24px 0;
    text-align: center;
  }

  .md-footer {
    padding: 10px 18px 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    background: #060606;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex-shrink: 0;
  }

  .md-mime-tag {
    font-size: 11px;
    color: #6b7280;
    font-family: monospace;
    padding: 3px 8px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.08);
    background: #111;
  }
`

// ---------------------------------------------------------------------------
// Componente interno renderizado dentro do Shadow DOM
// ---------------------------------------------------------------------------

interface InnerDialogProps {
  isOpen: boolean
  assetData: IsolatedResourceAssetData
  onCloseRequest: () => void
  uiCopy: ReturnType<typeof resolveResourceViewerUiCopy>
}

function InnerDialog({ isOpen, assetData, onCloseRequest, uiCopy }: InnerDialogProps) {
  const handleOverlayClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) {
        onCloseRequest()
      }
    },
    [onCloseRequest]
  )

  const stopProp = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRequest()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isOpen, onCloseRequest])

  const mimeLabel = normalizeMimeType(assetData.mimeType)

  return (
    <div className={`md-overlay${isOpen ? " is-open" : ""}`} onClick={handleOverlayClick}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={assetData.title || uiCopy.previewLabel}
        className="md-panel"
        onClick={stopProp}>
        <header className="md-header">
          <div className="md-header-left">
            <span className="md-badge">
              <span className="md-badge-dot" />
              {uiCopy.previewLabel ?? "Preview"}
            </span>
            <p className="md-title" title={assetData.title}>
              {assetData.title || uiCopy.previewLabel}
            </p>
          </div>
          <button
            type="button"
            className="md-close-btn"
            aria-label={uiCopy.closePreviewAriaLabel}
            onClick={onCloseRequest}>
            ✕
          </button>
        </header>

        <section className="md-body">{renderAssetBody(assetData, uiCopy)}</section>

        <footer className="md-footer">
          <span className="md-mime-tag">{mimeLabel}</span>
        </footer>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Componente publico - monta tudo em Shadow DOM isolado
// ---------------------------------------------------------------------------

export function IsolatedResourceViewerDialog(props: IsolatedResourceViewerDialogProps) {
  const { isOpen, onCloseRequest, assetData } = props
  const hasTransitioned = useMountTransition(isOpen, TRANSITION_MS)
  const shadowRoot = useShadowPortal(isOpen || hasTransitioned)
  const uiCopy = useMemo(() => resolveResourceViewerUiCopy(), [])

  const cssInjectedRef = useRef(false)
  useEffect(() => {
    if (!shadowRoot || cssInjectedRef.current) return
    const style = document.createElement("style")
    style.textContent = SHADOW_CSS
    shadowRoot.appendChild(style)
    cssInjectedRef.current = true
  }, [shadowRoot])

  if (!shadowRoot || (!isOpen && !hasTransitioned) || !assetData) {
    return null
  }

  return ReactDOM.createPortal(
    <InnerDialog
      isOpen={isOpen}
      assetData={assetData}
      onCloseRequest={onCloseRequest}
      uiCopy={uiCopy}
    />,
    shadowRoot
  )
}

// ---------------------------------------------------------------------------
// Helpers de renderizacao
// ---------------------------------------------------------------------------

function renderAssetBody(
  assetData: IsolatedResourceAssetData,
  uiCopy: ReturnType<typeof resolveResourceViewerUiCopy>
): ReactNode {
  const mimeType = normalizeMimeType(assetData.mimeType)

  switch (mimeType) {
    case "image/png":
    case "image/jpeg":
    case "image/webp":
    case "image/gif":
      return (
        <img
          src={assetData.secureUrl}
          alt={uiCopy.imageAlt ?? assetData.title}
          className="md-image"
        />
      )

    case "audio/mpeg":
    case "audio/mp3":
    case "audio/wav":
    case "audio/ogg":
      return <audio controls src={assetData.secureUrl} className="md-audio" />

    case "application/pdf":
      return (
        <iframe
          src={assetData.secureUrl}
          title={uiCopy.pdfIframeTitle ?? assetData.title}
          className="md-iframe"
        />
      )

    case "text/markdown":
    case "text/plain": {
      const text = resolveSafeText(assetData.secureUrl)
      return <pre className="md-pre">{text || (uiCopy.unsupportedFormatMessage ?? "Sem conteudo.")}</pre>
    }

    default:
      return (
        <p className="md-fallback">
          {uiCopy.unsupportedFormatMessage ?? "Formato nao suportado para pre-visualizacao."}
        </p>
      )
  }
}

function normalizeMimeType(rawMimeType: string): string {
  return String(rawMimeType ?? "")
    .toLowerCase()
    .split(";")[0]
    .trim()
}

function resolveSafeText(secureUrl: string): string {
  const source = String(secureUrl ?? "")
  if (!source.trim()) return ""

  if (/^data:text\//i.test(source)) {
    const commaIndex = source.indexOf(",")
    if (commaIndex >= 0) {
      const meta = source.slice(0, commaIndex)
      const payload = source.slice(commaIndex + 1)
      try {
        if (/;base64/i.test(meta)) return decodeBase64(payload)
        return decodeURIComponent(payload)
      } catch {
        return payload
      }
    }
  }

  return source
}

function decodeBase64(value: string): string {
  try {
    const decoded = atob(value)
    const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return value
  }
}
