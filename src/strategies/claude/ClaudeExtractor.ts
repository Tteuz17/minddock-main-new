export type ClaudeAuthorRole = "USER" | "CLAUDE"

export interface ClaudeExtractedMessage {
  role: ClaudeAuthorRole
  content: string
}

const USER_MESSAGE_SELECTOR = "[data-testid='user-message']"
const ASSISTANT_MESSAGE_SELECTOR = "[data-testid='assistant-message']"
const USER_CLASS_SELECTOR = ".font-user-message"
const ASSISTANT_CLASS_SELECTOR = ".font-claude-response"
const MESSAGE_NODE_SELECTOR = `${USER_MESSAGE_SELECTOR}, ${ASSISTANT_MESSAGE_SELECTOR}, ${USER_CLASS_SELECTOR}, ${ASSISTANT_CLASS_SELECTOR}`
const EXTRACTION_TIMEOUT_MS = 10_000
const HYDRATION_TOP_WAIT_MS = 300
const HYDRATION_BOTTOM_WAIT_MS = 500

const MESSAGE_CONTENT_SELECTOR = [
  "[data-testid='message-content']",
  ".standard-markdown",
  ".message-content",
  ".prose",
  ".markdown",
  "pre",
  "code"
].join(", ")

const IGNORE_SELECTOR = [
  "[aria-label='Ações da mensagem']",
  "[aria-label='Acoes da mensagem']",
  "[aria-label='Message actions']",
  "[data-testid='message-actions']",
  "[data-test-id='message-actions']",
  "[data-testid*='feedback']",
  "[data-test-id*='feedback']",
  "button",
  "[role='button']",
  "svg"
].join(", ")

const ARTIFACT_CONTAINER_SELECTOR = [
  "[data-testid*='artifact']",
  "[data-test-id*='artifact']",
  ".artifact-placeholder",
  ".artifact-container",
  ".artifact",
  "[class*='artifact']"
].join(", ")

const ARTIFACT_CONTENT_SELECTOR = [
  ".artifact-content",
  ".code-block",
  "pre",
  "[data-testid*='artifact-content']",
  "[data-test-id*='artifact-content']"
].join(", ")

const ARTIFACT_TOGGLE_SELECTOR = [
  "button[aria-label*='Show']",
  "button[aria-label*='Expand']",
  "button[aria-label*='View']",
  "button[aria-label*='Open']",
  "[data-testid*='artifact-toggle']",
  "[data-test-id*='artifact-toggle']",
  "div[role='button']",
  "button"
].join(", ")

const TITLE_SELECTOR = [
  "[data-testid='conversation-title']",
  "[data-test-id='conversation-title']",
  "[data-testid^='chat-title-'] .truncate.font-base-bold",
  "[data-testid^='chat-title-'] .truncate",
  "header [data-testid^='chat-title-']",
  "header h1",
  "header [role='heading']"
].join(", ")

const USER_CONTEXT_SELECTOR = [
  ".text-text-500",
  ".text-xs",
  ".text-text-tertiary",
  ".text-xs.text-text-tertiary",
  "div.flex-col.items-end .text-text-500",
  "div.flex-col.items-end .text-xs",
  "div.flex-col.items-end [class*='text-text-tertiary']"
].join(", ")

const LONG_ARTIFACT_LIMIT = 10_000

function normalizeText(value: string): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(() => resolve(), ms)
  })
}

async function ensureDomLoaded(): Promise<void> {
  window.scrollTo(0, 0)
  await sleep(HYDRATION_TOP_WAIT_MS)
  window.scrollTo(0, document.body.scrollHeight)
  await sleep(HYDRATION_BOTTOM_WAIT_MS)
}

function removeIgnoredNodes(root: ParentNode): void {
  root.querySelectorAll(IGNORE_SELECTOR).forEach((node) => node.remove())
}

function extractNodeText(node: Element): string {
  const clone = node.cloneNode(true) as HTMLElement
  removeIgnoredNodes(clone)
  return normalizeText(clone.innerText ?? clone.textContent ?? "")
}

function isLikelyUserContextText(value: string): boolean {
  const text = normalizeText(value)
  if (!text) {
    return false
  }

  return (
    /\banalisando\b/i.test(text) ||
    /\bupload\b/i.test(text) ||
    /\btools?\s+called\b/i.test(text) ||
    /\bprocessando\b/i.test(text) ||
    /\bprocessing\b/i.test(text) ||
    /\bcarregando\b/i.test(text) ||
    /\bgerando\b/i.test(text)
  )
}

function hasUserContextClass(node: Element): boolean {
  const className = String((node as HTMLElement).className ?? "").toLowerCase()
  return (
    className.includes("text-text-500") ||
    className.includes("text-xs") ||
    className.includes("text-text-tertiary")
  )
}

function isUserContextNode(node: Element): boolean {
  const text = normalizeText(node.textContent ?? "")
  if (!text) {
    return false
  }

  const alignedRight = node.closest("div.flex-col.items-end") !== null
  const contextClass = hasUserContextClass(node)

  if (alignedRight && (contextClass || isLikelyUserContextText(text))) {
    return true
  }

  if (contextClass && isLikelyUserContextText(text)) {
    return true
  }

  return /\[\s*\d+\s+tools?\s+called\]/i.test(text)
}

function getMessageRole(node: Element): ClaudeAuthorRole {
  if (node.matches(USER_MESSAGE_SELECTOR) || node.matches(USER_CLASS_SELECTOR)) {
    return "USER"
  }

  if (node.matches(ASSISTANT_MESSAGE_SELECTOR) || node.matches(ASSISTANT_CLASS_SELECTOR)) {
    return "CLAUDE"
  }

  const testId = String(node.getAttribute("data-testid") ?? "").toLowerCase()
  if (testId.includes("assistant")) {
    return "CLAUDE"
  }

  if (testId.includes("user")) {
    return "USER"
  }

  const author = String(node.getAttribute("data-author") ?? "").toLowerCase()
  if (author.includes("user")) {
    return "USER"
  }

  const authorRole = String(node.getAttribute("data-author-role") ?? "").toLowerCase()
  if (authorRole.includes("user")) {
    return "USER"
  }

  return "CLAUDE"
}

function isLeafMessageNode(node: Element): boolean {
  for (const childMessage of Array.from(node.querySelectorAll(MESSAGE_NODE_SELECTOR))) {
    if (childMessage !== node) {
      return false
    }
  }

  return true
}

function getMessageNodes(): Element[] {
  const directMessageNodes = Array.from(document.querySelectorAll(MESSAGE_NODE_SELECTOR)).filter(
    isLeafMessageNode
  )
  if (directMessageNodes.length > 0) {
    return directMessageNodes
  }

  const conversationalTurns = Array.from(document.querySelectorAll("conversational-turn"))
  if (conversationalTurns.length > 0) {
    const turnMessages: Element[] = []

    for (const turn of conversationalTurns) {
      const userMessage = turn.querySelector(USER_MESSAGE_SELECTOR)
      if (userMessage) {
        turnMessages.push(userMessage)
      }

      const assistantMessage = turn.querySelector(ASSISTANT_MESSAGE_SELECTOR)
      if (assistantMessage) {
        turnMessages.push(assistantMessage)
      }
    }

    if (turnMessages.length > 0) {
      return turnMessages
    }
  }

  const selectors = [
    "[data-testid='chat-message']",
    ".font-claude-message",
    ".font-claude-response",
    ".font-user-message",
    "div.grid.gap-2 > div.flex"
  ] as const

  for (const selector of selectors) {
    const nodes = Array.from(document.querySelectorAll(selector)).filter((candidate) => {
      if (candidate.matches(MESSAGE_NODE_SELECTOR)) {
        return true
      }

      const nestedMessages = candidate.querySelectorAll(MESSAGE_NODE_SELECTOR)
      return nestedMessages.length === 0
    })

    if (nodes.length > 2) {
      return nodes
    }
  }

  const fallbackNodes = Array.from(
    document.querySelectorAll(".font-claude-response, .font-user-message, .font-claude-message")
  )
  if (fallbackNodes.length > 0) {
    return fallbackNodes
  }

  return Array.from(document.querySelectorAll(MESSAGE_NODE_SELECTOR))
}

function resolveArtifactContentNode(container: Element): HTMLElement | null {
  const node = container.querySelector(ARTIFACT_CONTENT_SELECTOR)
  return node instanceof HTMLElement ? node : null
}

function detectArtifactLanguage(container: Element, contentNode: Element): string {
  const candidates = [
    container.getAttribute("data-type"),
    container.getAttribute("data-language"),
    contentNode.getAttribute("data-language"),
    contentNode.getAttribute("data-lang"),
    contentNode.getAttribute("language")
  ]

  for (const candidate of candidates) {
    const normalized = normalizeText(String(candidate ?? ""))
    if (normalized) {
      return normalized.replace(/[^a-z0-9_+-]/gi, "")
    }
  }

  const classTokens = [
    ...(container.className || "").toString().split(/\s+/),
    ...(contentNode.className || "").toString().split(/\s+/)
  ].map((token) => token.toLowerCase())

  if (classTokens.some((token) => token.includes("json"))) {
    return "json"
  }

  if (classTokens.some((token) => token.includes("python"))) {
    return "python"
  }

  if (classTokens.some((token) => token.includes("javascript") || token.includes("js"))) {
    return "javascript"
  }

  if (classTokens.some((token) => token.includes("html"))) {
    return "html"
  }

  if (classTokens.some((token) => token.includes("markdown"))) {
    return "markdown"
  }

  return "text"
}

function isLikelyArtifactToggle(element: Element): boolean {
  const label = normalizeText(
    [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.textContent
    ]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase()

  if (!label) {
    return false
  }

  return (
    label.includes("show") ||
    label.includes("expand") ||
    label.includes("view") ||
    label.includes("open") ||
    label.includes("mostrar") ||
    label.includes("ver")
  )
}

function isMessageNode(node: Element): boolean {
  return (
    node.matches(MESSAGE_NODE_SELECTOR) ||
    node.matches("[data-testid='chat-message']") ||
    node.matches(".font-claude-response") ||
    node.matches(".font-user-message") ||
    node.matches(".font-claude-message")
  )
}

function collectArtifactContainers(messageNode: Element): Element[] {
  const containers: Element[] = []
  const seen = new Set<Element>()

  const append = (candidate: Element | null): void => {
    if (!candidate || seen.has(candidate)) {
      return
    }

    seen.add(candidate)
    containers.push(candidate)
  }

  for (const item of Array.from(messageNode.querySelectorAll(ARTIFACT_CONTAINER_SELECTOR))) {
    append(item)
  }

  const nextSibling = messageNode.nextElementSibling
  if (nextSibling && !isMessageNode(nextSibling)) {
    if (nextSibling.matches(ARTIFACT_CONTAINER_SELECTOR)) {
      append(nextSibling)
    }

    for (const item of Array.from(nextSibling.querySelectorAll(ARTIFACT_CONTAINER_SELECTOR))) {
      append(item)
    }
  }

  return containers
}

async function waitForArtifactContent(
  container: Element,
  retries = 10
): Promise<HTMLElement | null> {
  const selector = [
    ".code-block__code",
    ".prose",
    ".markdown-body",
    ".artifact-content",
    ".code-block",
    "pre"
  ].join(", ")

  for (let index = 0; index < retries; index += 1) {
    const node = container.querySelector(selector)
    if (node instanceof HTMLElement && normalizeText(node.innerText ?? "").length > 5) {
      return node
    }

    await sleep(100)
  }

  return null
}

async function tryExpandArtifact(container: Element): Promise<void> {
  try {
    const toggleCandidates = Array.from(
      container.querySelectorAll(ARTIFACT_TOGGLE_SELECTOR)
    ).filter(isLikelyArtifactToggle)

    if (toggleCandidates.length === 0) {
      if (container.matches("button, [role='button']")) {
        ;(container as HTMLElement).click()
        await sleep(100)
      }
      return
    }

    const toggle = toggleCandidates[0] as HTMLElement
    toggle.click()
    await sleep(100)
  } catch {
    // Ignore expansion failures and continue with fallback.
  }
}

export async function extractArtifactContent(artifactContainer: Element): Promise<string> {
  let contentNode = resolveArtifactContentNode(artifactContainer)
  if (!contentNode || normalizeText(contentNode.innerText ?? "").length <= 5) {
    try {
      await tryExpandArtifact(artifactContainer)
    } catch {
      // Continue with polling/fallback.
    }

    const polledContentNode = await waitForArtifactContent(artifactContainer, 10)
    if (polledContentNode) {
      contentNode = polledContentNode
    } else if (!contentNode) {
      contentNode = resolveArtifactContentNode(artifactContainer)
    }
  }

  if (!contentNode) {
    const fallbackTitle = normalizeText(extractNodeText(artifactContainer))
    return `\n> [Artefato: ${fallbackTitle || "Sem titulo"} - Nao foi possivel expandir automaticamente]\n`
  }

  const rawContent = normalizeText(extractNodeText(contentNode))
  if (!rawContent) {
    const fallbackTitle = normalizeText(extractNodeText(artifactContainer))
    return `\n> [Artefato: ${fallbackTitle || "Sem titulo"} - Nao foi possivel expandir automaticamente]\n`
  }

  const language = detectArtifactLanguage(artifactContainer, contentNode) || "text"
  const longContentWarning =
    rawContent.length > LONG_ARTIFACT_LIMIT ? "> [Conteudo Longo Detectado]\n\n" : ""

  return `\n\n${longContentWarning}\`\`\`${language}\n${rawContent}\n\`\`\`\n\n`
}

export async function processArtifacts(messageNode: Element): Promise<string> {
  const containers = collectArtifactContainers(messageNode)
  if (containers.length === 0) {
    return ""
  }

  const chunks: string[] = []
  for (const container of containers) {
    const content = await extractArtifactContent(container)
    if (content) {
      chunks.push(content)
    }
  }

  return chunks.join("")
}

function extractMessageText(messageNode: Element): string {
  const candidates = Array.from(messageNode.querySelectorAll(MESSAGE_CONTENT_SELECTOR))
  if (candidates.length > 0) {
    let bestText = ""
    for (const candidate of candidates) {
      if (isUserContextNode(candidate)) {
        continue
      }

      const text = normalizeText(extractNodeText(candidate))
      if (text.length > bestText.length) {
        bestText = text
      }
    }
    return bestText
  }

  return normalizeText(extractNodeText(messageNode))
}

function collectUserContextBlocks(messageNode: Element): string[] {
  const contexts: string[] = []
  const seen = new Set<string>()
  const candidateNodes: Element[] = []

  candidateNodes.push(...Array.from(messageNode.querySelectorAll(USER_CONTEXT_SELECTOR)))

  const groupNode = messageNode.closest(".group")
  if (groupNode) {
    candidateNodes.push(...Array.from(groupNode.querySelectorAll(USER_CONTEXT_SELECTOR)))
    candidateNodes.push(
      ...Array.from(groupNode.querySelectorAll("div.flex-col.items-end"))
    )
  }

  for (const node of candidateNodes) {
    const text = normalizeText(extractNodeText(node))
    if (!text || text.length <= 5) {
      continue
    }

    if (!isUserContextNode(node) && !isLikelyUserContextText(text)) {
      continue
    }

    const normalized = text.toLowerCase()
    if (seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    contexts.push(text)
  }

  return contexts
}

function extractUserMessage(messageNode: Element): string {
  const mainText = extractMessageText(messageNode)
  const contexts = collectUserContextBlocks(messageNode)

  if (contexts.length === 0) {
    return mainText
  }

  const contextMarkdown = contexts
    .map((entry) => `> ⚙️ [Contexto do Sistema: ${entry}]`)
    .join("\n\n")

  return normalizeText([mainText, contextMarkdown].filter(Boolean).join("\n\n"))
}

function extractClaudeMessage(messageNode: Element): string {
  return extractMessageText(messageNode)
}

async function extractClaudeMessagesInternal(
  target: ClaudeExtractedMessage[]
): Promise<ClaudeExtractedMessage[]> {
  await ensureDomLoaded()
  const messageNodes = getMessageNodes()

  for (const node of messageNodes) {
    const role = getMessageRole(node)
    const text = role === "USER" ? extractUserMessage(node) : extractClaudeMessage(node)

    if (!text) {
      continue
    }

    target.push({
      role,
      content: text
    })
  }

  return target
}

export async function extractClaudeMessages(): Promise<ClaudeExtractedMessage[]> {
  const partialConversation: ClaudeExtractedMessage[] = []

  let timeoutId = 0
  const timeoutPromise = new Promise<ClaudeExtractedMessage[]>((resolve) => {
    timeoutId = window.setTimeout(() => {
      resolve([...partialConversation])
    }, EXTRACTION_TIMEOUT_MS)
  })

  const extractionPromise = extractClaudeMessagesInternal(partialConversation)

  try {
    const result = await Promise.race([extractionPromise, timeoutPromise])
    return result
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId)
    }
  }
}

export function resolveClaudeConversationTitleFromDom(fallbackTitle = ""): string {
  for (const node of Array.from(document.querySelectorAll(TITLE_SELECTOR))) {
    const title = normalizeText(node.textContent ?? "")
    if (title) {
      return title
    }
  }

  const fromDocument = normalizeText(document.title).replace(/\s*-\s*Claude\s*$/i, "").trim()
  return fromDocument || normalizeText(fallbackTitle)
}
