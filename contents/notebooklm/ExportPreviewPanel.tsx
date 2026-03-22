/**
 * ExportPreviewPanel
 *
 * Modal de pre-visualizacao do Estudio.
 * Migrado de Shadow DOM + useShadowPortal para portal normal + CSS escopado
 * para corrigir o bug de insertBefore do React reconciler dentro de Shadow roots.
 */

import { useEffect, useRef, useState } from "react"
import * as ReactDOM from "react-dom"
import { useMindDockPortal } from "./useMindDockPortal"

// --- Constantes de evento ---------------------------------------------------
export const EXPORT_PREVIEW_OPEN_EVENT = "minddock:export-preview:open"
export const EXPORT_PREVIEW_CLOSE_EVENT = "minddock:export-preview:close"
export const EXPORT_PREVIEW_UPDATE_EVENT = "minddock:export-preview:update"

let previewRenderLogged = false

// --- Tipos ------------------------------------------------------------------
export type ExportPreviewFormat = "markdown" | "text" | "pdf" | "docx"

export interface ExportPreviewItem {
  id: string
  title: string
  subtitle: string
  content: string
}

export interface ExportFormatOption {
  id: ExportPreviewFormat
  label: string
  sub: string
  noTranslate?: boolean
}

export interface ExportPreviewOpenDetail {
  items: ExportPreviewItem[]
  format: ExportPreviewFormat
  formatOptions: ExportFormatOption[]
  onChangeFormat?: (id: ExportPreviewFormat) => void
  onChangeItem?: (id: string, content: string) => void
  onRequestExport?: (format?: ExportPreviewFormat) => void
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

// --- CSS escopado (sem Shadow DOM) ------------------------------------------
const EXPORT_CSS = `
.minddock-export, .minddock-export *, .minddock-export *::before, .minddock-export *::after {
  box-sizing: border-box; margin: 0; padding: 0;
}
.minddock-export { font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; }

.minddock-export.overlay {
  position: fixed; inset: 0; z-index: 2147483647;
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  background: rgba(0,0,0,0.92);
  overscroll-behavior: contain;
  pointer-events: auto;
  animation: minddock-fadeIn 180ms ease;
}
@keyframes minddock-fadeIn { from { opacity:0 } to { opacity:1 } }

.minddock-export .panel {
  position: relative;
  display: flex; flex-direction: column;
  width: 100%; max-width: 960px; max-height: 88vh;
  overflow: hidden;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.14);
  background: #000; color: #e2e6ee;
  box-shadow: 0 18px 48px rgba(0,0,0,0.56);
  animation: minddock-slideUp 200ms cubic-bezier(0.16,1,0.3,1);
  overscroll-behavior: contain;
}
@keyframes minddock-slideUp {
  from { opacity:0; margin-top:10px }
  to   { opacity:1; margin-top:0 }
}
.minddock-export .panel::before {
  content:''; position:absolute; inset-x:0; top:0;
  height:1px; background:rgba(255,255,255,0.16);
  border-radius:14px 14px 0 0; pointer-events:none;
}

/* Header */
.minddock-export .header {
  display:flex; align-items:flex-start; justify-content:space-between; gap:16px;
  padding:16px 20px;
  border-bottom:1px solid rgba(255,255,255,0.12);
  background:#060606; flex-shrink:0;
}
.minddock-export .badge {
  display:inline-flex; align-items:center; gap:6px;
  border-radius:6px; border:1px solid rgba(255,255,255,0.16);
  background:#0b0b0b; padding:3px 8px;
  font-size:10px; font-weight:700; text-transform:uppercase;
  letter-spacing:0.08em; color:#b7c0cf;
}
.minddock-export .badge-dot { width:7px; height:7px; border-radius:50%; background:#facc15; flex-shrink:0; }
.minddock-export .h-title { font-size:28px; font-weight:600; color:#fff; margin-top:8px; line-height:1; }
.minddock-export .h-sub   { font-size:13px; color:#9da7b8; margin-top:6px; line-height:1.6; }
.minddock-export .close-btn {
  flex-shrink:0; display:inline-flex; align-items:center; justify-content:center;
  width:40px; height:40px; border-radius:8px;
  border:1px solid rgba(255,255,255,0.2); background:#0a0a0a; color:#a9b2c1;
  cursor:pointer; font-size:16px;
  transition:border-color 150ms,background 150ms,color 150ms;
}
.minddock-export .close-btn:hover { border-color:rgba(250,204,21,0.55); background:#151209; color:#facc15; }

/* Format bar */
.minddock-export .format-bar {
  display:grid; grid-template-columns:repeat(4,1fr); gap:8px;
  margin:12px 20px 0;
  border-radius:10px; border:1px solid rgba(255,255,255,0.16);
  background:#0c0c0c; padding:10px;
  flex-shrink:0;
}
@media (max-width:600px) { .minddock-export .format-bar { grid-template-columns:repeat(2,1fr); } }
.minddock-export .fmt-btn {
  display:flex; flex-direction:column; justify-content:center; gap:2px;
  min-height:50px; border-radius:8px;
  border:1px solid rgba(255,255,255,0.16); background:#111; color:#c8d1de;
  padding:8px 10px; cursor:pointer;
  transition:border-color 150ms,background 150ms,color 150ms;
}
.minddock-export .fmt-btn:hover { border-color:rgba(250,204,21,0.35); background:#161616; }
.minddock-export .fmt-btn.active { border-color:#facc15; background:#facc15; color:#131002; }
.minddock-export .fmt-label { font-size:14px; font-weight:600; line-height:1; }
.minddock-export .fmt-sub   { font-size:11px; opacity:0.85; line-height:1.2; }

/* Draft grid */
.minddock-export .draft-area {
  flex:1; min-height:0; overflow-y:auto;
  display:grid; grid-template-columns:repeat(2,1fr);
  gap:16px; padding:12px 20px;
}
.minddock-export .draft-area,
.minddock-export .draft-card textarea {
  scrollbar-color: #1f2937 #050505;
  scrollbar-width: thin;
}
.minddock-export .draft-area::-webkit-scrollbar,
.minddock-export .draft-card textarea::-webkit-scrollbar { width: 10px; }
.minddock-export .draft-area::-webkit-scrollbar-track,
.minddock-export .draft-card textarea::-webkit-scrollbar-track { background: #050505; }
.minddock-export .draft-area::-webkit-scrollbar-thumb,
.minddock-export .draft-card textarea::-webkit-scrollbar-thumb {
  background: #1f2937;
  border-radius: 999px;
  border: 2px solid #050505;
}
@media (max-width:680px) { .minddock-export .draft-area { grid-template-columns:1fr; } }

.minddock-export .draft-card {
  display:flex; flex-direction:column;
  height:320px; overflow:hidden;
  border-radius:10px; border:1px solid rgba(255,255,255,0.16); background:#111;
}
.minddock-export .card-header {
  padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.12); flex-shrink:0;
}
.minddock-export .card-title { font-size:14px; font-weight:600; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.minddock-export .card-sub   { font-size:12px; color:#9ca3af; margin-top:2px; }
.minddock-export .draft-card textarea {
  flex:1; resize:none; background:transparent; border:none; outline:none;
  padding:12px; font-size:13px; line-height:1.65; color:#e5e7eb; overflow-y:auto;
  font-family:'JetBrains Mono','Consolas',monospace;
}
.minddock-export .draft-card textarea::placeholder { color:#6b7280; }

.minddock-export .empty {
  flex:1; display:flex; align-items:center; justify-content:center;
  font-size:14px; color:#9ca3af; padding:32px 20px;
}

/* Footer */
.minddock-export .footer {
  display:grid; grid-template-columns:240px 1fr; gap:12px;
  padding:12px 20px 20px;
  border-top:1px solid rgba(255,255,255,0.08);
  background:#060606; flex-shrink:0;
}
.minddock-export .btn-back {
  display:inline-flex; align-items:center; justify-content:center; gap:6px;
  min-height:54px; border-radius:10px;
  border:1px solid rgba(255,255,255,0.2); background:#111; color:#d9dfeb;
  font-size:16px; font-weight:600; cursor:pointer;
  transition:border-color 150ms,background 150ms;
}
.minddock-export .btn-back:hover:not(:disabled) { border-color:rgba(250,204,21,0.45); background:#171717; }
.minddock-export .btn-back:disabled { cursor:not-allowed; opacity:0.45; }
.minddock-export .btn-download {
  display:inline-flex; align-items:center; justify-content:center; gap:8px;
  min-height:54px; border-radius:10px;
  border:1px solid #eab308; background:#facc15; color:#1b1400;
  font-size:16px; font-weight:600; cursor:pointer;
  box-shadow:6px 6px 0 rgba(250,204,21,0.18);
  transition:background 150ms;
}
.minddock-export .btn-download:hover:not(:disabled) { background:#fbbf24; }
.minddock-export .btn-download:disabled { cursor:not-allowed; opacity:0.45; }
.minddock-export .spin { animation:minddock-spin 0.8s linear infinite; display:inline-block; }
@keyframes minddock-spin { to { transform:rotate(360deg); } }
`

// --- Injeta o CSS no <head> uma unica vez -----------------------------------
function injectExportCSS() {
  if (document.getElementById("minddock-export-styles")) return
  const style = document.createElement("style")
  style.id = "minddock-export-styles"
  style.textContent = EXPORT_CSS
  document.head.appendChild(style)
}

// --- PreviewCardItem ---------------------------------------------------------
interface PreviewCardItemProps {
  id: string
  title: string
  subtitle: string
  content: string
  activeFormatLabel: string
  placeholder: string
  onChangeItem?: (id: string, content: string) => void
}

function PreviewCardItem({
  id,
  title,
  subtitle,
  content,
  activeFormatLabel,
  placeholder,
  onChangeItem
}: PreviewCardItemProps) {
  if (!previewRenderLogged) {
    previewRenderLogged = true
    console.log("[studioModal] render", {
      id,
      title,
      hasContent: !!content,
      contentPreview: typeof content === "string" ? content.slice(0, 80) : content
    })
  }
  return (
    <div className="draft-card">
      <div className="card-header">
        <div className="card-title">{title}</div>
        <div className="card-sub">
          <span>{subtitle}</span>
          {activeFormatLabel ? <span> | {activeFormatLabel}</span> : null}
        </div>
      </div>
      <textarea
        placeholder={placeholder}
        value={content}
        onChange={(e) => onChangeItem?.(id, e.target.value)}
      />
    </div>
  )
}

// --- Componente principal ----------------------------------------------------
export function ExportPreviewPanel() {
  const [detail, setDetail] = useState<ExportPreviewOpenDetail | null>(null)
  const container = useMindDockPortal("export-preview-panel", 2147483647)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    injectExportCSS()
  }, [])

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
    const onUpdate = (event: Event) => {
      const custom = event as CustomEvent<{ isExporting: boolean }>
      setDetail((prev) => (prev ? { ...prev, isExporting: custom.detail.isExporting } : prev))
    }
    window.addEventListener(EXPORT_PREVIEW_UPDATE_EVENT, onUpdate)
    return () => window.removeEventListener(EXPORT_PREVIEW_UPDATE_EVENT, onUpdate)
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

  const handleClose = () => {
    window.dispatchEvent(new CustomEvent(EXPORT_PREVIEW_CLOSE_EVENT))
  }

  const stopProp = (e: React.MouseEvent) => e.stopPropagation()

  const handleFormatClick = (nextFormat: ExportPreviewFormat) => {
    if (!detail) {
      return
    }
    detail.onChangeFormat?.(nextFormat)
    setDetail((prev) => (prev ? { ...prev, format: nextFormat } : prev))
  }

  const handleExportClick = () => {
    if (!detail) {
      return
    }
    if (detail.onRequestExport) {
      detail.onRequestExport(detail.format)
      return
    }
    handleClose()
  }

  const activeFormatLabel =
    detail?.formatOptions.find((o) => o.id === detail.format)?.label ?? ""

  if (!detail || !container) return null

  return ReactDOM.createPortal(
    <div
      className="minddock-export overlay"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}>
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
                onClick={() => handleFormatClick(opt.id)}>
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
            onClick={handleExportClick}>
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
    container
  )
}
