import { authManager } from "./auth-manager"
import { initializeMessageRouter } from "./MessageRouter"
import { initializeMessageOrchestrator } from "./messageOrchestrator"
import { router } from "./router"
import { storageManager } from "./storage-manager"
import {
  buildNotebookAccountKey,
  buildScopedStorageKey,
  isDefaultNotebookAccountKey,
  normalizeAccountEmail,
  normalizeAuthUser
} from "~/lib/notebook-account-scope"
import type { ChromeMessage, ChromeMessageResponse } from "~/lib/types"

const MINDDOCK_SELECTION_CAPTURE_MENU_ID = "MINDDOCK_SELECT_CAPTURE"
const LEGACY_SNIPE_MENU_ID = "minddock_snipe"
const SETTINGS_KEY = "minddock_settings"
const AUTH_USER_KEY = "nexus_auth_user"
const ACCOUNT_EMAIL_KEY = "nexus_notebook_account_email"
const TOKEN_STORAGE_KEY = "notebooklm_session"
const DEFAULT_NOTEBOOK_KEY = "nexus_default_notebook_id"
const LEGACY_DEFAULT_NOTEBOOK_KEY = "minddock_default_notebook"
const SELECTION_MENU_CONTEXTS: chrome.contextMenus.ContextType[] = ["selection", "page"]
const hasContextMenusApi =
  typeof chrome !== "undefined" &&
  typeof (chrome as { contextMenus?: unknown }).contextMenus === "object" &&
  typeof (chrome as { contextMenus?: { create?: unknown } }).contextMenus?.create === "function" &&
  typeof (chrome as { contextMenus?: { update?: unknown } }).contextMenus?.update === "function"

let ensureSelectionMenuInFlight: Promise<void> | null = null

function createOrUpdateSelectionContextMenu(): Promise<void> {
  if (!hasContextMenusApi) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    chrome.contextMenus.create(
      {
        id: MINDDOCK_SELECTION_CAPTURE_MENU_ID,
        title: "MindDock: Enviar para NotebookLM",
        contexts: SELECTION_MENU_CONTEXTS
      },
      () => {
        const createError = chrome.runtime.lastError
        if (!createError) {
          resolve()
          return
        }

        const createErrorMessage = String(createError.message ?? "")
        if (!/duplicate id/i.test(createErrorMessage)) {
          reject(new Error(createErrorMessage || "Falha ao criar menu de contexto."))
          return
        }

        chrome.contextMenus.update(
          MINDDOCK_SELECTION_CAPTURE_MENU_ID,
          {
            title: "MindDock: Enviar para NotebookLM",
            contexts: SELECTION_MENU_CONTEXTS
          },
          () => {
            const updateError = chrome.runtime.lastError
            if (updateError) {
              reject(new Error(String(updateError.message ?? "Falha ao atualizar menu de contexto.")))
              return
            }
            resolve()
          }
        )
      }
    )
  })
}

async function ensureMindDockSelectionContextMenu(): Promise<void> {
  if (!hasContextMenusApi || !chrome.contextMenus?.remove) {
    return
  }

  if (ensureSelectionMenuInFlight) {
    return ensureSelectionMenuInFlight
  }

  ensureSelectionMenuInFlight = (async () => {
    await new Promise<void>((resolve) => {
      chrome.contextMenus.remove(LEGACY_SNIPE_MENU_ID, () => {
        void chrome.runtime.lastError
        resolve()
      })
    })
    await createOrUpdateSelectionContextMenu()
    console.log("[MindDock] Context menu de selecao registrado.")
  })().finally(() => {
    ensureSelectionMenuInFlight = null
  })

  return ensureSelectionMenuInFlight
}

function notifySelectionNeedsNotebook(): void {
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
  const snapshot = (await chrome.storage.local.get([
    SETTINGS_KEY,
    AUTH_USER_KEY,
    ACCOUNT_EMAIL_KEY,
    TOKEN_STORAGE_KEY,
    DEFAULT_NOTEBOOK_KEY,
    LEGACY_DEFAULT_NOTEBOOK_KEY
  ])) as Record<string, unknown>

  const settings =
    typeof snapshot[SETTINGS_KEY] === "object" && snapshot[SETTINGS_KEY] !== null
      ? (snapshot[SETTINGS_KEY] as Record<string, unknown>)
      : {}

  const session =
    typeof snapshot[TOKEN_STORAGE_KEY] === "object" && snapshot[TOKEN_STORAGE_KEY] !== null
      ? (snapshot[TOKEN_STORAGE_KEY] as Record<string, unknown>)
      : {}

  const accountEmail = normalizeAccountEmail(
    settings.notebookAccountEmail ?? snapshot[ACCOUNT_EMAIL_KEY] ?? session.accountEmail
  )
  const authUser = normalizeAuthUser(
    settings.authUser ?? settings.notebookAuthUser ?? snapshot[AUTH_USER_KEY] ?? session.authUser
  )
  const accountKey = buildNotebookAccountKey({ accountEmail, authUser })

  const defaultByAccount =
    typeof settings.defaultNotebookByAccount === "object" && settings.defaultNotebookByAccount !== null
      ? (settings.defaultNotebookByAccount as Record<string, unknown>)
      : {}
  const fromScopedSettings = String(defaultByAccount[accountKey] ?? "").trim()
  if (fromScopedSettings) {
    return fromScopedSettings
  }

  const scopedDefaultKey = buildScopedStorageKey(DEFAULT_NOTEBOOK_KEY, accountKey)
  const scopedLegacyDefaultKey = buildScopedStorageKey(LEGACY_DEFAULT_NOTEBOOK_KEY, accountKey)
  const scopedSnapshot = await chrome.storage.local.get([scopedDefaultKey, scopedLegacyDefaultKey])

  const fromScopedCanonical = String(scopedSnapshot[scopedDefaultKey] ?? "").trim()
  if (fromScopedCanonical) {
    return fromScopedCanonical
  }

  const fromScopedLegacy = String(scopedSnapshot[scopedLegacyDefaultKey] ?? "").trim()
  if (fromScopedLegacy) {
    return fromScopedLegacy
  }

  if (isDefaultNotebookAccountKey(accountKey)) {
    const fromSettings = String(settings.defaultNotebookId ?? "").trim()
    if (fromSettings) {
      return fromSettings
    }
  }

  const fromCanonical = String(snapshot[DEFAULT_NOTEBOOK_KEY] ?? "").trim()
  if (fromCanonical) {
    return fromCanonical
  }

  const fromLegacy = String(snapshot[LEGACY_DEFAULT_NOTEBOOK_KEY] ?? "").trim()
  if (fromLegacy) {
    return fromLegacy
  }

  const fromSettings = String(settings.defaultNotebookId ?? "").trim()
  if (fromSettings) {
    return fromSettings
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
    normalized.includes("tokens nÃ£o disponÃ­veis") ||
    normalized.includes("capturar f.sid") ||
    normalized.includes("f.sid") ||
    normalized.includes("gere trafego")
  )
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
    String(pending?.sourceTitle ?? "").trim() || `[SELEÇÃO] MindDock - ${buildCaptureTimestampLabel()}`

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

async function captureSelectionFromContextMenu(
  contextMenuInfo: chrome.contextMenus.OnClickData,
  sourceTabRecord?: chrome.tabs.Tab
): Promise<void> {
  const clickedMenuId = String(contextMenuInfo.menuItemId ?? "")
  if (clickedMenuId !== MINDDOCK_SELECTION_CAPTURE_MENU_ID && clickedMenuId !== LEGACY_SNIPE_MENU_ID) {
    return
  }

  const selectedTextContent = String(contextMenuInfo.selectionText ?? "").trim()
  if (!selectedTextContent) {
    if (chrome.notifications?.create) {
      const manifest = chrome.runtime.getManifest()
      const iconUrl = manifest.icons?.["48"] ?? manifest.icons?.["32"] ?? manifest.icons?.["16"] ?? ""
      if (iconUrl) {
        chrome.notifications.create({
          type: "basic",
          iconUrl,
          title: "MindDock",
          message: "Selecione um texto antes de usar 'Enviar para NotebookLM'."
        })
      }
    }
    return
  }

  const tabTitle = String(sourceTabRecord?.title ?? "").trim()
  const sourceUrl = String(sourceTabRecord?.url ?? "").trim()
  const timestampLabel = buildCaptureTimestampLabel()
  const sourceTitle = tabTitle
    ? `[SELEÇÃO] ${tabTitle} - ${timestampLabel}`
    : `[SELEÇÃO] MindDock - ${timestampLabel}`
  const sourceBody = [
    `Fonte: ${tabTitle || "Selection"}`,
    "-----",
    `URL: ${sourceUrl || "N/A"}`,
    "-----",
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

  void flushPendingSelection()
}

console.log("[MindDock] Background Service Worker started")
initializeMessageOrchestrator()
initializeMessageRouter()

void authManager.initializeSession().catch((error) => {
  console.warn("[MindDock] Falha ao inicializar sessao:", error)
})

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  // Remove any legacy dev bypass keys that may have been stored in older versions
  await chrome.storage.local.remove("minddock_dev_auth_bypass").catch(() => {})

  if (reason === "install") {
    console.log("[MindDock] Instalado. Bem-vindo!")
    await storageManager.initDefaults()
    chrome.tabs?.create?.({ url: "https://minddocklm.digital/welcome" })
  }

  if (reason === "update") {
    console.log("[MindDock] Atualizado.")
  }

  await ensureMindDockSelectionContextMenu()
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {})
  }
})

chrome.runtime.onStartup?.addListener(() => {
  void ensureMindDockSelectionContextMenu()
})

void ensureMindDockSelectionContextMenu().catch((error) => {
  console.warn("[MindDock] Falha ao registrar menu de selecao:", error)
})

if (chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener((contextMenuInfo, sourceTabRecord) => {
    void captureSelectionFromContextMenu(contextMenuInfo, sourceTabRecord)
  })
}

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
