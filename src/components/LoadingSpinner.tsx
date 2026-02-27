import { Loader2 } from "lucide-react"
import { cn } from "~/lib/utils"

interface LoadingSpinnerProps {
  size?: number
  className?: string
  label?: string
}

export function LoadingSpinner({ size = 20, className, label }: LoadingSpinnerProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2", className)}>
      <Loader2 size={size} strokeWidth={1.5} className="animate-spin text-action" />
      {label && <span className="text-xs text-text-tertiary">{label}</span>}
    </div>
  )
}
