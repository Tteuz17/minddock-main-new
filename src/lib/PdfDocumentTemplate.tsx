import type { CSSProperties } from "react"
import { cleanRawText, densityParagraphChunker, formatMetadataKeys } from "~/lib/PdfContentFormatter"

export interface PdfDocumentTemplateProps {
  title: string
  metadataLines: string[]
  rawBodyText: string
}

const documentShellStyle: CSSProperties = {
  width: "100%",
  color: "#111827"
}

const titleStyle: CSSProperties = {
  fontFamily: "Inter, sans-serif",
  fontSize: "20px",
  fontWeight: 700,
  lineHeight: 1.2,
  margin: "0 0 12px 0"
}

const metadataLineStyle: CSSProperties = {
  fontFamily: "Inter, sans-serif",
  fontSize: "12px",
  lineHeight: 1.5,
  margin: "0 0 6px 0"
}

const dividerStyle: CSSProperties = {
  border: "none",
  borderTop: "1px solid #e5e7eb",
  margin: "40px 0"
}

const bodyParagraphStyle: CSSProperties = {
  fontFamily: "Merriweather, serif",
  fontSize: "12px",
  lineHeight: 1.6,
  textAlign: "justify",
  marginBottom: "24px"
}

export function PdfDocumentTemplate(props: PdfDocumentTemplateProps) {
  const { title, metadataLines, rawBodyText } = props

  const cleanedBodyText = cleanRawText(rawBodyText)
  const paragraphChunks = densityParagraphChunker(cleanedBodyText)
  const resolvedParagraphs =
    paragraphChunks.length > 0 ? paragraphChunks : cleanedBodyText ? [cleanedBodyText] : []

  return (
    <section style={documentShellStyle}>
      <h1 style={titleStyle}>{title}</h1>

      <div>
        {metadataLines.map((line, index) => (
          <p
            key={`metadata-${index}`}
            style={metadataLineStyle}
            dangerouslySetInnerHTML={{ __html: formatMetadataKeys(line) }}
          />
        ))}
      </div>

      <hr style={dividerStyle} />

      <div>
        {resolvedParagraphs.map((paragraph, index) => (
          <p key={`paragraph-${index}`} style={bodyParagraphStyle}>
            {paragraph}
          </p>
        ))}
      </div>
    </section>
  )
}
