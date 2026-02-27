/**
 * MindDock - Background Service Worker
 * Inicializa router, auth, context menu e listeners globais.
 */

import { authManager } from "~/background/auth-manager"
import { router } from "~/background/router"
import { storageManager } from "~/background/storage-manager"
import { MESSAGE_ACTIONS } from "~/lib/contracts"
import type { ChromeMessage, ChromeMessageResponse } from "~/lib/types"

const MINDDOCK_SELECTION_CAPTURE_MENU_ID = "MINDDOCK_SELECT_CAPTURE"
const LEGACY_SNIPE_MENU_ID = "minddock_snipe"

let lastNetworkTokenFingerprint = ""

void authManager.initializeSession().catch((error) => {
  console.warn("[MindDock] Falha ao inicializar sessao:", error)
})

setupNotebookLmNetworkTokenCapture()

function removeContextMenu(menuId: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.contextMenus.remove(menuId, () => {
      void chrome.runtime.lastError
      resolve()
    })
  })
}

function createContextMenu(options: chrome.contextMenus.CreateProperties): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.create(options, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      resolve()
    })
  })
}

async function ensureMindDockSelectionContextMenu() {
  await removeContextMenu(MINDDOCK_SELECTION_CAPTURE_MENU_ID)
  await removeContextMenu(LEGACY_SNIPE_MENU_ID)

  await createContextMenu({
    id: MINDDOCK_SELECTION_CAPTURE_MENU_ID,
    title: "Enviar para o NotebookLM (MindDock)",
    contexts: ["selection"]
  })
}

function notifySelectionNeedsNotebook() {
  if (!chrome.notifications?.create) {
    return
  }

  const manifest = chrome.runtime.getManifest()
  const iconUrl = manifest.icons?.["48"] ?? manifest.icons?.["32"] ?? manifest.icons?.["16"] ?? ""
  if (!iconUrl) {
    return
  }

  chrome.notifications.create({
    type: "basic",
    iconUrl,
    title: "MindDock",
    message: "Selecao em fila. Abra o NotebookLM uma vez para capturar a sessao."
  })
}

async function resolveDefaultNotebookIdForSelection(): Promise<string | null> {
  const settings = await storageManager.getSettings()
  const fromSettings = String(settings.defaultNotebookId ?? "").trim()
  if (fromSettings) {
    return fromSettings
  }

  const snapshot = await chrome.storage.local.get([
    "nexus_default_notebook_id",
    "minddock_default_notebook"
  ])

  const fromCanonical = String(snapshot.nexus_default_notebook_id ?? "").trim()
  if (fromCanonical) {
    return fromCanonical
  }

  const fromLegacy = String(snapshot.minddock_default_notebook ?? "").trim()
  if (fromLegacy) {
    return fromLegacy
  }

  return null
}

async function runRouterCommand(
  message: ChromeMessage,
  sender: chrome.runtime.MessageSender
): Promise<ChromeMessageResponse> {
  return new Promise((resolve) => {
    void router.handle(message, sender, (response) => resolve(response))
  })
}

function shouldKeepPendingSelection(error: string | undefined): boolean {
  const normalized = String(error ?? "").toLowerCase()
  if (!normalized) {
    return false
  }

  return (
    normalized.includes("sessao notebooklm incompleta") ||
    normalized.includes("sessao notebooklm ausente") ||
    normalized.includes("tokens nao disponiveis") ||
    normalized.includes("tokens não disponíveis") ||
    normalized.includes("capturar f.sid") ||
    normalized.includes("f.sid") ||
    normalized.includes("gere trafego")
  )
}

async function flushPendingSelection(): Promise<boolean> {
  const snapshot = await chrome.storage.local.get("minddock_pending_selection")
  const pending = snapshot.minddock_pending_selection as
    | {
        text?: string
        sourceUrl?: string
        sourceTitle?: string
        savedAt?: number
      }
    | undefined

  const pendingContent = String(pending?.text ?? "").trim()
  if (!pendingContent) {
    return false
  }

  const resolvedNotebookId = await resolveDefaultNotebookIdForSelection()
  const sourceTitle =
    String(pending?.sourceTitle ?? "").trim() || `Selection - MindDock - ${buildCaptureTimestampLabel()}`

  const response = await runRouterCommand(
    {
      command: "MINDDOCK_HIGHLIGHT_SNIPE",
      payload: {
        notebookId: resolvedNotebookId || undefined,
        text: pendingContent,
        content: pendingContent,
        url: String(pending?.sourceUrl ?? ""),
        title: sourceTitle
      }
    },
    {}
  )

  if (response.success) {
    await chrome.storage.local.remove("minddock_pending_selection")
    return true
  }

  if (shouldKeepPendingSelection(response.error)) {
    notifySelectionNeedsNotebook()
    return false
  }

  console.warn("[MindDock] Falha ao enviar selecao pendente:", response.error)
  return false
}

function buildCaptureTimestampLabel(): string {
  return new Date()
    .toISOString()
    .slice(0, 19)
    .split("-")
    .join("")
    .split(":")
    .join("")
    .replace("T", "")
}

function pickFirst(values: unknown): string {
  if (!Array.isArray(values)) {
    return ""
  }

  for (const value of values) {
    const normalized = String(value ?? "").trim()
    if (normalized) {
      return normalized
    }
  }

  return ""
}

function parseFormEncodedRawBody(rawEntries: chrome.webRequest.UploadData[] | undefined): {
  at: string
  bl: string
} {
  if (!Array.isArray(rawEntries)) {
    return { at: "", bl: "" }
  }

  const decoder = new TextDecoder()
  for (const entry of rawEntries) {
    if (!entry?.bytes) {
      continue
    }

    try {
      const bodyText = decoder.decode(new Uint8Array(entry.bytes))
      const params = new URLSearchParams(bodyText)
      const at = params.get("at")?.trim() ?? ""
      const bl = params.get("bl")?.trim() ?? ""
      if (at || bl) {
        return { at, bl }
      }
    } catch {
      continue
    }
  }

  return { at: "", bl: "" }
}

function setupNotebookLmNetworkTokenCapture() {
  if (!chrome.webRequest?.onBeforeRequest) {
    return
  }

  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      try {
        if (String(details.method ?? "").toUpperCase() !== "POST") {
          return
        }
        if (!String(details.url ?? "").includes("batchexecute")) {
          return
        }

        const requestUrl = new URL(details.url)
        const urlBl = new URL(details.url).searchParams.get("bl")?.trim() ?? ""
        const authUser = requestUrl.searchParams.get("authuser")?.trim() ?? ""
        const sessionId = requestUrl.searchParams.get("f.sid")?.trim() ?? ""
        const formData = details.requestBody?.formData ?? {}
        let at = pickFirst(formData.at)
        let bl = pickFirst(formData.bl) || urlBl

        if (!at || !bl) {
          const rawParsed = parseFormEncodedRawBody(details.requestBody?.raw)
          at = at || rawParsed.at
          bl = bl || rawParsed.bl || urlBl
        }

        if (!at || !bl) {
          return
        }

        const fingerprint = `${at}__${bl}__${authUser}__${sessionId}`
        if (fingerprint === lastNetworkTokenFingerprint) {
          return
        }
        lastNetworkTokenFingerprint = fingerprint

        void runRouterCommand(
          {
            command: MESSAGE_ACTIONS.STORE_SESSION_TOKENS,
            payload: {
              at,
              bl,
              authUser: authUser || undefined,
              sessionId: sessionId || undefined
            }
          },
          {}
        ).then(() => flushPendingSelection())
      } catch {
        // silent
      }
    },
    { urls: ["https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute*"] },
    ["requestBody"]
  )
}

async function captureSelectionFromContextMenu(
  contextMenuInfo: chrome.contextMenus.OnClickData,
  sourceTabRecord?: chrome.tabs.Tab
) {
  if (contextMenuInfo.menuItemId !== MINDDOCK_SELECTION_CAPTURE_MENU_ID) {
    return
  }

  const selectedTextContent = String(contextMenuInfo.selectionText ?? "").trim()
  if (!selectedTextContent) {
    return
  }

  const tabTitle = String(sourceTabRecord?.title ?? "").trim()
  const sourceUrl = String(sourceTabRecord?.url ?? "").trim()
  const timestampLabel = buildCaptureTimestampLabel()
  const sourceTitle = tabTitle
    ? `Selection - ${tabTitle} - ${timestampLabel}`
    : `Selection - MindDock - ${timestampLabel}`
  const sourceBody = [
    `Fonte: ${tabTitle || "Selection"}`,
    `URL: ${sourceUrl || "N/A"}`,
    "",
    selectedTextContent
  ].join("\n")

  await chrome.storage.local.set({
    minddock_pending_selection: {
      text: sourceBody,
      sourceUrl,
      sourceTitle,
      savedAt: Date.now()
    }
  })
  const sentNow = await flushPendingSelection()
  if (!sentNow) {
    void sourceTabRecord
  }
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") {
    console.log("[MindDock] Instalado. Bem-vindo!")
    await storageManager.initDefaults()
    chrome.tabs.create({ url: "https://minddock.app/welcome" })
  }

  if (reason === "update") {
    console.log("[MindDock] Atualizado.")
  }

  await ensureMindDockSelectionContextMenu()
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {})
})

chrome.runtime.onStartup?.addListener(() => {
  void ensureMindDockSelectionContextMenu()
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void router.handle(message, sender, sendResponse)
  return true
})

chrome.contextMenus.onClicked.addListener((contextMenuInfo, sourceTabRecord) => {
  void captureSelectionFromContextMenu(contextMenuInfo, sourceTabRecord)
})

authManager.onAuthStateChange((user) => {
  chrome.runtime.sendMessage({ command: "MINDDOCK_AUTH_CHANGED", payload: { user } }).catch(() => {})
})

if (chrome.alarms?.create && chrome.alarms?.onAlarm) {
  chrome.alarms.create("minddock_cleanup", { periodInMinutes: 60 })
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "minddock_cleanup") {
      void storageManager.cleanExpiredCache()
    }
  })
} else {
  console.warn("[MindDock] API chrome.alarms indisponivel; limpeza periodica desativada.")
}

export {}
