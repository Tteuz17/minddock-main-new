import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ChevronDown, Download, Eye, FileText, Loader2, Search } from "lucide-react"
import { jsPDF } from "jspdf"
import { MESSAGE_ACTIONS, type StandardResponse } from "~/lib/contracts"
import { base64ToBytes } from "~/lib/base64-bytes"
import {
  buildDocxBytesFromText,
  buildMindDuckFilenameBase,
  buildMindDockZipBase,
  buildZip,
  sanitizeFilename,
  triggerDownload
} from "~/lib/source-download"
import { buildNotebookAccountKey, buildScopedStorageKey, resolveAuthUserFromUrl } from "~/lib/notebook-account-scope"
import { EXCLUDED_FROM_EXPORT, resolveFileExtension } from "../../src/background/studioArtifacts"
import { queryDeepAll, resolveStudioLabelText } from "./sourceDom"
import { useMindDockPortal } from "./useMindDockPortal"
import {
  EXPORT_PREVIEW_CLOSE_EVENT,
  EXPORT_PREVIEW_OPEN_EVENT,
  EXPORT_PREVIEW_UPDATE_EVENT,
  type ExportPreviewOpenDetail
} from "./ExportPreviewPanel"

const CONTEXT_EVENT = "MINDDOCK_RPC_CONTEXT"
const NATIVE_SLIDES_DOWNLOAD_EVENT = "MINDDOCK_NATIVE_SLIDES_DOWNLOAD_URL"
const NATIVE_SLIDES_CAPTURE_ONLY_EVENT = "MINDDOCK_NATIVE_SLIDES_CAPTURE_ONLY"
const STUDIO_EXPORT_MODAL_STATE_EVENT = "MINDDOCK_STUDIO_EXPORT_MODAL_STATE"
const NATIVE_SLIDES_DOWNLOAD_RE = /^https:\/\/contribution\.usercontent\.google\.com\/download\?/i

const SLIDES_PDF_CACHE_TTL = 25_000
const SLIDES_NATIVE_WAIT_TIMEOUT_MS = 3_500
const TOAST_MIN_VISIBLE_MS = 650

interface NativePdfEntry {
  url: string
  ts: number
}

const nativeSlidePdfCache = new Map<string, NativePdfEntry>()

function resolveNativeSlidesNotebookKey(notebookId?: string | null): string {
  const direct = String(notebookId ?? "").trim()
  if (direct) return direct
  const fromUrl = String(resolveNotebookIdFromUrl() ?? "").trim()
  return fromUrl || "_default"
}

function rememberNativeSlidesPdfUrl(url: string, notebookId?: string | null): void {
  const normalized = String(url ?? "").trim()
  if (!normalized || !NATIVE_SLIDES_DOWNLOAD_RE.test(normalized)) return
  const key = resolveNativeSlidesNotebookKey(notebookId)
  nativeSlidePdfCache.set(key, { url: normalized, ts: Date.now() })
  console.log("[MindDock][NativeSlidesURL] captured", { url: normalized, notebookId: key })
}

function consumeNativeSlidesPdfUrl(notebookId?: string | null, maxAgeMs = SLIDES_PDF_CACHE_TTL): string | null {
  const key = resolveNativeSlidesNotebookKey(notebookId)
  const fallbackKeys = Array.from(new Set([key, "_default"]))
  let sourceKey: string | null = null
  let entry: NativePdfEntry | undefined

  for (const candidateKey of fallbackKeys) {
    const candidate = nativeSlidePdfCache.get(candidateKey)
    if (!candidate) continue
    sourceKey = candidateKey
    entry = candidate
    break
  }

  if (!entry || !sourceKey) return null

  if (Date.now() - entry.ts > maxAgeMs) {
    nativeSlidePdfCache.delete(sourceKey)
    return null
  }

  nativeSlidePdfCache.delete(sourceKey)
  return entry.url
}

async function waitForNativeSlidesPdfUrl(
  notebookId: string | undefined,
  timeoutMs = SLIDES_NATIVE_WAIT_TIMEOUT_MS,
  intervalMs = 300
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const url = consumeNativeSlidesPdfUrl(notebookId)
    if (url) return url
    await sleep(intervalMs)
  }
  return null
}

if (!(window as unknown as Record<string, unknown>).__minddock_rpc_listener_added) {
  ;(window as unknown as Record<string, unknown>).__minddock_rpc_listener_added = true
  window.addEventListener("message", (event) => {
    if (event.source !== window) return
    const data = (event as MessageEvent).data as
      | { source?: string; type?: string; payload?: Record<string, unknown> | unknown }
      | null
    if (!data || data.source !== "minddock") return
    if (data.type === CONTEXT_EVENT) {
      ;(window as unknown as Record<string, unknown>).__minddock_rpc_context = data.payload
      return
    }
    if (data.type === NATIVE_SLIDES_DOWNLOAD_EVENT) {
      const payload = (data.payload ?? {}) as Record<string, unknown>
      const url = String(payload.url ?? "")
      const notebookId = String(payload.notebookId ?? "").trim()
      if (url) rememberNativeSlidesPdfUrl(url, notebookId || undefined)
    }
  })
}

const SHADOW_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :host { all: initial; font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; }

  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    pointer-events: auto;
  }
  .overlay[data-preview-active="true"] {
    pointer-events: none;
  }
  .overlay-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0,0,0,0.88);
    backdrop-filter: blur(1px);
    -webkit-backdrop-filter: blur(1px);
    pointer-events: auto;
  }

  .panel {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 920px;
    max-height: 88vh;
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.14);
    background: #000;
    color: #e2e6ee;
    box-shadow: 0 18px 48px rgba(0,0,0,0.56);
    pointer-events: auto;
  }
  .panel::before {
    content: '';
    position: absolute;
    inset-x: 0; top: 0;
    height: 1px;
    background: rgba(255,255,255,0.16);
    border-radius: 14px 14px 0 0;
  }

  .inner { position: relative; z-index: 1; display: flex; flex: 1; flex-direction: column; min-height: 0; }

  .header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255,255,255,0.12);
    background: #060606;
    flex-shrink: 0;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.16);
    background: #0b0b0b;
    padding: 3px 8px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #b7c0cf;
  }
  .badge svg { color: #facc15; }

  .badge-dot { width: 7px; height: 7px; border-radius: 50%; background: #facc15; flex-shrink: 0; }

  .title { font-size: 28px; font-weight: 600; color: #fff; margin-top: 8px; line-height: 1; }
  .subtitle { font-size: 13px; color: #9da7b8; margin-top: 6px; max-width: 640px; line-height: 1.6; }

  .close-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px; height: 40px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.2);
    background: #0a0a0a;
    color: #a9b2c1;
    cursor: pointer;
    font-size: 16px;
    transition: border-color 150ms, background 150ms, color 150ms;
  }
  .close-btn:hover { border-color: rgba(250,204,21,0.55); background: #151209; color: #facc15; }

  .body { padding: 12px 20px 8px; flex-shrink: 0; }

  .search-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.16);
    background: #0a0a0a;
    padding: 10px 12px;
  }
  .search-bar svg { color: #8f98a8; flex-shrink: 0; }
  .search-bar input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 14px;
    color: #eef2fa;
  }
  .search-bar input::placeholder { color: #7a8391; }

  .format-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.16);
    background: #0c0c0c;
    padding: 10px;
    margin-top: 12px;
  }
  .format-grid.mt-0 { margin-top: 0; }
  @media (max-width: 700px) { .format-grid { grid-template-columns: repeat(2, 1fr); } }

  .fmt-btn {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    min-height: 50px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.16);
    background: #111;
    color: #c8d1de;
    padding: 8px 10px;
    text-align: left;
    cursor: pointer;
    transition: border-color 150ms, background 150ms, color 150ms;
  }
  .fmt-btn:hover { border-color: rgba(250,204,21,0.35); background: #161616; }
  .fmt-btn.active { border-color: #facc15; background: #facc15; color: #131002; }
  .fmt-btn-label { font-size: 14px; font-weight: 600; line-height: 1; }
  .fmt-btn-sub { font-size: 11px; line-height: 1.2; opacity: 0.85; }

  .select-all-row {
    margin-top: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .select-all-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .select-all-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.16);
    background: #0f0f0f;
    padding: 4px 10px;
    color: #d5dbe6;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .select-all-label input,
  .source-item input {
    width: 16px;
    height: 16px;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    background: #0b0b0b;
    border: 1px solid rgba(255,255,255,0.22);
    border-radius: 4px;
    display: inline-grid;
    place-content: center;
  }
  .select-all-label input::after,
  .source-item input::after {
    content: "";
    width: 8px;
    height: 4px;
    border-left: 2px solid #facc15;
    border-bottom: 2px solid #facc15;
    transform: rotate(-45deg) scale(0);
    transition: transform 120ms ease;
  }
  .select-all-label input:checked::after,
  .source-item input:checked::after { transform: rotate(-45deg) scale(1); }
  .select-all-label input:indeterminate::after,
  .source-item input:indeterminate::after {
    width: 8px;
    height: 0;
    border-left: none;
    border-bottom: none;
    border-top: 2px solid #facc15;
    transform: scale(1);
  }
  .select-all-label input:focus-visible,
  .source-item input:focus-visible {
    outline: 2px solid rgba(250, 204, 21, 0.5);
    outline-offset: 2px;
  }
  .select-all-label input:disabled { cursor: not-allowed; opacity: 0.5; }

  .source-list {
    margin: 8px 20px 0;
    min-height: 220px;
    max-height: 330px;
    overflow-y: auto;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.16);
    background: #0c0c0c;
    padding: 8px;
  }
  .source-empty { padding: 24px 12px; font-size: 14px; color: #a4adbc; }
  .source-error { padding: 24px 12px; font-size: 14px; color: #fca5a5; }
  .source-item {
    display: grid;
    grid-template-columns: 20px 1fr;
    align-items: start;
    gap: 8px;
    border-radius: 8px;
    border: 1px solid transparent;
    padding: 10px;
    cursor: pointer;
    transition: border-color 150ms, background 150ms;
  }
  .source-item:hover { border-color: rgba(255,255,255,0.16); background: #131313; }
  .source-item input { margin-top: 2px; }
  .source-item--visual { grid-template-columns: 1fr auto; cursor: default; }
  .source-item--disabled { opacity: 0.6; cursor: default; }
  .source-item--disabled:hover { border-color: transparent; background: transparent; }
  .source-sections {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .source-section {
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 10px;
    background: #0a0a0a;
    padding: 8px;
  }
  .source-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 2px 4px 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  .source-section-title {
    margin: 0;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #9da7b8;
  }
  .source-section-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 20px;
    min-width: 22px;
    padding: 0 7px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.18);
    background: #111;
    color: #d5dbe6;
    font-size: 11px;
    font-weight: 600;
  }
  .source-section-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .source-section-title--split {
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px solid rgba(255,255,255,0.1);
  }
  .source-download-btn {
    border: 1px solid rgba(255,255,255,0.16);
    background: #0b0b0b;
    color: #e5e7eb;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .source-download-btn:hover { border-color: rgba(255,255,255,0.3); }
  .source-title {
    display: block;
    font-size: 14px;
    font-weight: 600;
    color: #f3f4f6;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .source-kind {
    display: block;
    margin-top: 4px;
    font-size: 12px;
    color: #9ca3af;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    word-break: keep-all;
  }

  .preview-list {
    margin: 8px 20px 0;
    min-height: 320px;
    max-height: 420px;
    overflow-y: auto;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.16);
    background: #0c0c0c;
    padding: 10px;
  }
  .source-list,
  .preview-list {
    scrollbar-color: #1f2937 #050505;
    scrollbar-width: thin;
  }
  .source-list::-webkit-scrollbar,
  .preview-list::-webkit-scrollbar { width: 10px; }
  .source-list::-webkit-scrollbar-track,
  .preview-list::-webkit-scrollbar-track { background: #050505; }
  .source-list::-webkit-scrollbar-thumb,
  .preview-list::-webkit-scrollbar-thumb {
    background: #1f2937;
    border-radius: 999px;
    border: 2px solid #050505;
  }
  .preview-empty { padding: 24px 12px; font-size: 14px; color: #9ca3af; }
  .preview-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 600px) { .preview-grid { grid-template-columns: 1fr; } }
  .preview-card {
    display: flex;
    flex-direction: column;
    height: 320px;
    overflow: hidden;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.16);
    background: #111;
  }
  .preview-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.12);
    flex-shrink: 0;
  }
  .preview-card-title { font-size: 14px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .preview-card-sub { font-size: 12px; color: #9ca3af; }
  .preview-card textarea {
    flex: 1;
    resize: none;
    background: transparent;
    border: none;
    outline: none;
    padding: 12px;
    font-size: 13px;
    line-height: 1.6;
    color: #e5e7eb;
    overflow-y: auto;
  }
  .preview-card textarea::placeholder { color: #6b7280; }

  .error-banner {
    margin-bottom: 8px;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid rgba(248,113,113,0.4);
    background: rgba(127,29,29,0.3);
    font-size: 12px;
    color: #fecaca;
  }

  .studio-toast {
    margin: 10px 20px 0;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.16);
    background: #0b0b0b;
    padding: 10px 12px;
  }
  .studio-toast--running { border-color: rgba(250,204,21,0.42); background: #120f02; }
  .studio-toast--success { border-color: rgba(74,222,128,0.45); background: #06120a; }
  .studio-toast--error { border-color: rgba(248,113,113,0.45); background: #1a0707; }
  .studio-toast-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 12px;
    font-weight: 600;
    color: #e8edf7;
    margin-bottom: 6px;
  }
  .studio-toast-msg {
    font-size: 12px;
    line-height: 1.5;
    color: #b9c2d0;
    margin-bottom: 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .studio-toast-track {
    height: 6px;
    border-radius: 999px;
    background: rgba(255,255,255,0.08);
    overflow: hidden;
  }
  .studio-toast-fill {
    height: 100%;
    border-radius: inherit;
    background: #facc15;
    transition: width 220ms ease;
  }
  .studio-toast--success .studio-toast-fill { background: #4ade80; }
  .studio-toast--error .studio-toast-fill { background: #f87171; }

  .footer {
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: 12px;
    padding: 12px 20px 20px;
    flex-shrink: 0;
    margin-top: 12px;
  }

  .btn-ghost {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 54px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.2);
    background: #111;
    color: #d9dfeb;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 150ms, background 150ms;
  }
  .btn-ghost:hover:not(:disabled) { border-color: rgba(250,204,21,0.45); background: #171717; }
  .btn-ghost:disabled { cursor: not-allowed; opacity: 0.45; }

  .studio-refresh-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 4px 10px;
    min-height: 26px;
    border-radius: 7px;
    border: 1px solid rgba(255,255,255,0.2);
    background: #111;
    color: #d9dfeb;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 150ms, background 150ms, color 150ms;
  }
  .studio-refresh-button:hover:not(:disabled) {
    border-color: rgba(250,204,21,0.45);
    background: #171717;
    color: #facc15;
  }
  .studio-refresh-button:disabled { cursor: not-allowed; opacity: 0.55; }

  .btn-primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 54px;
    border-radius: 10px;
    border: 1px solid #eab308;
    background: #facc15;
    color: #1b1400;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 6px 6px 0 rgba(250,204,21,0.18);
    transition: background 150ms;
  }
  .btn-primary:hover:not(:disabled) { background: #fbbf24; }
  .btn-primary:disabled { cursor: not-allowed; opacity: 0.45; }

  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
`

const STUDIO_MODAL_SCOPE_CLASS = "minddock-studio-scope"

function buildScopedStudioCss(cssText: string): string {
  return cssText.replace(/(^|[}\n])(\s*)([^@{}\n][^{}\n]*)\{/g, (match, prefix, whitespace, selectorGroup) => {
    const selectors = String(selectorGroup ?? "")
      .split(",")
      .map((selector) => selector.trim())
      .filter(Boolean)
    if (selectors.length === 0) {
      return match
    }

    const scopedSelectors = selectors.map((selector) => {
      const hostNormalized = selector.replace(/:host/gi, `.${STUDIO_MODAL_SCOPE_CLASS}`)
      if (/^(from|to|\d+%)$/i.test(hostNormalized)) {
        return hostNormalized
      }
      if (hostNormalized.startsWith(`.${STUDIO_MODAL_SCOPE_CLASS}`)) {
        return hostNormalized
      }
      return `.${STUDIO_MODAL_SCOPE_CLASS} ${hostNormalized}`
    })

    return `${prefix}${whitespace}${scopedSelectors.join(", ")} {`
  })
}

const SCOPED_MODAL_CSS = buildScopedStudioCss(SHADOW_CSS)

type StudioFormat = "markdown" | "text" | "pdf" | "docx"

type StudioExportToastStatus = "idle" | "running" | "success" | "error"

interface StudioExportToastState {
  status: StudioExportToastStatus
  message: string
  progress: number
}

interface StudioCacheItem {
  id?: string
  title?: string
  meta?: string
  type?: string
  content?: string
  url?: string
  mimeType?: string
  sourceCount?: number
  updatedAt?: string
  kind?: "text" | "asset"
}

interface StudioEntry {
  id: string
  title: string
  meta?: string
  content?: string
  type?: string
  url?: string
  mimeType?: string
  kind?: "text" | "asset"
  node?: HTMLElement
}


const STUDIO_STORAGE_KEY_BASE = "minddock_cached_studio_items"
const STUDIO_STORAGE_SYNC_KEY_BASE = "minddock_cached_studio_items_synced_at"
const ACCOUNT_EMAIL_KEY = "nexus_notebook_account_email"
const AUTH_USER_KEY = "nexus_auth_user"
const STUDIO_FETCH_MESSAGE = "MINDDOCK_FETCH_STUDIO_ARTIFACTS"
const STUDIO_BINARY_FETCH_MESSAGE = "MINDDOCK_FETCH_BINARY_ASSET"
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function isExtensionContextInvalidatedError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error ?? "")
  return /extension context invalidated/i.test(message)
}

function hasRuntimeSendMessageSafe(): boolean {
  try {
    return Boolean(chrome?.runtime?.sendMessage)
  } catch {
    return false
  }
}

function getStorageLocalSafe(): chrome.storage.StorageArea | null {
  try {
    if (typeof chrome === "undefined") {
      return null
    }
    return chrome.storage?.local ?? null
  } catch {
    return null
  }
}

function getStorageOnChangedSafe(): typeof chrome.storage.onChanged | null {
  try {
    if (typeof chrome === "undefined") {
      return null
    }
    return chrome.storage?.onChanged ?? null
  } catch {
    return null
  }
}

function resolveNotebookIdFromUrl(): string | null {
  const match = window.location.href.match(UUID_RE)
  return match ? match[0] : null
}

function resolveNotebookIdFromRpcContext(
  rpcContext?: { sourcePath?: unknown }
): string | null {
  const sourcePath = typeof rpcContext?.sourcePath === "string" ? rpcContext.sourcePath : ""
  if (!sourcePath) return null
  const match = sourcePath.match(UUID_RE)
  return match ? match[0] : null
}

function collectUuidCandidatesFromElement(el: Element): { id: string; score: number }[] {
  const candidates: { id: string; score: number }[] = []
  const attrs = el.getAttributeNames?.() ?? []
  for (const attr of attrs) {
    const raw = el.getAttribute(attr)
    if (!raw) continue
    const matches = raw.match(new RegExp(UUID_RE.source, "gi")) ?? []
    if (matches.length === 0) continue

    const name = attr.toLowerCase()
    const isAmbiguous = matches.length > 1
    for (const id of matches) {
      let score = 0
      if (name.includes("artifact")) score += 6
      if (name.includes("result")) score += 3
      if (name.includes("studio")) score += 3
      if (name.includes("id")) score += 2
      if (raw.trim() === id) score += 3
      if (raw.length < 90) score += 1
      if (isAmbiguous) score -= 6
      if (raw.length > 220) score -= 2
      candidates.push({ id, score })
    }
  }
  return candidates
}

function resolveStudioArtifactIdFromRow(row: HTMLElement): string | null {
  const notebookId = resolveNotebookIdFromUrl()
  const candidates: { id: string; score: number }[] = []

  const push = (el: Element, proximityBonus = 0) => {
    const next = collectUuidCandidatesFromElement(el)
    next.forEach((candidate) => {
      candidates.push({ id: candidate.id, score: candidate.score + proximityBonus })
    })
  }

  push(row, 8)
  row.querySelectorAll("*").forEach((el) => push(el, 4))

  const owner = row.closest<HTMLElement>("[role='listitem'], li, button, [role='button'], a")
  if (owner && owner !== row) {
    push(owner, 6)
    owner.querySelectorAll("*").forEach((el) => push(el, 2))
  }

  const filtered = candidates.filter((candidate) => candidate.id !== notebookId)
  const bestById = new Map<string, number>()
  for (const candidate of filtered) {
    const current = bestById.get(candidate.id) ?? Number.NEGATIVE_INFINITY
    if (candidate.score > current) {
      bestById.set(candidate.id, candidate.score)
    }
  }
  const ranked = Array.from(bestById.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)

  if (ranked.length === 0) return null
  if ((ranked[0]?.score ?? 0) < 4) return null
  if (ranked.length > 1) {
    const delta = (ranked[0]?.score ?? 0) - (ranked[1]?.score ?? 0)
    if (delta < 1) return null
  }

  return ranked[0]?.id ?? null
}

function collectStudioIdsFromDom(): string[] {
  const UUID_RE_LOCAL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

  const allRows = queryDeepAll<HTMLElement>([
    '[role="listitem"]',
    "button",
    '[data-testid*="result"]',
    '[data-testid*="studio"]'
  ]).filter(isVisibleElement)

  const rows = allRows

  const notebookId = resolveNotebookIdFromUrl()
  const ids = new Set<string>()

  const scan = (el: Element) => {
    for (const attr of el.getAttributeNames?.() ?? []) {
      const value = el.getAttribute(attr)
      if (!value) continue
      const match = value.match(UUID_RE_LOCAL)
      if (match) {
        for (const id of match) ids.add(id)
      }
    }
  }

  for (const row of rows) {
    scan(row)
    row.querySelectorAll("*").forEach(scan)
  }

  if (notebookId) ids.delete(notebookId)

  return [...ids]
}

function resolveRpcContextFromWindow() {
  const ctx = (window as unknown as { __minddock_rpc_context?: unknown }).__minddock_rpc_context
  if (!ctx || typeof ctx !== "object") return undefined

  const record = ctx as Record<string, unknown>

  return {
    fSid: typeof record.fSid === "string" ? record.fSid : undefined,
    bl: typeof record.bl === "string" ? record.bl : undefined,
    hl: typeof record.hl === "string" ? record.hl : undefined,
    socApp: typeof record.socApp === "string" ? record.socApp : undefined,
    socPlatform: typeof record.socPlatform === "string" ? record.socPlatform : undefined,
    socDevice: typeof record.socDevice === "string" ? record.socDevice : undefined,
    sourcePath: typeof record.sourcePath === "string" ? record.sourcePath : undefined,
    at: typeof record.at === "string" ? record.at : undefined
  }
}

function bgLog(data: unknown) {
  void data
}

function toExcerpt(value: unknown, max = 160): string {
  const clean = String(value || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
  return clean.length > max ? `${clean.slice(0, max).trim()}Ã¢â‚¬Â¦` : clean
}

async function requestStudioArtifacts(
  ids: string[],
  options?: { forceRefresh?: boolean; expectedCount?: number; currentCount?: number }
): Promise<StudioCacheItem[]> {
  bgLog({
    tag: "studio-request",
    idsCount: Array.isArray(ids) ? ids.length : 0,
    hasRuntime: hasRuntimeSendMessageSafe()
  })
  if (!hasRuntimeSendMessageSafe()) {
    return []
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    return []
  }

  const notebookId = resolveNotebookIdFromUrl() ?? undefined
  const forceRefresh = Boolean(options?.forceRefresh)
  const expectedCount = typeof options?.expectedCount === "number" ? options.expectedCount : 0
  const currentCount = typeof options?.currentCount === "number" ? options.currentCount : 0
  const needRefresh = expectedCount > 0 && currentCount < expectedCount
  const rpcContext = resolveRpcContextFromWindow()
  const contextNotebookId = resolveNotebookIdFromRpcContext(rpcContext)
  const effectiveNotebookId = notebookId ?? contextNotebookId ?? undefined

  bgLog({
    tag: "studio-open",
    ids,
    notebookId: effectiveNotebookId,
    forceRefresh: forceRefresh || needRefresh
  })

  const response = await new Promise<any>((resolve) => {
    if (!hasRuntimeSendMessageSafe()) {
      resolve({})
      return
    }

    try {
      chrome.runtime.sendMessage(
        {
          type: STUDIO_FETCH_MESSAGE,
          payload: {
            ids,
            notebookId: effectiveNotebookId,
            forceRefresh: forceRefresh || needRefresh,
            rpcContext
          },
          data: {
            ids,
            notebookId: effectiveNotebookId,
            forceRefresh: forceRefresh || needRefresh,
            rpcContext
          }
        },
        (resp) => {
          try {
            void chrome.runtime?.lastError
          } catch {
            // ignore runtime access failures on stale extension contexts
          }
          resolve(resp ?? {})
        }
      )
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) {
        console.warn("[MindDock][Studio] runtime context invalidated while requesting artifacts")
      }
      resolve({})
    }
  })

  const items =
    response?.artifacts ??
    response?.items ??
    response?.payload?.items ??
    response?.data?.items ??
    []

  return Array.isArray(items) ? (items as StudioCacheItem[]) : []
}

async function requestBackgroundBinaryAsset(
  url: string,
  options?: { atToken?: string; authUser?: string | number | null; mode?: "buffer" | "download"; filename?: string }
): Promise<
  | { bytes: Uint8Array; mimeType?: string; size?: number }
  | { downloaded: true; downloadId: number; mimeType?: string; size?: number; filename?: string }
  | null
> {
  console.log("[MindDock][StudioBinaryFetch][CS] request", {
    url,
    hasToken: Boolean(options?.atToken),
    authUser: options?.authUser ?? null,
    mode: options?.mode ?? "buffer",
    filename: options?.filename ?? null
  })

  const response = await new Promise<any>((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: STUDIO_BINARY_FETCH_MESSAGE,
        payload: {
          url,
          atToken: options?.atToken,
          authUser: options?.authUser,
          mode: options?.mode,
          filename: options?.filename
        },
        data: {
          url,
          atToken: options?.atToken,
          authUser: options?.authUser,
          mode: options?.mode,
          filename: options?.filename
        }
      },
      (resp) => resolve(resp ?? {})
    )
  })

  if (!response?.success) {
    console.warn("[MindDock][StudioBinaryFetch][CS] response-fail", {
      url,
      error: response?.error ?? null
    })
    return null
  }
  const payload = response.payload ?? response.data ?? response
  if (payload?.downloaded === true) {
    const downloadId = Number(payload?.downloadId)
    if (Number.isFinite(downloadId)) {
      console.log("[MindDock][StudioBinaryFetch][CS] background-direct-download", {
        url,
        downloadId,
        size: typeof payload?.size === "number" ? payload.size : undefined,
        mimeType: typeof payload?.mimeType === "string" ? payload.mimeType : undefined,
        filename: typeof payload?.filename === "string" ? payload.filename : undefined
      })
      return {
        downloaded: true,
        downloadId,
        size: typeof payload?.size === "number" ? payload.size : undefined,
        mimeType: typeof payload?.mimeType === "string" ? payload.mimeType : undefined,
        filename: typeof payload?.filename === "string" ? payload.filename : undefined
      }
    }
  }

  const base64 = String(payload?.bytesBase64 ?? "").trim()
  if (!base64) {
    console.warn("[MindDock][StudioBinaryFetch][CS] empty-bytes", { url })
    return null
  }

  const bytes = base64ToBytes(base64)
  const mimeType = typeof payload?.mimeType === "string" ? payload.mimeType : undefined
  console.log("[MindDock][StudioBinaryFetch][CS] success", {
    url,
    size: bytes.byteLength,
    mimeType: mimeType ?? null
  })

  return {
    bytes,
    mimeType,
    size: typeof payload?.size === "number" ? payload.size : undefined
  }
}

const STUDIO_FORMAT_OPTIONS: Array<{ id: StudioFormat; label: string; sub: string; noTranslate?: boolean }> = [
  { id: "markdown", label: "Markdown", sub: ".md" },
  { id: "text", label: "Texto simples", sub: ".txt" },
  { id: "pdf", label: "PDF", sub: ".pdf" },
  { id: "docx", label: "Word", sub: ".docx", noTranslate: true }
]

const STUDIO_TYPE_LABELS: Record<string, string> = {
  "1": "ÃƒÂudio Overview",
  "2": "Guia de Estudo",
  "3": "Briefing",
  "4": "Quiz",
  "5": "SumÃƒÂ¡rio",
  "6": "Mind Map",
  "7": "FAQ",
  "8": "Linha do Tempo",
  "9": "Blog Post",
  "10": "InfogrÃƒÂ¡fico",
  "11": "Tabela de Dados",
  "12": "Slides",
  "13": "Flashcards",
  "14": "VÃƒÂ­deo Overview"
}

const STUDIO_ROW_BLOCKLIST = [
  "exportar",
  "export",
  "salvar",
  "save",
  "pre-visualizar",
  "preview",
  "configuracoes",
  "settings",
  "studio export",
  "exportar resultado",
  "exportar resultado do studio"
]

const STUDIO_CONTENT_BLOCKLIST = [
  ...STUDIO_ROW_BLOCKLIST,
  "baixar",
  "download",
  "exportacao",
  "exportacao de estudio",
  "minddock",
  "notebooklm"
]

const STUDIO_META_PATTERN = /(fontes?|sources?|postagem|guia de estudo|ha\s+\d|hÃƒÂ¡\s+\d|dias?|hours?|horas?|minutos?|mins?)/i

const STUDIO_ICON_TOKENS = new Set([
  "audio",
  "magic",
  "eraser",
  "play",
  "arrow",
  "more",
  "vert",
  "cards",
  "star",
  "edit",
  "quiz",
  "flowchart",
  "table",
  "view",
  "auto",
  "tab",
  "group",
  "sticky",
  "note",
  "post",
  "it",
  "image",
  "video",
  "mind",
  "map",
  "slide",
  "slides"
])

function isIconLabelLine(line: string): boolean {
  const normalized = normalizeMatchText(line)
  if (!normalized) {
    return false
  }
  if (normalized.includes("_")) {
    return true
  }
  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) {
    return false
  }
  return tokens.every((token) => STUDIO_ICON_TOKENS.has(token))
}

function isIconElement(element: HTMLElement): boolean {
  const className = normalizeMatchText(element.className || "")
  if (/(material|symbol|icon|glyph|lucide)/.test(className)) {
    return true
  }
  const ariaHidden = element.getAttribute("aria-hidden")
  if (ariaHidden === "true") {
    return true
  }
  const role = normalizeMatchText(element.getAttribute("role") || "")
  if (role === "img" || role === "presentation") {
    return true
  }
  return false
}

function isVisibleElement(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 2 || rect.height <= 2) {
    return false
  }
  const style = window.getComputedStyle(element)
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false
  }
  return true
}

function normalizeEntryText(value: string): string {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function normalizeMatchText(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

function normalizeStorageValue(value: unknown): string {
  return String(value ?? "").trim()
}

function hashString(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash.toString(36)
}

function resolveStudioMeta(item: StudioCacheItem): string | undefined {
  const explicit = normalizeStorageValue(item.meta)
  if (explicit) {
    return explicit
  }
  const parts: string[] = []
  if (typeof item.sourceCount === "number" && Number.isFinite(item.sourceCount)) {
    parts.push(`${item.sourceCount} fontes`)
  }
  const updatedAt = normalizeStorageValue(item.updatedAt)
  if (updatedAt) {
    parts.push(updatedAt)
  }
  const type = normalizeStorageValue(item.type)
  if (!parts.length && type) {
    parts.push(type)
  }
  return parts.length ? parts.join(" Ã¢â‚¬Â¢ ") : undefined
}

function normalizeStudioCacheEntry(item: StudioCacheItem): StudioEntry | null {
  const title = normalizeStorageValue(item.title)
  if (!title) {
    return null
  }

  const idSeed = `${title}|${normalizeStorageValue(item.type)}|${normalizeStorageValue(item.updatedAt)}`
  const id = normalizeStorageValue(item.id) || `studio_${hashString(idSeed)}`
  const content = normalizeStorageValue(item.content) || undefined
  const url = normalizeStorageValue(item.url) || undefined
  const mimeType = normalizeStorageValue(item.mimeType) || undefined
  const explicitType = normalizeStorageValue(item.type) || undefined
  const inferredType = inferTypeFromSignals(title, item.meta, content)
  const type = explicitType || inferredType
  const kind = item.kind === "asset" || item.kind === "text" ? item.kind : undefined
  const mimeLooksVisual = /^(video|audio|image)\//iu.test(mimeType ?? "") || mimeType === "application/pdf"
  const inferredAsset = Boolean((url || mimeType) && (isVisualTypeLabel(type) || mimeLooksVisual))

  return {
    id,
    title,
    meta: resolveStudioMeta(item),
    content,
    type,
    url,
    mimeType,
    kind: kind ?? (inferredAsset ? "asset" : "text")
  }
}

async function loadStudioEntriesFromStorage(): Promise<{
  entries: StudioEntry[]
  scopedKeys: string[]
} | null> {
  const storageLocal = getStorageLocalSafe()
  if (!storageLocal) {
    return null
  }

  const accountSnapshot = await new Promise<Record<string, unknown>>((resolve) => {
    try {
      storageLocal.get([ACCOUNT_EMAIL_KEY, AUTH_USER_KEY], (snapshot) => resolve(snapshot ?? {}))
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) {
        console.warn("[MindDock][Studio] extension context invalidated while reading account snapshot")
      }
      resolve({})
    }
  })

  const accountKey = buildNotebookAccountKey({
    accountEmail: accountSnapshot[ACCOUNT_EMAIL_KEY],
    authUser: accountSnapshot[AUTH_USER_KEY] ?? resolveAuthUserFromUrl(window.location.href)
  })

  const scopedKey = buildScopedStorageKey(STUDIO_STORAGE_KEY_BASE, accountKey)
  const fallbackKey = buildScopedStorageKey(STUDIO_STORAGE_KEY_BASE, buildNotebookAccountKey({}))
  const scopedKeys = Array.from(new Set([scopedKey, fallbackKey]))

  const dataSnapshot = await new Promise<Record<string, unknown>>((resolve) => {
    try {
      storageLocal.get(scopedKeys, (snapshot) => resolve(snapshot ?? {}))
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) {
        console.warn("[MindDock][Studio] extension context invalidated while reading studio cache")
      }
      resolve({})
    }
  })

  let rawItems: StudioCacheItem[] = []
  let usedKey: string | null = null
  if (Array.isArray(dataSnapshot[scopedKey])) {
    rawItems = dataSnapshot[scopedKey] as StudioCacheItem[]
    usedKey = scopedKey
  } else if (Array.isArray(dataSnapshot[fallbackKey])) {
    rawItems = dataSnapshot[fallbackKey] as StudioCacheItem[]
    usedKey = fallbackKey
  }

  const normalized = rawItems.map(normalizeStudioCacheEntry).filter(Boolean) as StudioEntry[]
  const safeFiltered = applyStudioFilter(normalized)
  void buildStudioDebugText(rawItems, normalized, safeFiltered, usedKey)

  if (usedKey && safeFiltered.length > 0 && safeFiltered.length !== normalized.length) {
    try {
      storageLocal.set(
        {
          [usedKey]: safeFiltered
        },
        () => {
          try {
            void chrome.runtime?.lastError
          } catch {
            // ignore runtime access failures on stale extension contexts
          }
        }
      )
    } catch (error) {
      if (!isExtensionContextInvalidatedError(error)) {
        console.warn("[MindDock][Studio] failed to persist filtered cache", error)
      }
    }
  }

  return { entries: safeFiltered, scopedKeys }
}

function isNoiseLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) {
    return true
  }
  if (/^[Ã¢â‚¬Â¢Ã‚Â·Ã¢â‚¬Â¢\-|]+$/.test(trimmed)) {
    return true
  }
  const normalized = normalizeMatchText(trimmed)
  if (/^[a-z0-9_]+$/.test(normalized) && normalized.includes("_")) {
    return true
  }
  if (/^(play|more|dock|audio|video|image|mapa|quiz|relatorio|apresentacao)/i.test(normalized)) {
    return true
  }
  return false
}

function cleanStudioTitle(rawTitle: string, meta?: string): string {
  let title = rawTitle.replace(/[Ã¢â‚¬Â¢Ã‚Â·|]+/g, " ").replace(/\s+/g, " ").trim()
  if (meta && title.includes(meta)) {
    title = title.replace(meta, "").trim()
  }
  const tokens = title.split(" ").filter(Boolean)
  let index = 0
  while (index < tokens.length) {
    const token = normalizeMatchText(tokens[index])
    if (token.includes("_")) {
      index += 1
      continue
    }
    if (STUDIO_ICON_TOKENS.has(token)) {
      index += 1
      continue
    }
    break
  }
  const cleaned = tokens.slice(index).join(" ").trim()
  if (!cleaned || isIconLabelLine(cleaned)) {
    return ""
  }
  return cleaned
}
 
function extractVisibleText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement
  clone
    .querySelectorAll<HTMLElement>(
      "mat-icon, .material-symbols-outlined, svg, [aria-hidden=\"true\"], .icon, [class*=\"icon\"], [class*=\"material\"], [data-icon]"
    )
    .forEach((node) => node.remove())
  return normalizeEntryText(clone.innerText || clone.textContent || "")
}


function extractStudioRowText(row: HTMLElement): string {
  const clone = row.cloneNode(true) as HTMLElement
  clone
    .querySelectorAll<HTMLElement>(
      "svg, i, [class*='icon'], [class*='material'], [data-icon], [aria-hidden='true']"
    )
    .forEach((node) => node.remove())
  return normalizeEntryText(clone.innerText || clone.textContent || "")
}

function extractTextLinesFromRow(row: HTMLElement): string[] {
  const lines: string[] = []
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement
      if (!parent) {
        return NodeFilter.FILTER_REJECT
      }
      if (!isVisibleElement(parent) || isIconElement(parent)) {
        return NodeFilter.FILTER_REJECT
      }
      const text = String(node.nodeValue ?? "").trim()
      if (!text) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    }
  })

  let current = walker.nextNode()
  while (current) {
    const chunk = String(current.nodeValue ?? "").trim()
    if (chunk) {
      chunk
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
          if (!isIconLabelLine(line)) {
            lines.push(line)
          }
        })
    }
    current = walker.nextNode()
  }

  const seen = new Set<string>()
  return lines.filter((line) => {
    const key = line.toLowerCase()
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function shouldSkipStudioRow(text: string): boolean {
  const normalized = normalizeMatchText(text)
  if (!normalized || normalized.length < 6) {
    return true
  }
  return STUDIO_ROW_BLOCKLIST.some((token) => normalized.includes(token))
}

function isStudioMetaLine(line: string): boolean {
  const normalized = normalizeMatchText(line)
  return STUDIO_META_PATTERN.test(normalized)
}

function extractStudioRowInfo(rawText: string): { title: string; meta: string } | null {
  const lines = rawText.split("\n").map((line) => line.trim()).filter(Boolean)
  const filtered = lines.filter((line) => !isNoiseLine(line))
  if (filtered.length >= 2) {
    const metaCandidate = filtered.find((line) => isStudioMetaLine(line))
    const titleLine =
      filtered
        .filter((line) => !isStudioMetaLine(line) && !isIconLabelLine(line))
        .sort((a, b) => b.length - a.length)[0] ?? null
    if (titleLine && metaCandidate) {
      const cleaned = cleanStudioTitle(titleLine, metaCandidate)
      if (cleaned) {
        return { title: cleaned, meta: metaCandidate }
      }
    }
  }

  const metaMatch =
    rawText.match(/\b\d+\s*(fontes?|sources?)\b.*$/i) ??
    rawText.match(/\bpostagem\b.*$/i) ??
    rawText.match(/\bguia\s+de\s+estudo\b.*$/i) ??
    rawText.match(/\bha\s+\d+\b.*$/i) ??
    rawText.match(/\bhÃƒÂ¡\s+\d+\b.*$/i)

  if (!metaMatch || typeof metaMatch.index !== "number") {
    return null
  }

  const meta = metaMatch[0].trim()
  const title = cleanStudioTitle(
    rawText.slice(0, metaMatch.index).replace(/[Ã¢â‚¬Â¢Ã‚Â·\-\|]+$/u, "").trim(),
    meta
  )
  if (!title || title.length < 4) {
    return null
  }
  return { title, meta }
}

function extractStudioRowInfoFromElement(row: HTMLElement): { title: string; meta: string } | null {
  const leafNodes = Array.from(
    row.querySelectorAll<HTMLElement>("span, div, p, small, strong, b")
  )
    .filter((node) => isVisibleElement(node) && !isIconElement(node))
    .map((node) => ({
      text: normalizeEntryText(node.innerText || node.textContent || ""),
      top: node.getBoundingClientRect().top
    }))
    .filter(
      (item) =>
        item.text.length >= 2 &&
        item.text.length <= 200 &&
        !isIconLabelLine(item.text)
    )

  if (leafNodes.length >= 2) {
    const metaNode = leafNodes.find((node) => isStudioMetaLine(node.text))
    if (metaNode) {
      const titleNode = leafNodes
        .filter((node) => !isStudioMetaLine(node.text) && !isIconLabelLine(node.text))
        .sort((a, b) => {
          const lengthDelta = b.text.length - a.text.length
          if (lengthDelta !== 0) {
            return lengthDelta
          }
          return Math.abs(a.top - metaNode.top) - Math.abs(b.top - metaNode.top)
        })[0]
      if (titleNode) {
        const cleaned = cleanStudioTitle(titleNode.text, metaNode.text)
        if (cleaned) {
          return { title: cleaned, meta: metaNode.text }
        }
      }
    }
  }

  const lines = extractTextLinesFromRow(row)
  if (lines.length >= 2) {
    const metaCandidate = lines.find((line) => isStudioMetaLine(line))
    const titleLine =
      lines.find((line) => !isStudioMetaLine(line) && !isIconLabelLine(line)) ?? null
    if (titleLine && metaCandidate) {
      const cleaned = cleanStudioTitle(titleLine, metaCandidate)
      if (cleaned) {
        return { title: cleaned, meta: metaCandidate }
      }
    }
  }

  const fallbackText = extractStudioRowText(row)
  return fallbackText ? extractStudioRowInfo(fallbackText) : null
}

function resolveStudioResultListContainer(): HTMLElement | null {
  const addNoteCandidates = queryDeepAll<HTMLElement>(["button", "[role='button']", "a"]).filter(
    (candidate) => {
      if (!isVisibleElement(candidate) || candidate.closest("#minddock-studio-export-root")) {
        return false
      }
      const text = normalizeMatchText(candidate.innerText || candidate.textContent || "")
      return text.includes("adicionar nota") || text.includes("add note")
    }
  )

  for (const addNote of addNoteCandidates) {
    let node: HTMLElement | null = addNote
    for (let i = 0; i < 6 && node; i += 1) {
      const rows = queryDeepAll<HTMLElement>(
        ["[role='listitem']", "li", "a", "button", "[role='button']"],
        node
      ).filter(isVisibleElement)
      const matched = rows.filter((row) => extractStudioRowInfo(normalizeEntryText(row.innerText || row.textContent || "")))
      if (matched.length >= 3) {
        return node
      }
      node = node.parentElement
    }
  }

  const containers = queryDeepAll<HTMLElement>([
    "[role='list']",
    "ul",
    "ol",
    "[data-testid*='list']",
    "[class*='list']",
    "[class*='results']",
    "[class*='result']",
    "[class*='items']"
  ]).filter(isVisibleElement)

  let best: { element: HTMLElement; score: number } | null = null

  for (const container of containers) {
    if (container.closest("#minddock-studio-export-root")) {
      continue
    }
    const rect = container.getBoundingClientRect()
    if (rect.width < 240 || rect.height < 160) {
      continue
    }
    if (rect.left < window.innerWidth * 0.2) {
      continue
    }

    const rows = queryDeepAll<HTMLElement>(
      ["[role='listitem']", "li", "a", "button", "[role='button']"],
      container
    ).filter(isVisibleElement)
    if (rows.length < 2) {
      continue
    }

    let score = 0
    for (const row of rows) {
      const info = extractStudioRowInfoFromElement(row)
      if (info) {
        score += 1
      }
      const rowId = resolveStudioArtifactIdFromRow(row)
      if (rowId && UUID_RE.test(String(rowId))) {
        score += 2
      }
    }

    if (score >= 2 && (!best || score > best.score)) {
      best = { element: container, score }
    }
  }

  return best?.element ?? null
}

function resolveMetaFromRowText(rawText: string): string {
  const lines = rawText.split("\n").map((line) => line.trim()).filter(Boolean)
  const metaLine = lines.find((line) => STUDIO_META_PATTERN.test(line))
  return metaLine ?? ""
}

function pickTitleFromLines(lines: string[]): string {
  const candidates = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isStudioMetaLine(line))
    .filter((line) => !isIconLabelLine(line))
    .filter((line) => !isTemplateLikeTitle(line))
    .filter((line) => line.length >= 4)
    .filter((line) => /\p{L}/u.test(line))

  if (candidates.length === 0) {
    return ""
  }
  return candidates.sort((a, b) => b.length - a.length)[0]
}

const ICON_TYPE_MAP: Record<string, string> = {
  audio_magic_eraser: "Audio Overview",
  subscriptions: "Video Overview",
  flowchart: "Mind Map",
  stacked_bar_chart: "Infographic",
  table_view: "Data Table",
  table_chart: "Data Table",
  table_chart_view: "Data Table",
  table_rows: "Data Table",
  table_rows_narrow: "Data Table",
  dataset: "Data Table",
  table: "Data Table",
  database: "Data Table",
  cards_star: "Flashcards",
  auto_tab_group: "Briefing",
  tablet: "Slides",
  quiz: "Quiz",
  video_audio_call: "Briefing",
  video_youtube: "Video Overview",
  drive_presentation: "Slides",
  drive_pdf: "Data Table",
  view_timeline: "Timeline",
  timeline: "Timeline",
  movie: "Video Overview"
}

function queryDeepSingle(
  selector: string,
  root: Element | Document | ShadowRoot = document
): HTMLElement | null {
  const direct = root.querySelector<HTMLElement>(selector)
  if (direct) return direct
  for (const el of Array.from(root.querySelectorAll("*"))) {
    const shadow = (el as HTMLElement).shadowRoot
    if (shadow) {
      const found = queryDeepSingle(selector, shadow)
      if (found) return found
    }
  }
  return null
}

function queryDeepAllWithin(
  selectors: readonly string[],
  root: Element | Document | ShadowRoot
): HTMLElement[] {
  const queue: Array<Element | Document | ShadowRoot> = [root]
  const seenRoots = new Set<Element | Document | ShadowRoot>()
  const seenElements = new Set<Element>()
  const out: HTMLElement[] = []

  while (queue.length > 0) {
    const current = queue.shift()!
    if (seenRoots.has(current)) continue
    seenRoots.add(current)

    for (const selector of selectors) {
      try {
        const nodes = Array.from(current.querySelectorAll(selector))
        for (const node of nodes) {
          if (!(node instanceof HTMLElement)) continue
          if (seenElements.has(node)) continue
          seenElements.add(node)
          out.push(node)
        }
      } catch {
        // ignore invalid selectors
      }
    }

    for (const el of Array.from(current.querySelectorAll("*"))) {
      const shadow = (el as HTMLElement).shadowRoot
      if (shadow && !seenRoots.has(shadow)) {
        queue.push(shadow)
      }
    }
  }

  return out
}

function normalizeIconToken(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function inferTypeFromIcon(row: HTMLElement): string | undefined {
  const iconNodes = queryDeepAllWithin(
    [
      "mat-icon.artifact-icon",
      "mat-icon[class*='artifact']",
      "mat-icon",
      ".material-symbols-outlined",
      "[class*='material-symbols']",
      "[data-icon]",
      "[icon-name]"
    ],
    row
  )

  for (const icon of iconNodes) {
    const candidates = [
      icon.textContent ?? "",
      icon.getAttribute("fonticon") ?? "",
      icon.getAttribute("icon-name") ?? "",
      icon.getAttribute("data-icon") ?? "",
      icon.getAttribute("aria-label") ?? "",
      icon.getAttribute("title") ?? ""
    ]
    for (const raw of candidates) {
      const key = normalizeIconToken(raw)
      if (!key) continue
      const mapped = ICON_TYPE_MAP[key]
      if (mapped) return mapped
    }
  }

  return undefined
}

function resolveTypeFromElementIconContext(element: Element | null): string | undefined {
  if (!element) return undefined

  const scanNodes: Element[] = []
  const pushScan = (node: Element | null) => {
    if (!node) return
    scanNodes.push(node)
    scanNodes.push(
      ...Array.from(
        node.querySelectorAll(
          "mat-icon, .material-symbols-outlined, [class*='material-symbols'], [data-icon], [icon-name], [fonticon]"
        )
      )
    )
  }

  pushScan(element)
  let parent = element.parentElement
  for (let i = 0; i < 4 && parent; i += 1) {
    pushScan(parent)
    parent = parent.parentElement
  }

  for (const node of scanNodes) {
    if (!(node instanceof HTMLElement)) continue
    const candidates = [
      node.textContent ?? "",
      node.getAttribute("fonticon") ?? "",
      node.getAttribute("icon-name") ?? "",
      node.getAttribute("data-icon") ?? "",
      node.getAttribute("aria-label") ?? "",
      node.getAttribute("title") ?? ""
    ]
    for (const raw of candidates) {
      const key = normalizeIconToken(raw)
      if (!key) continue
      const mapped = ICON_TYPE_MAP[key]
      if (mapped) return mapped
    }
  }

  return undefined
}

function readStudioTypeHintsByIdFromDom(targetIds: Iterable<string>): Map<string, string> {
  const ids = new Set<string>()
  for (const value of targetIds) {
    const id = String(value ?? "").trim()
    if (UUID_RE.test(id)) ids.add(id.toLowerCase())
  }
  if (ids.size === 0) return new Map()

  const notebookId = (resolveNotebookIdFromUrl() ?? "").toLowerCase()
  const bestById = new Map<string, { type: string; score: number }>()
  const allElements = Array.from(document.querySelectorAll("*"))

  for (const element of allElements) {
    if (!(element instanceof Element)) continue

    const attrNames = element.getAttributeNames?.() ?? []
    if (attrNames.length === 0) continue

    for (const attr of attrNames) {
      const raw = element.getAttribute(attr)
      if (!raw) continue

      const uuidHits = raw.match(new RegExp(UUID_RE.source, "gi")) ?? []
      if (uuidHits.length !== 1) continue

      const hit = uuidHits[0].toLowerCase()
      if (!ids.has(hit) || (notebookId && hit === notebookId)) continue

      const mappedType = resolveTypeFromElementIconContext(element)
      if (!mappedType) continue

      let score = 0
      const attrKey = attr.toLowerCase()
      if (attrKey.includes("artifact")) score += 6
      if (attrKey.includes("result")) score += 4
      if (attrKey.includes("studio")) score += 3
      if (attrKey.includes("id")) score += 2
      if (String(raw).trim().toLowerCase() === hit) score += 2
      if (isVisibleElement(element as HTMLElement)) score += 1
      if (normalizeTypeToken(mappedType) === "data table") score += 2

      const current = bestById.get(hit)
      if (!current || score > current.score) {
        bestById.set(hit, { type: mappedType, score })
      }
    }
  }

  return new Map(Array.from(bestById.entries()).map(([id, data]) => [id, data.type]))
}

function readStudioTitlesFromDom(): StudioEntry[] {
  const root = resolveStudioResultListContainer()
  if (!root) {
    return []
  }

  const rows = queryDeepAll<HTMLElement>(["[role='listitem']", "li[role='listitem']", "li"], root).filter(
    isVisibleElement
  )

  const entries: StudioEntry[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    if (row.closest("#minddock-studio-export-root")) {
      continue
    }

    const artifactId = resolveStudioArtifactIdFromRow(row)

    const rowInfo = extractStudioRowInfoFromElement(row)
    const rawRowText = extractVisibleText(row)
    const metaElement = row.querySelector<HTMLElement>(".meta, .subtitle, [data-testid*='meta']")
    const meta =
      rowInfo?.meta ??
      (metaElement ? extractVisibleText(metaElement) : resolveMetaFromRowText(rawRowText))
    const hasMetaSignal = looksLikeStudioMetaSignal(meta)

    let title = rowInfo?.title ?? ""
    if (!title) {
      const titleElement = row.querySelector<HTMLElement>("[data-testid*='title'], .title, h3, h4, h5")
      const rawTitle = titleElement ? extractVisibleText(titleElement) : ""
      title = cleanStudioTitle(rawTitle, meta)
      if (!title) {
        title = pickTitleFromLines(extractTextLinesFromRow(row))
      }
    }

    const hasTitle = Boolean(title && title.trim().length > 0)
    if (hasTitle) {
      if (/^[a-z_]+$/i.test(title)) continue
      if (isTemplateLikeTitle(title)) continue
      if (!looksLikeSidebarEntryTitle(title)) continue
    }

    if (!artifactId && !hasMetaSignal) continue
    if (!artifactId && !hasTitle) continue

    const key = artifactId ?? `${title.toLowerCase()}::${meta.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)

    const clickable =
      row.closest<HTMLElement>("[role='listitem'], li") ??
      row.closest<HTMLElement>("button, [role='button'], a") ??
      row
    const iconType = inferTypeFromIcon(row)

    entries.push({
      id:
        artifactId ??
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `studio-dom-${hashString(key)}`),
      title: hasTitle ? title : "Carregando resultado do Estudio...",
      meta,
      type: iconType ?? meta,
      content: "",
      node: clickable
    })
  }

  return entries
}

function resolveStudioScrollHost(root: HTMLElement): HTMLElement | null {
  const candidates: HTMLElement[] = [root]

  let parent: HTMLElement | null = root.parentElement
  for (let i = 0; i < 8 && parent; i += 1) {
    candidates.push(parent)
    parent = parent.parentElement
  }

  candidates.push(...queryDeepAll<HTMLElement>(["div", "section", "main", "aside", "ul", "ol"], root))

  let best: { element: HTMLElement; depth: number } | null = null
  for (const candidate of candidates) {
    if (!isVisibleElement(candidate)) continue
    const style = window.getComputedStyle(candidate)
    const overflow = `${style.overflowY} ${style.overflow}`
    if (!/(auto|scroll|overlay)/i.test(overflow)) continue
    const depth = candidate.scrollHeight - candidate.clientHeight
    if (depth < 120) continue
    if (!best || depth > best.depth) {
      best = { element: candidate, depth }
    }
  }

  return best?.element ?? null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function flushUiFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
}

async function readStudioTitlesByIdFromDomDeep(targetIds: Iterable<string>): Promise<Map<string, string>> {
  const canonicalByLower = new Map<string, string>()
  for (const raw of targetIds) {
    const id = String(raw ?? "").trim()
    if (!UUID_RE.test(id)) continue
    canonicalByLower.set(id.toLowerCase(), id)
  }

  const found = new Map<string, string>()
  if (canonicalByLower.size === 0) return found

  const resolveCanonical = (value: string): string | null => {
    const match = String(value ?? "").match(UUID_RE)
    if (!match) return null
    const lower = match[0].toLowerCase()
    return canonicalByLower.get(lower) ?? null
  }

  const unresolvedLowerIds = (): string[] =>
    Array.from(canonicalByLower.entries())
      .filter(([, canonical]) => !found.has(canonical))
      .map(([lower]) => lower)

  const resolveTitleFromOwner = (owner: HTMLElement | null): string => {
    if (!owner) return ""

    const info = extractStudioRowInfoFromElement(owner)
    if (info?.title && looksLikeSidebarEntryTitle(info.title)) {
      return info.title
    }

    const fromLines = pickTitleFromLines(extractTextLinesFromRow(owner))
    if (fromLines && looksLikeSidebarEntryTitle(fromLines)) {
      return fromLines
    }

    const raw = extractVisibleText(owner)
    const lineCandidates = raw
      .split("\n")
      .map((line) => cleanStudioTitle(line))
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !isStudioMetaLine(line))
      .filter((line) => !isIconLabelLine(line))
      .filter((line) => !isTemplateLikeTitle(line))
      .filter((line) => looksLikeSidebarEntryTitle(line))

    return lineCandidates[0] ?? ""
  }

  const matchIdsInElementByAttributes = (element: Element): string[] => {
    const matches = new Set<string>()
    const nodes: Element[] = [element, ...Array.from(element.querySelectorAll("*"))]
    for (const node of nodes) {
      const attrs = node.getAttributeNames?.() ?? []
      for (const attr of attrs) {
        const value = node.getAttribute(attr)
        if (!value) continue
        const idsInValue = value.match(new RegExp(UUID_RE.source, "gi")) ?? []
        if (idsInValue.length !== 1) {
          continue
        }
        const canonical = resolveCanonical(idsInValue[0])
        if (canonical) {
          matches.add(canonical)
        }
      }
    }
    return Array.from(matches)
  }

  const collectVisibleRows = (searchRoot?: Element | Document) => {
    const rows = queryDeepAll<HTMLElement>(
      ["[role='listitem']", "li[role='listitem']", "li"],
      searchRoot ?? document
    ).filter((row) => isVisibleElement(row) && !row.closest("#minddock-studio-export-root"))

    for (const row of rows) {
      const title = resolveTitleFromOwner(row)
      if (!title) continue

      const resolvedId = resolveStudioArtifactIdFromRow(row)
      const canonicalFromRow = resolvedId ? resolveCanonical(resolvedId) : null
      if (canonicalFromRow) {
        found.set(canonicalFromRow, title)
        if (found.size >= canonicalByLower.size) return
        continue
      }

      const unresolvedMatches = matchIdsInElementByAttributes(row).filter((id) => !found.has(id))
      if (unresolvedMatches.length !== 1) continue
      found.set(unresolvedMatches[0], title)
      if (found.size >= canonicalByLower.size) return
    }
  }

  const scanContainerByAttributes = (container: HTMLElement) => {
    const unresolved = unresolvedLowerIds()
    if (unresolved.length === 0) return

    const nodes: Element[] = [container, ...Array.from(container.querySelectorAll("*"))]
    for (const node of nodes) {
      const attrs = node.getAttributeNames?.() ?? []
      if (attrs.length === 0) continue

      for (const attr of attrs) {
        const value = node.getAttribute(attr)
        if (!value) continue
        const idsInValue = value.match(new RegExp(UUID_RE.source, "gi")) ?? []
        if (idsInValue.length !== 1) continue
        const canonical = resolveCanonical(idsInValue[0])
        if (!canonical) continue

        const owner =
          node.closest<HTMLElement>(
            "[role='listitem'], li, button, [role='button'], a, article, section, div"
          ) ?? (node as HTMLElement)

        const ownerResolvedId = resolveStudioArtifactIdFromRow(owner)
        const ownerCanonicalId = ownerResolvedId ? resolveCanonical(ownerResolvedId) : null
        if (ownerCanonicalId && ownerCanonicalId !== canonical) {
          continue
        }

        const title = resolveTitleFromOwner(owner)
        if (title) {
          found.set(canonical, title)
        }
      }

      if (found.size >= canonicalByLower.size) return
    }
  }

  const root = resolveStudioResultListContainer()
  if (root) {
    collectVisibleRows(root)
  } else {
    collectVisibleRows(document)
  }

  if (found.size >= canonicalByLower.size) return found
  if (root) {
    scanContainerByAttributes(root)
  }
  if (found.size >= canonicalByLower.size) return found

  if (root) {
    const scrollHost = resolveStudioScrollHost(root)
    if (scrollHost) {
      const initialTop = scrollHost.scrollTop
      const maxTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight)
      const step = Math.max(140, Math.floor(scrollHost.clientHeight * 0.8))

      for (let top = 0; top <= maxTop && found.size < canonicalByLower.size; top += step) {
        scrollHost.scrollTop = top
        await sleep(80)
        collectVisibleRows(root)
        scanContainerByAttributes(root)
      }

      scrollHost.scrollTop = initialTop
      await sleep(50)
      collectVisibleRows(root)
      scanContainerByAttributes(root)
    }
  }

  if (found.size >= canonicalByLower.size) return found

  const globalScrollHosts = queryDeepAll<HTMLElement>(["div", "section", "main", "aside", "ul", "ol"])
    .filter((candidate) => !candidate.closest("#minddock-studio-export-root"))
    .filter(isVisibleElement)
    .map((candidate) => {
      const style = window.getComputedStyle(candidate)
      const overflow = `${style.overflowY} ${style.overflow}`
      const depth = candidate.scrollHeight - candidate.clientHeight
      const isScrollable = /(auto|scroll|overlay)/i.test(overflow) && depth > 120
      return isScrollable ? { candidate, depth } : null
    })
    .filter(Boolean) as Array<{ candidate: HTMLElement; depth: number }>

  globalScrollHosts.sort((a, b) => b.depth - a.depth)
  for (const hostInfo of globalScrollHosts.slice(0, 10)) {
    if (found.size >= canonicalByLower.size) break
    const host = hostInfo.candidate
    const hostInitialTop = host.scrollTop
    const hostMaxTop = Math.max(0, host.scrollHeight - host.clientHeight)
    const hostStep = Math.max(140, Math.floor(host.clientHeight * 0.8))

    for (let top = 0; top <= hostMaxTop && found.size < canonicalByLower.size; top += hostStep) {
      host.scrollTop = top
      await sleep(70)
      collectVisibleRows(host)
      scanContainerByAttributes(host)
    }

    host.scrollTop = hostInitialTop
    await sleep(40)
    collectVisibleRows(host)
    scanContainerByAttributes(host)
  }

  return found
}

function resolveStudioEntries(): StudioEntry[] {
  const domEntries = readStudioTitlesFromDom()
  if (domEntries.length > 0) {
    return domEntries
  }
  const listEntries = resolveStudioListEntries()
  if (listEntries.length > 0) {
    return listEntries
  }
  return resolveStudioContentEntries()
}

function resolveStudioContentEntries(): StudioEntry[] {
  const containers = queryDeepAll<HTMLElement>([
    "[data-testid*='studio']",
    "[class*='studio']",
    "[data-testid*='result']",
    "[class*='result']",
    "[data-testid*='output']",
    "[class*='output']",
    "[data-testid*='artifact']",
    "[class*='artifact']",
    "[class*='viewer']",
    "[data-testid*='document']",
    "[class*='document']",
    "main",
    "[role='main']"
  ])

  const roots = containers.filter(isVisibleElement)
  const entries: StudioEntry[] = []
  const seen = new Set<string>()

  const pushEntry = (entry: StudioEntry) => {
    const content = entry.content ?? ""
    if (!entry.title || entry.title.length < 4 || content.length < 40) {
      return
    }
    const key = `${entry.title.toLowerCase()}::${content.slice(0, 80).toLowerCase()}`
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    entries.push(entry)
  }

  for (const root of roots.length > 0 ? roots : [document.body]) {
    const candidates = queryDeepAll<HTMLElement>(
      ["article", "section", "[role='article']", "div", "li"],
      root
    ).filter(isVisibleElement)

    for (const candidate of candidates) {
      if (candidate.closest("#minddock-studio-export-root")) {
        continue
      }
      const rawText = normalizeEntryText(candidate.innerText || candidate.textContent || "")
      if (rawText.length < 120 || rawText.length > 12000) {
        continue
      }
      const normalized = normalizeMatchText(rawText)
      if (STUDIO_CONTENT_BLOCKLIST.some((token) => normalized.includes(token))) {
        continue
      }

      const rect = candidate.getBoundingClientRect()
      if (rect.width < 240 || rect.height < 80) {
        continue
      }

      const childCandidates = Array.from(candidate.querySelectorAll<HTMLElement>("article, section, div, li"))
        .filter((child) => child !== candidate && isVisibleElement(child))
        .map((child) => normalizeEntryText(child.innerText || child.textContent || ""))
        .filter((text) => text.length > 80)
      const maxChildLength = childCandidates.reduce((max, text) => Math.max(max, text.length), 0)
      if (maxChildLength > rawText.length * 0.7) {
        continue
      }

      pushEntry(extractStudioEntryFromText(candidate, rawText))
      if (entries.length >= 40) {
        return entries
      }
    }
  }

  if (entries.length > 0) {
    return entries
  }

  const artifactCandidates = queryDeepAll<HTMLElement>([
    ".artifact-content",
    "[class*='artifact-content']",
    "[data-testid*='artifact']",
    "[class*='artifact']"
  ]).filter(isVisibleElement)

  for (const candidate of artifactCandidates) {
    if (candidate.closest("#minddock-studio-export-root")) {
      continue
    }
    const rawText = normalizeEntryText(candidate.innerText || candidate.textContent || "")
    if (rawText.length < 200) {
      continue
    }
    pushEntry(extractStudioEntryFromText(candidate, rawText))
  }

  return entries
}

function resolveStudioListEntries(): StudioEntry[] {
  const root =
    resolveStudioResultListContainer() ??
    queryDeepAll<HTMLElement>(["[class*='studio-sidebar']", "[data-testid*='studio']", "[class*='studio']"]).find(
      isVisibleElement
    ) ??
    document.body

  const rowCandidates = queryDeepAll<HTMLElement>(
    ["[role='listitem']", "li", "a", "button", "[role='button']"],
    root
  )

  const seen = new Set<string>()
  const entries: StudioEntry[] = []

  for (const candidate of rowCandidates) {
    if (!isVisibleElement(candidate)) {
      continue
    }
    if (candidate.closest("#minddock-studio-export-root")) {
      continue
    }
    const info = extractStudioRowInfoFromElement(candidate)
    if (!info) {
      continue
    }
    const rawText = extractStudioRowText(candidate)
    if (shouldSkipStudioRow(rawText)) {
      continue
    }
    const { title, meta } = info

    const key = `${title.toLowerCase()}::${meta.toLowerCase()}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)

    const clickable =
      candidate.closest<HTMLElement>("[role='listitem'], li") ??
      candidate.closest<HTMLElement>("button, [role='button'], a") ??
      candidate

    entries.push({
      id: `studio-${entries.length + 1}-${title.toLowerCase().replace(/\s+/g, "-")}`,
      title,
      meta,
      content: "",
      node: clickable
    })
    if (entries.length >= 60) {
      break
    }
  }

  return entries
}

function extractStudioEntryFromText(element: HTMLElement, rawText: string): StudioEntry {
  const heading = element.querySelector<HTMLElement>("h1, h2, h3, h4, h5, strong, b")
  const headingText = heading ? normalizeEntryText(heading.innerText || heading.textContent || "") : ""
  const lines = rawText.split("\n").map((line) => line.trim()).filter(Boolean)
  const title = headingText || lines[0] || "Studio"

  const metaCandidate = lines.find((line, index) => {
    if (index === 0) return false
    return /\b(fontes?|sources?|ha\s+\d+|ago|mins?|minutos?|hours?|horas?|dias?|weeks?|semanas?|meses?|months?|anos?|years?)\b/i.test(line)
  })
  const meta = metaCandidate ?? (lines.length > 1 ? lines[1] : undefined)

  const contentLines = lines.filter((line) => line !== title && line !== meta)
  const content = contentLines.join("\n").trim()

  return {
    id: `studio-${title.toLowerCase().replace(/\s+/g, "-")}-${Math.abs(content.length)}`,
    title,
    meta,
    content: content || rawText
  }
}

function isLikelyContentText(text: string): boolean {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) {
    return false
  }
  const totalLength = lines.reduce((sum, line) => sum + line.length, 0)
  const avgLength = totalLength / lines.length
  const maxLength = lines.reduce((max, line) => Math.max(max, line.length), 0)
  const shortLines = lines.filter((line) => line.length < 18).length
  const shortRatio = shortLines / lines.length
  const hasSentence = /[.!?]\s/.test(text)

  if (hasSentence) {
    return true
  }
  if (shortRatio > 0.6 && avgLength < 28) {
    return false
  }
  return maxLength >= 60 || avgLength >= 32
}

function looksLikeTableStructure(element: HTMLElement, rawText: string): boolean {
  const cellCount = element.querySelectorAll("th,td,[role='cell'],[role='columnheader']").length
  const rowCount = element.querySelectorAll("tr,[role='row']").length
  if (cellCount >= 6 && rowCount >= 2) {
    return true
  }

  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 6) {
    return false
  }

  const normalized = normalizeTypeToken(rawText)
  const hasTableKeywords = /(pilar|etapa|descricao|ferramentas|visualizacao|fonte|recomendadas)/.test(normalized)
  const columnLikeLines = lines.filter((line) => /\s{2,}/.test(line)).length
  return hasTableKeywords && columnLikeLines >= 2
}

function buildMarkdownTableTextFromRows(rows: string[][]): string | null {
  const normalizedRows = rows
    .map((row) => row.map((cell) => normalizeEntryText(cell).replace(/\s+/g, " ").trim()))
    .filter((row) => row.some((cell) => cell.length > 0))
  if (normalizedRows.length < 2) return null

  const header = normalizedRows[0]
  if (header.length < 2) return null

  const width = header.length
  const bodyRows = normalizedRows.slice(1).map((row) => {
    const next = row.slice(0, width)
    while (next.length < width) next.push("")
    return next
  })
  if (bodyRows.length === 0) return null

  const esc = (value: string) => value.replace(/\|/g, "\\|")
  const lines: string[] = []
  lines.push(`| ${header.map(esc).join(" | ")} |`)
  lines.push(`| ${header.map(() => "---").join(" | ")} |`)
  bodyRows.forEach((row) => {
    lines.push(`| ${row.map(esc).join(" | ")} |`)
  })
  return lines.join("\n").trim()
}

function extractStructuredTableTextFromElement(element: HTMLElement): string | null {
  let best = ""

  const nativeTables = Array.from(element.querySelectorAll<HTMLTableElement>("table")).filter((table) =>
    isVisibleElement(table as unknown as HTMLElement)
  )
  for (const table of nativeTables) {
    const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tr"))
      .map((row) =>
        Array.from(row.querySelectorAll<HTMLElement>("th,td"))
          .map((cell) => String(cell.innerText || cell.textContent || ""))
      )
      .filter((row) => row.some((cell) => cell.trim().length > 0))
    const markdown = buildMarkdownTableTextFromRows(rows)
    if (markdown && markdown.length > best.length) {
      best = markdown
    }
  }

  const roleTables = Array.from(element.querySelectorAll<HTMLElement>("[role='table'], [role='grid']")).filter(
    isVisibleElement
  )
  for (const tableLike of roleTables) {
    const rows = Array.from(tableLike.querySelectorAll<HTMLElement>("[role='row']"))
      .map((row) =>
        Array.from(row.querySelectorAll<HTMLElement>("[role='columnheader'], [role='cell']"))
          .map((cell) => String(cell.innerText || cell.textContent || ""))
      )
      .filter((row) => row.some((cell) => cell.trim().length > 0))
    const markdown = buildMarkdownTableTextFromRows(rows)
    if (markdown && markdown.length > best.length) {
      best = markdown
    }
  }

  return best || null
}

function scoreStudioContentCandidate(value: string): number {
  const text = String(value ?? "").trim()
  if (!text || looksLikeUrl(text)) return -1

  let score = text.length
  const normalized = normalizeTypeToken(text)
  if (/\|\s*:?-{3,}:?\s*\|/.test(text) || /(pilar|etapa|descricao|ferramentas|visualizacao|fonte)/.test(normalized)) {
    score += 1800
  }

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length >= 12) score += 450
  if (text.length < 180) score -= 600
  return score
}

function pickBestStudioHydratedContent(candidates: Array<string | null | undefined>): string | null {
  let best: string | null = null
  let bestScore = -1
  for (const candidate of candidates) {
    const text = String(candidate ?? "").trim()
    if (!text) continue
    const score = scoreStudioContentCandidate(text)
    if (score > bestScore) {
      bestScore = score
      best = text
    }
  }
  return best
}

function resolveStudioViewerContent(): string {
  const candidates = queryDeepAll<HTMLElement>([
    ".artifact-content",
    "[class*='artifact-content']",
    "[data-testid*='artifact']",
    "[class*='artifact']",
    "[data-testid*='viewer']",
    "[class*='viewer']",
    "[data-testid*='result']",
    "[class*='result']"
  ]).filter(isVisibleElement)

  let bestText = ""
  let bestScore = 0

  for (const candidate of candidates) {
    if (candidate.closest("#minddock-studio-export-root")) {
      continue
    }
    const rect = candidate.getBoundingClientRect()
    if (rect.width < 240 || rect.height < 120) {
      continue
    }
    if (rect.left < window.innerWidth * 0.2) {
      continue
    }

    const rawTextBase = normalizeEntryText(candidate.innerText || candidate.textContent || "")
    const tableText = extractStructuredTableTextFromElement(candidate)
    const rawText = tableText && tableText.length > rawTextBase.length ? tableText : rawTextBase
    const hasTable = Boolean(tableText) || looksLikeTableStructure(candidate, rawTextBase)
    if (rawText.length < 200 && !hasTable) {
      continue
    }
    const normalized = normalizeMatchText(rawText)
    if (STUDIO_CONTENT_BLOCKLIST.some((token) => normalized.includes(token))) {
      continue
    }
    if (!hasTable && !isLikelyContentText(rawText)) {
      continue
    }

    const score = rawText.length + rect.width * 0.5 + (hasTable ? 2200 : 0)
    if (score > bestScore) {
      bestScore = score
      bestText = rawText
    }
  }

  return bestText
}

function looksLikeFlashcardsEntry(entry: StudioEntry): boolean {
  const haystack = normalizeMatchText(`${entry.title} ${entry.meta ?? ""} ${entry.type ?? ""}`)
  return haystack.includes("flashcard") || haystack.includes("cartao") || haystack.includes("cards")
}

function clickStudioEntryNode(node: HTMLElement): void {
  const target =
    node.closest<HTMLElement>("[role='listitem'], li, button, [role='button'], a") ??
    node
  target.click()
}

function enableNativeSlidesCaptureOnlyMode(ttlMs = 3200): void {
  const ttl = Number.isFinite(ttlMs) ? Math.max(300, Math.min(10000, Math.trunc(ttlMs))) : 3200
  try {
    const globalRecord = window as unknown as Record<string, unknown>
    globalRecord.__mdNativeDlCaptureOnlyUntil = Date.now() + ttl
  } catch {}

  try {
    window.dispatchEvent(
      new CustomEvent(NATIVE_SLIDES_CAPTURE_ONLY_EVENT, {
        detail: { ttlMs: ttl }
      })
    )
  } catch {}

  try {
    window.postMessage(
      {
        source: "minddock",
        type: NATIVE_SLIDES_CAPTURE_ONLY_EVENT,
        payload: { ttlMs: ttl }
      },
      "*"
    )
  } catch {}
}

function clickElementBestEffort(target: HTMLElement): void {
  try {
    target.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      })
    )
  } catch {}
  try {
    target.click()
  } catch {}
}

function isInsideMindDockUi(element: HTMLElement): boolean {
  if (
    element.closest(
      "#minddock-studio-export-root, #minddock-source-actions-root, #minddock-source-filters-root, #minddock-conversation-export-root"
    )
  ) {
    return true
  }

  const rootNode = element.getRootNode()
  if (rootNode instanceof ShadowRoot) {
    const host = rootNode.host as HTMLElement | null
    if (host?.hasAttribute("data-minddock-shadow-host") || host?.hasAttribute("data-minddock-host")) {
      return true
    }
  }

  return false
}

function isLikelyNotebookViewerControl(element: HTMLElement): boolean {
  let node: HTMLElement | null = element
  for (let depth = 0; depth < 8 && node; depth += 1) {
    const id = String(node.id ?? "").toLowerCase()
    const cls = typeof node.className === "string" ? node.className.toLowerCase() : ""
    const testId = String(node.getAttribute("data-testid") ?? "").toLowerCase()
    const role = String(node.getAttribute("role") ?? "").toLowerCase()
    const merged = `${id} ${cls} ${testId} ${role}`
    if (/(artifact|viewer|result|preview|dock_to_right|labs)/.test(merged)) {
      return true
    }
    if (/(minddock|source|fontes)/.test(merged)) {
      return false
    }
    node = node.parentElement
  }
  return false
}

function resolveArtifactLibraryItemByTitle(title: string): HTMLElement | null {
  const normalizedTitle = normalizeTypeToken(String(title ?? ""))
  if (!normalizedTitle) return null
  const normalizedPrefix = normalizedTitle.slice(0, 40)
  const items = queryDeepAll<HTMLElement>(["artifact-library-item"]).filter(
    (item) => isVisibleElement(item) && !isInsideMindDockUi(item)
  )

  let best: { item: HTMLElement; score: number } | null = null

  for (const item of items) {
    const labelNode = queryDeepAllWithin(
      [".mdc-button__label", "[class*='artifact-item-label']", "[class*='item-title']"],
      item
    ).find((node) => node instanceof HTMLElement && isVisibleElement(node))
    const rawText = String(labelNode?.innerText || labelNode?.textContent || item.innerText || item.textContent || "")
    const normalizedText = normalizeTypeToken(rawText)
    if (!normalizedText) continue

    let score = 0
    if (normalizedText === normalizedTitle) score += 200
    if (normalizedText.includes(normalizedTitle)) score += 160
    if (normalizedTitle.includes(normalizedText)) score += 80
    if (normalizedPrefix && normalizedText.includes(normalizedPrefix)) score += 70
    if (normalizedText.includes("slides")) score += 25
    if (/slides/i.test(String(item.getAttribute("aria-description") ?? ""))) score += 80

    if (score <= 0) continue
    if (!best || score > best.score) {
      best = { item, score }
    }
  }

  return best?.item ?? null
}

function resolveMoreVertButtonForItem(item: HTMLElement): HTMLElement | null {
  const iconNodes = queryDeepAllWithin(
    ["mat-icon", ".material-icons", "[class*='material-symbols']", "[class*='google-symbols']"],
    item
  )

  for (const icon of iconNodes) {
    const token = String(icon.textContent ?? "").trim()
    if (token !== "more_vert") continue
    const button = icon.closest<HTMLElement>("button, [role='button']")
    if (button && isVisibleElement(button) && !isInsideMindDockUi(button)) {
      return button
    }
  }

  return null
}

function resolvePdfMenuButton(): HTMLElement | null {
  const menuPanels = queryDeepAll<HTMLElement>([".mat-mdc-menu-panel", ".mat-menu-panel", "[role='menu']"]).filter(
    (panel) => isVisibleElement(panel) && !isInsideMindDockUi(panel)
  )

  for (const panel of menuPanels) {
    const buttons = queryDeepAllWithin(
      ["button[role='menuitem']", "[mat-menu-item]", "button", "[role='menuitem']"],
      panel
    ).filter((button) => button instanceof HTMLElement && isVisibleElement(button))

    for (const button of buttons) {
      if (isInsideMindDockUi(button)) continue
      const icons = queryDeepAllWithin(
        ["mat-icon", ".material-icons", "[class*='material-symbols']", "[class*='google-symbols']"],
        button
      )
      for (const icon of icons) {
        const token = String(icon.textContent ?? "").trim()
        if (token === "picture_as_pdf") {
          return button
        }
      }
    }
  }

  return null
}

function resolveNativeSlidesDownloadTrigger(entryTitle: string): HTMLElement | null {
  const item = resolveArtifactLibraryItemByTitle(entryTitle)
  if (!item) return null
  return resolveMoreVertButtonForItem(item)
}

function resolveStudioLiveNodeById(id: string): HTMLElement | null {
  if (!UUID_RE.test(String(id))) return null
  const liveEntry = readStudioTitlesFromDom().find((entry) => String(entry.id) === String(id))
  return (liveEntry?.node as HTMLElement | undefined) ?? null
}

async function captureNativeSlidesPdfUrlForEntry(entry: StudioEntry, timeoutMs = 2200): Promise<boolean> {
  const targetNode =
    (entry.node instanceof HTMLElement && entry.node.isConnected ? entry.node : null) ??
    resolveStudioLiveNodeById(String(entry.id ?? ""))

  if (targetNode) {
    const previousViewerContent = resolveStudioViewerContent()
    clickStudioEntryNode(targetNode)
    await sleep(120)
    await waitForStudioContentUpdate(previousViewerContent, 900)
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const moreButton = resolveNativeSlidesDownloadTrigger(String(entry.title ?? ""))
    if (!moreButton) {
      await sleep(180)
      continue
    }

    enableNativeSlidesCaptureOnlyMode(timeoutMs + 1200)
    clickElementBestEffort(moreButton)

    const menuDeadline = Date.now() + 3200
    let pdfButton: HTMLElement | null = null
    while (Date.now() < menuDeadline) {
      pdfButton = resolvePdfMenuButton()
      if (pdfButton) break
      await sleep(90)
    }

    if (!pdfButton) {
      await sleep(160)
      continue
    }

    enableNativeSlidesCaptureOnlyMode(timeoutMs + 1200)
    pdfButton.addEventListener(
      "click",
      (event) => {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
      },
      { once: true, capture: true }
    )
    clickElementBestEffort(pdfButton)
    await sleep(220)
    return true
  }

  return false
}

function scrapeOpenNoteContent(): { title: string; content: string } | null {
  try {
    const titleInput = document.querySelector<HTMLInputElement>("input.artifact-title")
    const title = titleInput?.value?.trim() || "Nota do Studio"
    const container = document.querySelector<HTMLElement>(".artifact-content")
    if (!container) return null

    const paragraphs = Array.from(
      container.querySelectorAll<HTMLElement>("div[class^='paragraph']")
    )
    if (paragraphs.length === 0) return null

    const lines: string[] = []

    for (const paragraph of paragraphs) {
      let blockPrefix = ""
      if (paragraph.classList.contains("heading1")) blockPrefix = "# "
      else if (paragraph.classList.contains("heading2")) blockPrefix = "## "
      else if (paragraph.classList.contains("heading3")) blockPrefix = "### "
      else if (paragraph.classList.contains("heading4")) blockPrefix = "#### "

      const segments: Array<{ type: "text" | "bold" | "italic" | "code"; content: string }> = []
      paragraph.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const value = String(node.textContent ?? "")
          if (value) segments.push({ type: "text", content: value })
          return
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return
        const el = node as HTMLElement
        const text = String(el.textContent ?? "")
        if (!text) return
        if (el.tagName === "B" || el.tagName === "STRONG") {
          segments.push({ type: "bold", content: text })
          return
        }
        if (el.tagName === "I" || el.tagName === "EM") {
          segments.push({ type: "italic", content: text })
          return
        }
        if (el.tagName === "CODE") {
          segments.push({ type: "code", content: text })
          return
        }
        segments.push({ type: "text", content: text })
      })

      const merged: typeof segments = []
      for (const seg of segments) {
        const last = merged[merged.length - 1]
        if (last && last.type === "text" && seg.type === "text") {
          last.content += seg.content
        } else {
          merged.push({ ...seg })
        }
      }

      const line =
        blockPrefix +
        merged
          .map((seg) => {
            if (!seg.content) return ""
            if (seg.type === "bold") return `**${seg.content}**`
            if (seg.type === "italic") return `*${seg.content}*`
            if (seg.type === "code") return `\`${seg.content}\``
            return seg.content
          })
          .join("")
          .trim()

      if (line) lines.push(line)
    }

    const content = lines.join("\n\n").trim()
    if (!content) return null
    return { title, content }
  } catch {
    return null
  }
}

async function scrapeFlashcardsFromDom(): Promise<string | null> {
  const iframe =
    document.querySelector<HTMLIFrameElement>("iframe[src^='blob:']") ??
    document.querySelector<HTMLIFrameElement>("[data-testid*='flashcard'] iframe")
  if (!iframe?.src) {
    return null
  }

  try {
    const rawHtml = await (await fetch(iframe.src)).text()
    const doc = new DOMParser().parseFromString(rawHtml, "text/html")
    const appRoot = doc.querySelector("app-root")
    if (!appRoot) return null
    const dataAttr = appRoot.getAttribute("data-app-data")
    if (!dataAttr) return null

    const decoder = document.createElement("textarea")
    decoder.innerHTML = dataAttr
    const decoded = decoder.value
    const parsed = JSON.parse(decoded)

    const cards: Array<{ front: string; back: string }> = []
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return
      if (Array.isArray(node)) {
        node.forEach(walk)
        return
      }
      const record = node as Record<string, unknown>
      const front = record.f
      const back = record.b
      if (front && back) {
        cards.push({ front: String(front), back: String(back) })
      }
      Object.values(record).forEach(walk)
    }

    walk(parsed)
    if (cards.length === 0) return null

    const lines: string[] = ["# Flashcards"]
    cards.forEach((card, index) => {
      lines.push(`## ${index + 1}`)
      lines.push(`**Frente:** ${card.front}`)
      lines.push(`**Verso:** ${card.back}`)
      lines.push("")
    })

    return lines.join("\n").trim()
  } catch {
    return null
  }
}

async function waitForStudioContentUpdate(previous: string, timeoutMs = 2000): Promise<string> {
  const start = Date.now()
  let last = ""
  while (Date.now() - start < timeoutMs) {
    const current = resolveStudioViewerContent()
    if (current && current !== previous) {
      return current
    }
    last = current
    await new Promise((resolve) => setTimeout(resolve, 140))
  }
  return last
}

function formatExportTimestamp(isoDate: string): string {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) {
    return isoDate
  }
  return date.toLocaleString("pt-BR")
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//iu.test(value) || value.startsWith("//")
}

function normalizeAssetUrl(value: string): string {
  const trimmed = String(value ?? "").trim().replace(/\\\//g, "/")
  if (!trimmed) return ""
  if (trimmed.startsWith("//")) return `https:${trimmed}`
  if (trimmed.startsWith("/")) {
    try {
      return new URL(trimmed, window.location.origin).toString()
    } catch {
      return trimmed
    }
  }
  return trimmed
}

const TELEMETRY_HOST_PATTERNS = [
  /(^|\.)play\.google\.com$/i,
  /(^|\.)analytics\.google\.com$/i,
  /(^|\.)google-analytics\.com$/i,
  /(^|\.)doubleclick\.net$/i,
  /(^|\.)googletagmanager\.com$/i,
  /(^|\.)googlesyndication\.com$/i
]

function isBlockedTelemetryUrl(value: string): boolean {
  const normalized = normalizeAssetUrl(value)
  if (!looksLikeUrl(normalized)) return true

  try {
    const parsed = new URL(normalized)
    const host = parsed.hostname.toLowerCase()
    const path = parsed.pathname.toLowerCase()
    const full = `${host}${path}${parsed.search}`.toLowerCase()

    if (TELEMETRY_HOST_PATTERNS.some((pattern) => pattern.test(host))) return true
    if (host === "play.google.com" && path.startsWith("/log")) return true
    if (path.includes("/collect") || path.includes("/log")) {
      if (host.includes("google") || host.includes("analytics") || host.includes("doubleclick")) return true
    }
    if (full.includes("serviceLogin?continue=") || full.includes("accounts.google.com/servicelogin")) return true

    return false
  } catch {
    return true
  }
}

function hasStrongAssetSignal(url: string): boolean {
  const lower = String(url ?? "").toLowerCase()
  if (!lower) return false
  if (/\.(pdf|png|jpe?g|webp|gif|mp4|webm|mov|mp3|wav|ogg)(?:[?#]|$)/i.test(lower)) return true
  if (/(?:^|[?&])mime=(application\/pdf|image\/|video\/|audio\/)/i.test(lower)) return true
  if (/application%2fpdf|video%2f|audio%2f|image%2f/i.test(lower)) return true
  if (/(?:^|[?&])(alt=media|download=|response-content-type=)/i.test(lower)) return true
  if (/googleusercontent\.com|googlevideo\.com|\/notebooklm\/|\/rd-notebook\//i.test(lower)) return true
  return false
}

function isLikelySlidesAssetCandidateUrl(url: string): boolean {
  const normalized = normalizeAssetUrl(url)
  if (isBlockedTelemetryUrl(normalized)) return false
  if (hasStrongAssetSignal(normalized)) return true
  const lower = normalized.toLowerCase()
  if (/slides?|presentation|deck|drive_presentation|tablet/i.test(lower)) return true
  return false
}

function resolveEntryAssetUrl(entry: Pick<StudioEntry, "url" | "content">): string | undefined {
  const candidates: string[] = []
  const push = (value?: string) => {
    const normalized = normalizeAssetUrl(String(value ?? ""))
    if (normalized && !isBlockedTelemetryUrl(normalized)) candidates.push(normalized)
  }

  push(entry.url ?? "")

  const rawContent = String(entry.content ?? "").trim()
  if (!rawContent) {
    return candidates.find((value) => looksLikeUrl(value))
  }

  push(rawContent)

  const uriMatch = rawContent.match(/"(?:url|uri)"\s*:\s*"([^"]+)"/i)
  if (uriMatch?.[1]) {
    push(uriMatch[1])
  }

  const rawMatches = rawContent.match(/(?:https?:\/\/|\/\/)[^\s"'<>]+/gi) ?? []
  rawMatches.forEach((match) => push(match))

  const escapedMatches = rawContent.match(/https?:\\\/\\\/[^\s"'<>]+/gi) ?? []
  escapedMatches.forEach((match) => push(match.replace(/\\\//g, "/")))

  const unique = Array.from(new Set(candidates))
  const mediaFirst = unique.find((value) => looksLikeUrl(value) && isDownloadableAssetUrl(value))
  if (mediaFirst) return mediaFirst

  const anyUrl = unique.find((value) => looksLikeUrl(value) && !isBlockedTelemetryUrl(value))
  if (anyUrl) return anyUrl

  return undefined
}

function isPdfSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  )
}

function normalizeFetchedMimeType(value?: string): string {
  return String(value ?? "")
    .toLowerCase()
    .split(";")[0]
    .trim()
    .replace(/^"+|"+$/g, "")
}

function normalizeTypeToken(value?: string): string {
  const base = String(value ?? "").trim().toLowerCase()
  if (!base) return ""
  return base.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function isSlidesLikeEntryType(type?: string): boolean {
  const token = normalizeTypeToken(type)
  if (!token) return false
  return (
    token === "8" ||
    token === "12" ||
    token === "slides" ||
    token === "tablet" ||
    token === "timeline" ||
    token === "linha do tempo" ||
    token === "apresentacao" ||
    token === "apresentacao de slides"
  )
}

const EXCLUDED_TYPE_CODES = new Set(["4", "11", "13"])
const EXCLUDED_TYPE_TOKENS = new Set([
  "quiz",
  "data table",
  "tabela de dados",
  "flashcards",
  "flashcard"
])
const HARD_BLOCKED_STUDIO_TITLE_PATTERNS: RegExp[] = [
  /\bmetodos?\s+e\s+ferramentas\b.*\blanding\s+pages\b.*\bcom\s+ia\b/i
]

function isExcludedTypeValue(value?: string): boolean {
  const raw = String(value ?? "").trim()
  if (!raw) return false
  if (EXCLUDED_FROM_EXPORT.has(raw)) return true
  if (EXCLUDED_TYPE_CODES.has(raw)) return true

  const normalized = normalizeTypeToken(raw)
  if (EXCLUDED_TYPE_TOKENS.has(normalized)) return true

  const mapped = STUDIO_TYPE_LABELS[raw]
  if (mapped && EXCLUDED_TYPE_TOKENS.has(normalizeTypeToken(mapped))) {
    return true
  }
  return false
}

function isHardBlockedStudioTitle(title?: string): boolean {
  const normalizedTitle = normalizeTypeToken(title)
  if (!normalizedTitle) return false
  return HARD_BLOCKED_STUDIO_TITLE_PATTERNS.some((pattern) => pattern.test(normalizedTitle))
}

const KNOWN_STUDIO_TYPE_TOKENS = new Set([
  "audio overview",
  "video overview",
  "mind map",
  "timeline",
  "linha do tempo",
  "briefing",
  "faq",
  "sumario",
  "slides",
  "infographic",
  "infografico",
  "blog post",
  "study guide",
  "guia de estudo",
  "data table",
  "tabela de dados",
  "quiz",
  "flashcards",
  "flashcard"
])

function isKnownStudioTypeValue(value?: string): boolean {
  const raw = String(value ?? "").trim()
  if (!raw) return false
  if (STUDIO_TYPE_LABELS[raw]) return true
  if (isExcludedTypeValue(raw)) return true
  if (isVisualTypeCode(raw) || isVisualTypeLabel(raw)) return true

  const normalized = normalizeTypeToken(raw)
  if (!normalized) return false
  return KNOWN_STUDIO_TYPE_TOKENS.has(normalized)
}

function resolvePreferredType(existingType?: string, incomingType?: string): string | undefined {
  const existing = String(existingType ?? "").trim()
  const incoming = String(incomingType ?? "").trim()
  if (!existing) return incoming || undefined
  if (!incoming) return existing || undefined

  const existingStrong = isKnownStudioTypeValue(existing)
  const incomingStrong = isKnownStudioTypeValue(incoming)
  if (!existingStrong && incomingStrong) return incoming
  if (existingStrong && !incomingStrong) return existing
  if (!existingStrong && !incomingStrong) return incoming

  const existingExcluded = isExcludedTypeValue(existing)
  const incomingExcluded = isExcludedTypeValue(incoming)
  const existingVisual = isVisualTypeCode(existing) || isVisualTypeLabel(existing)
  const incomingVisual = isVisualTypeCode(incoming) || isVisualTypeLabel(incoming)
  if (existingExcluded !== incomingExcluded) {
    // Se o tipo novo e visual valido (ex: Slides), ele deve destravar
    // classificacoes antigas excluidas/ruins.
    if (!incomingExcluded && incomingVisual) return incoming
    if (!existingExcluded && existingVisual) return existing
    return incomingExcluded ? incoming : existing
  }

  if (existingVisual !== incomingVisual) {
    return incoming
  }

  const existingNumeric = /^\d+$/.test(existing)
  const incomingNumeric = /^\d+$/.test(incoming)
  if (existingNumeric !== incomingNumeric) {
    return incomingNumeric ? incoming : existing
  }

  return incoming
}

function looksLikeDataTableContent(value?: string): boolean {
  const text = normalizeEntryText(String(value ?? ""))
  if (!text || text.length < 120) return false

  const markdownTablePattern =
    /\n\|\s*[^|\n]+(\|\s*[^|\n]+)+\s*\|\n\|\s*:?-{3,}:?(\s*\|\s*:?-{3,}:?)+\s*\|/u
  if (markdownTablePattern.test(`\n${text}`)) {
    return true
  }

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 80)
  if (lines.length < 4) return false

  let structuredLines = 0
  for (const line of lines) {
    const byPipe = line.split("|").map((part) => part.trim()).filter(Boolean).length
    const byTab = line.split("\t").map((part) => part.trim()).filter(Boolean).length
    const byGap = line.split(/\s{2,}/u).map((part) => part.trim()).filter(Boolean).length
    const cells = Math.max(byPipe, byTab, byGap)
    if (cells >= 4) {
      structuredLines += 1
    }
  }

  if (structuredLines >= 3) {
    return true
  }

  const normalized = normalizeTypeToken(text)
  const tableKeywords = [
    "pilar",
    "etapa",
    "descricao",
    "ferramentas",
    "visualizacao",
    "fonte",
    "categoria",
    "indicador",
    "metrica",
    "coluna"
  ]
  const keywordHits = tableKeywords.reduce(
    (count, keyword) => count + (normalized.includes(keyword) ? 1 : 0),
    0
  )
  return keywordHits >= 3 && structuredLines >= 2
}

function isExcludedStudioEntry(entry: Pick<StudioEntry, "type" | "title" | "meta" | "content">): boolean {
  if (isHardBlockedStudioTitle(entry.title)) return true
  const explicitType = String(entry.type ?? "").trim()
  if (explicitType) {
    if (isExcludedTypeValue(explicitType)) return true
    // Alguns Data Table chegam como Blog Post (type=9). SÃƒÂ³ nesse caso aplicamos
    // a heurÃƒÂ­stica por conteÃƒÂºdo para evitar falso positivo em Guia de Estudo.
    const normalizedType = normalizeTypeToken(explicitType)
    const mappedType = normalizeTypeToken(STUDIO_TYPE_LABELS[explicitType] ?? "")
    const isBlogPostLike =
      explicitType === "9" ||
      normalizedType === "blog post" ||
      mappedType === "blog post"
    if (isBlogPostLike && looksLikeDataTableContent(entry.content)) return true
    return false
  }

  // Sem tipo explÃƒÂ­cito, usa apenas tÃƒÂ­tulo/meta (nunca conteÃƒÂºdo) para evitar
  // falso positivo em documentos longos.
  const titleMeta = normalizeTypeToken(`${entry.title ?? ""} ${entry.meta ?? ""}`)
  if (/data table|tabela de dados/.test(titleMeta)) return true
  if (/quiz/.test(titleMeta)) return true
  if (/flashcard|cartao|cartoes/.test(titleMeta)) return true
  return false
}

function inferTypeFromSignals(title?: string, meta?: string, content?: string): string | undefined {
  const haystack = normalizeTypeToken(`${title ?? ""} ${meta ?? ""} ${content ?? ""}`)
  if (!haystack) return undefined
  if (/quiz|answer key|glossary/.test(haystack)) return "Quiz"
  if (/flashcard|cartao|cartoes/.test(haystack)) return "Flashcards"
  if (/data table|tabela de dados/.test(haystack)) return "Data Table"
  if (/mind map|mapa mental/.test(haystack)) return "Mind Map"
  if (/video overview/.test(haystack)) return "Video Overview"
  if (/audio overview/.test(haystack)) return "Audio Overview"
  if (/slides?/.test(haystack)) return "Slides"
  if (/infograph|infograf/.test(haystack)) return "Infographic"
  return undefined
}

const VISUAL_TYPE_CODES = new Set(["1", "3", "5", "6", "7", "8", "10", "12", "14"])

function isVisualTypeCode(type?: string): boolean {
  const token = String(type ?? "").trim()
  if (!token) return false
  return VISUAL_TYPE_CODES.has(token)
}

function isVisualTypeLabel(type?: string): boolean {
  const normalized = normalizeTypeToken(type)
  if (!normalized) return false
  return (
    normalized === "video overview" ||
    normalized === "audio overview" ||
    normalized === "slides" ||
    normalized === "infographic" ||
    normalized === "mind map" ||
    normalized === "infografico" ||
    normalized === "mapa mental" ||
    normalized === "briefing" ||
    normalized === "timeline" ||
    normalized === "linha do tempo" ||
    normalized === "sumario"
  )
}

function isVisualAssetEntry(entry: StudioEntry): boolean {
  const kind = String(entry.kind ?? "").trim().toLowerCase()
  const mime = String(entry.mimeType ?? "").trim().toLowerCase()
  const type = normalizeTypeToken(entry.type)
  const contentText = typeof entry.content === "string" ? entry.content.trim() : ""

  const assetUrl =
    resolveEntryAssetUrl(entry) ||
    (typeof entry.url === "string" ? entry.url : "") ||
    (typeof entry.content === "string" ? entry.content : "")

  const hasUrl = /^(https?:)?\/\//i.test(assetUrl)
  const hasVisualUrl = isDownloadableAssetUrl(assetUrl)
  const isVisualMime = /^(video|audio|image)\//u.test(mime) || mime === "application/pdf"
  const isVisualType = isVisualTypeLabel(type)
  const isVisualCode = isVisualTypeCode(entry.type)

  if (hasVisualUrl) return true
  if (hasUrl && (kind === "asset" || !contentText || looksLikeUrl(contentText))) return true
  if (kind === "asset") return hasUrl || isVisualMime || isVisualType || isVisualCode
  if (isVisualMime || isVisualType || isVisualCode) return true
  return false
}

function shouldTreatEntryAsAssetForExport(entry: StudioEntry): boolean {
  if (isVisualAssetEntry(entry)) return true
  const assetUrl = resolveEntryAssetUrl(entry)
  if (!assetUrl) return false

  const contentText = typeof entry.content === "string" ? entry.content.trim() : ""
  const kind = String(entry.kind ?? "").trim().toLowerCase()

  if (kind === "asset") return true
  if (isDownloadableAssetUrl(assetUrl)) return true
  if (!contentText || looksLikeUrl(contentText)) return true
  return false
}

function isStudioLoadingTitle(title?: string): boolean {
  const normalized = normalizeTypeToken(title)
  if (!normalized) return true
  return normalized.includes("carregando resultado do estudio")
}

function shouldApplyDeepProbeTitle(entry: StudioEntry, nextTitle: string): boolean {
  const candidate = String(nextTitle ?? "").trim()
  if (!candidate || !looksLikeSidebarEntryTitle(candidate)) {
    return false
  }
  if (candidate === entry.title) {
    return false
  }
  if (isStudioLoadingTitle(entry.title)) {
    return true
  }
  if (isVisualAssetEntry(entry)) {
    return true
  }
  if (isVisualTypeCode(entry.type)) {
    return true
  }
  return false
}

async function downloadAssetEntry(entry: StudioEntry): Promise<void> {
  const url = resolveEntryAssetUrl(entry)
  if (!url) return
  const ext = resolveFileExtension(entry.type ?? "", url)
  const filename = `${String(entry.title ?? "studio").replace(/[^a-z0-9]/gi, "_")}.${ext}`
  try {
    const res = await fetch(url, { credentials: "include" })
    if (res.ok) {
      const blob = await res.blob()
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob)
      a.download = filename
      document.body.appendChild(a)
      a.click()
      setTimeout(() => {
        document.body.removeChild(a)
        URL.revokeObjectURL(a.href)
      }, 1000)
      return
    }
  } catch {}
  if (typeof chrome !== "undefined" && chrome.downloads) {
    chrome.downloads.download({ url, filename, saveAs: false })
  } else {
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }
}

async function downloadAssetEntries(entries: StudioEntry[]): Promise<void> {
  if (entries.length === 0) return
  const usedNames = new Set<string>()
  for (const entry of entries) {
    const url = resolveEntryAssetUrl(entry)
    if (!url) continue
    const base = buildMindDuckFilenameBase("Studio", entry.title)
    const extension = resolveAssetExtension(entry)
    const filename = buildUniqueStudioFilename(base, extension, usedNames)
    if (typeof chrome !== "undefined" && chrome.downloads) {
      chrome.downloads.download({ url, filename, saveAs: false })
      continue
    }
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }
}

function buildStudioEntryBlock(
  entry: StudioEntry,
  index: number,
  format: StudioFormat,
  options?: { isLoading?: boolean }
): string {
  const lines: string[] = []
  const isLoading = Boolean(options?.isLoading)

  const isVisual = isVisualAssetEntry(entry)
  const isExcluded = isExcludedStudioEntry(entry)

  if (isVisual || isExcluded) return ""

  if (format === "markdown") {
    lines.push(`## ${index + 1}. ${entry.title}`)
    if (entry.meta) lines.push(`_${entry.meta}_`)
  } else {
    lines.push(`${index + 1}. ${entry.title}`)
    if (entry.meta) lines.push(entry.meta)
  }

  const contentText = typeof entry.content === "string" ? entry.content.trim() : ""

  if (contentText && !looksLikeUrl(contentText)) {
    lines.push("")
    lines.push(contentText)
  } else if (isLoading) {
    lines.push("")
    lines.push("(carregando conteÃƒÂºdo...)")
  } else {
    lines.push("")
    lines.push("(sem conteÃƒÂºdo carregado)")
  }

  return lines.join("\n").trim()
}

function buildStudioExportTextFromDrafts(
  entries: StudioEntry[],
  format: StudioFormat,
  generatedAtIso: string,
  draftMap: Record<string, string>
): string {
  const exportedAt = formatExportTimestamp(generatedAtIso)
  const lines: string[] = []

  if (format === "markdown") {
    lines.push("# Studio")
  } else {
    lines.push("Studio")
  }
  lines.push("")
  lines.push(`Exported at: ${exportedAt}`)
  lines.push("")
  lines.push("---")
  lines.push("")

  if (entries.length === 0) {
    lines.push("Nenhum item do Studio foi encontrado nesta aba.")
    return lines.join("\n")
  }

  entries.forEach((entry, index) => {
    const hasDraft = Object.prototype.hasOwnProperty.call(draftMap, entry.id)
    const fallback = buildStudioEntryBlock(entry, index, format)
    const block = hasDraft ? draftMap[entry.id] : fallback
    lines.push(block ?? "")
    lines.push("")
    lines.push("---")
    lines.push("")
  })

  return lines.join("\n").trim()
}

async function sendBackgroundCommand<T = unknown>(
  action: string,
  payload?: Record<string, unknown>
): Promise<StandardResponse<T>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        action,
        command: action,
        payload
      },
      (response: StandardResponse<T> & { data?: T }) => {
        if (chrome.runtime.lastError?.message) {
          resolve({
            success: false,
            error: chrome.runtime.lastError.message
          })
          return
        }

        resolve(response ?? { success: false, error: "No response from the background script." })
      }
    )
  })
}

async function buildPdfBytesViaBackground(text: string): Promise<Uint8Array> {
  const response = await sendBackgroundCommand<{ base64?: string }>(
    MESSAGE_ACTIONS.CMD_RENDER_PDF_OFFSCREEN,
    { text }
  )

  if (!response.success) {
    throw new Error(response.error ?? "Falha ao gerar PDF.")
  }

  const payload = response.payload ?? response.data
  const base64 = String(payload?.base64 ?? "").trim()
  if (!base64) {
    throw new Error("Resposta PDF vazia.")
  }

  return base64ToBytes(base64)
}

async function imageBlobToPdfBlob(imageBlob: Blob): Promise<Blob> {
  const obj = URL.createObjectURL(imageBlob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error("image decode failed"))
      el.src = obj
    })

    const width = image.naturalWidth || image.width || 1
    const height = image.naturalHeight || image.height || 1

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("canvas context unavailable")
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(image, 0, 0, width, height)
    const jpgDataUrl = canvas.toDataURL("image/jpeg", 0.92)

    const pxToPt = 72 / 96
    const pageWidthPt = width * pxToPt
    const pageHeightPt = height * pxToPt

    const pdf = new jsPDF({
      orientation: pageWidthPt >= pageHeightPt ? "l" : "p",
      unit: "pt",
      format: [pageWidthPt, pageHeightPt],
      compress: true
    })

    pdf.addImage(jpgDataUrl, "JPEG", 0, 0, pageWidthPt, pageHeightPt, undefined, "FAST")
    return pdf.output("blob")
  } finally {
    URL.revokeObjectURL(obj)
  }
}

async function buildPdfBytesFromImageBytes(bytes: Uint8Array, mimeType?: string): Promise<Uint8Array> {
  const safeMime = String(mimeType ?? "").toLowerCase().startsWith("image/") ? String(mimeType) : "image/png"
  const blob = new Blob([toArrayBuffer(bytes)], { type: safeMime })
  const pdfBlob = await imageBlobToPdfBlob(blob)
  return new Uint8Array(await pdfBlob.arrayBuffer())
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function extractExtensionFromUrl(url: string): string | null {
  try {
    const resolved = new URL(url)
    const segments = resolved.pathname.split("/")
    const last = segments[segments.length - 1] ?? ""
    const dotIndex = last.lastIndexOf(".")
    if (dotIndex <= 0 || dotIndex === last.length - 1) {
      return null
    }
    const ext = last.slice(dotIndex + 1).toLowerCase()
    return ext.length <= 8 ? ext : null
  } catch {
    return null
  }
}

function looksLikeUrlTitle(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  if (!normalized) {
    return false
  }
  if (normalized.startsWith("http://") || normalized.startsWith("https://") || normalized.startsWith("www.")) {
    return true
  }
  if (normalized.includes("youtu.be") || normalized.includes("youtube.com")) {
    return true
  }
  return false
}

function isDownloadableAssetUrl(value: string | undefined): boolean {
  if (!value) {
    return false
  }
  if (isBlockedTelemetryUrl(value)) {
    return false
  }
  const lower = value.toLowerCase()
  if (lower.startsWith("//")) {
    return isDownloadableAssetUrl(`https:${lower}`)
  }
  if (/\.(png|jpe?g|gif|webp|svg|mp3|wav|ogg|m4a|aac|flac|mp4|mkv|webm|mov|avi|pdf)(\?|#|$)/u.test(lower)) {
    return true
  }
  if (lower.includes("alt=media") || lower.includes("download=")) {
    return true
  }
  if (
    /googleusercontent\.com|=m22\b|=m140\b|video%2f(mp4|webm)|audio%2f(mp4|mpeg|mp3)|application%2fpdf|\/video\/|\/audio\/|\/image\//u.test(
      lower
    )
  ) {
    return true
  }
  return false
}

const STUDIO_INVALID_META = new Set(["resultado do studio"])
const CHAT_SIGNAL_PHRASES = [
  "create a detailed briefing document",
  "include quotes from the original",
  "designed to address this topic",
  "inclua citaÃƒÂ§ÃƒÂµes",
  "crie um briefing detalhado",
  "responda a esta pergunta"
]
const STUDIO_TEMPLATE_BLOCKLIST = [
  "informational article in the style of a blog post",
  "blog post",
  "study guide",
  "faq",
  "timeline",
  "mind map",
  "infographic",
  "infografico",
  "infogrÃƒÂ¡fico"
]

function isTemplateLikeTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase()
  if (!normalized) {
    return false
  }
  return STUDIO_TEMPLATE_BLOCKLIST.some((template) => normalized.includes(template))
}

function looksLikeSidebarEntryTitle(value: string): boolean {
  const title = String(value ?? "").trim()
  if (!title) return false
  if (title.length < 4 || title.length > 120) return false
  if (/^[a-z]{2}[_-][a-z]{2}$/i.test(title)) return false
  if (!/\p{L}/u.test(title)) return false
  if (/^[\d\s).:-]+$/u.test(title)) return false

  const words = title.split(/\s+/u).filter(Boolean)
  if (words.length > 14) return false
  if (/[.!?]\s/u.test(title)) return false
  if (/,\s/u.test(title) && words.length > 8) return false

  return true
}

const MAX_STUDIO_JSON_DEPTH = 4

function looksLikeStructuredStudioContent(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }
  if (trimmed[0] !== "{" && trimmed[0] !== "[") {
    return false
  }
  if (!trimmed.includes("\"name\"") && !trimmed.includes("\"children\"") && !trimmed.includes("\"nodes\"")) {
    return false
  }

  try {
    const parsed = JSON.parse(trimmed)
    return containsStructuredStudioNode(parsed, 0)
  } catch {
    return false
  }
}

function containsStructuredStudioNode(node: unknown, depth: number): boolean {
  if (depth > MAX_STUDIO_JSON_DEPTH) {
    return false
  }
  if (Array.isArray(node)) {
    return node.some((child) => containsStructuredStudioNode(child, depth + 1))
  }
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>
    if (typeof record.name === "string" && Array.isArray(record.children)) {
      return true
    }
    if (Array.isArray(record.nodes)) {
      return true
    }
    return Object.values(record).some((child) => containsStructuredStudioNode(child, depth + 1))
  }
  return false
}

function looksLikeStudioMetaSignal(value: string): boolean {
  const normalized = normalizeMatchText(value)
  if (!normalized) {
    return false
  }
  return (
    /\b\d+\s*(fontes?|sources?)\b/u.test(normalized) ||
    /\bha\s+\d+\b/u.test(normalized) ||
    /\b\d+\s*(hours?|horas?|mins?|minutes?|dias?)\b/u.test(normalized)
  )
}
function isValidStudioEntry(entry: StudioEntry): boolean {
  const title = entry.title?.trim()
  if (!title) {
    return false
  }
  if (isTemplateLikeTitle(title)) {
    return false
  }
  if (looksLikeUrlTitle(title)) {
    return false
  }
  if (title === "wXbhsf") {
    return false
  }
  if (isLikelyChatEntry(entry)) {
    return false
  }
  const metaValue = entry.meta?.trim() ?? ""
  const metaKey = metaValue.toLowerCase()
  const UUID_RE_VALIDATE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  // Itens com UUID real vieram do gArtLc Ã¢â‚¬â€ tÃƒÂ­tulo jÃƒÂ¡ ÃƒÂ© confiÃƒÂ¡vel
  if (UUID_RE_VALIDATE.test(entry.id ?? "")) {
    return String(entry.title ?? "").trim().length >= 3
  }

  const hasMeta = metaValue.length > 0 && !STUDIO_INVALID_META.has(metaKey) && looksLikeStudioMetaSignal(metaValue)
  const contentValue = entry.content?.trim() ?? ""
  const hasContent = contentValue.length > 0
  const hasAsset = isVisualAssetEntry(entry)
  if (!hasMeta && !hasAsset && !hasContent) {
    return false
  }
  return true
}

function applyStudioFilter(normalized: StudioEntry[], ids?: string[]): StudioEntry[] {
  const bypassFilter = (ids?.length ?? 0) > 0
  const filtered = bypassFilter ? normalized : normalized.filter(isValidStudioEntry)
  return filtered.length > 0 ? filtered : normalized
}

function isLikelyChatEntry(entry: StudioEntry): boolean {
  const title = entry.title?.trim().toLowerCase() ?? ""
  const meta = entry.meta?.trim().toLowerCase() ?? ""
  const content = entry.content?.trim().toLowerCase() ?? ""
  const hasQuestionTitle = title.endsWith("?")
  const hasChatPhrase = CHAT_SIGNAL_PHRASES.some(
    (phrase) => meta.includes(phrase) || content.includes(phrase)
  )
  const wordCount = title.split(/\s+/u).filter(Boolean).length
  const longSentence = wordCount > 14 || title.length > 90
  const dotSentence = /[.!?]/.test(title) && title.length > 70
  return hasQuestionTitle || hasChatPhrase || longSentence || dotSentence
}

function describeInvalidStudioEntry(entry: StudioEntry): string {
  const title = entry.title?.trim()
  if (!title) {
    return "missing-title"
  }
  if (looksLikeUrlTitle(title)) {
    return "url-title"
  }
  if (title === "wXbhsf") {
    return "rpc-id"
  }
  if (isLikelyChatEntry(entry)) {
    return "chat-like"
  }
  const metaValue = entry.meta?.trim() ?? ""
  const metaKey = metaValue.toLowerCase()
  const hasMeta = metaValue.length > 0 && !STUDIO_INVALID_META.has(metaKey) && looksLikeStudioMetaSignal(metaValue)
  const hasType = Boolean(entry.type && entry.type.trim())
  const contentValue = entry.content?.trim() ?? ""
  const hasContent = contentValue.length > 0
  const hasAsset = isVisualAssetEntry(entry)
  if (!hasMeta && !hasAsset && !hasContent) {
    return "no-signal"
  }
  if (!hasMeta && hasType) {
    return "type-only"
  }
  return "unknown"
}

function buildStudioDebugText(
  rawItems: StudioCacheItem[],
  normalized: StudioEntry[],
  filtered: StudioEntry[],
  usedKey: string | null
): string {
  const dropped = new Map<string, number>()
  normalized.forEach((entry) => {
    if (!filtered.includes(entry)) {
      const reason = describeInvalidStudioEntry(entry)
      dropped.set(reason, (dropped.get(reason) ?? 0) + 1)
    }
  })

  const droppedSummary = Array.from(dropped.entries())
    .map(([reason, count]) => `${reason}=${count}`)
    .join(", ")

  const chatLikeCount = normalized.filter(isLikelyChatEntry).length
  const samples = normalized.slice(0, 6).map((entry, index) => {
    const parts = [entry.title]
    if (entry.type) {
      parts.push(`type:${entry.type}`)
    }
    if (entry.meta) {
      parts.push(`meta:${entry.meta}`)
    }
    if (entry.url) {
      parts.push(`url:${entry.url}`)
    }
    return `${index + 1}. ${parts.join(" | ")}`
  })

  const lines = [
    "Diagnostico Studio",
    `Storage key: ${usedKey ?? "n/a"}`,
    `Raw cache: ${rawItems.length}`,
    `Normalized: ${normalized.length} (failed: ${rawItems.length - normalized.length})`,
    `Filtered: ${filtered.length} (dropped: ${normalized.length - filtered.length})`,
    `Dropped by: ${droppedSummary || "none"}`,
    `Chat-like detected: ${chatLikeCount}`
  ]

  if (samples.length > 0) {
    lines.push("Samples:")
    lines.push(...samples)
  }

  return lines.join("\n")
}

function extensionFromMime(mimeType?: string): string | null {
  const mime = String(mimeType ?? "").toLowerCase().split(";")[0].trim()
  const mapping: Record<string, string> = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "audio/mpeg": "mp3",
    "audio/mp4": "mp4",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov"
  }
  return mapping[mime] ?? null
}

function resolveAssetExtension(entry: StudioEntry, assetUrl?: string, fetchedMimeType?: string): string {
  const u = normalizeAssetUrl(assetUrl ?? resolveEntryAssetUrl(entry) ?? "")
  const slidesLike = isSlidesLikeEntryType(entry.type)
  if (slidesLike) return "pdf"
  const urlExt = extractExtensionFromUrl(u)
  if (urlExt) return urlExt

  const lowerUrl = u.toLowerCase()
  if (/googlevideo\.com|videoplayback|(?:^|[?&])mime=video\//i.test(lowerUrl) || /=m22|=m18|=m137|=m136|=m135/i.test(lowerUrl)) {
    return "mp4"
  }
  if (/(?:^|[?&])mime=audio\//i.test(lowerUrl) || /=m140|=m141|=m4a/i.test(lowerUrl)) {
    return "mp4"
  }
  if (/(?:^|[?&])mime=image\//i.test(lowerUrl)) {
    return "png"
  }
  if (/(?:^|[?&])mime=application\/pdf/i.test(lowerUrl) || lowerUrl.includes("application%2fpdf")) {
    return "pdf"
  }

  const mimeExt = extensionFromMime(fetchedMimeType) ?? extensionFromMime(entry.mimeType)
  if (mimeExt) return mimeExt

  const type = String(entry.type ?? "").toLowerCase()
  if (type.includes("slides")) return "pdf"
  if (type.includes("infographic")) return "png"
  if (type.includes("mind map")) return "png"
  if (type.includes("audio")) return "mp4"
  if (type.includes("video")) return "mp4"
  return "bin"
}

function buildUniqueStudioFilename(base: string, extension: string, usedNames: Set<string>): string {
  const safeBase = sanitizeFilename(base)
  const ext = extension.startsWith(".") ? extension : `.${extension}`
  let filename = `${safeBase}${ext}`
  let index = 1
  while (usedNames.has(filename)) {
    filename = `${safeBase}-${index}${ext}`
    index += 1
  }
  usedNames.add(filename)
  return filename
}

function withAuthUserIfGoogle(url: string, authUser?: string | number | null): string {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    const isGoogle = host.endsWith("google.com") || host.endsWith("googleusercontent.com")
    if (!isGoogle || parsed.searchParams.has("authuser")) {
      return url
    }
    if (authUser === null || authUser === undefined || String(authUser).trim() === "") {
      return url
    }
    parsed.searchParams.set("authuser", String(authUser))
    return parsed.toString()
  } catch {
    return url
  }
}

function appendAtTokenToUrl(url: string, atToken?: string): string {
  if (!atToken) return url
  try {
    const parsed = new URL(url)
    parsed.searchParams.set("at", atToken)
    return parsed.toString()
  } catch {
    return url
  }
}

function buildDirectDownloadCandidates(
  assetUrl: string,
  opts?: { atToken?: string; authUser?: string | number | null }
): string[] {
  const normalized = normalizeAssetUrl(assetUrl)
  const withAuth = withAuthUserIfGoogle(normalized, opts?.authUser)
  const withAtOnAuth = appendAtTokenToUrl(withAuth, opts?.atToken)
  const withAtOnBase = appendAtTokenToUrl(normalized, opts?.atToken)
  return Array.from(new Set([normalized, withAuth, withAtOnAuth, withAtOnBase])).filter(Boolean)
}

async function tryChromeDirectDownload(urls: string[], filename: string): Promise<boolean> {
  if (!chrome?.downloads?.download || urls.length === 0) return false

  for (const targetUrl of urls) {
    const downloadId = await new Promise<number | null>((resolve) => {
      try {
        chrome.downloads.download(
          { url: targetUrl, filename, saveAs: false },
          (id) => {
            let runtimeErrorMessage = ""
            try {
              runtimeErrorMessage = String(chrome.runtime?.lastError?.message ?? "")
            } catch (runtimeReadError) {
              console.warn("[MindDock][StudioExportDecision] direct-download-runtime-read-failed", {
                url: targetUrl,
                error: getErrorMessage(runtimeReadError)
              })
              resolve(null)
              return
            }

            if (runtimeErrorMessage) {
              console.warn("[MindDock][StudioExportDecision] direct-download-attempt-failed", {
                url: targetUrl,
                error: runtimeErrorMessage
              })
              resolve(null)
              return
            }
            resolve(typeof id === "number" ? id : null)
          }
        )
      } catch (downloadError) {
        console.warn("[MindDock][StudioExportDecision] direct-download-attempt-threw", {
          url: targetUrl,
          error: getErrorMessage(downloadError)
        })
        resolve(null)
      }
    })

    if (downloadId !== null) return true
  }

  return false
}

async function fetchBinaryFile(
  url: string,
  opts?: { atToken?: string; authUser?: string | number | null; mode?: "buffer" | "download"; filename?: string }
): Promise<
  | { bytes: Uint8Array; mimeType?: string; size?: number }
  | { downloaded: true; downloadId: number; mimeType?: string; size?: number; filename?: string }
> {
  const baseUrl = normalizeAssetUrl(url)
  if (!looksLikeUrl(baseUrl)) throw new Error("URL invalida para asset.")

  try {
    const bgResult = await requestBackgroundBinaryAsset(baseUrl, {
      atToken: opts?.atToken,
      authUser: opts?.authUser,
      mode: opts?.mode,
      filename: opts?.filename
    })
    if (bgResult && "downloaded" in bgResult && bgResult.downloaded) {
      console.log("[MindDock][StudioBinaryFetch][CS] background-direct-download-success", {
        url: baseUrl,
        downloadId: bgResult.downloadId,
        size: bgResult.size,
        mimeType: bgResult.mimeType ?? null
      })
      return bgResult
    }
    if (bgResult) {
      console.log("[MindDock][StudioBinaryFetch][CS] using-background-result", {
        url: baseUrl,
        size: bgResult.bytes.byteLength,
        mimeType: bgResult.mimeType ?? null
      })
      return bgResult
    }
  } catch {
    // fallback para tentativas locais já existentes
  }

  console.warn("[MindDock][StudioBinaryFetch][CS] fallback-local-fetch", { url: baseUrl })

  const urlWithAuthUser = withAuthUserIfGoogle(baseUrl, opts?.authUser)
  const candidates = Array.from(new Set([baseUrl, urlWithAuthUser]))

  let lastStatus: number | null = null
  let lastErr: unknown = null

  for (const candidate of candidates) {
    if (opts?.atToken) {
      try {
        const r = await fetch(candidate, {
          credentials: "include",
          headers: { Authorization: `Bearer ${opts.atToken}` }
        })
        if (r.ok) {
          const ab = await r.arrayBuffer()
          return {
            bytes: new Uint8Array(ab),
            mimeType: r.headers.get("content-type") ?? undefined,
            size: ab.byteLength
          }
        }
        lastStatus = r.status
      } catch (e) {
        lastErr = e
      }
    }

    try {
      const r = await fetch(candidate, { credentials: "include" })
      if (r.ok) {
        const ab = await r.arrayBuffer()
        return {
          bytes: new Uint8Array(ab),
          mimeType: r.headers.get("content-type") ?? undefined,
          size: ab.byteLength
        }
      }
      lastStatus = r.status
    } catch (e) {
      lastErr = e
    }

    if (opts?.atToken) {
      try {
        const u = new URL(candidate)
        u.searchParams.set("at", opts.atToken)
        const r = await fetch(u.toString(), { credentials: "include" })
        if (r.ok) {
          const ab = await r.arrayBuffer()
          return {
            bytes: new Uint8Array(ab),
            mimeType: r.headers.get("content-type") ?? undefined,
            size: ab.byteLength
          }
        }
        lastStatus = r.status
      } catch (e) {
        lastErr = e
      }
    }

    try {
      const r = await fetch(candidate)
      if (r.ok) {
        const ab = await r.arrayBuffer()
        return {
          bytes: new Uint8Array(ab),
          mimeType: r.headers.get("content-type") ?? undefined,
          size: ab.byteLength
        }
      }
      lastStatus = r.status
    } catch (e) {
      lastErr = e
    }
  }

  if (lastStatus !== null) throw new Error(`All fetch attempts failed. Last status: ${lastStatus}`)
  if (lastErr instanceof Error) throw lastErr
  throw new Error("Falha ao baixar asset visual.")
}

function shouldExportAsBinaryAsset(entry: StudioEntry): { ok: boolean; assetUrl?: string; reason?: string } {
  const assetUrl = resolveEntryAssetUrl(entry)
  const type = String(entry.type ?? "").toLowerCase()
  const mime = String(entry.mimeType ?? "").toLowerCase()
  const kind = String(entry.kind ?? "").toLowerCase()
  const content = String(entry.content ?? "").trim().toLowerCase()

  const visualTypeByCodeOrLabel = isVisualTypeCode(entry.type) || isVisualTypeLabel(entry.type)
  const visualMime = /^(video|audio|image)\//i.test(mime) || mime === "application/pdf"
  const kindAsset = kind === "asset"
  const contentLooksUrl = /^https?:\/\//i.test(content) || content.startsWith("//")

  if (!assetUrl) {
    const noUrlLooksVisual = visualTypeByCodeOrLabel || visualMime || kindAsset
    return { ok: false, reason: noUrlLooksVisual ? "no-url-visual" : "no-url" }
  }

  const lowerUrl = assetUrl.toLowerCase()

  const urlLooksBinary =
    lowerUrl.includes("googleusercontent") ||
    /\.(png|jpg|jpeg|gif|webp|pdf|mp4|webm|mov|mp3|wav|ogg)(\?|#|$)/i.test(lowerUrl) ||
    lowerUrl.includes("=m22") ||
    lowerUrl.includes("alt=media")

  const visualType =
    type.includes("slides") ||
    type.includes("infographic") ||
    type.includes("mind map") ||
    type.includes("video overview") ||
    type.includes("audio overview") ||
    type.includes("video") ||
    type.includes("audio") ||
    type.includes("image")

  const ok = urlLooksBinary || visualType || visualTypeByCodeOrLabel || visualMime || kindAsset || contentLooksUrl
  const reason = ok
    ? [
        urlLooksBinary ? "url-binary" : "",
        visualType ? "type-visual" : "",
        visualTypeByCodeOrLabel ? "type-code-or-label" : "",
        visualMime ? "mime-visual" : "",
        kindAsset ? "kind-asset" : "",
        contentLooksUrl ? "content-url" : ""
      ]
        .filter(Boolean)
        .join(",")
    : "no-binary-signal"

  return { ok, assetUrl, reason }
}

function logStudioExportDecision(entry: StudioEntry, mode: "binary" | "text", extra?: string) {
  console.log("[MindDock][StudioExportDecision]", {
    id: entry.id,
    title: entry.title,
    type: entry.type,
    mimeType: entry.mimeType,
    kind: entry.kind,
    url: entry.url,
    contentPreview: typeof entry.content === "string" ? entry.content.slice(0, 120) : "",
    mode,
    extra
  })
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function mergeEntriesWithRefreshedArtifacts(
  baseEntries: StudioEntry[],
  rawItems: StudioCacheItem[]
): StudioEntry[] {
  const normalized = rawItems.map(normalizeStudioCacheEntry).filter(Boolean) as StudioEntry[]
  if (normalized.length === 0) return baseEntries

  const byId = new Map(normalized.map((entry) => [entry.id, entry]))
  const byTitle = new Map<string, StudioEntry[]>()
  for (const entry of normalized) {
    const key = normalizeTypeToken(entry.title)
    if (!key) continue
    const list = byTitle.get(key) ?? []
    list.push(entry)
    byTitle.set(key, list)
  }

  return baseEntries.map((entry) => {
    const direct = byId.get(entry.id)
    const titleKey = normalizeTypeToken(entry.title)
    const byTitleCandidate = titleKey
      ? (byTitle.get(titleKey) ?? []).find((candidate) => Boolean(resolveEntryAssetUrl(candidate))) ??
        (byTitle.get(titleKey) ?? [])[0]
      : undefined

    const incoming = direct ?? byTitleCandidate
    if (!incoming) return entry

    let mergedContent = entry.content ?? incoming.content
    if (!resolveEntryAssetUrl(entry) && typeof incoming.content === "string" && looksLikeUrl(incoming.content.trim())) {
      mergedContent = incoming.content
    }

    return {
      ...entry,
      type: resolvePreferredType(entry.type, incoming.type),
      kind: entry.kind ?? incoming.kind,
      content: mergedContent,
      url: entry.url ?? incoming.url,
      mimeType: entry.mimeType ?? incoming.mimeType,
      node: entry.node ?? incoming.node
    }
  })
}

function buildEntryDraft(entry: StudioEntry, index: number, format: StudioFormat, draftMap: Record<string, string>) {
  const hasDraft = Object.prototype.hasOwnProperty.call(draftMap, entry.id)
  if (hasDraft) {
    return draftMap[entry.id]
  }
  return buildStudioEntryBlock(entry, index, format)
}

async function buildStudioExportFiles(
  entries: StudioEntry[],
  format: StudioFormat,
  draftMap: Record<string, string>,
  diagnostics?: { traceId?: string }
): Promise<{ files: Array<{ filename: string; bytes: Uint8Array; isAsset?: boolean }>; directDownloads: number }> {
  const usedNames = new Set<string>()
  const encoder = new TextEncoder()
  const files: Array<{ filename: string; bytes: Uint8Array; isAsset?: boolean }> = []
  let directDownloads = 0
  const traceId = diagnostics?.traceId

  for (const [index, entry] of entries.entries()) {
    const binary = shouldExportAsBinaryAsset(entry)

    if (binary.ok && binary.assetUrl) {
      logStudioExportDecision(entry, "binary", binary.reason)
      const base = buildMindDuckFilenameBase("Studio", entry.title)
      let finalUrl = binary.assetUrl
      const fetchStartedAt = performance.now()
      const isSlidesLike = isSlidesLikeEntryType(entry.type)

      try {
        const authUser = resolveAuthUserFromUrl(window.location.href)
        if (finalUrl.includes("googleusercontent.com") || finalUrl.includes("google.com")) {
          const u = new URL(finalUrl)
          if (!u.searchParams.has("authuser") && authUser !== null && authUser !== undefined) {
            u.searchParams.set("authuser", String(authUser))
            finalUrl = u.toString()
          }
        }
      } catch {}

      try {
        const rpcContext = resolveRpcContextFromWindow()
        const atToken = typeof rpcContext?.at === "string" ? rpcContext.at : undefined
        const authUser = resolveAuthUserFromUrl(window.location.href)
        const filenameHint = `${sanitizeFilename(base)}.${resolveAssetExtension(entry, finalUrl, entry.mimeType)}`
        const notebookIdForSlides = isSlidesLike ? (resolveNotebookIdFromUrl() ?? undefined) : undefined
        const nativeSlidesUrl = isSlidesLike ? consumeNativeSlidesPdfUrl(notebookIdForSlides) : null

        if (traceId) {
            console.log(`[MindDock][StudioExportTrace][${traceId}] binary-fetch-start`, {
              id: entry.id,
              title: entry.title,
              type: entry.type ?? null,
              kind: entry.kind ?? null,
              mimeType: entry.mimeType ?? null,
              url: finalUrl,
              reason: binary.reason ?? null,
              hasToken: Boolean(atToken),
              mode: "buffer"
            })
          }

        if (isSlidesLike) {
          let effectiveNativeSlidesUrl = nativeSlidesUrl
          if (!effectiveNativeSlidesUrl) {
            if (traceId) {
              console.log(`[MindDock][StudioExportTrace][${traceId}] slides-native-auto-capture-start`, {
                id: entry.id,
                title: entry.title
              })
            }
            const triggered = await captureNativeSlidesPdfUrlForEntry(entry, 2200)
            if (triggered) {
              console.log("[MindDock][Slides] trigger disparado, aguardando URL nativa...", {
                id: entry.id,
                title: entry.title,
                notebookId: notebookIdForSlides ?? null
              })
              effectiveNativeSlidesUrl = await waitForNativeSlidesPdfUrl(notebookIdForSlides, SLIDES_NATIVE_WAIT_TIMEOUT_MS, 180)
            }
            if (traceId) {
              console.log(`[MindDock][StudioExportTrace][${traceId}] slides-native-auto-capture-finish`, {
                id: entry.id,
                title: entry.title,
                triggered,
                captured: Boolean(effectiveNativeSlidesUrl)
              })
            }
          }

          if (!effectiveNativeSlidesUrl) {
            throw new Error("URL nativa de download do Slides nao foi capturada a tempo.")
          }

          console.log("[MindDock][Slides] trying native download url", {
            id: entry.id,
            title: entry.title,
            nativeUrl: effectiveNativeSlidesUrl
          })
          const nativePdfResult = await fetchBinaryFile(effectiveNativeSlidesUrl, {
            atToken,
            authUser,
            mode: "buffer",
            filename: `${sanitizeFilename(base)}.pdf`
          })
          if ("downloaded" in nativePdfResult && nativePdfResult.downloaded) {
            throw new Error("Download direto retornado para Slides quando era esperado buffer PDF.")
          }
          if (!isPdfSignature(nativePdfResult.bytes)) {
            throw new Error("Conteudo nativo de Slides nao possui assinatura PDF valida.")
          }
          const nativeFilename = buildUniqueStudioFilename(base, "pdf", usedNames)
          files.push({ filename: nativeFilename, bytes: nativePdfResult.bytes, isAsset: true })
          console.log("[MindDock][Slides] saved native multi-page pdf", {
            id: entry.id,
            title: entry.title,
            size: nativePdfResult.bytes.byteLength
          })
          if (traceId) {
            console.log(`[MindDock][StudioExportTrace][${traceId}] slides-native-pdf-success`, {
              id: entry.id,
              title: entry.title,
              filename: nativeFilename,
              size: nativePdfResult.bytes.byteLength,
              nativeUrl: effectiveNativeSlidesUrl,
              elapsedMs: Math.round(performance.now() - fetchStartedAt)
            })
          }
          continue
        }

        const fetchResult = await fetchBinaryFile(finalUrl, {
          atToken,
          authUser,
          mode: "buffer",
          filename: filenameHint
        })

        if ("downloaded" in fetchResult && fetchResult.downloaded) {
          const urlFilename = buildUniqueStudioFilename(base, "url", usedNames)
          const shortcut = `[InternetShortcut]\nURL=${finalUrl}\n`
          files.push({ filename: urlFilename, bytes: encoder.encode(shortcut), isAsset: true })
          console.warn("[MindDock][StudioExportDecision] unexpected-direct-download-buffer-mode-fallback-url", {
            title: entry.title,
            downloadId: fetchResult.downloadId,
            fallbackFilename: urlFilename
          })
          if (traceId) {
            console.warn(`[MindDock][StudioExportTrace][${traceId}] binary-fetch-unexpected-direct-download-fallback-url`, {
              id: entry.id,
              title: entry.title,
              downloadId: fetchResult.downloadId,
              elapsedMs: Math.round(performance.now() - fetchStartedAt),
              fallbackFilename: urlFilename
            })
          }
          continue
        }

        const bytes = fetchResult.bytes
        const effectiveMimeType = fetchResult.mimeType
        const extension = resolveAssetExtension(entry, finalUrl, effectiveMimeType)
        const filename = buildUniqueStudioFilename(base, extension, usedNames)
        files.push({ filename, bytes, isAsset: true })
        if (traceId) {
          console.log(`[MindDock][StudioExportTrace][${traceId}] binary-fetch-buffer-success`, {
            id: entry.id,
            title: entry.title,
            filename,
            extension,
            elapsedMs: Math.round(performance.now() - fetchStartedAt),
            size: bytes.byteLength,
            mimeType: effectiveMimeType ?? null
          })
        }
      } catch (err) {
        if (isSlidesLike) {
          const message = getErrorMessage(err)
          console.error("[MindDock][StudioExportDecision] slides-pdf-required-no-fallback", {
            id: entry.id,
            title: entry.title,
            type: entry.type,
            url: finalUrl,
            error: message
          })
          throw new Error(`Slides deve ser exportado em PDF. ${message}`)
        }

        const urlFilename = buildUniqueStudioFilename(base, "url", usedNames)
        const shortcut = `[InternetShortcut]\nURL=${finalUrl}\n`
        files.push({ filename: urlFilename, bytes: encoder.encode(shortcut), isAsset: true })
        console.warn("[MindDock][StudioExportDecision] binary-fallback-url", entry.title, err)
        if (traceId) {
          console.warn(`[MindDock][StudioExportTrace][${traceId}] binary-fetch-fallback-url`, {
            id: entry.id,
            title: entry.title,
            type: entry.type ?? null,
            kind: entry.kind ?? null,
            mimeType: entry.mimeType ?? null,
            url: finalUrl,
            elapsedMs: Math.round(performance.now() - fetchStartedAt),
            error: getErrorMessage(err),
            fallbackFilename: urlFilename
          })
        }
      }
      continue
    }

    logStudioExportDecision(entry, "text", binary.reason)
    const body = buildEntryDraft(entry, index, format, draftMap)
    const base = buildMindDuckFilenameBase("Studio", entry.title)

    if (format === "markdown") {
      const filename = buildUniqueStudioFilename(base, "md", usedNames)
      files.push({ filename, bytes: encoder.encode(body) })
      continue
    }

    if (format === "text") {
      const filename = buildUniqueStudioFilename(base, "txt", usedNames)
      files.push({ filename, bytes: encoder.encode(body) })
      continue
    }

    if (format === "docx") {
      const filename = buildUniqueStudioFilename(base, "docx", usedNames)
      const bytes = await buildDocxBytesFromText(body)
      files.push({ filename, bytes })
      continue
    }

    const filename = buildUniqueStudioFilename(base, "pdf", usedNames)
    const pdfBytes = await buildPdfBytesViaBackground(body)
    files.push({ filename, bytes: pdfBytes })
  }

  return { files, directDownloads }
}

function StudioModal({ onClose }: { onClose: () => void }) {
  const stopProp = (e: React.MouseEvent) => e.stopPropagation()
  const modalTitle = resolveStudioLabelText() ?? "Studio"
  const [format, setFormat] = useState<StudioFormat>("markdown")
  const [entries, setEntries] = useState<StudioEntry[]>([])
  const [listEntries, setListEntries] = useState<StudioEntry[]>([])
  const [sourceSearch, setSourceSearch] = useState("")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showPreviewOverlay, setShowPreviewOverlay] = useState(false)
  const [draftMap, setDraftMap] = useState<Record<string, string>>({})
  const [generatedAtIso] = useState(() => new Date().toISOString())
  const [isExporting, setIsExporting] = useState(false)
  const [isHydrating, setIsHydrating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportToast, setExportToast] = useState<StudioExportToastState>({
    status: "idle",
    message: "",
    progress: 0
  })
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null)
  const selectionInitRef = useRef(false)
  const dirtyIdsRef = useRef<Set<string>>(new Set())
  const exportHandlerRef = useRef<((format?: StudioFormat) => void) | null>(null)
  const previewOpenedRef = useRef(false)
  const previewOpenTimerRef = useRef<number | null>(null)
  const scopedKeysRef = useRef<string[]>([])
  const lastStudioListAtRef = useRef(0)
  const previewRequestIdRef = useRef(0)
  const contentBootstrapRef = useRef(false)
  const probeBootstrapRef = useRef(false)
  const firstFrameLoggedRef = useRef(false)
  const fetchInFlightRef = useRef(false)
  const finalProbeRef = useRef(false)
  const deepTitleProbeInFlightRef = useRef(false)
  const userSelectionTouchedRef = useRef(false)
  const previewHydrationKeyRef = useRef("")

  const listIds = useMemo(() => {
    const unique = new Set<string>()
    listEntries.forEach((entry) => {
      if (entry.id) {
        unique.add(entry.id)
      }
    })
    return Array.from(unique)
  }, [listEntries])

  const hasIds = listIds.length > 0

  const mergedEntries = useMemo(() => {
    if (!hasIds) return []
    const byId = new Map(entries.map((entry) => [entry.id, entry]))

    // itens que vieram da lista DOM
    const merged = listEntries.map((entry) => {
      const cached = byId.get(entry.id)
      if (!cached) return entry
      const incomingKind = cached.kind ?? entry.kind
      const incomingType = resolvePreferredType(cached.type, entry.type)
      const incomingIsText =
        incomingKind === "text" ||
        (incomingType
          ? !(isVisualTypeLabel(incomingType) || isVisualTypeCode(incomingType))
          : false)
      return {
        ...entry,
        ...cached,
        title: entry.title,
        type: incomingType,
        kind: incomingIsText ? "text" : incomingKind,
        content: cached.content ?? entry.content,
        // nunca zera URL/MIME automaticamente; manter payload antigo evita perder asset visual
        url: cached.url ?? entry.url,
        mimeType: cached.mimeType ?? entry.mimeType,
      }
    })

    // cache-only permitido: itens textuais fora da lista DOM (ex.: resultados ainda nao renderizados)
    const listIdSet = new Set(listEntries.map((e) => e.id))
    const listTitleSet = new Set(
      listEntries
        .map((entry) => normalizeTypeToken(entry.title))
        .filter(Boolean)
    )
    const cacheOnlyText = entries.filter((entry) => {
      if (!entry.id || listIdSet.has(entry.id)) return false
      const title = String(entry.title ?? "").trim()
      if (!looksLikeSidebarEntryTitle(title)) return false
      if (listTitleSet.has(normalizeTypeToken(title))) return false
      const probe: StudioEntry = { ...entry, title }
      if (isVisualAssetEntry(probe)) return false
      if (isExcludedStudioEntry(probe)) return false
      if (isLikelyChatEntry(probe)) return false
      return !isTemplateLikeTitle(title)
    })
    const mergedIdSet = new Set(merged.map((entry) => String(entry.id ?? "").trim()).filter(Boolean))
    const cacheOnlyVisual = entries.filter((entry) => {
      const id = String(entry.id ?? "").trim()
      if (!id || listIdSet.has(id) || mergedIdSet.has(id)) return false
      const title = String(entry.title ?? "").trim()
      if (!looksLikeSidebarEntryTitle(title)) return false

      const probe: StudioEntry = { ...entry, title }
      if (isExcludedStudioEntry(probe)) return false
      if (!isVisualAssetEntry(probe)) return false
      if (isLikelyChatEntry(probe)) return false
      if (isTemplateLikeTitle(title)) return false
      return true
    })

    return [...merged, ...cacheOnlyText, ...cacheOnlyVisual]
  }, [entries, listEntries, hasIds])

  const displayEntries = !hasIds ? [] : mergedEntries
  const visualEntries = useMemo(() => {
    const documentIdSet = new Set(
      displayEntries
        .filter((entry) => !isVisualAssetEntry(entry) && !isExcludedStudioEntry(entry))
        .map((entry) => String(entry.id ?? "").trim())
        .filter(Boolean)
    )

    const seen = new Set<string>()
    return displayEntries
      .filter((entry) => isVisualAssetEntry(entry))
      .filter((entry) => !isExcludedStudioEntry(entry))
      .filter((entry) => {
        const id = String(entry.id ?? "").trim()
        if (!id) return true
        return !documentIdSet.has(id)
      })
      .filter((entry) => {
        const id = String(entry.id ?? "").trim()
        const key = id || normalizeTypeToken(entry.title)
        if (!key) return true
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }, [displayEntries])
  const documentEntries = useMemo(
    () =>
      displayEntries.filter(
        (entry) =>
          !isVisualAssetEntry(entry) &&
          !isExcludedStudioEntry(entry)
      ),
    [displayEntries]
  )
  const excludedEntries = useMemo(
    () =>
      displayEntries.filter(
        (entry) => isExcludedStudioEntry(entry) && !isVisualAssetEntry(entry)
      ),
    [displayEntries]
  )
  const previewEntries = documentEntries

  useEffect(() => {
    try {
      window.postMessage(
        {
          source: "minddock",
          type: "STUDIO_ARM"
        },
        "*"
      )
    } catch {
      // Silent by design: never break the page.
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        if (showPreviewOverlay) {
          window.dispatchEvent(new CustomEvent(EXPORT_PREVIEW_CLOSE_EVENT))
          setShowPreviewOverlay(false)
          return
        }
        onClose()
      }
    }
    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
  }, [showPreviewOverlay, onClose])

  useEffect(() => {
    const handlePreviewClose = () => setShowPreviewOverlay(false)
    window.addEventListener(EXPORT_PREVIEW_CLOSE_EVENT, handlePreviewClose)
    return () => window.removeEventListener(EXPORT_PREVIEW_CLOSE_EVENT, handlePreviewClose)
  }, [])

  useEffect(() => {
    if (exportToast.status !== "running") {
      return
    }
    const timer = window.setInterval(() => {
      setExportToast((current) => {
        if (current.status !== "running") return current
        const nextProgress = Math.min(92, current.progress + (current.progress < 60 ? 8 : 4))
        return { ...current, progress: nextProgress }
      })
    }, 240)
    return () => window.clearInterval(timer)
  }, [exportToast.status])

  useEffect(() => {
    if (exportToast.status === "idle" || exportToast.status === "running") {
      return
    }
    const timer = window.setTimeout(() => {
      setExportToast({ status: "idle", message: "", progress: 0 })
    }, exportToast.status === "error" ? 5200 : 3000)
    return () => window.clearTimeout(timer)
  }, [exportToast.status])

  useEffect(() => {
    let active = true

    const seedFromDom = (): boolean => {
      const domSeed = readStudioTitlesFromDom()
        .filter((entry) => UUID_RE.test(String(entry.id)) && String(entry.title ?? "").trim().length >= 3)
        .map((entry) => ({
          id: String(entry.id),
          title: String(entry.title).trim(),
          meta: entry.meta || "Resultado do EstÃºdio",
          type: entry.type,
          content: "",
          url: undefined,
          mimeType: undefined,
          node: entry.node,
          kind: "text" as const
        }))

      if (domSeed.length === 0) return false
      setListEntries((prev) => {
        const prevById = new Map(prev.map((entry) => [entry.id, entry]))
        const nextById = new Map(prevById)
        for (const entry of domSeed) {
          const old = nextById.get(entry.id)
          nextById.set(entry.id, old ? { ...old, ...entry, node: entry.node || old.node } : entry)
        }
        const domOrder = new Map(domSeed.map((entry, idx) => [entry.id, idx]))
        return Array.from(nextById.values())
          .filter((entry) => String(entry.id ?? "").trim().length > 0 && String(entry.title ?? "").trim().length >= 3)
          .sort((a, b) => {
            const ai = domOrder.has(a.id) ? domOrder.get(a.id)! : Number.MAX_SAFE_INTEGER
            const bi = domOrder.has(b.id) ? domOrder.get(b.id)! : Number.MAX_SAFE_INTEGER
            if (ai !== bi) return ai - bi
            return String(a.title ?? "").localeCompare(String(b.title ?? ""), "pt-BR", { sensitivity: "base" })
          })
      })
      setEntries((prev) => {
        const prevById = new Map(prev.map((entry) => [entry.id, entry]))
        const nextById = new Map(prevById)
        for (const entry of domSeed) {
          const old = prevById.get(entry.id)
          if (!old) {
            nextById.set(entry.id, entry)
            continue
          }
          nextById.set(entry.id, {
            ...old,
            ...entry,
            title: entry.title,
            type: resolvePreferredType(old.type, entry.type),
            kind: old.kind || entry.kind,
            content: old.content || entry.content,
            url: old.url || entry.url,
            mimeType: old.mimeType || entry.mimeType,
            node: old.node || entry.node
          })
        }
        const domOrder = new Map(domSeed.map((entry, idx) => [entry.id, idx]))
        return Array.from(nextById.values())
          .filter((entry) => String(entry.id ?? "").trim().length > 0 && String(entry.title ?? "").trim().length >= 3)
          .sort((a, b) => {
            const ai = domOrder.has(a.id) ? domOrder.get(a.id)! : Number.MAX_SAFE_INTEGER
            const bi = domOrder.has(b.id) ? domOrder.get(b.id)! : Number.MAX_SAFE_INTEGER
            if (ai !== bi) return ai - bi
            return String(a.title ?? "").localeCompare(String(b.title ?? ""), "pt-BR", { sensitivity: "base" })
          })
      })
      setIsLoading(false)
      return true
    }

    seedFromDom()

    const tryLoad = async (attempt: number) => {
      const result = await loadStudioEntriesFromStorage()
      if (!active) return
      if (result) {
        scopedKeysRef.current = result.scopedKeys
      }
      if (result && result.entries.length > 0) {
        setEntries((prev) => {
          const prevById = new Map(prev.map((entry) => [entry.id, entry]))
          const nextById = new Map(prevById)
          for (const entry of result.entries) {
            const old = nextById.get(entry.id)
            if (!old) {
              nextById.set(entry.id, entry)
              continue
            }
            const incomingKind = entry.kind ?? old.kind
            const incomingType = resolvePreferredType(old.type, entry.type)
            nextById.set(entry.id, {
              ...old,
              ...entry,
              title: old.title || entry.title,
              type: incomingType,
              kind: incomingKind,
              content: entry.content ?? old.content,
              url: entry.url ?? old.url,
              mimeType: entry.mimeType ?? old.mimeType,
              node: old.node || entry.node
            })
          }
          const incomingOrder = new Map(result.entries.map((entry, idx) => [entry.id, idx]))
          return Array.from(nextById.values())
            .filter((entry) => String(entry.id ?? "").trim().length > 0 && String(entry.title ?? "").trim().length >= 3)
            .sort((a, b) => {
              const ai = incomingOrder.has(a.id) ? incomingOrder.get(a.id)! : Number.MAX_SAFE_INTEGER
              const bi = incomingOrder.has(b.id) ? incomingOrder.get(b.id)! : Number.MAX_SAFE_INTEGER
              if (ai !== bi) return ai - bi
              return String(a.title ?? "").localeCompare(String(b.title ?? ""), "pt-BR", { sensitivity: "base" })
            })
        })
        setIsLoading(false)
        return
      }
      // tenta novamente atÃ© 3x com intervalo curto para nÃ£o atrasar a UI
      if (attempt < 3) {
        setTimeout(() => tryLoad(attempt + 1), 250 * attempt)
      } else if (!seedFromDom()) {
        setIsLoading(false)
      }
    }

    tryLoad(1)

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => {
      if (area !== "local") {
        return
      }
      const scopedKeys = scopedKeysRef.current
      if (!scopedKeys.length) {
        return
      }
      const listTitleById = new Map(
        listEntries.map((entry) => [String(entry.id ?? ""), String(entry.title ?? "").trim()] as const)
      )

      for (const key of scopedKeys) {
        if (!changes[key]) {
          continue
        }
        const nextValue = changes[key].newValue
        if (!Array.isArray(nextValue)) {
          continue
        }
        const normalized = (nextValue as StudioCacheItem[])
          .map(normalizeStudioCacheEntry)
          .filter(Boolean) as StudioEntry[]
        const nextEntries = applyStudioFilter(normalized)
        const hasFreshStudioList = Date.now() - lastStudioListAtRef.current < 30000
        if (hasFreshStudioList && nextEntries.length === 0) {
          return
        }
        setEntries((prev) => {
          if (nextEntries.length === 0) return prev
          const prevById = new Map(prev.map((e) => [e.id, e]))
          const nextById = new Map(prevById)
          for (const e of nextEntries) {
            const old = nextById.get(e.id)
            if (!old) {
              nextById.set(e.id, e)
              continue
            }
            const incomingKind = e.kind ?? old.kind
            const incomingType = resolvePreferredType(old.type, e.type)
            nextById.set(e.id, {
              ...old,
              ...e,
              // mantÃ©m o tÃ­tulo jÃ¡ exibido na lista do NotebookLM quando disponÃ­vel
              title: listTitleById.get(e.id) || old.title || e.title,
              content: e.content ?? old.content,
              url: e.url ?? old.url,
              mimeType: e.mimeType ?? old.mimeType,
              type: incomingType,
              kind: incomingKind,
              node: old.node || e.node
            })
          }
          const incomingOrder = new Map(nextEntries.map((entry, idx) => [entry.id, idx]))
          return Array.from(nextById.values())
            .filter((entry) => String(entry.id ?? "").trim().length > 0 && String(entry.title ?? "").trim().length >= 3)
            .sort((a, b) => {
              const ai = incomingOrder.has(a.id) ? incomingOrder.get(a.id)! : Number.MAX_SAFE_INTEGER
              const bi = incomingOrder.has(b.id) ? incomingOrder.get(b.id)! : Number.MAX_SAFE_INTEGER
              if (ai !== bi) return ai - bi
              return String(a.title ?? "").localeCompare(String(b.title ?? ""), "pt-BR", { sensitivity: "base" })
            })
        })
        void buildStudioDebugText(nextValue as StudioCacheItem[], normalized, nextEntries, key)
        break
      }
    }

    const storageOnChanged = getStorageOnChangedSafe()
    if (storageOnChanged) {
      try {
        storageOnChanged.addListener(handleStorageChange)
      } catch (error) {
        if (!isExtensionContextInvalidatedError(error)) {
          console.warn("[MindDock][Studio] failed to register storage listener", error)
        }
      }
    }

    return () => {
      if (storageOnChanged) {
        try {
          storageOnChanged.removeListener(handleStorageChange)
        } catch {
          // no-op: listener teardown can race during extension reload
        }
      }
    }
  }, [showPreviewOverlay, listEntries])

  useEffect(() => {
    const notebookId = resolveNotebookIdFromUrl()
    setIsLoading(true)
    window.postMessage(
      { source: "minddock", type: "MINDDOCK_FETCH_STUDIO_LIST", payload: { notebookId } },
      "*"
    )
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return
      const data = (event as MessageEvent).data as {
        source?: string
        type?: string
        payload?: { items?: Array<{ id: string; title: string; type?: number }> }
      } | null
      if (!data || data.source !== "minddock") return
      if (data.type !== "MINDDOCK_STUDIO_LIST_UPDATED" && data.type !== "MINDDOCK_STUDIO_LIST_EMPTY") {
        return
      }

      if (data.type === "MINDDOCK_STUDIO_LIST_EMPTY") {
        setIsRefreshing(false)
        contentBootstrapRef.current = false
        probeBootstrapRef.current = false
        const hasCurrentData = listEntries.length > 0 || entries.length > 0
        if (!hasCurrentData) {
          setListEntries([])
          setEntries([])
          setIsLoading(true)
        } else {
          setIsLoading(false)
        }
        bgLog({ tag: "studio-list-empty", keptCurrentData: hasCurrentData })
        return
      }

      const items = data.payload?.items
      if (!Array.isArray(items) || items.length === 0) {
        setIsRefreshing(false)
        contentBootstrapRef.current = false
        probeBootstrapRef.current = false
        const hasCurrentData = listEntries.length > 0 || entries.length > 0
        if (!hasCurrentData) {
          setListEntries([])
          setEntries([])
          setIsLoading(true)
        } else {
          setIsLoading(false)
        }
        bgLog({ tag: "studio-list-empty", reason: "no-items", keptCurrentData: hasCurrentData })
        return
      }

      const payloadIds = (items as Array<{ id?: unknown }>)
        .map((item) => String(item?.id ?? ""))
        .filter((id) => UUID_RE.test(id))
      const domTypeHintsById = readStudioTypeHintsByIdFromDom(payloadIds)
      const domStudioEntriesRaw = readStudioTitlesFromDom()
      const domStudioEntries = (domStudioEntriesRaw.length > 0 ? domStudioEntriesRaw : resolveStudioListEntries()).filter(
        (entry) => String(entry.title ?? "").trim().length >= 3
      )
      const domTitleById = new Map(
        domStudioEntries
          .filter((entry) => UUID_RE.test(String(entry.id)))
          .map((entry) => [String(entry.id), String(entry.title).trim()])
      )
      const domTypeById = new Map(
        domStudioEntries
          .filter((entry) => UUID_RE.test(String(entry.id)))
          .map((entry) => [String(entry.id), String(entry.type ?? "").trim()] as const)
          .filter(([, type]) => type.length > 0)
      )
      const domTypeByTitle = new Map<string, string>()
      for (const entry of domStudioEntries) {
        const typeValue = String(entry.type ?? "").trim()
        if (!typeValue || !isKnownStudioTypeValue(typeValue)) continue
        const titleKey = normalizeTypeToken(String(entry.title ?? ""))
        if (!titleKey) continue
        const current = domTypeByTitle.get(titleKey)
        if (!current) {
          domTypeByTitle.set(titleKey, typeValue)
          continue
        }
        const currentIsBlogPost = normalizeTypeToken(current) === "blog post"
        const nextIsBlogPost = normalizeTypeToken(typeValue) === "blog post"
        if (currentIsBlogPost && !nextIsBlogPost) {
          domTypeByTitle.set(titleKey, typeValue)
        }
      }
      const domNodeById = new Map(
        domStudioEntries
          .filter((entry) => UUID_RE.test(String(entry.id)))
          .map((entry) => [String(entry.id), entry.node] as const)
      )
      const existingListTitleById = new Map(
        listEntries
          .map((entry) => [String(entry.id ?? ""), String(entry.title ?? "").trim()] as const)
          .filter(([id, title]) => UUID_RE.test(id) && looksLikeSidebarEntryTitle(title))
      )
      const existingListNodeById = new Map(
        listEntries
          .map((entry) => [String(entry.id ?? ""), entry.node] as const)
          .filter(([id]) => UUID_RE.test(id))
      )

      const mappedRaw = (items as Array<{
        id: string
        title: string
        type?: number | string
        typeLabel?: string
      }>)
        .filter((item) => String(item.title ?? "").trim().length >= 3)
        .map((item) => {
          const resolvedId = String(item.id)
          const rpcTitle = String(item.title ?? "").trim()
          const titleFromDomById = domTitleById.get(resolvedId)
          const titleFromExistingList = existingListTitleById.get(resolvedId)
          const typeKey = item.type !== undefined ? String(item.type) : undefined
          const typeLabel = item.typeLabel ?? (typeKey ? STUDIO_TYPE_LABELS[typeKey] : undefined)
          const isVisualItem =
            isVisualTypeLabel(typeLabel) ||
            isVisualTypeCode(typeKey) ||
            isVisualTypeLabel(typeKey)
          const resolvedTitle = isVisualItem
            ? (titleFromDomById ??
                titleFromExistingList ??
                rpcTitle)
            : rpcTitle
          const inferredType = inferTypeFromSignals(resolvedTitle)
          const domTypeCandidate =
            domTypeById.get(resolvedId) ??
            domTypeHintsById.get(String(resolvedId).toLowerCase()) ??
            domTypeByTitle.get(normalizeTypeToken(titleFromDomById)) ??
            domTypeByTitle.get(normalizeTypeToken(titleFromExistingList)) ??
            domTypeByTitle.get(normalizeTypeToken(resolvedTitle)) ??
            domTypeByTitle.get(normalizeTypeToken(rpcTitle))
          const rpcTypeToken = normalizeTypeToken(typeLabel ?? typeKey)
          const rpcHasExplicitType = Boolean(String(typeKey ?? "").trim() || String(typeLabel ?? "").trim())
          const rpcIsBlogPostLike = String(typeKey ?? "").trim() === "9" || rpcTypeToken === "blog post"
          const domTypeToken = normalizeTypeToken(domTypeCandidate)
          const safeDomType =
            domTypeCandidate && isKnownStudioTypeValue(domTypeCandidate)
              ? !rpcHasExplicitType
                ? domTypeCandidate
                : rpcIsBlogPostLike && (domTypeToken === "data table" || domTypeToken === "tabela de dados")
                  ? domTypeCandidate
                  : undefined
              : undefined
          const resolvedTypeBase = isVisualItem
            ? (typeKey ?? typeLabel ?? inferredType)
            : (typeLabel ?? typeKey ?? inferredType)
          const resolvedType = safeDomType ?? resolvedTypeBase

          return {
            id: resolvedId,
            title: resolvedTitle,
            meta: typeLabel ? `Resultado do EstÃƒÂºdio Ã‚Â· ${typeLabel}` : "Resultado do EstÃƒÂºdio",
            type: resolvedType,
            content: "",
            url: undefined,
            mimeType: undefined,
            node: domNodeById.get(resolvedId) ?? existingListNodeById.get(resolvedId),
            kind: "text" as const
          }
        })
      const seenMappedIds = new Set<string>()
      const mapped = mappedRaw.filter((entry) => {
        if (!entry.id || seenMappedIds.has(entry.id)) return false
        seenMappedIds.add(entry.id)
        return true
      })
      if (mapped.length > 0) {
        lastStudioListAtRef.current = Date.now()
        contentBootstrapRef.current = false
        probeBootstrapRef.current = false
        const probeIds = mapped.map((entry) => entry.id)
        setListEntries((prev) => {
          const prevById = new Map(prev.map((entry) => [entry.id, entry]))
          const nextById = new Map(prevById)
          for (const entry of mapped) {
            const old = nextById.get(entry.id)
            nextById.set(entry.id, old ? { ...old, ...entry, node: entry.node || old.node } : entry)
          }
          const mappedOrder = new Map(mapped.map((entry, idx) => [entry.id, idx]))
          return Array.from(nextById.values())
            .filter((entry) => String(entry.id ?? "").trim().length > 0 && String(entry.title ?? "").trim().length >= 3)
            .sort((a, b) => {
              const ai = mappedOrder.has(a.id) ? mappedOrder.get(a.id)! : Number.MAX_SAFE_INTEGER
              const bi = mappedOrder.has(b.id) ? mappedOrder.get(b.id)! : Number.MAX_SAFE_INTEGER
              if (ai !== bi) return ai - bi
              return String(a.title ?? "").localeCompare(String(b.title ?? ""), "pt-BR", { sensitivity: "base" })
            })
        })
        setEntries((prev) => {
          const prevById = new Map(prev.map((e) => [e.id, e]))
          const nextById = new Map(prevById)
          for (const entry of mapped) {
            const existing = nextById.get(entry.id)
            if (!existing) {
              nextById.set(entry.id, entry)
              continue
            }
            const incomingType = resolvePreferredType(existing.type, entry.type)
            const incomingKind = entry.kind ?? existing.kind
            const incomingIsText =
              incomingKind === "text" ||
              (incomingType
                ? !(isVisualTypeLabel(incomingType) || isVisualTypeCode(incomingType))
                : true)
            nextById.set(entry.id, {
              ...existing,
              ...entry,
              title: entry.title,
              type: incomingType,
              kind: incomingIsText ? "text" : (existing.kind || incomingKind),
              content: existing.content || entry.content,
              url: existing.url || entry.url,
              mimeType: existing.mimeType || entry.mimeType,
              node: existing.node || entry.node,
            })
          }
          const mappedOrder = new Map(mapped.map((entry, idx) => [entry.id, idx]))
          const next = Array.from(nextById.values())
            .filter((entry) => String(entry.id ?? "").trim().length > 0 && String(entry.title ?? "").trim().length >= 3)
            .sort((a, b) => {
              const ai = mappedOrder.has(a.id) ? mappedOrder.get(a.id)! : Number.MAX_SAFE_INTEGER
              const bi = mappedOrder.has(b.id) ? mappedOrder.get(b.id)! : Number.MAX_SAFE_INTEGER
              if (ai !== bi) return ai - bi
              return String(a.title ?? "").localeCompare(String(b.title ?? ""), "pt-BR", { sensitivity: "base" })
            })
          const hasPayload = next.some((entry) => entry.content || entry.url)
          setIsLoading(!hasPayload)
          return next
        })
        if (probeIds.length > 0 && !deepTitleProbeInFlightRef.current) {
          deepTitleProbeInFlightRef.current = true
          void sleep(120)
            .then(() => readStudioTitlesByIdFromDomDeep(probeIds))
            .then((titleById) => {
              if (titleById.size === 0) return
              setListEntries((prev) =>
                prev.map((entry) => {
                  const nextTitle = titleById.get(entry.id)
                  if (!nextTitle || !shouldApplyDeepProbeTitle(entry, nextTitle)) return entry
                  return { ...entry, title: nextTitle }
                })
              )
              setEntries((prev) =>
                prev.map((entry) => {
                  const nextTitle = titleById.get(entry.id)
                  if (!nextTitle || !shouldApplyDeepProbeTitle(entry, nextTitle)) return entry
                  return { ...entry, title: nextTitle }
                })
              )
            })
            .finally(() => {
              deepTitleProbeInFlightRef.current = false
            })
        }
        bgLog({
          tag: "studio-list-updated",
          count: mapped.length,
          firstId: mapped[0]?.id,
          firstTitle: mapped[0]?.title
        })
      }
      setIsRefreshing(false)
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [entries, listEntries])

  const applyStudioItems = useCallback((rawItems: StudioCacheItem[], ids?: string[]) => {
    const normalized = rawItems
      .map(normalizeStudioCacheEntry)
      .filter(Boolean) as StudioEntry[]
    const nextEntries = applyStudioFilter(normalized, ids)
    if (nextEntries.length === 0) {
      return
    }
    lastStudioListAtRef.current = Date.now()
    const listTitleById = new Map(
      listEntries.map((entry) => [String(entry.id ?? ""), String(entry.title ?? "").trim()] as const)
    )
    setEntries((prev) => {
      const prevById = new Map(prev.map((entry) => [entry.id, entry]))
      const nextById = new Map(prevById)
      for (const entry of nextEntries) {
        const old = nextById.get(entry.id)
        if (!old) {
          nextById.set(entry.id, entry)
          continue
        }
        const incomingKind = entry.kind ?? old.kind
        const incomingType = resolvePreferredType(old.type, entry.type)
        nextById.set(entry.id, {
          ...old,
          ...entry,
          // mantÃ©m o tÃ­tulo vindo da lista/DOM sempre que jÃ¡ existir
          title: listTitleById.get(entry.id) || old.title || entry.title,
          content: entry.content ?? old.content,
          url: entry.url ?? old.url,
          mimeType: entry.mimeType ?? old.mimeType,
          type: incomingType,
          kind: incomingKind,
          node: old.node || entry.node
        })
      }
      const incomingOrder = new Map(nextEntries.map((entry, idx) => [entry.id, idx]))
      return Array.from(nextById.values())
        .filter((entry) => String(entry.id ?? "").trim().length > 0 && String(entry.title ?? "").trim().length >= 3)
        .sort((a, b) => {
          const ai = incomingOrder.has(a.id) ? incomingOrder.get(a.id)! : Number.MAX_SAFE_INTEGER
          const bi = incomingOrder.has(b.id) ? incomingOrder.get(b.id)! : Number.MAX_SAFE_INTEGER
          if (ai !== bi) return ai - bi
          return String(a.title ?? "").localeCompare(String(b.title ?? ""), "pt-BR", { sensitivity: "base" })
        })
    })
  }, [listEntries])

  useEffect(() => {
    if (!hasIds) {
      contentBootstrapRef.current = false
      setEntries([])
      setIsLoading(true)
    }
  }, [hasIds])

  useEffect(() => {
    if (contentBootstrapRef.current) {
      bgLog({ tag: "studio-bootstrap-skip", reason: "already-bootstrapped" })
      return
    }
    if (!hasIds) {
      bgLog({ tag: "studio-bootstrap-skip", reason: "no-ids" })
      return
    }
    if (mergedEntries.length === 0) {
      bgLog({ tag: "studio-bootstrap-skip", reason: "no-merged-entries" })
      return
    }
    const hasPayload = mergedEntries.some((entry) => entry.content || entry.url)
    if (hasPayload) {
      if (!probeBootstrapRef.current) {
        probeBootstrapRef.current = true
        fetchInFlightRef.current = true
        setIsLoading(true)
        const expectedCount = listIds.length
        const currentCount = mergedEntries.filter((entry) => entry.content || entry.url).length
        bgLog({ tag: "studio-final-probe", expectedCount, currentCount })
        requestStudioArtifacts(listIds, { forceRefresh: true, expectedCount, currentCount })
          .then((items) => {
            if (items.length > 0) {
              applyStudioItems(items, listIds)
            }
          })
          .catch(() => {
            // ignore probe failures
          })
          .finally(() => {
            fetchInFlightRef.current = false
            setIsLoading(false)
          })
        return
      }
      bgLog({ tag: "studio-bootstrap-skip", reason: "already-has-payload" })
      return
    }
    contentBootstrapRef.current = true
    fetchInFlightRef.current = true
    setIsLoading(true)
    const expectedCount = listIds.length
    const currentCount = mergedEntries.filter((entry) => entry.content || entry.url).length
    bgLog({ tag: "studio-bootstrap-fetch", expectedCount, currentCount })
    requestStudioArtifacts(listIds, { expectedCount, currentCount })
      .then((items) => {
        if (items.length > 0) {
          applyStudioItems(items, listIds)
        }
      })
      .catch(() => {
        // ignore bootstrap failures
      })
      .finally(() => {
        fetchInFlightRef.current = false
        setIsLoading(false)
      })
  }, [applyStudioItems, hasIds, listIds])

  useEffect(() => {
    if (!hasIds) {
      return
    }
    const hasPayload = mergedEntries.some((entry) => entry.content || entry.url)
    if (hasPayload && !fetchInFlightRef.current && !isRefreshing) {
      setIsLoading(false)
    }
  }, [hasIds, mergedEntries, isRefreshing])

  useEffect(() => {
    if (firstFrameLoggedRef.current) return
    firstFrameLoggedRef.current = true
    requestAnimationFrame(() => {})
  }, [displayEntries])

  useEffect(() => {
    const allowed = new Set<string>()
    documentEntries.forEach((entry) => {
      if (entry.id) {
        allowed.add(entry.id)
      }
    })
    visualEntries.forEach((entry) => {
      if (entry.id) {
        allowed.add(entry.id)
      }
    })

    if (!selectionInitRef.current || !userSelectionTouchedRef.current) {
      if (allowed.size === 0) {
        return
      }
      setSelectedIds((prev) => {
        if (prev.size === allowed.size) {
          let equal = true
          for (const id of allowed) {
            if (!prev.has(id)) {
              equal = false
              break
            }
          }
          if (equal) return prev
        }
        return new Set(allowed)
      })
      selectionInitRef.current = true
      return
    }
    setSelectedIds((prev) => {
      let changed = false
      const next = new Set<string>()
      prev.forEach((id) => {
        if (allowed.has(id)) {
          next.add(id)
        } else {
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [documentEntries, visualEntries])

  const normalizedSearch = sourceSearch.trim().toLowerCase()
  const filterBySearch = useCallback(
    (entries: StudioEntry[]) => {
      if (!normalizedSearch) {
        return entries
      }
      return entries.filter((entry) => {
        const haystack = `${entry.title} ${entry.meta ?? ""}`.toLowerCase()
        return haystack.includes(normalizedSearch)
      })
    },
    [normalizedSearch]
  )
  const filteredDocumentEntries = useMemo(
    () => filterBySearch(documentEntries),
    [documentEntries, filterBySearch]
  )
  const filteredVisualEntries = useMemo(
    () => filterBySearch(visualEntries),
    [visualEntries, filterBySearch]
  )
  const filteredExcludedEntries = useMemo(
    () => filterBySearch(excludedEntries),
    [excludedEntries, filterBySearch]
  )
  const selectableEntries = useMemo(
    () =>
      filteredDocumentEntries.filter(
        (entry) => !isExcludedStudioEntry(entry)
      ),
    [filteredDocumentEntries]
  )
  const selectableAllEntries = useMemo(() => {
    const seen = new Set<string>()
    const merged: StudioEntry[] = []
    const push = (entry: StudioEntry) => {
      if (!entry.id) return
      if (seen.has(entry.id)) return
      seen.add(entry.id)
      merged.push(entry)
    }
    selectableEntries.forEach(push)
    filteredVisualEntries.forEach(push)
    return merged
  }, [selectableEntries, filteredVisualEntries])

  const selectedEntries = useMemo(
    () => displayEntries.filter((entry) => selectedIds.has(entry.id)),
    [displayEntries, selectedIds]
  )
  const previewSelectedEntries = useMemo(
    () => previewEntries.filter((entry) => selectedIds.has(entry.id)),
    [previewEntries, selectedIds]
  )
  const previewSelectionKey = useMemo(
    () => previewSelectedEntries.map((entry) => entry.id).sort().join("|"),
    [previewSelectedEntries]
  )

  const handlePreviewFormatChange = useCallback((nextFormat: StudioFormat) => {
    setFormat(nextFormat)
    dirtyIdsRef.current = new Set()
    if (showPreviewOverlay) {
      setDraftMap({})
    }
  }, [showPreviewOverlay])

  const handlePreviewContentChange = useCallback((entryId: string, nextContent: string) => {
    dirtyIdsRef.current.add(entryId)
    setDraftMap((prev) => ({ ...prev, [entryId]: nextContent }))
  }, [])

  const previewItems = useMemo(() => (
    previewSelectedEntries.map((entry, index) => {
      const hasDraft = Object.prototype.hasOwnProperty.call(draftMap, entry.id)
      const fallback = buildStudioEntryBlock(entry, index, format, { isLoading })
      const content = hasDraft ? (draftMap[entry.id] ?? "") : fallback
      return {
        id: entry.id,
        title: entry.title,
        subtitle: entry.meta ?? "Resultado do Estudio",
        content
      }
    })
  ), [previewSelectedEntries, draftMap, format, isLoading])

  const exportedAtLabel = useMemo(
    () => formatExportTimestamp(generatedAtIso),
    [generatedAtIso]
  )

  const filteredSelectedCount = selectableAllEntries.reduce(
    (count, entry) => count + (selectedIds.has(entry.id) ? 1 : 0),
    0
  )
  const hasFilteredEntries = selectableAllEntries.length > 0
  const allFilteredSelected =
    hasFilteredEntries && filteredSelectedCount === selectableAllEntries.length
  const hasPartialFilteredSelection = filteredSelectedCount > 0 && !allFilteredSelected
  const hasSelection = selectedEntries.length > 0
  const hasPreviewSelection = previewSelectedEntries.length > 0
  const hasAnyEntries = selectableAllEntries.length > 0

  useEffect(() => {
    const checkbox = selectAllCheckboxRef.current
    if (!checkbox) {
      return
    }
    checkbox.indeterminate = hasPartialFilteredSelection
  }, [hasPartialFilteredSelection])

  useEffect(() => {
    if (!showPreviewOverlay) {
      dirtyIdsRef.current = new Set()
      setDraftMap({})
      setIsHydrating(false)
      previewHydrationKeyRef.current = ""
    }
  }, [showPreviewOverlay])

  useEffect(() => {
    if (!showPreviewOverlay) {
      return
    }
    if (previewSelectedEntries.length === 0) {
      return
    }
    if (!previewSelectionKey) {
      return
    }

    if (previewHydrationKeyRef.current === previewSelectionKey) {
      return
    }
    previewHydrationKeyRef.current = previewSelectionKey

    let active = true
    const requestId = previewRequestIdRef.current + 1
    previewRequestIdRef.current = requestId

    const run = async () => {
      setIsHydrating(true)
      try {
        const hydratedEntries = await hydrateEntriesWithViewerContent(previewSelectedEntries)
        if (!active || previewRequestIdRef.current !== requestId) {
          return
        }

        if (hydratedEntries.length > 0) {
          const hydratedMap = new Map(hydratedEntries.map((entry) => [entry.id, entry]))
          setEntries((prev) => prev.map((entry) => hydratedMap.get(entry.id) ?? entry))
        }

        const initialDrafts: Record<string, string> = {}
        hydratedEntries.forEach((entry, index) => {
          initialDrafts[entry.id] = buildStudioEntryBlock(entry, index, format, { isLoading })
        })
        dirtyIdsRef.current = new Set()
        setDraftMap(initialDrafts)
        setError(null)
      } finally {
        if (active && previewRequestIdRef.current === requestId) {
          setIsHydrating(false)
        }
      }
    }

    void run()

    return () => {
      active = false
    }
  }, [showPreviewOverlay, previewSelectedEntries, previewSelectionKey, format])

  const handleToggleEntry = (entryId: string) => {
    userSelectionTouchedRef.current = true
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(entryId)) {
        next.delete(entryId)
      } else {
        next.add(entryId)
      }
      return next
    })
  }

  const handleToggleSelectAll = () => {
    if (!hasFilteredEntries) {
      return
    }
    userSelectionTouchedRef.current = true
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        selectableAllEntries.forEach((entry) => next.delete(entry.id))
      } else {
        selectableAllEntries.forEach((entry) => next.add(entry.id))
      }
      return next
    })
  }

  const handleForceRefresh = useCallback(() => {
    if (isRefreshing) return
    setIsRefreshing(true)

    const domNow = readStudioTitlesFromDom()
      .filter((entry) => UUID_RE.test(String(entry.id)) && String(entry.title ?? "").trim().length >= 3)
      .map((entry) => ({
        id: String(entry.id),
        title: String(entry.title).trim(),
        meta: entry.meta || "Resultado do EstÃºdio",
        type: entry.type ?? inferTypeFromSignals(entry.title, entry.meta, entry.content),
        content: "",
        url: undefined,
        mimeType: undefined,
        node: entry.node,
        kind: "text" as const
      }))
    if (domNow.length > 0) {
      setListEntries((prev) => {
        const prevById = new Map(prev.map((entry) => [entry.id, entry]))
        const nextById = new Map(prevById)
        for (const entry of domNow) {
          const old = nextById.get(entry.id)
          nextById.set(entry.id, old ? { ...old, ...entry, node: entry.node || old.node } : entry)
        }
        const domOrder = new Map(domNow.map((entry, idx) => [entry.id, idx]))
        return Array.from(nextById.values())
          .filter((entry) => String(entry.id ?? "").trim().length > 0 && String(entry.title ?? "").trim().length >= 3)
          .sort((a, b) => {
            const ai = domOrder.has(a.id) ? domOrder.get(a.id)! : Number.MAX_SAFE_INTEGER
            const bi = domOrder.has(b.id) ? domOrder.get(b.id)! : Number.MAX_SAFE_INTEGER
            if (ai !== bi) return ai - bi
            return String(a.title ?? "").localeCompare(String(b.title ?? ""), "pt-BR", { sensitivity: "base" })
          })
      })
      setEntries((prev) => {
        const prevById = new Map(prev.map((entry) => [entry.id, entry]))
        const merged = [...prev]
        for (const entry of domNow) {
          const old = prevById.get(entry.id)
          const next = old
            ? {
                ...old,
                ...entry,
                title: entry.title,
                type: resolvePreferredType(old.type, entry.type),
                kind: old.kind || entry.kind,
                content: old.content || entry.content,
                url: old.url || entry.url,
                mimeType: old.mimeType || entry.mimeType,
                node: old.node || entry.node
              }
            : entry
          const index = merged.findIndex((value) => value.id === entry.id)
          if (index >= 0) {
            merged[index] = next
          } else {
            merged.push(next)
          }
        }
        return merged
      })
      setIsLoading(false)
    }

    const notebookId = resolveNotebookIdFromUrl()
    window.postMessage(
      { source: "minddock", type: "MINDDOCK_FETCH_STUDIO_LIST", payload: { notebookId } },
      "*"
    )
    const ids = Array.from(
      new Set(
        [...listIds, ...entries.map((entry) => entry.id), ...domNow.map((entry) => entry.id)].filter((id) =>
          UUID_RE.test(String(id))
        )
      )
    )
    const hasIds = ids.length > 0
    if (!hasIds) {
      setEntries([])
      setIsLoading(true)
      setIsRefreshing(false)
      return
    }
    if (!deepTitleProbeInFlightRef.current) {
      deepTitleProbeInFlightRef.current = true
      void readStudioTitlesByIdFromDomDeep(ids)
        .then((titleById) => {
          if (titleById.size === 0) return
          setListEntries((prev) =>
            prev.map((entry) => {
              const nextTitle = titleById.get(entry.id)
              if (!nextTitle || !shouldApplyDeepProbeTitle(entry, nextTitle)) return entry
              return { ...entry, title: nextTitle }
            })
          )
          setEntries((prev) =>
            prev.map((entry) => {
              const nextTitle = titleById.get(entry.id)
              if (!nextTitle || !shouldApplyDeepProbeTitle(entry, nextTitle)) return entry
              return { ...entry, title: nextTitle }
            })
          )
        })
        .finally(() => {
          deepTitleProbeInFlightRef.current = false
        })
    }
    const expectedCount = ids.length
    const currentCount = mergedEntries.filter((entry) => entry.content || entry.url).length
    fetchInFlightRef.current = true
    setIsLoading(true)
    requestStudioArtifacts(ids, { forceRefresh: true, expectedCount, currentCount })
      .then((items) => {
        if (items.length > 0) {
          applyStudioItems(items, ids)
        }
      })
      .catch((refreshError) => {
        const message =
          refreshError instanceof Error ? refreshError.message : "Falha ao atualizar o Estudio."
        setError(message)
      })
      .finally(() => {
        if (!deepTitleProbeInFlightRef.current) {
          deepTitleProbeInFlightRef.current = true
          void sleep(180)
            .then(() => readStudioTitlesByIdFromDomDeep(ids))
            .then((titleById) => {
              if (titleById.size === 0) return
              setListEntries((prev) =>
                prev.map((entry) => {
                  const nextTitle = titleById.get(entry.id)
                  if (!nextTitle || !shouldApplyDeepProbeTitle(entry, nextTitle)) return entry
                  return { ...entry, title: nextTitle }
                })
              )
              setEntries((prev) =>
                prev.map((entry) => {
                  const nextTitle = titleById.get(entry.id)
                  if (!nextTitle || !shouldApplyDeepProbeTitle(entry, nextTitle)) return entry
                  return { ...entry, title: nextTitle }
                })
              )
            })
            .finally(() => {
              deepTitleProbeInFlightRef.current = false
            })
        }
        fetchInFlightRef.current = false
        setIsRefreshing(false)
        setIsLoading(false)
      })
  }, [applyStudioItems, entries, isRefreshing, listIds, mergedEntries])

  const hydrateEntriesWithViewerContent = async (entriesToHydrate: StudioEntry[]): Promise<StudioEntry[]> => {
    let lastContent = resolveStudioViewerContent()
    const updated: StudioEntry[] = []
    let liveNodeById: Map<string, HTMLElement> | null = null
    const getLiveNodeById = (id: string): HTMLElement | undefined => {
      if (!liveNodeById) {
        liveNodeById = new Map(
          readStudioTitlesFromDom()
            .filter((entry) => UUID_RE.test(String(entry.id)) && entry.node)
            .map((entry) => [String(entry.id), entry.node as HTMLElement] as const)
        )
      }
      return liveNodeById.get(id)
    }

    for (const entry of entriesToHydrate) {
      const existingContent = typeof entry.content === "string" ? entry.content.trim() : ""
      if (existingContent.length > 0 || shouldTreatEntryAsAssetForExport(entry)) {
        updated.push(entry)
        continue
      }

      const targetNode =
        (entry.node && entry.node.isConnected ? entry.node : undefined) ??
        (entry.id ? getLiveNodeById(String(entry.id)) : undefined)
      if (!targetNode) {
        updated.push(entry)
        continue
      }
      try {
        const previousViewerContent = lastContent
        clickStudioEntryNode(targetNode)
        const nextContent = await waitForStudioContentUpdate(lastContent, 2200)
        const freshViewerContent =
          nextContent && nextContent !== previousViewerContent ? nextContent : ""
        let resolvedEntry: StudioEntry = entry

        if (looksLikeFlashcardsEntry(entry)) {
          const flashcards = await scrapeFlashcardsFromDom()
          if (flashcards) {
            resolvedEntry = { ...resolvedEntry, content: flashcards }
          }
        }

        if (!resolvedEntry.content || !looksLikeFlashcardsEntry(entry)) {
          const note = scrapeOpenNoteContent()
          const bestContent = pickBestStudioHydratedContent([
            resolvedEntry.content,
            entry.content,
            freshViewerContent,
            note?.content
          ])
          if (bestContent) {
            resolvedEntry = { ...resolvedEntry, content: bestContent }
          }
        }

        if (resolvedEntry.content) {
          lastContent = resolvedEntry.content
        } else if (freshViewerContent) {
          lastContent = freshViewerContent
        }

        updated.push(resolvedEntry)
      } catch {
        updated.push(entry)
      }
      await new Promise((resolve) => setTimeout(resolve, 120))
    }

    return updated
  }

  const handlePreparePreview = () => {
    if (showPreviewOverlay) {
      return
    }
    setShowPreviewOverlay(true)
  }

  const handlePreviewClick = (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    handlePreparePreview()
  }

  const executeExport = async (exportFormat: StudioFormat, exportDraftMap: Record<string, string>) => {
    if (isExporting || isHydrating || !hasSelection) {
      return
    }

    setIsExporting(true)
    setError(null)
    setExportToast({
      status: "running",
      message: "Preparando exportacao do Estudio...",
      progress: 8
    })

    try {
      const stageStart = performance.now()
      const traceId = `studio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      const trace = (stage: string, details?: Record<string, unknown>) => {
        console.log(`[MindDock][StudioExportTrace][${traceId}] ${stage}`, details ?? {})
      }

      trace("start", {
        format: exportFormat,
        selected: selectedEntries.length,
        selectedIds: selectedEntries.map((entry) => entry.id)
      })
      setExportToast({
        status: "running",
        message: `Exportando ${selectedEntries.length} item(ns) do Estudio...`,
        progress: 14
      })
      await flushUiFrame()

      const withTimeout = async <T,>(promise: Promise<T>, ms: number): Promise<T | null> => {
        let timer: number | null = null
        try {
          const timeoutPromise = new Promise<null>((resolve) => {
            timer = window.setTimeout(() => resolve(null), ms)
          })
          return (await Promise.race([promise, timeoutPromise])) as T | null
        } finally {
          if (timer !== null) window.clearTimeout(timer)
        }
      }

      const hasTextContentForExport = (entry: StudioEntry): boolean => {
        const content = typeof entry.content === "string" ? entry.content.trim() : ""
        return Boolean(content) && !looksLikeUrl(content)
      }

      const needsHydration = selectedEntries.some(
        (entry) => !shouldTreatEntryAsAssetForExport(entry) && !hasTextContentForExport(entry)
      )
      trace("hydrate-check", { needsHydration })

      let exportEntries = selectedEntries
      if (needsHydration) {
        const hydrationStart = performance.now()
        const hydrated = await withTimeout(hydrateEntriesWithViewerContent(selectedEntries), 1200)
        if (hydrated && Array.isArray(hydrated)) {
          exportEntries = hydrated
          trace("hydrate-success", {
            elapsedMs: Math.round(performance.now() - hydrationStart),
            entries: hydrated.length
          })
        } else {
          console.warn("[MindDock][StudioExport] hydration-timeout-skip", {
            selected: selectedEntries.length
          })
          trace("hydrate-timeout", {
            elapsedMs: Math.round(performance.now() - hydrationStart),
            timeoutMs: 1200
          })
        }

        console.log("[MindDock][StudioExport] hydration-finished", {
          entries: exportEntries.length,
          elapsedMs: Math.round(performance.now() - stageStart)
        })
        setExportToast((current) =>
          current.status === "running"
            ? { ...current, message: "Conteudo preparado. Montando arquivos...", progress: Math.max(current.progress, 28) }
            : current
        )
      }

      const needsRefreshByEntry = (entry: StudioEntry): boolean => {
        const id = String(entry.id ?? "").trim()
        if (!id) return false

        const hasUrl = Boolean(resolveEntryAssetUrl(entry))
        const visualSignal =
          shouldTreatEntryAsAssetForExport(entry) ||
          isVisualAssetEntry(entry) ||
          isVisualTypeCode(entry.type) ||
          String(entry.kind ?? "").trim().toLowerCase() === "asset"

        if (visualSignal) {
          return !hasUrl
        }

        return !hasTextContentForExport(entry)
      }

      const idsNeedingRefresh = Array.from(
        new Set(
          exportEntries
            .filter((entry) => needsRefreshByEntry(entry))
            .map((entry) => String(entry.id ?? "").trim())
            .filter(Boolean)
        )
      )
      trace("refresh-check", {
        idsNeedingRefresh: idsNeedingRefresh.length,
        ids: idsNeedingRefresh
      })

      if (idsNeedingRefresh.length > 0) {
        try {
          const refreshStart = performance.now()
          const refreshTargets = new Set(idsNeedingRefresh)
          const currentResolvedCount = exportEntries.filter((entry) => {
            const id = String(entry.id ?? "").trim()
            if (!id || !refreshTargets.has(id)) return false
            if (resolveEntryAssetUrl(entry)) return true
            return hasTextContentForExport(entry)
          }).length

          const refreshedItems =
            (await withTimeout(
              requestStudioArtifacts(idsNeedingRefresh, {
                forceRefresh: true,
                expectedCount: idsNeedingRefresh.length,
                currentCount: currentResolvedCount
              }),
              1200
            )) ?? []

          if (refreshedItems.length === 0) {
            console.warn("[MindDock][StudioExport] refresh-timeout-or-empty-continue", {
              pendingIds: idsNeedingRefresh.length
            })
            trace("refresh-empty-or-timeout", {
              elapsedMs: Math.round(performance.now() - refreshStart),
              timeoutMs: 1200
            })
          } else {
            trace("refresh-success", {
              elapsedMs: Math.round(performance.now() - refreshStart),
              refreshedItems: refreshedItems.length
            })
          }

          if (refreshedItems.length > 0) {
            exportEntries = mergeEntriesWithRefreshedArtifacts(exportEntries, refreshedItems)
          }
        } catch (refreshErr) {
          console.warn("[MindDock][StudioExportDecision] refresh-before-export-failed", refreshErr)
          trace("refresh-error", { error: getErrorMessage(refreshErr) })
        }
      }

      if (exportEntries.length > 0) {
        const hydratedMap = new Map(exportEntries.map((entry) => [entry.id, entry]))
        setEntries((prev) => prev.map((entry) => hydratedMap.get(entry.id) ?? entry))
      }

      const buildStart = performance.now()
      setExportToast((current) =>
        current.status === "running"
          ? { ...current, message: "Gerando arquivos de exportacao...", progress: Math.max(current.progress, 48) }
          : current
      )
      const { files, directDownloads } = await buildStudioExportFiles(exportEntries, exportFormat, exportDraftMap, {
        traceId
      })
      const fallbackUrlFiles = files.filter((file) => file.isAsset && file.filename.toLowerCase().endsWith(".url"))
      trace("build-files-finished", {
        elapsedMs: Math.round(performance.now() - buildStart),
        files: files.length,
        directDownloads,
        fallbackUrlFiles: fallbackUrlFiles.length,
        fallbackNames: fallbackUrlFiles.map((file) => file.filename)
      })

      if (files.length === 0 && directDownloads === 0) {
        throw new Error("Nenhum arquivo do Studio foi gerado para exportacao.")
      }
      if (files.length === 0 && directDownloads > 0) {
        setExportToast({
          status: "success",
          message: `Exportacao concluida (${directDownloads} download(s) direto(s)).`,
          progress: 100
        })
        console.log("[MindDock][StudioExportDecision] export-completed-via-direct-download", {
          directDownloads
        })
        trace("finish-direct-download-only", {
          elapsedTotalMs: Math.round(performance.now() - stageStart),
          directDownloads
        })
        await sleep(TOAST_MIN_VISIBLE_MS)
        return
      }

      if (files.length === 1 && files[0].isAsset && files[0].filename.toLowerCase().endsWith(".url")) {
        const text = new TextDecoder().decode(files[0].bytes)
        const match = text.match(/^URL=(.+)$/im)
        const fallbackUrl = String(match?.[1] ?? "").trim()
        const firstEntry = exportEntries[0]

        if (fallbackUrl && firstEntry) {
          const rpcContext = resolveRpcContextFromWindow()
          const atToken = typeof rpcContext?.at === "string" ? rpcContext.at : undefined
          const authUser = resolveAuthUserFromUrl(window.location.href)
          const candidates = buildDirectDownloadCandidates(fallbackUrl, { atToken, authUser })

          console.warn("[MindDock][StudioExportDecision] direct-download-fallback-start", {
            title: firstEntry.title,
            url: fallbackUrl,
            candidates: candidates.length
          })

          const ext = resolveAssetExtension(firstEntry, candidates[0] ?? fallbackUrl)
          const directName = `${sanitizeFilename(buildMindDuckFilenameBase("Studio", firstEntry.title))}.${ext}`
          const ok = await tryChromeDirectDownload(candidates, directName)
          if (ok) {
            setExportToast({
              status: "success",
              message: "Exportacao concluida via download direto.",
              progress: 100
            })
            console.log("[MindDock][StudioExportDecision] direct-download-fallback-success", {
              title: firstEntry.title,
              filename: directName
            })
            trace("finish-direct-download-fallback-success", {
              elapsedTotalMs: Math.round(performance.now() - stageStart),
              filename: directName
            })
            await sleep(TOAST_MIN_VISIBLE_MS)
            return
          }
          console.warn("[MindDock][StudioExportDecision] direct-download-fallback-failed", {
            title: firstEntry.title
          })
          trace("direct-download-fallback-failed", {
            title: firstEntry.title,
            url: fallbackUrl,
            candidates: candidates.length
          })
        }
      }

      const filenameBase = buildMindDockZipBase("Estudio")
      trace("download-plan", { zip: true, files: files.length })
      setExportToast({
        status: "running",
        message: `Compactando ${files.length} arquivo(s)...`,
        progress: 92
      })
      await flushUiFrame()
      const zipBytes = await buildZip(files.map((file) => ({ filename: file.filename, bytes: file.bytes })))
      setExportToast({
        status: "success",
        message: `Exportacao concluida: ${filenameBase}.zip`,
        progress: 100
      })
      triggerDownload(new Blob([toArrayBuffer(zipBytes)], { type: "application/zip" }), `${filenameBase}.zip`)
      trace("finish-zip", {
        elapsedTotalMs: Math.round(performance.now() - stageStart),
        filename: `${filenameBase}.zip`
      })
      await sleep(TOAST_MIN_VISIBLE_MS)
    } catch (exportError) {
      const message =
        exportError instanceof Error ? exportError.message : "Falha ao exportar o Studio."
      setError(message)
      setExportToast({
        status: "error",
        message,
        progress: 100
      })
      console.warn("[MindDock][StudioExportTrace] finish-error", {
        message: getErrorMessage(exportError)
      })
      throw exportError
    } finally {
      setIsExporting(false)
    }
  }

  const handleExport = async (overrideFormat?: StudioFormat) => {
    try {
      await executeExport(overrideFormat ?? format, draftMap)
    } catch {
      // error handled in executeExport
    }
  }

  useEffect(() => {
    exportHandlerRef.current = handleExport
  }, [handleExport])

  useEffect(() => {
    if (!showPreviewOverlay) {
      previewOpenedRef.current = false
      if (previewOpenTimerRef.current !== null) {
        window.clearTimeout(previewOpenTimerRef.current)
        previewOpenTimerRef.current = null
      }
      return
    }
    previewOpenedRef.current = false
    const detail: ExportPreviewOpenDetail = {
      items: previewItems,
      format,
      formatOptions: STUDIO_FORMAT_OPTIONS,
      onChangeFormat: handlePreviewFormatChange,
      onChangeItem: handlePreviewContentChange,
      onRequestExport: exportHandlerRef.current ?? undefined,
      isExporting: isExporting || isHydrating,
      toast: exportToast.status === "idle" ? undefined : exportToast,
      labels: {
        previewLabTitle: "LABORATÓRIO DE PRÉ-VISUALIZAÇÃO",
        title: "Pré-visualização do Estúdio",
        subtitle: "Revise e edite cada resultado antes de exportar.",
        previewTextareaPlaceholder: "Edite o conteudo antes de exportar.",
        noPreview: "Nenhum conteudo para pre-visualizar.",
        backButton: "Voltar",
        exportButton: "Exportar",
        exportingButton: "Exportando..."
      }
    }
    window.dispatchEvent(new CustomEvent(EXPORT_PREVIEW_OPEN_EVENT, { detail }))
    previewOpenTimerRef.current = window.setTimeout(() => {
      previewOpenedRef.current = true
    }, 0)
  }, [
    showPreviewOverlay,
    previewItems,
    format,
    exportedAtLabel,
    handlePreviewFormatChange,
    handlePreviewContentChange,
    exportToast
  ])

  useEffect(() => {
    if (!showPreviewOverlay || !previewOpenedRef.current) {
      return
    }
    window.dispatchEvent(
      new CustomEvent(EXPORT_PREVIEW_UPDATE_EVENT, {
        detail: {
          isExporting: isExporting || isHydrating,
          toast: exportToast.status === "idle" ? undefined : exportToast
        }
      })
    )
  }, [showPreviewOverlay, isExporting, isHydrating, exportToast])

  const handleCloseModal = useCallback(() => {
    if (showPreviewOverlay) {
      window.dispatchEvent(new CustomEvent(EXPORT_PREVIEW_CLOSE_EVENT))
      setShowPreviewOverlay(false)
    }
    onClose()
  }, [showPreviewOverlay, onClose])

  return (
    <div className="studio-modal-stack">
    <div
        className="overlay"
        data-minddock-studio-export-overlay="true"
        data-preview-active={showPreviewOverlay ? "true" : "false"}>
        <div className="overlay-backdrop" onClick={handleCloseModal} />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Studio export"
          className="panel"
          onClick={stopProp}
          onMouseDown={stopProp}>
          <div className="inner">
          <header className="header">
            <div>
              <span className="badge">
                <FileText width={11} height={11} />
                EXPORTAÇÃO DE ESTÚDIO
              </span>
            <p className="title">{modalTitle}</p>
            <p className="subtitle">
              Aqui vamos mostrar o resultado gerado pela opção escolhida no Estúdio.
            </p>
            </div>
            <button className="close-btn" type="button" aria-label="Fechar" onClick={handleCloseModal}>
              X
            </button>
          </header>

          <div className="body">
            <div className="search-bar">
              <Search width={14} height={14} />
              <input
                type="search"
                value={sourceSearch}
                onChange={(e) => setSourceSearch(e.target.value)}
                placeholder="Filtrar fontes..."
              />
            </div>

            <div className="format-grid">
              {STUDIO_FORMAT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`fmt-btn${format === opt.id ? " active" : ""}`}
                  onClick={() => handlePreviewFormatChange(opt.id)}>
                  <span className="fmt-btn-label" translate={opt.noTranslate ? "no" : undefined}>
                    {opt.label}
                  </span>
                  <span className="fmt-btn-sub" translate={opt.noTranslate ? "no" : undefined}>
                    {opt.sub}
                  </span>
                </button>
              ))}
            </div>

            <div className="select-all-row">
              <label className="select-all-label">
                <input
                  ref={selectAllCheckboxRef}
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={handleToggleSelectAll}
                  disabled={!hasFilteredEntries}
                />
                <span>todos</span>
              </label>
              <div className="select-all-actions">
                <button
                  type="button"
                  className="studio-refresh-button"
                  onClick={handleForceRefresh}
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Atualizando..." : "Atualizar"}
                </button>
              </div>
            </div>
          </div>

          <div className="source-list">
            {error ? <div className="source-error">{error}</div> : null}
            {!hasAnyEntries && !isLoading && (
              <div className="source-empty">Nenhum item do Estúdio encontrado.</div>
            )}
            {(selectableEntries.length > 0 || filteredVisualEntries.length > 0) && (
              <div className="source-sections">
                {selectableEntries.length > 0 && (
                  <section className="source-section">
                    <div className="source-section-header">
                      <div className="source-section-title">Documentos</div>
                    </div>
                    <div className="source-section-list">
                      {selectableEntries.map((entry) => (
                        <label key={entry.id} className="source-item">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(entry.id)}
                            onChange={() => handleToggleEntry(entry.id)}
                          />
                          <span>
                            <span className="source-title" title={entry.title}>
                              {entry.title}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </section>
                )}
                {filteredVisualEntries.length > 0 && (
                  <section className="source-section">
                    <div className="source-section-header">
                      <div className="source-section-title">Visuais</div>
                    </div>
                    <div className="source-section-list">
                      {filteredVisualEntries.map((entry) => (
                        <label key={entry.id} className="source-item">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(entry.id)}
                            onChange={() => handleToggleEntry(entry.id)}
                          />
                          <span>
                            <span className="source-title" title={entry.title}>
                              {entry.title}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>

          {exportToast.status !== "idle" && (
            <div className={`studio-toast studio-toast--${exportToast.status}`}>
              <div className="studio-toast-head">
                <span>{exportToast.status === "running" ? "Exportando" : exportToast.status === "success" ? "Concluido" : "Erro"}</span>
                <span>{Math.max(0, Math.min(100, Math.round(exportToast.progress)))}%</span>
              </div>
              <p className="studio-toast-msg">{exportToast.message}</p>
              <div className="studio-toast-track">
                <div
                  className="studio-toast-fill"
                  style={{ width: `${Math.max(0, Math.min(100, exportToast.progress))}%` }}
                />
              </div>
            </div>
          )}

          <footer className="footer">
            <button
              type="button"
              className="btn-ghost"
              onClick={handlePreviewClick}
              disabled={!hasPreviewSelection || isExporting || isHydrating || showPreviewOverlay}>
              <Eye width={16} height={16} />
              {isHydrating ? "Carregando..." : "Prévia"}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => handleExport()}
              disabled={isExporting || isHydrating || !hasSelection}>
              {isExporting || isHydrating ? (
                <Loader2 size={16} strokeWidth={2} className="spin" />
              ) : (
                <Download size={16} strokeWidth={2} />
              )}
              {isExporting ? "Exportando..." : isHydrating ? "Carregando..." : "Exportar"}
            </button>
          </footer>
        </div>
      </div>
      </div>
    </div>
  )
}

export function StudioExportButton() {
  const [isOpen, setIsOpen] = useState(false)
  const portalHost = useMindDockPortal("studio-export-modal", 2147483646)

  const broadcastStudioModalState = useCallback((nextOpen: boolean) => {
    window.dispatchEvent(
      new CustomEvent(STUDIO_EXPORT_MODAL_STATE_EVENT, {
        detail: { isOpen: nextOpen }
      })
    )
  }, [])

  useEffect(() => {
    if (!isOpen) return
    bgLog({ tag: "studio-modal-open" })
  }, [isOpen])

  useEffect(() => {
    broadcastStudioModalState(isOpen)

    return () => {
      broadcastStudioModalState(false)
    }
  }, [isOpen, broadcastStudioModalState])

  const cssInjectedRef = useRef(false)
  const styleRef = useRef<HTMLStyleElement | null>(null)
  const mountRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<Root | null>(null)

  useLayoutEffect(() => {
    if (!portalHost) {
      return
    }

    if (!mountRef.current) {
      const mount = document.createElement("div")
      mount.id = "minddock-studio-export-root"
      portalHost.appendChild(mount)
      mountRef.current = mount
    }

    if (!rootRef.current && mountRef.current) {
      rootRef.current = createRoot(mountRef.current)
    }

    if (!cssInjectedRef.current) {
      const style = document.createElement("style")
      style.setAttribute("data-minddock-studio-style", "true")
      style.textContent = SCOPED_MODAL_CSS
      portalHost.appendChild(style)
      styleRef.current = style
      cssInjectedRef.current = true
    }

    return () => {
      if (rootRef.current) {
        rootRef.current.unmount()
        rootRef.current = null
      }
      if (mountRef.current?.parentNode) {
        mountRef.current.parentNode.removeChild(mountRef.current)
      }
      if (styleRef.current?.parentNode) {
        styleRef.current.parentNode.removeChild(styleRef.current)
      }
      styleRef.current = null
      mountRef.current = null
      cssInjectedRef.current = false
    }
  }, [portalHost])

  useEffect(() => {
    if (!rootRef.current) {
      return
    }
    if (!isOpen) {
      rootRef.current.render(null)
      return
    }
    rootRef.current.render(
      <div className={STUDIO_MODAL_SCOPE_CLASS}>
        <StudioModal
          onClose={() => {
            broadcastStudioModalState(false)
            setIsOpen(false)
          }}
        />
      </div>
    )
  }, [isOpen, broadcastStudioModalState])

  return (
    <>
      <div
        data-minddock-studio-export="true"
        className="relative ml-auto mr-1 inline-flex shrink-0 items-center"
        style={{ marginTop: "1px" }}>
        <button
          type="button"
          title="Export Studio"
          aria-label="Export Studio"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onMouseDown={swallowInteraction}
          onClick={(event) => {
            swallowInteraction(event)
            setIsOpen((prev) => {
              const next = !prev
              broadcastStudioModalState(next)
              return next
            })
          }}
          className={[
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] border transition-colors cursor-pointer",
            isOpen
              ? "border-white/[0.14] bg-[#0a0a0a] text-white"
              : "border-white/[0.06] bg-[#050505] text-white hover:bg-[#0d0d0d]"
          ].join(" ")}>
          <Download size={15} strokeWidth={1.8} />
        </button>
      </div>
    </>
  )
}

function swallowInteraction(event: {
  preventDefault: () => void
  stopPropagation: () => void
  nativeEvent?: Event
}): void {
  event.preventDefault()
  event.stopPropagation()
  const native = event.nativeEvent as Event & { stopImmediatePropagation?: () => void }
  native?.stopImmediatePropagation?.()
}
