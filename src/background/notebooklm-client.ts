/**
 * MindDock — NotebookLM RPC Client
 * Executa todas as operações no NotebookLM via batchexecute.
 */

import {
  NOTEBOOKLM_RPC_ENDPOINT,
  RPC_IDS,
  STORAGE_KEYS,
  CACHE_TTL
} from "~/lib/constants"
import { parseRPCResponse, getFromStorage, setInStorage } from "~/lib/utils"
import type { Notebook, Source, RPCTokens } from "~/lib/types"

class NotebookLMClient {
  private reqId = 1

  // ─── Tokens ───────────────────────────────────────────────────────────────

  async getTokens(): Promise<RPCTokens | null> {
    const at = await getFromStorage<string>(STORAGE_KEYS.AT_TOKEN)
    const bl = await getFromStorage<string>(STORAGE_KEYS.BL_TOKEN)
    const sessionId = await getFromStorage<string>(STORAGE_KEYS.SESSION_ID)
    const authUser = await getFromStorage<string>(STORAGE_KEYS.AUTH_USER)
    if (!at || !bl) return null
    return {
      at,
      bl,
      sessionId: sessionId?.trim() || null,
      authUser: authUser?.trim() || null
    }
  }

  async saveTokens(tokens: RPCTokens): Promise<void> {
    await setInStorage(STORAGE_KEYS.AT_TOKEN, tokens.at)
    await setInStorage(STORAGE_KEYS.BL_TOKEN, tokens.bl)
    if (tokens.sessionId) {
      await setInStorage(STORAGE_KEYS.SESSION_ID, tokens.sessionId)
    }
    if (tokens.authUser) {
      await setInStorage(STORAGE_KEYS.AUTH_USER, tokens.authUser)
    }
    // Session token in NotebookLM rotates frequently; keep a short-lived expiration marker.
    await setInStorage(STORAGE_KEYS.TOKEN_EXPIRES_AT, Date.now() + 60 * 60 * 1000)
  }

  // ─── Request Builder ──────────────────────────────────────────────────────

  private buildUrl(rpcId: string, tokens: RPCTokens): string {
    const params = new URLSearchParams({
      rpcids: rpcId,
      "source-path": "/",
      bl: tokens.bl,
      _reqid: String(this.reqId++),
      rt: "c"
    })

    const authUser = String(tokens.authUser ?? "").trim()
    if (authUser) {
      params.set("authuser", authUser)
    }

    const sessionId = String(tokens.sessionId ?? "").trim()
    if (sessionId) {
      params.set("f.sid", sessionId)
    }

    return `${NOTEBOOKLM_RPC_ENDPOINT}?${params}`
  }

  private buildBody(rpcId: string, payload: unknown[], at: string): string {
    const inner = JSON.stringify([[rpcId, JSON.stringify(payload), null, "generic"]])
    const fReq = `[[${inner}]]`
    return `f.req=${encodeURIComponent(fReq)}&at=${encodeURIComponent(at)}`
  }

  private async execute<T>(
    rpcId: string,
    payload: unknown[],
    parser: (data: unknown) => T
  ): Promise<T> {
    const tokens = await this.getTokens()
    if (!tokens) {
      throw new Error(
        "Tokens não disponíveis. Abra o NotebookLM primeiro para que o MindDock possa capturá-los."
      )
    }

    const url = this.buildUrl(rpcId, tokens)
    const body = this.buildBody(rpcId, payload, tokens.at)

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Same-Domain": "1"
      },
      credentials: "include",
      body
    })

    if (!response.ok) {
      throw new Error(`RPC ${rpcId} falhou: HTTP ${response.status}`)
    }

    const text = await response.text()
    const data = parseRPCResponse(text)

    if (!data) {
      throw new Error(`RPC ${rpcId}: resposta inválida`)
    }

    return parser(data)
  }

  // ─── Listar Notebooks (wXbhsf) ────────────────────────────────────────────

  async listNotebooks(): Promise<Notebook[]> {
    // Verifica cache
    const cached = await getFromStorage<{ data: Notebook[]; ts: number }>(
      STORAGE_KEYS.NOTEBOOKS_CACHE
    )
    if (cached && Date.now() - cached.ts < CACHE_TTL.NOTEBOOKS) {
      return cached.data
    }

    const notebooks = await this.execute<Notebook[]>(
      RPC_IDS.LIST_NOTEBOOKS,
      [],
      (raw) => {
        try {
          // Estrutura típica: [[[rpcId, data, ...], ...]]
          const arr = raw as unknown[][]
          const inner = arr[0]?.[2]
          if (!inner) return []
          const parsed = typeof inner === "string" ? JSON.parse(inner) : inner
          // parsed[0] costuma ser a lista de notebooks
          const items = (parsed[0] as unknown[][]) ?? []
          return items.map((n: unknown[]) => ({
            id: n[2] as string,
            title: (n[3] as string) || "Sem título",
            createTime: n[4] as string,
            updateTime: n[5] as string,
            sourceCount: (n[6] as number) ?? 0
          }))
        } catch {
          return []
        }
      }
    )

    await setInStorage(STORAGE_KEYS.NOTEBOOKS_CACHE, {
      data: notebooks,
      ts: Date.now()
    })

    return notebooks
  }

  // ─── Listar Fontes (rLM1Ne) ───────────────────────────────────────────────

  async listSources(notebookId: string): Promise<Source[]> {
    const cacheKey = `${STORAGE_KEYS.SOURCES_CACHE}_${notebookId}`
    const cached = await getFromStorage<{ data: Source[]; ts: number }>(cacheKey)
    if (cached && Date.now() - cached.ts < CACHE_TTL.SOURCES) {
      return cached.data
    }

    const sources = await this.execute<Source[]>(
      RPC_IDS.LIST_SOURCES,
      [notebookId],
      (raw) => {
        try {
          const arr = raw as unknown[][]
          const inner = arr[0]?.[2]
          if (!inner) return []
          const parsed = typeof inner === "string" ? JSON.parse(inner) : inner
          const items = (parsed[0] as unknown[][]) ?? []
          return items.map((s: unknown[]) => ({
            id: s[0] as string,
            notebookId,
            title: (s[1] as string) || "Sem título",
            type: (s[2] as Source["type"]) || "text",
            url: s[3] as string | undefined,
            createTime: s[4] as string,
            updateTime: s[5] as string,
            wordCount: s[6] as number | undefined
          }))
        } catch {
          return []
        }
      }
    )

    await setInStorage(cacheKey, { data: sources, ts: Date.now() })
    return sources
  }

  // ─── Conteúdo de uma Fonte (hizoJc) ──────────────────────────────────────

  async getSourceContent(notebookId: string, sourceId: string): Promise<string> {
    return this.execute<string>(
      RPC_IDS.GET_SOURCE_CONTENT,
      [notebookId, sourceId],
      (raw) => {
        try {
          const arr = raw as unknown[][]
          const inner = arr[0]?.[2]
          if (!inner) return ""
          const parsed = typeof inner === "string" ? JSON.parse(inner) : inner
          return (parsed[0] as string) ?? ""
        } catch {
          return ""
        }
      }
    )
  }

  // ─── Adicionar Fonte de Texto (izAoDd) ────────────────────────────────────

  async addTextSource(
    notebookId: string,
    title: string,
    content: string
  ): Promise<string> {
    return this.execute<string>(
      RPC_IDS.ADD_SOURCE,
      [notebookId, null, [[null, null, title, content]]],
      (raw) => {
        try {
          const arr = raw as unknown[][]
          const inner = arr[0]?.[2]
          const parsed = typeof inner === "string" ? JSON.parse(inner) : inner
          return (parsed[0] as string) ?? ""
        } catch {
          return ""
        }
      }
    )
  }

  // ─── Adicionar Fonte por URL (izAoDd) ─────────────────────────────────────

  async addUrlSource(notebookId: string, url: string): Promise<string> {
    return this.execute<string>(
      RPC_IDS.ADD_SOURCE,
      [notebookId, [[url]], null],
      (raw) => {
        try {
          const arr = raw as unknown[][]
          const inner = arr[0]?.[2]
          const parsed = typeof inner === "string" ? JSON.parse(inner) : inner
          return (parsed[0] as string) ?? ""
        } catch {
          return ""
        }
      }
    )
  }

  // ─── Sync Google Doc (FLmJqe) ─────────────────────────────────────────────

  async syncGoogleDoc(notebookId: string, docUrl: string): Promise<boolean> {
    await this.execute<void>(
      RPC_IDS.SYNC_GDOC,
      [notebookId, docUrl],
      () => {}
    )
    return true
  }

  // ─── Invalidar cache ──────────────────────────────────────────────────────

  async invalidateCache(notebookId?: string): Promise<void> {
    if (notebookId) {
      await chrome.storage.local.remove(`${STORAGE_KEYS.SOURCES_CACHE}_${notebookId}`)
    } else {
      await chrome.storage.local.remove([
        STORAGE_KEYS.NOTEBOOKS_CACHE,
        STORAGE_KEYS.SOURCES_CACHE
      ])
    }
  }
}

export const notebookLMClient = new NotebookLMClient()
