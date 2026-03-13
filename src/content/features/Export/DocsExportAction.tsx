import { Loader2 } from "lucide-react"
import { useCallback, useState, type MouseEvent } from "react"
import { showMindDockToast } from "../../../../contents/common/minddock-ui"
import { ToastNotifier } from "~/content/components/ToastNotifier"
import { extractCurrentChatAsHtml } from "./ConversationHtmlExtractor"

interface DocsExportActionProps {
  disabled?: boolean
  className?: string
  onExportFinished?: () => void
}

interface CreateCloudDocMessageResponse {
  success?: boolean
  data?: {
    url?: string
  }
  error?: string
}

interface ToastFeedbackState {
  isVisible: boolean
  message: string
  variant: "success" | "error"
  url?: string
}

const CLOUD_DOC_MESSAGE_TIMEOUT_MS = 120_000
const GOOGLE_DOCS_LOGO_SRC = new URL("../../../../public/images/logos/Google_Docs_2020_Logo.svg.png", import.meta.url).href

function normalizeCloudDocUrl(value: unknown): string {
  const normalized = String(value ?? "").trim()
  return normalized
}

function stopActionPropagation(event: MouseEvent<HTMLElement>): void {
  event.preventDefault()
  event.stopPropagation()
}

function requestCloudDocCreation(extractedHtml: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let isSettled = false
    const timeoutId = window.setTimeout(() => {
      if (isSettled) {
        return
      }
      isSettled = true
      reject(new Error("Google Docs export timed out. Please try again."))
    }, CLOUD_DOC_MESSAGE_TIMEOUT_MS)

    try {
      chrome.runtime.sendMessage(
        {
          action: "CREATE_CLOUD_DOC",
          payload: {
            html: extractedHtml,
            title: "NotebookLM Chat Export"
          }
        },
        (response?: CreateCloudDocMessageResponse) => {
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
            reject(new Error(String(response?.error ?? "Google Docs export failed.")))
            return
          }

          const documentUrl = normalizeCloudDocUrl(response?.data?.url)
          if (!documentUrl) {
            reject(new Error("Google Docs URL was not returned by background."))
            return
          }

          resolve(documentUrl)
        }
      )
    } catch (error) {
      if (isSettled) {
        return
      }
      isSettled = true
      window.clearTimeout(timeoutId)
      reject(error instanceof Error ? error : new Error("Unexpected error while contacting the background service."))
    }
  })
}

export function DocsExportAction({ disabled = false, className = "", onExportFinished }: DocsExportActionProps) {
  const [isExporting, setIsExporting] = useState(false)
  const [toastFeedback, setToastFeedback] = useState<ToastFeedbackState>({
    isVisible: false,
    message: "",
    variant: "success",
    url: undefined
  })

  const closeToastFeedback = useCallback(() => {
    setToastFeedback((current) => ({
      ...current,
      isVisible: false
    }))
  }, [])

  const showSuccessToast = useCallback((cloudDocUrl: string) => {
    setToastFeedback({
      isVisible: true,
      message: "Chat exported successfully to Google Docs.",
      variant: "success",
      url: cloudDocUrl
    })
  }, [])

  const showFailureToast = useCallback((message: string) => {
    setToastFeedback({
      isVisible: true,
      message,
      variant: "error",
      url: undefined
    })
  }, [])

  const handleDocsExportMessage = useCallback(async () => {
    if (disabled || isExporting) {
      return
    }

    setIsExporting(true)
    try {
      const extractedHtml = extractCurrentChatAsHtml()
      const cloudDocUrl = await requestCloudDocCreation(extractedHtml)
      showMindDockToast({
        message: "Google Docs export completed.",
        variant: "success",
        timeoutMs: 2400
      })
      showSuccessToast(cloudDocUrl)
      onExportFinished?.()
    } catch (error) {
      showFailureToast(error instanceof Error ? error.message : "Could not export chat to Google Docs.")
    } finally {
      setIsExporting(false)
    }
  }, [disabled, isExporting, onExportFinished, showFailureToast, showSuccessToast])

  const isDisabled = disabled || isExporting

  return (
    <>
      <button
        type="button"
        role="menuitem"
        onMouseDown={stopActionPropagation}
        onClick={(event) => {
          stopActionPropagation(event)
          void handleDocsExportMessage()
        }}
        disabled={isDisabled}
        className={[
          "flex w-full items-center gap-3 rounded-[11px] border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-left text-[13px] transition-colors",
          isDisabled
            ? "cursor-not-allowed opacity-70 text-[#a6aec0]"
            : "cursor-pointer text-[#d0d6e1] hover:border-[#facc15]/20 hover:bg-[#facc15]/[0.06] hover:text-white",
          className
        ].join(" ")}>
        <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-[6px] border border-white/[0.12] bg-[#0a0f16]">
          {isExporting ? (
            <Loader2 size={12} strokeWidth={2} className="animate-spin text-[#facc15]" />
          ) : (
            <img src={GOOGLE_DOCS_LOGO_SRC} alt="Google Docs" className="h-3 w-3 object-contain" />
          )}
        </span>
        <span className="flex-1" translate="no">
          Export to Google Docs
        </span>
      </button>

      <ToastNotifier
        isVisible={toastFeedback.isVisible}
        message={toastFeedback.message}
        variant={toastFeedback.variant}
        url={toastFeedback.url}
        onClose={closeToastFeedback}
      />
    </>
  )
}
