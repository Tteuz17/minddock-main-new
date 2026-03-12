import { captureVisibleMessages, isVisible, queryDeepAll } from "../../../../contents/notebooklm/sourceDom"

export interface ParsedBlock {
  type: "heading" | "paragraph"
  content: string
}

export interface StructuredExtractionOptions {
  includeUserTurns?: boolean
  includeSources?: boolean
}

interface ChatMessageBlock {
  role: "user" | "assistant"
  content: string
  top: number
  left: number
  anchor: HTMLElement
}

interface ConversationTurnRecord {
  top: number
  assistantContent: string
  userContent?: string
}

const ASSISTANT_TURN_SELECTORS = [
  "[data-testid='chat-message-assistant']",
  "[data-testid='response-text']",
  ".response-container .message-content",
  ".response-container"
] as const

const USER_TURN_SELECTORS = [
  "[data-testid='chat-message-user']",
  "[data-testid='user-query']",
  "[data-testid='query-text']",
  ".user-query-text",
  ".query-container .query-text",
  ".query-container"
] as const

const TURN_PAIR_SELECTORS = [".chat-message-pair"] as const

const USER_CONTENT_SELECTORS = [
  ".from-user-container .message-text-content",
  "[data-testid='query-text']",
  "[data-testid='user-query']",
  ".query-container .query-text",
  ".user-query-text"
] as const

const ASSISTANT_CONTENT_SELECTORS = [
  ".to-user-container .message-text-content",
  "[data-testid='response-text']",
  "[data-testid='chat-message-assistant'] [data-testid='response-text']",
  ".response-container .message-content",
  ".response-content"
] as const

const CITATION_MARKER_SELECTORS = [
  "button.citation-marker",
  "button[aria-label*='Source' i]",
  "button[aria-label*='Fonte' i]",
  "[data-testid*='citation' i]",
  "[class*='citation-marker']"
] as const

const SOURCE_TOKEN_REGEX = /\[(?:source|fonte)\s*:\s*([^\]]+)\]/gi
const BAD_SOURCE_NAMES_REGEX = /^(video_audio_call|video_youtube|article|drive_presentation|web|text|pdf)$/i
const GENERIC_CITATION_LABEL_REGEX = /^(source|fonte|citation|citacao|citar|reference|referencia)\s*[:#-]?\s*\d*\s*$/i

const CONTROL_TEXT_DICTIONARY = new Set([
  "carregando",
  "loading",
  "resultados da pesquisa",
  "nenhum emoji encontrado",
  "copy_all",
  "thumb_up",
  "thumb_down",
  "edit",
  "more_vert",
  "keep_pin",
  "share"
])

function normalizeSourceLookupKey(valueRaw: string): string {
  return String(valueRaw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s[\](){}`"'“”‘’#]+|[\s[\](){}`"'“”‘’#]+$/g, "")
    .trim()
}

function sanitizeCitationCandidate(value: unknown): string {
  const cleaned = String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:;,.()[\]{}"'`]+|[\s:;,.()[\]{}"'`]+$/g, "")
    .trim()
  if (!cleaned || cleaned.length > 180) {
    return ""
  }
  return cleaned
}

function isLikelyGenericCitationLabel(value: string): boolean {
  const normalized = normalizeSourceLookupKey(value)
  if (!normalized) {
    return true
  }
  if (/^\d{1,4}$/.test(normalized)) {
    return false
  }
  if (GENERIC_CITATION_LABEL_REGEX.test(normalized)) {
    return true
  }
  if (/^(source|fonte)\s+\d{1,4}$/.test(normalized)) {
    return true
  }
  if (BAD_SOURCE_NAMES_REGEX.test(normalized)) {
    return true
  }
  return false
}

function resolveCitationLabel(marker: HTMLElement): string {
  const candidates: string[] = []
  const pushCandidate = (value: unknown): void => {
    const cleaned = sanitizeCitationCandidate(value)
    if (cleaned) {
      candidates.push(cleaned)
    }
  }

  const descendants = Array.from(
    marker.querySelectorAll<HTMLElement>("[aria-label], [title], [data-source-title], [data-source-name], span, div, a")
  )
  for (const descendant of descendants) {
    pushCandidate(descendant.getAttribute("data-source-title"))
    pushCandidate(descendant.getAttribute("data-source-name"))
    pushCandidate(descendant.getAttribute("aria-label"))
    pushCandidate(descendant.getAttribute("title"))
    pushCandidate(descendant.textContent)
  }

  pushCandidate(marker.getAttribute("data-source-title"))
  pushCandidate(marker.getAttribute("data-source-name"))
  pushCandidate(marker.getAttribute("aria-label"))
  pushCandidate(marker.getAttribute("title"))
  pushCandidate(marker.textContent)

  for (const candidate of candidates) {
    if (!isLikelyGenericCitationLabel(candidate)) {
      return candidate
    }
  }

  return candidates[0] ?? ""
}

function resolveElementReadableText(node: HTMLElement): string {
  return String(node.innerText || node.textContent || "").trim()
}

function resolveAssistantTextWithSourceTokens(node: HTMLElement): string {
  const clone = node.cloneNode(true) as HTMLElement
  const selector = CITATION_MARKER_SELECTORS.join(", ")
  for (const marker of Array.from(clone.querySelectorAll<HTMLElement>(selector))) {
    const label = resolveCitationLabel(marker)
    if (!label) {
      marker.remove()
      continue
    }
    marker.replaceWith(document.createTextNode(` [Source: ${label}] `))
  }

  return resolveElementReadableText(clone)
}

function normalizeTurnContent(rawValue: string, includeSources: boolean): string {
  let value = String(rawValue ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  if (!includeSources) {
    value = value
      .replace(/\[\d{1,3}\]/g, "")
      .replace(/\[source:[^\]]+\]/gi, "")
      .replace(/\[fonte:[^\]]+\]/gi, "")
      .replace(/(?:^|\n)\s*fonte(?:s)?\s*:\s*.+$/gim, "")
      .replace(/(?:^|\n)\s*\d+\s+fontes?\b.*$/gim, "")
      .replace(SOURCE_TOKEN_REGEX, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  }

  return value
}

function normalizeNoiseToken(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function isNoiseOnlyContent(value: string): boolean {
  const token = normalizeNoiseToken(value)
  if (!token) {
    return true
  }
  return CONTROL_TEXT_DICTIONARY.has(token)
}

function resolveFirstVisibleDescendant(root: HTMLElement, selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    if (root.matches(selector) && isVisible(root)) {
      return root
    }

    const candidate = root.querySelector<HTMLElement>(selector)
    if (candidate instanceof HTMLElement && isVisible(candidate)) {
      return candidate
    }
  }

  return null
}

function resolveRoleAnchorNode(node: HTMLElement, role: "user" | "assistant"): HTMLElement {
  const roleAnchorSelector =
    role === "assistant"
      ? "[data-testid='chat-message-assistant'], model-response, .response-container, [data-testid='response-text']"
      : "[data-testid='chat-message-user'], user-query, .query-container, [data-testid='user-query'], [data-testid='query-text']"

  const closestAnchor = node.closest(roleAnchorSelector)
  if (closestAnchor instanceof HTMLElement) {
    return closestAnchor
  }

  return node
}

function resolveAnchorRawText(anchor: HTMLElement, role: "user" | "assistant"): string {
  const selectors =
    role === "assistant"
      ? [
          "[data-testid='response-text']",
          ".model-response-text",
          ".response-container .message-content",
          ".response-content",
          "[class*='markdown']"
        ]
      : [
          "[data-testid='query-text']",
          "[data-testid='user-query']",
          ".query-container .query-text",
          ".user-query-text",
          "[class*='query-text']"
        ]

  for (const selector of selectors) {
    const candidate = anchor.querySelector<HTMLElement>(selector)
    if (!(candidate instanceof HTMLElement) || !isVisible(candidate)) {
      continue
    }
    const text =
      role === "assistant"
        ? resolveAssistantTextWithSourceTokens(candidate)
        : String(candidate.innerText || candidate.textContent || "").trim()
    if (text) {
      return text
    }
  }

  return role === "assistant" ? resolveAssistantTextWithSourceTokens(anchor) : String(anchor.innerText || anchor.textContent || "")
}

function collectTurnRecordsFromPairs(includeSources: boolean): ConversationTurnRecord[] {
  const turns: ConversationTurnRecord[] = []

  for (const pair of queryDeepAll<HTMLElement>(TURN_PAIR_SELECTORS)) {
    if (!(pair instanceof HTMLElement) || !isVisible(pair)) {
      continue
    }
    if (pair.closest("#minddock-conversation-export-root")) {
      continue
    }

    const assistantNode = resolveFirstVisibleDescendant(pair, ASSISTANT_CONTENT_SELECTORS)
    if (!(assistantNode instanceof HTMLElement)) {
      continue
    }

    const assistantContent = normalizeTurnContent(resolveAssistantTextWithSourceTokens(assistantNode), includeSources)
    if (!assistantContent || isNoiseOnlyContent(assistantContent)) {
      continue
    }

    const userNode = resolveFirstVisibleDescendant(pair, USER_CONTENT_SELECTORS)
    const userContent = userNode ? normalizeTurnContent(resolveElementReadableText(userNode), true) : ""
    const rect = pair.getBoundingClientRect()

    turns.push({
      top: rect.top,
      assistantContent,
      userContent: userContent || undefined
    })
  }

  return turns.sort((left, right) => left.top - right.top)
}

function collectMessageBlocks(includeSources: boolean): ChatMessageBlock[] {
  const blocks: ChatMessageBlock[] = []
  const seenAnchors = new Set<HTMLElement>()

  const collectByRole = (selectors: readonly string[], role: "user" | "assistant"): void => {
    for (const node of queryDeepAll<HTMLElement>(selectors)) {
      if (!(node instanceof HTMLElement) || !isVisible(node)) {
        continue
      }
      if (node.closest("#minddock-conversation-export-root")) {
        continue
      }

      const anchor = resolveRoleAnchorNode(node, role)
      if (!isVisible(anchor) || seenAnchors.has(anchor)) {
        continue
      }

      const rawText =
        role === "assistant"
          ? resolveAssistantTextWithSourceTokens(node) || resolveAnchorRawText(anchor, role)
          : resolveAnchorRawText(anchor, role)
      const content = normalizeTurnContent(rawText, includeSources)
      if (!content || isNoiseOnlyContent(content)) {
        continue
      }

      seenAnchors.add(anchor)
      const rect = anchor.getBoundingClientRect()
      blocks.push({
        role,
        content,
        top: rect.top,
        left: rect.left,
        anchor
      })
    }
  }

  collectByRole(USER_TURN_SELECTORS, "user")
  collectByRole(ASSISTANT_TURN_SELECTORS, "assistant")
  return blocks
}

function resolveConversationTurnRecords(includeSources: boolean): ConversationTurnRecord[] {
  const pairTurns = collectTurnRecordsFromPairs(includeSources)
  if (pairTurns.length > 0) {
    return pairTurns
  }

  const blocks = collectMessageBlocks(includeSources)
  const orderedBlocks = blocks.sort((left, right) => {
    if (Math.abs(left.top - right.top) <= 6) {
      return left.left - right.left
    }
    return left.top - right.top
  })

  const turns: ConversationTurnRecord[] = []
  let pendingUser: ChatMessageBlock | null = null
  for (const block of orderedBlocks) {
    if (block.role === "user") {
      pendingUser = block
      continue
    }

    turns.push({
      top: block.top,
      assistantContent: block.content,
      userContent: pendingUser?.content
    })
    pendingUser = null
  }

  if (turns.length > 0) {
    return turns
  }

  const fallbackMessages = captureVisibleMessages()
    .map((message) => ({
      ...message,
      content: normalizeTurnContent(message.content, includeSources)
    }))
    .filter((message) => message.content.length > 0 && !isNoiseOnlyContent(message.content))

  const fallbackTurns: ConversationTurnRecord[] = []
  let pendingFallbackUser: string | null = null
  let fallbackIndex = 0
  for (const message of fallbackMessages) {
    if (message.role === "user") {
      pendingFallbackUser = message.content
      continue
    }

    fallbackIndex += 1
    fallbackTurns.push({
      top: fallbackIndex * 100,
      assistantContent: message.content,
      userContent: pendingFallbackUser ?? undefined
    })
    pendingFallbackUser = null
  }

  return fallbackTurns
}

function splitIntoParagraphs(rawValue: string): string[] {
  const normalized = normalizeTurnContent(rawValue, true)
  if (!normalized) {
    return []
  }

  const segments = normalized
    .split(/\n{2,}/g)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)

  return segments.length > 0 ? segments : [normalized]
}

function buildParsedBlocks(
  turns: readonly ConversationTurnRecord[],
  options: Required<StructuredExtractionOptions>
): ParsedBlock[] {
  const orderedTurns = [...turns].sort((left, right) => left.top - right.top)
  const blocks: ParsedBlock[] = []

  for (const turn of orderedTurns) {
    const cleanUserTurn = normalizeTurnContent(String(turn.userContent ?? ""), true)
    if (options.includeUserTurns && cleanUserTurn && !isNoiseOnlyContent(cleanUserTurn)) {
      blocks.push({
        type: "heading",
        content: cleanUserTurn
      })
    }

    const assistantParagraphs = splitIntoParagraphs(turn.assistantContent)
    for (const paragraph of assistantParagraphs) {
      if (!paragraph || isNoiseOnlyContent(paragraph)) {
        continue
      }
      blocks.push({
        type: "paragraph",
        content: paragraph
      })
    }
  }

  return blocks
}

export function extractChatAsStructuredData(options: StructuredExtractionOptions = {}): ParsedBlock[] {
  const normalizedOptions: Required<StructuredExtractionOptions> = {
    includeUserTurns: options.includeUserTurns ?? true,
    includeSources: options.includeSources ?? false
  }

  try {
    const turns = resolveConversationTurnRecords(normalizedOptions.includeSources)
    if (turns.length === 0) {
      return []
    }

    return buildParsedBlocks(turns, normalizedOptions)
  } catch (error) {
    console.error("[MindDock] Falha ao estruturar chat para Notion", error)
    return []
  }
}
