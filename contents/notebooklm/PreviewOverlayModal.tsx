import { useCallback, useEffect, useMemo, type ReactNode } from "react"
import * as ReactDOM from "react-dom"
import { ExportModalViewer } from "./ExportModalViewer"

interface PreviewOverlayModalLabels {
  closeButtonLabel: string
  exportButton: string
  exportingButton: string
  previewButton: string
  configurationTabLabel: string
  previewTabLabel: string
}

export interface PreviewOverlayModalProps {
  isOpen: boolean
  exportPayloadString: string
  onRequestClose: () => void
  onRequestExport: () => void
  isExporting?: boolean
  configurationContent?: ReactNode
  labels?: Partial<PreviewOverlayModalLabels>
}

const STYLE_ID = "minddock-preview-overlay-styles"
const OVERLAY_Z_INDEX = 2147483647
const SHADOW_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :host { all: initial; font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; }

  .preview-overlay {
    position: fixed;
    inset: 0;
    z-index: ${OVERLAY_Z_INDEX};
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    pointer-events: auto;
  }

  .preview-overlay-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0,0,0,0.88);
    backdrop-filter: blur(1px);
    -webkit-backdrop-filter: blur(1px);
    pointer-events: auto;
  }

  .preview-overlay-panel {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 960px;
    pointer-events: auto;
  }

  .export-modal-root {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-height: 88vh;
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.14);
    background: #000;
    color: #e2e6ee;
    box-shadow: 0 18px 48px rgba(0,0,0,0.56);
  }

  .export-modal-body { padding: 16px 20px; flex: 1; min-height: 0; }

  .export-modal-tabs { display: grid; gap: 12px; }

  .export-modal-tab { display: block; }

  .export-config-label,
  .export-preview-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #9da7b8;
    margin-bottom: 8px;
  }

  .export-config-body {
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.12);
    background: #0c0c0c;
    padding: 12px;
    max-height: 50vh;
    overflow: auto;
  }

  .export-preview-root {
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.12);
    background: #0c0c0c;
    padding: 12px;
    max-height: 55vh;
    overflow: auto;
  }

  .export-preview-html {
    font-size: 13px;
    line-height: 1.7;
    color: #e5e7eb;
  }
  .export-preview-html h1,
  .export-preview-html h2,
  .export-preview-html h3,
  .export-preview-html h4 {
    margin: 14px 0 8px;
    color: #fff;
  }
  .export-preview-html p { margin: 8px 0; }
  .export-preview-html ul { margin: 8px 0 8px 18px; }
  .export-preview-html code {
    background: rgba(255,255,255,0.08);
    padding: 2px 6px;
    border-radius: 6px;
  }
  .export-preview-html pre {
    background: rgba(255,255,255,0.06);
    padding: 12px;
    border-radius: 8px;
    overflow: auto;
  }

  .export-modal-footer {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
    gap: 12px;
    padding: 12px 20px 20px;
    border-top: 1px solid rgba(255,255,255,0.12);
    background: #060606;
  }

  .export-modal-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 48px;
    border-radius: 10px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid rgba(255,255,255,0.2);
    background: #111;
    color: #d9dfeb;
    transition: border-color 150ms, background 150ms;
  }

  .export-modal-btn-primary {
    border-color: #eab308;
    background: #facc15;
    color: #1b1400;
    box-shadow: 6px 6px 0 rgba(250,204,21,0.18);
  }

  .export-modal-btn-primary:hover:not(:disabled) { background: #fbbf24; }
  .export-modal-btn:disabled { cursor: not-allowed; opacity: 0.45; }
`

function ensureOverlayStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return
  }
  const style = document.createElement("style")
  style.id = STYLE_ID
  style.textContent = SHADOW_CSS
  document.head.appendChild(style)
}

function resolvePortalTarget(): Element | DocumentFragment {
  const explicitRoot =
    document.getElementById("minddock-root") ??
    document.querySelector("[data-minddock-root='true']") ??
    document.querySelector("#minddock-preview-overlay-root")

  if (explicitRoot) {
    return explicitRoot
  }

  const shadowHost = document.querySelector("[data-minddock-shadow-host]") as HTMLElement | null
  if (shadowHost?.shadowRoot) {
    return shadowHost.shadowRoot
  }

  return document.body
}

export function PreviewOverlayModal({
  isOpen,
  exportPayloadString,
  onRequestClose,
  onRequestExport,
  isExporting = false,
  configurationContent,
  labels
}: PreviewOverlayModalProps) {
  useEffect(() => {
    if (!isOpen) {
      return
    }
    ensureOverlayStyles()
  }, [isOpen])

  const portalTarget = useMemo(() => resolvePortalTarget(), [])
  const stopPropagation = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  if (!isOpen) return null

  const mergedLabels: PreviewOverlayModalLabels = {
    closeButtonLabel: "Voltar",
    exportButton: "Exportar",
    exportingButton: "Exportando...",
    previewButton: "Previa",
    configurationTabLabel: "Configuracao",
    previewTabLabel: "Pre-visualizacao",
    ...labels
  }

  return ReactDOM.createPortal(
    <div className="preview-overlay">
      <div className="preview-overlay-backdrop" onClick={onRequestClose} />
      <div className="preview-overlay-panel" onClick={stopPropagation} onMouseDown={stopPropagation}>
        <ExportModalViewer
          exportPayloadString={exportPayloadString}
          configurationContent={configurationContent ?? <div />}
          onRequestExport={onRequestExport}
          onRequestClose={onRequestClose}
          isExporting={isExporting}
          isPreviewDisabled={true}
          initialPreviewActive={true}
          showPreviewToggle={false}
          closeButtonLabel={mergedLabels.closeButtonLabel}
          labels={{
            previewButton: mergedLabels.previewButton,
            exportButton: mergedLabels.exportButton,
            exportingButton: mergedLabels.exportingButton,
            configurationTabLabel: mergedLabels.configurationTabLabel,
            previewTabLabel: mergedLabels.previewTabLabel
          }}
        />
      </div>
    </div>,
    portalTarget
  )
}
