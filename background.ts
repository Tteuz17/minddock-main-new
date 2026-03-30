/**
 * MindDock - Background Service Worker
 * Inicializa router, auth, context menu e listeners globais.
 */

import "~/background"
import "~/background/messageOrchestrator"
import { authManager } from "~/background/auth-manager"
import { router } from "~/background/router"
import { storageManager } from "~/background/storage-manager"
import type { ChromeMessage, ChromeMessageResponse } from "~/lib/types"
import {
  getFolders,
  saveSnippet,
  DEFAULT_FOLDERS,
} from "~/services/highlight-storage"

const MINDDOCK_SELECTION_CAPTURE_MENU_ID = "MINDDOCK_SELECT_CAPTURE"
const MINDDOCK_HIGHLIGHT_PARENT_ID = "MINDDOCK_HIGHLIGHT_PARENT"
const MINDDOCK_FOLDER_PREFIX = "MINDDOCK_FOLDER_"
const LEGACY_SNIPE_MENU_ID = "minddock_snipe"

function normalizeHexColor(input: unknown): string {
  const raw = String(input ?? "").trim().toLowerCase()
  const match = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!match) {
    return ""
  }

  const value = match[1]
  if (value.length === 3) {
    return `#${value[0]}${value[0]}${value[1]}${value[1]}${value[2]}${value[2]}`
  }

  return `#${value}`
}

function resolveFolderColorDot(input: unknown): string {
  const normalized = normalizeHexColor(input)
  switch (normalized) {
    case "#3b82f6":
      return "\u{1F535}" // blue
    case "#8b5cf6":
      return "\u{1F7E3}" // purple
    case "#f97316":
      return "\u{1F7E0}" // orange
    case "#ef4444":
      return "\u{1F534}" // red
    case "#22c55e":
      return "\u{1F7E2}" // green
    case "#eab308":
      return "\u{1F7E1}" // yellow
    case "#06b6d4":
      return "\u{1F537}" // large blue diamond
    default:
      return "\u{26AA}" // white
  }
}

void authManager.initializeSession().catch((error) => {
  console.warn("[MindDock] Falha ao inicializar sessao:", error)
})

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
  // Remove legacy items
  await removeContextMenu(MINDDOCK_SELECTION_CAPTURE_MENU_ID)
  await removeContextMenu(LEGACY_SNIPE_MENU_ID)
  await removeContextMenu(MINDDOCK_HIGHLIGHT_PARENT_ID)

  const folders = await getFolders().catch(() => DEFAULT_FOLDERS)

  // Parent item
  await createContextMenu({
    id: MINDDOCK_HIGHLIGHT_PARENT_ID,
    title: "MindDock",
    contexts: ["selection"],
  })

  // One submenu item per folder
  for (const folder of folders) {
    const folderName = String(folder.name ?? "").trim()
    const folderIcon = String(folder.icon ?? "").trim() || "\u{1F4C1}"
    const folderColorDot = resolveFolderColorDot(folder.color)
    if (!folderName) {
      continue
    }

    await createContextMenu({
      id: `${MINDDOCK_FOLDER_PREFIX}${folder.id}`,
      parentId: MINDDOCK_HIGHLIGHT_PARENT_ID,
      title: `${folderColorDot} ${folderIcon} ${folderName}`,
      contexts: ["selection"],
    }).catch(() => {})
  }
}
async function rebuildHighlightContextMenu() {
  await ensureMindDockSelectionContextMenu()
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

async function captureSelectionFromContextMenu(
  contextMenuInfo: chrome.contextMenus.OnClickData,
  sourceTabRecord?: chrome.tabs.Tab
) {
  const menuId = String(contextMenuInfo.menuItemId)
  if (!menuId.startsWith(MINDDOCK_FOLDER_PREFIX)) {
    return
  }

  const selectedTextContent = String(contextMenuInfo.selectionText ?? "").trim()
  if (!selectedTextContent) return

  const tabTitle = String(sourceTabRecord?.title ?? "").trim()
  const sourceUrl = String(sourceTabRecord?.url ?? "").trim()

  const folderId = menuId.slice(MINDDOCK_FOLDER_PREFIX.length)
  if (!folderId) {
    return
  }

  await saveSnippet(folderId, selectedTextContent, tabTitle || "Untitled", sourceUrl)
}
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") {
    console.log("[MindDock] Instalado. Bem-vindo!")
    await storageManager.initDefaults()
    chrome.tabs.create({ url: "https://minddocklm.digital/welcome" })
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

chrome.contextMenus.onClicked.addListener((contextMenuInfo, sourceTabRecord) => {
  void captureSelectionFromContextMenu(contextMenuInfo, sourceTabRecord)
})

// Register context menus every time the service worker starts (MV3 lifecycle)
void ensureMindDockSelectionContextMenu().catch(() => {})

// Rebuild context menu whenever highlight folders change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes["minddock_highlight_folders"]) {
    void rebuildHighlightContextMenu()
  }
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
