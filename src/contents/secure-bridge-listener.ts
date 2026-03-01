import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["https://notebooklm.google.com/*"],
  run_at: "document_start"
}

const MESSAGE_SOURCE = "MINDDOCK_HOOK"
const MESSAGE_TYPE = "NOTEBOOK_LIST_UPDATED"
const STORAGE_KEY = "minddock_cached_notebooks"

export interface NotebookEntry {
  id: string
  title: string
}

interface BridgeEnvelope {
  source?: unknown
  type?: unknown
  payload?: unknown
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim()
}

function isNotebookEntry(value: unknown): value is NotebookEntry {
  if (!isObjectRecord(value)) {
    return false
  }

  return normalizeString(value.id).length > 0 && normalizeString(value.title).length > 0
}

function resolveNotebookEntries(payload: unknown): NotebookEntry[] | null {
  if (!Array.isArray(payload)) {
    return null
  }

  const notebooks = new Map<string, NotebookEntry>()

  for (const candidate of payload) {
    if (!isNotebookEntry(candidate)) {
      return null
    }

    const notebook: NotebookEntry = {
      id: normalizeString(candidate.id),
      title: normalizeString(candidate.title)
    }

    notebooks.set(notebook.id, notebook)
  }

  return Array.from(notebooks.values())
}

function isTrustedBridgeEvent(event: MessageEvent<unknown>): event is MessageEvent<BridgeEnvelope> {
  if (event.source !== window) {
    return false
  }

  if (!isObjectRecord(event.data)) {
    return false
  }

  return normalizeString(event.data.source) === MESSAGE_SOURCE
}

function notifyCacheUpdated(): void {
  try {
    chrome.runtime.sendMessage({ type: "CACHE_UPDATED" }, () => {
      void chrome.runtime.lastError
    })
  } catch {
    // Silent by design: the page must not be affected by extension errors.
  }
}

function logNotebookSync(notebooks: NotebookEntry[]): void {
  console.group("⚓ MindDock Bridge Debug")
  console.log("Quantidade:", notebooks.length)
  console.table(notebooks)
  console.groupEnd()
}

function persistNotebookCache(notebooks: NotebookEntry[]): void {
  try {
    chrome.storage.local.set(
      {
        [STORAGE_KEY]: notebooks
      },
      () => {
        if (chrome.runtime.lastError) {
          return
        }

        notifyCacheUpdated()
        logNotebookSync(notebooks)
      }
    )
  } catch {
    // Silent by design: the page must not be affected by extension errors.
  }
}

function handleBridgeMessage(event: MessageEvent<unknown>): void {
  try {
    if (!isTrustedBridgeEvent(event)) {
      return
    }

    if (normalizeString(event.data.type) !== MESSAGE_TYPE) {
      return
    }

    const notebooks = resolveNotebookEntries(event.data.payload)
    if (notebooks === null) {
      return
    }

    persistNotebookCache(notebooks)
  } catch {
    // Silent by design: the page must not be affected by extension errors.
  }
}

window.addEventListener("message", handleBridgeMessage)
