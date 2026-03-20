// Refatorado: Substituicao de lucide-react por SVGs nativos para prevenir DOMException em Shadow Roots
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"

type SourceRecord = {
  id: string
  title: string
  kind?: string
  previewHtml?: string
  previewText?: string
}

type SourceExportManagerProps = {
  sources: SourceRecord[]
}

type SourceSelectionListProps = {
  sources: SourceRecord[]
  selectedSourceIds: string[]
  onToggleSource: (sourceId: string) => void
}

type PreviewGridContainerProps = {
  sources: SourceRecord[]
  onClose: () => void
}

type SafeHtmlBlockProps = {
  html: string
  className?: string
}

function hasHtmlShape(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value)
}

function sanitizeMarkup(rawHtml: string): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(rawHtml, "text/html")

  const blockedTags = ["script", "iframe", "object", "embed", "style", "link", "meta"]
  blockedTags.forEach((tag) => {
    doc.querySelectorAll(tag).forEach((node) => node.remove())
  })

  doc.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase()
      const value = attr.value.toLowerCase()
      if (name.startsWith("on")) {
        element.removeAttribute(attr.name)
        return
      }
      if (name === "href" || name === "src") {
        if (value.startsWith("javascript:") || value.startsWith("data:")) {
          element.removeAttribute(attr.name)
        }
      }
      if (name === "srcdoc") {
        element.removeAttribute(attr.name)
      }
    })
  })

  return doc.body.innerHTML
}

function SafeHtmlBlock({ html, className }: SafeHtmlBlockProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.innerHTML = html
    }
  }, [html])

  return <div ref={containerRef} className={className} />
}

export function SourceExportManager({ sources }: SourceExportManagerProps) {
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([])
  const [isDisplayingPreview, setIsDisplayingPreview] = useState(false)

  const isPreviewDisabled = selectedSourceIds.length === 0

  const selectedSources = useMemo(
    () => sources.filter((source) => selectedSourceIds.includes(source.id)),
    [sources, selectedSourceIds]
  )

  const handleToggleSource = useCallback((sourceId: string) => {
    setSelectedSourceIds((current) =>
      current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId]
    )
  }, [])

  const handleOpenPreview = useCallback(() => {
    if (selectedSourceIds.length === 0) return
    setIsDisplayingPreview(true)
  }, [selectedSourceIds.length])

  const handleClosePreview = useCallback(() => {
    setIsDisplayingPreview(false)
  }, [])

  useEffect(() => {
    if (isDisplayingPreview && isPreviewDisabled) {
      setIsDisplayingPreview(false)
    }
  }, [isDisplayingPreview, isPreviewDisabled])

  return (
    <section className="w-full rounded-xl border border-slate-800 bg-slate-950 p-4 text-slate-100">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Selecione as fontes</h2>
          <p className="text-sm text-slate-400">Escolha as fontes para exportar e revisar.</p>
        </div>
        <button
          type="button"
          onClick={handleOpenPreview}
          disabled={isPreviewDisabled}
          className={
            "inline-flex items-center gap-2 rounded-lg border border-amber-400 px-4 py-2 text-sm font-semibold text-amber-200 transition " +
            (isPreviewDisabled
              ? "opacity-50 cursor-not-allowed"
              : "hover:bg-amber-400/10")
          }
        >
          <svg
            aria-hidden="true"
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          Pre-visualizacao
        </button>
      </header>

      <SourceSelectionList
        sources={sources}
        selectedSourceIds={selectedSourceIds}
        onToggleSource={handleToggleSource}
      />

      {/* Comentario de fluxo: nao renderizamos o preview quando nao ha selecao valida. */}
      {isDisplayingPreview && !isPreviewDisabled ? (
        <PreviewGridContainer sources={selectedSources} onClose={handleClosePreview} />
      ) : null}
    </section>
  )
}

export function SourceSelectionList({
  sources,
  selectedSourceIds,
  onToggleSource
}: SourceSelectionListProps) {
  return (
    <div className="space-y-2">
      {sources.map((source) => {
        const isChecked = selectedSourceIds.includes(source.id)
        return (
          <label
            key={source.id}
            className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3"
          >
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-950 text-amber-400"
              checked={isChecked}
              onChange={() => onToggleSource(source.id)}
            />
            <div>
              <div className="text-sm font-medium text-slate-100">{source.title}</div>
              {source.kind ? <div className="text-xs text-slate-400">{source.kind}</div> : null}
            </div>
          </label>
        )
      })}
    </div>
  )
}

export function PreviewGridContainer({ sources, onClose }: PreviewGridContainerProps) {
  const safeSources = useMemo(
    () =>
      sources.map((source) => {
        const rawValue = source.previewHtml ?? source.previewText ?? ""
        const isHtml = rawValue ? hasHtmlShape(rawValue) : false
        const safeValue = isHtml ? sanitizeMarkup(rawValue) : rawValue
        return {
          ...source,
          safeValue,
          isHtml
        }
      }),
    [sources]
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-6">
      <div className="isolate w-full max-w-5xl rounded-2xl border border-slate-800 bg-slate-950 p-6">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold">Pre-visualizacao das fontes</h3>
            <p className="text-sm text-slate-400">Revise antes de exportar.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
          >
            <svg
              aria-hidden="true"
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Fechar
          </button>
        </header>

        {/* Comentario de fluxo: o grid evita renderizacao vazia ao depender do array filtrado. */}
        <div className="grid grid-cols-2 gap-4">
          {safeSources.map((source) => (
            <article
              key={source.id}
              className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
            >
              <h4 className="mb-2 text-sm font-semibold text-amber-200">{source.title}</h4>
              {source.isHtml ? (
                <SafeHtmlBlock
                  html={source.safeValue}
                  className="prose prose-invert max-w-none text-sm text-slate-200"
                />
              ) : (
                <p className="text-sm text-slate-200">
                  {source.safeValue || "Sem pre-visualizacao disponivel."}
                </p>
              )}
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}
