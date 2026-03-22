import { jsPDF } from "jspdf"
import { cleanRawText, densityParagraphChunker, formatMetadataKeys } from "~/lib/PdfContentFormatter"

const PDF_MARGIN_X = 46
const PDF_MARGIN_Y = 52
const PDF_BODY_FONT_SIZE = 11
const PDF_TITLE_FONT_SIZE = 14
const PDF_TABLE_FONT_SIZE = 10
const PDF_BODY_LINE_HEIGHT = 15
const PDF_TITLE_LINE_HEIGHT = 19
const PDF_TABLE_LINE_HEIGHT = 13
const PDF_BLANK_LINE_HEIGHT = 9
const PDF_CHAT_CARD_GAP = 10
const PDF_CHAT_CARD_PADDING_X = 12
const PDF_CHAT_CARD_PADDING_Y = 10
const PDF_CHAT_HEADER_HEIGHT = 14
const PDF_CHAT_CARD_MIN_HEIGHT = 58
const PDF_CHAT_LEFT_BAR_WIDTH = 4
const CHAT_DOC_TITLE_FONT_SIZE = 20
const CHAT_DOC_TITLE_LINE_HEIGHT = 24
const CHAT_DOC_META_FONT_SIZE = 10
const CHAT_DOC_META_LINE_HEIGHT = 14
const CHAT_DOC_HEADER_FONT_SIZE = 12
const CHAT_DOC_HEADER_LINE_HEIGHT = 16
const CHAT_DOC_BODY_FONT_SIZE = 12
const CHAT_DOC_BODY_LINE_HEIGHT = 18
const CHAT_DOC_PARAGRAPH_GAP = 12
const CHAT_DOC_TURN_GAP = 10
const LEGACY_METADATA_SEPARATOR_REGEX = /^[-=]{4,}$/
const LEGACY_TITLE_FONT_SIZE = 14
const LEGACY_TITLE_LINE_HEIGHT = 20
const LEGACY_METADATA_FONT_SIZE = 11
const LEGACY_METADATA_LINE_HEIGHT = 15
const LEGACY_BODY_FONT_SIZE = 12
const LEGACY_BODY_LINE_HEIGHT = 19
const LEGACY_BODY_PARAGRAPH_GAP = 16
const LEGACY_DIVIDER_GAP = 40

interface ParsedChatPdfMessage {
  role: "user" | "model"
  content: string
}

interface ParsedChatPdfDocument {
  title: string
  exportedAt: string
  messages: ParsedChatPdfMessage[]
}

interface StructuredLegacyPdfContent {
  title: string
  metadataLines: string[]
  bodyText: string
}

interface StrongMarkupSegment {
  text: string
  isStrong: boolean
}

export function buildPdfBytesFromText(text: string): Uint8Array {
  const pdf = new jsPDF({
    unit: "pt",
    format: "a4",
    compress: true
  })

  const normalized = normalizePdfText(text)
  const parsedChat = parseChatPdfDocument(normalized)
  if (parsedChat) {
    renderChatStyledPdf(pdf, parsedChat)
  } else {
    renderLegacyTextPdf(pdf, normalized)
  }

  return new Uint8Array(pdf.output("arraybuffer") as ArrayBuffer)
}

const CHAT_ROLE_TOKEN_SOURCE =
  "usuario|usu[áa]rio|user|notebooklm|assistant|assistente|modelo|model"
const CHAT_ROLE_HEADER_REGEX = new RegExp(`^##\\s+(?<label>${CHAT_ROLE_TOKEN_SOURCE})\\s*$`, "iu")

function parseChatPdfDocument(normalizedText: string): ParsedChatPdfDocument | null {
  const lines = String(normalizedText ?? "").split("\n")
  const messages: ParsedChatPdfMessage[] = []
  let title = ""
  let exportedAt = ""
  let currentRole: ParsedChatPdfMessage["role"] | null = null
  let currentLines: string[] = []

  const flushCurrent = (): void => {
    if (!currentRole) {
      return
    }
    const content = currentLines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
    if (content) {
      messages.push({
        role: currentRole,
        content
      })
    }
    currentRole = null
    currentLines = []
  }

  for (const rawLine of lines) {
    const line = String(rawLine ?? "").trimEnd()
    const trimmed = line.trim()

    if (!title && /^#\s+/.test(trimmed)) {
      title = trimmed.replace(/^#\s+/, "").trim()
      continue
    }

    if (!exportedAt && /^exportad[oa]\s+em:/i.test(trimmed)) {
      exportedAt = trimmed.replace(/^exportad[oa]\s+em:\s*/i, "").trim()
      continue
    }

    if (!exportedAt && /^exported at:/i.test(trimmed)) {
      exportedAt = trimmed.replace(/^exported at:\s*/i, "").trim()
      continue
    }

    const roleHeaderMatch = trimmed.match(CHAT_ROLE_HEADER_REGEX)
    if (roleHeaderMatch) {
      const label = String(roleHeaderMatch.groups?.label ?? "").toLowerCase()
      const resolvedRole = resolveChatRole(label)
      if (!resolvedRole) {
        continue
      }
      flushCurrent()
      currentRole = resolvedRole
      continue
    }

    if (/^---+$/.test(trimmed)) {
      continue
    }

    if (currentRole) {
      currentLines.push(line)
    }
  }

  flushCurrent()

  if (messages.length === 0) {
    return null
  }

  return {
    title: title || "NotebookLM",
    exportedAt,
    messages
  }
}

function resolveChatRole(label: string): ParsedChatPdfMessage["role"] | null {
  if (!label) {
    return null
  }

  if (label === "usuario" || label === "usuário" || label === "user") {
    return "user"
  }

  if (label === "notebooklm" || label === "assistant" || label === "assistente" || label === "modelo" || label === "model") {
    return "model"
  }

  return null
}

function renderChatStyledPdf(pdf: jsPDF, doc: ParsedChatPdfDocument): void {
  const pageHeight = pdf.internal.pageSize.getHeight()
  const maxWidth = pdf.internal.pageSize.getWidth() - PDF_MARGIN_X * 2
  let y = PDF_MARGIN_Y

  const ensureSpace = (height: number): void => {
    if (y + height <= pageHeight - PDF_MARGIN_Y) {
      return
    }
    pdf.addPage()
    y = PDF_MARGIN_Y
  }

  pdf.setTextColor(17, 24, 39)
  pdf.setFont("helvetica", "bold")
  pdf.setFontSize(CHAT_DOC_TITLE_FONT_SIZE)
  const titleLines = pdf.splitTextToSize(doc.title || "NotebookLM", maxWidth) as string[]
  for (const line of titleLines) {
    ensureSpace(CHAT_DOC_TITLE_LINE_HEIGHT)
    pdf.text(line, PDF_MARGIN_X, y)
    y += CHAT_DOC_TITLE_LINE_HEIGHT
  }
  y += 4

  if (doc.exportedAt) {
    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(CHAT_DOC_META_FONT_SIZE)
    pdf.setTextColor(107, 114, 128)
    ensureSpace(CHAT_DOC_META_LINE_HEIGHT)
    pdf.text(`Exported at: ${doc.exportedAt}`, PDF_MARGIN_X, y)
    y += CHAT_DOC_META_LINE_HEIGHT + 6
  } else {
    y += 8
  }

  ensureSpace(6)
  pdf.setDrawColor(203, 213, 225)
  pdf.setLineWidth(0.8)
  pdf.line(PDF_MARGIN_X, y, PDF_MARGIN_X + maxWidth, y)
  y += 18

  for (let index = 0; index < doc.messages.length; index += 1) {
    const message = doc.messages[index]
    const roleLabel = message.role === "user" ? "User" : "NotebookLM"
    const headerText = `${index + 1}. ${roleLabel}`

    pdf.setFont("helvetica", "bold")
    pdf.setFontSize(CHAT_DOC_HEADER_FONT_SIZE)
    pdf.setTextColor(17, 24, 39)
    ensureSpace(CHAT_DOC_HEADER_LINE_HEIGHT)
    pdf.text(headerText, PDF_MARGIN_X, y)
    y += CHAT_DOC_HEADER_LINE_HEIGHT

    const paragraphs = splitChatMessageParagraphs(message.content)
    pdf.setFont("times", "normal")
    pdf.setFontSize(CHAT_DOC_BODY_FONT_SIZE)
    pdf.setTextColor(31, 41, 55)

    for (const paragraph of paragraphs) {
      const wrapped = pdf.splitTextToSize(paragraph, maxWidth) as string[]
      for (const line of wrapped) {
        ensureSpace(CHAT_DOC_BODY_LINE_HEIGHT)
        pdf.text(line, PDF_MARGIN_X, y)
        y += CHAT_DOC_BODY_LINE_HEIGHT
      }
      y += CHAT_DOC_PARAGRAPH_GAP
    }

    y += CHAT_DOC_TURN_GAP
  }
}

function splitChatMessageParagraphs(content: string): string[] {
  const blocks = String(content ?? "")
    .split(/\n{2,}/g)
    .map((block) => block.replace(/\n+/g, " ").trim())
    .filter((block) => block.length > 0)

  return blocks.length > 0 ? blocks : ["Sem conteudo disponivel."]
}

function renderLegacyTextPdf(pdf: jsPDF, normalizedText: string): void {
  const structured = parseStructuredLegacyPdfContent(normalizedText)
  if (structured) {
    renderStructuredLegacyTextPdf(pdf, structured)
    return
  }

  renderLegacyTextPdfFallback(pdf, normalizedText)
}

function parseStructuredLegacyPdfContent(normalizedText: string): StructuredLegacyPdfContent | null {
  const lines = String(normalizedText ?? "").split("\n")
  const dividerIndex = lines.findIndex((line) => LEGACY_METADATA_SEPARATOR_REGEX.test(line.trim()))
  if (dividerIndex === -1) {
    return null
  }

  const titleIndex = lines.findIndex((line) => line.trim().length > 0)
  if (titleIndex === -1 || titleIndex > dividerIndex) {
    return null
  }

  const metadataLines = lines
    .slice(titleIndex + 1, dividerIndex)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const bodyText = lines.slice(dividerIndex + 1).join("\n").trim()

  return {
    title: lines[titleIndex].trim(),
    metadataLines,
    bodyText
  }
}

function renderStructuredLegacyTextPdf(pdf: jsPDF, content: StructuredLegacyPdfContent): void {
  const pageHeight = pdf.internal.pageSize.getHeight()
  const maxWidth = pdf.internal.pageSize.getWidth() - PDF_MARGIN_X * 2
  let y = PDF_MARGIN_Y

  const ensureSpace = (height: number): void => {
    if (y + height <= pageHeight - PDF_MARGIN_Y) {
      return
    }
    pdf.addPage()
    y = PDF_MARGIN_Y
  }

  pdf.setFont("helvetica", "bold")
  pdf.setFontSize(LEGACY_TITLE_FONT_SIZE)
  pdf.setTextColor(17, 24, 39)
  const titleLines = pdf.splitTextToSize(content.title || "Documento", maxWidth) as string[]
  for (const line of titleLines) {
    ensureSpace(LEGACY_TITLE_LINE_HEIGHT)
    pdf.text(line, PDF_MARGIN_X, y)
    y += LEGACY_TITLE_LINE_HEIGHT
  }
  y += 4

  pdf.setTextColor(55, 65, 81)
  for (const line of content.metadataLines) {
    if (!line.trim()) {
      continue
    }

    const formattedLine = formatMetadataKeys(line)
    const segments = parseStrongMarkupSegments(formattedLine)
    const totalWidth = measureInlineSegmentsWidth(pdf, segments, "helvetica", LEGACY_METADATA_FONT_SIZE)
    if (totalWidth > maxWidth) {
      const plainLine = decodeHtmlEntities(stripStrongTags(formattedLine))
      const wrapped = pdf.splitTextToSize(plainLine, maxWidth) as string[]
      pdf.setFont("helvetica", "normal")
      pdf.setFontSize(LEGACY_METADATA_FONT_SIZE)
      for (const wrappedLine of wrapped) {
        ensureSpace(LEGACY_METADATA_LINE_HEIGHT)
        pdf.text(wrappedLine, PDF_MARGIN_X, y)
        y += LEGACY_METADATA_LINE_HEIGHT
      }
      continue
    }

    ensureSpace(LEGACY_METADATA_LINE_HEIGHT)
    let x = PDF_MARGIN_X
    for (const segment of segments) {
      pdf.setFont("helvetica", segment.isStrong ? "bold" : "normal")
      pdf.setFontSize(LEGACY_METADATA_FONT_SIZE)
      pdf.text(segment.text, x, y)
      x += pdf.getTextWidth(segment.text)
    }
    y += LEGACY_METADATA_LINE_HEIGHT
  }

  ensureSpace(1)
  pdf.setDrawColor(140)
  pdf.setLineWidth(0.8)
  pdf.line(PDF_MARGIN_X, y, PDF_MARGIN_X + maxWidth, y)
  y += LEGACY_DIVIDER_GAP

  const bodyText = content.bodyText || "Sem conteudo disponivel."
  const cleanedBody = cleanRawText(bodyText)
  const paragraphs = densityParagraphChunker(cleanedBody)
  const resolvedParagraphs =
    paragraphs.length > 0 ? paragraphs : [cleanedBody || bodyText]

  pdf.setFont("times", "normal")
  pdf.setFontSize(LEGACY_BODY_FONT_SIZE)
  pdf.setTextColor(31, 41, 55)

  resolvedParagraphs.forEach((paragraph, index) => {
    const wrappedLines = pdf.splitTextToSize(paragraph, maxWidth) as string[]
    for (const wrappedLine of wrappedLines) {
      ensureSpace(LEGACY_BODY_LINE_HEIGHT)
      pdf.text(wrappedLine, PDF_MARGIN_X, y)
      y += LEGACY_BODY_LINE_HEIGHT
    }

    if (index < resolvedParagraphs.length - 1) {
      if (y + LEGACY_BODY_PARAGRAPH_GAP > pageHeight - PDF_MARGIN_Y) {
        pdf.addPage()
        y = PDF_MARGIN_Y
      } else {
        y += LEGACY_BODY_PARAGRAPH_GAP
      }
    }
  })
}

function renderLegacyTextPdfFallback(pdf: jsPDF, normalizedText: string): void {
  const pageHeight = pdf.internal.pageSize.getHeight()
  const maxWidth = pdf.internal.pageSize.getWidth() - PDF_MARGIN_X * 2
  const logicalLines = normalizedText.split("\n")
  let y = PDF_MARGIN_Y

  for (let index = 0; index < logicalLines.length; index += 1) {
    const line = logicalLines[index].trimEnd()
    if (!line.trim()) {
      y += PDF_BLANK_LINE_HEIGHT
      continue
    }

    if (LEGACY_METADATA_SEPARATOR_REGEX.test(line.trim())) {
      if (y >= pageHeight - PDF_MARGIN_Y) {
        pdf.addPage()
        y = PDF_MARGIN_Y
      }

      pdf.setDrawColor(140)
      pdf.setLineWidth(0.8)
      pdf.line(PDF_MARGIN_X, y, PDF_MARGIN_X + maxWidth, y)
      y += 8
      continue
    }

    const isTitleLine = isPdfTitleLine(line, index)
    const isTableLine = isPdfTableLine(line)
    const fontSize = isTitleLine ? PDF_TITLE_FONT_SIZE : isTableLine ? PDF_TABLE_FONT_SIZE : PDF_BODY_FONT_SIZE
    const lineHeight = isTitleLine ? PDF_TITLE_LINE_HEIGHT : isTableLine ? PDF_TABLE_LINE_HEIGHT : PDF_BODY_LINE_HEIGHT

    const family = isTableLine ? "courier" : "helvetica"
    const weight = isTitleLine || isPdfTableHeaderLine(line) ? "bold" : "normal"
    pdf.setFont(family, weight)
    pdf.setFontSize(fontSize)

    const wrappedLines = pdf.splitTextToSize(line, maxWidth) as string[]
    for (const wrappedLine of wrappedLines) {
      if (y >= pageHeight - PDF_MARGIN_Y) {
        pdf.addPage()
        y = PDF_MARGIN_Y
      }

      pdf.text(wrappedLine, PDF_MARGIN_X, y)
      y += lineHeight
    }

    if (isTitleLine) {
      y += 2
    }

    if (y >= pageHeight - PDF_MARGIN_Y) {
      pdf.addPage()
      y = PDF_MARGIN_Y
    }
  }
}

function parseStrongMarkupSegments(markup: string): StrongMarkupSegment[] {
  const segments: StrongMarkupSegment[] = []
  const matcher = /<strong>(.*?)<\/strong>/gi
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = matcher.exec(markup)) !== null) {
    const start = match.index
    if (start > cursor) {
      segments.push({
        text: decodeHtmlEntities(markup.slice(cursor, start)),
        isStrong: false
      })
    }
    segments.push({
      text: decodeHtmlEntities(match[1]),
      isStrong: true
    })
    cursor = start + match[0].length
  }

  if (cursor < markup.length) {
    segments.push({
      text: decodeHtmlEntities(markup.slice(cursor)),
      isStrong: false
    })
  }

  return segments.filter((segment) => segment.text.length > 0)
}

function measureInlineSegmentsWidth(
  pdf: jsPDF,
  segments: StrongMarkupSegment[],
  family: string,
  fontSize: number
): number {
  let width = 0
  for (const segment of segments) {
    pdf.setFont(family, segment.isStrong ? "bold" : "normal")
    pdf.setFontSize(fontSize)
    width += pdf.getTextWidth(segment.text)
  }
  return width
}

function stripStrongTags(value: string): string {
  return String(value ?? "").replace(/<\/?strong>/gi, "")
}

function decodeHtmlEntities(value: string): string {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
}

function isPdfTitleLine(line: string, index: number): boolean {
  const trimmed = String(line ?? "").trim()
  if (!trimmed) {
    return false
  }

  return index === 0
}

function isPdfTableLine(line: string): boolean {
  const normalized = String(line ?? "").trim()
  if (!normalized) {
    return false
  }

  return normalized.includes("|")
}

function isPdfTableHeaderLine(line: string): boolean {
  const normalized = String(line ?? "").trim()
  return /^data\s+\|\s+dia\s+\|\s+horario\s+\|\s+local\s+\|\s+responsaveis$/i.test(normalized)
}

function normalizePdfText(value: string): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\r/g, "")
    .replace(/\t/g, "  ")
    .replace(/[^\x20-\x7E\u00C0-\u00FF\n\t]/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
