// ─── NotebookLM Types ───────────────────────────────────────────────────────

export interface Notebook {
  id: string
  title: string
  createTime: string
  updateTime: string
  sourceCount?: number
}

export interface Source {
  id: string
  notebookId: string
  title: string
  content?: string
  type: "text" | "url" | "gdoc" | "pdf" | "youtube"
  url?: string
  isGDoc?: boolean
  isYoutube?: boolean
  createTime: string
  updateTime: string
  wordCount?: number
}

export interface RPCTokens {
  at: string
  bl: string
  accountEmail?: string | null
  sessionId?: string | null
  authUser?: string | null
}

// ─── User & Auth Types ──────────────────────────────────────────────────────

export type SubscriptionTier = "free" | "pro" | "thinker" | "thinker_pro"
export type SubscriptionStatus = "active" | "inactive" | "canceled" | "past_due"

export interface UserProfile {
  id: string
  email: string
  displayName?: string
  avatarUrl?: string
  stripeCustomerId?: string
  subscriptionTier: SubscriptionTier
  subscriptionStatus: SubscriptionStatus
  createdAt: string
  updatedAt: string
}

export interface AuthState {
  user: UserProfile | null
  isLoading: boolean
  isAuthenticated: boolean
}

export type SidePanelLaunchTarget = "notes" | "graph" | "create_note" | "link_note"

export interface SidePanelNoteDraft {
  title: string
  content: string
  tags?: string[]
}

// ─── Zettelkasten Types ─────────────────────────────────────────────────────

export interface Note {
  id: string
  userId: string
  title: string
  content: string
  tags: string[]
  notebookId?: string
  source: "manual" | "zettel_maker" | "import"
  linkedNoteIds: string[]
  backlinks: NoteBacklink[]
  createdAt: string
  updatedAt: string
}

export interface NoteBacklink {
  noteId: string
  noteTitle: string
}

export interface NoteLink {
  id: string
  userId: string
  sourceNoteId: string
  targetNoteId: string
  createdAt: string
}

// ─── Prompt Library Types ───────────────────────────────────────────────────

export interface SavedPrompt {
  id: string
  userId: string
  title: string
  content: string
  folderId?: string
  tags: string[]
  useCount: number
  createdAt: string
  updatedAt: string
}

export interface PromptFolder {
  id: string
  userId: string
  name: string
  parentId?: string
  children?: PromptFolder[]
  prompts?: SavedPrompt[]
  createdAt: string
}

// ─── Agile Prompt Types ─────────────────────────────────────────────────────

export type AgilePromptKey =
  | "study_roadmap"
  | "executive_summary"
  | "extract_concepts"
  | "compare_sources"
  | "flashcards"
  | "deep_analysis"
  | "mind_map"
  | "rewrite"

export interface AgilePrompt {
  key: AgilePromptKey
  icon: string
  label: string
  prompt: string
  tier: "pro" | "thinker"
}

// ─── Collection & Organization Types ───────────────────────────────────────

export interface Collection {
  id: string
  userId: string
  name: string
  color: string
  notebookIds: string[]
  createdAt: string
}

export interface Tag {
  id: string
  userId: string
  name: string
  color: string
  createdAt: string
}

export interface Folder {
  id: string
  userId: string
  name: string
  parentId?: string
  children?: Folder[]
  createdAt: string
}

// ─── Export Types ───────────────────────────────────────────────────────────

export type ExportFormat = "markdown" | "txt" | "pdf" | "json"

export interface ExportOptions {
  format: ExportFormat
  sources: Source[]
  includeMetadata: boolean
}

// ─── Message Types (Chrome Runtime) ────────────────────────────────────────

export type MessageCommand =
  | "MINDDOCK_STORE_SESSION_TOKENS"
  | "MINDDOCK_CMD_AUTH_SIGN_IN"
  | "MINDDOCK_CMD_AUTH_SIGN_OUT"
  | "MINDDOCK_CMD_AUTH_GET_STATUS"
  | "MINDDOCK_CMD_GET_NOTEBOOKS"
  | "MINDDOCK_CMD_CREATE_NOTEBOOK"
  | "MINDDOCK_CMD_GET_NOTEBOOK_SOURCES"
  | "MINDDOCK_CMD_GET_SOURCE_CONTENTS"
  | "MINDDOCK_CMD_REFRESH_GDOC_SOURCES"
  | "MINDDOCK_CMD_SYNC_ALL_GDOCS"
  | "MINDDOCK_SAVE_TOKENS"
  | "MINDDOCK_LIST_NOTEBOOKS"
  | "MINDDOCK_LIST_SOURCES"
  | "MINDDOCK_GET_SOURCE_CONTENT"
  | "MINDDOCK_ADD_SOURCE"
  | "MINDDOCK_SYNC_GDOC"
  | "MINDDOCK_IMPORT_AI_CHAT"
  | "PROTOCOL_APPEND_SOURCE"
  | "MINDDOCK_GET_AUTH"
  | "MINDDOCK_SIGN_IN"
  | "MINDDOCK_SIGN_OUT"
  | "MINDDOCK_CHECK_SUBSCRIPTION"
  | "MINDDOCK_IMPROVE_PROMPT"
  | "MINDDOCK_ATOMIZE_NOTE"
  | "MINDDOCK_EXPORT_SOURCES"
  | "MINDDOCK_HIGHLIGHT_SNIPE"
  | "MINDDOCK_OPEN_SIDEPANEL"

export interface ChromeMessage<T = unknown> {
  command: MessageCommand
  action?: MessageCommand
  payload?: T
}

export interface ChromeMessageResponse<T = unknown> {
  success: boolean
  payload?: T
  data?: T
  error?: string
}

// ─── Subscription Limits ────────────────────────────────────────────────────

export interface PlanLimits {
  imports_per_day: number | "unlimited"
  exports_per_day: number | "unlimited"
  prompts_saved: number | "unlimited"
  prompt_folders: number | "unlimited"
  source_views: number | "unlimited"
  captures: number | "unlimited"
  collections: number | "unlimited"
  ai_features: boolean
  zettelkasten: boolean
  cloud_sync: boolean
  agile_prompts_basic?: boolean
  agile_prompts_ai?: boolean
  ai_calls_per_day?: number | "unlimited"
  notes_limit?: number | "unlimited"
  priority_support?: boolean
  early_access?: boolean
}

// ─── Graph View Types ───────────────────────────────────────────────────────

export interface GraphNode {
  id: string
  label: string
  title: string
  color?: string
  size?: number
}

export interface GraphEdge {
  id: string
  from: string
  to: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// ─── UI State Types ─────────────────────────────────────────────────────────

export interface ToastOptions {
  title: string
  description?: string
  variant?: "default" | "success" | "error" | "info"
  duration?: number
}

export interface ModalState {
  isOpen: boolean
  type?: "create_note" | "create_prompt" | "create_folder" | "export" | "settings" | "upgrade"
  data?: unknown
}

// ─── AI Chat Import Types ───────────────────────────────────────────────────

export type AIChatPlatform = "chatgpt" | "claude" | "gemini" | "perplexity"

export interface AIChatCapture {
  platform: AIChatPlatform
  conversationTitle?: string
  messages: AIChatMessage[]
  capturedAt: string
  url: string
}

export interface AIChatMessage {
  role: "user" | "assistant"
  content: string
  timestamp?: string
}


// ─── Focus Threads ───────────────────────────────────────────────────────────

export interface Thread {
  id: string
  userId: string
  notebookId: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface ThreadMessage {
  id: string
  threadId: string
  role: "user" | "assistant"
  content: string
  createdAt: string
}
