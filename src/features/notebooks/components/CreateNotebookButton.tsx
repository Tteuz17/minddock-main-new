import type { ButtonHTMLAttributes } from "react"
import { useNotebookManager } from "../hooks/useNotebookManager"

interface CreateNotebookButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  notebookName?: string | null
  onCreated?: () => void
}

export function CreateNotebookButton({
  children,
  disabled,
  notebookName,
  onCreated,
  ...buttonProps
}: CreateNotebookButtonProps) {
  const { error, isCreating, handleCreateNotebook } = useNotebookManager()

  const handleClick = async (): Promise<void> => {
    const response = await handleCreateNotebook(notebookName)
    if (response.success) {
      onCreated?.()
    }
  }

  return (
    <>
      <button
        {...buttonProps}
        disabled={disabled || isCreating}
        onClick={() => {
          void handleClick()
        }}
        type={buttonProps.type ?? "button"}>
        {isCreating ? "Loading..." : children ?? "Create Notebook"}
      </button>
      {error ? <span role="alert">{error}</span> : null}
    </>
  )
}
