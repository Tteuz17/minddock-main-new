import {
  analyzeDocumentType,
  renderMarkdownOut,
  renderPlainTextOut
} from "~/lib/text-formatting-engine"
import { cleanRawText, densityParagraphChunker, formatMetadataKeys } from "~/lib/PdfContentFormatter"
import { zipSync } from "fflate"

export type DownloadFormat = "markdown" | "text" | "pdf" | "docx"

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

const WEEKDAY_PREFIX_REGEX_SOURCE = "(?:Segunda|Ter(?:\\u00E7a|ca)|Quarta|Quinta|Sexta)"
const DAY_NAME_REGEX_SOURCE = `(?:${WEEKDAY_PREFIX_REGEX_SOURCE}(?:[- ]?feira)?|S(?:\\u00E1|a)bado|Domingo)`
const DATE_DAY_REGEX_SOURCE = `(?:[0-2]?\\d|3[01])\\s+${DAY_NAME_REGEX_SOURCE}`
const DATE_DAY_LINE_PREFIX = new RegExp(`^${DATE_DAY_REGEX_SOURCE}\\b`, "iu")
const SPLIT_BEFORE_DATE_DAY = new RegExp(`([^\\n])\\s+(${DATE_DAY_REGEX_SOURCE}\\b)`, "giu")
const SPLIT_SLASH_DATE_DAY = new RegExp(`[|/]\\s*(${DATE_DAY_REGEX_SOURCE}\\b)`, "giu")
const LOCAL_KEYWORD_REGEX = /\b(matriz|igreja|paroquia|par[o\u00F3]quia|capela|missa|crisma|confiss(?:o|\u00F5)es)\b/iu
const DAY_AND_DETAIL_REGEX = new RegExp(
  `^(?<date>[0-2]?\\d|3[01])\\s+(?<day>${DAY_NAME_REGEX_SOURCE})(?:\\s+(?<detail>.*))?$`,
  "iu"
)
const TRAILING_ASSIGNEE_AFTER_LOCAL_REGEX =
  /^(?<local>.*\b(?:Matriz|Igreja|Par[o\u00F3]quia|Capela|Crisma|Confiss(?:\u00F5|o)es|S(?:\u00E3|a)o\s+[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+(?:\s+[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+){0,2})\b)\s+(?<assignee>[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+(?:\s+[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+){0,4})$/u

const ARTICLE_MARKER_SOURCE =
  "(?:Introdu(?:\\u00E7|c)[a\\u00E3]o|Objetivo(?:\\s+Geral)?|Contexto|Conclus[a\\u00E3]o|Aplica(?:\\u00E7|c)[a\\u00E3]o(?:\\s+Pr[a\\u00E1]tica)?|Exemplo(?:s)?|Resumo|Desenvolvimento|Fundamenta(?:\\u00E7|c)[a\\u00E3]o|Metodologia|Mensagem\\s+Central|Problema|Solu(?:\\u00E7|c)[a\\u00E3]o)"
const ARTICLE_MARKER_STANDALONE = new RegExp(`^${ARTICLE_MARKER_SOURCE}$`, "iu")
const ARTICLE_MARKER_PREFIX = "__MINDDOCK_ARTICLE_MARKER__::"
const CONVERSATION_IMPORT_LINE_REGEX = /^>?\s*importado\s+do\s+.+\s+via\s+minddock\b/iu
const CONVERSATION_IMPORT_PLATFORM_REGEX =
  /^>?\s*importado\s+do\s+(?<platform>.+?)\s+via\s+minddock\b/iu
const CONVERSATION_TITLE_HINT_REGEX =
  /^\s*(?:#\s*)?\[(?<platform>chatgpt|gemini|claude|perplexity)\]/iu
const CONVERSATION_ROLE_TOKEN_SOURCE =
  "usuario|usu[a\\u00E1]rio|voce|voc[\\u00EA]|user|chatgpt|gemini|claude|perplexity|assistant|assistente|ia|modelo"
const CONVERSATION_ROLE_LINE_REGEX = new RegExp(
  `^(?<label>${CONVERSATION_ROLE_TOKEN_SOURCE})\\s*:\\s*(?<rest>.*)$`,
  "iu"
)
const CONVERSATION_INLINE_ROLE_TOKEN_REGEX = new RegExp(
  `(?<label>${CONVERSATION_ROLE_TOKEN_SOURCE})\\s*:`,
  "giu"
)

type ExportSummaryMode = "markdown" | "text" | "pdf"
const PLAIN_METADATA_SEPARATOR = "----------------------------------------"
interface ScheduleRow {
  date: string
  day: string
  time: string
  location: string
  assignees: string
}

interface ParsedScheduleDocument {
  introLines: string[]
  rows: ScheduleRow[]
  tailLines: string[]
}

interface ConversationMessage {
  role: "user" | "assistant"
  label: string
  content: string
}

interface ParsedConversationDocument {
  importLine: string | null
  messages: ConversationMessage[]
}

export function formatAsMarkdown(record: SourceExportRecord): string {
  const summary = resolveDisplaySummary(record, "markdown")
  const lines = [
    `# ${record.sourceTitle}`,
    "",
    `Source ID: ${record.sourceId}`,
    record.sourceUrl ? `URL: ${record.sourceUrl}` : "",
    `Tipo: ${record.sourceKind ?? "document"}`,
    "---",
    "",
    summary || "_Sem conteudo disponivel._"
  ].filter(Boolean)

  return lines.join("\n")
}

export function formatAsText(record: SourceExportRecord): string {
  const summary = resolveDisplaySummary(record, "text")
  const lines = [
    record.sourceTitle.toUpperCase(),
    "=".repeat(Math.max(16, record.sourceTitle.length)),
    `Source ID: ${record.sourceId}`,
    record.sourceUrl ? `URL: ${record.sourceUrl}` : "",
    `Tipo: ${record.sourceKind ?? "document"}`,
    "",
    PLAIN_METADATA_SEPARATOR,
    "",
    summary || "Sem conteudo disponivel."
  ].filter(Boolean)

  return lines.join("\n")
}

export function formatAsPdfText(record: SourceExportRecord): string {
  const summary = resolveDisplaySummary(record, "pdf")
  const lines = [
    record.sourceTitle,
    "",
    `Source ID: ${record.sourceId}`,
    record.sourceUrl ? `URL: ${record.sourceUrl}` : "",
    `Tipo: ${record.sourceKind ?? "document"}`,
    "",
    PLAIN_METADATA_SEPARATOR,
    "",
    summary || "Sem conteudo disponivel."
  ].filter(Boolean)

  return lines.join("\n")
}

export function formatAsDocxText(record: SourceExportRecord): string {
  const summary = resolveDisplaySummary(record, "text")
  const lines = [
    record.sourceTitle,
    "",
    `Source ID: ${record.sourceId}`,
    record.sourceUrl ? `URL: ${record.sourceUrl}` : "",
    `Tipo: ${record.sourceKind ?? "document"}`,
    "",
    PLAIN_METADATA_SEPARATOR,
    "",
    summary || "Sem conteudo disponivel."
  ].filter(Boolean)

  return lines.join("\n")
}

export async function buildDocxBytesFromText(text: string): Promise<Uint8Array> {
  const normalized = String(text ?? "").replace(/\r\n?/g, "\n").trim()
  const safeText = normalized || "Sem conteudo disponivel."
  const isChatExport = looksLikeChatExportText(safeText)

  let paragraphXml = ""
  if (isChatExport) {
    const chatText = normalizeChatExportTextForDocx(safeText)
    paragraphXml = buildChatDocxParagraphs(chatText)
  } else {
    const structured = parseStructuredDocxContent(safeText)
    paragraphXml = structured ? buildStructuredDocxParagraphs(structured) : buildPlainDocxParagraphs(safeText)
  }

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

  const packageRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphXml}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`

  const encoder = new TextEncoder()
  return zipSync(
    {
      "[Content_Types].xml": encoder.encode(contentTypesXml),
      "_rels/.rels": encoder.encode(packageRelsXml),
      "word/document.xml": encoder.encode(documentXml)
    },
    { level: 0 }
  )
}

interface StructuredDocxContent {
  title: string
  metadataLines: string[]
  bodyText: string
}

interface DocxRunSegment {
  text: string
  isBold: boolean
}

const DOCX_METADATA_SEPARATOR_REGEX = /^[-=]{4,}$/
const DOCX_TITLE_FONT_SIZE = 36
const DOCX_METADATA_FONT_SIZE = 22
const DOCX_BODY_FONT_SIZE = 24
const DOCX_BODY_LINE_SPACING = 384
const DOCX_BODY_MARGIN_AFTER = 360
const DOCX_DIVIDER_MARGIN = 600
const DOCX_CHAT_ROLE_REGEX = /^\d+\.\s+(User|NotebookLM)\b/
const DOCX_CHAT_FONT_SIZE = 28

function looksLikeChatExportText(text: string): boolean {
  const lines = String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length < 4) {
    return false
  }

  const hasMessageCount = lines.some((line) => /^mensagens:\s*\d+/i.test(line))
  const hasNumberedTurn = lines.some((line) => /^\d+\.\s+\S+/.test(line))

  return hasMessageCount && hasNumberedTurn
}

function normalizeChatExportTextForDocx(text: string): string {
  const rawLines = String(text ?? "").split("\n")
  const normalizedLines: string[] = []

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim()
    if (!trimmed) {
      normalizedLines.push("")
      continue
    }

    const exportedWithMessages = splitExportedAtAndMessages(trimmed)
    if (exportedWithMessages.length > 1) {
      normalizedLines.push(...exportedWithMessages, "")
      continue
    }

    const splitBySeparator = splitSeparatorLine(trimmed)
    if (splitBySeparator.length > 1) {
      normalizedLines.push(...splitBySeparator, "")
      continue
    }

    if (DOCX_CHAT_ROLE_REGEX.test(trimmed)) {
      normalizedLines.push(trimmed.endsWith(":") ? trimmed : `${trimmed}:`)
      continue
    }

    normalizedLines.push(rawLine)
  }

  return normalizedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

function buildChatDocxParagraphs(text: string): string {
  const lines = String(text ?? "").split("\n")
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0)
  const paragraphs: string[] = []

  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) {
      paragraphs.push("<w:p/>")
      return
    }

    const isTitle = index === firstContentIndex
    const isExported = /^Exported at:/i.test(trimmed)
    const isMessages = /^Mensagens:/i.test(trimmed)
    const isRoleLine = DOCX_CHAT_ROLE_REGEX.test(trimmed)
    const shouldBold = isTitle || isExported || isMessages || isRoleLine

    paragraphs.push(buildChatDocxParagraph(trimmed, shouldBold))
  })

  return paragraphs.join("")
}

function buildChatDocxParagraph(text: string, bold: boolean): string {
  const run = buildChatDocxRun(text, {
    bold,
    size: DOCX_CHAT_FONT_SIZE
  })
  return `<w:p>${run}</w:p>`
}

interface ChatDocxRunOptions {
  size: number
  bold?: boolean
}

function buildChatDocxRun(text: string, options: ChatDocxRunOptions): string {
  const safeText = escapeXml(text)
  const boldMarkup = options.bold ? "<w:b/><w:bCs/>" : ""
  return `<w:r><w:rPr>${boldMarkup}<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/></w:rPr><w:t xml:space="preserve">${safeText}</w:t></w:r>`
}

function splitExportedAtAndMessages(line: string): string[] {
  const match = line.match(/^(?<exported>Exported at:.*?)(?<messages>\bMensagens:\s*\d+.*)$/i)
  if (!match?.groups) {
    return [line]
  }

  const exported = match.groups.exported.trim()
  const messages = match.groups.messages.trim()
  if (!exported || !messages) {
    return [line]
  }

  return [exported, messages]
}

function splitSeparatorLine(line: string): string[] {
  const separatorMatch = line.match(/-{4,}/)
  if (!separatorMatch) {
    return [line]
  }

  const separator = separatorMatch[0]
  const index = line.indexOf(separator)
  const before = line.slice(0, index).trim()
  const after = line.slice(index + separator.length).trim()

  const parts: string[] = []
  if (before) {
    parts.push(before)
  }
  parts.push(separator)
  if (after) {
    parts.push(after)
  }

  return parts.length > 1 ? parts : [line]
}

function parseStructuredDocxContent(text: string): StructuredDocxContent | null {
  const lines = String(text ?? "").split("\n")
  const dividerIndex = lines.findIndex((line) => DOCX_METADATA_SEPARATOR_REGEX.test(line.trim()))
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

function buildStructuredDocxParagraphs(content: StructuredDocxContent): string {
  const paragraphs: string[] = []

  paragraphs.push(
    buildDocxParagraph(
      buildDocxRun(content.title || "Documento", {
        font: "Inter",
        bold: true,
        size: DOCX_TITLE_FONT_SIZE
      }),
      {
        spacingAfter: 160
      }
    )
  )

  for (const metadataLine of content.metadataLines) {
    const formatted = formatMetadataKeys(metadataLine)
    const segments = parseStrongMarkupSegments(formatted)
    const runs = segments
      .map((segment) =>
        buildDocxRun(segment.text, {
          font: "Inter",
          bold: segment.isBold,
          size: DOCX_METADATA_FONT_SIZE
        })
      )
      .join("")

    paragraphs.push(
      buildDocxParagraph(runs, {
        spacingAfter: 120
      })
    )
  }

  paragraphs.push(
    buildDocxParagraph("", {
      spacingBefore: DOCX_DIVIDER_MARGIN,
      spacingAfter: DOCX_DIVIDER_MARGIN,
      borderBottom: true
    })
  )

  const cleanedBody = cleanRawText(content.bodyText || "Sem conteudo disponivel.")
  const chunks = densityParagraphChunker(cleanedBody)
  const resolvedChunks = chunks.length > 0 ? chunks : cleanedBody ? [cleanedBody] : []

  for (const chunk of resolvedChunks) {
    paragraphs.push(
      buildDocxParagraph(
        buildDocxRun(chunk, {
          font: "Merriweather",
          size: DOCX_BODY_FONT_SIZE
        }),
        {
          spacingAfter: DOCX_BODY_MARGIN_AFTER,
          lineSpacing: DOCX_BODY_LINE_SPACING,
          justify: "both"
        }
      )
    )
  }

  return paragraphs.join("")
}

function buildPlainDocxParagraphs(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (!line.trim()) {
        return "<w:p/>"
      }
      return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`
    })
    .join("")
}

interface DocxRunOptions {
  font: string
  size: number
  bold?: boolean
}

function buildDocxRun(text: string, options: DocxRunOptions): string {
  const safeText = escapeXml(text)
  const boldMarkup = options.bold ? "<w:b/><w:bCs/>" : ""
  return `<w:r><w:rPr>${boldMarkup}<w:rFonts w:ascii="${options.font}" w:hAnsi="${options.font}" w:cs="${options.font}"/><w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/></w:rPr><w:t xml:space="preserve">${safeText}</w:t></w:r>`
}

interface DocxParagraphOptions {
  spacingBefore?: number
  spacingAfter?: number
  lineSpacing?: number
  justify?: "left" | "both"
  borderBottom?: boolean
}

function buildDocxParagraph(runsXml: string, options: DocxParagraphOptions): string {
  const spacingParts: string[] = []
  if (options.spacingBefore !== undefined) {
    spacingParts.push(`w:before="${options.spacingBefore}"`)
  }
  if (options.spacingAfter !== undefined) {
    spacingParts.push(`w:after="${options.spacingAfter}"`)
  }
  if (options.lineSpacing !== undefined) {
    spacingParts.push(`w:line="${options.lineSpacing}"`, `w:lineRule="auto"`)
  }
  const spacingMarkup = spacingParts.length > 0 ? `<w:spacing ${spacingParts.join(" ")}/>` : ""
  const justifyMarkup = options.justify ? `<w:jc w:val="${options.justify}"/>` : ""
  const borderMarkup = options.borderBottom
    ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D1D5DB"/></w:pBdr>`
    : ""

  const paragraphProps = spacingMarkup || justifyMarkup || borderMarkup
    ? `<w:pPr>${spacingMarkup}${justifyMarkup}${borderMarkup}</w:pPr>`
    : ""

  return `<w:p>${paragraphProps}${runsXml}</w:p>`
}

function parseStrongMarkupSegments(markup: string): DocxRunSegment[] {
  const segments: DocxRunSegment[] = []
  const matcher = /<strong>(.*?)<\/strong>/gi
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = matcher.exec(markup)) !== null) {
    const start = match.index
    if (start > cursor) {
      const text = decodeHtmlEntities(markup.slice(cursor, start))
      if (text) {
        segments.push({ text, isBold: false })
      }
    }

    const strongText = decodeHtmlEntities(match[1])
    if (strongText) {
      segments.push({ text: strongText, isBold: true })
    }

    cursor = start + match[0].length
  }

  if (cursor < markup.length) {
    const tail = decodeHtmlEntities(markup.slice(cursor))
    if (tail) {
      segments.push({ text: tail, isBold: false })
    }
  }

  return segments
}

function decodeHtmlEntities(value: string): string {
  return String(value ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
}

export async function buildZip(files: ZipFileRecord[]): Promise<Uint8Array> {
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

export type MindDuckFilenameKind = "Font" | "Chat" | "Studio"

export function buildMindDuckFilenameBase(
  kind: MindDuckFilenameKind,
  title: string,
  date: Date = new Date()
): string {
  const shortTitle = buildFourWordTitleSlug(title)
  const dateStamp = buildDateStamp(date)
  return `MindDock-${kind}-${shortTitle}-${dateStamp}`
}

export function buildMindDockZipBase(label: string, date: Date = new Date()): string {
  const shortLabel = buildFourWordTitleSlug(label)
  const dateStamp = buildDateStamp(date)
  return `MindDock-${shortLabel}-${dateStamp}`
}

export function buildUniqueFilename(
  title: string,
  extension: string,
  usedNames: Set<string>
): string {
  const safeBase = buildMindDuckFilenameBase("Font", title)
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

function buildFourWordTitleSlug(title: string): string {
  const normalized = String(title ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase()

  if (!normalized) {
    return "notebooklm"
  }

  const words = normalized.split(/\s+/).filter(Boolean)
  const limited = words.slice(0, 4)
  const slug = limited.length > 0 ? limited.join("-") : "notebooklm"
  return slug.slice(0, 40)
}

function buildDateStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(date.getDate())}_${pad(date.getMonth() + 1)}_${date.getFullYear()}`
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

  return cleaned
    .map((snippet) => formatReadableParagraphs(snippet, sourceKind))
    .filter((snippet): snippet is string => snippet.trim().length > 0)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function resolveDisplaySummary(record: SourceExportRecord, mode: ExportSummaryMode): string {
  const summary = normalizeSummaryText(record.summaryText, record.sourceKind)
  if (!summary) {
    return ""
  }

  const withoutEcho = stripLeadingTitleEcho(summary, record.sourceTitle)
  const scheduleRendered = renderScheduleTableIfDetected(withoutEcho, mode)
  const hasScheduleStructure = scheduleRendered !== withoutEcho
  if (hasScheduleStructure) {
    return scheduleRendered
  }

  const analysis = analyzeDocumentType(withoutEcho, hasScheduleStructure)
  if (analysis.documentType === "chat") {
    return mode === "markdown"
      ? renderMarkdownOut({
          ...analysis.parsedDocument,
          title: "",
          metadata: []
        })
      : renderPlainTextOut({
          ...analysis.parsedDocument,
          title: "",
          metadata: []
        })
  }

  return renderArticleModeIfNeeded(analysis.restoredText, mode)
}

function normalizeSummaryText(
  text: string,
  sourceKind: SourceExportRecord["sourceKind"]
): string {
  const normalized = normalizeLine(text)
  if (!normalized) {
    return ""
  }

  return formatReadableParagraphs(normalized, sourceKind)
}

function normalizeLine(value: string): string | null {
  const normalizedInput = injectStructuralBreaks(value)

  const rows = normalizedInput
    .split("\n")
    .map((row) => cleanInlineArtifacts(row))
    .map((row) => row.replace(/[ \t\f\v\u00A0]+/g, " ").trim())
    .filter((row) => row.length > 0)
    .filter((row) => !isNoiseRow(row))

  if (rows.length === 0) {
    return null
  }

  return rows.join("\n")
}

function cleanInlineArtifacts(value: string): string {
  const input = String(value ?? "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, " ")
    .replace(/\b[A-Za-z0-9/_+=-]{28,}\b/g, " ")

  return input
    .replace(/\bGoogle\s+Sans(?:\s+Text)?\b/giu, " ")
    .replace(/\b(?:Tab|Aba)\s+\d+\b/giu, " ")
    .replace(/\bText\b(?=\s+[A-ZÀ-ÖØ-Ý])/gu, " ")
}

function isNoiseRow(line: string): boolean {
  if (!line) {
    return true
  }

  if (/^[\[\]{}(),.:;_-]{1,8}$/.test(line)) {
    return true
  }

  if (/^[A-Za-z0-9/_+=-]{24,}$/.test(line) && !line.includes(" ")) {
    return true
  }

  return false
}

function formatReadableParagraphs(
  text: string,
  sourceKind: SourceExportRecord["sourceKind"]
): string {
  const base = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  if (!base) {
    return ""
  }

  const lines = base.split("\n")
  const formatted: string[] = []
  const paragraphBuffer: string[] = []

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) {
      return
    }

    const merged = paragraphBuffer
      .join(" ")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .trim()

    if (merged) {
      formatted.push(...splitMergedParagraphs(merged))
    }

    paragraphBuffer.length = 0
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      if (formatted.length > 0 && formatted[formatted.length - 1] !== "") {
        formatted.push("")
      }
      continue
    }

    if (isAgendaEntryLine(line)) {
      flushParagraph()
      formatted.push(formatAgendaEntryLine(line))
      continue
    }

    if (isStructuralContentLine(line, sourceKind)) {
      flushParagraph()
      formatted.push(line)
      continue
    }

    paragraphBuffer.push(line)
  }

  flushParagraph()

  return formatted
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n-\s+([0-2]?\d|3[01])\s+/g, "\n- $1 ")
    .replace(/\n{2,}(-\s)/g, "\n$1")
    .trim()
}

function isStructuralContentLine(
  line: string,
  sourceKind: SourceExportRecord["sourceKind"]
): boolean {
  if (isAgendaEntryLine(line)) {
    return true
  }

  if (isConversationMarkerLine(line)) {
    return true
  }

  if (
    /^#{1,6}\s/.test(line) ||
    /^[-*]\s/.test(line) ||
    /^\d+[.)]\s/.test(line) ||
    /^\|.+\|$/.test(line) ||
    /^={3,}$/.test(line) ||
    /^-{3,}$/.test(line)
  ) {
    return true
  }

  if (/^[A-Z0-9][A-Z0-9\s/_-]{5,}:$/.test(line)) {
    return true
  }

  if (sourceKind === "youtube" && /^(\d{1,2}:)?\d{1,2}:\d{2}(\s+-\s+|\s+)/.test(line)) {
    return true
  }

  return false
}

function isConversationMarkerLine(line: string): boolean {
  const normalized = String(line ?? "").trim()
  if (!normalized) {
    return false
  }

  if (CONVERSATION_IMPORT_LINE_REGEX.test(normalized)) {
    return true
  }

  const roleLine = parseConversationRoleLine(normalized, null)
  return roleLine !== null
}

function stripLeadingTitleEcho(text: string, sourceTitle: string): string {
  const value = String(text ?? "").trim()
  const title = String(sourceTitle ?? "")
    .replace(/\s+/g, " ")
    .trim()

  if (!value || !title) {
    return value
  }

  const repeatedTitleRegex = new RegExp(`^(?:${escapeRegExp(title)}[\\s:|\\-_/]*){1,2}`, "i")
  const withoutEcho = value.replace(repeatedTitleRegex, "").trim()
  return withoutEcho || value
}

function escapeRegExp(value: string): string {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function injectStructuralBreaks(value: string): string {
  const base = String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\bGoogle\s+Sans(?:\s+Text)?\b/giu, " ")
    .replace(/\b(?:Tab|Aba)\s+\d+\b/giu, "\n")
    .replace(/\*{4,}/g, "\n")
    .replace(/[ \t]{2,}/g, " ")

  return base
    .replace(SPLIT_SLASH_DATE_DAY, "\n$1")
    .replace(SPLIT_BEFORE_DATE_DAY, "$1\n$2")
    .replace(/\n{3,}/g, "\n\n")
}

function splitMergedParagraphs(text: string): string[] {
  const normalized = String(text ?? "")
    .replace(/\s{2,}/g, " ")
    .trim()
  if (!normalized) {
    return []
  }

  const sentenceLikeParts = normalized
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Ý])/u)
    .map((part) => part.trim())
    .filter(Boolean)

  if (sentenceLikeParts.length <= 1) {
    if (normalized.length <= 420) {
      return [normalized]
    }
    return splitParagraphByWordBudget(normalized, 52)
  }

  const result: string[] = []
  let buffer = ""
  let sentenceCount = 0

  for (const sentence of sentenceLikeParts) {
    const candidate = buffer ? `${buffer} ${sentence}` : sentence
    const shouldWrap = buffer.length > 0 && (candidate.length > 420 || sentenceCount >= 3)

    if (shouldWrap) {
      result.push(buffer.trim())
      buffer = sentence
      sentenceCount = 1
      continue
    }

    buffer = candidate
    sentenceCount += 1
  }

  if (buffer.trim()) {
    result.push(buffer.trim())
  }

  return result.length > 0 ? result : [normalized]
}

function splitParagraphByWordBudget(text: string, wordsPerBlock: number): string[] {
  const words = String(text ?? "")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)

  if (words.length === 0) {
    return []
  }

  if (words.length <= wordsPerBlock) {
    return [words.join(" ")]
  }

  const chunks: string[] = []
  for (let index = 0; index < words.length; index += wordsPerBlock) {
    const chunk = words.slice(index, index + wordsPerBlock).join(" ").trim()
    if (chunk) {
      chunks.push(chunk)
    }
  }

  return chunks.length > 0 ? chunks : [text]
}

function isAgendaEntryLine(line: string): boolean {
  return DATE_DAY_LINE_PREFIX.test(String(line ?? "").trim())
}

function formatAgendaEntryLine(line: string): string {
  const compact = String(line ?? "")
    .replace(/\s*[|/]\s*/g, " | ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\|\s+/g, " | ")
    .trim()

  if (!compact) {
    return ""
  }

  return compact.startsWith("- ") ? compact : `- ${compact}`
}

function renderScheduleTableIfDetected(text: string, mode: ExportSummaryMode): string {
  const parsed = parseScheduleDocument(text)
  if (!parsed) {
    return text
  }

  if (mode === "markdown") {
    return renderScheduleMarkdown(parsed)
  }

  return renderSchedulePlainText(parsed)
}

function renderConversationModeIfDetected(text: string, mode: ExportSummaryMode): string {
  const parsed = parseConversationDocument(text)
  if (!parsed) {
    return text
  }

  const sections: string[] = []
  if (parsed.importLine) {
    const importText = cleanConversationLine(parsed.importLine)
    if (importText) {
      sections.push(mode === "markdown" ? `> ${importText}` : importText)
      sections.push(mode === "markdown" ? "---" : PLAIN_METADATA_SEPARATOR)
    }
  }

  parsed.messages.forEach((message, index) => {
    const heading = mode === "markdown" ? `### ${message.label}` : message.label.toUpperCase()
    const body = formatConversationBody(message.content)
    if (!body) {
      return
    }

    sections.push(`${heading}\n\n${body}`)
    if (index < parsed.messages.length - 1) {
      sections.push(mode === "markdown" ? "---" : PLAIN_METADATA_SEPARATOR)
    }
  })

  return sections
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function parseConversationDocument(text: string): ParsedConversationDocument | null {
  const rawLines = String(text ?? "")
    .split("\n")
    .map((line) => String(line ?? "").trim())
    .filter(Boolean)

  if (rawLines.length === 0) {
    return null
  }

  const hasImportSignal = rawLines.some((line) => CONVERSATION_IMPORT_LINE_REGEX.test(line))
  const hasTitleSignal = rawLines.some((line) => CONVERSATION_TITLE_HINT_REGEX.test(line))
  let platformHint = resolveConversationPlatformHint(rawLines)

  let importLine: string | null = null
  const preambleLines: string[] = []
  const messageEntries: Array<{ label: string; role: "user" | "assistant"; lines: string[] }> = []
  let currentMessage: { label: string; role: "user" | "assistant"; lines: string[] } | null = null

  const flushMessage = () => {
    if (!currentMessage) {
      return
    }

    const content = currentMessage.lines
      .map((line) => cleanConversationLine(line))
      .filter(Boolean)
      .join("\n")
      .trim()

    if (content) {
      messageEntries.push({
        label: currentMessage.label,
        role: currentMessage.role,
        lines: [content]
      })
    }

    currentMessage = null
  }

  for (const line of rawLines) {
    if (!importLine && CONVERSATION_IMPORT_LINE_REGEX.test(line)) {
      const splitImport = splitConversationImportLine(
        cleanConversationLine(line.replace(/^>\s*/, "")),
        platformHint
      )
      importLine = splitImport.importLine
      platformHint = resolveConversationPlatformHint(rawLines, importLine) ?? platformHint

      if (splitImport.roleTail) {
        const roleFromTail = parseConversationRoleLine(splitImport.roleTail, platformHint)
        if (roleFromTail) {
          flushMessage()
          currentMessage = {
            label: roleFromTail.label,
            role: roleFromTail.role,
            lines: roleFromTail.inlineContent ? [roleFromTail.inlineContent] : []
          }
        } else {
          preambleLines.push(splitImport.roleTail)
        }
      }
      continue
    }

    if (CONVERSATION_TITLE_HINT_REGEX.test(line)) {
      continue
    }

    const roleChunks = splitConversationRoleSegments(line)
    for (const chunk of roleChunks) {
      const roleLine = parseConversationRoleLine(chunk, platformHint)
      if (roleLine) {
        flushMessage()
        currentMessage = {
          label: roleLine.label,
          role: roleLine.role,
          lines: roleLine.inlineContent ? [roleLine.inlineContent] : []
        }
        continue
      }

      if (currentMessage) {
        currentMessage.lines.push(chunk)
        continue
      }

      preambleLines.push(chunk)
    }
  }

  flushMessage()

  const normalizedMessages = messageEntries
    .map((entry) => ({
      role: entry.role,
      label: entry.label,
      content: formatConversationBody(entry.lines.join("\n"))
    }))
    .filter((entry) => entry.content.length > 0)

  if (normalizedMessages.length === 0) {
    return null
  }

  const hasUser = normalizedMessages.some((message) => message.role === "user")
  const hasAssistant = normalizedMessages.some((message) => message.role === "assistant")
  const hasRoleSignal = hasUser && hasAssistant

  if (!hasRoleSignal) {
    return null
  }

  if (!hasImportSignal && !hasTitleSignal && normalizedMessages.length < 2) {
    return null
  }

  if (preambleLines.length > 0) {
    const preamble = formatConversationBody(preambleLines.join("\n"))
    if (preamble) {
      normalizedMessages.unshift({
        role: "assistant",
        label: "Contexto",
        content: preamble
      })
    }
  }

  return {
    importLine,
    messages: normalizedMessages
  }
}

function resolveConversationPlatformHint(rawLines: string[], importLine?: string | null): string | null {
  const importCandidate = extractPlatformFromImportLine(importLine ?? "")
  if (importCandidate) {
    return importCandidate
  }

  for (const line of rawLines) {
    const titleMatch = String(line ?? "").match(CONVERSATION_TITLE_HINT_REGEX)
    const titlePlatform = normalizeConversationPlatformLabel(
      String(titleMatch?.groups?.platform ?? titleMatch?.[1] ?? "")
    )
    if (titlePlatform) {
      return titlePlatform
    }

    const importPlatform = extractPlatformFromImportLine(line)
    if (importPlatform) {
      return importPlatform
    }
  }

  return null
}

function extractPlatformFromImportLine(lineRaw: string): string | null {
  const line = cleanConversationLine(lineRaw)
  if (!line) {
    return null
  }

  const match = line.match(CONVERSATION_IMPORT_PLATFORM_REGEX)
  if (!match?.groups) {
    return null
  }

  return normalizeConversationPlatformLabel(String(match.groups.platform ?? ""))
}

function normalizeConversationPlatformLabel(platformRaw: string): string | null {
  const source = String(platformRaw ?? "").trim()
  if (!source) {
    return null
  }

  const normalized = source
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()

  if (!normalized) {
    return null
  }

  if (normalized.includes("chatgpt")) {
    return "ChatGPT"
  }
  if (normalized.includes("gemini")) {
    return "Gemini"
  }
  if (normalized.includes("claude")) {
    return "Claude"
  }
  if (normalized.includes("perplexity")) {
    return "Perplexity"
  }

  const cleaned = source
    .replace(/[\[\]{}()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (!cleaned) {
    return null
  }

  return cleaned.slice(0, 28)
}

function splitConversationRoleSegments(lineRaw: string): string[] {
  const normalized = cleanConversationLine(lineRaw)
  if (!normalized) {
    return []
  }

  const markers = findConversationRoleMarkers(normalized)
  if (markers.length <= 1) {
    return [normalized]
  }

  const firstMarkerIndex = markers[0]?.index ?? -1
  if (firstMarkerIndex < 0 || firstMarkerIndex > 4) {
    return [normalized]
  }

  const segments: string[] = []
  for (let index = 0; index < markers.length; index += 1) {
    const start = markers[index]?.index ?? -1
    if (start < 0) {
      continue
    }

    const end = index < markers.length - 1 ? (markers[index + 1]?.index ?? normalized.length) : normalized.length
    const segment = normalized.slice(start, end).trim()
    if (segment) {
      segments.push(segment)
    }
  }

  return segments.length > 0 ? segments : [normalized]
}

function findConversationRoleMarkers(text: string): Array<{ index: number; label: string }> {
  const normalized = String(text ?? "")
  if (!normalized) {
    return []
  }

  const matcher = new RegExp(CONVERSATION_INLINE_ROLE_TOKEN_REGEX.source, CONVERSATION_INLINE_ROLE_TOKEN_REGEX.flags)
  const markers: Array<{ index: number; label: string }> = []
  for (const match of normalized.matchAll(matcher)) {
    const rawLabel = String(match.groups?.label ?? "").trim()
    const resolved = resolveConversationRoleLabel(rawLabel, null)
    const index = Number(match.index ?? -1)
    if (!resolved || index < 0) {
      continue
    }

    markers.push({ index, label: rawLabel })
  }

  return markers
}

function splitConversationImportLine(
  lineRaw: string,
  platformHint: string | null
): { importLine: string; roleTail: string | null } {
  const normalized = cleanConversationLine(lineRaw)
  if (!normalized) {
    return {
      importLine: "",
      roleTail: null
    }
  }

  const splitIndex = findConversationRoleMarkers(normalized).find((marker) => marker.index > 0)?.index ?? -1
  if (splitIndex <= 0) {
    return {
      importLine: normalized,
      roleTail: null
    }
  }

  const importPart = normalized
    .slice(0, splitIndex)
    .replace(/[|,;:\-]\s*$/, "")
    .trim()
  const roleTail = normalized.slice(splitIndex).trim()

  if (!importPart || !roleTail) {
    return {
      importLine: normalized,
      roleTail: null
    }
  }

  if (!parseConversationRoleLine(roleTail, platformHint)) {
    return {
      importLine: normalized,
      roleTail: null
    }
  }

  return {
    importLine: importPart,
    roleTail
  }
}

function parseConversationRoleLine(
  lineRaw: string,
  platformHint: string | null
): { role: "user" | "assistant"; label: string; inlineContent: string } | null {
  const line = String(lineRaw ?? "")
    .replace(/^>\s*/, "")
    .trim()
  if (!line) {
    return null
  }

  const match = line.match(CONVERSATION_ROLE_LINE_REGEX)
  if (!match?.groups) {
    return null
  }

  const rawLabel = String(match.groups.label ?? "").trim()
  const rest = cleanConversationLine(String(match.groups.rest ?? ""))
  const resolved = resolveConversationRoleLabel(rawLabel, platformHint)
  if (!resolved) {
    return null
  }

  return {
    role: resolved.role,
    label: resolved.label,
    inlineContent: rest
  }
}

function resolveConversationRoleLabel(
  rawLabel: string,
  platformHint: string | null
): { role: "user" | "assistant"; label: string } | null {
  const normalized = String(rawLabel ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()

  if (!normalized) {
    return null
  }

  if (["usuario", "user", "voce"].some((token) => normalized.includes(token))) {
    return { role: "user", label: "Usuario" }
  }

  if (normalized.includes("chatgpt")) {
    return { role: "assistant", label: "ChatGPT" }
  }

  if (normalized.includes("gemini")) {
    return { role: "assistant", label: "Gemini" }
  }

  if (normalized.includes("claude")) {
    return { role: "assistant", label: "Claude" }
  }

  if (normalized.includes("perplexity")) {
    return { role: "assistant", label: "Perplexity" }
  }

  if (["assistant", "assistente", "ia", "modelo"].includes(normalized)) {
    return {
      role: "assistant",
      label: platformHint || "Assistente"
    }
  }

  return null
}

function formatConversationBody(contentRaw: string): string {
  const normalized = String(contentRaw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (!normalized) {
    return ""
  }

  const lines = normalized.split("\n").map((line) => cleanConversationLine(line)).filter(Boolean)
  if (lines.length === 0) {
    return ""
  }

  const formatted: string[] = []
  const paragraphBuffer: string[] = []

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) {
      return
    }

    const merged = paragraphBuffer.join(" ").replace(/\s{2,}/g, " ").trim()
    if (!merged) {
      paragraphBuffer.length = 0
      return
    }

    formatted.push(...splitConversationParagraph(merged))
    paragraphBuffer.length = 0
  }

  for (const line of lines) {
    if (isConversationStructuralLine(line)) {
      flushParagraph()
      formatted.push(line)
      continue
    }

    paragraphBuffer.push(line)
  }

  flushParagraph()

  return formatted
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function cleanConversationLine(lineRaw: string): string {
  return String(lineRaw ?? "")
    .replace(/^>\s*/, "")
    .replace(/\s{2,}/g, " ")
    .trim()
}

function isConversationStructuralLine(line: string): boolean {
  const value = String(line ?? "").trim()
  if (!value) {
    return false
  }

  if (/^[-*]\s/.test(value)) {
    return true
  }

  if (/^\d+[.)]\s/.test(value)) {
    return true
  }

  if (/^#{1,6}\s/.test(value)) {
    return true
  }

  if (/^>\s*/.test(value)) {
    return true
  }

  if (/\b(?:kcal|gramas?|prote[i\u00ED]na|carboidratos?|gordura)\b/iu.test(value) && /\d/.test(value)) {
    return true
  }

  return false
}

function splitConversationParagraph(text: string): string[] {
  const normalized = String(text ?? "").trim()
  if (!normalized) {
    return []
  }

  const sentenceParts = normalized
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Ý])/u)
    .map((part) => part.trim())
    .filter(Boolean)

  if (sentenceParts.length <= 1) {
    if (normalized.length <= 260) {
      return [normalized]
    }
    return splitParagraphByWordBudget(normalized, 36)
  }

  const result: string[] = []
  let buffer = ""
  let sentenceCount = 0

  for (const sentence of sentenceParts) {
    const candidate = buffer ? `${buffer} ${sentence}` : sentence
    const shouldWrap = buffer.length > 0 && (candidate.length > 260 || sentenceCount >= 2)
    if (shouldWrap) {
      result.push(buffer.trim())
      buffer = sentence
      sentenceCount = 1
      continue
    }

    buffer = candidate
    sentenceCount += 1
  }

  if (buffer.trim()) {
    result.push(buffer.trim())
  }

  return result.length > 0 ? result : [normalized]
}

function renderArticleModeIfNeeded(text: string, mode: ExportSummaryMode): string {
  const normalized = String(text ?? "").trim()
  if (!shouldUseArticleMode(normalized)) {
    return normalized
  }

  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  const parsedParagraphs: string[] = []
  for (const block of blocks) {
    if (looksStructuredBlock(block)) {
      parsedParagraphs.push(block)
      continue
    }

    parsedParagraphs.push(...buildArticleParagraphsFromBlock(block))
  }

  if (parsedParagraphs.length === 0) {
    return normalized
  }

  return parsedParagraphs
    .map((paragraph) => formatArticleParagraph(paragraph, mode))
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function shouldUseArticleMode(text: string): boolean {
  const normalized = String(text ?? "").trim()
  if (!normalized) {
    return false
  }

  const lines = normalized.split("\n")
  const tableLikeLines = lines.filter((line) => line.includes("|")).length
  if (tableLikeLines >= 2) {
    return false
  }

  const wordCount = normalized.split(/\s+/).filter(Boolean).length
  if (wordCount >= 90) {
    return true
  }

  if (normalized.length >= 620) {
    return true
  }

  return new RegExp(`\\b${ARTICLE_MARKER_SOURCE}\\b`, "iu").test(normalized)
}

function looksStructuredBlock(block: string): boolean {
  const lines = String(block ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) {
    return false
  }

  return lines.some((line) => {
    if (/^[-*]\s/.test(line)) {
      return true
    }
    if (/^\d+[.)]\s/.test(line)) {
      return true
    }
    if (/^\|.+\|$/.test(line)) {
      return true
    }
    if (/^#{1,6}\s/.test(line)) {
      return true
    }
    return false
  })
}

function buildArticleParagraphsFromBlock(block: string): string[] {
  const marked = injectArticleMarkerBreaks(block)
  const segments = marked
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean)

  const paragraphs: string[] = []
  for (const segment of segments) {
    const splitByMarker = splitSegmentByArticleMarker(segment)
    for (const piece of splitByMarker) {
      if (piece.startsWith(ARTICLE_MARKER_PREFIX)) {
        paragraphs.push(piece)
        continue
      }
      paragraphs.push(...splitDenseArticleSegment(piece))
    }
  }

  return paragraphs.filter(Boolean)
}

function injectArticleMarkerBreaks(block: string): string {
  return String(block ?? "")
    .replace(new RegExp(`\\s+(?=(?:${ARTICLE_MARKER_SOURCE})\\b)`, "giu"), "\n\n")
    .replace(/\s+(?=(?:Por(?:e|\\u00E9)m|Contudo|Entretanto|No\\s+entanto|Al(?:e|\\u00E9)m\\s+disso|Ademais|Assim|Portanto|Logo|Dessa\\s+forma|Nesse\\s+sentido)\\b)/giu, "\n")
}

function splitSegmentByArticleMarker(segment: string): string[] {
  const normalized = String(segment ?? "").replace(/\s{2,}/g, " ").trim()
  if (!normalized) {
    return []
  }

  if (ARTICLE_MARKER_STANDALONE.test(normalized)) {
    return [`${ARTICLE_MARKER_PREFIX}${normalized}`]
  }

  const markerWithBody = normalized.match(
    new RegExp(`^(?<marker>${ARTICLE_MARKER_SOURCE})(?:\\s*[:\\-]\\s*|\\s+)(?<body>.+)$`, "iu")
  )
  if (!markerWithBody?.groups) {
    return [normalized]
  }

  const marker = String(markerWithBody.groups.marker ?? "").trim()
  const body = String(markerWithBody.groups.body ?? "").trim()
  if (!marker || !body) {
    return [normalized]
  }

  if (body.length < 48) {
    return [normalized]
  }

  return [`${ARTICLE_MARKER_PREFIX}${marker}`, body]
}

function splitDenseArticleSegment(segment: string): string[] {
  const normalized = String(segment ?? "").replace(/\s{2,}/g, " ").trim()
  if (!normalized) {
    return []
  }

  const sentenceParts = normalized
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Ý])/u)
    .map((part) => part.trim())
    .filter(Boolean)

  if (sentenceParts.length <= 1) {
    const connectorParts = normalized
      .split(/\n+/)
      .map((part) => part.trim())
      .filter(Boolean)
    if (connectorParts.length > 1) {
      return connectorParts.flatMap((part) => splitParagraphByWordBudget(part, 38))
    }

    if (normalized.length <= 250) {
      return [normalized]
    }

    return splitParagraphByWordBudget(normalized, 42)
  }

  const result: string[] = []
  let buffer = ""
  let sentenceCount = 0
  for (const sentence of sentenceParts) {
    const candidate = buffer ? `${buffer} ${sentence}` : sentence
    const shouldWrap = buffer.length > 0 && (candidate.length > 270 || sentenceCount >= 2)
    if (shouldWrap) {
      result.push(buffer.trim())
      buffer = sentence
      sentenceCount = 1
      continue
    }

    buffer = candidate
    sentenceCount += 1
  }

  if (buffer.trim()) {
    result.push(buffer.trim())
  }

  return result.length > 0 ? result : [normalized]
}

function formatArticleParagraph(paragraph: string, mode: ExportSummaryMode): string {
  const value = String(paragraph ?? "").trim()
  if (!value) {
    return ""
  }

  if (!value.startsWith(ARTICLE_MARKER_PREFIX)) {
    return value
  }

  const labelRaw = value.slice(ARTICLE_MARKER_PREFIX.length).trim()
  const label = toArticleLabel(labelRaw)
  if (!label) {
    return ""
  }

  if (mode === "markdown") {
    return `### ${label}`
  }

  return label.toUpperCase()
}

function toArticleLabel(value: string): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase())
}

function prepareScheduleLines(text: string): string[] {
  const rawLines = String(text ?? "")
    .split("\n")
    .map((line) =>
      String(line ?? "")
        .replace(/^\-\s*/, "")
        .replace(/\*{2,}/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim()
    )
    .filter(Boolean)

  const mergedBrokenDays: string[] = []
  for (let index = 0; index < rawLines.length; index += 1) {
    const current = rawLines[index]
    const next = rawLines[index + 1] ?? ""
    const merged = mergeBrokenWeekdayLine(current, next)
    if (merged) {
      mergedBrokenDays.push(merged)
      index += 1
      continue
    }

    mergedBrokenDays.push(current)
  }

  const stitched: string[] = []
  for (const line of mergedBrokenDays) {
    const normalized = normalizeScheduleSyntax(line)
    if (!normalized) {
      continue
    }

    if (stitched.length > 0 && shouldAppendScheduleContinuation(stitched[stitched.length - 1], normalized)) {
      stitched[stitched.length - 1] = appendScheduleContinuation(stitched[stitched.length - 1], normalized)
      continue
    }

    stitched.push(normalized)
  }

  return stitched
}

function mergeBrokenWeekdayLine(currentRaw: string, nextRaw: string): string | null {
  const current = String(currentRaw ?? "").trim()
  const next = String(nextRaw ?? "").trim()
  if (!current || !next) {
    return null
  }

  const dayPrefixMatch = current.match(
    new RegExp(`^(?<prefix>[0-2]?\\d|3[01])\\s+(?<day>${WEEKDAY_PREFIX_REGEX_SOURCE})[-\\s]*$`, "iu")
  )
  if (!dayPrefixMatch?.groups) {
    return null
  }

  if (!/^feira\b/i.test(next)) {
    return null
  }

  const prefix = String(dayPrefixMatch.groups.prefix ?? "").trim()
  const day = String(dayPrefixMatch.groups.day ?? "").trim()
  return `${prefix} ${day}-${next}`
}

function normalizeScheduleSyntax(line: string): string {
  return String(line ?? "")
    .replace(/--+/g, "-")
    .replace(/\b(Segunda|Ter(?:\u00E7a|ca)|Quarta|Quinta|Sexta)\s+feira\b/giu, "$1-feira")
    .replace(/-\s*feira\b/giu, "-feira")
    .replace(/\s{2,}/g, " ")
    .trim()
}

function shouldAppendScheduleContinuation(previousRaw: string, currentRaw: string): boolean {
  const previous = normalizeScheduleSyntax(previousRaw)
  const current = normalizeScheduleSyntax(currentRaw)
  if (!previous || !current) {
    return false
  }

  if (isScheduleDateLine(current)) {
    return false
  }

  if (!isScheduleDateLine(previous)) {
    return false
  }

  if (/^feira\b/i.test(current)) {
    return true
  }

  if (isLikelyAssigneeSegment(current) && current.length <= 40) {
    return true
  }

  if (/^(n[a\u00E3]o|sem)\s+tem\s+missa\b/i.test(current)) {
    return true
  }

  return false
}

function appendScheduleContinuation(previousRaw: string, currentRaw: string): string {
  const previous = normalizeScheduleSyntax(previousRaw)
  const current = normalizeScheduleSyntax(currentRaw)
  if (!previous || !current) {
    return previous || current
  }

  if (/^feira\b/i.test(current)) {
    if (new RegExp(`^([0-2]?\\d|3[01])\\s+${WEEKDAY_PREFIX_REGEX_SOURCE}-?$`, "iu").test(previous)) {
      return `${previous.replace(/-?$/, "-")}${current}`
    }
    return `${previous} ${current}`.replace(/\s{2,}/g, " ").trim()
  }

  if (isLikelyAssigneeSegment(current) && current.length <= 40) {
    if (/[\/|]\s*$/.test(previous)) {
      return `${previous} ${current}`.replace(/\s{2,}/g, " ").trim()
    }
    return `${previous} / ${current}`.replace(/\s{2,}/g, " ").trim()
  }

  return `${previous} ${current}`.replace(/\s{2,}/g, " ").trim()
}

function isScheduleDateLine(line: string): boolean {
  const normalized = normalizeScheduleSyntax(line)
  return DAY_AND_DETAIL_REGEX.test(normalized)
}

function parseScheduleDocument(text: string): ParsedScheduleDocument | null {
  const sourceLines = prepareScheduleLines(text)

  if (sourceLines.length === 0) {
    return null
  }

  const introLines: string[] = []
  const tailLines: string[] = []
  const rows: ScheduleRow[] = []
  let reachedRows = false

  for (const line of sourceLines) {
    const normalized = String(line ?? "").trim()
    if (!normalized) {
      continue
    }

    const row = parseScheduleRow(normalized)
    if (row) {
      rows.push(row)
      reachedRows = true
      continue
    }

    if (!reachedRows) {
      introLines.push(normalized)
      continue
    }

    tailLines.push(normalized)
  }

  if (rows.length < 3) {
    return null
  }

  const dedupedRows = dedupeScheduleRows(rows)
  if (dedupedRows.length < 3) {
    return null
  }

  return {
    introLines,
    rows: dedupedRows,
    tailLines
  }
}

function parseScheduleRow(line: string): ScheduleRow | null {
  const normalizedLine = normalizeScheduleSyntax(line)
  const match = normalizedLine.match(DAY_AND_DETAIL_REGEX)
  if (!match?.groups) {
    return null
  }

  const date = String(match.groups.date ?? "")
    .trim()
    .padStart(2, "0")
  const day = String(match.groups.day ?? "")
    .replace(/\s+/g, " ")
    .trim()
  const detail = String(match.groups.detail ?? "").trim()

  const row = resolveScheduleDetails(detail)
  return {
    date,
    day,
    time: row.time,
    location: row.location,
    assignees: row.assignees
  }
}

function resolveScheduleDetails(detailRaw: string): Pick<ScheduleRow, "time" | "location" | "assignees"> {
  const detail = String(detailRaw ?? "")
    .replace(/\*{2,}/g, "")
    .replace(/\s*\|\s*/g, " / ")
    .replace(/\s{2,}/g, " ")
    .trim()

  if (!detail) {
    return {
      time: "-",
      location: "-",
      assignees: "-"
    }
  }

  if (/^(n[a\u00E3]o|sem)\s+tem\s+missa\b/i.test(detail)) {
    return {
      time: "-",
      location: detail,
      assignees: "-"
    }
  }

  const detailWithoutLeadingSeparators = detail.replace(/^[\-|/:\s]+/, "").trim()
  const timeMatch = detailWithoutLeadingSeparators.match(
    /^(?<time>(?:[01]?\d|2[0-3])(?::\d{2}|h\d{0,2}|h)?)\s*(?<rest>.*)$/i
  )
  let time = "-"
  let remaining = detailWithoutLeadingSeparators
  if (timeMatch?.groups) {
    time = normalizeTimeToken(String(timeMatch.groups.time ?? ""))
    remaining = String(timeMatch.groups.rest ?? "")
      .replace(/^[-|/:\s]+/, "")
      .trim()
  }

  const rawSegments = remaining
    .split(/\s*\/\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean)

  let location = remaining || "-"
  let assignees = "-"

  if (rawSegments.length > 0) {
    const segments = [...rawSegments]
    const assigneeSegments: string[] = []

    if (time === "-" && /^([01]?\d|2[0-3])(?::\d{2}|h\d{0,2}|h)?$/i.test(segments[0] ?? "")) {
      time = normalizeTimeToken(String(segments.shift() ?? ""))
    }

    while (segments.length > 1) {
      const candidate = segments[segments.length - 1]
      if (!isLikelyAssigneeSegment(candidate)) {
        break
      }
      assigneeSegments.unshift(String(segments.pop() ?? "").trim())
    }

    location = segments.join(" / ").trim() || "-"
    if (assigneeSegments.length > 0) {
      assignees = assigneeSegments.join(" / ")
    }

    const trailingAssignee = extractTrailingAssigneeFromLocation(location)
    if (trailingAssignee) {
      location = trailingAssignee.location
      assignees =
        assignees === "-"
          ? trailingAssignee.assignee
          : `${trailingAssignee.assignee} / ${assignees}`.replace(/\s{2,}/g, " ").trim()
    }
  }

  return {
    time: time || "-",
    location: location || "-",
    assignees: assignees || "-"
  }
}

function isLikelyAssigneeSegment(segment: string): boolean {
  const value = String(segment ?? "")
    .replace(/[.,;:()]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()

  if (!value) {
    return false
  }

  if (LOCAL_KEYWORD_REGEX.test(value)) {
    return false
  }

  const words = value.split(" ").filter(Boolean)
  if (words.length === 0 || words.length > 10) {
    return false
  }

  const alphaWords = words.filter((word) => /[A-Za-zÀ-ÖØ-öø-ÿ]/u.test(word))
  if (alphaWords.length === 0) {
    return false
  }

  const capitalizedWords = alphaWords.filter((word) => /^[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+$/u.test(word))
  return capitalizedWords.length / alphaWords.length >= 0.6
}

function extractTrailingAssigneeFromLocation(locationRaw: string): { location: string; assignee: string } | null {
  const location = String(locationRaw ?? "").trim()
  if (!location) {
    return null
  }

  const match = location.match(TRAILING_ASSIGNEE_AFTER_LOCAL_REGEX)
  if (!match?.groups) {
    return null
  }

  const resolvedLocation = String(match.groups.local ?? "").trim()
  const assignee = String(match.groups.assignee ?? "").trim()
  if (!resolvedLocation || !assignee || !isLikelyAssigneeSegment(assignee)) {
    return null
  }

  return {
    location: resolvedLocation,
    assignee
  }
}

function normalizeTimeToken(raw: string): string {
  const value = String(raw ?? "")
    .replace(/\s+/g, "")
    .trim()
  if (!value) {
    return "-"
  }

  const hourMinute = value.match(/^([01]?\d|2[0-3])h([0-5]\d)$/i)
  if (hourMinute) {
    return `${hourMinute[1]}:${hourMinute[2]}`
  }

  return value
}

function dedupeScheduleRows(rows: ScheduleRow[]): ScheduleRow[] {
  const seen = new Set<string>()
  const deduped: ScheduleRow[] = []

  for (const row of rows) {
    const key = `${row.date}|${row.day}|${row.time}|${row.location}|${row.assignees}`
      .toLowerCase()
      .trim()
    if (!key || seen.has(key)) {
      continue
    }
    seen.add(key)
    deduped.push(row)
  }

  return deduped
}

function renderScheduleMarkdown(parsed: ParsedScheduleDocument): string {
  const intro = parsed.introLines.join("\n").trim()
  const tail = parsed.tailLines.join("\n").trim()

  const header = [
    "| Data | Dia | Horario | Local | Responsaveis |",
    "| --- | --- | --- | --- | --- |"
  ]

  const body = parsed.rows.map(
    (row) =>
      `| ${escapeMarkdownCell(row.date)} | ${escapeMarkdownCell(row.day)} | ${escapeMarkdownCell(
        row.time
      )} | ${escapeMarkdownCell(row.location)} | ${escapeMarkdownCell(row.assignees)} |`
  )

  const sections = [intro, [...header, ...body].join("\n"), tail]
    .map((section) => section.trim())
    .filter(Boolean)

  return sections.join("\n\n")
}

function renderSchedulePlainText(parsed: ParsedScheduleDocument): string {
  const intro = parsed.introLines.join("\n").trim()
  const tail = parsed.tailLines.join("\n").trim()

  const header = "DATA | DIA | HORARIO | LOCAL | RESPONSAVEIS"
  const divider = "-----|-----|---------|-------|--------------"
  const rows = parsed.rows.map(
    (row) => `${row.date} | ${row.day} | ${row.time} | ${row.location} | ${row.assignees}`
  )

  const tableBlock = [header, divider, ...rows].join("\n")
  const sections = [intro, tableBlock, tail].filter((section) => section.trim().length > 0)
  return sections.join("\n\n")
}

function escapeMarkdownCell(value: string): string {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .trim()
}

function escapeXml(valueRaw: string): string {
  return String(valueRaw ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}



