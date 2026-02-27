import type { Notebook, Source } from "~/lib/types"
import { NOTEBOOKLM_RPC_CONTRACT, type SessionTokens } from "~/lib/contracts"

export interface RpcError {
  rpcId: string
  status?: number
  message: string
  bodyPreview?: string
}

export interface SourceContentResult {
  sourceId: string
  snippets: string[]
}

interface RpcExecutionResult {
  rpcId: string
  raw: string
  payload: unknown
}

export class NotebookRpcHttpError extends Error {
  readonly rpcId: string
  readonly status: number
  readonly responseBody: string

  constructor(rpcId: string, status: number, responseBody: string) {
    super(`NotebookLM RPC ${rpcId} falhou com HTTP ${status}`)
    this.name = "NotebookRpcHttpError"
    this.rpcId = rpcId
    this.status = status
    this.responseBody = responseBody
  }

  toRpcError(): RpcError {
    return {
      rpcId: this.rpcId,
      status: this.status,
      message: this.message,
      bodyPreview: this.responseBody.slice(0, 240)
    }
  }
}

export class NotebookClient {
  private reqIdSeed = Math.floor(Math.random() * 900_000) + 100_000

  constructor(private readonly tokens: SessionTokens) {
    const at = String(tokens.at ?? "").trim()
    const bl = String(tokens.bl ?? "").trim()
    if (!at || !bl) {
      throw new Error("Tokens at/bl sao obrigatorios para usar NotebookClient.")
    }
  }

  async executeRpc(rpcId: string, payload: unknown, sourcePath = "/"): Promise<unknown> {
    const result = await this.executeRpcInternal(rpcId, payload, sourcePath)
    return result.payload
  }

  async fetchNotebooks(): Promise<Notebook[]> {
    const rpc = await this.executeRpcInternal(
      NOTEBOOKLM_RPC_CONTRACT.LIST_NOTEBOOKS_RPC_ID,
      [],
      "/"
    )
    const rows = this.resolveRowsFromPayload(rpc.payload)
    const notebooksById = new Map<string, Notebook>()

    for (const row of rows) {
      const id = this.pickString(row?.[2], row?.[0])
      if (!id) {
        continue
      }

      notebooksById.set(id, {
        id,
        title: this.pickString(row?.[3], row?.[1]) ?? "Sem titulo",
        createTime: this.pickString(row?.[4]) ?? "",
        updateTime: this.pickString(row?.[5], row?.[4]) ?? "",
        sourceCount: this.pickNumber(row?.[6]) ?? 0
      })
    }

    return Array.from(notebooksById.values())
  }

  async fetchNotebookSources(notebookId: string): Promise<Source[]> {
    const id = String(notebookId ?? "").trim()
    if (!id) {
      throw new Error("notebookId obrigatorio para listar fontes.")
    }

    const rpc = await this.executeRpcInternal(
      NOTEBOOKLM_RPC_CONTRACT.LIST_SOURCES_RPC_ID,
      [id, null, [2]],
      "/"
    )
    const rows = this.resolveSourceRows(rpc.payload)
    const now = new Date().toISOString()
    const sourcesById = new Map<string, Source>()

    for (const row of rows) {
      const row0 = Array.isArray(row[0]) ? (row[0] as unknown[]) : null
      const row2 = Array.isArray(row[2]) ? (row[2] as unknown[]) : null
      const row2_0 = row2 && Array.isArray(row2[0]) ? (row2[0] as unknown[]) : null
      const row3 = Array.isArray(row[3]) ? (row[3] as unknown[]) : null

      const sourceId = this.pickString(row0?.[0], row[0], row[2], row[3])
      const title = this.pickString(row[1], row[3], row[5])
      if (!sourceId || !title) {
        continue
      }

      const gDocId = this.pickString(row2_0?.[0], row2?.[0])
      const statusCode = this.pickNumber(row3?.[1], row[3])
      const rawWordCount = row2?.[1]
      const wordCount = this.pickNumber(rawWordCount)
      const isBadSource = statusCode === 3 || rawWordCount === null
      const url = this.extractFirstUrl(row) ?? undefined
      const type = this.resolveSourceType(title, url, gDocId)

      sourcesById.set(sourceId, {
        id: sourceId,
        notebookId: id,
        title,
        type,
        url,
        isGDoc: Boolean(gDocId) || type === "gdoc",
        isYoutube: type === "youtube",
        createTime: now,
        updateTime: now,
        wordCount: wordCount ?? undefined
      })
    }

    const sources = Array.from(sourcesById.values())
    if (sources.length === 0) {
      throw new Error("Nenhuma fonte valida foi parseada no retorno do rLM1Ne.")
    }

    return sources
  }

  async fetchSourceContent(notebookId: string, sourceId: string): Promise<SourceContentResult> {
    const notebook = String(notebookId ?? "").trim()
    const source = String(sourceId ?? "").trim()

    if (!notebook) {
      throw new Error("notebookId obrigatorio para buscar conteudo da fonte.")
    }
    if (!source) {
      throw new Error("sourceId obrigatorio para buscar conteudo da fonte.")
    }

    const rpc = await this.executeRpcInternal(
      NOTEBOOKLM_RPC_CONTRACT.GET_SOURCE_CONTENT_RPC_ID,
      [[source], [2], [2]],
      "/"
    )
    const snippets = this.normalizeSnippets(this.extractSnippetCandidates(rpc.raw, rpc.payload))

    if (snippets.length === 0) {
      throw new Error(`NO_REAL_CONTENT:${source}`)
    }

    return { sourceId: source, snippets }
  }

  async fetchSourceContentBatch(
    notebookId: string,
    sourceIds: string[]
  ): Promise<Record<string, string[]>> {
    if (!Array.isArray(sourceIds)) {
      throw new Error("sourceIds deve ser um array.")
    }

    const uniqueSourceIds = Array.from(
      new Set(sourceIds.map((id) => String(id ?? "").trim()).filter(Boolean))
    )
    const contentBySourceId: Record<string, string[]> = {}

    await Promise.all(
      uniqueSourceIds.map(async (sourceId) => {
        try {
          const result = await this.fetchSourceContent(notebookId, sourceId)
          contentBySourceId[sourceId] = result.snippets
          console.log("[content:result]", {
            sourceId,
            snippets: result.snippets.length
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : "Erro desconhecido"
          console.error("[content:error]", { sourceId, error: message })
        }
      })
    )

    return contentBySourceId
  }

  async syncGDocSource(notebookId: string, sourceId: string): Promise<void> {
    const notebook = String(notebookId ?? "").trim()
    const source = String(sourceId ?? "").trim()

    if (!notebook) {
      throw new Error("notebookId obrigatorio para sincronizar GDoc.")
    }
    if (!source) {
      throw new Error("sourceId obrigatorio para sincronizar GDoc.")
    }

    await this.executeRpcInternal(
      NOTEBOOKLM_RPC_CONTRACT.SYNC_GDOC_RPC_ID,
      [null, [source], [2]],
      `/notebook/${notebook}`
    )
  }

  async addTextSource(notebookId: string, title: string, content: string): Promise<string> {
    const notebook = String(notebookId ?? "").trim()
    const sourceTitle = String(title ?? "").trim()
    const sourceContent = String(content ?? "").trim()

    if (!notebook) {
      throw new Error("notebookId obrigatorio para adicionar fonte.")
    }
    if (!sourceTitle) {
      throw new Error("title obrigatorio para adicionar fonte.")
    }
    if (!sourceContent) {
      throw new Error("content obrigatorio para adicionar fonte.")
    }

    const rpc = await this.executeRpcInternal(
      NOTEBOOKLM_RPC_CONTRACT.ADD_SOURCE_RPC_ID,
      [notebook, null, [[null, null, sourceTitle, sourceContent]]],
      "/"
    )

    return this.extractFirstNonTrivialString(rpc.payload) ?? ""
  }

  private async executeRpcInternal(
    rpcId: string,
    payload: unknown,
    sourcePath = "/"
  ): Promise<RpcExecutionResult> {
    const requestUrl = this.buildUrl(rpcId, sourcePath)
    const requestBody = this.buildBody(rpcId, payload)

    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "X-Same-Domain": "1"
      },
      credentials: "include",
      body: requestBody
    })

    const raw = await response.text()
    if (!response.ok) {
      throw new NotebookRpcHttpError(rpcId, response.status, raw)
    }

    const payloadNode = this.parseBatchExecute(raw, rpcId)
    return { rpcId, raw, payload: payloadNode }
  }

  private buildUrl(rpcId: string, sourcePath: string): string {
    const params = new URLSearchParams({
      rpcids: rpcId,
      "source-path": sourcePath,
      bl: this.tokens.bl,
      _reqid: String(this.reqIdSeed++),
      rt: "c"
    })

    const authUser = String(this.tokens.authUser ?? "").trim()
    if (authUser) {
      params.set("authuser", authUser)
    }

    const sessionId = String(this.tokens.sessionId ?? "").trim()
    if (sessionId) {
      params.set("f.sid", sessionId)
    }

    return `${NOTEBOOKLM_RPC_CONTRACT.ENDPOINT}?${params.toString()}`
  }

  private buildBody(rpcId: string, payload: unknown): string {
    const envelope = JSON.stringify([[[rpcId, JSON.stringify(payload), null, "generic"]]])
    const params = new URLSearchParams({
      "f.req": envelope,
      at: this.tokens.at
    })

    return params.toString()
  }

  private parseBatchExecute(raw: string, rpcId: string): unknown {
    const line3 = String(raw.split("\n")[3] ?? "").trim()
    if (line3) {
      const parsedLine3 = this.tryParseJson(line3)
      if (parsedLine3 !== null) {
        const payloadFromLine3 = this.extractPayloadByRpc(parsedLine3, rpcId)
        if (payloadFromLine3 !== undefined) {
          return payloadFromLine3
        }
      }
    }

    for (const line of raw.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith("[")) {
        continue
      }

      const parsedLine = this.tryParseJson(trimmed)
      if (parsedLine === null) {
        continue
      }

      const payloadFromLine = this.extractPayloadByRpc(parsedLine, rpcId)
      if (payloadFromLine !== undefined) {
        return payloadFromLine
      }
    }

    throw new Error(`Resposta batchexecute invalida para RPC ${rpcId}.`)
  }

  private extractPayloadByRpc(node: unknown, rpcId: string): unknown | undefined {
    const queue: unknown[] = [node]
    const seen = new Set<unknown>()

    while (queue.length > 0) {
      const current = queue.shift()
      if (current === null || current === undefined) {
        continue
      }
      if (typeof current !== "object" && !Array.isArray(current)) {
        continue
      }
      if (seen.has(current)) {
        continue
      }
      seen.add(current)

      if (Array.isArray(current)) {
        if (current[0] === "wrb.fr") {
          const itemRpcId = this.pickString(current[1])
          if (itemRpcId === rpcId) {
            return this.parsePossiblyEncodedPayload(current[2])
          }
        }

        if (this.pickString(current[0]) === rpcId) {
          return this.parsePossiblyEncodedPayload(current[2] ?? current[1])
        }

        queue.push(...current)
      } else {
        queue.push(...Object.values(current))
      }
    }

    return undefined
  }

  private parsePossiblyEncodedPayload(node: unknown): unknown {
    if (typeof node !== "string") {
      return node
    }

    const parsed = this.tryParseJson(node)
    return parsed ?? node
  }

  private resolveSourceRows(payload: unknown): unknown[][] {
    const byContract = (payload as { 0?: { 1?: unknown } } | undefined)?.[0]?.[1]
    if (Array.isArray(byContract)) {
      return byContract.filter((row): row is unknown[] => Array.isArray(row))
    }

    return this.resolveRowsFromPayload(payload)
  }

  private resolveRowsFromPayload(payload: unknown): unknown[][] {
    const queue: unknown[] = [payload]
    const seen = new Set<unknown>()

    while (queue.length > 0) {
      const current = queue.shift()
      if (!current || typeof current !== "object") {
        continue
      }
      if (seen.has(current)) {
        continue
      }
      seen.add(current)

      if (Array.isArray(current)) {
        const isRows = current.length > 0 && current.every((entry) => Array.isArray(entry))
        if (isRows) {
          return current as unknown[][]
        }

        queue.push(...current)
      } else {
        queue.push(...Object.values(current))
      }
    }

    return []
  }

  private extractSnippetCandidates(raw: string, payload: unknown): string[] {
    const snippets: string[] = []
    const visit = (node: unknown): void => {
      if (typeof node === "string") {
        const normalized = node.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
        if (!normalized) {
          return
        }

        if (normalized.startsWith("{") || normalized.startsWith("[")) {
          const parsed = this.tryParseJson(normalized)
          if (parsed !== null) {
            visit(parsed)
            return
          }
        }

        snippets.push(normalized)
        return
      }

      if (Array.isArray(node)) {
        for (const item of node) {
          visit(item)
        }
        return
      }

      if (node && typeof node === "object") {
        for (const value of Object.values(node)) {
          visit(value)
        }
      }
    }

    const line3 = String(raw.split("\n")[3] ?? "").trim()
    if (line3) {
      const parsedLine3 = this.tryParseJson(line3)
      if (parsedLine3 !== null) {
        visit(parsedLine3)
      }
    }

    for (const line of raw.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed.startsWith("[")) {
        continue
      }

      const parsedLine = this.tryParseJson(trimmed)
      if (parsedLine !== null) {
        visit(parsedLine)
      }
    }

    visit(payload)
    return snippets
  }

  private normalizeSnippets(snippets: string[]): string[] {
    const output: string[] = []
    const seen = new Set<string>()

    for (const snippet of snippets) {
      const cleaned = this.cleanSnippet(snippet)
      if (!cleaned || seen.has(cleaned)) {
        continue
      }

      seen.add(cleaned)
      output.push(cleaned)
    }

    return output
  }

  private cleanSnippet(value: string): string | null {
    const cleaned = value
      .replace(/\u0000/g, "")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()

    if (!cleaned || cleaned.length < 2) {
      return null
    }

    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        cleaned
      )
    ) {
      return null
    }

    if (/^[A-Za-z0-9/_+=-]{24,}$/.test(cleaned) && !cleaned.includes(" ")) {
      return null
    }

    if (/^(description|descricao|descrição|mais|more|video[_\s-]?youtube)$/i.test(cleaned)) {
      return null
    }

    if (/^(true|false|null)$/i.test(cleaned)) {
      return null
    }

    return cleaned
  }

  private extractFirstUrl(node: unknown): string | null {
    const queue: unknown[] = [node]
    const seen = new Set<unknown>()

    while (queue.length > 0) {
      const current = queue.shift()
      if (typeof current === "string") {
        const urlMatch = current.match(/https?:\/\/[^\s)\]}>"']+/i)
        if (urlMatch?.[0]) {
          return urlMatch[0]
        }
        continue
      }

      if (!current || typeof current !== "object") {
        continue
      }
      if (seen.has(current)) {
        continue
      }
      seen.add(current)

      if (Array.isArray(current)) {
        queue.push(...current)
      } else {
        queue.push(...Object.values(current))
      }
    }

    return null
  }

  private resolveSourceType(title: string, url: string | undefined, gDocId: string | null): Source["type"] {
    const snapshot = `${title} ${url ?? ""}`.toLowerCase()

    if (gDocId || snapshot.includes("docs.google.com/document") || snapshot.includes("google doc")) {
      return "gdoc"
    }

    if (snapshot.includes("youtube.com") || snapshot.includes("youtu.be")) {
      return "youtube"
    }

    if (snapshot.includes(".pdf") || /\bpdf\b/.test(snapshot)) {
      return "pdf"
    }

    if ((url ?? "").startsWith("http")) {
      return "url"
    }

    return "text"
  }

  private tryParseJson(value: string): unknown | null {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }

  private pickString(...values: unknown[]): string | null {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) {
        return value.trim()
      }
    }

    return null
  }

  private pickNumber(...values: unknown[]): number | null {
    for (const value of values) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value
      }

      if (typeof value === "string" && value.trim()) {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) {
          return parsed
        }
      }
    }

    return null
  }

  private extractFirstNonTrivialString(node: unknown): string | null {
    const queue: unknown[] = [node]
    const seen = new Set<unknown>()

    while (queue.length > 0) {
      const current = queue.shift()
      if (typeof current === "string") {
        const normalized = current.trim()
        if (normalized && !normalized.startsWith("[") && !normalized.startsWith("{")) {
          return normalized
        }
        continue
      }

      if (!current || typeof current !== "object") {
        continue
      }
      if (seen.has(current)) {
        continue
      }
      seen.add(current)

      if (Array.isArray(current)) {
        queue.push(...current)
      } else {
        queue.push(...Object.values(current))
      }
    }

    return null
  }
}
