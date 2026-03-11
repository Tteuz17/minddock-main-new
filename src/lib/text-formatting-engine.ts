export type DocumentType = "schedule" | "chat" | "article" | "academic"

export interface ChatMessage {
  role: "user" | "assistant" | "metadata"
  authorName: string
  content: string
}

export interface ParsedDocument {
  title: string
  metadata: string[]
  messages: ChatMessage[]
  isChatMode: boolean
}

export interface FormattingAnalysis {
  documentType: DocumentType
  restoredText: string
  parsedDocument: ParsedDocument
}

export type ExportRenderFormat = "markdown" | "text" | "pdf"

export interface FormattedDocumentResult {
  metadata: MindDockMeta
  metadataBlock: string
  docType: DocumentType
  body: string
}

export interface MindDockMeta {
  sourceId?: string
  tipo?: string
  importedAt?: string
  title?: string
  metadataLines: string[]
}

const LIST_PREFIX_REGEX = /^\s*(?:[-*]\s+|\d+[.)]\s+)/u
const HEADING_PREFIX_REGEX = /^\s*#{1,6}\s+/u
const SEPARATOR_LINE_REGEX = /^\s*(?:-{3,}|={3,}|_{3,})\s*$/u
const PARAGRAPH_END_PUNCTUATION_REGEX = /[.!?]\s*$/u
const SCHEDULE_ROW_HINT_REGEX =
  /^\s*(?:\d{1,2}\s+(?:segunda|ter(?:ca|\u00E7a)|quarta|quinta|sexta|sabado|s\u00E1bado|domingo)|(?:segunda|ter(?:ca|\u00E7a)|quarta|quinta|sexta)-feira|\d{1,2}(?::\d{2}|h)|[-*•])/iu

const BLOCK_START_ANCHOR_REGEX =
  /^(Usuario|Usu\u00E1rio|Voc\u00EA|Voce|You|CHATGPT|ChatGPT|Assistant|Claude|Gemini):\s*/i
const PHANTOM_ANCHOR_SANITIZER_REGEX =
  /([^.\n!?])\s*(?:ChatGPT|Assistant|Claude|Gemini|Usuario|Usu\u00E1rio|Voc\u00EA|Voce|You):\s*/giu

export const ParserHeuristicsConfig = {
  speakerRegex:
    /(Usuario|Usu\u00E1rio|Voc\u00EA|Voce|You|CHATGPT|ChatGPT|Assistant|Claude|Gemini):\s*/gi,
  metricsRegex: /\d+\s*(g|ml|kg|kcal|colheres|unidades|litros|mg|cm|mm|m)\b/i,
  allCapsRegex: /^[A-Z\u00C1\u00C9\u00CD\u00D3\u00DA\u00C7\u00C3\u00D5\u00CA\u00D4\s]{4,}:?$/u
}

const IMPORT_METADATA_REGEX = /^>?\s*importado\s+do\s+.+\s+via\s+minddock\b/iu
const SOURCE_ID_REGEX = /^source\s*id:\s*([\w-]+)/iu
const TIPO_REGEX = /^tipo:\s*([\w-]+)/iu
const CONTEUDO_LINE_REGEX = /^conteudo\s*:?$/iu
const METADATA_KEY_VALUE_REGEX = /^(?:source\s*id|tipo|url|fonte|metadados?)\s*:/iu
const METADATA_HEADING_REGEX = /^(?:#+\s*)?metadados?\s*:?$/iu
const PLATFORM_TITLE_REGEX = /^\s*\[(chatgpt|gemini|claude|perplexity)\]/iu
const ACADEMIC_SECTION_REGEX = /^\d+\.\d+(?:\.\d+)?\s+[A-Z\u00C1\u00C9\u00CD\u00D3\u00DA]/u
const ACADEMIC_FOOTNOTE_FLOW_REGEX = /[.!?]\s+\d{1,2}\s+\d+\.\d/u
const HEADER_SIGNAL_REGEX = /^(?:source\s*id:|tipo:|conteudo\s*:|>?\s*importado\s+do\s+)/iu
const MAX_HEADER_SCAN_LINES = 30
const INLINE_CONNECTORS_REGEX = /\b(como|de|do|da|no|na|o|a|e|para|com|pelo|pela|seu|sua|tem)\s*$/iu
const CONTINUATION_STARTERS_REGEX =
  /^(apresentar|descrever|analisar|mostrar|demonstrar|explicar|discutir|propor|de\b|do\b|da\b|a\b|o\b|um\b|uma\b)/iu

const FLOATING_SECTION_KEYWORDS = new Set(
  [
    "OBJETIVO",
    "CONTEXTO",
    "DESENVOLVIMENTO",
    "APLICACAO",
    "FUNDAMENTACAO",
    "EXEMPLO",
    "CONCLUSAO",
    "INTRODUCAO",
    "APRESENTACAO",
    "RESUMO",
    "REFERENCIAS",
    "METODOLOGIA"
  ].map((keyword) => normalizeToken(keyword))
)

export function stripMindDockHeader(rawText: string): { metadata: MindDockMeta; body: string } {
  const normalized = String(rawText ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
  const lines = normalized.split("\n")

  const metadata: MindDockMeta = {
    metadataLines: []
  }

  const nonEmptyRows = lines
    .map((line, index) => ({ line: String(line ?? ""), trimmed: String(line ?? "").trim(), index }))
    .filter((row) => row.trimmed.length > 0)

  const headerSignalRow = nonEmptyRows.find(
    (row) => HEADER_SIGNAL_REGEX.test(row.trimmed) || IMPORT_METADATA_REGEX.test(row.trimmed)
  )
  const hasHeaderEnvelope = Boolean(headerSignalRow && headerSignalRow.index <= MAX_HEADER_SCAN_LINES)

  const skippedIndexes = new Set<number>()
  if (hasHeaderEnvelope) {
    const metadataScanLimit = Math.min(lines.length - 1, (headerSignalRow?.index ?? 0) + 12)

    for (let index = 0; index <= metadataScanLimit; index += 1) {
      const rawLine = String(lines[index] ?? "")
      const trimmedLine = rawLine.trim()
      if (!trimmedLine) {
        continue
      }

      const sourceMatch = trimmedLine.match(SOURCE_ID_REGEX)
      if (sourceMatch) {
        metadata.sourceId = String(sourceMatch[1] ?? "").trim()
        addUniqueMetadataLine(metadata.metadataLines, `Source ID: ${metadata.sourceId}`)
        skippedIndexes.add(index)
        continue
      }

      const tipoMatch = trimmedLine.match(TIPO_REGEX)
      if (tipoMatch) {
        metadata.tipo = String(tipoMatch[1] ?? "").trim()
        addUniqueMetadataLine(metadata.metadataLines, `Tipo: ${metadata.tipo}`)
        skippedIndexes.add(index)
        continue
      }

      if (IMPORT_METADATA_REGEX.test(trimmedLine)) {
        metadata.importedAt = extractImportTimestamp(trimmedLine)
        addUniqueMetadataLine(metadata.metadataLines, trimmedLine.replace(/^>\s*/, ""))
        skippedIndexes.add(index)
        continue
      }

      if (CONTEUDO_LINE_REGEX.test(trimmedLine)) {
        addUniqueMetadataLine(metadata.metadataLines, "Conteudo:")
        skippedIndexes.add(index)
        continue
      }

      if (METADATA_KEY_VALUE_REGEX.test(trimmedLine) || METADATA_HEADING_REGEX.test(trimmedLine)) {
        addUniqueMetadataLine(metadata.metadataLines, trimmedLine)
        skippedIndexes.add(index)
      }
    }

    const headerStartIndex = Math.max(0, (headerSignalRow?.index ?? 0) - 3)
    for (let index = headerStartIndex; index < (headerSignalRow?.index ?? 0); index += 1) {
      const candidateLine = String(lines[index] ?? "").trim()
      if (!candidateLine || !isLikelyTitleLine(candidateLine)) {
        continue
      }

      metadata.title = cleanTitleCandidate(candidateLine)
      skippedIndexes.add(index)
      break
    }
  }

  if (!metadata.title) {
    const firstLine = String(lines[0] ?? "").trim()
    if (isLikelyTitleLine(firstLine)) {
      metadata.title = cleanTitleCandidate(firstLine)
      if (hasHeaderEnvelope) {
        skippedIndexes.add(0)
      }
    }
  }

  const body = lines
    .filter((line, index) => {
      if (skippedIndexes.has(index)) {
        return false
      }

      const trimmed = String(line ?? "").trim()
      if (
        hasHeaderEnvelope &&
        metadata.title &&
        index <= MAX_HEADER_SCAN_LINES &&
        /^#\s+/.test(trimmed) &&
        normalizeToken(cleanTitleCandidate(trimmed)) === normalizeToken(metadata.title)
      ) {
        return false
      }

      return true
    })
    .join("\n")
    .replace(/^\s+/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  return { metadata, body }
}

export function formatMetadataBlock(meta: MindDockMeta, format: ExportRenderFormat): string {
  const lines: string[] = []
  if (meta.title) {
    lines.push(`Titulo: ${meta.title}`)
  }
  if (meta.sourceId) {
    lines.push(`Source ID: ${meta.sourceId}`)
  }
  if (meta.tipo) {
    lines.push(`Tipo: ${meta.tipo}`)
  }
  if (meta.importedAt) {
    lines.push(`Importado em: ${meta.importedAt}`)
  }

  if (lines.length === 0) {
    return ""
  }

  if (format === "markdown") {
    return ["---", ...lines, "---", ""].join("\n")
  }

  const separator = "-".repeat(50)
  return [separator, ...lines, separator, ""].join("\n")
}

export function resolveFloatingKeywords(rawText: string): string {
  const lines = String(rawText ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
  if (lines.length === 0) {
    return ""
  }

  const result: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = String(lines[index] ?? "")
    const line = rawLine.trim()
    if (!line) {
      result.push("")
      continue
    }

    if (!FLOATING_SECTION_KEYWORDS.has(normalizeToken(line))) {
      result.push(rawLine)
      continue
    }

    const previousLine = String(lines[index - 1] ?? "").trim()
    const nextLine = String(lines[index + 1] ?? "").trim()
    const previousEndsWithConnector = INLINE_CONNECTORS_REGEX.test(previousLine)
    const previousIsShort = previousLine.length > 0 && previousLine.length < 60
    const nextIsContinuation = CONTINUATION_STARTERS_REGEX.test(nextLine)

    if (previousEndsWithConnector || (previousIsShort && nextIsContinuation)) {
      const previousOutputIndex = findLastTextLineIndex(result)
      if (previousOutputIndex >= 0) {
        result[previousOutputIndex] = `${result[previousOutputIndex].trimEnd()} ${line.toLowerCase()}`
      } else {
        result.push(line.toLowerCase())
      }
      continue
    }

    const previousHasBoundary =
      !previousLine || /[.!?:]\s*$/.test(previousLine) || /^[IVX]+\.$/iu.test(previousLine)
    if (previousHasBoundary && nextLine.length > 10) {
      result.push(`## ${line}`)
      continue
    }

    result.push(line)
  }

  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

export function removeFootnoteNumbers(rawText: string): string {
  return String(rawText ?? "").replace(/([.!?"])\s+\d{1,2}\s*\n/g, "$1\n")
}

export function sanitizePhantomAnchors(rawText: string): string {
  return String(rawText ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(PHANTOM_ANCHOR_SANITIZER_REGEX, "$1 ")
    .replace(/[ \t]{2,}/g, " ")
}

export function classifyDocumentType(rawText: string, hasScheduleStructure = false): DocumentType {
  if (hasScheduleStructure) {
    return "schedule"
  }

  const { body } = stripMindDockHeader(rawText)
  const sanitized = sanitizePhantomAnchors(body)
  return classifyContentTypeFromBody(sanitized)
}

export function normalizeByType(text: string, docType: DocumentType): string {
  switch (docType) {
    case "chat":
      return normalizeChatText(text)
    case "academic":
      return normalizeAcademicText(text)
    case "schedule":
      return text
    default:
      return normalizeArticleText(text)
  }
}

export function reconstructParagraphs(rawText: string, docType: DocumentType = "article"): string {
  const sanitizedText = sanitizePhantomAnchors(rawText).trim()
  if (!sanitizedText) {
    return ""
  }

  const lines = sanitizedText.split("\n").map((line) => line.trim())
  let restoredText = ""

  for (const lineRaw of lines) {
    const line = String(lineRaw ?? "").trim()
    if (!line) {
      restoredText += "\n"
      continue
    }

    if (isProtectedLine(line, docType)) {
      restoredText += `${line}\n`
      continue
    }

    if (!PARAGRAPH_END_PUNCTUATION_REGEX.test(line)) {
      restoredText += `${line} `
      continue
    }

    restoredText += `${line}\n\n`
  }

  return restoredText
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

export function filterArtifactBlocks(blocks: string[]): string[] {
  return blocks.filter((blockRaw) => {
    const block = String(blockRaw ?? "").trim()
    if (!block) {
      return false
    }
    if (/^\d{1,3}$/.test(block)) {
      return false
    }
    if (/^source\s*id:/iu.test(block)) {
      return false
    }
    if (/^tipo:\s*[\w-]+$/iu.test(block)) {
      return false
    }
    if (block.length < 8) {
      return false
    }
    return true
  })
}

export function parseDocumentStructure(restoredText: string): ParsedDocument {
  const normalizedText = String(restoredText ?? "")
    .replace(/\r\n?/g, "\n")
    .trim()

  if (!normalizedText) {
    return {
      title: "",
      metadata: [],
      messages: [],
      isChatMode: false
    }
  }

  const initialLines = normalizedText.split("\n").map((line) => line.trim())
  const { title, remainingLines } = extractDocumentTitle(initialLines)
  const { metadata, contentStartIndex } = extractInitialMetadataBlock(remainingLines)
  const contentText = remainingLines
    .slice(contentStartIndex)
    .join("\n")
    .trim()

  if (!contentText) {
    return {
      title,
      metadata,
      messages: [],
      isChatMode: false
    }
  }

  const textBlocks = filterArtifactBlocks(contentText.split(/\n{2,}/))
  const messages: ChatMessage[] = []

  for (const blockRaw of textBlocks) {
    const block = String(blockRaw ?? "").trim()
    if (!block) {
      continue
    }

    const anchorMatch = block.match(BLOCK_START_ANCHOR_REGEX)
    if (anchorMatch) {
      const speakerLabel = String(anchorMatch[1] ?? "").trim()
      const role = mapSpeakerToRole(speakerLabel)
      if (!role) {
        continue
      }

      const authorName = resolveSpeakerAuthorName(speakerLabel)
      const contentWithoutAnchor = block.replace(BLOCK_START_ANCHOR_REGEX, "")
      const cleanContent = normalizeMessageFragment(stripSpeakerArtifacts(contentWithoutAnchor))
      if (!cleanContent) {
        continue
      }

      const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null
      if (lastMessage && lastMessage.role === role) {
        lastMessage.content = mergeMessageContents(lastMessage.content, cleanContent, "\n\n")
      } else {
        messages.push({
          role,
          authorName,
          content: cleanContent
        })
      }
      continue
    }

    const cleanBlock = normalizeMessageFragment(stripSpeakerArtifacts(block))
    if (!cleanBlock) {
      continue
    }

    if (messages.length === 0) {
      messages.push({
        role: "metadata",
        authorName: "Contexto",
        content: cleanBlock
      })
      continue
    }

    const lastMessage = messages[messages.length - 1]
    lastMessage.content = mergeMessageContents(lastMessage.content, cleanBlock, "\n\n")
  }

  const conversationMessages = messages.filter(
    (message) => message.role === "user" || message.role === "assistant"
  )
  const hasUser = conversationMessages.some((message) => message.role === "user")
  const hasAssistant = conversationMessages.some((message) => message.role === "assistant")
  const isChatMode = conversationMessages.length >= 2 && hasUser && hasAssistant

  if (!isChatMode) {
    const fallbackContent = normalizeMessageFragment(stripSpeakerArtifacts(contentText))
    return {
      title,
      metadata,
      messages: fallbackContent
        ? [
            {
              role: "metadata",
              authorName: "Conteudo",
              content: fallbackContent
            }
          ]
        : [],
      isChatMode: false
    }
  }

  return {
    title,
    metadata,
    messages,
    isChatMode: true
  }
}

export function renderMarkdownOut(doc: ParsedDocument): string {
  const lines: string[] = []

  const title = String(doc.title ?? "").trim()
  if (title) {
    lines.push(`# ${title}`)
    lines.push("")
  }

  const metadataLines = (doc.metadata ?? []).map((line) => String(line ?? "").trim()).filter(Boolean)
  if (metadataLines.length > 0) {
    lines.push(...metadataLines)
    lines.push("")
    lines.push("---")
    lines.push("")
  }

  const visibleMessages = (doc.messages ?? [])
    .map((message) => ({
      authorName: String(message.authorName ?? "").trim() || "Autor",
      content: String(message.content ?? "").trim()
    }))
    .filter((message) => message.content.length > 0)

  for (const message of visibleMessages) {
    lines.push(`**${message.authorName}:**`)
    lines.push("")
    lines.push(message.content)
    lines.push("")
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

export function renderPlainTextOut(doc: ParsedDocument): string {
  const lines: string[] = []

  const title = String(doc.title ?? "").trim()
  if (title) {
    lines.push(title.toUpperCase())
    lines.push("")
  }

  const metadataLines = (doc.metadata ?? []).map((line) => String(line ?? "").trim()).filter(Boolean)
  if (metadataLines.length > 0) {
    lines.push(...metadataLines)
    lines.push("")
    lines.push("====================")
    lines.push("")
  }

  const visibleMessages = (doc.messages ?? [])
    .map((message) => ({
      authorName: String(message.authorName ?? "").trim() || "Autor",
      content: String(message.content ?? "").trim()
    }))
    .filter((message) => message.content.length > 0)

  for (const message of visibleMessages) {
    lines.push(`${message.authorName}:`)
    lines.push("")
    lines.push(message.content)
    lines.push("")
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

export function renderPdfInstructions(doc: ParsedDocument): void {
  // Future PDF renderer contract:
  // 1) Iterate over doc.messages in sequence.
  // 2) Print authorName in bold font.
  // 3) Move to next line and switch to normal font.
  // 4) Use jsPDF.splitTextToSize(message.content, maxWidth) for wrapping.
  // 5) Never hardcode raw line breaks from capture; always rely on splitTextToSize.
  void doc
}

export function formatDocument(
  rawText: string,
  outputFormat: ExportRenderFormat = "markdown",
  hasScheduleStructure = false
): FormattedDocumentResult {
  const { metadata, body } = stripMindDockHeader(rawText)
  const earlySanitized = sanitizePhantomAnchors(body)
  const classifiedType = hasScheduleStructure ? "schedule" : classifyContentTypeFromBody(earlySanitized)
  const normalizedByType = normalizeByType(earlySanitized, classifiedType)

  const shouldResolveKeywords = classifiedType === "academic" || classifiedType === "article"
  const keywordResolved = shouldResolveKeywords ? resolveFloatingKeywords(normalizedByType) : normalizedByType

  const footnotesCleaned =
    classifiedType === "academic" ? removeFootnoteNumbers(keywordResolved) : keywordResolved

  const reconstructed = reconstructParagraphs(footnotesCleaned, classifiedType)
  const finalSanitized = sanitizePhantomAnchors(reconstructed)

  return {
    metadata,
    metadataBlock: formatMetadataBlock(metadata, outputFormat),
    docType: classifiedType,
    body: finalSanitized
  }
}

export function analyzeDocumentType(rawText: string, hasScheduleStructure = false): FormattingAnalysis {
  const formatted = formatDocument(rawText, "markdown", hasScheduleStructure)
  const parsedDocument = parseDocumentStructure(formatted.body)

  const resolvedDocumentType: DocumentType = parsedDocument.isChatMode
    ? "chat"
    : formatted.docType === "chat"
      ? "article"
      : formatted.docType

  const mergedMetadata = [
    ...formatted.metadata.metadataLines,
    ...parsedDocument.metadata.filter((line) => !formatted.metadata.metadataLines.includes(line))
  ]

  return {
    documentType: resolvedDocumentType,
    restoredText: formatted.body,
    parsedDocument: {
      ...parsedDocument,
      title: parsedDocument.title || formatted.metadata.title || "",
      metadata: mergedMetadata
    }
  }
}

function classifyContentTypeFromBody(textRaw: string): DocumentType {
  const text = String(textRaw ?? "")
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const totalLines = Math.max(1, lines.length)

  const scheduleRows = lines.filter((line) => SCHEDULE_ROW_HINT_REGEX.test(line)).length
  if (scheduleRows / totalLines >= 0.12) {
    return "schedule"
  }

  const numberedSections = lines.filter((line) => ACADEMIC_SECTION_REGEX.test(line)).length
  const allCapsSections = lines.filter((line) => ParserHeuristicsConfig.allCapsRegex.test(line)).length
  const academicScore =
    (ACADEMIC_FOOTNOTE_FLOW_REGEX.test(text) ? 3 : 0) + numberedSections + Math.floor(allCapsSections / 2)
  if (academicScore >= 3) {
    return "academic"
  }

  const anchors = collectSpeakerAnchors(text)
  const hasUserAnchor = anchors.some((anchor) => isUserToken(anchor))
  const hasAssistantAnchor = anchors.some((anchor) => !isUserToken(anchor))
  if (hasUserAnchor && hasAssistantAnchor && anchors.length >= 2) {
    return "chat"
  }

  const questionLines = lines.filter((line) => line.endsWith("?")).length
  const shortLines = lines.filter((line) => line.length >= 5 && line.length < 60).length
  const chatScore =
    (questionLines >= 3 ? 2 : questionLines >= 1 ? 1 : 0) +
    (shortLines / totalLines >= 0.25 ? 2 : shortLines / totalLines >= 0.15 ? 1 : 0)
  if (chatScore >= 3) {
    return "chat"
  }

  return "article"
}

function normalizeChatText(textRaw: string): string {
  let text = String(textRaw ?? "")

  text = text.replace(
    /\b(\d[\d,.]*)\s+(\d[\d,.]*)\s*(kcal|cal|kg|g|mg|ml|L|%|cm|mm|m)\b/giu,
    "$1-$2 $3"
  )

  text = text.replace(
    /([.!?])\s+(Usuario|Usu\u00E1rio|Voc\u00EA|Voce|You|CHATGPT|ChatGPT|Assistant|Claude|Gemini):\s*/giu,
    "$1\n\n$2: "
  )

  return text
}

function normalizeAcademicText(textRaw: string): string {
  let text = String(textRaw ?? "")

  text = text.replace(
    /([.!?])\s+(\d{1,2})\s+(\d+\.\d(?:\.\d+)?\s+[A-Z\u00C1\u00C9\u00CD\u00D3\u00DA])/gu,
    "$1\n\n### $3"
  )

  text = text.replace(/\n([A-Z\u00C1\u00C9\u00CD\u00D3\u00DA][A-Z\u00C1\u00C9\u00CD\u00D3\u00DA\s]{7,})\n/gu, (full, section) => {
    const words = String(section ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
    if (words.length < 2) {
      return full
    }
    return `\n\n## ${String(section).trim()}\n\n`
  })

  text = text.replace(/([^\n.!?])\n([a-z\u00E0-\u00FF])/gu, "$1 $2")
  return text
}

function normalizeArticleText(textRaw: string): string {
  return String(textRaw ?? "").replace(/([^\n.!?])\n([a-z\u00E0-\u00FF])/gu, "$1 $2")
}

function isProtectedLine(lineRaw: string, docType: DocumentType): boolean {
  const line = String(lineRaw ?? "").trim()
  if (!line) {
    return true
  }

  if (HEADING_PREFIX_REGEX.test(line) || LIST_PREFIX_REGEX.test(line) || SEPARATOR_LINE_REGEX.test(line)) {
    return true
  }

  if (ParserHeuristicsConfig.metricsRegex.test(line)) {
    return true
  }

  if (ParserHeuristicsConfig.allCapsRegex.test(line)) {
    return true
  }

  if (ACADEMIC_SECTION_REGEX.test(line)) {
    return true
  }

  if (docType === "chat" && BLOCK_START_ANCHOR_REGEX.test(line)) {
    return true
  }

  if (docType === "schedule" && SCHEDULE_ROW_HINT_REGEX.test(line)) {
    return true
  }

  return false
}

function normalizeMessageFragment(fragmentRaw: string): string {
  return String(fragmentRaw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

function stripSpeakerArtifacts(contentRaw: string): string {
  const speakerRegex = new RegExp(
    ParserHeuristicsConfig.speakerRegex.source,
    ParserHeuristicsConfig.speakerRegex.flags
  )
  return String(contentRaw ?? "").replace(speakerRegex, "")
}

function mergeMessageContents(existingContentRaw: string, nextContentRaw: string, separator: string): string {
  const existingContent = String(existingContentRaw ?? "").trim()
  const nextContent = String(nextContentRaw ?? "").trim()
  if (!existingContent) {
    return nextContent
  }
  if (!nextContent) {
    return existingContent
  }
  return normalizeMessageFragment(`${existingContent}${separator}${nextContent}`)
}

function collectSpeakerAnchors(textRaw: string): string[] {
  const text = String(textRaw ?? "")
  const regex = new RegExp(ParserHeuristicsConfig.speakerRegex.source, ParserHeuristicsConfig.speakerRegex.flags)
  const anchors: string[] = []
  for (const match of text.matchAll(regex)) {
    const token = String(match[1] ?? "").trim()
    if (token) {
      anchors.push(normalizeToken(token))
    }
  }
  return anchors
}

function mapSpeakerToRole(rawSpeakerLabel: string): "user" | "assistant" | null {
  const normalized = normalizeToken(rawSpeakerLabel)
  if (!normalized) {
    return null
  }
  if (isUserToken(normalized)) {
    return "user"
  }
  return "assistant"
}

function resolveSpeakerAuthorName(rawSpeakerLabel: string): string {
  const normalized = normalizeToken(rawSpeakerLabel)
  if (isUserToken(normalized)) {
    return "Usuario"
  }
  if (normalized === "chatgpt") {
    return "ChatGPT"
  }
  if (normalized === "gemini") {
    return "Gemini"
  }
  if (normalized === "claude") {
    return "Claude"
  }
  if (normalized === "assistant") {
    return "Assistente"
  }
  return String(rawSpeakerLabel ?? "").trim() || "Assistente"
}

function isUserToken(token: string): boolean {
  return ["usuario", "user", "voce", "you"].includes(token)
}

function extractDocumentTitle(lines: string[]): { title: string; remainingLines: string[] } {
  if (lines.length === 0) {
    return { title: "", remainingLines: [] }
  }

  const firstLine = String(lines[0] ?? "").trim()
  if (!firstLine) {
    return { title: "", remainingLines: lines.slice(1) }
  }

  if (HEADING_PREFIX_REGEX.test(firstLine)) {
    return {
      title: firstLine.replace(/^#{1,6}\s+/, "").trim(),
      remainingLines: lines.slice(1)
    }
  }

  if (PLATFORM_TITLE_REGEX.test(firstLine)) {
    return {
      title: firstLine,
      remainingLines: lines.slice(1)
    }
  }

  return { title: "", remainingLines: lines }
}

function extractInitialMetadataBlock(lines: string[]): { metadata: string[]; contentStartIndex: number } {
  const metadata: string[] = []
  let contentStartIndex = 0
  let metadataDetected = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] ?? "").trim()
    if (!line) {
      if (metadataDetected) {
        contentStartIndex = index + 1
      }
      continue
    }

    if (SEPARATOR_LINE_REGEX.test(line)) {
      if (metadataDetected) {
        contentStartIndex = index + 1
        continue
      }
      break
    }

    if (!isMetadataLine(line)) {
      break
    }

    metadataDetected = true
    metadata.push(line.replace(/^>\s*/, ""))
    contentStartIndex = index + 1
  }

  return { metadata, contentStartIndex }
}

function isMetadataLine(lineRaw: string): boolean {
  const line = String(lineRaw ?? "").trim()
  if (!line) {
    return false
  }
  return (
    IMPORT_METADATA_REGEX.test(line) ||
    METADATA_KEY_VALUE_REGEX.test(line) ||
    METADATA_HEADING_REGEX.test(line) ||
    /^>/.test(line)
  )
}

function extractImportTimestamp(lineRaw: string): string | undefined {
  const line = String(lineRaw ?? "")
  const match = line.match(/\bem\s+(.+)$/iu)
  const timestamp = String(match?.[1] ?? "").trim()
  return timestamp || undefined
}

function addUniqueMetadataLine(target: string[], valueRaw: string): void {
  const value = String(valueRaw ?? "").trim()
  if (!value || target.includes(value)) {
    return
  }
  target.push(value)
}

function isLikelyTitleLine(lineRaw: string): boolean {
  const line = String(lineRaw ?? "").trim()
  if (!line || line.length < 4) {
    return false
  }
  if (HEADER_SIGNAL_REGEX.test(line) || METADATA_KEY_VALUE_REGEX.test(line) || CONTEUDO_LINE_REGEX.test(line)) {
    return false
  }
  if (line.startsWith("[") || /^#\s+/.test(line)) {
    return true
  }
  return !line.includes(":")
}

function cleanTitleCandidate(lineRaw: string): string {
  return String(lineRaw ?? "")
    .trim()
    .replace(/^#\s+/, "")
    .replace(/^\[(.+)\]$/u, "$1")
    .trim()
}

function findLastTextLineIndex(lines: string[]): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (String(lines[index] ?? "").trim().length > 0) {
      return index
    }
  }
  return -1
}

function normalizeToken(valueRaw: string): string {
  return String(valueRaw ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}
