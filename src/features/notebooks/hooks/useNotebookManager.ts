import { useState } from "react"
import { MESSAGE_ACTIONS } from "~/lib/contracts"
import {
  extensionBridge,
  type ExtensionMessage,
  type ExtensionResponse
} from "~/infrastructure/ExtensionBridge"

interface NotebookCreatePayload {
  name?: string | null
  title?: string | null
}

interface NotebookCreateResponsePayload {
  notebookId?: string
  name?: string
  title?: string
}

interface UseNotebookManagerResult {
  error: string | null
  isCreating: boolean
  handleCreateNotebook: (
    notebookName?: string | null
  ) => Promise<ExtensionResponse<NotebookCreateResponsePayload>>
}

export function useNotebookManager(): UseNotebookManagerResult {
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreateNotebook = async (
    notebookName?: string | null
  ): Promise<ExtensionResponse<NotebookCreateResponsePayload>> => {
    if (isCreating) {
      return {
        success: false,
        error: "Criacao de caderno em andamento."
      }
    }

    setIsCreating(true)
    setError(null)

    const normalizedNotebookName = String(notebookName ?? "").trim()
    const message: ExtensionMessage<NotebookCreatePayload> = {
      command: MESSAGE_ACTIONS.CMD_CREATE_NOTEBOOK,
      type: "NOTEBOOK_CREATE",
      payload: {
        name: normalizedNotebookName || null,
        title: normalizedNotebookName || null
      },
      data: {
        title: normalizedNotebookName || "Novo Notebook"
      }
    }

    try {
      const response = await extensionBridge.sendMessage<
        NotebookCreatePayload,
        NotebookCreateResponsePayload
      >(message)

      if (!response.success) {
        throw new Error(String(response.error ?? "").trim() || "Falha ao criar o novo caderno.")
      }

      return response
    } catch (caughtError) {
      const errorMessage =
        caughtError instanceof Error ? caughtError.message : "Erro inesperado ao criar o caderno."
      setError(errorMessage)

      return {
        success: false,
        error: errorMessage
      }
    } finally {
      setIsCreating(false)
    }
  }

  return {
    error,
    isCreating,
    handleCreateNotebook
  }
}
