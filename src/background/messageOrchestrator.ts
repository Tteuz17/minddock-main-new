import { executeDriveMultipartUpload } from "./services/cloudDocumentCreator"
import { initiateNotionLogin } from "./services/notionAuthManager"
import { type RawTextBlock } from "./services/notionBlockTranslator"
import { executeNotionPageCreation } from "./services/workspaceCloudExporter"

interface CreateCloudDocPayload {
  html?: unknown
  title?: unknown
}

interface ExportWorkspaceNotionPayload {
  pageTitle?: unknown
  rawTextBlocks?: unknown
  parsedData?: unknown
}

interface BackgroundActionMessage {
  action?: unknown
  payload?: unknown
}

interface MessageOrchestratorResponse {
  success: boolean
  url?: string
  data?: {
    url: string
  }
  error?: string
}

const CREATE_CLOUD_DOC_ACTION = "CREATE_CLOUD_DOC"
const CONNECT_NOTION_ACCOUNT_ACTION = "CONNECT_NOTION_ACCOUNT"
const EXPORT_WORKSPACE_NOTION_ACTION = "EXPORT_WORKSPACE_NOTION"

let isCloudDocMessageOrchestratorReady = false

function resolveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected cloud document export error."
}

function normalizeCloudDocPayload(rawPayload: CreateCloudDocPayload | undefined): {
  html: string
  title: string
} {
  return {
    html: String(rawPayload?.html ?? "").trim(),
    title: String(rawPayload?.title ?? "").trim() || "NotebookLM Chat Export"
  }
}

function normalizeStructuredNotionPayload(rawPayload: ExportWorkspaceNotionPayload | undefined): {
  pageTitle: string
  rawTextBlocks: RawTextBlock[]
} {
  const structuredChatNodes: RawTextBlock[] = []
  const rawParsedData = rawPayload?.rawTextBlocks

  if (Array.isArray(rawParsedData)) {
    for (const item of rawParsedData) {
      const typeToken = String((item as RawTextBlock | undefined)?.type ?? "").trim()
      const text = String((item as RawTextBlock | undefined)?.text ?? "").trim()
      if (!typeToken || !text) {
        continue
      }

      structuredChatNodes.push({
        type: typeToken,
        text
      })
    }
  }

  if (structuredChatNodes.length === 0 && Array.isArray(rawPayload?.parsedData)) {
    for (const item of rawPayload.parsedData) {
      const typeToken = String((item as { type?: unknown } | undefined)?.type ?? "").trim()
      const content = String((item as { content?: unknown } | undefined)?.content ?? "").trim()
      if (!typeToken || !content) {
        continue
      }
      structuredChatNodes.push({
        type: typeToken,
        text: content
      })
    }
  }

  return {
    pageTitle: String(rawPayload?.pageTitle ?? "").trim() || "NotebookLM Chat Export",
    rawTextBlocks: structuredChatNodes
  }
}

export function initializeMessageOrchestrator(): void {
  if (isCloudDocMessageOrchestratorReady) {
    return
  }

  chrome.runtime.onMessage.addListener(
    (
      message: BackgroundActionMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: MessageOrchestratorResponse) => void
    ) => {
      const action = String(message?.action ?? "").trim()
      if (action === CREATE_CLOUD_DOC_ACTION) {
        const payload = normalizeCloudDocPayload(message?.payload as CreateCloudDocPayload | undefined)
        if (!payload.html) {
          sendResponse({
            success: false,
            error: "No chat HTML payload was provided."
          })
          return false
        }

        void executeDriveMultipartUpload(payload.html, payload.title)
          .then((cloudDocumentUrl) => {
            sendResponse({
              success: true,
              url: cloudDocumentUrl,
              data: {
                url: cloudDocumentUrl
              }
            })
          })
          .catch((error) => {
            sendResponse({
              success: false,
              error: resolveErrorMessage(error)
            })
          })

        return true
      }

      if (action === EXPORT_WORKSPACE_NOTION_ACTION) {
        const payload = normalizeStructuredNotionPayload(message?.payload as ExportWorkspaceNotionPayload | undefined)
        if (payload.rawTextBlocks.length === 0) {
          sendResponse({
            success: false,
            error: "No structured chat payload was provided."
          })
          return false
        }

        void executeNotionPageCreation(payload.pageTitle, payload.rawTextBlocks)
          .then((pageUrl) => {
            sendResponse({
              success: true,
              url: pageUrl,
              data: {
                url: pageUrl
              }
            })
          })
          .catch((error) => {
            sendResponse({
              success: false,
              error: resolveErrorMessage(error)
            })
          })

        return true
      }

      if (action === CONNECT_NOTION_ACCOUNT_ACTION) {
        void initiateNotionLogin()
          .then(() => {
            sendResponse({
              success: true
            })
          })
          .catch((error) => {
            sendResponse({
              success: false,
              error: resolveErrorMessage(error)
            })
          })

        return true
      }

      return false
    }
  )

  isCloudDocMessageOrchestratorReady = true
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  initializeMessageOrchestrator()
}
