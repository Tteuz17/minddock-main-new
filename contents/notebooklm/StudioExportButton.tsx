import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ChevronDown, Download, Eye, FileText, Loader2, Search } from "lucide-react"
import { MESSAGE_ACTIONS, type StandardResponse } from "~/lib/contracts"
import { base64ToBytes } from "~/lib/base64-bytes"
import {
  buildDocxBytesFromText,
  buildMindDuckFilenameBase,
  buildZip,
  sanitizeFilename,
  triggerDownload
} from "~/lib/source-download"
import { buildNotebookAccountKey, buildScopedStorageKey, resolveAuthUserFromUrl } from "~/lib/notebook-account-scope"
import { queryDeepAll } from "./sourceDom"
import { useShadowPortal } from "./useShadowPortal"
import {
  EXPORT_PREVIEW_CLOSE_EVENT,
  EXPORT_PREVIEW_OPEN_EVENT,
  type ExportPreviewOpenDetail
} from "./ExportPreviewPanel"

const CONTEXT_EVENT = "MINDDOCK_RPC_CONTEXT"

if (!(window as unknown as Record<string, unknown>).__minddock_rpc_listener_added) {
  ;(window as unknown as Record<string, unknown>).__minddock_rpc_listener_added = true
  window.addEventListener("message", (event) => {
    if (event.source !== window) return
    const data = (event as MessageEvent).data as { source?: string; type?: string; payload?: unknown } | null
    if (!data || data.source !== "minddock" || data.type !== CONTEXT_EVENT) return
    ;(window as unknown as Record<string, unknown>).__minddock_rpc_context = data.payload
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

type StudioFormat = "markdown" | "text" | "pdf" | "docx"

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
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function resolveNotebookIdFromUrl(): string | null {
  const match = window.location.href.match(UUID_RE)
  return match ? match[0] : null
}

function collectUuidCandidatesFromElement(el: Element): { id: string; score: number }[] {
  const candidates: { id: string; score: number }[] = []
  const attrs = el.getAttributeNames?.() ?? []
  for (const attr of attrs) {
    const raw = el.getAttribute(attr)
    if (!raw) continue
    const matches = raw.match(UUID_RE)
    if (!matches) continue

    const name = attr.toLowerCase()
    for (const id of matches) {
      let score = 0
      if (name.includes("artifact")) score += 6
      if (name.includes("result")) score += 3
      if (name.includes("studio")) score += 3
      if (name.includes("id")) score += 2
      if (raw.trim() === id) score += 3
      if (raw.length < 90) score += 1
      candidates.push({ id, score })
    }
  }
  return candidates
}

function resolveStudioArtifactIdFromRow(row: HTMLElement): string | null {
  const notebookId = resolveNotebookIdFromUrl()
  const candidates: { id: string; score: number }[] = []

  const push = (el: Element) => {
    candidates.push(...collectUuidCandidatesFromElement(el))
  }

  push(row)
  row.querySelectorAll("*").forEach((el) => push(el))

  const filtered = candidates.filter((candidate) => candidate.id !== notebookId)
  filtered.sort((a, b) => b.score - a.score)

  return filtered[0]?.id ?? null
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

async function requestStudioArtifacts(
  ids: string[],
  options?: { forceRefresh?: boolean }
): Promise<StudioEntry[]> {
  if (!chrome?.runtime?.sendMessage) {
    return []
  }

  const notebookId = resolveNotebookIdFromUrl() ?? undefined
  const forceRefresh = Boolean(options?.forceRefresh)
  const rpcContext = resolveRpcContextFromWindow()

  const response = await new Promise<any>((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: STUDIO_FETCH_MESSAGE,
        payload: { ids, notebookId, forceRefresh, rpcContext }
      },
      (resp) => resolve(resp ?? {})
    )
  })

  const items =
    response?.payload?.items ??
    response?.data?.items ??
    response?.items ??
    []

  return Array.isArray(items) ? items : []
}

const STUDIO_FORMAT_OPTIONS: Array<{ id: StudioFormat; label: string; sub: string; noTranslate?: boolean }> = [
  { id: "markdown", label: "Markdown", sub: ".md" },
  { id: "text", label: "Texto simples", sub: ".txt" },
  { id: "pdf", label: "PDF", sub: ".pdf" },
  { id: "docx", label: "Word", sub: ".docx", noTranslate: true }
]

const STUDIO_TYPE_LABELS: Record<string, string> = {
  "1": "Áudio Overview",
  "2": "Guia de Estudo",
  "3": "Briefing",
  "4": "Quiz",
  "5": "Sumário",
  "6": "Mind Map",
  "7": "FAQ",
  "8": "Linha do Tempo",
  "9": "Blog Post",
  "10": "Infográfico",
  "11": "Tabela de Dados",
  "12": "Slides",
  "13": "Flashcards",
  "14": "Vídeo Overview"
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

const STUDIO_META_PATTERN = /(fontes?|sources?|postagem|guia de estudo|ha\s+\d|há\s+\d|dias?|hours?|horas?|minutos?|mins?)/i

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
  return parts.length ? parts.join(" • ") : undefined
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
  const type = normalizeStorageValue(item.type) || undefined
  const kind = item.kind === "asset" || item.kind === "text" ? item.kind : undefined

  return {
    id,
    title,
    meta: resolveStudioMeta(item),
    content,
    type,
    url,
    mimeType,
    kind: kind ?? (url || mimeType ? "asset" : "text")
  }
}

async function loadStudioEntriesFromStorage(): Promise<{
  entries: StudioEntry[]
  scopedKeys: string[]
} | null> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return null
  }

  const accountSnapshot = await new Promise<Record<string, unknown>>((resolve) => {
    chrome.storage.local.get([ACCOUNT_EMAIL_KEY, AUTH_USER_KEY], (snapshot) => resolve(snapshot ?? {}))
  })

  const accountKey = buildNotebookAccountKey({
    accountEmail: accountSnapshot[ACCOUNT_EMAIL_KEY],
    authUser: accountSnapshot[AUTH_USER_KEY] ?? resolveAuthUserFromUrl(window.location.href)
  })

  const scopedKey = buildScopedStorageKey(STUDIO_STORAGE_KEY_BASE, accountKey)
  const fallbackKey = buildScopedStorageKey(STUDIO_STORAGE_KEY_BASE, buildNotebookAccountKey({}))
  const scopedKeys = Array.from(new Set([scopedKey, fallbackKey]))

  const dataSnapshot = await new Promise<Record<string, unknown>>((resolve) => {
    chrome.storage.local.get(scopedKeys, (snapshot) => resolve(snapshot ?? {}))
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
  const entries = normalized.filter(isValidStudioEntry)
  const debugText = buildStudioDebugText(rawItems, normalized, entries, usedKey)
  console.group("[MindDock][Studio][Debug]")
  console.log(debugText)
  console.groupEnd()

  if (usedKey && entries.length > 0 && entries.length !== normalized.length) {
    chrome.storage.local.set(
      {
        [usedKey]: entries
      },
      () => {
        void chrome.runtime.lastError
      }
    )
  }

  return { entries, scopedKeys }
}

function isNoiseLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) {
    return true
  }
  if (/^[•·•\-|]+$/.test(trimmed)) {
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
  let title = rawTitle.replace(/[•·|]+/g, " ").replace(/\s+/g, " ").trim()
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
    rawText.match(/\bhá\s+\d+\b.*$/i)

  if (!metaMatch || typeof metaMatch.index !== "number") {
    return null
  }

  const meta = metaMatch[0].trim()
  const title = cleanStudioTitle(
    rawText.slice(0, metaMatch.index).replace(/[•·\-\|]+$/u, "").trim(),
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
      if (!info) {
        continue
      }
      score += 1
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
    .filter((line) => /[A-Za-z\u00c0-\u00ff]/u.test(line))

  if (candidates.length === 0) {
    return ""
  }
  return candidates.sort((a, b) => b.length - a.length)[0]
}

function readStudioTitlesFromDom(): StudioEntry[] {
  const rows = Array.from(
    document.querySelectorAll(
      "[data-testid*='studio'], .studio-result-row, .artifact-row, .result-row, [role='listitem']"
    )
  ) as HTMLElement[]

  const entries: StudioEntry[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    if (row.closest("#minddock-studio-export-root")) {
      continue
    }

    const artifactId = resolveStudioArtifactIdFromRow(row)

    const titleElement =
      row.querySelector<HTMLElement>("[data-testid*='title'], .title, h3, h4, h5") ?? row
    const rawTitle = extractVisibleText(titleElement)

    const metaElement = row.querySelector<HTMLElement>(".meta, .subtitle, [data-testid*='meta']")
    const meta = metaElement
      ? extractVisibleText(metaElement)
      : resolveMetaFromRowText(extractVisibleText(row))

    let title = cleanStudioTitle(rawTitle, meta)
    if (!title) {
      title = rawTitle ? pickTitleFromLines(extractTextLinesFromRow(row)) : ""
    }

    const hasTitle = Boolean(title && title.trim().length > 0)
    if (hasTitle) {
      if (/^[a-z_]+$/i.test(title)) continue
      if (isTemplateLikeTitle(title)) continue
    }

    if (!artifactId && !hasTitle) continue

    const key = artifactId ?? `${title.toLowerCase()}::${meta.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)

    const clickable =
      row.closest<HTMLElement>("[role='listitem'], li") ??
      row.closest<HTMLElement>("button, [role='button'], a") ??
      row

    entries.push({
      id:
        artifactId ??
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `studio-dom-${hashString(key)}`),
      title: hasTitle ? title : "Carregando resultado do Estúdio...",
      meta,
      type: meta,
      content: "",
      node: clickable
    })
  }

  return entries
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
    if (!entry.title || entry.title.length < 4 || entry.content.length < 40) {
      return
    }
    const key = `${entry.title.toLowerCase()}::${entry.content.slice(0, 80).toLowerCase()}`
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

    const rawText = normalizeEntryText(candidate.innerText || candidate.textContent || "")
    if (rawText.length < 200) {
      continue
    }
    const normalized = normalizeMatchText(rawText)
    if (STUDIO_CONTENT_BLOCKLIST.some((token) => normalized.includes(token))) {
      continue
    }
    if (!isLikelyContentText(rawText)) {
      continue
    }

    const score = rawText.length + rect.width * 0.5
    if (score > bestScore) {
      bestScore = score
      bestText = rawText
    }
  }

  return bestText
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

function buildStudioEntryBlock(entry: StudioEntry, index: number, format: StudioFormat): string {
  const lines: string[] = []
  if (format === "markdown") {
    lines.push(`## ${index + 1}. ${entry.title}`)
    if (entry.meta) {
      lines.push(`_${entry.meta}_`)
    }
  } else {
    lines.push(`${index + 1}. ${entry.title}`)
    if (entry.meta) {
      lines.push(entry.meta)
    }
  }
  if (entry.content) {
    lines.push("")
    lines.push(entry.content)
  } else if (entry.kind === "asset") {
    lines.push("")
    lines.push("Arquivo binario do Studio. Sera exportado como arquivo separado.")
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
  const lower = value.toLowerCase()
  if (/\.(png|jpe?g|gif|webp|svg|mp3|wav|ogg|m4a|aac|flac|mp4|mkv|webm|mov|avi|pdf)(\?|#|$)/u.test(lower)) {
    return true
  }
  if (lower.includes("alt=media") || lower.includes("download=")) {
    return true
  }
  return false
}

const STUDIO_INVALID_META = new Set(["resultado do studio"])
const CHAT_SIGNAL_PHRASES = [
  "create a detailed briefing document",
  "include quotes from the original",
  "designed to address this topic",
  "inclua citações",
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
  "infográfico"
]

function isTemplateLikeTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase()
  if (!normalized) {
    return false
  }
  return STUDIO_TEMPLATE_BLOCKLIST.some((template) => normalized.includes(template))
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

  // Itens com UUID real vieram do gArtLc — título já é confiável
  if (UUID_RE_VALIDATE.test(entry.id ?? "")) {
    return String(entry.title ?? "").trim().length >= 3
  }

  const hasMeta = metaValue.length > 0 && !STUDIO_INVALID_META.has(metaKey) && looksLikeStudioMetaSignal(metaValue)
  const hasStructuredContent = Boolean(entry.content && looksLikeStructuredStudioContent(entry.content))
  const hasAsset = entry.kind === "asset" && isDownloadableAssetUrl(entry.url)
  if (!hasMeta && !hasAsset && !hasStructuredContent) {
    return false
  }
  return true
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
  const hasStructuredContent = Boolean(entry.content && looksLikeStructuredStudioContent(entry.content))
  const hasAsset = entry.kind === "asset" && isDownloadableAssetUrl(entry.url)
  if (!hasMeta && !hasAsset && !hasStructuredContent) {
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
  const normalized = String(mimeType ?? "").toLowerCase()
  if (!normalized) {
    return null
  }
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
  return mapping[normalized] ?? null
}

function resolveAssetExtension(entry: StudioEntry): string {
  return (
    extractExtensionFromUrl(entry.url ?? "") ||
    extensionFromMime(entry.mimeType) ||
    (entry.type && /audio|video/i.test(entry.type) ? "mp4" : null) ||
    "bin"
  )
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

async function fetchBinaryFile(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { credentials: "include" })
  if (!response.ok) {
    throw new Error(`Falha ao exportar asset do Studio (${response.status}).`)
  }
  const buffer = await response.arrayBuffer()
  return new Uint8Array(buffer)
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
  draftMap: Record<string, string>
): Promise<Array<{ filename: string; bytes: Uint8Array; isAsset?: boolean }>> {
  const usedNames = new Set<string>()
  const encoder = new TextEncoder()
  const files: Array<{ filename: string; bytes: Uint8Array; isAsset?: boolean }> = []

  for (const [index, entry] of entries.entries()) {
    if (entry.kind === "asset") {
      const base = buildMindDuckFilenameBase("Studio", entry.title)
      const extension = resolveAssetExtension(entry)
      const filename = buildUniqueStudioFilename(base, extension, usedNames)

      if (!entry.url) {
        const placeholder = `Arquivo binario do Studio nao encontrado para: ${entry.title}`
        files.push({ filename: `${filename}.txt`, bytes: encoder.encode(placeholder), isAsset: true })
        continue
      }

      try {
        const bytes = await fetchBinaryFile(entry.url)
        files.push({ filename, bytes, isAsset: true })
      } catch {
        const placeholder = `Falha ao exportar arquivo do Studio para: ${entry.title}`
        files.push({ filename: `${filename}.txt`, bytes: encoder.encode(placeholder), isAsset: true })
      }
      continue
    }

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

  return files
}

function StudioModal({ onClose }: { onClose: () => void }) {
  const stopProp = (e: React.MouseEvent) => e.stopPropagation()
  const [format, setFormat] = useState<StudioFormat>("markdown")
  const [entries, setEntries] = useState<StudioEntry[]>([])
  const [sourceSearch, setSourceSearch] = useState("")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showPreviewOverlay, setShowPreviewOverlay] = useState(false)
  const [draftMap, setDraftMap] = useState<Record<string, string>>({})
  const [generatedAtIso] = useState(() => new Date().toISOString())
  const [isExporting, setIsExporting] = useState(false)
  const [isHydrating, setIsHydrating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null)
  const selectionInitRef = useRef(false)
  const dirtyIdsRef = useRef<Set<string>>(new Set())
  const exportHandlerRef = useRef<(() => void) | null>(null)
  const scopedKeysRef = useRef<string[]>([])
  const lastStudioListAtRef = useRef(0)
  const previewRequestIdRef = useRef(0)


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
    let active = true

    loadStudioEntriesFromStorage()
      .then((result) => {
        if (!active) {
          return
        }
        if (result) {
          scopedKeysRef.current = result.scopedKeys
          if (result.entries.length > 0) {
            setEntries(result.entries)
            return
          }
        }

        setEntries([])
      })
      .catch(() => {
        if (active) {
          setEntries([])
        }
      })

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
        const nextEntries = normalized.filter(isValidStudioEntry)
        const hasFreshStudioList = Date.now() - lastStudioListAtRef.current < 30000
        if (hasFreshStudioList && nextEntries.length === 0) {
          return
        }
        if (nextEntries.length > 0) {
          setEntries(nextEntries)
        } else {
          setEntries([])
        }
        console.group("[MindDock][Studio][Debug]")
        console.log(buildStudioDebugText(nextValue as StudioCacheItem[], normalized, nextEntries, key))
        console.groupEnd()
        break
      }
    }

    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChange)
    }

    return () => {
      active = false
      if (chrome?.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(handleStorageChange)
      }
    }
  }, [])

  useEffect(() => {
    const notebookId = resolveNotebookIdFromUrl()
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
        // Nao limpar a lista: manter o que ja esta renderizado.
        return
      }

      const items = data.payload?.items
      if (!Array.isArray(items) || items.length === 0) {
        setIsRefreshing(false)
        return
      }

      const mapped = (items as Array<{
        id: string
        title: string
        type?: number | string
        typeLabel?: string
      }>)
        .filter((item) => String(item.title ?? "").trim().length >= 3)
        .map((item) => {
          const typeKey = item.type !== undefined ? String(item.type) : undefined
          const typeLabel = item.typeLabel ?? (typeKey ? STUDIO_TYPE_LABELS[typeKey] : undefined)

          return {
            id: String(item.id),
            title: String(item.title).trim(),
            meta: typeLabel ? `Resultado do Estúdio · ${typeLabel}` : "Resultado do Estúdio",
            type: typeLabel ?? typeKey,
            content: "",
            kind: "text" as const
          }
        })
      if (mapped.length > 0) {
        lastStudioListAtRef.current = Date.now()
        setEntries(mapped)
      }
      setIsRefreshing(false)
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [setEntries])

  useEffect(() => {
    if (!selectionInitRef.current) {
      if (entries.length === 0) {
        return
      }
      setSelectedIds(new Set(entries.map((entry) => entry.id)))
      selectionInitRef.current = true
      return
    }
    setSelectedIds((prev) => {
      const allowed = new Set(entries.map((entry) => entry.id))
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
  }, [entries])

  const normalizedSearch = sourceSearch.trim().toLowerCase()
  const filteredEntries = useMemo(() => {
    if (!normalizedSearch) {
      return entries
    }
    return entries.filter((entry) => {
      const haystack = `${entry.title} ${entry.meta ?? ""}`.toLowerCase()
      return haystack.includes(normalizedSearch)
    })
  }, [entries, normalizedSearch])

  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedIds.has(entry.id)),
    [entries, selectedIds]
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
    selectedEntries.map((entry, index) => {
      const hasDraft = Object.prototype.hasOwnProperty.call(draftMap, entry.id)
      const fallback = buildStudioEntryBlock(entry, index, format)
      const content = hasDraft ? (draftMap[entry.id] ?? "") : fallback
      return {
        id: entry.id,
        title: entry.title,
        subtitle: entry.meta ?? "Resultado do Estudio",
        content
      }
    })
  ), [selectedEntries, draftMap, format])

  const exportedAtLabel = useMemo(
    () => formatExportTimestamp(generatedAtIso),
    [generatedAtIso]
  )

  const filteredSelectedCount = filteredEntries.reduce(
    (count, entry) => count + (selectedIds.has(entry.id) ? 1 : 0),
    0
  )
  const hasFilteredEntries = filteredEntries.length > 0
  const allFilteredSelected = hasFilteredEntries && filteredSelectedCount === filteredEntries.length
  const hasPartialFilteredSelection = filteredSelectedCount > 0 && !allFilteredSelected
  const hasSelection = selectedEntries.length > 0

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
    }
  }, [showPreviewOverlay])

  useEffect(() => {
    if (!showPreviewOverlay) {
      return
    }
    if (selectedEntries.length === 0) {
      return
    }

    let active = true
    const requestId = previewRequestIdRef.current + 1
    previewRequestIdRef.current = requestId

    const run = async () => {
      setIsHydrating(true)
      const hydratedEntries = await hydrateEntriesWithViewerContent(selectedEntries)
      if (!active || previewRequestIdRef.current !== requestId) {
        return
      }
      setIsHydrating(false)

      if (hydratedEntries.length > 0) {
        const hydratedMap = new Map(hydratedEntries.map((entry) => [entry.id, entry]))
        setEntries((prev) => prev.map((entry) => hydratedMap.get(entry.id) ?? entry))
      }

      const initialDrafts: Record<string, string> = {}
      hydratedEntries.forEach((entry, index) => {
        initialDrafts[entry.id] = buildStudioEntryBlock(entry, index, format)
      })
      dirtyIdsRef.current = new Set()
      setDraftMap(initialDrafts)
      setError(null)
    }

    void run()

    return () => {
      active = false
    }
  }, [showPreviewOverlay, selectedEntries, format])

  const handleToggleEntry = (entryId: string) => {
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
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        filteredEntries.forEach((entry) => next.delete(entry.id))
      } else {
        filteredEntries.forEach((entry) => next.add(entry.id))
      }
      return next
    })
  }

  const handleForceRefresh = useCallback(() => {
    if (isRefreshing) return
    setIsRefreshing(true)

    const notebookId = resolveNotebookIdFromUrl()
    window.postMessage(
      { source: "minddock", type: "MINDDOCK_FETCH_STUDIO_LIST", payload: { notebookId } },
      "*"
    )
  }, [isRefreshing])

  const hydrateEntriesWithViewerContent = async (entriesToHydrate: StudioEntry[]): Promise<StudioEntry[]> => {
    let lastContent = resolveStudioViewerContent()
    const updated: StudioEntry[] = []

    for (const entry of entriesToHydrate) {
      if (entry.content || entry.kind === "asset" || !entry.node) {
        updated.push(entry)
        continue
      }
      try {
        entry.node.click()
        const nextContent = await waitForStudioContentUpdate(lastContent, 2200)
        if (nextContent) {
          updated.push({ ...entry, content: nextContent })
          lastContent = nextContent
        } else {
          updated.push(entry)
        }
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

    try {
      const hydratedEntries = await hydrateEntriesWithViewerContent(selectedEntries)
      if (hydratedEntries.length > 0) {
        const hydratedMap = new Map(hydratedEntries.map((entry) => [entry.id, entry]))
        setEntries((prev) => prev.map((entry) => hydratedMap.get(entry.id) ?? entry))
      }

      const files = await buildStudioExportFiles(hydratedEntries, exportFormat, exportDraftMap)
      if (files.length === 0) {
        throw new Error("Nenhum arquivo do Studio foi gerado para exportacao.")
      }

      const hasAsset = files.some((file) => file.isAsset)
      const shouldZip = files.length > 1 || hasAsset
      const filenameBase = buildMindDuckFilenameBase(
        "Studio",
        selectedEntries[0]?.title ?? "Studio"
      )

      if (shouldZip) {
        const zipBytes = await buildZip(files.map((file) => ({ filename: file.filename, bytes: file.bytes })))
        triggerDownload(
          new Blob([toArrayBuffer(zipBytes)], { type: "application/zip" }),
          `${filenameBase}.zip`
        )
        return
      }

      const [file] = files
      triggerDownload(new Blob([toArrayBuffer(file.bytes)]), file.filename)
    } catch (exportError) {
      const message =
        exportError instanceof Error ? exportError.message : "Falha ao exportar o Studio."
      setError(message)
      throw exportError
    } finally {
      setIsExporting(false)
    }
  }

  const handleExport = async () => {
    try {
      await executeExport(format, draftMap)
    } catch {
      // error handled in executeExport
    }
  }

  useEffect(() => {
    exportHandlerRef.current = handleExport
  }, [handleExport])

  useEffect(() => {
    if (!showPreviewOverlay) {
      return
    }
    const detail: ExportPreviewOpenDetail = {
      items: previewItems,
      format,
      formatOptions: STUDIO_FORMAT_OPTIONS,
      onChangeFormat: handlePreviewFormatChange,
      onChangeItem: handlePreviewContentChange,
      onRequestExport: exportHandlerRef.current ?? undefined,
      isExporting: isExporting || isHydrating,
      labels: {
        previewLabTitle: "LABORATORIO DE PRE-VISUALIZACAO",
        title: "Estudio",
        subtitle: `Exportado em: ${exportedAtLabel}`,
        previewTextareaPlaceholder: "Edite o conteudo antes de exportar.",
        noPreview: "Nenhum conteudo para pre-visualizar.",
        backButton: "Voltar",
        exportButton: "Exportar",
        exportingButton: "Exportando..."
      }
    }
    window.dispatchEvent(new CustomEvent(EXPORT_PREVIEW_OPEN_EVENT, { detail }))
  }, [
    showPreviewOverlay,
    previewItems,
    format,
    exportedAtLabel,
    handlePreviewFormatChange,
    handlePreviewContentChange,
    isExporting,
    isHydrating
  ])

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
            <p className="title">Exportar resultado do Estúdio</p>
            <p className="subtitle">
              Aqui vamos mostrar o resultado gerado pela opcao escolhida no Estúdio.
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
            {!hasFilteredEntries && <div className="source-empty">Nenhum item do Estúdio encontrado.</div>}
            {filteredEntries.map((entry) => (
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
                  <span className="source-kind">{entry.meta ?? "Resultado do Estúdio"}</span>
                </span>
              </label>
            ))}
          </div>

          <footer className="footer">
            <button
              type="button"
              className="btn-ghost"
              onClick={handlePreviewClick}
              disabled={!hasSelection || isExporting || isHydrating || showPreviewOverlay}>
              <Eye width={16} height={16} />
              {isHydrating ? "Carregando..." : "Prévia"}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleExport}
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
  const { shadowRoot, injectCSS } = useShadowPortal("studio-export-modal", isOpen, 2147483646)
  const cssInjectedRef = useRef(false)
  const mountRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<Root | null>(null)

  useLayoutEffect(() => {
    if (!shadowRoot) {
      return
    }

    if (!mountRef.current) {
      const mount = document.createElement("div")
      mount.id = "minddock-studio-export-root"
      shadowRoot.appendChild(mount)
      mountRef.current = mount
    }

    if (!rootRef.current && mountRef.current) {
      rootRef.current = createRoot(mountRef.current)
    }

    if (!cssInjectedRef.current) {
      injectCSS(SHADOW_CSS)
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
      mountRef.current = null
      cssInjectedRef.current = false
    }
  }, [shadowRoot, injectCSS])

  useEffect(() => {
    if (!rootRef.current) {
      return
    }
    if (!isOpen) {
      rootRef.current.render(null)
      return
    }
    rootRef.current.render(<StudioModal onClose={() => setIsOpen(false)} />)
  }, [isOpen])

  return (
    <>
      <div data-minddock-studio-export="true" className="relative mr-1 inline-flex shrink-0 items-center">
        <div className="inline-flex shrink-0 items-center gap-1 rounded-[12px] border border-white/[0.08] bg-[#06080c] p-[3px]">
          <button
            type="button"
            title="Export"
            aria-label="Export"
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            onMouseDown={swallowInteraction}
            onClick={(event) => {
              swallowInteraction(event)
              setIsOpen((prev) => !prev)
            }}
            className={[
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] border px-3 text-[13px] font-medium transition-colors",
              "border-transparent bg-transparent text-[#cfd6e3] hover:bg-white/[0.04] hover:text-white cursor-pointer"
            ].join(" ")}>
            <Download size={14} strokeWidth={1.9} className="text-[#d7deea]" />
            <span className="whitespace-nowrap">Export</span>
            <ChevronDown
              size={14}
              strokeWidth={1.9}
              className={["transition-transform", isOpen ? "rotate-180" : ""].join(" ")}
            />
          </button>
        </div>
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

