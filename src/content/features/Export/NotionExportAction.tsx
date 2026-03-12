import { FileText, Loader2 } from "lucide-react"
import { useCallback, useState, type MouseEvent } from "react"
import { showMindDockToast } from "../../../../contents/common/minddock-ui"
import { extractChatAsStructuredData } from "./ConversationJsonExtractor"

interface RawNotionTextBlock {
  type: string
  text: string
}

interface NotionExportActionProps {
  disabled?: boolean
  className?: string
  includeUserTurns?: boolean
  includeSources?: boolean
  onExportFinished?: () => void
}

interface NotionExportMessageResponse {
  success?: boolean
  url?: string
  data?: {
    url?: string
  }
  error?: string
}

const NOTION_EXPORT_TIMEOUT_MS = 120_000
const NOTION_CONNECT_TIMEOUT_MS = 120_000

function stopActionPropagation(event: MouseEvent<HTMLElement>): void {
  event.preventDefault()
  event.stopPropagation()
}

function resolveNotionUrl(response: NotionExportMessageResponse | undefined): string {
  return String(response?.url ?? response?.data?.url ?? "").trim()
}

function requestWorkspaceNotionExport(rawTextBlocks: RawNotionTextBlock[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let isSettled = false
    const timeoutId = window.setTimeout(() => {
      if (isSettled) {
        return
      }
      isSettled = true
      reject(new Error("A exportacao para Notion demorou demais. Tente novamente."))
    }, NOTION_EXPORT_TIMEOUT_MS)

    try {
      chrome.runtime.sendMessage(
        {
          action: "EXPORT_WORKSPACE_NOTION",
          payload: {
            pageTitle: "NotebookLM Chat Export",
            rawTextBlocks
          }
        },
        (response?: NotionExportMessageResponse) => {
          if (isSettled) {
            return
          }

          isSettled = true
          window.clearTimeout(timeoutId)

          const runtimeError = chrome.runtime.lastError
          if (runtimeError) {
            reject(new Error(runtimeError.message || "Failed to contact the background service worker."))
            return
          }

          if (!response?.success) {
            reject(new Error(String(response?.error ?? "Notion export failed.")))
            return
          }

          const notionPageUrl = resolveNotionUrl(response)
          if (!notionPageUrl) {
            reject(new Error("Notion URL was not returned by background."))
            return
          }

          resolve(notionPageUrl)
        }
      )
    } catch (error) {
      if (isSettled) {
        return
      }
      isSettled = true
      window.clearTimeout(timeoutId)
      reject(error instanceof Error ? error : new Error("Falha inesperada ao enviar mensagem para o background."))
    }
  })
}

function requestNotionAccountConnection(): Promise<void> {
  return new Promise((resolve, reject) => {
    let isSettled = false
    const timeoutId = window.setTimeout(() => {
      if (isSettled) {
        return
      }
      isSettled = true
      reject(new Error("A conexao com o Notion demorou demais."))
    }, NOTION_CONNECT_TIMEOUT_MS)

    try {
      chrome.runtime.sendMessage({ action: "CONNECT_NOTION_ACCOUNT" }, (response?: { success?: boolean; error?: string }) => {
        if (isSettled) {
          return
        }

        isSettled = true
        window.clearTimeout(timeoutId)

        const runtimeError = chrome.runtime.lastError
        if (runtimeError) {
          reject(new Error(runtimeError.message || "Falha ao conectar com o Notion."))
          return
        }

        if (!response?.success) {
          reject(new Error(String(response?.error ?? "Falha ao autenticar com o Notion.")))
          return
        }

        resolve()
      })
    } catch (error) {
      if (isSettled) {
        return
      }
      isSettled = true
      window.clearTimeout(timeoutId)
      reject(error instanceof Error ? error : new Error("Falha inesperada ao conectar com o Notion."))
    }
  })
}

export function NotionExportAction({
  disabled = false,
  className = "",
  includeUserTurns = true,
  includeSources = false,
  onExportFinished
}: NotionExportActionProps) {
  const [isExporting, setIsExporting] = useState(false)

  const handleWorkspaceExport = useCallback(async () => {
    if (disabled || isExporting) {
      return
    }

    setIsExporting(true)
    try {
      await requestNotionAccountConnection()

      const structuredChatNodes = extractChatAsStructuredData({
        includeUserTurns,
        includeSources
      })
      if (structuredChatNodes.length === 0) {
        showMindDockToast({
          message: "Nenhum conteudo de conversa visivel para exportar no Notion.",
          variant: "info",
          timeoutMs: 2600
        })
        return
      }

      const rawTextBlocks: RawNotionTextBlock[] = structuredChatNodes.map((item) => ({
        type: item.type,
        text: item.content
      }))

      const notionPageUrl = await requestWorkspaceNotionExport(rawTextBlocks)
      showMindDockToast({
        message: "Exportacao para Notion concluida.",
        variant: "success",
        timeoutMs: 2400
      })
      window.open(notionPageUrl, "_blank", "noopener,noreferrer")
      onExportFinished?.()
    } catch (error) {
      showMindDockToast({
        message: error instanceof Error ? error.message : "Nao foi possivel exportar o bate-papo para o Notion.",
        variant: "error",
        timeoutMs: 3200
      })
    } finally {
      setIsExporting(false)
    }
  }, [disabled, includeSources, includeUserTurns, isExporting, onExportFinished])

  const isDisabled = disabled || isExporting

  return (
    <button
      type="button"
      role="menuitem"
      onMouseDown={stopActionPropagation}
      onClick={(event) => {
        stopActionPropagation(event)
        void handleWorkspaceExport()
      }}
      disabled={isDisabled}
      className={[
        "flex w-full items-center gap-3 rounded-[11px] border border-white/[0.08] bg-[#101722] px-3 py-2.5 text-left text-[13px] transition-colors",
        isDisabled ? "cursor-not-allowed opacity-70 text-[#a6aec0]" : "cursor-pointer text-[#d0d6e1] hover:bg-[#151b24] hover:text-white",
        className
      ].join(" ")}>
      <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-[6px] border border-white/[0.12] bg-[#0a0f16] text-[#a8b2c6]">
        {isExporting ? <Loader2 size={12} strokeWidth={2} className="animate-spin" /> : <FileText size={12} strokeWidth={2} />}
      </span>
      <span className="flex-1">Exportar para Notion</span>
    </button>
  )
}
