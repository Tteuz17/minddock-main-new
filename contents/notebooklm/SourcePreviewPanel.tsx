/**
 * SourcePreviewPanel
 *
 * Painel de pré-visualização completamente independente do SourceDownloadPanel.
 * Montado direto no document.body via Shadow DOM.
 * Comunicação via evento customizado — zero acoplamento de DOM.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import * as ReactDOM from "react-dom"
import { useShadowPortal } from "./useShadowPortal"
import {
  formatAsDocxText,
  formatAsMarkdown,
  formatAsPdfText,
  formatAsText,
  type SourceExportRecord
} from "~/lib/source-download"

// ---------------------------------------------------------------------------
// Eventos públicos
// ---------------------------------------------------------------------------

export const SOURCE_PREVIEW_OPEN_EVENT = "minddock:source-preview:open"
export const SOURCE_PREVIEW_CLOSE_EVENT = "minddock:source-preview:close"

export type PreviewDownloadFormat = "markdown" | "text" | "pdf" | "docx"

export interface PreviewDraftItem {
  sourceId: string
  sourceTitle: string
  sourceUrl?: string
  sourceKind: "youtube" | "document"
  summaryText: string
  editableContent: string
  previewFormat?: PreviewDownloadFormat
}

export interface SourcePreviewOpenDetail {
  drafts: PreviewDraftItem[]
  format: PreviewDownloadFormat
  skippedCount: number
  onDownload: (items: PreviewDraftItem[], format: PreviewDownloadFormat) => Promise<void>
  labels: {
    previewLabTitle: string
    title: string
    subtitle: string
    sourceKindYoutube: string
    sourceKindDocument: string
    previewTextareaPlaceholder: string
    skippedLabel: string
    noPreview: string
    backButton: string
    downloadButton: string
    downloadingButton: string
  }
}

// ---------------------------------------------------------------------------
// CSS isolado no Shadow DOM
// ---------------------------------------------------------------------------

const SHADOW_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :host { all: initial; font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; }

  .overlay {
    position: fixed; inset: 0; z-index: 2147483647;
    display: flex; align-items: center; justify-content: center;
    padding: 16px;
    background: rgba(0,0,0,0.88);
    backdrop-filter: blur(1px);
    pointer-events: auto;
    animation: fadeIn 180ms ease;
  }
  @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }

  .panel {
    position: relative;
    display: flex; flex-direction: column;
    width: 100%; max-width: 960px; max-height: 88vh;
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.14);
    background: #000; color: #e2e6ee;
    box-shadow: 0 18px 48px rgba(0,0,0,0.56);
    animation: slideUp 200ms cubic-bezier(0.16,1,0.3,1);
  }
  @keyframes slideUp {
    from { opacity:0; transform:scale(0.96) translateY(10px) }
    to   { opacity:1; transform:scale(1)    translateY(0)     }
  }
  .panel::before {
    content:''; position:absolute; inset-x:0; top:0;
    height:1px; background:rgba(255,255,255,0.16);
    border-radius:14px 14px 0 0; pointer-events:none;
  }

  /* Header */
  .header {
    display:flex; align-items:flex-start; justify-content:space-between; gap:16px;
    padding:16px 20px;
    border-bottom:1px solid rgba(255,255,255,0.12);
    background:#060606; flex-shrink:0;
  }
  .badge {
    display:inline-flex; align-items:center; gap:6px;
    border-radius:6px; border:1px solid rgba(255,255,255,0.16);
    background:#0b0b0b; padding:3px 8px;
    font-size:10px; font-weight:700; text-transform:uppercase;
    letter-spacing:0.08em; color:#b7c0cf;
  }
  .badge-dot { width:7px; height:7px; border-radius:50%; background:#facc15; flex-shrink:0; }
  .h-title { font-size:28px; font-weight:600; color:#fff; margin-top:8px; line-height:1; }
  .h-sub   { font-size:13px; color:#9da7b8; margin-top:6px; line-height:1.6; }
  .close-btn {
    flex-shrink:0; display:inline-flex; align-items:center; justify-content:center;
    width:40px; height:40px; border-radius:8px;
    border:1px solid rgba(255,255,255,0.2); background:#0a0a0a; color:#a9b2c1;
    cursor:pointer; font-size:16px;
    transition:border-color 150ms,background 150ms,color 150ms;
  }
  .close-btn:hover { border-color:rgba(250,204,21,0.55); background:#151209; color:#facc15; }

  /* Format bar */
  .format-bar {
    display:grid; grid-template-columns:repeat(4,1fr); gap:8px;
    margin:12px 20px 0;
    border-radius:10px; border:1px solid rgba(255,255,255,0.16);
    background:#0c0c0c; padding:10px;
    flex-shrink:0;
  }
  @media (max-width:600px) { .format-bar { grid-template-columns:repeat(2,1fr); } }
  .fmt-btn {
    display:flex; flex-direction:column; justify-content:center; gap:2px;
    min-height:50px; border-radius:8px;
    border:1px solid rgba(255,255,255,0.16); background:#111; color:#c8d1de;
    padding:8px 10px; cursor:pointer;
    transition:border-color 150ms,background 150ms,color 150ms;
  }
  .fmt-btn:hover { border-color:rgba(250,204,21,0.35); background:#161616; }
  .fmt-btn.active { border-color:#facc15; background:#facc15; color:#131002; }
  .fmt-label { font-size:14px; font-weight:600; line-height:1; }
  .fmt-sub   { font-size:11px; opacity:0.85; line-height:1.2; }

  /* Skipped */
  .skipped {
    margin:8px 20px 0; padding:8px 12px;
    border-radius:10px; border:1px solid rgba(255,255,255,0.08); background:#10151d;
    font-size:12px; color:#c7ced8; flex-shrink:0;
  }

  /* Draft grid */
  .draft-area {
    flex:1; min-height:0; overflow-y:auto;
    display:grid; grid-template-columns:repeat(2,1fr);
    gap:16px; padding:12px 20px;
  }
  .draft-area,
  .draft-card textarea {
    scrollbar-color: #1f2937 #050505;
    scrollbar-width: thin;
  }
  .draft-area::-webkit-scrollbar,
  .draft-card textarea::-webkit-scrollbar { width: 10px; }
  .draft-area::-webkit-scrollbar-track,
  .draft-card textarea::-webkit-scrollbar-track { background: #050505; }
  .draft-area::-webkit-scrollbar-thumb,
  .draft-card textarea::-webkit-scrollbar-thumb {
    background: #1f2937;
    border-radius: 999px;
    border: 2px solid #050505;
  }
  @media (max-width:680px) { .draft-area { grid-template-columns:1fr; } }

  .draft-card {
    display:flex; flex-direction:column;
    height:320px; overflow:hidden;
    border-radius:10px; border:1px solid rgba(255,255,255,0.16); background:#111;
  }
  .card-header {
    padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.12); flex-shrink:0;
  }
  .card-title { font-size:14px; font-weight:600; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .card-sub   { font-size:12px; color:#9ca3af; margin-top:2px; }
  .draft-card textarea {
    flex:1; resize:none; background:transparent; border:none; outline:none;
    padding:12px; font-size:13px; line-height:1.65; color:#e5e7eb; overflow-y:auto;
    font-family:'JetBrains Mono','Consolas',monospace;
  }
  .draft-card textarea::placeholder { color:#6b7280; }

  .empty {
    flex:1; display:flex; align-items:center; justify-content:center;
    font-size:14px; color:#9ca3af; padding:32px 20px;
  }

  /* Footer */
  .footer {
    display:grid; grid-template-columns:240px 1fr; gap:12px;
    padding:12px 20px 20px;
    border-top:1px solid rgba(255,255,255,0.08);
    background:#060606; flex-shrink:0;
  }
  .btn-back {
    display:inline-flex; align-items:center; justify-content:center; gap:6px;
    min-height:54px; border-radius:10px;
    border:1px solid rgba(255,255,255,0.2); background:#111; color:#d9dfeb;
    font-size:16px; font-weight:600; cursor:pointer;
    transition:border-color 150ms,background 150ms;
  }
  .btn-back:hover:not(:disabled) { border-color:rgba(250,204,21,0.45); background:#171717; }
  .btn-back:disabled { cursor:not-allowed; opacity:0.45; }

  .btn-download {
    display:inline-flex; align-items:center; justify-content:center; gap:8px;
    min-height:54px; border-radius:10px;
    border:1px solid #eab308; background:#facc15; color:#1b1400;
    font-size:16px; font-weight:600; cursor:pointer;
    box-shadow:6px 6px 0 rgba(250,204,21,0.18);
    transition:background 150ms;
  }
  .btn-download:hover:not(:disabled) { background:#fbbf24; }
  .btn-download:disabled { cursor:not-allowed; opacity:0.45; }

  .spin { animation:spin 0.8s linear infinite; display:inline-block; }
  @keyframes spin { to { transform:rotate(360deg); } }
`

// ---------------------------------------------------------------------------
// Format options
// ---------------------------------------------------------------------------

const FORMAT_OPTIONS: { id: PreviewDownloadFormat; label: string; sub: string }[] = [
  { id: "markdown", label: "Markdown", sub: ".md"   },
  { id: "text",     label: "Texto",    sub: ".txt"  },
  { id: "pdf",      label: "PDF",      sub: ".pdf"  },
  { id: "docx",     label: "Word",     sub: ".docx" },
]

function resolveFormatLabel(value: PreviewDownloadFormat): string {
  return FORMAT_OPTIONS.find((f) => f.id === value)?.label ?? value
}

function buildPreviewTextFromDraft(draft: PreviewDraftItem, format: PreviewDownloadFormat): string {
  const record: SourceExportRecord = {
    sourceId: draft.sourceId,
    sourceTitle: draft.sourceTitle,
    sourceUrl: draft.sourceUrl,
    sourceKind: draft.sourceKind,
    summaryText: draft.summaryText
  }

  if (format === "pdf") {
    return formatAsPdfText(record)
  }

  if (format === "markdown") {
    return formatAsMarkdown(record)
  }

  if (format === "docx") {
    return formatAsDocxText(record)
  }

  return formatAsText(record)
}

// ---------------------------------------------------------------------------
// Inner component
// ---------------------------------------------------------------------------

interface InnerProps {
  detail: SourcePreviewOpenDetail
  onClose: () => void
}

function PreviewInner({ detail, onClose }: InnerProps) {
  const { skippedCount, labels } = detail
  const [items, setItems] = useState<PreviewDraftItem[]>(detail.drafts)
  const [format, setFormat] = useState<PreviewDownloadFormat>(detail.format ?? "markdown")
  const [isDownloading, setIsDownloading] = useState(false)

  const handleChange = useCallback((sourceId: string, value: string) => {
    setItems((prev) =>
      prev.map((d) => d.sourceId === sourceId ? { ...d, editableContent: value } : d)
    )
  }, [])

  const handleDownload = useCallback(async () => {
    if (isDownloading || items.length === 0) return
    setIsDownloading(true)
    try {
      await detail.onDownload(items, format)
      onClose()
    } catch {
      // erro tratado pelo caller
    } finally {
      setIsDownloading(false)
    }
  }, [detail, format, isDownloading, items, onClose])

  // Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose() }
    }
    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
  }, [onClose])

  useEffect(() => {
    setItems((prev) =>
      prev.map((draft) => ({
        ...draft,
        editableContent: buildPreviewTextFromDraft(draft, format),
        previewFormat: format
      }))
    )
  }, [format])

  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])
  const formatLabel = resolveFormatLabel(format)

  return (
    <div
      className="overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pré-visualização"
        className="panel"
        onClick={stopProp}
        onMouseDown={stopProp}>

        {/* Header */}
        <header className="header">
          <div>
            <span className="badge">
              <span className="badge-dot" />
              {labels.previewLabTitle}
            </span>
            <p className="h-title">{labels.title}</p>
            <p className="h-sub">{labels.subtitle}</p>
          </div>
          <button className="close-btn" type="button" onClick={onClose}>✕</button>
        </header>

        {/* Format bar */}
        <div className="format-bar">
          {FORMAT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`fmt-btn${format === opt.id ? " active" : ""}`}
              onClick={() => setFormat(opt.id)}>
              <span className="fmt-label" translate={opt.id === "docx" ? "no" : undefined}>
                {opt.label}
              </span>
              <span className="fmt-sub" translate={opt.id === "docx" ? "no" : undefined}>
                {opt.sub}
              </span>
            </button>
          ))}
        </div>

        {/* Skipped */}
        {skippedCount > 0 && (
          <div className="skipped">{labels.skippedLabel}</div>
        )}

        {/* Drafts */}
        {items.length === 0
          ? <div className="empty">{labels.noPreview}</div>
          : (
            <div className="draft-area">
              {items.map((draft) => (
                <div key={draft.sourceId} className="draft-card">
                  <div className="card-header">
                    <div className="card-title" title={draft.sourceTitle}>{draft.sourceTitle}</div>
                    <div className="card-sub">
                      {draft.sourceKind === "youtube" ? labels.sourceKindYoutube : labels.sourceKindDocument}
                      {" | "}{resolveFormatLabel(draft.previewFormat ?? format)}
                    </div>
                  </div>
                  <textarea
                    value={draft.editableContent}
                    onChange={(e) => handleChange(draft.sourceId, e.target.value)}
                    placeholder={labels.previewTextareaPlaceholder}
                  />
                </div>
              ))}
            </div>
          )
        }

        {/* Footer */}
        <footer className="footer">
          <button
            type="button"
            className="btn-back"
            disabled={isDownloading}
            onClick={onClose}>
            {labels.backButton}
          </button>
          <button
            type="button"
            className="btn-download"
            disabled={isDownloading || items.length === 0}
            onClick={handleDownload}>
            {isDownloading
              ? <span className="spin">↻</span>
              : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              )
            }
            {isDownloading ? labels.downloadingButton : labels.downloadButton}
          </button>
        </footer>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Public component — mount ONCE in notebooklm-injector
// ---------------------------------------------------------------------------

export function SourcePreviewPanel() {
  const [detail, setDetail] = useState<SourcePreviewOpenDetail | null>(null)
  const { shadowRoot, injectCSS } = useShadowPortal("source-preview-panel", detail !== null)
  const cssInjectedRef = useRef(false)

  useEffect(() => {
    if (shadowRoot && !cssInjectedRef.current) {
      injectCSS(SHADOW_CSS)
      cssInjectedRef.current = true
    }
  }, [shadowRoot, injectCSS])

  useEffect(() => {
    const onOpen = (e: Event) => {
      const custom = e as CustomEvent<SourcePreviewOpenDetail>
      setDetail(custom.detail)
    }
    const onClose = () => setDetail(null)
    window.addEventListener(SOURCE_PREVIEW_OPEN_EVENT, onOpen)
    window.addEventListener(SOURCE_PREVIEW_CLOSE_EVENT, onClose)
    return () => {
      window.removeEventListener(SOURCE_PREVIEW_OPEN_EVENT, onOpen)
      window.removeEventListener(SOURCE_PREVIEW_CLOSE_EVENT, onClose)
    }
  }, [])


  if (!shadowRoot || !detail) return null

  const handleClose = () => {
    setDetail(null)
    window.dispatchEvent(new CustomEvent(SOURCE_PREVIEW_CLOSE_EVENT))
  }

  return ReactDOM.createPortal(
    <PreviewInner detail={detail} onClose={handleClose} />,
    shadowRoot
  )
}
