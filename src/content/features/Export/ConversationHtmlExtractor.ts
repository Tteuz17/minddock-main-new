import { isVisible, queryDeepAll } from "../../../../contents/notebooklm/sourceDom"

type ConversationRole = "user" | "assistant"

interface SanitizedNodePayload {
  text: string
  html: string
  hasStructuredHtml: boolean
}

interface MessageBlock {
  role: ConversationRole
  top: number
  left: number
  payload: SanitizedNodePayload
}

interface ResearchTurn {
  top: number
  promptText?: string
  answerHtml: string
  answerText: string
}

const TURN_PAIR_SELECTORS = [".chat-message-pair"] as const

const USER_TURN_SELECTORS = [
  "[data-testid='chat-message-user']",
  "[data-testid='user-query']",
  "[data-testid='query-text']",
  ".user-query-text",
  ".query-container .query-text",
  ".query-container"
] as const

const ASSISTANT_TURN_SELECTORS = [
  "[data-testid='chat-message-assistant']",
  "[data-testid='response-text']",
  ".response-container .message-content",
  ".response-container"
] as const

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

const CHAT_CONTAINER_SCAN_SELECTORS = [
  "main [data-testid='response-text']",
  "main [data-testid='query-text']",
  "main p",
  "main ul",
  "[role='log'] p",
  "[role='log'] ul"
] as const

const INTERNAL_EXTENSION_ROOT_SELECTOR =
  "#minddock-conversation-export-root, #minddock-source-actions-root, #minddock-source-filters-root, [data-minddock-target]"

const UI_ARTIFACT_SELECTOR =
  "button, svg, img, i, mat-icon, .material-icons, [role='button'], [aria-hidden='true'], script, style, iframe"

const NOISE_TEXT_TOKENS = new Set([
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
  "share",
  "copiar",
  "copy",
  "save to note",
  "salvar na nota",
  "salvar na nota e conversar"
])

function normalizeToken(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeInlineText(value: string): string {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function isDiscardableControlText(value: string): boolean {
  const normalized = normalizeToken(value)
  if (!normalized) {
    return true
  }
  return NOISE_TEXT_TOKENS.has(normalized)
}

function purgeUiArtifacts(nodeSanitizer: HTMLElement): void {
  for (const artifactNode of Array.from(nodeSanitizer.querySelectorAll<HTMLElement>(UI_ARTIFACT_SELECTOR))) {
    artifactNode.remove()
  }

  for (const candidateNode of Array.from(nodeSanitizer.querySelectorAll<HTMLElement>("*"))) {
    const token = normalizeToken(candidateNode.textContent ?? "")
    if (!token) {
      continue
    }

    if (NOISE_TEXT_TOKENS.has(token)) {
      candidateNode.remove()
      continue
    }

    if (
      token === "copy all" ||
      token === "thumb up" ||
      token === "thumb down" ||
      token === "keep pin" ||
      token === "more vert"
    ) {
      candidateNode.remove()
    }
  }
}

function extractSanitizedPayload(sourceNode: HTMLElement): SanitizedNodePayload | null {
  const nodeSanitizer = sourceNode.cloneNode(true) as HTMLElement
  purgeUiArtifacts(nodeSanitizer)

  const plainText = normalizeInlineText(nodeSanitizer.innerText || nodeSanitizer.textContent || "")
  const htmlMarkup = String(nodeSanitizer.innerHTML ?? "").trim()

  if (isDiscardableControlText(plainText)) {
    return null
  }

  const hasStructuredHtml = /<(p|ul|ol|li|blockquote|pre|code|table|h1|h2|h3|h4|h5|h6)\b/i.test(htmlMarkup)
  const safeHtml = htmlMarkup || (plainText ? `<p>${escapeHtml(plainText)}</p>` : "")

  if (!plainText && !safeHtml) {
    return null
  }

  return {
    text: plainText,
    html: safeHtml,
    hasStructuredHtml
  }
}

function resolveRoleAnchorNode(node: HTMLElement, role: ConversationRole): HTMLElement {
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

function resolveFirstVisibleDescendant(rootNode: HTMLElement, selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    if (rootNode.matches(selector) && isVisible(rootNode)) {
      return rootNode
    }

    const candidateNode = rootNode.querySelector<HTMLElement>(selector)
    if (candidateNode instanceof HTMLElement && isVisible(candidateNode)) {
      return candidateNode
    }
  }

  return null
}

function isBlockedByInjectedUi(element: HTMLElement): boolean {
  return !!element.closest(INTERNAL_EXTENSION_ROOT_SELECTOR)
}

function collectTurnsFromKnownPairs(): ResearchTurn[] {
  const collectedTurns: ResearchTurn[] = []

  for (const pairNode of queryDeepAll<HTMLElement>(TURN_PAIR_SELECTORS)) {
    if (!(pairNode instanceof HTMLElement) || !isVisible(pairNode)) {
      continue
    }
    if (isBlockedByInjectedUi(pairNode)) {
      continue
    }

    const assistantNode = resolveFirstVisibleDescendant(pairNode, ASSISTANT_CONTENT_SELECTORS)
    if (!(assistantNode instanceof HTMLElement)) {
      continue
    }

    const assistantPayload = extractSanitizedPayload(assistantNode)
    if (!assistantPayload || !assistantPayload.text) {
      continue
    }

    const userNode = resolveFirstVisibleDescendant(pairNode, USER_CONTENT_SELECTORS)
    const userPayload = userNode ? extractSanitizedPayload(userNode) : null
    const pairRect = pairNode.getBoundingClientRect()

    collectedTurns.push({
      top: pairRect.top,
      promptText: userPayload?.text || undefined,
      answerHtml: assistantPayload.html,
      answerText: assistantPayload.text
    })
  }

  return collectedTurns.sort((left, right) => left.top - right.top)
}

function collectRoleBasedMessageBlocks(roleSelectors: readonly string[], role: ConversationRole): MessageBlock[] {
  const roleBlocks: MessageBlock[] = []
  const seenAnchors = new Set<HTMLElement>()

  for (const roleNode of queryDeepAll<HTMLElement>(roleSelectors)) {
    if (!(roleNode instanceof HTMLElement) || !isVisible(roleNode)) {
      continue
    }
    if (isBlockedByInjectedUi(roleNode)) {
      continue
    }

    const roleAnchor = resolveRoleAnchorNode(roleNode, role)
    if (!isVisible(roleAnchor) || seenAnchors.has(roleAnchor)) {
      continue
    }

    const payload = extractSanitizedPayload(role === "assistant" ? roleNode : roleAnchor)
    if (!payload || !payload.text) {
      continue
    }

    seenAnchors.add(roleAnchor)
    const anchorRect = roleAnchor.getBoundingClientRect()
    roleBlocks.push({
      role,
      top: anchorRect.top,
      left: anchorRect.left,
      payload
    })
  }

  return roleBlocks
}

function collectTurnsFromRoleBlocks(): ResearchTurn[] {
  const combinedBlocks = [
    ...collectRoleBasedMessageBlocks(USER_TURN_SELECTORS, "user"),
    ...collectRoleBasedMessageBlocks(ASSISTANT_TURN_SELECTORS, "assistant")
  ]
    .sort((left, right) => {
      if (Math.abs(left.top - right.top) <= 6) {
        return left.left - right.left
      }
      return left.top - right.top
    })

  const resolvedTurns: ResearchTurn[] = []
  let pendingPrompt: string | undefined

  for (const block of combinedBlocks) {
    if (block.role === "user") {
      pendingPrompt = block.payload.text
      continue
    }

    resolvedTurns.push({
      top: block.top,
      promptText: pendingPrompt,
      answerHtml: block.payload.html,
      answerText: block.payload.text
    })
    pendingPrompt = undefined
  }

  return resolvedTurns
}

function countDescendantMatches(containerNode: HTMLElement, candidates: readonly HTMLElement[]): number {
  let count = 0
  for (const candidate of candidates) {
    if (containerNode.contains(candidate)) {
      count += 1
    }
  }
  return count
}

function findChatRootNode(): HTMLElement | null {
  const chatDomNodes = queryDeepAll<HTMLElement>(CHAT_CONTAINER_SCAN_SELECTORS).filter((node) => {
    if (!(node instanceof HTMLElement) || !isVisible(node)) {
      return false
    }
    if (isBlockedByInjectedUi(node)) {
      return false
    }

    const normalizedText = normalizeInlineText(node.innerText || node.textContent || "")
    return normalizedText.length > 0
  })

  if (chatDomNodes.length === 0) {
    return null
  }

  const ancestorScores = new Map<HTMLElement, number>()

  for (const node of chatDomNodes.slice(0, 120)) {
    let currentAncestor = node.parentElement
    let depth = 0
    while (currentAncestor && currentAncestor !== document.body && depth < 10) {
      if (isBlockedByInjectedUi(currentAncestor)) {
        break
      }
      const score = Math.max(1, 12 - depth)
      ancestorScores.set(currentAncestor, (ancestorScores.get(currentAncestor) ?? 0) + score)
      currentAncestor = currentAncestor.parentElement
      depth += 1
    }
  }

  let bestCandidate: HTMLElement | null = null
  let bestScore = -1
  const minimumDescendantHits = Math.max(2, Math.floor(chatDomNodes.length * 0.22))

  for (const [candidateNode, score] of ancestorScores.entries()) {
    if (!isVisible(candidateNode)) {
      continue
    }

    const descendantHits = countDescendantMatches(candidateNode, chatDomNodes)
    if (descendantHits < minimumDescendantHits) {
      continue
    }

    const hasEnoughChildren = candidateNode.children.length >= 2
    if (!hasEnoughChildren) {
      continue
    }

    const combinedScore = score + descendantHits * 8
    if (combinedScore > bestScore) {
      bestScore = combinedScore
      bestCandidate = candidateNode
    }
  }

  return bestCandidate
}

function collectTurnsFromCommonAncestorFallback(): ResearchTurn[] {
  const chatContainer = findChatRootNode()
  if (!(chatContainer instanceof HTMLElement)) {
    return []
  }

  const childNodes = Array.from(chatContainer.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && isVisible(child) && !isBlockedByInjectedUi(child)
  )

  const fallbackTurns: ResearchTurn[] = []
  let pendingPrompt: string | undefined

  for (const childNode of childNodes) {
    const payload = extractSanitizedPayload(childNode)
    if (!payload || !payload.text) {
      continue
    }

    const looksLikePrompt = !payload.hasStructuredHtml
    if (looksLikePrompt) {
      pendingPrompt = payload.text
      continue
    }

    const nodeRect = childNode.getBoundingClientRect()
    fallbackTurns.push({
      top: nodeRect.top,
      promptText: pendingPrompt,
      answerHtml: payload.html,
      answerText: payload.text
    })
    pendingPrompt = undefined
  }

  return fallbackTurns
}

function formatPromptHeading(promptText: string): string {
  const cleanPrompt = normalizeInlineText(promptText)
  if (!cleanPrompt) {
    return ""
  }

  return `<h2 style="font-family: Arial, sans-serif; font-size: 13pt; color: #444; margin-top: 32px; border-bottom: 1px solid #eee; padding-bottom: 8px;"><strong>Pergunta:</strong> <span style="font-weight: normal;">${escapeHtml(cleanPrompt)}</span></h2>`
}

function formatAnswerSection(answerHtml: string): string {
  const cleanHtml = String(answerHtml ?? "").trim()
  if (!cleanHtml) {
    return ""
  }

  return `<div style="font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.6; color: #000; margin-bottom: 24px;">${cleanHtml}</div>`
}

function buildResearchArticleBody(turns: readonly ResearchTurn[]): string {
  if (turns.length === 0) {
    return '<p style="font-family: Arial, sans-serif; font-size: 11pt; color: #333;">Nao foi possivel extrair conteudo do bate-papo.</p>'
  }

  const orderedTurns = [...turns].sort((left, right) => left.top - right.top)
  let htmlResult = ""

  for (const turn of orderedTurns) {
    if (turn.promptText) {
      htmlResult += formatPromptHeading(turn.promptText)
    }
    htmlResult += formatAnswerSection(turn.answerHtml)
  }

  if (!normalizeInlineText(htmlResult.replace(/<[^>]+>/g, " "))) {
    return '<p style="font-family: Arial, sans-serif; font-size: 11pt; color: #333;">Nao foi possivel extrair conteudo do bate-papo.</p>'
  }

  return htmlResult
}

function wrapResearchDocument(researchDocPayload: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><div style="max-width: 860px; margin: 0 auto;"><h1 style="font-family: Arial, sans-serif; font-size: 18pt; color: #000; text-align: center; margin-bottom: 24px;">Documento de Pesquisa</h1><hr style="border: 0; border-bottom: 1px solid #ccc; margin-bottom: 24px;" />${researchDocPayload}</div></body></html>`
}

function collectExportTurns(): ResearchTurn[] {
  const pairTurns = collectTurnsFromKnownPairs()
  if (pairTurns.length > 0) {
    return pairTurns
  }

  const roleTurns = collectTurnsFromRoleBlocks()
  if (roleTurns.length > 0) {
    return roleTurns
  }

  return collectTurnsFromCommonAncestorFallback()
}

export function extractCurrentChatAsHtml(): string {
  try {
    const extractedTurns = collectExportTurns()
    const researchDocumentPayload = buildResearchArticleBody(extractedTurns)
    return wrapResearchDocument(researchDocumentPayload)
  } catch (error) {
    console.error("[MindDock] Falha ao extrair HTML do bate-papo para Google Docs", error)
    return wrapResearchDocument(
      '<p style="font-family: Arial, sans-serif; font-size: 11pt; color: #333;">Nao foi possivel extrair conteudo do bate-papo.</p>'
    )
  }
}
