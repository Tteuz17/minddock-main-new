import { Download } from "lucide-react"
import { resolveSourceDownloadUiCopy } from "./notebooklmI18n"

interface DownloadSourcesButtonProps {
  onClick: () => void
  title?: string
  disabled?: boolean
}

export function DownloadSourcesButton(props: DownloadSourcesButtonProps) {
  const { onClick, title = resolveSourceDownloadUiCopy().downloadButtonTitle, disabled = false } = props

  return (
    <button
      type="button"
      data-tour-id="source-filters-download-btn"
      title={title}
      aria-label={title}
      onMouseDown={swallowClick}
      onClick={(event) => {
        swallowClick(event)
        onClick()
      }}
      disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-[11px] border border-white/[0.06] bg-[#131519] text-[#8e959e] transition-colors hover:bg-[#171a1f] hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
      <Download size={15} strokeWidth={1.8} />
    </button>
  )
}

function swallowClick(event: {
  preventDefault: () => void
  stopPropagation: () => void
  nativeEvent?: Event
}): void {
  event.preventDefault()
  event.stopPropagation()
  const native = event.nativeEvent as Event & { stopImmediatePropagation?: () => void }
  native?.stopImmediatePropagation?.()
}
