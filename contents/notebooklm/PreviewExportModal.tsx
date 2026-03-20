/**
 * PreviewExportModal - versao isolada com Shadow DOM
 *
 * Usa Shadow DOM + container proprio no document.body para evitar
 * interferencia do DOM do NotebookLM.
 */

import { useCallback, useEffect, useRef, type ComponentType } from "react"
import * as ReactDOM from "react-dom"
import { Download, Loader2, X } from "lucide-react"
import { useShadowPortal } from "./useShadowPortal"

// ---------------------------------------------------------------------------
// Tipos (copiados do ConversationExportMenu.tsx)
// ---------------------------------------------------------------------------

export type ExportFormat = "markdown" | "html" | "text" | "word" | "epub" | "pdf" | "json"

export interface ModalPreviewRenderState {
  mode: "html" | "text"
  html: string
  text: string
  error?: string
}

export interface FormatOption {
  id: ExportFormat
  label: string
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
}

export interface PreviewExportModalProps {
  title: string
  generatedAtIso: string
  format: ExportFormat
  text: string
  renderState: ModalPreviewRenderState
  busy: boolean
  formatOptions: readonly FormatOption[]
  onTextChange: (value: string) => void
  onChangeFormat: (format: ExportFormat) => void
  onClose: () => void
  onReset: () => void
  onExport: () => void
  formatExportTimestamp: (iso: string) => string
}

// ---------------------------------------------------------------------------
// CSS injetado no Shadow DOM - completamente isolado do NotebookLM
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
    background: rgba(0,0,0,0.88);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
    pointer-events: auto;
  }

  .panel {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 1100px;
    max-height: 88vh;
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.14);
    background: #000;
    color: #e2e6ee;
    box-shadow: 0 18px 48px rgba(0,0,0,0.56);
  }

  .panel::before {
    content: '';
    position: absolute;
    inset-x: 0; top: 0;
    height: 1px;
    background: rgba(255,255,255,0.16);
    border-radius: 14px 14px 0 0;
  }

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

  .badge-dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    background: #facc15;
    flex-shrink: 0;
  }

  .title { font-size: 28px; font-weight: 600; color: #fff; margin-top: 8px; line-height: 1; }
  .subtitle { font-size: 13px; color: #9da7b8; margin-top: 6px; }

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

  .body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    padding: 12px 20px 8px;
  }

  .format-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.16);
    background: #0c0c0c;
    padding: 10px;
    flex-shrink: 0;
  }

  .fmt-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.16);
    background: #111;
    color: #c8d1de;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 150ms, background 150ms, color 150ms;
    white-space: nowrap;
  }
  .fmt-btn:hover { border-color: rgba(250,204,21,0.35); background: #161616; }
  .fmt-btn.active { border-color: #facc15; background: #facc15; color: #131002; }

  .editor-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    flex: 1;
    min-height: 0;
    margin-top: 12px;
  }

  @media (max-width: 700px) {
    .editor-grid { grid-template-columns: 1fr; }
  }

  .pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.12);
    background: #0a0a0a;
    overflow: hidden;
  }

  .pane-label {
    flex-shrink: 0;
    padding: 8px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    font-size: 12px;
    font-weight: 600;
    color: #b7c0cf;
  }

  textarea {
    flex: 1;
    resize: none;
    background: transparent;
    border: none;
    outline: none;
    padding: 12px;
    font-size: 13px;
    line-height: 1.6;
    color: #e5e7eb;
    font-family: 'JetBrains Mono', 'Consolas', monospace;
    overflow-y: auto;
  }
  textarea,
  .preview-body {
    scrollbar-color: #1f2937 #050505;
    scrollbar-width: thin;
  }
  textarea::-webkit-scrollbar,
  .preview-body::-webkit-scrollbar { width: 10px; }
  textarea::-webkit-scrollbar-track,
  .preview-body::-webkit-scrollbar-track { background: #050505; }
  textarea::-webkit-scrollbar-thumb,
  .preview-body::-webkit-scrollbar-thumb {
    background: #1f2937;
    border-radius: 999px;
    border: 2px solid #050505;
  }

  .preview-body {
    flex: 1;
    overflow: auto;
    padding: 12px;
    font-size: 13px;
    line-height: 1.6;
    color: #e5e7eb;
  }

  .preview-body pre {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .preview-body.preview-plain pre {
    background: transparent;
    padding: 0;
  }
  .preview-body.preview-plain code {
    background: transparent;
  }

  .error-banner {
    margin-bottom: 8px;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid rgba(248,113,113,0.4);
    background: rgba(127,29,29,0.3);
    font-size: 12px;
    color: #fecaca;
  }

  .preview-body h1 { font-size: 22px; margin: 0 0 10px; }
  .preview-body h2 { font-size: 18px; margin: 12px 0 8px; }
  .preview-body h3 { font-size: 15px; margin: 10px 0 6px; }
  .preview-body p  { margin: 0 0 8px; }
  .preview-body ul { padding-left: 20px; margin: 0 0 8px; }
  .preview-body li { margin: 4px 0; }
  .preview-body code {
    border-radius: 4px;
    background: #162238;
    padding: 1px 4px;
  }
  .preview-body pre {
    border-radius: 10px;
    background: #0e1828;
    padding: 12px;
    margin-bottom: 10px;
  }
  .preview-body a { color: #93c5fd; }

  .footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 20px 20px;
    flex-shrink: 0;
  }

  .footer-right { display: inline-flex; align-items: center; gap: 8px; }

  .btn-ghost {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 44px;
    padding: 0 16px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.2);
    background: #111;
    color: #d9dfeb;
    font-size: 14px;
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
    gap: 8px;
    min-height: 44px;
    min-width: 140px;
    padding: 0 16px;
    border-radius: 10px;
    border: 1px solid #eab308;
    background: #facc15;
    color: #1b1400;
    font-size: 14px;
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

// ---------------------------------------------------------------------------
// Componente interno (renderizado dentro do Shadow DOM)
// ---------------------------------------------------------------------------

interface InnerModalProps extends PreviewExportModalProps {}

function InnerModal(props: InnerModalProps) {
  const {
    title,
    generatedAtIso,
    format,
    text,
    renderState,
    busy,
    formatOptions,
    onTextChange,
    onChangeFormat,
    onClose,
    onReset,
    onExport,
    formatExportTimestamp
  } = props

  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const previewContentRef = useRef<HTMLDivElement | null>(null)
  const syncLockRef = useRef(false)
  const isPlainPreview = format === "text" || format === "word" || format === "pdf" || format === "json"

  const syncScroll = useCallback(() => {
    const editor = editorRef.current
    const preview = previewRef.current
    if (!editor || !preview) return
    const editorMax = Math.max(1, editor.scrollHeight - editor.clientHeight)
    const ratio = editorMax > 0 ? editor.scrollTop / editorMax : 0
    const previewMax = Math.max(0, preview.scrollHeight - preview.clientHeight)
    preview.scrollTop = ratio * previewMax
  }, [])

  useEffect(() => {
    syncScroll()
  }, [syncScroll, format, renderState])

  useEffect(() => {
    const container = previewContentRef.current
    if (!container) return
    container.innerHTML = ""
    if (renderState.mode === "html") {
      container.innerHTML = renderState.html ?? ""
      return
    }
    const pre = document.createElement("pre")
    pre.textContent = renderState.text ?? ""
    container.appendChild(pre)
  }, [renderState.html, renderState.mode, renderState.text])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
  }, [onClose])

  const stopProp = (event: { stopPropagation: () => void }) => event.stopPropagation()

  return (
    <div className="overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Preview and edit export"
        className="panel"
        onClick={stopProp}
        onMouseDown={stopProp}>
        <header className="header">
          <div>
            <span className="badge">
              <span className="badge-dot" />
              PREVIEW LAB
            </span>
            <p className="title">Preview and edit</p>
            <p className="subtitle">{title} · {formatExportTimestamp(generatedAtIso)}</p>
          </div>
          <button className="close-btn" type="button" aria-label="Close" onClick={onClose}>
            <X size={16} strokeWidth={2} />
          </button>
        </header>

        <div className="body">
          <div className="format-bar">
            {formatOptions.map((opt) => {
              const Icon = opt.icon
              const active = opt.id === format
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={`fmt-btn${active ? " active" : ""}`}
                  onClick={() => onChangeFormat(opt.id)}>
                  <Icon size={14} strokeWidth={2} />
                  <span translate={opt.id === "word" ? "no" : undefined}>{opt.label}</span>
                </button>
              )
            })}
          </div>

          <div className="editor-grid">
            <div className="pane">
              <div className="pane-label">Editor</div>
              <textarea
                ref={editorRef}
                value={text}
                onChange={(event) => onTextChange(event.target.value)}
                spellCheck={false}
                onScroll={() => {
                  if (syncLockRef.current) return
                  syncLockRef.current = true
                  syncScroll()
                  requestAnimationFrame(() => { syncLockRef.current = false })
                }}
              />
            </div>

            <div className="pane">
              <div className="pane-label">Preview</div>
              <div
                ref={previewRef}
                className={`preview-body${isPlainPreview ? " preview-plain" : ""}`}>
                {renderState.error && <div className="error-banner">{renderState.error}</div>}
                <div ref={previewContentRef} className="preview-content-wrapper" />
              </div>
            </div>
          </div>
        </div>

        <footer className="footer">
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={onReset}>
            Reset
          </button>
          <div className="footer-right">
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={onExport}>
              {busy ? <Loader2 size={14} strokeWidth={2} className="spin" /> : <Download size={14} strokeWidth={2} />}
              <span>Export</span>
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Componente publico - monta tudo em Shadow DOM isolado
// ---------------------------------------------------------------------------

export function PreviewExportModal(props: PreviewExportModalProps) {
  const { shadowRoot, injectCSS } = useShadowPortal("preview-export-modal", true)

  useEffect(() => {
    injectCSS(SHADOW_CSS)
  }, [injectCSS])

  if (!shadowRoot) return null

  return ReactDOM.createPortal(<InnerModal {...props} />, shadowRoot)
}
