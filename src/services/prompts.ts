/**
 * MindDock - Prompt Library Service
 * CRUD de prompts salvos e pastas.
 */

import { getSupabaseClient } from "./supabase-client"
import type { SavedPrompt, PromptFolder } from "~/lib/types"

class PromptsService {
  private async client() {
    return getSupabaseClient()
  }

  async getPrompts(userId: string, folderId?: string): Promise<SavedPrompt[]> {
    const supabase = await this.client()
    let query = supabase
      .from("prompts")
      .select("*")
      .eq("user_id", userId)
      .order("use_count", { ascending: false })

    if (folderId) {
      query = query.eq("folder_id", folderId)
    }

    const { data, error } = await query
    if (error) throw error
    return (data ?? []).map(this.mapPrompt)
  }

  async searchPrompts(userId: string, query: string): Promise<SavedPrompt[]> {
    const supabase = await this.client()
    const { data, error } = await supabase
      .from("prompts")
      .select("*")
      .eq("user_id", userId)
      .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
      .order("use_count", { ascending: false })
      .limit(20)

    if (error) throw error
    return (data ?? []).map(this.mapPrompt)
  }

  async createPrompt(
    userId: string,
    data: Pick<SavedPrompt, "title" | "content" | "folderId" | "tags">
  ): Promise<SavedPrompt> {
    const supabase = await this.client()
    const { data: created, error } = await supabase
      .from("prompts")
      .insert({
        user_id: userId,
        title: data.title,
        content: data.content,
        folder_id: data.folderId ?? null,
        tags: data.tags ?? [],
        use_count: 0
      })
      .select()
      .single()

    if (error) throw error
    return this.mapPrompt(created)
  }

  async updatePrompt(
    promptId: string,
    updates: Partial<Pick<SavedPrompt, "title" | "content" | "folderId" | "tags">>
  ): Promise<SavedPrompt> {
    const supabase = await this.client()
    const { data, error } = await supabase
      .from("prompts")
      .update({
        ...updates,
        folder_id: updates.folderId ?? undefined,
        updated_at: new Date().toISOString()
      })
      .eq("id", promptId)
      .select()
      .single()

    if (error) throw error
    return this.mapPrompt(data)
  }

  async deletePrompt(promptId: string): Promise<void> {
    const supabase = await this.client()
    const { error } = await supabase.from("prompts").delete().eq("id", promptId)
    if (error) throw error
  }

  async incrementUseCount(promptId: string): Promise<void> {
    const supabase = await this.client()
    await supabase.rpc("increment_prompt_use_count", { prompt_id: promptId })
  }

  async getFolders(userId: string): Promise<PromptFolder[]> {
    const supabase = await this.client()
    const { data, error } = await supabase
      .from("prompt_folders")
      .select("*")
      .eq("user_id", userId)
      .order("name")

    if (error) throw error
    return this.buildFolderTree((data ?? []).map(this.mapFolder))
  }

  async createFolder(userId: string, name: string, parentId?: string): Promise<PromptFolder> {
    const supabase = await this.client()
    const { data, error } = await supabase
      .from("prompt_folders")
      .insert({ user_id: userId, name, parent_id: parentId ?? null })
      .select()
      .single()

    if (error) throw error
    return this.mapFolder(data)
  }

  async deleteFolder(folderId: string): Promise<void> {
    const supabase = await this.client()
    const { error } = await supabase.from("prompt_folders").delete().eq("id", folderId)
    if (error) throw error
  }

  private buildFolderTree(folders: PromptFolder[]): PromptFolder[] {
    const map: Record<string, PromptFolder> = {}
    const roots: PromptFolder[] = []

    folders.forEach((f) => {
      map[f.id] = { ...f, children: [] }
    })

    folders.forEach((f) => {
      if (f.parentId && map[f.parentId]) {
        map[f.parentId].children!.push(map[f.id])
      } else {
        roots.push(map[f.id])
      }
    })

    return roots
  }

  private mapPrompt(raw: Record<string, unknown>): SavedPrompt {
    return {
      id: raw.id as string,
      userId: raw.user_id as string,
      title: raw.title as string,
      content: raw.content as string,
      folderId: raw.folder_id as string | undefined,
      tags: (raw.tags as string[]) ?? [],
      useCount: (raw.use_count as number) ?? 0,
      createdAt: raw.created_at as string,
      updatedAt: raw.updated_at as string
    }
  }

  private mapFolder(raw: Record<string, unknown>): PromptFolder {
    return {
      id: raw.id as string,
      userId: raw.user_id as string,
      name: raw.name as string,
      parentId: raw.parent_id as string | undefined,
      children: [],
      createdAt: raw.created_at as string
    }
  }
}

export const promptsService = new PromptsService()
