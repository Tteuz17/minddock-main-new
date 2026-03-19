/**
 * ExportPreviewPanel
 *
 * Clone estrutural do SourcePreviewPanel, com miolo substituido pelo ExportModalViewer.
 * Comunicacao via eventos customizados (open/close) para evitar acoplamento com o DOM do host.
 */

import React, { useCallback, useEffect, useRef, useState } from "react"
import * as ReactDOM from "react-dom"
import { useShadowPortal } from "./useShadowPortal"

// ---------------------------------------------------------------------------
// Eventos publicos
// ---------------------------------------------------------------------------

export const EXPORT_PREVIEW_OPEN_EVENT = "minddock:export-preview:open"
export const EXPORT_PREVIEW_CLOSE_EVENT = "minddock:export-preview:close"

export type ExportPreviewFormat = "markdown" | "text" | "pdf" | "docx"

export interface ExportPreviewCardItem {
  id: string
  title: string
  subtitle: string
  content: string
}

export interface ExportPreviewOpenDetail {
  items: ExportPreviewCardItem[]
  format: ExportPreviewFormat
  formatOptions: Array<{ id: ExportPreviewFormat; label: string; sub: string; noTranslate?: boolean }>
  onChangeFormat?: (format: ExportPreviewFormat) => void
  onChangeItem?: (id: string, nextContent: string) => void
  onRequestExport?: () => void
  isExporting?: boolean
  labels: {
    previewLabTitle: string
    title: string
    subtitle: string
    previewTextareaPlaceholder: string
    noPreview: string
    backButton: string
    exportButton: string
    exportingButton: string
  }
}

type PreviewCardItemProps = {
  id: string
  title: string
  subtitle: string
  content: string
  activeFormatLabel: string
  placeholder: string
  onChangeItem?: (id: string, nextContent: string) => void
}

const PreviewCardItem = React.memo(function PreviewCardItem({
  id,
  title,
  subtitle,
  content,
  activeFormatLabel,
  placeholder,
  onChangeItem
}: PreviewCardItemProps) {
  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChangeItem?.(id, event.target.value)
    },
    [id, onChangeItem]
  )

  return (
    <div className="draft-card">
      <div className="card-header">
        <div className="card-title" title={title}>
          <span>{title}</span>
        </div>
        <div className="card-sub">
          <span>{subtitle}</span>
          <span> | </span>
          <span>{activeFormatLabel}</span>
        </div>
      </div>
      <textarea
        value={content}
        onChange={handleChange}
        placeholder={placeholder}
      />
    </div>
  )
})

const SHADOW_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :host { all: initial; font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; }

  .overlay {
    position: fixed; inset: 0; z-index: 2147483647;
    display: flex; align-items: center; justify-content: center;
    padding: 16px;
    background: rgba(0,0,0,0.88);
    backdrop-filter: blur(1px);
    overscroll-behavior: contain;
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
    overscroll-behavior: contain;
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

  /* Draft grid */
  .draft-area {
    flex:1; min-height:0; overflow-y:auto;
    display:grid; grid-template-columns:repeat(2,1fr);
    gap:16px; padding:12px 20px;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
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
    overscroll-behavior: contain;
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

export function ExportPreviewPanel() {
  const [detail, setDetail] = useState<ExportPreviewOpenDetail | null>(null)
  const { shadowRoot, injectCSS } = useShadowPortal("export-preview-panel", detail !== null, 2147483647)
  const cssInjectedRef = useRef(false)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (shadowRoot && !cssInjectedRef.current) {
      injectCSS(SHADOW_CSS)
      cssInjectedRef.current = true
    }
  }, [shadowRoot, injectCSS])

  useEffect(() => {
    const onOpen = (event: Event) => {
      const custom = event as CustomEvent<ExportPreviewOpenDetail>
      setDetail(custom.detail)
    }
    const onClose = () => setDetail(null)
    window.addEventListener(EXPORT_PREVIEW_OPEN_EVENT, onOpen)
    window.addEventListener(EXPORT_PREVIEW_CLOSE_EVENT, onClose)
    return () => {
      window.removeEventListener(EXPORT_PREVIEW_OPEN_EVENT, onOpen)
      window.removeEventListener(EXPORT_PREVIEW_CLOSE_EVENT, onClose)
    }
  }, [])

  useEffect(() => {
    if (!detail) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        window.dispatchEvent(new CustomEvent(EXPORT_PREVIEW_CLOSE_EVENT))
      }
    }
    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
  }, [detail])


  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const handleWheelCapture = useCallback((event: React.WheelEvent) => {
    const panel = panelRef.current
    if (!panel) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const target = event.target as HTMLElement | null
    if (!target || !panel.contains(target)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }

    const deltaY = event.deltaY
    if (deltaY === 0) {
      return
    }

    let el: HTMLElement | null = target
    while (el && el !== panel) {
      const style = window.getComputedStyle(el)
      const overflowY = style.overflowY
      const isScrollable =
        (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
        el.scrollHeight > el.clientHeight + 1
      if (isScrollable) {
        const canScrollDown = el.scrollTop + el.clientHeight < el.scrollHeight - 1
        const canScrollUp = el.scrollTop > 0
        if ((deltaY > 0 && canScrollDown) || (deltaY < 0 && canScrollUp)) {
          return
        }
      }
      el = el.parentElement
    }

    event.preventDefault()
    event.stopPropagation()
  }, [])

  if (!shadowRoot || !detail) return null

  const handleClose = () => {
    setDetail(null)
    window.dispatchEvent(new CustomEvent(EXPORT_PREVIEW_CLOSE_EVENT))
  }

  const activeFormatLabel =
    detail.formatOptions.find((opt) => opt.id === detail.format)?.label ?? detail.format

  return ReactDOM.createPortal(
    <div
      className="overlay"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
      onWheelCapture={handleWheelCapture}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pre-visualizacao do Estudio"
        className="panel"
        ref={panelRef}
        onClick={stopProp}
        onMouseDown={stopProp}>
        <header className="header">
          <div>
            <span className="badge">
              <span className="badge-dot" />
              {detail.labels.previewLabTitle}
            </span>
            <p className="h-title">{detail.labels.title}</p>
            <p className="h-sub">{detail.labels.subtitle}</p>
          </div>
          <button className="close-btn" type="button" aria-label="Fechar" onClick={handleClose}>
            X
          </button>
        </header>

        <div className="format-bar">
          {detail.formatOptions.map((opt) => {
            const isActive = opt.id === detail.format
            return (
              <button
                key={opt.id}
                type="button"
                className={`fmt-btn${isActive ? " active" : ""}`}
                onClick={() => detail.onChangeFormat?.(opt.id)}>
                <span className="fmt-label" translate={opt.noTranslate ? "no" : undefined}>
                  {opt.label}
                </span>
                <span className="fmt-sub" translate={opt.noTranslate ? "no" : undefined}>
                  {opt.sub}
                </span>
              </button>
            )
          })}
        </div>

        {detail.items.length === 0 ? (
          <div className="empty">{detail.labels.noPreview}</div>
        ) : (
          <div className="draft-area">
            {detail.items.map((item) => (
              <PreviewCardItem
                key={item.id}
                id={item.id}
                title={item.title}
                subtitle={item.subtitle}
                content={item.content}
                activeFormatLabel={activeFormatLabel}
                placeholder={detail.labels.previewTextareaPlaceholder}
                onChangeItem={detail.onChangeItem}
              />
            ))}
          </div>
        )}

        <footer className="footer">
          <button
            type="button"
            className="btn-back"
            disabled={detail.isExporting}
            onClick={handleClose}>
            {detail.labels.backButton}
          </button>
          <button
            type="button"
            className="btn-download"
            disabled={detail.isExporting || detail.items.length === 0}
            onClick={detail.onRequestExport ?? handleClose}>
            {detail.isExporting ? <span className="spin">↻</span> : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            )}
            {detail.isExporting ? detail.labels.exportingButton : detail.labels.exportButton}
          </button>
        </footer>
      </div>
    </div>,
    shadowRoot
  )
}
