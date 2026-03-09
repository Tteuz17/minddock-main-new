import { Download } from "lucide-react"

interface DownloadSourcesButtonProps {
  onClick: () => void
  title?: string
  disabled?: boolean
}

export function DownloadSourcesButton(props: DownloadSourcesButtonProps) {
  const { onClick, title = "Download de fontes", disabled = false } = props

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-[11px] border border-white/[0.06] bg-[#131519] text-[#8e959e] transition-colors hover:bg-[#171a1f] hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
      <Download size={15} strokeWidth={1.8} />
    </button>
  )
}
