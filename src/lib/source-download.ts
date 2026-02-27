import { zipSync } from "fflate"
import { jsPDF } from "jspdf"

export type DownloadFormat = "markdown" | "text" | "pdf"

export interface SourceExportRecord {
  sourceId: string
  sourceTitle: string
  sourceUrl?: string
  sourceKind?: "youtube" | "document"
  summaryText: string
}

interface ZipFileRecord {
  filename: string
  bytes: Uint8Array
}

export function formatAsMarkdown(record: SourceExportRecord): string {
  const summary = normalizeSummaryText(record.summaryText, record.sourceKind)
  const lines = [
    `# ${record.sourceTitle}`,
    "",
    `- Source ID: ${record.sourceId}`,
    record.sourceUrl ? `- URL: ${record.sourceUrl}` : "",
    `- Tipo: ${record.sourceKind ?? "document"}`,
    "",
    summary
  ].filter(Boolean)

  return lines.join("\n")
}

export function formatAsText(record: SourceExportRecord): string {
  const summary = normalizeSummaryText(record.summaryText, record.sourceKind)
  const lines = [
    record.sourceTitle.toUpperCase(),
    "=".repeat(Math.max(16, record.sourceTitle.length)),
    `Source ID: ${record.sourceId}`,
    record.sourceUrl ? `URL: ${record.sourceUrl}` : "",
    `Tipo: ${record.sourceKind ?? "document"}`,
    "",
    summary
  ].filter(Boolean)

  return lines.join("\n")
}

export function buildPdfBytesFromText(text: string): Uint8Array {
  const pdf = new jsPDF({
    unit: "pt",
    format: "a4",
    compress: true
  })

  const normalized = normalizePdfText(text)
  const marginX = 42
  const marginY = 46
  const lineHeight = 14
  const pageHeight = pdf.internal.pageSize.getHeight()
  const maxWidth = pdf.internal.pageSize.getWidth() - marginX * 2

  pdf.setFont("helvetica", "normal")
  pdf.setFontSize(11)

  const lines = pdf.splitTextToSize(normalized, maxWidth) as string[]
  let y = marginY

  for (const line of lines) {
    if (y >= pageHeight - marginY) {
      pdf.addPage()
      y = marginY
    }
    pdf.text(line, marginX, y)
    y += lineHeight
  }

  return new Uint8Array(pdf.output("arraybuffer") as ArrayBuffer)
}

export function buildZip(files: ZipFileRecord[]): Uint8Array {
  if (files.length === 0) {
    throw new Error("Nenhum arquivo para compactar em ZIP.")
  }

  const archive: Record<string, Uint8Array> = {}
  for (const file of files) {
    if (!file.filename || file.bytes.length === 0) {
      throw new Error("Arquivo invalido durante compactacao ZIP.")
    }
    archive[file.filename] = file.bytes
  }

  return zipSync(archive, { level: 0 })
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export function sanitizeFilename(name: string): string {
  const base = name
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  return base.length > 0 ? base.slice(0, 90) : "fonte"
}

export function buildUniqueFilename(
  title: string,
  extension: string,
  usedNames: Set<string>
): string {
  const safeBase = sanitizeFilename(title)
  const ext = extension.startsWith(".") ? extension : `.${extension}`

  let candidate = `${safeBase}${ext}`
  let count = 2
  while (usedNames.has(candidate)) {
    candidate = `${safeBase} (${count})${ext}`
    count++
  }

  usedNames.add(candidate)
  return candidate
}

export function snippetsToSummaryText(
  snippets: string[],
  sourceKind: SourceExportRecord["sourceKind"]
): string {
  if (!Array.isArray(snippets) || snippets.length === 0) {
    throw new Error("Snippets reais obrigatorios para gerar exportacao.")
  }

  const unique = new Set<string>()
  const cleaned: string[] = []

  for (const snippet of snippets) {
    const normalized = normalizeLine(snippet)
    if (!normalized || unique.has(normalized)) {
      continue
    }
    unique.add(normalized)
    cleaned.push(normalized)
  }

  if (cleaned.length === 0) {
    throw new Error("Nao foi possivel gerar conteudo limpo para exportacao.")
  }

  if (sourceKind === "youtube") {
    return cleaned.join(" ").replace(/\s{2,}/g, " ").trim()
  }

  return cleaned.join("\n\n")
}

function normalizeSummaryText(
  text: string,
  sourceKind: SourceExportRecord["sourceKind"]
): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeLine(line))
    .filter((line): line is string => !!line)

  if (sourceKind === "youtube") {
    return lines.join(" ").replace(/\s{2,}/g, " ").trim()
  }

  return lines.join("\n")
}

function normalizeLine(value: string): string | null {
  const line = value
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()

  if (!line) {
    return null
  }

  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(line)
  ) {
    return null
  }

  if (/^[A-Za-z0-9/_+=-]{24,}$/.test(line) && !line.includes(" ")) {
    return null
  }

  if (/^[\[\]{}(),.:;_-]{1,8}$/.test(line)) {
    return null
  }

  return line
}

function normalizePdfText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\r/g, "")
    .replace(/[^\x20-\x7EÀ-ÿ\n\t]/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
