/**
 * MindDock — Thread Service
 * CRUD para Focus Threads: abas de conversa por tópico no NotebookLM.
 */

import { getSupabaseClient } from "./supabase-client"
import type { Thread, ThreadMessage } from "~/lib/types"

function throwSupabaseError(error: { message?: string; code?: string; details?: string } | null): never {
  const msg = error?.message || error?.details || `Supabase error ${error?.code ?? ""}`.trim()
  throw new Error(msg)
}

function mapThread(row: Record<string, unknown>): Thread {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    notebookId: row.notebook_id as string,
    name: row.name as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

function mapMessage(row: Record<string, unknown>): ThreadMessage {
  return {
    id: row.id as string,
    threadId: row.thread_id as string,
    role: row.role as "user" | "assistant",
    content: row.content as string,
    createdAt: row.created_at as string
  }
}

class ThreadService {
  private async client() {
    return getSupabaseClient()
  }

  async getThreads(userId: string, notebookId: string): Promise<Thread[]> {
    const db = await this.client()
    const { data, error } = await db
      .from("threads")
      .select("*")
      .eq("user_id", userId)
      .eq("notebook_id", notebookId)
      .order("updated_at", { ascending: false })
    if (error) throwSupabaseError(error)
    return (data ?? []).map(mapThread)
  }

  async createThread(userId: string, notebookId: string, name: string): Promise<Thread> {
    const db = await this.client()
    const { data, error } = await db
      .from("threads")
      .insert({ user_id: userId, notebook_id: notebookId, name: name.trim() || "Nova thread" })
      .select()
      .single()
    if (error) throwSupabaseError(error)
    return mapThread(data as Record<string, unknown>)
  }

  async deleteThread(threadId: string): Promise<void> {
    const db = await this.client()
    const { error } = await db.from("threads").delete().eq("id", threadId)
    if (error) throwSupabaseError(error)
  }

  async renameThread(threadId: string, name: string): Promise<Thread> {
    const db = await this.client()
    const { data, error } = await db
      .from("threads")
      .update({ name: name.trim() || "Nova thread", updated_at: new Date().toISOString() })
      .eq("id", threadId)
      .select()
      .single()
    if (error) throwSupabaseError(error)
    return mapThread(data as Record<string, unknown>)
  }

  async getMessages(threadId: string): Promise<ThreadMessage[]> {
    const db = await this.client()
    const { data, error } = await db
      .from("thread_messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
    if (error) throwSupabaseError(error)
    return (data ?? []).map(mapMessage)
  }

  async saveMessages(
    threadId: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>
  ): Promise<void> {
    if (messages.length === 0) return
    const db = await this.client()
    // Deleta as mensagens anteriores e re-insere (snapshot da conversa)
    const { error: delError } = await db
      .from("thread_messages")
      .delete()
      .eq("thread_id", threadId)
    if (delError) throwSupabaseError(delError)

    const rows = messages.map((m) => ({
      thread_id: threadId,
      role: m.role,
      content: m.content
    }))
    const { error: insError } = await db.from("thread_messages").insert(rows)
    if (insError) throwSupabaseError(insError)

    // Atualiza updated_at da thread
    await db
      .from("threads")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", threadId)
  }
}

export const threadService = new ThreadService()
