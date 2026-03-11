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

export function buildPdfBytesFromText(text: string): Uint8Array {
  const pdf = new jsPDF({
    unit: "pt",
    format: "a4",
    compress: true
  })

  const normalized = normalizePdfText(text)
  const pageHeight = pdf.internal.pageSize.getHeight()
  const maxWidth = pdf.internal.pageSize.getWidth() - PDF_MARGIN_X * 2
  const logicalLines = normalized.split("\n")
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

  return new Uint8Array(pdf.output("arraybuffer") as ArrayBuffer)
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
