/**
 * SourceDownloadModal
 *
 * Modal principal do "Cofre de Fontes" + toast de progresso,
 * completamente isolados do DOM do NotebookLM via Shadow DOM.
 *
 * Use assim no SourceDownloadPanel.tsx:
 *
 *   import { SourceDownloadModal } from "./SourceDownloadModal"
 *
 *   // No return do SourceDownloadPanel, substitua o bloco {isOpen && ...} e o toast por:
 *   <SourceDownloadModal
 *     isOpen={isOpen}
 *     isPreviewMode={isPreviewMode}
 *     ... (todas as props abaixo)
 *   />
 */

import { useEffect, useLayoutEffect, useRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { AlertTriangle, CheckCircle2, Download, Eye, FileText, Search, X } from "lucide-react"
import { useShadowPortal } from "./useShadowPortal"
import type { IsolatedResourceAssetData } from "./IsolatedResourceViewerDialog"

// ---------------------------------------------------------------------------
// Tipos (espelham os do SourceDownloadPanel)
// ---------------------------------------------------------------------------

export type DownloadFormat = "markdown" | "text" | "pdf" | "docx"

export interface SourceRow {
  sourceId: string
  backendId: string | null
  sourceTitle: string
  sourceUrl?: string
  sourceKind: "youtube" | "document"
  isGDoc: boolean
}

export interface PreviewDraft {
  sourceId: string
  sourceTitle: string
  sourceUrl?: string
  sourceKind: "youtube" | "document"
  summaryText: string
  editableContent: string
}

export type ToastStatus = "idle" | "running" | "success" | "error"

export interface ToastState {
  status: ToastStatus
  message: string
  progress: number
}

export interface DownloadFormatMeta {
  label: string
  subtitle: string
  noTranslate?: boolean
}

export interface UiCopy {
  modalAriaLabel: string
  modalTitle: string
  modalSubtitlePreview: string
  modalSubtitleSelection: string
  sourceFilterPlaceholder: string
  selectAllLabel: string
  loadingBackendSources: string
  noSourcesForFilter: string
  sourceKindYoutube: string
  sourceKindDocument: string
  loadingPreview: string
  noPreviewAvailable: string
  previewTextareaPlaceholder: string
  previewSkippedLabel: (count: number) => string
  backButton: string
  previewButton: string
  downloadButton: (count: number) => string
  downloadRunningButton: string
  toastTitleUpdatingSources: string
  toastTitlePreviewSources: string
  toastTitleDownloadingSources: string
  toastTitleDownloadSources: string
  closeNoticeAriaLabel: string
  formatLabelMarkdown: string
  formatLabelText: string
  formatLabelPdf: string
  formatLabelDocx: string
}

export interface SourceDownloadModalProps {
  isOpen: boolean
  isPreviewMode: boolean
  isLoadingSources: boolean
  isRunningDownload: boolean
  isPreparingPreview: boolean
  isSyncingGDocs: boolean
  format: DownloadFormat
  sourceSearch: string
  sources: SourceRow[]
  sourceLoadError: string | null
  selectedSourceIds: Set<string>
  filteredSources: SourceRow[]
  filteredSelectedCount: number
  areAllFilteredSourcesSelected: boolean
  hasFilteredSources: boolean
  hasPartialFilteredSelection: boolean
  previewDrafts: PreviewDraft[]
  previewLoadError: string | null
  previewSkippedCount: number
  selectedCount: number
  toast: ToastState
  toastDisplayMessage: string
  toastStatusLabel: string
  isPreviewToast: boolean
  downloadFormatMeta: Record<DownloadFormat, DownloadFormatMeta>
  downloadFormatOptions: readonly DownloadFormat[]
  uiCopy: UiCopy
  selectAllCheckboxRef: React.RefObject<HTMLInputElement>
  // callbacks
  onClose: () => void
  onSetSourceSearch: (value: string) => void
  onUpdateFormat: (format: DownloadFormat) => void
  onToggleSelectAll: () => void
  onToggleSource: (sourceId: string) => void
  onReplaceSelection: (sourceIds: string[]) => void
  onPreparePreview: () => void
  onGoBackToSelection: () => void
  onDownloadSelected: () => void
  onPreviewContentChange: (sourceId: string, content: string) => void
  onDismissToast: () => void
}

// ---------------------------------------------------------------------------
// CSS injetado no Shadow DOM
// ---------------------------------------------------------------------------

const SHADOW_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :host { all: initial; font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; }

  /* ── Overlay ── */
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

  /* ── Panel ── */
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
    pointer-events: none;
  }

  .inner { position: relative; z-index: 1; display: flex; flex: 1; flex-direction: column; min-height: 0; }

  /* ── Header ── */
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
  .badge svg { color: #facc15; }
  .modal-title { font-size: 28px; font-weight: 600; color: #fff; margin-top: 8px; line-height: 1; }
  .modal-subtitle { font-size: 13px; color: #9da7b8; margin-top: 6px; max-width: 640px; line-height: 1.6; }
  .close-btn {
    flex-shrink: 0;
    display: inline-flex; align-items: center; justify-content: center;
    width: 40px; height: 40px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.2);
    background: #0a0a0a; color: #a9b2c1;
    cursor: pointer; font-size: 16px;
    transition: border-color 150ms, background 150ms, color 150ms;
  }
  .close-btn:hover { border-color: rgba(250,204,21,0.55); background: #151209; color: #facc15; }

  /* ── Body ── */
  .body { padding: 12px 20px 8px; flex-shrink: 0; }

  .search-bar {
    display: flex; align-items: center; gap: 8px;
    border-radius: 10px; border: 1px solid rgba(255,255,255,0.16);
    background: #0a0a0a; padding: 10px 12px;
  }
  .search-bar svg { color: #8f98a8; flex-shrink: 0; }
  .search-bar input {
    flex: 1; background: transparent; border: none; outline: none;
    font-size: 14px; color: #eef2fa;
  }
  .search-bar input::placeholder { color: #7a8391; }

  /* Format grid */
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
  @media (max-width: 600px) { .format-grid { grid-template-columns: repeat(2,1fr); } }

  .fmt-btn {
    display: flex; flex-direction: column; justify-content: center;
    gap: 2px; min-height: 50px;
    border-radius: 8px; border: 1px solid rgba(255,255,255,0.16);
    background: #111; color: #c8d1de;
    padding: 8px 10px; text-align: left;
    cursor: pointer;
    transition: border-color 150ms, background 150ms, color 150ms;
  }
  .fmt-btn:hover { border-color: rgba(250,204,21,0.35); background: #161616; }
  .fmt-btn.active { border-color: #facc15; background: #facc15; color: #131002; }
  .fmt-btn-label { font-size: 14px; font-weight: 600; line-height: 1; }
  .fmt-btn-sub { font-size: 11px; line-height: 1.2; opacity: 0.85; }

  /* Select all row */
  .select-all-row { margin-top: 8px; }
  .select-all-label {
    display: inline-flex; align-items: center; gap: 8px;
    border-radius: 8px; border: 1px solid rgba(255,255,255,0.16);
    background: #0f0f0f; padding: 4px 10px;
    color: #d5dbe6; font-size: 12px; cursor: pointer;
    white-space: nowrap;
  }
  .select-all-label input,
  .source-item input {
    width: 16px;
    height: 16px;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    background: #0b0b0b;
    border: 1px solid rgba(255,255,255,0.22);
    border-radius: 4px;
    display: inline-grid;
    place-content: center;
  }
  .select-all-label input::after,
  .source-item input::after {
    content: "";
    width: 8px;
    height: 4px;
    border-left: 2px solid #facc15;
    border-bottom: 2px solid #facc15;
    transform: rotate(-45deg) scale(0);
    transition: transform 120ms ease;
  }
  .select-all-label input:checked::after,
  .source-item input:checked::after {
    transform: rotate(-45deg) scale(1);
  }
  .select-all-label input:indeterminate::after,
  .source-item input:indeterminate::after {
    width: 8px;
    height: 0;
    border-left: none;
    border-bottom: none;
    border-top: 2px solid #facc15;
    transform: scale(1);
  }
  .select-all-label input:focus-visible,
  .source-item input:focus-visible {
    outline: 2px solid rgba(250, 204, 21, 0.5);
    outline-offset: 2px;
  }
  .select-all-label input:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  /* Source list */
  .source-list {
    margin: 8px 20px 0;
    min-height: 220px; max-height: 330px;
    overflow-y: auto;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.16);
    background: #0c0c0c;
    padding: 8px;
  }
  .source-empty { padding: 24px 12px; font-size: 14px; color: #a4adbc; }
  .source-error { padding: 24px 12px; font-size: 14px; color: #fca5a5; }
  .source-item {
    display: grid; grid-template-columns: 20px 1fr;
    align-items: start; gap: 8px;
    border-radius: 8px; border: 1px solid transparent;
    padding: 10px; cursor: pointer;
    transition: border-color 150ms, background 150ms;
  }
  .source-item:hover { border-color: rgba(255,255,255,0.16); background: #131313; }
  .source-item input { margin-top: 2px; }
  .source-title {
    display: block;
    font-size: 14px;
    font-weight: 600;
    color: #f3f4f6;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .source-kind {
    display: block;
    margin-top: 4px;
    font-size: 12px;
    color: #9ca3af;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    word-break: keep-all;
  }

  /* Preview list */
  .preview-list {
    margin: 8px 20px 0;
    min-height: 320px; max-height: 420px;
    overflow-y: auto;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.16);
    background: #0c0c0c;
    padding: 10px;
  }
  .source-list,
  .preview-list {
    scrollbar-color: #1f2937 #050505;
    scrollbar-width: thin;
  }
  .source-list::-webkit-scrollbar,
  .preview-list::-webkit-scrollbar {
    width: 10px;
  }
  .source-list::-webkit-scrollbar-track,
  .preview-list::-webkit-scrollbar-track {
    background: #050505;
  }
  .source-list::-webkit-scrollbar-thumb,
  .preview-list::-webkit-scrollbar-thumb {
    background: #1f2937;
    border-radius: 999px;
    border: 2px solid #050505;
  }
  .preview-skipped {
    margin-bottom: 8px; padding: 8px 12px;
    border-radius: 10px; border: 1px solid rgba(255,255,255,0.08);
    background: #10151d; font-size: 12px; color: #c7ced8;
  }
  .preview-empty { padding: 24px 12px; font-size: 14px; color: #9ca3af; }
  .preview-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 600px) { .preview-grid { grid-template-columns: 1fr; } }
  .preview-card {
    display: flex; flex-direction: column;
    height: 320px; overflow: hidden;
    border-radius: 8px; border: 1px solid rgba(255,255,255,0.16);
    background: #111;
  }
  .preview-card-header {
    display: flex; align-items: center; justify-content: space-between;
    gap: 8px; padding: 10px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.12);
    flex-shrink: 0;
  }
  .preview-card-title { font-size: 14px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .preview-card-sub { font-size: 12px; color: #9ca3af; }
  .preview-card textarea {
    flex: 1; resize: none; background: transparent; border: none; outline: none;
    padding: 12px; font-size: 13px; line-height: 1.6; color: #e5e7eb;
    overflow-y: auto;
  }
  .preview-card textarea::placeholder { color: #6b7280; }

  /* ── Footer ── */
  .footer {
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: 12px;
    padding: 12px 20px 20px;
    flex-shrink: 0;
    margin-top: 12px;
  }
  .btn-ghost {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    min-height: 54px; border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.2);
    background: #111; color: #d9dfeb;
    font-size: 16px; font-weight: 600; cursor: pointer;
    transition: border-color 150ms, background 150ms;
  }
  .btn-ghost:hover:not(:disabled) { border-color: rgba(250,204,21,0.45); background: #171717; }
  .btn-ghost:disabled { cursor: not-allowed; opacity: 0.45; }
  .btn-primary {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    min-height: 54px; border-radius: 10px;
    border: 1px solid #eab308; background: #facc15; color: #1b1400;
    font-size: 16px; font-weight: 600; cursor: pointer;
    box-shadow: 6px 6px 0 rgba(250,204,21,0.18);
    transition: background 150ms;
  }
  .btn-primary:hover:not(:disabled) { background: #fbbf24; }
  .btn-primary:disabled { cursor: not-allowed; opacity: 0.45; }

  /* ── Toast ── */
  .toast {
    position: fixed;
    bottom: 16px; right: 16px;
    z-index: 2147483647;
    width: min(390px, calc(100vw - 24px));
    overflow: hidden;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.18);
    background: #000; color: #d6dae0;
    box-shadow: 0 18px 48px rgba(0,0,0,0.56);
    pointer-events: auto;
  }
  .toast-top-bar {
    position: absolute; inset-x: 0; top: 0;
    height: 2px; background: #facc15;
  }
  .toast-inner { position: relative; z-index: 1; padding: 16px; }
  .toast-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .toast-badge {
    display: inline-flex; align-items: center; gap: 6px;
    border-radius: 6px; border: 1px solid rgba(255,255,255,0.2);
    background: #111; padding: 2px 8px;
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.08em; color: #b5becc; margin-bottom: 4px;
  }
  .toast-title { font-size: 18px; font-weight: 600; color: #fff; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .toast-close {
    flex-shrink: 0;
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px;
    border-radius: 7px; border: 1px solid rgba(255,255,255,0.2);
    background: #111; color: #8f98a6; cursor: pointer; font-size: 14px;
    transition: border-color 150ms, background 150ms, color 150ms;
  }
  .toast-close:hover { border-color: rgba(250,204,21,0.45); background: #171717; color: #facc15; }
  .toast-message { font-size: 14px; color: #b9c2d0; line-height: 1.6; margin-bottom: 12px; }
  .toast-progress-row { display: flex; justify-content: space-between; font-size: 11px; color: #8b97ab; margin-bottom: 4px; }
  .toast-bar-track {
    height: 10px; border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.18); background: #111; overflow: hidden;
  }
  .toast-bar-fill { height: 100%; border-radius: 9999px; background: #facc15; transition: width 300ms; }

  /* icon colors */
  .icon-yellow { color: #facc15; }
  .icon-red    { color: #f87171; }
  .icon-green  { color: #34d399; }
`

// ---------------------------------------------------------------------------
// Componente interno — renderizado dentro do Shadow DOM
// ---------------------------------------------------------------------------

function ModalInner(props: SourceDownloadModalProps) {
  const {
    isPreviewMode, isLoadingSources, isRunningDownload, isPreparingPreview,
    isSyncingGDocs, format, sourceSearch, sources, sourceLoadError,
    selectedSourceIds, filteredSources,
    previewDrafts, previewLoadError, previewSkippedCount,
    toast, toastDisplayMessage, toastStatusLabel, isPreviewToast,
    downloadFormatMeta, downloadFormatOptions, uiCopy, selectAllCheckboxRef,
    onClose, onSetSourceSearch, onUpdateFormat, onToggleSelectAll, onToggleSource, onReplaceSelection,
    onPreparePreview, onGoBackToSelection, onDownloadSelected,
    onPreviewContentChange, onDismissToast
  } = props

  const showOverlay = props.isOpen

  const panelRef = useRef<HTMLDivElement | null>(null)
  const localFilteredSelectedCount = filteredSources.reduce(
    (count, source) => count + (selectedSourceIds.has(source.sourceId) ? 1 : 0),
    0
  )
  const localHasFilteredSources = filteredSources.length > 0
  const localAreAllFilteredSourcesSelected =
    localHasFilteredSources && localFilteredSelectedCount === filteredSources.length
  const localHasPartialFilteredSelection =
    localFilteredSelectedCount > 0 && !localAreAllFilteredSourcesSelected
  const displayTotalCount = localHasFilteredSources ? filteredSources.length : sources.length
  const displaySelectedCount = localHasFilteredSources ? localFilteredSelectedCount : selectedSourceIds.size
  const downloadCount = selectedSourceIds.size

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const resolveCheckboxTarget = (event: Event): HTMLInputElement | null => {
      if (event.target instanceof HTMLInputElement) {
        return event.target
      }
      if (typeof event.composedPath !== "function") {
        return null
      }
      const path = event.composedPath()
      for (const node of path) {
        if (node instanceof HTMLInputElement && node.type === "checkbox") {
          return node
        }
      }
      return null
    }

    const handleChange = (event: Event) => {
      const target = resolveCheckboxTarget(event)
      if (!target) return

      if (target.dataset.minddockSelectAll === "true") {
        const nextChecked = target.checked
        panel
          .querySelectorAll<HTMLInputElement>("input[data-minddock-source-id]")
          .forEach((input) => { input.checked = nextChecked })
      }

      const selectedIds = Array.from(
        panel.querySelectorAll<HTMLInputElement>("input[data-minddock-source-id]")
      )
        .filter((input) => input.checked)
        .map((input) => input.dataset.minddockSourceId)
        .filter((value): value is string => !!value)

      if (
        selectedIds.length === selectedSourceIds.size &&
        selectedIds.every((id) => selectedSourceIds.has(id))
      ) {
        return
      }

      onReplaceSelection(selectedIds)
    }

    panel.addEventListener("change", handleChange, true)
    return () => panel.removeEventListener("change", handleChange, true)
  }, [onReplaceSelection, selectedSourceIds])

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        if (isPreviewMode) {
          onGoBackToSelection()
          return
        }
        onClose()
      }
    }
    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
  }, [isPreviewMode, onClose, onGoBackToSelection])

  // Sync indeterminate state on checkbox
  useEffect(() => {
    const cb = selectAllCheckboxRef.current
    if (!cb) return
    cb.indeterminate = localHasPartialFilteredSelection
  }, [localHasPartialFilteredSelection, selectAllCheckboxRef])

  const stopProp = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <>
      {/* ── Modal overlay ── */}
      {showOverlay && (
        <div className="overlay">
        <div
          className="overlay-backdrop"
        />

        <div
          role="dialog"
          aria-modal="true"
          aria-label={uiCopy.modalAriaLabel}
          className="panel"
          data-tour-id="source-vault-panel"
          ref={panelRef}
          onClick={stopProp}
          onMouseDown={stopProp}>

          <div className="inner">
            {/* Header */}
            <header className="header">
              <div>
                <span className="badge">
                  <FileText width={11} height={11} />
                  SOURCE VAULT
                </span>
                <p className="modal-title">{uiCopy.modalTitle}</p>
                <p className="modal-subtitle">{uiCopy.modalSubtitleSelection}</p>
              </div>
              <button
                className="close-btn"
                type="button"
                data-tour-id="source-vault-close-btn"
                onClick={onClose}>
                ✕
              </button>
            </header>

            {/* Body */}
            <div className="body">
              {/* Search */}
              <div className="search-bar">
                <Search width={14} height={14} />
                <input
                  type="search"
                  value={sourceSearch}
                  onChange={(e) => onSetSourceSearch(e.target.value)}
                  placeholder={uiCopy.sourceFilterPlaceholder}
                />
              </div>

              {/* Format buttons */}
              <div className="format-grid" data-tour-id="source-vault-format-grid">
                {downloadFormatOptions.map((item) => {
                  const meta = downloadFormatMeta[item]
                  return (
                    <button
                      key={item}
                      type="button"
                      className={`fmt-btn${format === item ? " active" : ""}`}
                      onClick={() => onUpdateFormat(item)}>
                      <span className="fmt-btn-label" translate={meta.noTranslate ? "no" : undefined}>
                        {meta.label}
                      </span>
                      <span className="fmt-btn-sub" translate={meta.noTranslate ? "no" : undefined}>
                        {meta.subtitle}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Select all */}
              <div className="select-all-row">
                <label className="select-all-label">
                  <input
                    ref={selectAllCheckboxRef}
                    type="checkbox"
                    data-minddock-select-all="true"
                    checked={localAreAllFilteredSourcesSelected}
                    onChange={onToggleSelectAll}
                    disabled={!localHasFilteredSources}
                  />
                  <span>{uiCopy.selectAllLabel}</span>
                </label>
              </div>
            </div>

            {/* Source list */}
            <div className="source-list">
              {isLoadingSources && (
                <div className="source-empty">{uiCopy.loadingBackendSources}</div>
              )}
              {!isLoadingSources && sourceLoadError && (
                <div className="source-error">{sourceLoadError}</div>
              )}
              {!isLoadingSources && !sourceLoadError && filteredSources.length === 0 && (
                <div className="source-empty">{uiCopy.noSourcesForFilter}</div>
              )}
              {!isLoadingSources && !sourceLoadError && filteredSources.map((source) => (
                <label key={source.sourceId} className="source-item">
                  <input
                    type="checkbox"
                    data-minddock-source-id={source.sourceId}
                    checked={selectedSourceIds.has(source.sourceId)}
                    onChange={() => onToggleSource(source.sourceId)}
                  />
                  <span>
                    <span className="source-title" title={source.sourceTitle}>
                      {source.sourceTitle}
                    </span>
                    <span className="source-kind">
                      {source.sourceKind === "youtube" ? uiCopy.sourceKindYoutube : uiCopy.sourceKindDocument}
                      {source.isGDoc ? " - GDoc" : ""}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {/* Footer */}
            <footer className="footer">
              <button
                type="button"
                className="btn-ghost"
                data-tour-id="source-vault-preview-btn"
                disabled={isLoadingSources || isRunningDownload || isPreparingPreview || displayTotalCount === 0 || displaySelectedCount === 0 || isPreviewMode}
                onClick={onPreparePreview}>
                <Eye width={16} height={16} />
                {uiCopy.previewButton}
              </button>
              <button
                type="button"
                className="btn-primary"
                data-tour-id="source-vault-download-btn"
                disabled={isRunningDownload || isPreparingPreview || downloadCount === 0}
                onClick={onDownloadSelected}>
                <Download width={16} height={16} />
                {isRunningDownload ? uiCopy.downloadRunningButton : uiCopy.downloadButton(downloadCount)}
              </button>
            </footer>
          </div>
        </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast.status !== "idle" && !isPreviewMode && (
        <div className="toast">
          <div className="toast-top-bar" />
          <div className="toast-inner">
            <div className="toast-header">
              <div style={{ minWidth: 0 }}>
                <div className="toast-badge">
                  {toast.status === "error"
                    ? <AlertTriangle width={11} height={11} className="icon-red" />
                    : toast.status === "success"
                      ? <CheckCircle2 width={11} height={11} className="icon-green" />
                      : <Download width={11} height={11} className="icon-yellow" />}
                  {toastStatusLabel}
                </div>
                <div className="toast-title">
                  {isSyncingGDocs
                    ? uiCopy.toastTitleUpdatingSources
                    : isPreparingPreview || isPreviewToast
                      ? uiCopy.toastTitlePreviewSources
                      : isRunningDownload
                        ? uiCopy.toastTitleDownloadingSources
                        : uiCopy.toastTitleDownloadSources}
                </div>
              </div>
              <button
                type="button"
                className="toast-close"
                aria-label={uiCopy.closeNoticeAriaLabel}
                onClick={onDismissToast}>
                ✕
              </button>
            </div>
            <p className="toast-message">{toastDisplayMessage}</p>
            <div className="toast-progress-row">
              <span>Progress</span>
              <span>{Math.max(0, Math.min(100, Math.round(toast.progress)))}%</span>
            </div>
            <div className="toast-bar-track">
              <div
                className="toast-bar-fill"
                style={{ width: `${Math.max(0, Math.min(100, toast.progress))}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Componente público — Shadow DOM isolado
// ---------------------------------------------------------------------------

export function SourceDownloadModal(props: SourceDownloadModalProps) {
  const active = props.isOpen || props.toast.status !== "idle"
  const { shadowRoot, injectCSS } = useShadowPortal("source-download-modal", active, 2147483646)
  const cssInjectedRef = useRef(false)
  const mountRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<Root | null>(null)

  useLayoutEffect(() => {
    if (!shadowRoot) {
      return
    }

    if (!mountRef.current) {
      const mount = document.createElement("div")
      shadowRoot.appendChild(mount)
      mountRef.current = mount
    }

    if (!rootRef.current && mountRef.current) {
      rootRef.current = createRoot(mountRef.current)
    }

    if (!cssInjectedRef.current) {
      injectCSS(SHADOW_CSS)
      cssInjectedRef.current = true
    }

    return () => {
      if (rootRef.current) {
        rootRef.current.unmount()
        rootRef.current = null
      }
      if (mountRef.current?.parentNode) {
        mountRef.current.parentNode.removeChild(mountRef.current)
      }
      mountRef.current = null
      cssInjectedRef.current = false
    }
  }, [shadowRoot, injectCSS])

  useEffect(() => {
    if (!rootRef.current) {
      return
    }
    if (!active) {
      rootRef.current.render(null)
      return
    }
    rootRef.current.render(<ModalInner {...props} />)
  }, [active, props])

  return null
}
