import { useEffect } from "react"

export interface ToastNotifierProps {
  isVisible: boolean
  message: string
  variant?: "success" | "error"
  url?: string
  actionLabel?: string
  autoHideMs?: number
  onClose?: () => void
}

export function ToastNotifier({
  isVisible,
  message,
  variant = "success",
  url,
  actionLabel = "Abrir Google Doc",
  autoHideMs = 6000,
  onClose
}: ToastNotifierProps) {
  useEffect(() => {
    if (!isVisible || !onClose || autoHideMs <= 0) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      onClose()
    }, autoHideMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [autoHideMs, isVisible, onClose])

  if (!isVisible) {
    return null
  }

  const paletteClassName =
    variant === "success"
      ? "border-emerald-300/40 bg-emerald-500/20 text-emerald-50"
      : "border-rose-300/40 bg-rose-500/20 text-rose-50"

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        "pointer-events-auto fixed bottom-6 right-6 z-[2147483647] max-w-[360px] rounded-xl border px-4 py-3 shadow-[0_10px_35px_rgba(0,0,0,0.35)]",
        paletteClassName
      ].join(" ")}>
      <p className="text-sm font-medium leading-5">{message}</p>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-sm font-semibold text-sky-200 underline underline-offset-2 hover:text-sky-100">
          {actionLabel}
        </a>
      ) : null}
    </div>
  )
}
