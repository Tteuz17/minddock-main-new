const METADATA_LABEL_PATTERNS = [
  "Source\\s+ID:",
  "URL:",
  "Tipo:",
  "Data:",
  "Autor:"
] as const

const METADATA_LABEL_REGEX = new RegExp(`\\b(${METADATA_LABEL_PATTERNS.join("|")})`, "gi")
const CHUNK_MINIMUM_LENGTH = 600

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function formatMetadataKeys(input: string): string {
  const raw = String(input ?? "")
  if (!raw) {
    return ""
  }

  const matcher = new RegExp(METADATA_LABEL_REGEX)
  let cursor = 0
  let hasMatch = false
  let formatted = ""

  raw.replace(matcher, (match, _label, offset: number) => {
    hasMatch = true
    formatted += escapeHtml(raw.slice(cursor, offset))
    formatted += `<strong>${escapeHtml(match)}</strong>`
    cursor = offset + match.length
    return match
  })

  if (!hasMatch) {
    return escapeHtml(raw)
  }

  formatted += escapeHtml(raw.slice(cursor))
  return formatted
}

export function cleanRawText(input: string): string {
  return String(input ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function densityParagraphChunker(input: string): string[] {
  const continuous = String(input ?? "").trim()
  if (!continuous) {
    return []
  }

  const chunks: string[] = []
  let cursor = 0

  while (cursor < continuous.length) {
    const minimumTarget = Math.min(cursor + CHUNK_MINIMUM_LENGTH, continuous.length)
    if (minimumTarget >= continuous.length) {
      const tail = continuous.slice(cursor).trim()
      if (tail) {
        chunks.push(tail)
      }
      break
    }

    const remainingSlice = continuous.slice(minimumTarget)
    const punctuationMatch = remainingSlice.match(/[.!?]\s/)

    if (!punctuationMatch || punctuationMatch.index === undefined) {
      const tail = continuous.slice(cursor).trim()
      if (tail) {
        chunks.push(tail)
      }
      break
    }

    const cutIndex = minimumTarget + punctuationMatch.index + 1
    const chunk = continuous.slice(cursor, cutIndex).trim()
    if (chunk) {
      chunks.push(chunk)
    }

    cursor = cutIndex + 1
    while (cursor < continuous.length && continuous[cursor] === " ") {
      cursor += 1
    }
  }

  return chunks
}
