const NOTION_API_VERSION = "2022-06-28"
const NOTION_SEARCH_ENDPOINT = "https://api.notion.com/v1/search"
const NOTION_PAGES_ENDPOINT = "https://api.notion.com/v1/pages"

interface NotionSearchResponse {
  results?: Array<{
    id?: string
  }>
}

interface NotionCreatePageResponse {
  url?: string
}

export interface NotionApiBlock {
  object: "block"
  type: string
}

function buildNotionHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_API_VERSION,
    "Content-Type": "application/json"
  }
}

function normalizePageTitle(value: unknown): string {
  const title = String(value ?? "").trim()
  return title || "NotebookLM Chat Export"
}

export async function findDefaultParentPage(token: string): Promise<string> {
  const normalizedToken = String(token ?? "").trim()
  if (!normalizedToken) {
    throw new Error("Notion token is missing.")
  }

  const searchResponse = await fetch(NOTION_SEARCH_ENDPOINT, {
    method: "POST",
    headers: buildNotionHeaders(normalizedToken),
    body: JSON.stringify({
      filter: {
        value: "page",
        property: "object"
      },
      page_size: 1
    })
  })

  if (!searchResponse.ok) {
    const details = await searchResponse.text().catch(() => "")
    throw new Error(`Notion search failed (${searchResponse.status}): ${details || searchResponse.statusText}`)
  }

  const payload = (await searchResponse.json()) as NotionSearchResponse
  const defaultPageId = String(payload?.results?.[0]?.id ?? "").trim()
  if (!defaultPageId) {
    throw new Error("Nenhuma página autorizada encontrada")
  }

  return defaultPageId
}

export async function createPageInNotion(
  token: string,
  parentPageId: string,
  pageTitle: string,
  blocksArray: ReadonlyArray<NotionApiBlock>
): Promise<string> {
  const normalizedToken = String(token ?? "").trim()
  const normalizedParentPageId = String(parentPageId ?? "").trim()
  if (!normalizedToken || !normalizedParentPageId) {
    throw new Error("Notion token or parent page id is missing.")
  }

  const notionResponse = await fetch(NOTION_PAGES_ENDPOINT, {
    method: "POST",
    headers: buildNotionHeaders(normalizedToken),
    body: JSON.stringify({
      parent: {
        page_id: normalizedParentPageId
      },
      properties: {
        title: {
          title: [
            {
              text: {
                content: normalizePageTitle(pageTitle)
              }
            }
          ]
        }
      },
      children: Array.from(blocksArray)
    })
  })

  if (!notionResponse.ok) {
    const details = await notionResponse.text().catch(() => "")
    throw new Error(`Notion page creation failed (${notionResponse.status}): ${details || notionResponse.statusText}`)
  }

  const responsePayload = (await notionResponse.json()) as NotionCreatePageResponse
  const generatedPageUrl = String(responsePayload?.url ?? "").trim()
  if (!generatedPageUrl) {
    throw new Error("Notion API response did not include page URL.")
  }

  return generatedPageUrl
}
