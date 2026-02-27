import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "~/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-btn font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action/50 disabled:pointer-events-none disabled:opacity-40 active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary: "bg-action text-black hover:bg-action-hover",
        secondary:
          "bg-transparent border border-white/10 text-white hover:bg-white/8 hover:border-white/20",
        ghost: "bg-transparent text-text-secondary hover:text-white hover:bg-white/5",
        destructive: "bg-error/15 text-error border border-error/20 hover:bg-error/25",
        link: "text-action underline-offset-4 hover:underline p-0 h-auto"
      },
      size: {
        sm: "h-7 px-2.5 text-xs rounded",
        md: "h-8 px-3.5 text-sm",
        lg: "h-10 px-5 text-sm",
        icon: "h-8 w-8 p-0"
      }
    },
    defaultVariants: {
      variant: "secondary",
      size: "md"
    }
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
