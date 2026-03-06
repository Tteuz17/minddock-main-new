export type GeminiAuthorRole = "USER" | "GEMINI"

export interface GeminiExtractedMessage {
  role: GeminiAuthorRole
  content: string
}

const MESSAGE_CONTENT_SELECTOR = [
  ".message-content",
  ".model-response-text",
  ".response-content",
  "message-content",
  "markdown-renderer",
  ".markdown",
  ".query-content",
  ".query-text",
  "[data-message-content]"
].join(", ")

const IGNORE_SELECTOR = [
  "[aria-label='Ações da mensagem']",
  "[aria-label='Acoes da mensagem']",
  "[aria-label='Message actions']",
  "[data-testid='message-actions']",
  "[data-test-id='message-actions']",
  "[data-testid='feedback-buttons']",
  "[data-test-id='feedback-buttons']",
  "[data-testid*='feedback']",
  "[data-test-id*='feedback']",
  "[data-testid*='action']",
  "[data-test-id*='action']",
  "button",
  "[role='button']",
  "svg"
].join(", ")

const TITLE_SELECTOR = [
  "div.conversation-title.gds-label",
  "div.conversation-title",
  "navigation-drawer .conversation-title",
  "mat-list-item .conversation-title",
  "[data-testid='conversation-title']",
  "[data-test-id='conversation-title']",
  "[data-testid='chat-title']",
  "[data-test-id='chat-title']",
  "nav [aria-current='page']",
  "navigation-drawer [aria-current='page']",
  "main h1",
  "header h1"
].join(", ")

const GENERIC_TITLES = new Set([
  "",
  "conversa",
  "conversas",
  "chat",
  "chats",
  "gemini",
  "gemeos",
  "nova conversa"
])

const DEEP_RESEARCH_BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,ul,ol,pre,blockquote,table"

function normalizeText(value: string): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function normalizeComparable(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[:\s]+/g, " ")
    .trim()
}

function removeIgnoredNodes(container: ParentNode): void {
  container.querySelectorAll(IGNORE_SELECTOR).forEach((node) => node.remove())
}

function extractNodeText(node: Element): string {
  const clone = node.cloneNode(true) as HTMLElement
  removeIgnoredNodes(clone)
  return normalizeText(clone.innerText ?? clone.textContent ?? "")
}

function sanitizeGeminiLine(line: string): string {
  let nextLine = normalizeText(line)
  if (!nextLine) {
    return ""
  }

  // Remove a tradução errada quando vier como label.
  nextLine = nextLine.replace(/^GÊMEOS[:\s-]*/gim, "")

  // Se "GÊMEOS" vier como sujeito, converte para "Gemini".
  if (/^\s*GÊMEOS\s+(?:é|foi|está|esta|pode|vai|deve|responde|explica|sugere)\b/iu.test(nextLine)) {
    nextLine = nextLine.replace(/^\s*GÊMEOS\b/iu, "Gemini")
  }

  nextLine = nextLine
    .replace(/^(O Gemini disse|Resposta do modelo)[:\s]*/gim, "")
    .replace(/^\s*(?:o\s+)?(?:gemini|g(?:e|\u00ea)meos?|modelo)\s*(?:disse|said)?\s*:?\s*/iu, "")
    .replace(/\b(?:Editado|Vers[aã]o preliminar|Ocultar rascunhos)\b/giu, "")
    .trim()

  const comparable = normalizeComparable(nextLine)
  if (
    comparable === "gemini" ||
    comparable === "gemeos" ||
    comparable === "o gemini disse" ||
    comparable === "o gemeos disse" ||
    comparable === "gemini disse" ||
    comparable === "gemeos disse"
  ) {
    return ""
  }

  return nextLine
}

export function textSanitizer(rawText: string): string {
  const normalizedInput = normalizeText(rawText)
  if (!normalizedInput) {
    return ""
  }

  const outputLines: string[] = []
  for (const line of normalizedInput.split("\n")) {
    const sanitizedLine = sanitizeGeminiLine(line)
    if (!sanitizedLine) {
      if (outputLines.length > 0 && outputLines[outputLines.length - 1] !== "") {
        outputLines.push("")
      }
      continue
    }

    outputLines.push(sanitizedLine)
  }

  while (outputLines.length > 0 && outputLines[outputLines.length - 1] === "") {
    outputLines.pop()
  }

  return normalizeText(outputLines.join("\n"))
}

export function sanitizeGeminiText(rawValue: string, role: GeminiAuthorRole): string {
  const sanitized = textSanitizer(rawValue)
  if (!sanitized) {
    return ""
  }

  if (role === "USER") {
    return sanitized
      .replace(/^v(?:o|\u00f3|\u00f4)c(?:e|\u00ea)\s+disse[:\s-]*/iu, "")
      .replace(/^you said[:\s-]*/i, "")
      .trim()
  }

  return sanitized
    .replace(/^mostrar\s+racioc[ií]nio[\s\S]*?o\s+gemini\s+disse[:\s-]*/iu, "")
    .replace(/^show\s+thinking[\s\S]*?gemini\s+said[:\s-]*/iu, "")
    .replace(/^o\s+gemini\s+disse[:\s-]*/iu, "")
    .replace(/^gemini\s+said[:\s-]*/iu, "")
    .trim()
}

function getCandidateContentNodes(container: Element): Element[] {
  const nodes = Array.from(container.querySelectorAll(MESSAGE_CONTENT_SELECTOR))
  if (nodes.length > 0) {
    return nodes
  }

  return [container]
}

export function resolveGeminiRoleForNode(node: Element): GeminiAuthorRole {
  return node.closest("user-query") ? "USER" : "GEMINI"
}

export function extractGeminiMessageText(node: Element, role: GeminiAuthorRole): string {
  const candidateNodes = getCandidateContentNodes(node)
  let bestContent = ""

  for (const candidate of candidateNodes) {
    const content = sanitizeGeminiText(extractNodeText(candidate), role)
    if (content.length > bestContent.length) {
      bestContent = content
    }
  }

  return bestContent
}

function isGenericTitle(value: string): boolean {
  return GENERIC_TITLES.has(normalizeComparable(value))
}

export function resolveGeminiConversationTitleFromDom(fallbackTitle = ""): string {
  const candidates = Array.from(document.querySelectorAll(TITLE_SELECTOR))

  for (const candidate of candidates) {
    const title = normalizeText(candidate.textContent ?? "")
      .split("\n")
      .map((line) => normalizeText(line))
      .find((line) => line.length > 0)

    if (!title || isGenericTitle(title)) {
      continue
    }

    if (/^v(?:o|\u00f3|\u00f4)c(?:e|\u00ea)\s+disse/i.test(title)) {
      continue
    }

    return title
  }

  const fromDocument = normalizeText(document.title)
    .replace(/\s*-\s*Gemini\s*$/i, "")
    .replace(/\s*-\s*Google Gemini\s*$/i, "")
    .trim()

  if (fromDocument && !isGenericTitle(fromDocument)) {
    return fromDocument
  }

  return normalizeText(fallbackTitle)
}

function isTopLevelBlock(node: Element, root: Element): boolean {
  let current = node.parentElement
  while (current && current !== root) {
    if (current.matches(DEEP_RESEARCH_BLOCK_SELECTOR)) {
      return false
    }
    current = current.parentElement
  }

  return true
}

function listToMarkdown(list: Element): string {
  const ordered = list.tagName.toLowerCase() === "ol"
  const children = Array.from(list.children).filter(
    (node) => node.tagName.toLowerCase() === "li"
  )
  const items = (children.length > 0 ? children : Array.from(list.querySelectorAll("li"))).map(
    (item) => sanitizeGeminiText(extractNodeText(item), "GEMINI")
  )

  return items
    .filter(Boolean)
    .map((item, index) => `${ordered ? `${index + 1}.` : "-"} ${item}`)
    .join("\n")
}

function blockToMarkdown(block: Element): string {
  const tag = block.tagName.toLowerCase()

  if (tag === "ul" || tag === "ol") {
    return listToMarkdown(block)
  }

  if (tag === "pre") {
    const codeText = sanitizeGeminiText(extractNodeText(block), "GEMINI")
    return codeText ? `\`\`\`\n${codeText}\n\`\`\`` : ""
  }

  if (tag === "blockquote") {
    const quoteText = sanitizeGeminiText(extractNodeText(block), "GEMINI")
    if (!quoteText) {
      return ""
    }

    return quoteText
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")
  }

  const text = sanitizeGeminiText(extractNodeText(block), "GEMINI")
  if (!text) {
    return ""
  }

  if (tag === "h1") {
    return `# ${text}`
  }

  if (tag === "h2") {
    return `## ${text}`
  }

  if (tag === "h3") {
    return `### ${text}`
  }

  return text
}

function htmlToMarkdownPreservingStructure(container: Element): string {
  const clone = container.cloneNode(true) as HTMLElement
  removeIgnoredNodes(clone)

  const blocks = Array.from(clone.querySelectorAll(DEEP_RESEARCH_BLOCK_SELECTOR)).filter((node) =>
    isTopLevelBlock(node, clone)
  )

  const rendered = blocks
    .map((block) => blockToMarkdown(block))
    .filter(Boolean)
    .join("\n\n")

  if (rendered) {
    return rendered
  }

  return sanitizeGeminiText(extractNodeText(clone), "GEMINI")
}

export function extractDeepResearchArtifact(): string | null {
  const artifactNode = document.getElementById("extended-response-message-content")
  if (!artifactNode) {
    return null
  }

  const markdownContent = htmlToMarkdownPreservingStructure(artifactNode)
  if (!markdownContent) {
    return null
  }

  return `\n---\n# 🧠 RELATÓRIO DEEP RESEARCH\n\n${markdownContent}\n\n---`
}

export function extractGeminiMessages(): GeminiExtractedMessage[] {
  const messages: GeminiExtractedMessage[] = []
  const turns = Array.from(document.querySelectorAll("conversational-turn"))

  const pushIfContent = (node: Element, role: GeminiAuthorRole): void => {
    const content = extractGeminiMessageText(node, role)
    if (!content) {
      return
    }

    messages.push({
      role,
      content
    })
  }

  if (turns.length > 0) {
    for (const turn of turns) {
      const userNode = turn.querySelector("user-query")
      if (userNode) {
        pushIfContent(userNode, "USER")
      }

      const geminiNode = turn.querySelector("model-response")
      if (geminiNode) {
        // Hardcode role for server-side content.
        pushIfContent(geminiNode, "GEMINI")
      }
    }
  } else {
    // Fallback para layouts sem conversational-turn.
    for (const node of Array.from(document.querySelectorAll("user-query, model-response"))) {
      pushIfContent(node, node.matches("user-query") ? "USER" : "GEMINI")
    }
  }

  const researchArtifact = extractDeepResearchArtifact()
  if (researchArtifact) {
    const lastMessage = messages[messages.length - 1]

    if (lastMessage && lastMessage.role === "GEMINI") {
      lastMessage.content = normalizeText(`${lastMessage.content}\n${researchArtifact}`)
    } else {
      messages.push({
        role: "GEMINI",
        content: researchArtifact.trim()
      })
    }
  }

  const deduped: GeminiExtractedMessage[] = []
  const seen = new Set<string>()
  for (const message of messages) {
    const key = `${message.role}:${normalizeComparable(message.content)}`
    if (!key.endsWith(":") && !seen.has(key)) {
      seen.add(key)
      deduped.push(message)
    }
  }

  return deduped
}
