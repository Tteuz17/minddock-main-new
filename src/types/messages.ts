export interface NotebookDiscoveryNotebook {
  id: string
  title: string
  createTime: string | null
  updateTime: string | null
}

export type NotebookDiscoveryProbeStatus =
  | "unauthorized"
  | "available"
  | "available_no_tokens"
  | "http_error"
  | "network_error"

export interface NotebookDiscoveryAccount {
  authIndex: number
  notebooks: NotebookDiscoveryNotebook[]
  email?: string
}

export interface NotebookDiscoveryProbeResult extends NotebookDiscoveryAccount {
  status: NotebookDiscoveryProbeStatus
  httpStatus?: number
  errorMessage?: string
}

export interface DiscoverSessionsMessage {
  type: "DISCOVER_SESSIONS"
  payload?: {
    indices?: number[]
  }
}

export interface DiscoverSessionsResponseData {
  accounts: NotebookDiscoveryAccount[]
  probeResults: NotebookDiscoveryProbeResult[]
  requestedIndices: number[]
  generatedAt: string
}
