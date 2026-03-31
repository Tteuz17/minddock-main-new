import type { SupabaseClient } from "@supabase/supabase-js"
import { authManager } from "../auth-manager"
import { STORAGE_KEYS } from "~/lib/constants"
import type { Thread, ThreadMessage } from "~/lib/types"

const LOCAL_THREAD_STORE_KEY = "minddock_thread_local_store_v1"
const LOCAL_THREAD_META_STORE_KEY = "minddock_thread_meta_store_v1"

interface PersistableThreadMessage {
  role: "user" | "assistant"
  content: string
}

interface LocalThreadStore {
  threads: Thread[]
  messagesByThread: Record<string, ThreadMessage[]>
}

interface LocalThreadMetaRecord {
  userId: string
  topic?: string
  icon?: string
}

interface LocalThreadMetaStore {
  byThreadId: Record<string, LocalThreadMetaRecord>
}

function throwSupabaseError(error: { message?: string; code?: string; details?: string } | null): never {
  const message = error?.message || error?.details || `Supabase error ${error?.code ?? ""}`.trim()
  throw new Error(message)
}

function normalizeThreadName(name: string): string {
  const normalized = String(name ?? "").trim().slice(0, 120)
  return normalized || "Nova thread"
}

function normalizeThreadTopic(topic: unknown): string | undefined {
  const normalized = String(topic ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120)
  return normalized || undefined
}

function normalizeThreadIcon(icon: unknown): string | undefined {
  const normalized = String(icon ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .slice(0, 32)

  if (!normalized) {
    return undefined
  }

  if (!/^[a-z0-9_-]{1,32}$/.test(normalized)) {
    return undefined
  }

  return normalized
}

function withOptionalThreadMetadata(
  thread: Thread,
  metadata: {
    topic?: unknown
    icon?: unknown
  }
): Thread {
  const topic = normalizeThreadTopic(metadata.topic)
  const icon = normalizeThreadIcon(metadata.icon)

  return {
    ...thread,
    ...(topic ? { topic } : {}),
    ...(icon ? { icon } : {})
  }
}

function mapThread(row: Record<string, unknown>): Thread {
  const base: Thread = {
    id: String(row.id ?? ""),
    userId: String(row.user_id ?? ""),
    notebookId: String(row.notebook_id ?? ""),
    name: String(row.name ?? ""),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  }

  return withOptionalThreadMetadata(base, {
    topic: row.topic,
    icon: row.icon
  })
}

function mapMessage(row: Record<string, unknown>): ThreadMessage {
  return {
    id: String(row.id ?? ""),
    threadId: String(row.thread_id ?? ""),
    role: row.role === "assistant" ? "assistant" : "user",
    content: String(row.content ?? ""),
    createdAt: String(row.created_at ?? "")
  }
}

function sanitizeMessages(
  messages: Array<{ role: "user" | "assistant"; content: string }>
): PersistableThreadMessage[] {
  return messages
    .filter((message) => {
      const role = message?.role
      const content = String(message?.content ?? "").trim()
      return (role === "user" || role === "assistant") && content.length > 0
    })
    .slice(0, 250)
    .map((message) => ({
      role: message.role,
      content: String(message.content ?? "").trim()
    }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

class ThreadService {
  private forceLocalBackend = false

  private normalizeErrorMessage(error: unknown): string {
    return String(error instanceof Error ? error.message : error ?? "")
      .trim()
      .toLowerCase()
  }

  private async getAuthenticatedUserId(): Promise<string> {
    const user = await authManager.getCurrentUser()
    const userId = String(user?.id ?? "").trim()
    if (!userId) {
      throw new Error("Nao autenticado.")
    }
    return userId
  }

  private async getClientAndUser(): Promise<{ db: SupabaseClient; userId: string }> {
    const userId = await this.getAuthenticatedUserId()
    const db = await authManager.getSupabaseClient()
    return { db, userId }
  }

  private async shouldUseLocalBackend(): Promise<boolean> {
    return false
  }

  private async shouldAllowLocalFallback(): Promise<boolean> {
    return false
  }

  private isThreadMessagesTableError(error: unknown): boolean {
    const message = this.normalizeErrorMessage(error)
    if (!message) {
      return false
    }

    return (
      message.includes("public.thread_messages") ||
      message.includes("relation \"thread_messages\" does not exist") ||
      (message.includes("could not find the table") && message.includes("thread_messages"))
    )
  }

  private shouldFallbackForError(error: unknown): boolean {
    const message = this.normalizeErrorMessage(error)

    if (!message) {
      return false
    }

    if (this.isThreadMessagesTableError(error)) {
      return false
    }

    return (
      message.includes("could not find the table") ||
      message.includes("public.threads") ||
      message.includes("schema cache") ||
      message.includes("relation \"threads\" does not exist")
    )
  }

  private buildLocalId(prefix: string): string {
    try {
      return `${prefix}-${crypto.randomUUID()}`
    } catch {
      return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
    }
  }

  private async readLocalStore(): Promise<LocalThreadStore> {
    const snapshot = await chrome.storage.local.get([LOCAL_THREAD_STORE_KEY])
    const raw = snapshot[LOCAL_THREAD_STORE_KEY]
    if (!isRecord(raw)) {
      return { threads: [], messagesByThread: {} }
    }

    const threads = Array.isArray(raw.threads) ? (raw.threads as Thread[]) : []
    const messagesByThread = isRecord(raw.messagesByThread)
      ? (raw.messagesByThread as Record<string, ThreadMessage[]>)
      : {}

    return {
      threads: threads
        .filter((thread) => isRecord(thread))
        .map((thread) => {
          const topic = normalizeThreadTopic(thread.topic)
          const icon = normalizeThreadIcon(thread.icon)

          return {
            id: String(thread.id ?? ""),
            userId: String(thread.userId ?? ""),
            notebookId: String(thread.notebookId ?? ""),
            name: normalizeThreadName(String(thread.name ?? "")),
            ...(topic ? { topic } : {}),
            ...(icon ? { icon } : {}),
            createdAt: String(thread.createdAt ?? ""),
            updatedAt: String(thread.updatedAt ?? "")
          }
        })
        .filter((thread) => thread.id && thread.userId && thread.notebookId),
      messagesByThread
    }
  }

  private async writeLocalStore(store: LocalThreadStore): Promise<void> {
    await chrome.storage.local.set({
      [LOCAL_THREAD_STORE_KEY]: {
        threads: store.threads,
        messagesByThread: store.messagesByThread
      }
    })
  }

  private async readThreadMetaStore(): Promise<LocalThreadMetaStore> {
    const snapshot = await chrome.storage.local.get([LOCAL_THREAD_META_STORE_KEY])
    const raw = snapshot[LOCAL_THREAD_META_STORE_KEY]
    const byThreadId = isRecord(raw) && isRecord(raw.byThreadId)
      ? raw.byThreadId
      : {}

    const normalized: Record<string, LocalThreadMetaRecord> = {}
    for (const [threadId, value] of Object.entries(byThreadId)) {
      if (!isRecord(value)) {
        continue
      }

      const userId = String(value.userId ?? "").trim()
      if (!userId) {
        continue
      }

      const topic = normalizeThreadTopic(value.topic)
      const icon = normalizeThreadIcon(value.icon)
      normalized[String(threadId)] = {
        userId,
        ...(topic ? { topic } : {}),
        ...(icon ? { icon } : {})
      }
    }

    return { byThreadId: normalized }
  }

  private async writeThreadMetaStore(store: LocalThreadMetaStore): Promise<void> {
    await chrome.storage.local.set({
      [LOCAL_THREAD_META_STORE_KEY]: store
    })
  }

  private async saveThreadMeta(
    userId: string,
    threadId: string,
    metadata: { topic?: unknown; icon?: unknown }
  ): Promise<void> {
    const topic = normalizeThreadTopic(metadata.topic)
    const icon = normalizeThreadIcon(metadata.icon)
    const store = await this.readThreadMetaStore()

    if (!topic && !icon) {
      if (store.byThreadId[threadId]) {
        delete store.byThreadId[threadId]
        await this.writeThreadMetaStore(store)
      }
      return
    }

    store.byThreadId[threadId] = {
      userId,
      ...(topic ? { topic } : {}),
      ...(icon ? { icon } : {})
    }
    await this.writeThreadMetaStore(store)
  }

  private async deleteThreadMeta(threadId: string): Promise<void> {
    const store = await this.readThreadMetaStore()
    if (!store.byThreadId[threadId]) {
      return
    }

    delete store.byThreadId[threadId]
    await this.writeThreadMetaStore(store)
  }

  private async mergeThreadMeta(userId: string, threads: Thread[]): Promise<Thread[]> {
    if (threads.length === 0) {
      return threads
    }

    const store = await this.readThreadMetaStore()
    return threads.map((thread) => {
      const metadata = store.byThreadId[thread.id]
      if (!metadata || metadata.userId !== userId) {
        return thread
      }

      return withOptionalThreadMetadata(thread, metadata)
    })
  }

  private async ensureThreadOwnershipLocal(userId: string, threadId: string): Promise<Thread> {
    const store = await this.readLocalStore()
    const thread = store.threads.find((candidate) => candidate.id === threadId)
    if (!thread || thread.userId !== userId) {
      throw new Error("Dock nao encontrado.")
    }
    return thread
  }

  private ensureLocalThreadOwnershipIfPresent(
    store: LocalThreadStore,
    userId: string,
    threadId: string
  ): Thread | null {
    const thread = store.threads.find((candidate) => candidate.id === threadId) ?? null
    if (thread && thread.userId !== userId) {
      throw new Error("Dock nao encontrado.")
    }
    return thread
  }

  private async getThreadsLocal(userId: string, notebookId: string): Promise<Thread[]> {
    const store = await this.readLocalStore()
    return store.threads
      .filter((thread) => thread.userId === userId && thread.notebookId === notebookId)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  }

  private async createThreadLocal(
    userId: string,
    notebookId: string,
    name: string,
    options: { topic?: unknown; icon?: unknown } = {}
  ): Promise<Thread> {
    const now = new Date().toISOString()
    const baseThread: Thread = {
      id: this.buildLocalId("dock"),
      userId,
      notebookId,
      name: normalizeThreadName(name),
      createdAt: now,
      updatedAt: now
    }
    const thread = withOptionalThreadMetadata(baseThread, options)

    const store = await this.readLocalStore()
    store.threads.unshift(thread)
    await this.writeLocalStore(store)
    return thread
  }

  private async deleteThreadLocal(userId: string, threadId: string): Promise<void> {
    const store = await this.readLocalStore()
    const beforeCount = store.threads.length
    store.threads = store.threads.filter(
      (thread) => !(thread.id === threadId && thread.userId === userId)
    )

    if (store.threads.length === beforeCount) {
      throw new Error("Dock nao encontrado.")
    }

    delete store.messagesByThread[threadId]
    await this.writeLocalStore(store)
  }

  private async renameThreadLocal(userId: string, threadId: string, name: string): Promise<Thread> {
    const store = await this.readLocalStore()
    const index = store.threads.findIndex(
      (thread) => thread.id === threadId && thread.userId === userId
    )
    if (index < 0) {
      throw new Error("Dock nao encontrado.")
    }

    const updated: Thread = {
      ...store.threads[index],
      name: normalizeThreadName(name),
      updatedAt: new Date().toISOString()
    }
    store.threads[index] = updated
    await this.writeLocalStore(store)
    return updated
  }

  private async getMessagesLocal(userId: string, threadId: string): Promise<ThreadMessage[]> {
    const store = await this.readLocalStore()
    this.ensureLocalThreadOwnershipIfPresent(store, userId, threadId)
    const messages = store.messagesByThread[threadId] ?? []
    return [...messages].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
  }

  private async saveMessagesLocal(
    userId: string,
    threadId: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    options: { syncThreadMetadata?: boolean } = {}
  ): Promise<void> {
    const sanitizedMessages = sanitizeMessages(messages)
    const now = new Date().toISOString()

    const store = await this.readLocalStore()
    const existingThread = this.ensureLocalThreadOwnershipIfPresent(store, userId, threadId)
    const syncThreadMetadata = options.syncThreadMetadata !== false

    store.messagesByThread[threadId] = sanitizedMessages.map((message, index) => ({
      id: this.buildLocalId(`msg-${index + 1}`),
      threadId,
      role: message.role,
      content: message.content,
      createdAt: now
    }))

    if (syncThreadMetadata && existingThread) {
      store.threads = store.threads.map((thread) =>
        thread.id === threadId && thread.userId === userId
          ? { ...thread, updatedAt: now }
          : thread
      )
    }

    await this.writeLocalStore(store)
  }

  private async ensureThreadOwnership(
    db: SupabaseClient,
    userId: string,
    threadId: string
  ): Promise<void> {
    const { data, error } = await db
      .from("threads")
      .select("id")
      .eq("id", threadId)
      .eq("user_id", userId)
      .maybeSingle()

    if (error) {
      throwSupabaseError(error)
    }

    if (!data?.id) {
      throw new Error("Dock nao encontrado.")
    }
  }

  async getThreads(notebookId: string): Promise<Thread[]> {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    if (!normalizedNotebookId) {
      throw new Error("Notebook invalido.")
    }

    const userId = await this.getAuthenticatedUserId()
    if (await this.shouldUseLocalBackend()) {
      return this.getThreadsLocal(userId, normalizedNotebookId)
    }

    try {
      const { db } = await this.getClientAndUser()
      const { data, error } = await db
        .from("threads")
        .select("*")
        .eq("user_id", userId)
        .eq("notebook_id", normalizedNotebookId)
        .order("updated_at", { ascending: false })

      if (error) {
        throwSupabaseError(error)
      }

      const mappedThreads = (data ?? []).map((row) => mapThread(row as Record<string, unknown>))
      return this.mergeThreadMeta(userId, mappedThreads)
    } catch (error) {
      if (this.shouldFallbackForError(error) && (await this.shouldAllowLocalFallback())) {
        this.forceLocalBackend = true
        return this.getThreadsLocal(userId, normalizedNotebookId)
      }
      throw error
    }
  }

  async createThread(
    notebookId: string,
    name: string,
    options: { topic?: unknown; icon?: unknown } = {}
  ): Promise<Thread> {
    const normalizedNotebookId = String(notebookId ?? "").trim()
    if (!normalizedNotebookId) {
      throw new Error("Notebook invalido.")
    }

    const userId = await this.getAuthenticatedUserId()
    if (await this.shouldUseLocalBackend()) {
      return this.createThreadLocal(userId, normalizedNotebookId, name, options)
    }

    try {
      const { db } = await this.getClientAndUser()
      const { data, error } = await db
        .from("threads")
        .insert({
          user_id: userId,
          notebook_id: normalizedNotebookId,
          name: normalizeThreadName(name)
        })
        .select()
        .single()

      if (error) {
        throwSupabaseError(error)
      }

      const thread = mapThread(data as Record<string, unknown>)
      await this.saveThreadMeta(userId, thread.id, options)
      return withOptionalThreadMetadata(thread, options)
    } catch (error) {
      if (this.shouldFallbackForError(error) && (await this.shouldAllowLocalFallback())) {
        this.forceLocalBackend = true
        return this.createThreadLocal(userId, normalizedNotebookId, name, options)
      }
      throw error
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    const normalizedThreadId = String(threadId ?? "").trim()
    if (!normalizedThreadId) {
      throw new Error("Thread invalida.")
    }

    const userId = await this.getAuthenticatedUserId()
    if (await this.shouldUseLocalBackend()) {
      await this.deleteThreadLocal(userId, normalizedThreadId)
      await this.deleteThreadMeta(normalizedThreadId)
      return
    }

    try {
      const { db } = await this.getClientAndUser()
      const { data, error } = await db
        .from("threads")
        .delete()
        .eq("id", normalizedThreadId)
        .eq("user_id", userId)
        .select("id")
        .maybeSingle()

      if (error) {
        throwSupabaseError(error)
      }

      if (!data?.id) {
        throw new Error("Dock nao encontrado.")
      }

      await this.deleteThreadMeta(normalizedThreadId)
    } catch (error) {
      if (this.shouldFallbackForError(error) && (await this.shouldAllowLocalFallback())) {
        this.forceLocalBackend = true
        await this.deleteThreadLocal(userId, normalizedThreadId)
        await this.deleteThreadMeta(normalizedThreadId)
        return
      }
      throw error
    }
  }

  async renameThread(threadId: string, name: string): Promise<Thread> {
    const normalizedThreadId = String(threadId ?? "").trim()
    if (!normalizedThreadId) {
      throw new Error("Thread invalida.")
    }

    const userId = await this.getAuthenticatedUserId()
    if (await this.shouldUseLocalBackend()) {
      return this.renameThreadLocal(userId, normalizedThreadId, name)
    }

    try {
      const { db } = await this.getClientAndUser()
      const { data, error } = await db
        .from("threads")
        .update({
          name: normalizeThreadName(name),
          updated_at: new Date().toISOString()
        })
        .eq("id", normalizedThreadId)
        .eq("user_id", userId)
        .select()
        .maybeSingle()

      if (error) {
        throwSupabaseError(error)
      }

      if (!data) {
        throw new Error("Dock nao encontrado.")
      }

      return mapThread(data as Record<string, unknown>)
    } catch (error) {
      if (this.shouldFallbackForError(error) && (await this.shouldAllowLocalFallback())) {
        this.forceLocalBackend = true
        return this.renameThreadLocal(userId, normalizedThreadId, name)
      }
      throw error
    }
  }

  async getMessages(threadId: string): Promise<ThreadMessage[]> {
    const normalizedThreadId = String(threadId ?? "").trim()
    if (!normalizedThreadId) {
      throw new Error("Thread invalida.")
    }

    const userId = await this.getAuthenticatedUserId()
    if (await this.shouldUseLocalBackend()) {
      return this.getMessagesLocal(userId, normalizedThreadId)
    }

    try {
      const { db } = await this.getClientAndUser()
      await this.ensureThreadOwnership(db, userId, normalizedThreadId)

      const { data, error } = await db
        .from("thread_messages")
        .select("*")
        .eq("thread_id", normalizedThreadId)
        .order("created_at", { ascending: true })

      if (error) {
        throwSupabaseError(error)
      }

      return (data ?? []).map((row) => mapMessage(row as Record<string, unknown>))
    } catch (error) {
      if (this.isThreadMessagesTableError(error)) {
        if (await this.shouldAllowLocalFallback()) {
          return this.getMessagesLocal(userId, normalizedThreadId)
        }
        throw error
      }

      if (this.shouldFallbackForError(error) && (await this.shouldAllowLocalFallback())) {
        this.forceLocalBackend = true
        return this.getMessagesLocal(userId, normalizedThreadId)
      }
      throw error
    }
  }

  async saveMessages(
    threadId: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>
  ): Promise<void> {
    const normalizedThreadId = String(threadId ?? "").trim()
    if (!normalizedThreadId) {
      throw new Error("Thread invalida.")
    }

    const userId = await this.getAuthenticatedUserId()
    if (await this.shouldUseLocalBackend()) {
      await this.saveMessagesLocal(userId, normalizedThreadId, messages)
      return
    }

    try {
      const sanitizedMessages = sanitizeMessages(messages)
      const { db } = await this.getClientAndUser()
      await this.ensureThreadOwnership(db, userId, normalizedThreadId)

      const { error: deleteError } = await db
        .from("thread_messages")
        .delete()
        .eq("thread_id", normalizedThreadId)
      if (deleteError) {
        throwSupabaseError(deleteError)
      }

      if (sanitizedMessages.length > 0) {
        const rows = sanitizedMessages.map((message) => ({
          thread_id: normalizedThreadId,
          role: message.role,
          content: message.content
        }))
        const { error: insertError } = await db.from("thread_messages").insert(rows)
        if (insertError) {
          throwSupabaseError(insertError)
        }
      }

      const { error: updateError } = await db
        .from("threads")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", normalizedThreadId)
        .eq("user_id", userId)
      if (updateError) {
        throwSupabaseError(updateError)
      }
    } catch (error) {
      if (this.isThreadMessagesTableError(error)) {
        if (await this.shouldAllowLocalFallback()) {
          await this.saveMessagesLocal(userId, normalizedThreadId, messages, {
            syncThreadMetadata: false
          })
          return
        }
        throw error
      }

      if (this.shouldFallbackForError(error) && (await this.shouldAllowLocalFallback())) {
        this.forceLocalBackend = true
        await this.saveMessagesLocal(userId, normalizedThreadId, messages)
        return
      }
      throw error
    }
  }
}

export const threadService = new ThreadService()
