/**
 * StudioPreviewPanel
 *
 * Preview modal for Studio exports, mounted independently from the main modal.
 * Communicates via custom events (same pattern as SourcePreviewPanel).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import * as ReactDOM from "react-dom"
import { useShadowPortal } from "./useShadowPortal"

// ---------------------------------------------------------------------------
// Public events
// ---------------------------------------------------------------------------

export const STUDIO_PREVIEW_OPEN_EVENT = "minddock:studio-preview:open"
export const STUDIO_PREVIEW_CLOSE_EVENT = "minddock:studio-preview:close"

export type StudioPreviewFormat = "markdown" | "text" | "pdf" | "docx"

export interface StudioPreviewDraftItem {
  entryId: string
  title: string
  meta?: string
  kind?: "text" | "asset"
  content?: string
  index: number
  editableContent: string
  previewFormat?: StudioPreviewFormat
}

export interface StudioPreviewOpenDetail {
  drafts: StudioPreviewDraftItem[]
  format: StudioPreviewFormat
  onExport: (items: StudioPreviewDraftItem[], format: StudioPreviewFormat) => Promise<void>
  labels: {
    previewLabTitle: string
    title: string
    subtitle: string
    emptyState: string
    backButton: string
    exportButton: string
    exportingButton: string
    assetPlaceholder: string
  }
}

// ---------------------------------------------------------------------------
// CSS (isolated in Shadow DOM)
// ---------------------------------------------------------------------------

const SHADOW_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :host { all: initial; font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; }

  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    pointer-events: auto;
  }
  .overlay-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0,0,0,0.88);
    backdrop-filter: blur(1px);
    -webkit-backdrop-filter: blur(1px);
    pointer-events: auto;
  }

  .panel {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 920px;
    max-height: 88vh;
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.14);
    background: #000;
    color: #e2e6ee;
    box-shadow: 0 18px 48px rgba(0,0,0,0.56);
    pointer-events: auto;
  }
  .panel::before {
    content: '';
    position: absolute;
    inset-x: 0; top: 0;
    height: 1px;
    background: rgba(255,255,255,0.16);
    border-radius: 14px 14px 0 0;
  }

  .inner { position: relative; z-index: 1; display: flex; flex: 1; flex-direction: column; min-height: 0; }

  .header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255,255,255,0.12);
    background: #060606;
    flex-shrink: 0;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.16);
    background: #0b0b0b;
    padding: 3px 8px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #b7c0cf;
  }
  .badge-dot { width: 7px; height: 7px; border-radius: 50%; background: #facc15; flex-shrink: 0; }

  .title { font-size: 28px; font-weight: 600; color: #fff; margin-top: 8px; line-height: 1; }
  .subtitle { font-size: 13px; color: #9da7b8; margin-top: 6px; max-width: 640px; line-height: 1.6; }

  .close-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px; height: 40px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.2);
    background: #0a0a0a;
    color: #a9b2c1;
    cursor: pointer;
    font-size: 16px;
    transition: border-color 150ms, background 150ms, color 150ms;
  }
  .close-btn:hover { border-color: rgba(250,204,21,0.55); background: #151209; color: #facc15; }

  .body { padding: 12px 20px 8px; flex-shrink: 0; }

  .format-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.16);
    background: #0c0c0c;
    padding: 10px;
    margin-top: 12px;
  }
  .format-grid.mt-0 { margin-top: 0; }
  @media (max-width: 700px) { .format-grid { grid-template-columns: repeat(2, 1fr); } }

  .fmt-btn {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    min-height: 50px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.16);
    background: #111;
    color: #c8d1de;
    padding: 8px 10px;
    text-align: left;
    cursor: pointer;
    transition: border-color 150ms, background 150ms, color 150ms;
  }
  .fmt-btn:hover { border-color: rgba(250,204,21,0.35); background: #161616; }
  .fmt-btn.active { border-color: #facc15; background: #facc15; color: #131002; }
  .fmt-btn-label { font-size: 14px; font-weight: 600; line-height: 1; }
  .fmt-btn-sub { font-size: 11px; line-height: 1.2; opacity: 0.85; }

  .preview-list {
    margin: 8px 20px 0;
    min-height: 320px;
    max-height: 420px;
    overflow-y: auto;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.16);
    background: #0c0c0c;
    padding: 10px;
    scrollbar-color: #1f2937 #050505;
    scrollbar-width: thin;
  }
  .preview-list::-webkit-scrollbar { width: 10px; }
  .preview-list::-webkit-scrollbar-track { background: #050505; }
  .preview-list::-webkit-scrollbar-thumb {
    background: #1f2937;
    border-radius: 999px;
    border: 2px solid #050505;
  }
  .preview-empty { padding: 24px 12px; font-size: 14px; color: #9ca3af; }
  .preview-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 600px) { .preview-grid { grid-template-columns: 1fr; } }
  .preview-card {
    display: flex;
    flex-direction: column;
    height: 320px;
    overflow: hidden;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.16);
    background: #111;
  }
  .preview-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.12);
    flex-shrink: 0;
  }
  .preview-card-title { font-size: 14px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .preview-card-sub { font-size: 12px; color: #9ca3af; }
  .preview-card textarea {
    flex: 1;
    resize: none;
    background: transparent;
    border: none;
    outline: none;
    padding: 12px;
    font-size: 13px;
    line-height: 1.6;
    color: #e5e7eb;
    overflow-y: auto;
  }
  .preview-card textarea::placeholder { color: #6b7280; }

  .error-banner {
    margin-bottom: 8px;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid rgba(248,113,113,0.4);
    background: rgba(127,29,29,0.3);
    font-size: 12px;
    color: #fecaca;
  }

  .footer {
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: 12px;
    padding: 12px 20px 20px;
    flex-shrink: 0;
    margin-top: 12px;
  }

  .btn-ghost {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 54px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.2);
    background: #111;
    color: #d9dfeb;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 150ms, background 150ms;
  }
  .btn-ghost:hover:not(:disabled) { border-color: rgba(250,204,21,0.45); background: #171717; }
  .btn-ghost:disabled { cursor: not-allowed; opacity: 0.45; }

  .btn-primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 54px;
    border-radius: 10px;
    border: 1px solid #eab308;
    background: #facc15;
    color: #1b1400;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 6px 6px 0 rgba(250,204,21,0.18);
    transition: background 150ms;
  }
  .btn-primary:hover:not(:disabled) { background: #fbbf24; }
  .btn-primary:disabled { cursor: not-allowed; opacity: 0.45; }

  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
`

const FORMAT_OPTIONS: Array<{ id: StudioPreviewFormat; label: string; sub: string; noTranslate?: boolean }> = [
  { id: "markdown", label: "Markdown", sub: ".md" },
  { id: "text", label: "Texto simples", sub: ".txt" },
  { id: "pdf", label: "PDF", sub: ".pdf" },
  { id: "docx", label: "Word", sub: ".docx", noTranslate: true }
]

function resolveFormatLabel(format: StudioPreviewFormat): string {
  return FORMAT_OPTIONS.find((opt) => opt.id === format)?.label ?? "Formato"
}

function buildPreviewTextFromDraft(draft: StudioPreviewDraftItem, format: StudioPreviewFormat): string {
  if (draft.kind === "asset") {
    return draft.editableContent
  }

  const lines: string[] = []
  if (format === "markdown") {
    lines.push(`## ${draft.index + 1}. ${draft.title}`)
    if (draft.meta) {
      lines.push(`_${draft.meta}_`)
    }
  } else {
    lines.push(`${draft.index + 1}. ${draft.title}`)
    if (draft.meta) {
      lines.push(draft.meta)
    }
  }
  if (draft.content) {
    lines.push("")
    lines.push(draft.content)
  }
  return lines.join("\n").trim()
}

// ---------------------------------------------------------------------------
// Inner component
// ---------------------------------------------------------------------------

interface InnerProps {
  detail: StudioPreviewOpenDetail
  onClose: () => void
}

function PreviewInner({ detail, onClose }: InnerProps) {
  const { labels } = detail
  const [items, setItems] = useState<StudioPreviewDraftItem[]>(detail.drafts)
  const [format, setFormat] = useState<StudioPreviewFormat>(detail.format ?? "markdown")
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleChange = useCallback((entryId: string, value: string) => {
    setItems((prev) =>
      prev.map((d) => d.entryId === entryId ? { ...d, editableContent: value } : d)
    )
  }, [])

  const handleExport = useCallback(async () => {
    if (isExporting) return
    setIsExporting(true)
    setError(null)
    try {
      await detail.onExport(items, format)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao exportar.")
    } finally {
      setIsExporting(false)
    }
  }, [detail, format, isExporting, items, onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        onClose()
      }
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
    <div className="overlay">
      <div className="overlay-backdrop" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pre-visualizacao do Estudio"
        className="panel"
        onClick={stopProp}
        onMouseDown={stopProp}>
        <div className="inner">
          <header className="header">
            <div>
              <span className="badge">
                <span className="badge-dot" />
                {labels.previewLabTitle}
              </span>
              <p className="title">{labels.title}</p>
              <p className="subtitle">{labels.subtitle}</p>
            </div>
            <button className="close-btn" type="button" onClick={onClose}>X</button>
          </header>

          <div className="body">
            <div className="format-grid mt-0">
              {FORMAT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`fmt-btn${format === opt.id ? " active" : ""}`}
                  onClick={() => setFormat(opt.id)}>
                  <span className="fmt-btn-label" translate={opt.noTranslate ? "no" : undefined}>
                    {opt.label}
                  </span>
                  <span className="fmt-btn-sub" translate={opt.noTranslate ? "no" : undefined}>
                    {opt.sub}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="preview-list">
            {error ? <div className="error-banner">{error}</div> : null}
            {items.length === 0 ? (
              <div className="preview-empty">{labels.emptyState}</div>
            ) : (
              <div className="preview-grid">
                {items.map((draft) => {
                  const subLabel = draft.meta ? `${formatLabel} | ${draft.meta}` : formatLabel
                  const isAsset = draft.kind === "asset"
                  return (
                    <div key={draft.entryId} className="preview-card">
                      <div className="preview-card-header">
                        <div style={{ minWidth: 0 }}>
                          <div className="preview-card-title">{draft.title}</div>
                          <div className="preview-card-sub">{subLabel}</div>
                        </div>
                      </div>
                      <textarea
                        value={draft.editableContent}
                        onChange={(event) => handleChange(draft.entryId, event.target.value)}
                        placeholder={isAsset ? labels.assetPlaceholder : undefined}
                        spellCheck={false}
                        disabled={isAsset}
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <footer className="footer">
            <button
              type="button"
              className="btn-ghost"
              onClick={onClose}
              disabled={isExporting}>
              {labels.backButton}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleExport}
              disabled={isExporting || items.length === 0}>
              {isExporting ? <span className="spin">↻</span> : null}
              {isExporting ? labels.exportingButton : labels.exportButton}
            </button>
          </footer>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Public component — mounted once in notebooklm-injector
// ---------------------------------------------------------------------------

export function StudioPreviewPanel() {
  const [detail, setDetail] = useState<StudioPreviewOpenDetail | null>(null)
  const { shadowRoot, injectCSS } = useShadowPortal("studio-preview-panel", detail !== null)
  const cssInjectedRef = useRef(false)

  useEffect(() => {
    if (shadowRoot && !cssInjectedRef.current) {
      injectCSS(SHADOW_CSS)
      cssInjectedRef.current = true
    }
  }, [shadowRoot, injectCSS])

  useEffect(() => {
    const onOpen = (e: Event) => {
      const custom = e as CustomEvent<StudioPreviewOpenDetail>
      setDetail(custom.detail)
    }
    const onClose = () => setDetail(null)
    window.addEventListener(STUDIO_PREVIEW_OPEN_EVENT, onOpen)
    window.addEventListener(STUDIO_PREVIEW_CLOSE_EVENT, onClose)
    return () => {
      window.removeEventListener(STUDIO_PREVIEW_OPEN_EVENT, onOpen)
      window.removeEventListener(STUDIO_PREVIEW_CLOSE_EVENT, onClose)
    }
  }, [])

  if (!shadowRoot || !detail) return null

  const handleClose = () => {
    setDetail(null)
    window.dispatchEvent(new CustomEvent(STUDIO_PREVIEW_CLOSE_EVENT))
  }

  return ReactDOM.createPortal(<PreviewInner detail={detail} onClose={handleClose} />, shadowRoot)
}
