export interface RawTextBlock {
  type: string
  text: string
}

export interface NotionRichTextObject {
  type: "text"
  text: {
    content: string
  }
}

export interface NotionHeading2Block {
  object: "block"
  type: "heading_2"
  heading_2: {
    rich_text: NotionRichTextObject[]
  }
}

export interface NotionParagraphBlock {
  object: "block"
  type: "paragraph"
  paragraph: {
    rich_text: NotionRichTextObject[]
  }
}

export type NotionTranslatedBlock = NotionHeading2Block | NotionParagraphBlock

const MAX_NOTION_TEXT_LENGTH = 2000
const MIN_SPLIT_THRESHOLD = 1200

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function isHeadingLikeBlock(typeValue: string): boolean {
  const normalizedType = String(typeValue ?? "")
    .toLowerCase()
    .trim()
  return (
    normalizedType === "heading" ||
    normalizedType === "title" ||
    normalizedType === "question" ||
    normalizedType === "pergunta" ||
    normalizedType === "prompt"
  )
}

export function convertHtmlToNotionBlocks(rawTextBlocks: Array<{ type: string; text: string }>): NotionTranslatedBlock[] {
  const notionBlockCompiler: NotionTranslatedBlock[] = []

  const createHeadingBlock = (content: string): NotionHeading2Block => ({
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: [
        {
          type: "text",
          text: {
            content
          }
        }
      ]
    }
  })

  const createParagraphBlock = (content: string): NotionParagraphBlock => ({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        {
          type: "text",
          text: {
            content
          }
        }
      ]
    }
  })

  const splitByNotionLimit = (value: string): string[] => {
    const normalizedValue = normalizeText(value)
    if (!normalizedValue) {
      return []
    }

    const chunkedParts: string[] = []
    let remainingText = normalizedValue
    while (remainingText.length > MAX_NOTION_TEXT_LENGTH) {
      const provisionalSlice = remainingText.slice(0, MAX_NOTION_TEXT_LENGTH)
      const breakCandidates = [
        provisionalSlice.lastIndexOf("\n"),
        provisionalSlice.lastIndexOf(". "),
        provisionalSlice.lastIndexOf("; "),
        provisionalSlice.lastIndexOf(", "),
        provisionalSlice.lastIndexOf(" ")
      ]
      const preferredSplitPoint = breakCandidates.find((index) => index >= MIN_SPLIT_THRESHOLD) ?? MAX_NOTION_TEXT_LENGTH
      const sliceLimit = preferredSplitPoint === MAX_NOTION_TEXT_LENGTH ? preferredSplitPoint : preferredSplitPoint + 1
      const chunk = remainingText.slice(0, sliceLimit).trim()
      if (!chunk) {
        break
      }
      chunkedParts.push(chunk)
      remainingText = remainingText.slice(sliceLimit).trimStart()
    }

    const tailChunk = remainingText.trim()
    if (tailChunk) {
      chunkedParts.push(tailChunk)
    }

    return chunkedParts
  }

  for (const item of Array.isArray(rawTextBlocks) ? rawTextBlocks : []) {
    const textChunks = splitByNotionLimit(item?.text ?? "")
    if (textChunks.length === 0) {
      continue
    }

    if (isHeadingLikeBlock(item?.type ?? "")) {
      notionBlockCompiler.push(createHeadingBlock(textChunks[0]))
      for (const continuationChunk of textChunks.slice(1)) {
        notionBlockCompiler.push(createParagraphBlock(continuationChunk))
      }
      continue
    }

    for (const paragraphChunk of textChunks) {
      notionBlockCompiler.push(createParagraphBlock(paragraphChunk))
    }
  }

  return notionBlockCompiler
}
