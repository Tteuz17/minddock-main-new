import * as React from "react"
import { cn } from "~/lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, leftIcon, rightIcon, ...props }, ref) => {
    if (leftIcon || rightIcon) {
      return (
        <div className="relative flex items-center">
          {leftIcon && (
            <span className="absolute left-3 text-text-tertiary pointer-events-none">
              {leftIcon}
            </span>
          )}
          <input
            type={type}
            className={cn(
              "flex h-8 w-full rounded-md bg-bg-secondary border border-white/8 px-3 py-2 text-sm text-white",
              "placeholder:text-text-tertiary",
              "focus:outline-none focus:border-action focus:ring-1 focus:ring-action/20",
              "disabled:cursor-not-allowed disabled:opacity-50",
              "transition-all duration-200",
              leftIcon && "pl-9",
              rightIcon && "pr-9",
              className
            )}
            ref={ref}
            {...props}
          />
          {rightIcon && (
            <span className="absolute right-3 text-text-tertiary pointer-events-none">
              {rightIcon}
            </span>
          )}
        </div>
      )
    }

    return (
      <input
        type={type}
        className={cn(
          "flex h-8 w-full rounded-md bg-bg-secondary border border-white/8 px-3 py-2 text-sm text-white",
          "placeholder:text-text-tertiary",
          "focus:outline-none focus:border-action focus:ring-1 focus:ring-action/20",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "transition-all duration-200",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
