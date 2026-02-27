export const FIXED_STORAGE_KEYS = {
  PROJECT_URL: "nexus_project_url",
  ANON_KEY: "nexus_anon_key",
  SUPABASE_SESSION: "minddock_supabase_session",
  AT_TOKEN: "nexus_at_token",
  BL_TOKEN: "nexus_bl_token",
  SESSION_ID: "nexus_session_id",
  AUTH_USER: "nexus_auth_user",
  TOKEN_EXPIRES_AT: "nexus_token_expires_at"
} as const

export const SECURE_TOKEN_EVENT = {
  TYPE: "MINDDOCK_SECURE_TOKEN_BROADCAST",
  HANDSHAKE: "md-v1-secure"
} as const

export const MESSAGE_ACTIONS = {
  STORE_SESSION_TOKENS: "MINDDOCK_STORE_SESSION_TOKENS",
  CMD_AUTH_SIGN_IN: "MINDDOCK_CMD_AUTH_SIGN_IN",
  CMD_AUTH_SIGN_OUT: "MINDDOCK_CMD_AUTH_SIGN_OUT",
  CMD_AUTH_GET_STATUS: "MINDDOCK_CMD_AUTH_GET_STATUS",
  CMD_GET_NOTEBOOKS: "MINDDOCK_CMD_GET_NOTEBOOKS",
  CMD_GET_NOTEBOOK_SOURCES: "MINDDOCK_CMD_GET_NOTEBOOK_SOURCES",
  CMD_GET_SOURCE_CONTENTS: "MINDDOCK_CMD_GET_SOURCE_CONTENTS",
  CMD_REFRESH_GDOC_SOURCES: "MINDDOCK_CMD_REFRESH_GDOC_SOURCES",
  CMD_SYNC_ALL_GDOCS: "MINDDOCK_CMD_SYNC_ALL_GDOCS"
} as const

export const NOTEBOOKLM_RPC_CONTRACT = {
  ENDPOINT: "https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute",
  LIST_NOTEBOOKS_RPC_ID: "wXbhsf",
  LIST_SOURCES_RPC_ID: "rLM1Ne",
  GET_SOURCE_CONTENT_RPC_ID: "hizoJc",
  ADD_SOURCE_RPC_ID: "izAoDd",
  SYNC_GDOC_RPC_ID: "FLmJqe"
} as const

export interface StandardResponse<T = unknown> {
  success: boolean
  payload?: T
  error?: string
  // Legacy alias kept for compatibility with existing popup hooks.
  data?: T
}

export interface SessionTokens {
  at: string
  bl: string
  sessionId?: string | null
  authUser?: string | null
}
