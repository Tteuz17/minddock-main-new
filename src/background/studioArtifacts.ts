import { GoogleRPC } from "./api/GoogleRPC"

const STUDIO_LIST_RPC_ID = "gArtLc"
const STUDIO_LIST_FILTER = 'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"'
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

export type StudioArtifactItem = {
  id: string
  title: string
  meta?: string
  type?: string
}

function buildListPayload(notebookId: string): unknown[] {
  return [
    [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]], [[2, 1, 3]]],
    notebookId,
    STUDIO_LIST_FILTER
  ]
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function parseBatchexecuteFrames(rawText: string): unknown[][] {
  const text = String(rawText ?? "").replace(/^\)\]\}'\s*/, "").trim()
  const frames: unknown[][] = []

  const visit = (node: unknown) => {
    if (!Array.isArray(node)) return
    if (node.length >= 3 && node[0] === "wrb.fr") frames.push(node)
    for (const child of node) visit(child)
  }

  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) continue
    try {
      const parsed = JSON.parse(trimmed)
      visit(parsed)
    } catch {}
  }

  return frames
}

function extractListItemsFromPayload(payload: unknown): StudioArtifactItem[] {
  const items = new Map<string, StudioArtifactItem>()

  const visit = (node: unknown) => {
    if (!Array.isArray(node)) return

    if (
      node.length >= 2 &&
      typeof node[0] === "string" &&
      typeof node[1] === "string" &&
      UUID_RE.test(node[0])
    ) {
      const id = node[0]
      const title = node[1]
      const typeId = typeof node[2] === "number" ? node[2] : undefined

      items.set(id, {
        id,
        title,
        meta: undefined,
        type: typeId ? String(typeId) : undefined
      })
      return
    }

    for (const child of node) visit(child)
  }

  visit(payload)
  return Array.from(items.values())
}

function extractListItemsFromRawText(rawText: string): StudioArtifactItem[] {
  const frames = parseBatchexecuteFrames(rawText)
  const out: StudioArtifactItem[] = []

  for (const frame of frames) {
    if (String(frame[1]) !== STUDIO_LIST_RPC_ID) continue
    const payloadStr = typeof frame[2] === "string" ? frame[2] : ""
    const payload = safeJsonParse(payloadStr)
    out.push(...extractListItemsFromPayload(payload))
  }

  return out
}

export async function fetchStudioArtifactsByIds(
  ids: string[],
  notebookId?: string,
  options?: { forceRefresh?: boolean; rpcContext?: Record<string, unknown> }
): Promise<StudioArtifactItem[]> {
  if (!notebookId) return []

  const rpc = new GoogleRPC()
  const ctx = options?.rpcContext ?? {}

  console.warn("[MindDock][BG] gArtLc payload:", JSON.stringify(buildListPayload(notebookId)))

  const response = await rpc.execute(
    STUDIO_LIST_RPC_ID,
    buildListPayload(notebookId),
    {
      sourcePath: typeof ctx.sourcePath === "string" ? ctx.sourcePath : `/notebook/${notebookId}`,
      fSid: typeof ctx.fSid === "string" ? ctx.fSid : undefined,
      hl: typeof ctx.hl === "string" ? ctx.hl : undefined,
      socApp: typeof ctx.socApp === "string" ? ctx.socApp : undefined,
      socPlatform: typeof ctx.socPlatform === "string" ? ctx.socPlatform : undefined,
      socDevice: typeof ctx.socDevice === "string" ? ctx.socDevice : undefined,
      bl: typeof ctx.bl === "string" ? ctx.bl : undefined,
      at: typeof ctx.at === "string" ? ctx.at : undefined
    }
  )

  const raw = response.sanitizedText ?? response.rawText
  const items = extractListItemsFromRawText(raw)

  console.warn("[MindDock][BG] gArtLc items:", items.length)

  if (ids.length === 0) return items
  const idSet = new Set(ids)
  return items.filter((item) => idSet.has(item.id))
}
