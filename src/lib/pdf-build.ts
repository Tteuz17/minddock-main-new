import { jsPDF } from "jspdf"

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

interface ParsedChatPdfMessage {
  role: "user" | "model"
  content: string
}

interface ParsedChatPdfDocument {
  title: string
  exportedAt: string
  messages: ParsedChatPdfMessage[]
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

    if (!exportedAt && /^exportado em:/i.test(trimmed)) {
      exportedAt = trimmed.replace(/^exportado em:\s*/i, "").trim()
      continue
    }

    const roleHeaderMatch = trimmed.match(/^##\s+(usuario|notebooklm)\s*$/i)
    if (roleHeaderMatch) {
      flushCurrent()
      currentRole = roleHeaderMatch[1].toLowerCase() === "usuario" ? "user" : "model"
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

function renderChatStyledPdf(pdf: jsPDF, doc: ParsedChatPdfDocument): void {
  const pageHeight = pdf.internal.pageSize.getHeight()
  const maxWidth = pdf.internal.pageSize.getWidth() - PDF_MARGIN_X * 2
  const cardWidth = maxWidth
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
  pdf.setFontSize(22)
  const titleLines = pdf.splitTextToSize(doc.title || "NotebookLM", maxWidth) as string[]
  for (const line of titleLines) {
    ensureSpace(24)
    pdf.text(line, PDF_MARGIN_X, y)
    y += 24
  }

  if (doc.exportedAt) {
    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(10)
    pdf.setTextColor(107, 114, 128)
    ensureSpace(16)
    pdf.text(`Exportado em: ${doc.exportedAt}`, PDF_MARGIN_X, y)
    y += 20
  } else {
    y += 8
  }

  for (const message of doc.messages) {
    const roleLabel = message.role === "user" ? "Usuario" : "NotebookLM"
    const roleColor: [number, number, number] = message.role === "user" ? [96, 165, 250] : [52, 211, 153]
    const contentWidth = cardWidth - PDF_CHAT_CARD_PADDING_X * 2 - PDF_CHAT_LEFT_BAR_WIDTH - 6

    const contentLines: string[] = []
    for (const paragraph of message.content.split("\n")) {
      const trimmed = paragraph.trim()
      if (!trimmed) {
        contentLines.push("")
        continue
      }

      const wrapped = pdf.splitTextToSize(trimmed, contentWidth) as string[]
      for (const wrappedLine of wrapped) {
        contentLines.push(String(wrappedLine))
      }
    }

    const contentHeight = contentLines.reduce((height, line) => {
      if (!line.trim()) {
        return height + 7
      }
      return height + PDF_BODY_LINE_HEIGHT
    }, 0)

    const cardHeight = Math.max(
      PDF_CHAT_CARD_MIN_HEIGHT,
      PDF_CHAT_CARD_PADDING_Y * 2 + PDF_CHAT_HEADER_HEIGHT + 6 + contentHeight
    )

    ensureSpace(cardHeight)

    const x = PDF_MARGIN_X
    pdf.setFillColor(255, 255, 255)
    pdf.setDrawColor(229, 231, 235)
    pdf.setLineWidth(0.8)
    pdf.roundedRect(x, y, cardWidth, cardHeight, 8, 8, "FD")

    pdf.setFillColor(roleColor[0], roleColor[1], roleColor[2])
    pdf.roundedRect(x + 0.8, y + 0.8, PDF_CHAT_LEFT_BAR_WIDTH, cardHeight - 1.6, 2, 2, "F")

    pdf.setFont("helvetica", "bold")
    pdf.setFontSize(12)
    pdf.setTextColor(17, 24, 39)
    let textY = y + PDF_CHAT_CARD_PADDING_Y + 10
    pdf.text(roleLabel, x + PDF_CHAT_CARD_PADDING_X + PDF_CHAT_LEFT_BAR_WIDTH + 4, textY)
    textY += 16

    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(PDF_BODY_FONT_SIZE)
    pdf.setTextColor(31, 41, 55)
    for (const line of contentLines) {
      if (!line.trim()) {
        textY += 7
        continue
      }
      pdf.text(line, x + PDF_CHAT_CARD_PADDING_X + PDF_CHAT_LEFT_BAR_WIDTH + 4, textY)
      textY += PDF_BODY_LINE_HEIGHT
    }

    y += cardHeight + PDF_CHAT_CARD_GAP
  }
}

function renderLegacyTextPdf(pdf: jsPDF, normalizedText: string): void {
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

    if (/^[-=]{4,}$/.test(line.trim())) {
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
