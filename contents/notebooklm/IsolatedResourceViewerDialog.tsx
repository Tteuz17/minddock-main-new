import { useMemo, type CSSProperties, type MouseEvent, type ReactNode } from "react"
import { useSafeMountTransition } from "~/hooks/useSafeMountTransition"
import { resolveResourceViewerUiCopy } from "./notebooklmI18n"

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

const TRANSITION_MS = 300

const overlayBaseStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 2147483647,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  background: "rgba(0, 0, 0, 0.7)",
  transition: `opacity ${TRANSITION_MS}ms ease`
}

const panelBaseStyle: CSSProperties = {
  width: "min(960px, 100%)",
  maxHeight: "90vh",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  borderRadius: "16px",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  background: "#ffffff",
  color: "#111827",
  boxShadow: "0 24px 64px rgba(0, 0, 0, 0.45)",
  transition: `transform ${TRANSITION_MS}ms ease, opacity ${TRANSITION_MS}ms ease`
}

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  padding: "14px 16px",
  borderBottom: "1px solid rgba(17, 24, 39, 0.1)",
  background: "#f8fafc"
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "16px",
  lineHeight: 1.2,
  fontWeight: 600,
  color: "#111827",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis"
}

const closeButtonStyle: CSSProperties = {
  border: "1px solid rgba(17, 24, 39, 0.2)",
  background: "#ffffff",
  color: "#111827",
  borderRadius: "10px",
  width: "32px",
  height: "32px",
  cursor: "pointer",
  fontSize: "18px",
  lineHeight: 1,
  fontWeight: 700
}

const bodyStyle: CSSProperties = {
  padding: "16px",
  overflow: "auto",
  minHeight: "220px",
  background: "#ffffff"
}

const fallbackMessageStyle: CSSProperties = {
  margin: 0,
  fontSize: "14px",
  color: "#374151"
}

const imageStyle: CSSProperties = {
  display: "block",
  width: "100%",
  maxHeight: "70vh",
  objectFit: "contain",
  borderRadius: "10px",
  background: "#f3f4f6"
}

const audioStyle: CSSProperties = {
  width: "100%"
}

const iframeStyle: CSSProperties = {
  width: "100%",
  height: "500px",
  border: "1px solid rgba(17, 24, 39, 0.12)",
  borderRadius: "10px",
  background: "#ffffff"
}

const preStyle: CSSProperties = {
  margin: 0,
  maxHeight: "68vh",
  overflow: "auto",
  padding: "14px",
  borderRadius: "10px",
  border: "1px solid rgba(17, 24, 39, 0.12)",
  background: "#0f172a",
  color: "#f8fafc",
  fontSize: "13px",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word"
}

const codeStyle: CSSProperties = {
  fontFamily: "'JetBrains Mono', 'Consolas', 'Monaco', monospace"
}

export function IsolatedResourceViewerDialog(props: IsolatedResourceViewerDialogProps) {
  const { isOpen, onCloseRequest, assetData } = props
  const hasTransitionedIn = useSafeMountTransition(isOpen, TRANSITION_MS)
  const uiCopy = useMemo(() => resolveResourceViewerUiCopy(), [])

  if ((!hasTransitionedIn && !isOpen) || !assetData) {
    return null
  }

  const titleId = useMemo(() => `minddock-isolated-resource-title-${sanitizeId(assetData.id)}`, [assetData.id])

  const overlayStyle: CSSProperties = {
    ...overlayBaseStyle,
    opacity: isOpen ? 1 : 0,
    pointerEvents: isOpen ? "auto" : "none"
  }

  const panelStyle: CSSProperties = {
    ...panelBaseStyle,
    opacity: isOpen ? 1 : 0,
    transform: isOpen ? "scale(1) translateY(0)" : "scale(0.95) translateY(10px)"
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={overlayStyle}
      onClick={onCloseRequest}>
      <div
        style={panelStyle}
        onClick={(event: MouseEvent<HTMLDivElement>) => {
          event.stopPropagation()
        }}>
        <header style={headerStyle}>
          <h2 id={titleId} style={titleStyle}>
            {assetData.title || uiCopy.previewLabel}
          </h2>
          <button type="button" onClick={onCloseRequest} aria-label={uiCopy.closePreviewAriaLabel} style={closeButtonStyle}>
            ×
          </button>
        </header>
        <section style={bodyStyle}>{renderAssetBody(assetData, uiCopy)}</section>
      </div>
    </div>
  )
}

function renderAssetBody(assetData: IsolatedResourceAssetData, uiCopy = resolveResourceViewerUiCopy()): ReactNode {
  const mimeType = normalizeMimeType(assetData.mimeType)

  switch (mimeType) {
    case "image/png":
    case "image/jpeg":
      return <img src={assetData.secureUrl} alt={uiCopy.imageAlt} style={imageStyle} />
    case "audio/mpeg":
    case "audio/mp3":
      return <audio controls src={assetData.secureUrl} style={audioStyle} />
    case "application/pdf":
      return (
        <iframe
          src={assetData.secureUrl}
          title={uiCopy.pdfIframeTitle}
          width="100%"
          height="500px"
          style={iframeStyle}
        />
      )
    case "text/markdown":
    case "text/plain": {
      const safeText = resolveSafeText(assetData.secureUrl)
      return (
        <pre style={preStyle}>
          <code style={codeStyle}>{safeText}</code>
        </pre>
      )
    }
    default:
      return <p style={fallbackMessageStyle}>{uiCopy.unsupportedFormatMessage}</p>
  }
}

function normalizeMimeType(rawMimeType: string): string {
  return String(rawMimeType ?? "")
    .toLowerCase()
    .split(";")[0]
    .trim()
}

function sanitizeId(rawId: string): string {
  const normalized = String(rawId ?? "").trim().toLowerCase()
  if (!normalized) {
    return "asset"
  }
  return normalized.replace(/[^a-z0-9_-]/g, "-")
}

function resolveSafeText(secureUrl: string): string {
  const source = String(secureUrl ?? "")
  if (!source.trim()) {
    return ""
  }

  if (/^data:text\//i.test(source)) {
    const commaIndex = source.indexOf(",")
    if (commaIndex >= 0) {
      const metadata = source.slice(0, commaIndex)
      const payload = source.slice(commaIndex + 1)
      try {
        if (/;base64/i.test(metadata)) {
          return decodeBase64(payload)
        }
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
    const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return value
  }
}


