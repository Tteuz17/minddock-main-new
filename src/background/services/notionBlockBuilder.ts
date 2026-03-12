export interface ParsedBlock {
  type: "heading" | "paragraph"
  content: string
}

interface NotionRichTextObject {
  type: "text"
  text: {
    content: string
  }
}

interface NotionHeadingBlock {
  object: "block"
  type: "heading_2"
  heading_2: {
    rich_text: NotionRichTextObject[]
  }
}

interface NotionParagraphBlock {
  object: "block"
  type: "paragraph"
  paragraph: {
    rich_text: NotionRichTextObject[]
  }
}

export type NotionBlock = NotionHeadingBlock | NotionParagraphBlock

const MAX_NOTION_TEXT_LENGTH = 2000

function normalizeBlockContent(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function buildNotionRichText(content: string): NotionRichTextObject[] {
  const clipped = normalizeBlockContent(content).slice(0, MAX_NOTION_TEXT_LENGTH)
  if (!clipped) {
    return []
  }

  return [
    {
      type: "text",
      text: {
        content: clipped
      }
    }
  ]
}

export function convertPayloadToNotionBlocks(parsedData: ParsedBlock[]): NotionBlock[] {
  const notionBlockTranslator: Record<ParsedBlock["type"], (item: ParsedBlock) => NotionBlock | null> = {
    heading: (item) => {
      const richText = buildNotionRichText(item.content)
      if (richText.length === 0) {
        return null
      }

      return {
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: richText
        }
      }
    },
    paragraph: (item) => {
      const richText = buildNotionRichText(item.content)
      if (richText.length === 0) {
        return null
      }

      return {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: richText
        }
      }
    }
  }

  const notionBlocks: NotionBlock[] = []

  for (const item of Array.isArray(parsedData) ? parsedData : []) {
    const mappedBlock = notionBlockTranslator[item?.type]?.(item)
    if (!mappedBlock) {
      continue
    }
    notionBlocks.push(mappedBlock)
  }

  return notionBlocks
}
