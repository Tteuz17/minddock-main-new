export interface ExtensionMessage<TPayload = Record<string, unknown>> {
  command?: string
  payload?: TPayload
  type?: string
  data?: Record<string, unknown>
}

export interface ExtensionResponse<TPayload = Record<string, unknown>> {
  success: boolean
  error?: string
  payload?: TPayload
  data?: TPayload
  mock?: boolean
}

class ExtensionBridge {
  private static instance: ExtensionBridge | null = null

  static getInstance(): ExtensionBridge {
    if (!ExtensionBridge.instance) {
      ExtensionBridge.instance = new ExtensionBridge()
    }

    return ExtensionBridge.instance
  }

  async sendMessage<TPayload = Record<string, unknown>, TResponse = Record<string, unknown>>(
    message: ExtensionMessage<TPayload>
  ): Promise<ExtensionResponse<TResponse>> {
    const runtimeApi = typeof chrome !== "undefined" ? chrome.runtime : undefined

    if (!runtimeApi?.sendMessage) {
      console.warn("Mocking message:", message)
      return {
        success: true,
        mock: true
      }
    }

    return new Promise((resolve) => {
      try {
        runtimeApi.sendMessage(message, (response?: ExtensionResponse<TResponse>) => {
          const runtimeErrorMessage = String(chrome.runtime?.lastError?.message ?? "").trim()
          if (runtimeErrorMessage) {
            resolve({
              success: false,
              error: this.normalizeRuntimeError(runtimeErrorMessage)
            })
            return
          }

          resolve(
            response ?? {
              success: false,
              error: "NO_RESPONSE"
            }
          )
        })
      } catch (error) {
        const errorMessage =
          error instanceof Error ? this.normalizeRuntimeError(error.message) : "SEND_MESSAGE_FAILED"

        resolve({
          success: false,
          error: errorMessage
        })
      }
    })
  }

  private normalizeRuntimeError(errorMessage: string): string {
    const normalizedMessage = String(errorMessage ?? "").trim()

    if (normalizedMessage.includes("Extension context invalidated")) {
      return "EXTENSION_UPDATED"
    }

    return normalizedMessage || "SEND_MESSAGE_FAILED"
  }
}

export const extensionBridge = ExtensionBridge.getInstance()
