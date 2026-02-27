import type { AIChatMessage, AIChatPlatform, ChromeMessageResponse } from "~/lib/types"
import { formatChatAsMarkdown } from "~/lib/utils"

interface AppendSourceConversationMessage {
  role: "user" | "assistant"
  content: string
}

interface AppendSourcePayload {
  notebookId?: string
  sourceTitle: string
  sourcePlatform: string
  conversation: AppendSourceConversationMessage[]
  capturedFromUrl: string
}

interface SendChatCaptureInput {
  platform: AIChatPlatform
  platformLabel: string
  title: string
  messages: AIChatMessage[]
  capturedFromUrl: string
}

const DEFAULT_NOTEBOOK_KEYS = ["nexus_default_notebook_id", "minddock_default_notebook"] as const

async function sendRuntimeMessage(
  command: string,
  payload: unknown
): Promise<ChromeMessageResponse<Record<string, unknown>>> {
  return new Promise((resolve) => {
    const runtimeApi = typeof chrome !== "undefined" ? chrome.runtime : undefined
    if (!runtimeApi?.sendMessage) {
      resolve({ success: false, error: "NOT_IN_EXTENSION" })
      return
    }

    runtimeApi.sendMessage({ command, payload }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message })
        return
      }

      resolve(
        (response as ChromeMessageResponse<Record<string, unknown>> | undefined) ?? {
          success: false,
          error: "NO_RESPONSE"
        }
      )
    })
  })
}

async function resolveDefaultNotebookId(): Promise<string | null> {
  const snapshot = await chrome.storage.local.get([
    ...DEFAULT_NOTEBOOK_KEYS,
    "minddock_settings"
  ])

  const settingsNotebookId = String(
    (snapshot.minddock_settings as { defaultNotebookId?: string } | undefined)?.defaultNotebookId ??
      ""
  ).trim()

  if (settingsNotebookId) {
    return settingsNotebookId
  }

  for (const key of DEFAULT_NOTEBOOK_KEYS) {
    const raw = snapshot[key]
    const value = String(raw ?? "").trim()
    if (value) {
      return value
    }
  }

  return null
}

function normalizeConversation(messages: AIChatMessage[]): AppendSourceConversationMessage[] {
  return messages
    .map((message): AppendSourceConversationMessage => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content ?? "").trim()
    }))
    .filter((message) => message.content.length > 0)
}

function isUnsupportedCommand(error: string | undefined): boolean {
  const normalized = String(error ?? "").toLowerCase()
  if (!normalized) {
    return false
  }

  return (
    normalized.includes("comando desconhecido") ||
    normalized.includes("unsupported action") ||
    normalized.includes("could not establish connection")
  )
}

export async function sendChatCaptureToBackground(
  input: SendChatCaptureInput
): Promise<ChromeMessageResponse<Record<string, unknown>>> {
  const conversation = normalizeConversation(input.messages)
  if (conversation.length === 0) {
    return {
      success: false,
      error: "Nenhuma mensagem valida foi encontrada para captura."
    }
  }

  const resolvedTitle =
    String(input.title ?? "").trim() || `Conversa ${input.platformLabel} - ${new Date().toLocaleDateString("pt-BR")}`
  const notebookId = await resolveDefaultNotebookId()

  const protocolPayload: AppendSourcePayload = {
    notebookId: notebookId ?? undefined,
    sourceTitle: resolvedTitle,
    sourcePlatform: input.platformLabel,
    conversation,
    capturedFromUrl: input.capturedFromUrl
  }

  const protocolResponse = await sendRuntimeMessage("PROTOCOL_APPEND_SOURCE", protocolPayload)
  if (protocolResponse.success || !isUnsupportedCommand(protocolResponse.error)) {
    return protocolResponse
  }

  // Fallback de compatibilidade com roteadores legados.
  const markdown = formatChatAsMarkdown(input.platformLabel, conversation, resolvedTitle)
  return sendRuntimeMessage("MINDDOCK_IMPORT_AI_CHAT", {
    platform: input.platform,
    conversationTitle: resolvedTitle,
    content: markdown,
    capturedAt: new Date().toISOString(),
    url: input.capturedFromUrl,
    notebookId: notebookId ?? undefined
  })
}
