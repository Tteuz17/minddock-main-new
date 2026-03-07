import type { AIChatMessage, AIChatPlatform, ChromeMessageResponse } from "~/lib/types"
import {
  extractClaudeMessages,
  resolveClaudeConversationTitleFromDom
} from "~/strategies/claude/ClaudeExtractor"
import {
  extractGeminiMessages,
  resolveGeminiConversationTitleFromDom,
  sanitizeGeminiText
} from "~/strategies/gemini/GeminiExtractor"

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
  preferredNotebookId?: string
}

export interface DomChatCaptureOptions {
  platform: AIChatPlatform
  platformLabel: string
  title: string
  messageSelectors: string[]
  containerSelectors?: string[]
  preferredNotebookId?: string
  capturedFromUrl?: string
  resolveRole?: (element: Element) => AIChatMessage["role"]
}

export interface DomChatSnapshot {
  title: string
  content: string
  messages: AIChatMessage[]
  capturedFromUrl: string
}

export interface AsyncDomChatCaptureOptions extends DomChatCaptureOptions {}

const DEFAULT_NOTEBOOK_KEYS = ["nexus_default_notebook_id", "minddock_default_notebook"] as const
export const UNIVERSAL_CAPTURE_REQUEST_EVENT = "MINDDOCK_CAPTURE_TO_NOTEBOOK"
export const UNIVERSAL_CAPTURE_RESULT_EVENT = "MINDDOCK_CAPTURE_RESULT"
export type ChatCaptureMode = "notebooklm"
const DEFAULT_CAPTURE_ROOT_SELECTORS = ["main", "div[role='main']", "div[role='presentation']"] as const

interface ChatCapturePayload extends Record<string, unknown> {
  mode?: ChatCaptureMode
}

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

function withCaptureMode(
  response: ChromeMessageResponse<Record<string, unknown>>,
  mode: ChatCaptureMode
): ChromeMessageResponse<Record<string, unknown>> {
  if (!response.success) {
    return response
  }

  const basePayload =
    ((response.payload ?? response.data) as Record<string, unknown> | undefined) ?? {}
  const payload: ChatCapturePayload = {
    ...basePayload,
    mode
  }

  return {
    ...response,
    payload,
    data: payload
  }
}

function normalizeConversation(messages: AIChatMessage[]): AppendSourceConversationMessage[] {
  return messages
    .map((message): AppendSourceConversationMessage => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content ?? "").trim()
    }))
    .filter((message) => message.content.length > 0)
}

function normalizeCaptureText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim()
}

function normalizePlatformLabel(value: string): string {
  const rawValue = String(value ?? "").trim()
  if (!rawValue) {
    return "CHAT"
  }

  const normalizedValue = rawValue
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")

  if (normalizedValue.includes("gemini") || normalizedValue.includes("gemeos")) {
    return "GEMINI"
  }

  if (normalizedValue.includes("chatgpt")) {
    return "CHATGPT"
  }

  if (normalizedValue.includes("claude")) {
    return "CLAUDE"
  }

  if (normalizedValue.includes("perplexity")) {
    return "PERPLEXITY"
  }

  return rawValue.toUpperCase()
}

function stripKnownTitleSuffixes(value: string): string {
  return value
    .replace(/\s*-\s*ChatGPT\s*$/i, "")
    .replace(/\s*-\s*Claude\s*$/i, "")
    .replace(/\s*\|\s*Claude\s*$/i, "")
    .replace(/\s*-\s*Gemini\s*$/i, "")
    .replace(/\s*-\s*Google Gemini\s*$/i, "")
    .replace(/\s*-\s*Google AI Studio\s*$/i, "")
    .replace(/\s*-\s*Perplexity\s*$/i, "")
    .replace(/\s*\|\s*Perplexity\s*$/i, "")
    .replace(/\s*-\s*NotebookLM\s*$/i, "")
    .replace(/^\s*Gemini\s*[-:]\s*/i, "")
    .trim()
}

function buildTaggedCaptureTitle(platformLabel: string, rawTitle: string): string {
  const normalizedPlatform = normalizePlatformLabel(platformLabel)
  const normalizedTitle = normalizeCaptureText(rawTitle)
  const cleanTitle = normalizedTitle.replace(/^\[[^\]]+\]\s*/u, "").trim()
  const fallbackTitle = "Sem Titulo"

  return `[${normalizedPlatform}] ${cleanTitle || fallbackTitle}`
}

function isGenericConversationTitle(value: string): boolean {
  const normalizedValue = normalizeCaptureText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")

  return (
    !normalizedValue ||
    normalizedValue === "conversa" ||
    normalizedValue === "conversas" ||
    normalizedValue === "chat" ||
    normalizedValue === "chats" ||
    normalizedValue === "gemini" ||
    normalizedValue === "gemeos"
  )
}

function normalizeGeminiComparisonKey(value: string): string {
  return normalizeCaptureText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function isGeminiNoiseLine(value: string): boolean {
  const normalizedValue = normalizeGeminiComparisonKey(value)
  if (!normalizedValue) {
    return true
  }

  if (normalizedValue.length === 1 && /^[a-z0-9]$/.test(normalizedValue)) {
    return true
  }

  if (
    normalizedValue === "gemini" ||
    normalizedValue === "gemeos" ||
    normalizedValue === "o gemini disse" ||
    normalizedValue === "o gemeos disse" ||
    normalizedValue === "gemini disse" ||
    normalizedValue === "gemeos disse" ||
    normalizedValue === "mostrar raciocinio" ||
    normalizedValue === "show thinking" ||
    normalizedValue === "mostrar calculo" ||
    normalizedValue === "mostrar calculos" ||
    normalizedValue === "mostrar rascunho" ||
    normalizedValue === "mostrar rascunhos" ||
    normalizedValue === "gem personalizado" ||
    normalizedValue === "personalized gem" ||
    normalizedValue === "ferramentas" ||
    normalizedValue === "tools"
  ) {
    return true
  }

  if (/^id[_\s-]*temp[_\d-]*$/i.test(normalizedValue)) {
    return true
  }

  return false
}

function isGenericGeminiRoute(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    const pathname = parsed.pathname.replace(/\/+$/u, "") || "/"
    return pathname === "/" || pathname === "/app"
  } catch {
    return false
  }
}

function isGeminiStarterUiMessage(value: string): boolean {
  const normalizedValue = normalizeGeminiComparisonKey(value)
  if (!normalizedValue) {
    return true
  }

  return (
    normalizedValue === "ola" ||
    normalizedValue === "ola mateus" ||
    normalizedValue === "por onde comecamos" ||
    normalizedValue === "peca ao gemini 3" ||
    normalizedValue === "ferramentas" ||
    normalizedValue === "raciocinio" ||
    normalizedValue === "criar imagem" ||
    normalizedValue === "criar musica" ||
    normalizedValue === "me ajude a aprender" ||
    normalizedValue === "crie um video" ||
    normalizedValue === "escrever algo" ||
    normalizedValue === "melhore meu dia"
  )
}

function isGeminiStarterState(messages: AIChatMessage[], capturedFromUrl: string): boolean {
  if (!isGenericGeminiRoute(capturedFromUrl)) {
    return false
  }

  const hasUserMessage = messages.some(
    (message) => message.role === "user" && normalizeCaptureText(message.content).length > 0
  )
  if (hasUserMessage) {
    return false
  }

  const hasAssistantContent = messages.some(
    (message) =>
      message.role === "assistant" &&
      normalizeCaptureText(message.content).length > 0 &&
      !isGeminiStarterUiMessage(message.content)
  )

  return !hasAssistantContent
}

function cleanGeminiMessageContent(value: string, role: AIChatMessage["role"]): string {
  return sanitizeGeminiText(value, role === "user" ? "USER" : "GEMINI")
}

function resolveGeminiTitleFromDom(): string {
  return resolveGeminiConversationTitleFromDom("")
}

function resolveFirstConversationLine(content: string): string {
  const lines = normalizeCaptureText(content)
    .split("\n")
    .map((line) => normalizeCaptureText(line))
    .filter(Boolean)

  return lines[0] ?? ""
}

function isLikelyGeminiPromptTitle(value: string, messages: AIChatMessage[]): boolean {
  const normalizedValue = normalizeGeminiComparisonKey(value)
  if (!normalizedValue) {
    return true
  }

  if (normalizedValue.startsWith("voce disse") || normalizedValue.startsWith("you said")) {
    return true
  }

  for (const message of messages) {
    if (message.role !== "user") {
      continue
    }

    const firstUserLine = resolveFirstConversationLine(message.content)
    if (!firstUserLine) {
      continue
    }

    if (normalizeGeminiComparisonKey(firstUserLine) === normalizedValue) {
      return true
    }
  }

  return false
}

function isAcceptableGeminiConversationTitle(value: string, messages: AIChatMessage[]): boolean {
  const normalizedValue = normalizeCaptureText(value)
  if (!normalizedValue) {
    return false
  }

  if (normalizedValue.length < 6 || normalizedValue.length > 140) {
    return false
  }

  if (isGenericConversationTitle(normalizedValue)) {
    return false
  }

  if (isLikelyGeminiPromptTitle(normalizedValue, messages)) {
    return false
  }

  return true
}

function resolveGeminiConversationTitle(
  snapshotTitle: string,
  messages: AIChatMessage[],
  fallbackTitle: string
): string {
  const domTitle = resolveGeminiTitleFromDom()
  if (isAcceptableGeminiConversationTitle(domTitle, messages)) {
    return domTitle
  }

  const normalizedSnapshotTitle = stripKnownTitleSuffixes(normalizeCaptureText(snapshotTitle))
  if (isAcceptableGeminiConversationTitle(normalizedSnapshotTitle, messages)) {
    return normalizedSnapshotTitle
  }

  const normalizedDocumentTitle = stripKnownTitleSuffixes(normalizeCaptureText(document.title))
  if (isAcceptableGeminiConversationTitle(normalizedDocumentTitle, messages)) {
    return normalizedDocumentTitle
  }

  return normalizeCaptureText(fallbackTitle) || "Novo Chat"
}

function scoreGeminiMessageContent(value: string): number {
  const normalizedValue = normalizeCaptureText(value)
  if (!normalizedValue) {
    return Number.NEGATIVE_INFINITY
  }

  const lines = normalizedValue.split("\n").map((line) => line.trim()).filter(Boolean)
  const noisePenalty = lines.filter((line) => isGeminiNoiseLine(line)).length * 40
  const shortLinePenalty = lines.filter((line) => line.length <= 2).length * 8
  const lengthScore = Math.min(420, normalizedValue.length)

  return lengthScore - noisePenalty - shortLinePenalty
}

function shouldMergeGeminiMessageContent(leftKey: string, rightKey: string): boolean {
  if (!leftKey || !rightKey) {
    return false
  }

  if (leftKey === rightKey) {
    return true
  }

  const minOverlapLength = 32
  return (
    (leftKey.length >= minOverlapLength && rightKey.includes(leftKey)) ||
    (rightKey.length >= minOverlapLength && leftKey.includes(rightKey))
  )
}

function selectPreferredGeminiMessageContent(currentValue: string, nextValue: string): string {
  const currentScore = scoreGeminiMessageContent(currentValue)
  const nextScore = scoreGeminiMessageContent(nextValue)

  if (nextScore > currentScore) {
    return nextValue
  }

  if (nextScore === currentScore && normalizeCaptureText(nextValue).length > normalizeCaptureText(currentValue).length) {
    return nextValue
  }

  return currentValue
}

function dedupeGeminiMessages(messages: AIChatMessage[]): AIChatMessage[] {
  const deduped: AIChatMessage[] = []

  for (const message of messages) {
    const normalizedContent = normalizeCaptureText(message.content)
    const normalizedKey = normalizeGeminiComparisonKey(normalizedContent)
    if (!normalizedContent || !normalizedKey) {
      continue
    }

    const lastMessage = deduped[deduped.length - 1]
    if (lastMessage && lastMessage.role === message.role) {
      const existingKey = normalizeGeminiComparisonKey(lastMessage.content)
      if (shouldMergeGeminiMessageContent(existingKey, normalizedKey)) {
        deduped[deduped.length - 1] = {
          ...lastMessage,
          content: selectPreferredGeminiMessageContent(lastMessage.content, normalizedContent)
        }
        continue
      }
    }

    deduped.push({
      role: message.role,
      content: normalizedContent
    })
  }

  return deduped
}

export function getConversationTitle(fallbackTitle = "Sem Titulo"): string {
  const host = window.location.hostname.toLowerCase()
  const isClaudeHost = host.includes("claude.ai")

  const claudeSelectors = [
    "[data-testid^='chat-title-'] .truncate.font-base-bold",
    "[data-testid^='chat-title-'] .truncate",
    "header [data-testid^='chat-title-']",
    "[data-testid='conversation-title']",
    "header h1",
    "header [role='heading']"
  ] as const

  const defaultSelectors = [
    "[data-testid='conversation-title']",
    "[data-testid='thread-title']",
    "[data-testid='chat-title']",
    "[data-testid='conversation-turns'] h1",
    "[data-testid='chat-messages'] h1",
    "main h1",
    "header h1",
    "h1",
    "div[data-testid='conversation-title']",
    "div[data-testid='thread-title']",
    "div[data-testid='chat-title']"
  ] as const

  const selectors = isClaudeHost ? claudeSelectors : defaultSelectors

  for (const selector of selectors) {
    const element = document.querySelector(selector)
    if (!element) {
      continue
    }

    const title = normalizeCaptureText(element.textContent ?? "")
    if (title) {
      return title
    }
  }

  const normalizedDocumentTitle = stripKnownTitleSuffixes(document.title)
  if (normalizedDocumentTitle) {
    return normalizedDocumentTitle
  }

  return String(fallbackTitle ?? "").trim() || "Sem Titulo"
}

function resolveCaptureRoot(selectors: readonly string[] = []): ParentNode {
  for (const selector of [...selectors, ...DEFAULT_CAPTURE_ROOT_SELECTORS]) {
    const element = document.querySelector(selector)
    if (element) {
      return element
    }
  }

  return document.body
}

function isVisibleCaptureNode(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected) {
    return false
  }

  if (element.hidden || element.getAttribute("aria-hidden") === "true") {
    return false
  }

  const style = window.getComputedStyle(element)
  return style.display !== "none" && style.visibility !== "hidden"
}

function readCaptureText(element: Element): string {
  return normalizeCaptureText(element.textContent ?? "")
}

export function captureChatSnapshot(options: DomChatCaptureOptions): DomChatSnapshot {
  const selector = options.messageSelectors.map((item) => item.trim()).filter(Boolean).join(", ")
  const root = resolveCaptureRoot(options.containerSelectors ?? [])

  let messages: AIChatMessage[] = []

  if (options.platform === "gemini") {
    messages = extractGeminiMessages().map((message) => ({
      role: message.role === "USER" ? "user" : "assistant",
      content: cleanGeminiMessageContent(message.content, message.role === "USER" ? "user" : "assistant")
    }))
  } else {
    messages =
      selector.length > 0
        ? Array.from(root.querySelectorAll(selector))
            .filter(isVisibleCaptureNode)
            .map((element): AIChatMessage | null => {
              const role = options.resolveRole?.(element) === "user" ? "user" : "assistant"
              const rawContent = readCaptureText(element)
              if (!rawContent) {
                return null
              }

              return {
                role,
                content: rawContent
              }
            })
            .filter((message): message is AIChatMessage => message !== null)
        : []
  }

  if (options.platform === "gemini") {
    messages = dedupeGeminiMessages(messages)
  }

  const capturedFromUrl =
    String(options.capturedFromUrl ?? window.location.href).trim() || window.location.href

  if (options.platform === "gemini" && isGeminiStarterState(messages, capturedFromUrl)) {
    throw new Error("Nenhum conteudo de conversa encontrado. Envie uma mensagem antes de capturar.")
  }

  if (messages.length === 0) {
    throw new Error("Nao foi possivel encontrar conteudo de chat nesta pagina.")
  }

  const baseTitle =
    String(options.title ?? "").trim() ||
    `Conversa ${options.platformLabel} - ${new Date().toLocaleDateString("pt-BR")}`
  const title =
    options.platform === "gemini"
      ? resolveGeminiConversationTitle(baseTitle, messages, "Conversa Gemini")
      : baseTitle

  return {
    title,
    content: messages.map((message) => message.content).join("\n\n"),
    messages,
    capturedFromUrl
  }
}

export async function captureChatSnapshotAsync(
  options: AsyncDomChatCaptureOptions
): Promise<DomChatSnapshot> {
  if (options.platform !== "claude") {
    return captureChatSnapshot(options)
  }

  let messages: AIChatMessage[] = (await extractClaudeMessages()).map((message) => ({
    role: message.role === "USER" ? "user" : "assistant",
    content: normalizeCaptureText(message.content)
  }))

  if (messages.length === 0) {
    // Fallback para o fluxo sincronizado caso o Claude mude o DOM.
    return captureChatSnapshot(options)
  }

  const baseTitle =
    String(options.title ?? "").trim() ||
    `Conversa ${options.platformLabel} - ${new Date().toLocaleDateString("pt-BR")}`
  const title = resolveClaudeConversationTitleFromDom(baseTitle)

  return {
    title,
    content: messages.map((message) => message.content).join("\n\n"),
    messages,
    capturedFromUrl: String(options.capturedFromUrl ?? window.location.href).trim() || window.location.href
  }
}

export function buildDomChatCaptureInput(options: DomChatCaptureOptions): SendChatCaptureInput {
  const snapshot = captureChatSnapshot(options)
  const taggedTitle = buildTaggedCaptureTitle(options.platformLabel, snapshot.title)

  return {
    platform: options.platform,
    platformLabel: options.platformLabel,
    title: taggedTitle,
    messages: snapshot.messages,
    capturedFromUrl: snapshot.capturedFromUrl,
    preferredNotebookId: options.preferredNotebookId
  }
}

export async function buildDomChatCaptureInputAsync(
  options: AsyncDomChatCaptureOptions
): Promise<SendChatCaptureInput> {
  const snapshot = await captureChatSnapshotAsync(options)
  const taggedTitle = buildTaggedCaptureTitle(options.platformLabel, snapshot.title)

  return {
    platform: options.platform,
    platformLabel: options.platformLabel,
    title: taggedTitle,
    messages: snapshot.messages,
    capturedFromUrl: snapshot.capturedFromUrl,
    preferredNotebookId: options.preferredNotebookId
  }
}

export function resolveChatCaptureMode(
  response: ChromeMessageResponse<Record<string, unknown>>
): ChatCaptureMode | null {
  if (!response.success) {
    return null
  }

  const payload = ((response.payload ?? response.data) as ChatCapturePayload | undefined) ?? {}
  const mode = String(payload.mode ?? "").trim()

  if (mode === "notebooklm") {
    return mode
  }

  return null
}

export function resolveChatCaptureSuccessMessage(
  response: ChromeMessageResponse<Record<string, unknown>>
): string {
  void response
  return "Conversa enviada para o NotebookLM."
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

  const normalizedPlatform = normalizePlatformLabel(input.platformLabel)
  const fallbackTitle = `Conversa ${normalizedPlatform} - ${new Date().toLocaleDateString("pt-BR")}`
  const resolvedTitle = buildTaggedCaptureTitle(
    normalizedPlatform,
    String(input.title ?? "").trim() || fallbackTitle
  )
  const notebookId = String(input.preferredNotebookId ?? "").trim() || (await resolveDefaultNotebookId())

  const protocolPayload: AppendSourcePayload = {
    notebookId: notebookId ?? undefined,
    sourceTitle: resolvedTitle,
    sourcePlatform: normalizedPlatform,
    conversation,
    capturedFromUrl: input.capturedFromUrl
  }

  try {
    const response = await sendRuntimeMessage("PROTOCOL_APPEND_SOURCE", protocolPayload)

    if (response.success) {
      console.log("[MindDock] Saved successfully to NotebookLM")
      return withCaptureMode(response, "notebooklm")
    }

    const errorMessage = String(response.error ?? "").trim() || "Erro desconhecido ao salvar no NotebookLM."
    console.error(`[MindDock] Import failed: ${errorMessage}`)

    if (typeof alert === "function") {
      alert(`Erro ao salvar no NotebookLM: ${errorMessage}`)
    }

    return response
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Erro inesperado ao salvar no NotebookLM."

    console.error(`[MindDock] Import failed: ${errorMessage}`, error)

    if (typeof alert === "function") {
      alert(`Erro ao salvar no NotebookLM: ${errorMessage}`)
    }

    throw error
  }
}
