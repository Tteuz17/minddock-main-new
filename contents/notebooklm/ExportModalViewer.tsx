import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

interface ExportModalViewerLabels {
  previewButton: string
  exportButton: string
  exportingButton: string
  configurationTabLabel: string
  previewTabLabel: string
}

export interface ExportModalViewerProps {
  /** Already sanitized HTML (DOMPurify + marked). */
  exportPayloadString: string
  configurationContent: ReactNode
  onRequestExport: () => void
  onRequestClose: () => void
  isExporting?: boolean
  isPreviewDisabled?: boolean
  initialPreviewActive?: boolean
  showPreviewToggle?: boolean
  closeButtonLabel?: string
  labels?: Partial<ExportModalViewerLabels>
}

interface SafePreviewContainerProps {
  previewHtmlString: string
}

/**
 * SafePreviewContainer
 * REGRA DE OURO: este div nao recebe nenhum filho React.
 */
function SafePreviewContainer({ previewHtmlString }: SafePreviewContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.innerHTML = previewHtmlString
    }
  }, [previewHtmlString])

  return <div ref={containerRef} className="export-preview-html" />
}

export function ExportModalViewer({
  exportPayloadString,
  configurationContent,
  onRequestExport,
  onRequestClose,
  isExporting = false,
  isPreviewDisabled = false,
  initialPreviewActive = false,
  showPreviewToggle = true,
  closeButtonLabel = "Fechar",
  labels
}: ExportModalViewerProps) {
  const [isPreviewActive, setIsPreviewActive] = useState(initialPreviewActive)

  const mergedLabels = useMemo<ExportModalViewerLabels>(
    () => ({
      previewButton: "Previa",
      exportButton: "Exportar",
      exportingButton: "Exportando...",
      configurationTabLabel: "Configuracao",
      previewTabLabel: "Pre-visualizacao",
      ...labels
    }),
    [labels]
  )

  const togglePreviewMode = useCallback(() => {
    if (isPreviewDisabled) return
    setIsPreviewActive((prev) => !prev)
  }, [isPreviewDisabled])

  const renderExportConfiguration = useCallback(() => {
    return (
      <div className="export-config-root" aria-hidden={isPreviewActive}>
        <div className="export-config-label">{mergedLabels.configurationTabLabel}</div>
        <div className="export-config-body">{configurationContent}</div>
      </div>
    )
  }, [configurationContent, isPreviewActive, mergedLabels.configurationTabLabel])

  const renderPreviewContent = useCallback(() => {
    return (
      <div className="export-preview-root" aria-hidden={!isPreviewActive}>
        <div className="export-preview-label">{mergedLabels.previewTabLabel}</div>
        <SafePreviewContainer previewHtmlString={exportPayloadString} />
      </div>
    )
  }, [exportPayloadString, isPreviewActive, mergedLabels.previewTabLabel])

  return (
    <div className="export-modal-root" role="dialog" aria-modal="true">
      <div className="export-modal-body">
        {/* Estrutura de abas com containers estaveis */}
        <div className="export-modal-tabs">
          <div
            className="export-modal-tab"
            data-active={!isPreviewActive}
            aria-hidden={isPreviewActive}>
            {renderExportConfiguration()}
          </div>
          <div
            className="export-modal-tab"
            data-active={isPreviewActive}
            aria-hidden={!isPreviewActive}>
            {renderPreviewContent()}
          </div>
        </div>
      </div>

      {/* ModalFooter fixo, fora da area dinamica */}
      <div className="export-modal-footer">
        {showPreviewToggle ? (
          <button
            type="button"
            className="export-modal-btn export-modal-btn-ghost"
            onClick={togglePreviewMode}
            disabled={isPreviewDisabled}>
            {mergedLabels.previewButton}
          </button>
        ) : null}
        <button
          type="button"
          className="export-modal-btn export-modal-btn-primary"
          onClick={onRequestExport}
          disabled={isExporting}>
          {isExporting ? mergedLabels.exportingButton : mergedLabels.exportButton}
        </button>
        <button
          type="button"
          className="export-modal-btn export-modal-btn-ghost"
          onClick={onRequestClose}>
          {closeButtonLabel}
        </button>
      </div>
    </div>
  )
}
