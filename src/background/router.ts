import { authManager } from "./auth-manager"
import { storageManager } from "./storage-manager"
import { subscriptionManager } from "./subscription"
import { aiService } from "~/services/ai-service"
import { exportService } from "~/services/export-service"
import { zettelkastenService } from "~/services/zettelkasten"
import { threadService } from "~/services/thread-service"
import { STORAGE_KEYS } from "~/lib/constants"
import {
  FIXED_STORAGE_KEYS,
  MESSAGE_ACTIONS,
  type StandardResponse
} from "~/lib/contracts"
import { formatChatAsMarkdown } from "~/lib/utils"
import type {
  ChromeMessage,
  ChromeMessageResponse,
  Notebook,
  SidePanelLaunchTarget,
  SidePanelNoteDraft
} from "~/lib/types"

type MessageSender = chrome.runtime.MessageSender

type Handler = (
  payload: unknown,
  sender: MessageSender
) => Promise<StandardResponse>

class MessageRouter {
  private handlers: Map<string, Handler> = new Map()
  private readonly notebookCacheKey = "minddock_cached_notebooks"
  private readonly backgroundSyncAction = "SYNC_NOTEBOOKS"

  constructor() {
    // Phase 1 fixed actions.
    this.register(MESSAGE_ACTIONS.STORE_SESSION_TOKENS, this.handleStoreSessionTokens)
    this.register(MESSAGE_ACTIONS.CMD_AUTH_SIGN_IN, this.handleAuthSignIn)
    this.register(MESSAGE_ACTIONS.CMD_AUTH_SIGN_OUT, this.handleAuthSignOut)
    this.register(MESSAGE_ACTIONS.CMD_AUTH_GET_STATUS, this.handleAuthGetStatus)
    this.register(MESSAGE_ACTIONS.CMD_GET_NOTEBOOKS, this.handleGetNotebooks)
    this.register(MESSAGE_ACTIONS.CMD_GET_NOTEBOOK_SOURCES, this.handleGetNotebookSources)
    this.register(MESSAGE_ACTIONS.CMD_GET_SOURCE_CONTENTS, this.handleGetSourceContents)
    this.register(MESSAGE_ACTIONS.CMD_REFRESH_GDOC_SOURCES, this.handleRefreshGDocSources)
    this.register(MESSAGE_ACTIONS.CMD_SYNC_ALL_GDOCS, this.handleRefreshGDocSources)
    this.register(this.backgroundSyncAction, this.handleSyncNotebooks)

    // Legacy aliases kept to avoid regressions in existing popup/sidepanel code.
    this.register("MINDDOCK_SAVE_TOKENS", this.handleStoreSessionTokens)
    this.register("MINDDOCK_LIST_NOTEBOOKS", this.handleGetNotebooks)
    this.register("MINDDOCK_LIST_SOURCES", this.handleGetNotebookSources)
    this.register("MINDDOCK_GET_AUTH", this.handleAuthGetStatus)
    this.register("MINDDOCK_SIGN_OUT", this.handleAuthSignOut)
    this.register("MINDDOCK_SIGN_IN", this.handleLegacySignIn)

    this.register("MINDDOCK_GET_SOURCE_CONTENT", this.handleGetSourceContent)
    this.register("MINDDOCK_ADD_SOURCE", this.handleAddSource)
    this.register("MINDDOCK_SYNC_GDOC", this.handleSyncGdoc)
    this.register("MINDDOCK_IMPORT_AI_CHAT", this.handleImportAIChat)
    this.register("PROTOCOL_APPEND_SOURCE", this.handleProtocolAppendSource)
    this.register("MINDDOCK_CHECK_SUBSCRIPTION", this.handleCheckSubscription)
    this.register("MINDDOCK_IMPROVE_PROMPT", this.handleImprovePrompt)
    this.register("MINDDOCK_ATOMIZE_NOTE", this.handleAtomizeNote)
    this.register(MESSAGE_ACTIONS.ATOMIZE_PREVIEW, this.handleAtomizePreview)
    this.register(MESSAGE_ACTIONS.SAVE_ATOMIC_NOTES, this.handleSaveAtomicNotes)
    this.register(MESSAGE_ACTIONS.PROMPT_OPTIONS, this.handlePromptOptions)
    this.register("MINDDOCK_EXPORT_SOURCES", this.handleExportSources)
    this.register("MINDDOCK_HIGHLIGHT_SNIPE", this.handleHighlightSnipe)
    this.register(MESSAGE_ACTIONS.THREAD_LIST, this.handleThreadList)
    this.register(MESSAGE_ACTIONS.THREAD_CREATE, this.handleThreadCreate)
    this.register(MESSAGE_ACTIONS.THREAD_DELETE, this.handleThreadDelete)
    this.register(MESSAGE_ACTIONS.THREAD_RENAME, this.handleThreadRename)
    this.register(MESSAGE_ACTIONS.THREAD_MESSAGES, this.handleThreadMessages)
    this.register(MESSAGE_ACTIONS.THREAD_SAVE_MESSAGES, this.handleThreadSaveMessages)
    this.register(MESSAGE_ACTIONS.OPEN_SIDEPANEL, this.handleOpenSidePanel)
  }

  private register(command: string, handler: Handler): void {
    this.handlers.set(command, handler.bind(this))
  }

  async handle(
    message: ChromeMessage & { action?: string; intent?: string; tokens?: unknown },
    sender: MessageSender,
    sendResponse: (response: ChromeMessageResponse) => void
  ): Promise<void> {
    const action = this.resolveIncomingAction(message)
    const handler = this.handlers.get(action)
    if (!handler) {
      sendResponse(
        this.normalizeResponse({
          success: false,
          error: `Comando desconhecido: ${action || "undefined"}`
        })
      )
      return
    }

    try {
      const payload = this.resolveIncomingPayload(message, action)
      const result = await handler(payload, sender)
      sendResponse(this.normalizeResponse(result))
    } catch (err) {
      const errorMsg =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message ?? "Erro desconhecido"
      console.error(`[MindDock Router] ${action}:`, err)
      sendResponse(
        this.normalizeResponse({
          success: false,
          error: errorMsg
        })
      )
    }
  }

  private normalizeResponse<T>(response: StandardResponse<T>): ChromeMessageResponse<T> {
    const normalized: ChromeMessageResponse<T> = {
      success: response.success,
      error: response.error
    }

    if (response.payload !== undefined) {
      normalized.payload = response.payload
      // Legacy alias consumed by older hooks/components.
      normalized.data = response.payload
    }

    return normalized
  }

  private ok<T>(payload?: T): StandardResponse<T> {
    if (payload === undefined) {
      return { success: true }
    }
    return { success: true, payload }
  }

  private fail(error: string): StandardResponse {
    return { success: false, error }
  }

  private resolveIncomingAction(
    message: ChromeMessage & { action?: string; intent?: string }
  ): string {
    const byCommand = String(message?.command ?? "").trim()
    if (byCommand) {
      return byCommand
    }

    const byAction = String(message?.action ?? "").trim()
    if (byAction) {
      return byAction
    }

    return String(message?.intent ?? "").trim()
  }

  private resolveIncomingPayload(
    message: ChromeMessage & { action?: string; intent?: string; tokens?: unknown },
    action: string
  ): unknown {
    if (message?.payload !== undefined) {
      return message.payload
    }

    // Legacy token bridge sometimes sends { tokens } instead of { payload }.
    if (action === MESSAGE_ACTIONS.STORE_SESSION_TOKENS && message?.tokens !== undefined) {
      return message.tokens
    }

    // Legacy intent payloads may arrive flat, sem wrapper "payload".
    if (message?.intent && !message?.command && !message?.action) {
      const { intent, command, action, tokens, ...rest } = message as unknown as Record<
        string,
        unknown
      >
      void intent
      void command
      void action
      void tokens
      return rest
    }

    return undefined
  }

  // Phase 1 handlers
  private async handleStoreSessionTokens(payload: unknown): Promise<StandardResponse> {
    const raw = (payload as
        | {
            at?: string
            bl?: string
            atToken?: string
            blToken?: string
            sessionId?: string
            authUser?: string
            authUserIndex?: string
            tokens?: { at?: string; bl?: string; atToken?: string; blToken?: string }
          }
      | undefined) ?? { tokens: {} }

    const nestedTokens = raw.tokens ?? {}

    const at =
      String(raw.at ?? raw.atToken ?? nestedTokens.at ?? nestedTokens.atToken ?? "").trim() ||
      null
    const bl =
      String(raw.bl ?? raw.blToken ?? nestedTokens.bl ?? nestedTokens.blToken ?? "").trim() ||
      null
    const sessionId = String(raw.sessionId ?? "").trim() || null
    const authUser = String(raw.authUser ?? raw.authUserIndex ?? "").trim() || null

    if (!at || !bl) {
      return this.fail("Payload invalido para MINDDOCK_STORE_SESSION_TOKENS: at/bl obrigatorios.")
    }

    await chrome.storage.local.set({
      [FIXED_STORAGE_KEYS.AT_TOKEN]: at,
      [FIXED_STORAGE_KEYS.BL_TOKEN]: bl,
      [FIXED_STORAGE_KEYS.SESSION_ID]: sessionId,
      [FIXED_STORAGE_KEYS.AUTH_USER]: authUser,
      [FIXED_STORAGE_KEYS.TOKEN_EXPIRES_AT]: Date.now() + 60 * 60 * 1000
    })
    return this.ok()
  }

  private async handleSyncNotebooks(payload: unknown): Promise<StandardResponse> {
    const rawNotebooks = Array.isArray((payload as { notebooks?: unknown[] } | undefined)?.notebooks)
      ? ((payload as { notebooks?: unknown[] }).notebooks as unknown[])
      : []

    const now = new Date().toISOString()
    const notebooks = rawNotebooks
      .filter((item): item is { id?: unknown; title?: unknown } => typeof item === "object" && item !== null)
      .map((item) => ({
        id: String(item.id ?? "").trim(),
        title: String(item.title ?? "").trim(),
        createTime: now,
        updateTime: now,
        sourceCount: 0
      }))
      .filter((item) => item.id && item.title)

    await chrome.storage.local.set({
      [this.notebookCacheKey]: notebooks
    })

    return this.ok({ syncedCount: notebooks.length })
  }

  private async handleAuthSignIn(payload: unknown): Promise<StandardResponse> {
    const email = (payload as { email?: string })?.email
    const password = (payload as { password?: string })?.password

    const user = await authManager.signIn(email ?? "", password ?? "")
    return this.ok({ isAuthenticated: true, user })
  }

  private async handleAuthSignOut(): Promise<StandardResponse> {
    await authManager.signOut()
    return this.ok({ isAuthenticated: false })
  }

  private async handleAuthGetStatus(): Promise<StandardResponse> {
    const user = await authManager.getCurrentUser()
    return this.ok({
      isAuthenticated: !!user,
      user
    })
  }

  private async handleGetNotebooks(): Promise<StandardResponse> {
    const notebooks = await this.fetchAvailableNotebooks()
    return this.ok(notebooks)
  }

  private async handleGetNotebookSources(payload: unknown): Promise<StandardResponse> {
    void payload
    return this.fail(
      "Leitura de fontes via background foi desativada. Use o content script para sincronizar dados do NotebookLM."
    )
  }

  private async handleGetSourceContents(payload: unknown): Promise<StandardResponse> {
    void payload
    return this.fail(
      "Leitura de conteudo de fontes via background foi desativada. Use o content script para sincronizar dados do NotebookLM."
    )
  }

  private async handleRefreshGDocSources(payload: unknown): Promise<StandardResponse> {
    void payload
    return this.fail(
      "Sincronizacao GDoc via background foi desativada. Use o content script para sincronizar dados do NotebookLM."
    )
  }

  // Legacy auth command preserved for popup flow that still uses OAuth Google.
  private async handleLegacySignIn(payload: unknown): Promise<StandardResponse> {
    const email = (payload as { email?: string })?.email
    const password = (payload as { password?: string })?.password

    if (email && password) {
      return this.handleAuthSignIn(payload)
    }

      const { url } = await authManager.signInWithGoogle()
      return new Promise((resolve) => {
        chrome.identity.launchWebAuthFlow({ url, interactive: true }, async (redirectUrl) => {
          const runtimeErrorMessage = String(chrome.runtime.lastError?.message ?? "").trim()
          if (runtimeErrorMessage || !redirectUrl) {
            resolve(
              this.fail(
                runtimeErrorMessage ||
                  "Falha no login Google: nenhum redirect OAuth foi retornado. Verifique o redirect URL da extensao no Supabase."
              )
            )
            return
          }

          try {
            const user = await authManager.completeOAuthFlow(redirectUrl)
          resolve(this.ok({ isAuthenticated: !!user, user }))
        } catch (error) {
          resolve(this.fail(error instanceof Error ? error.message : "Falha ao concluir login."))
        }
      })
    })
  }

  // Existing non-phase1 handlers
  private async handleGetSourceContent(payload: unknown): Promise<StandardResponse> {
    void payload
    return this.fail(
      "Visualizacao de fonte via background foi desativada. Use o content script para sincronizar dados do NotebookLM."
    )
  }

  private async handleAddSource(payload: unknown): Promise<StandardResponse> {
    void payload
    return this.fail(
      "Envio de fonte via background foi desativado. Use o content script para acionar operacoes no NotebookLM."
    )
  }

  private async handleSyncGdoc(payload: unknown): Promise<StandardResponse> {
    void payload
    return this.fail(
      "Sync de GDoc via background foi desativado. Use o content script para acionar operacoes no NotebookLM."
    )
  }

  private async handleProtocolAppendSource(payload: unknown): Promise<StandardResponse> {
    const { conversation, notebookId, sourceTitle, sourcePlatform, capturedFromUrl } = payload as {
      conversation?: Array<{ role?: string; content?: string }>
      notebookId?: string
      sourceTitle?: string
      sourcePlatform?: string
      capturedFromUrl?: string
    }

    const safeConversation = Array.isArray(conversation)
      ? conversation
          .map((message) => ({
            role: message?.role === "assistant" ? "assistant" : "user",
            content: String(message?.content ?? "").trim()
          }))
          .filter((message) => message.content.length > 0)
      : []

    if (safeConversation.length === 0) {
      return this.fail("conversation obrigatoria para PROTOCOL_APPEND_SOURCE.")
    }

    const normalizedPlatform = String(sourcePlatform ?? "").trim() || "Chat"
    const normalizedTitle = String(sourceTitle ?? "").trim() || "Untitled Chat"
    const capturedAtIso = new Date().toISOString()

    const markdown = formatChatAsMarkdown(normalizedPlatform, safeConversation, normalizedTitle)

    return this.handleImportAIChat({
      platform: normalizedPlatform.toLowerCase(),
      conversationTitle: normalizedTitle,
      content: markdown,
      capturedAt: capturedAtIso,
      url: String(capturedFromUrl ?? "").trim(),
      notebookId: String(notebookId ?? "").trim() || undefined
    })
  }

  private async handleImportAIChat(payload: unknown): Promise<StandardResponse> {
    const { platform, conversationTitle, content, capturedAt, notebookId } = payload as {
      platform: string
      conversationTitle: string
      content: string
      capturedAt: string
      notebookId?: string
    }

    const canImport = await storageManager.checkUsageLimit(
      "imports",
      (await subscriptionManager.getLimits()).imports_per_day
    )
    if (!canImport) {
      return this.fail("Limite diario de importacoes atingido. Faca upgrade pro plano Pro.")
    }

    const resolvedNotebookId = await this.resolvePreferredNotebookId(notebookId, true)

    const title =
      conversationTitle ||
      `Conversa ${platform} - ${new Date(capturedAt).toLocaleDateString("pt-BR")}`

    void platform
    void conversationTitle
    void content
    void capturedAt
    void resolvedNotebookId
    void title
    return this.fail(
      "Importacao de chats via background foi desativada. Use o content script para acionar operacoes no NotebookLM."
    )
  }

  private async handleCheckSubscription(): Promise<StandardResponse> {
    await subscriptionManager.invalidate()
    const tier = await subscriptionManager.getTier()
    return this.ok({ tier })
  }

  private async handleImprovePrompt(payload: unknown): Promise<StandardResponse> {
    const { prompt } = payload as { prompt: string }
    const canUseAI = await subscriptionManager.canUseFeature("ai_features")
    if (!canUseAI) {
      return this.fail("Melhoria de prompts requer plano Thinker ou superior.")
    }
    const canCallAI = await storageManager.checkUsageLimit(
      "aiCalls",
      (await subscriptionManager.getLimits()).ai_calls_per_day ?? 0
    )
    if (!canCallAI) {
      return this.fail("Limite de chamadas de IA atingido para hoje.")
    }
    const improved = await aiService.improvePrompt(prompt)
    await storageManager.incrementUsage("aiCalls")
    return this.ok({ improved })
  }

  private async handlePromptOptions(payload: unknown): Promise<StandardResponse> {
    const { prompt } = payload as { prompt: string }
    const options = await aiService.generatePromptOptions(prompt)
    return this.ok({ options })
  }

  // ─── Focus Threads ─────────────────────────────────────────────────────────

  private async handleThreadList(payload: unknown): Promise<StandardResponse> {
    const { userId, notebookId } = payload as { userId: string; notebookId: string }
    const threads = await threadService.getThreads(userId, notebookId)
    return this.ok({ threads })
  }

  private async handleThreadCreate(payload: unknown): Promise<StandardResponse> {
    const { userId, notebookId, name } = payload as {
      userId: string; notebookId: string; name: string
    }
    const thread = await threadService.createThread(userId, notebookId, name)
    return this.ok({ thread })
  }

  private async handleThreadDelete(payload: unknown): Promise<StandardResponse> {
    const { threadId } = payload as { threadId: string }
    await threadService.deleteThread(threadId)
    return this.ok({})
  }

  private async handleThreadRename(payload: unknown): Promise<StandardResponse> {
    const { threadId, name } = payload as { threadId: string; name: string }
    const thread = await threadService.renameThread(threadId, name)
    return this.ok({ thread })
  }

  private async handleThreadMessages(payload: unknown): Promise<StandardResponse> {
    const { threadId } = payload as { threadId: string }
    const messages = await threadService.getMessages(threadId)
    return this.ok({ messages })
  }

  private async handleThreadSaveMessages(payload: unknown): Promise<StandardResponse> {
    const { threadId, messages } = payload as {
      threadId: string
      messages: Array<{ role: "user" | "assistant"; content: string }>
    }
    await threadService.saveMessages(threadId, messages)
    return this.ok({})
  }

  private async handleOpenSidePanel(
    payload: unknown,
    sender: MessageSender
  ): Promise<StandardResponse> {
    const raw = (payload ?? {}) as {
      target?: SidePanelLaunchTarget
      draft?: SidePanelNoteDraft | null
    }

    const target = String(raw.target ?? "").trim() as SidePanelLaunchTarget
    const validTargets: SidePanelLaunchTarget[] = ["notes", "graph", "create_note", "link_note"]

    if (!validTargets.includes(target)) {
      return this.fail("Target invalido para abrir o side panel.")
    }

    const storagePayload: Record<string, unknown> = {
      [STORAGE_KEYS.SIDEPANEL_VIEW]: target
    }

    const hasDraft =
      raw.draft &&
      typeof raw.draft.title === "string" &&
      typeof raw.draft.content === "string" &&
      raw.draft.title.trim() &&
      raw.draft.content.trim()

    if (hasDraft) {
      storagePayload[STORAGE_KEYS.SIDEPANEL_NOTE_DRAFT] = {
        title: raw.draft!.title.trim(),
        content: raw.draft!.content.trim(),
        tags: Array.isArray(raw.draft!.tags)
          ? raw.draft!.tags.map((tag) => String(tag).trim()).filter(Boolean)
          : []
      }
    } else {
      storagePayload[STORAGE_KEYS.SIDEPANEL_NOTE_DRAFT] = null
    }

    await chrome.storage.local.set(storagePayload)

    if (!chrome.sidePanel?.open) {
      return this.fail("API de side panel indisponivel.")
    }

    const targetWindowId = sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT
    await chrome.sidePanel.open({ windowId: targetWindowId })

    return this.ok()
  }

  private async handleAtomizeNote(payload: unknown): Promise<StandardResponse> {
    const { content } = payload as { content: string }
    const canUseZettel = await subscriptionManager.canUseFeature("zettelkasten")
    if (!canUseZettel) {
      return this.fail("Zettelkasten requer plano Thinker ou superior.")
    }
    const notes = await aiService.atomizeContent(content)
    const user = await authManager.getCurrentUser()
    if (!user) {
      return this.fail("Nao autenticado.")
    }

    await zettelkastenService.saveAtomicNotes(user.id, notes)
    await storageManager.incrementUsage("aiCalls")
    return this.ok({ count: notes.length })
  }

  private async handleExportSources(payload: unknown): Promise<StandardResponse> {
    const { sources, format } = payload as {
      sources: unknown[]
      format: string
    }
    const canExport = await storageManager.checkUsageLimit(
      "exports",
      (await subscriptionManager.getLimits()).exports_per_day
    )
    if (!canExport) {
      return this.fail("Limite diario de exports atingido.")
    }
    const result = await exportService.export(sources as never[], format as never)
    await storageManager.incrementUsage("exports")
    return this.ok(result)
  }

  private async handleHighlightSnipe(payload: unknown): Promise<StandardResponse> {
    const { content, text, title, notebookId } = payload as {
      content: string
      text?: string
      title: string
      notebookId?: string
    }
    const sourceContent = content || text || ""
    if (!sourceContent.trim()) {
      return this.fail("Conteudo vazio para captura.")
    }

    void notebookId
    void title
    return this.fail(
      "Captura de selecao via background foi desativada. Use o content script para acionar operacoes no NotebookLM."
    )
  }

  private async handleAtomizePreview(payload: unknown): Promise<StandardResponse> {
    const { content } = payload as { content: string }
    if (!content?.trim()) {
      return this.fail("Conteudo vazio para atomizacao.")
    }
    const notes = await aiService.atomizeContent(content)
    return this.ok({ notes })
  }

  private async handleSaveAtomicNotes(payload: unknown): Promise<StandardResponse> {
    const { notes } = payload as {
      notes: Array<{ title: string; content: string; tags: string[]; source?: string }>
    }
    if (!Array.isArray(notes) || notes.length === 0) {
      return this.fail("Nenhuma nota para salvar.")
    }
    const user = await authManager.getCurrentUser()
    if (!user) {
      return this.fail("Nao autenticado.")
    }
    const sanitized = notes.map((n) => ({
      title: String(n.title ?? "").trim() || "Nota sem titulo",
      content: String(n.content ?? "").trim(),
      tags: Array.isArray(n.tags) ? n.tags.map((t) => String(t).trim()).filter(Boolean) : [],
      source: "zettel_maker"
    }))
    const saved = await zettelkastenService.saveAtomicNotes(user.id, sanitized)
    return this.ok({ count: saved.length, notes: saved })
  }

  private async fetchAvailableNotebooks(): Promise<Notebook[]> {
    const snapshot = await chrome.storage.local.get(this.notebookCacheKey)
    const rawItems = Array.isArray(snapshot[this.notebookCacheKey])
      ? (snapshot[this.notebookCacheKey] as unknown[])
      : []
    const now = new Date().toISOString()

    return rawItems
      .filter(
        (
          item
        ): item is {
          id?: unknown
          title?: unknown
          createTime?: unknown
          updateTime?: unknown
          sourceCount?: unknown
        } => typeof item === "object" && item !== null
      )
      .map((item) => ({
        id: String(item.id ?? "").trim(),
        title: String(item.title ?? "").trim(),
        createTime: String(item.createTime ?? "").trim() || now,
        updateTime: String(item.updateTime ?? "").trim() || now,
        sourceCount:
          typeof item.sourceCount === "number" && Number.isFinite(item.sourceCount)
            ? item.sourceCount
            : 0
      }))
      .filter((item) => item.id && item.title)
  }

  private async resolvePreferredNotebookId(
    preferredNotebookId: string | undefined,
    fallbackToFirstNotebook: boolean
  ): Promise<string> {
    const fromPayload = String(preferredNotebookId ?? "").trim()
    if (fromPayload) {
      return this.ensureNotebookIdIsValid(fromPayload, fallbackToFirstNotebook)
    }

    const settings = await storageManager.getSettings()
    const fromSettings = String(settings.defaultNotebookId ?? "").trim()
    if (fromSettings) {
      return this.ensureNotebookIdIsValid(fromSettings, fallbackToFirstNotebook)
    }

    const storageSnapshot = await chrome.storage.local.get([
      "nexus_default_notebook_id",
      "minddock_default_notebook"
    ])
    const fromCanonical = String(storageSnapshot.nexus_default_notebook_id ?? "").trim()
    if (fromCanonical) {
      return this.ensureNotebookIdIsValid(fromCanonical, fallbackToFirstNotebook)
    }

    const fromLegacy = String(storageSnapshot.minddock_default_notebook ?? "").trim()
    if (fromLegacy) {
      return this.ensureNotebookIdIsValid(fromLegacy, fallbackToFirstNotebook)
    }

    if (!fallbackToFirstNotebook) {
      throw new Error("Nenhum notebook padrao configurado.")
    }

    return this.ensureNotebookIdIsValid(null, true)
  }

  private async ensureNotebookIdIsValid(
    candidateNotebookId: string | null,
    fallbackToFirstNotebook: boolean
  ): Promise<string> {
    const notebooks = await this.fetchAvailableNotebooks()
    if (notebooks.length === 0) {
      throw new Error("Nenhum notebook encontrado. Crie um no NotebookLM primeiro.")
    }

    const candidate = String(candidateNotebookId ?? "").trim()
    const matchingNotebook = candidate ? notebooks.find((item) => item.id === candidate) : null
    if (matchingNotebook) {
      return matchingNotebook.id
    }

    if (!fallbackToFirstNotebook) {
      throw new Error("O notebook padrao salvo nao existe mais para a conta atual.")
    }

    const fallbackNotebookId = notebooks[0].id
    await chrome.storage.local.set({
      nexus_default_notebook_id: fallbackNotebookId,
      minddock_default_notebook: fallbackNotebookId
    })
    await storageManager.updateSettings({ defaultNotebookId: fallbackNotebookId })
    return fallbackNotebookId
  }
}

export const router = new MessageRouter()
