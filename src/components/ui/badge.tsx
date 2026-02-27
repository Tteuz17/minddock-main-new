import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "~/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-white/8 text-white",
        yellow: "bg-action/15 text-action",
        green: "bg-success/15 text-success",
        red: "bg-error/15 text-error",
        blue: "bg-info/15 text-info",
        outline: "border border-white/15 text-text-secondary"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
