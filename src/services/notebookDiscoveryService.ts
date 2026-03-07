const NOTEBOOKLM_RPC_ENDPOINT = "https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute"
const DEFAULT_AUTH_INDEX = 0
const BLOCK_NOISE_REGEX = /httprm|boq_|google|uuid/i
const BLOCK_FILE_REGEX = /\.pdf$|\.txt$|\.md$/i

type ProbeStatus = "unauthorized" | "available" | "http_error" | "network_error"

export interface NotebookModel {
  id: string
  title: string
  createTime: string | null
  updateTime: string | null
}

export interface NotebookAccountManifest {
  authIndex: number
  notebooks: NotebookModel[]
  email?: string
}

export interface NotebookProbeAccountResult extends NotebookAccountManifest {
  status: ProbeStatus
  httpStatus?: number
  errorMessage?: string
}

export interface FetchNotebooksWithProbeOptions {
  indices?: readonly number[]
  signal?: AbortSignal
}

export interface FetchNotebooksOptions {
  signal?: AbortSignal
}

export class NoActiveSessionError extends Error {
  constructor(message = "Nenhuma sessão ativa encontrada no NotebookLM.") {
    super(message)
    this.name = "NoActiveSessionError"
  }
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim()
}

function stripXssiPrefix(value: string): string {
  return String(value ?? "")
    .replace(/^\)\]\}'\s*/, "")
    .trim()
}

function extractEmail(rawValue: string, fallbackAuthIndex: number): string {
  const emailMatch = String(rawValue ?? "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)
  const normalizedEmail = normalizeString(emailMatch?.[0]).toLowerCase()
  return normalizedEmail || `Conta Google ${fallbackAuthIndex}`
}

function isValidNotebook(item: NotebookModel): boolean {
  const notebookId = normalizeString(item.id)
  const notebookTitle = normalizeString(item.title)

  if (!notebookId || !notebookTitle) {
    return false
  }

  if (notebookId === notebookTitle) {
    return false
  }

  if (notebookTitle.includes("af.httprm")) {
    return false
  }

  if (notebookTitle.length > 50 && !notebookTitle.includes(" ")) {
    return false
  }

  if (/[0-9a-f]{8}-[0-9a-f]{4}/i.test(notebookTitle)) {
    return false
  }

  if (BLOCK_NOISE_REGEX.test(notebookTitle)) {
    return false
  }

  if (BLOCK_FILE_REGEX.test(notebookTitle)) {
    return false
  }

  return true
}

function sanitizeNotebooks(items: NotebookModel[]): NotebookModel[] {
  const deduped = new Map<string, NotebookModel>()

  for (const item of items) {
    const normalized: NotebookModel = {
      id: normalizeString(item.id),
      title: normalizeString(item.title),
      createTime: normalizeString(item.createTime) || null,
      updateTime: normalizeString(item.updateTime) || null
    }

    if (!isValidNotebook(normalized)) {
      continue
    }

    if (!deduped.has(normalized.id)) {
      deduped.set(normalized.id, normalized)
    }
  }

  return Array.from(deduped.values())
}

function extractNotebooksWithRegex(rawBody: string): NotebookModel[] {
  const normalizedBody = normalizeString(rawBody)
  if (!normalizedBody) {
    return []
  }

  const candidates: NotebookModel[] = []

  // Pattern A: ["ID_LONGO","TITULO_HUMANO",...]
  const idTitlePattern = /\[\s*"([A-Za-z0-9_-]{10,})"\s*,\s*"([^"\\\n]{2,180})"\s*,/g
  for (const match of normalizedBody.matchAll(idTitlePattern)) {
    const id = normalizeString(match[1])
    const title = normalizeString(match[2])
    if (id && title) {
      candidates.push({
        id,
        title,
        createTime: null,
        updateTime: null
      })
    }
  }

  // Pattern B: ["TITULO_HUMANO","ID_LONGO",...]
  const titleIdPattern = /\[\s*"([^"\\\n]{2,180})"\s*,\s*"([A-Za-z0-9_-]{10,})"\s*,/g
  for (const match of normalizedBody.matchAll(titleIdPattern)) {
    const title = normalizeString(match[1])
    const id = normalizeString(match[2])
    if (id && title) {
      candidates.push({
        id,
        title,
        createTime: null,
        updateTime: null
      })
    }
  }

  return sanitizeNotebooks(candidates)
}

export async function fetchNotebooks(
  options: FetchNotebooksOptions = {}
): Promise<NotebookAccountManifest> {
  const requestUrl = new URL(NOTEBOOKLM_RPC_ENDPOINT)
  requestUrl.searchParams.set("authuser", String(DEFAULT_AUTH_INDEX))

  let response: Response
  try {
    response = await fetch(requestUrl.toString(), {
      method: "GET",
      credentials: "include",
      signal: options.signal
    })
  } catch (error) {
    const message =
      error instanceof Error && normalizeString(error.message)
        ? error.message
        : "Falha de rede ao buscar cadernos."
    throw new Error(message)
  }

  if (response.status === 401 || response.status === 403) {
    throw new NoActiveSessionError("Sessão inválida. Faça login no NotebookLM.")
  }

  if (!response.ok) {
    throw new Error(`Falha ao buscar cadernos (HTTP ${response.status}).`)
  }

  const rawResponseText = await response.text()
  const sanitizedText = stripXssiPrefix(rawResponseText)
  const responsePayloadText = sanitizedText || rawResponseText
  const email = extractEmail(responsePayloadText, DEFAULT_AUTH_INDEX)
  const notebooks = extractNotebooksWithRegex(responsePayloadText)

  return {
    authIndex: DEFAULT_AUTH_INDEX,
    email,
    notebooks
  }
}

export function resolveActiveSessions(
  probeResults: NotebookProbeAccountResult[]
): NotebookAccountManifest[] {
  return probeResults
    .filter((item) => item.status === "available")
    .map((item) => ({
      authIndex: item.authIndex,
      email: item.email || `Conta Google ${item.authIndex}`,
      notebooks: sanitizeNotebooks(item.notebooks)
    }))
}

export async function probeAvailableAccounts(
  options: FetchNotebooksWithProbeOptions = {}
): Promise<NotebookProbeAccountResult[]> {
  const preferredIndex = Array.isArray(options.indices) && options.indices.length > 0 ? 0 : 0

  try {
    const accountManifest = await fetchNotebooks({ signal: options.signal })
    return [
      {
        authIndex: preferredIndex,
        email: accountManifest.email,
        notebooks: accountManifest.notebooks,
        status: "available",
        httpStatus: 200
      }
    ]
  } catch (error) {
    if (error instanceof NoActiveSessionError) {
      return [
        {
          authIndex: preferredIndex,
          email: `Conta Google ${preferredIndex}`,
          notebooks: [],
          status: "unauthorized",
          httpStatus: 401,
          errorMessage: error.message
        }
      ]
    }

    const normalizedMessage = error instanceof Error ? error.message : "Falha de rede."
    return [
      {
        authIndex: preferredIndex,
        email: `Conta Google ${preferredIndex}`,
        notebooks: [],
        status: "network_error",
        errorMessage: normalizedMessage
      }
    ]
  }
}

export async function fetchNotebooksWithProbe(
  options: FetchNotebooksWithProbeOptions = {}
): Promise<NotebookAccountManifest[]> {
  const probeResults = await probeAvailableAccounts(options)
  const activeSessions = resolveActiveSessions(probeResults)

  if (activeSessions.length === 0) {
    throw new NoActiveSessionError()
  }

  return activeSessions
}

export const notebookDiscoveryService = {
  fetchNotebooks,
  fetchNotebooksWithProbe,
  probeAvailableAccounts,
  resolveActiveSessions
}
