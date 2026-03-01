/**
 * MindDock - Zettelkasten Service
 * CRUD de notas, links bidirecionais e dados para o grafo.
 */

import { getSupabaseClient } from "./supabase-client"
import { extractWikilinks, TAG_COLORS } from "~/lib/utils"
import type { Note, GraphData, GraphNode, GraphEdge } from "~/lib/types"

function throwSupabaseError(error: { message?: string; code?: string; details?: string } | null): never {
  const msg = error?.message || error?.details || `Supabase error ${error?.code ?? ""}`.trim()
  throw new Error(msg)
}

class ZettelkastenService {
  private async client() {
    return getSupabaseClient()
  }

  async getNotes(userId: string): Promise<Note[]> {
    const supabase = await this.client()
    const { data, error } = await supabase
      .from("notes")
      .select(`
        *,
        outgoing:note_links!source_note_id(target_note_id, target:notes!target_note_id(id, title)),
        incoming:note_links!target_note_id(source_note_id, source:notes!source_note_id(id, title))
      `)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })

    if (error) throwSupabaseError(error)

    return (data ?? []).map(this.mapNote)
  }

  async getNote(noteId: string): Promise<Note | null> {
    const supabase = await this.client()
    const { data, error } = await supabase
      .from("notes")
      .select(`
        *,
        outgoing:note_links!source_note_id(target_note_id, target:notes!target_note_id(id, title)),
        incoming:note_links!target_note_id(source_note_id, source:notes!source_note_id(id, title))
      `)
      .eq("id", noteId)
      .single()

    if (error || !data) return null
    return this.mapNote(data)
  }

  async createNote(
    userId: string,
    data: Pick<Note, "title" | "content" | "tags" | "notebookId" | "source">
  ): Promise<Note> {
    const supabase = await this.client()
    const { data: created, error } = await supabase
      .from("notes")
      .insert({
        user_id: userId,
        title: data.title,
        content: data.content,
        tags: data.tags ?? [],
        notebook_id: data.notebookId,
        source: data.source ?? "manual"
      })
      .select()
      .single()

    if (error) throwSupabaseError(error)

    const wikilinks = extractWikilinks(data.content)
    if (wikilinks.length > 0) {
      await this.resolveWikilinks(userId, created.id, wikilinks)
    }

    return this.mapNote({ ...created, outgoing: [], incoming: [] })
  }

  async updateNote(
    noteId: string,
    updates: Partial<Pick<Note, "title" | "content" | "tags">>
  ): Promise<Note> {
    const supabase = await this.client()
    const { data, error } = await supabase
      .from("notes")
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq("id", noteId)
      .select()
      .single()

    if (error) throwSupabaseError(error)

    if (updates.content) {
      const { data: user } = await supabase.auth.getUser()
      if (user.user) {
        await supabase.from("note_links").delete().eq("source_note_id", noteId)
        const wikilinks = extractWikilinks(updates.content)
        if (wikilinks.length > 0) {
          await this.resolveWikilinks(user.user.id, noteId, wikilinks)
        }
      }
    }

    return this.mapNote({ ...data, outgoing: [], incoming: [] })
  }

  async deleteNote(noteId: string): Promise<void> {
    const supabase = await this.client()
    const { error } = await supabase.from("notes").delete().eq("id", noteId)
    if (error) throwSupabaseError(error)
  }

  async saveAtomicNotes(
    userId: string,
    notes: Array<{ title: string; content: string; tags: string[]; source: string }>
  ): Promise<Note[]> {
    const supabase = await this.client()
    const { data, error } = await supabase
      .from("notes")
      .insert(
        notes.map((n) => ({
          user_id: userId,
          title: n.title,
          content: n.content,
          tags: n.tags ?? [],
          source: n.source ?? "zettel_maker"
        }))
      )
      .select()

    if (error) throwSupabaseError(error)
    return (data ?? []).map((n) => this.mapNote({ ...n, outgoing: [], incoming: [] }))
  }

  async createLink(sourceNoteId: string, targetNoteId: string, userId: string): Promise<void> {
    const supabase = await this.client()
    await supabase.from("note_links").upsert({
      user_id: userId,
      source_note_id: sourceNoteId,
      target_note_id: targetNoteId
    })
  }

  async deleteLink(sourceNoteId: string, targetNoteId: string): Promise<void> {
    const supabase = await this.client()
    await supabase
      .from("note_links")
      .delete()
      .eq("source_note_id", sourceNoteId)
      .eq("target_note_id", targetNoteId)
  }

  private async resolveWikilinks(userId: string, sourceNoteId: string, titles: string[]): Promise<void> {
    if (titles.length === 0) return

    const supabase = await this.client()
    const { data: matches } = await supabase
      .from("notes")
      .select("id, title")
      .eq("user_id", userId)
      .in("title", titles)

    if (!matches || matches.length === 0) return

    await supabase.from("note_links").upsert(
      matches.map((m) => ({
        user_id: userId,
        source_note_id: sourceNoteId,
        target_note_id: m.id
      }))
    )
  }

  async getGraphData(userId: string): Promise<GraphData> {
    const notes = await this.getNotes(userId)

    const allTags = [...new Set(notes.flatMap((n) => n.tags))]
    const tagColorMap: Record<string, string> = {}
    allTags.forEach((tag, i) => {
      tagColorMap[tag] = TAG_COLORS[i % TAG_COLORS.length]
    })

    const nodes: GraphNode[] = notes.map((n) => ({
      id: n.id,
      label: n.title.length > 30 ? n.title.slice(0, 27) + "..." : n.title,
      title: n.title,
      color: n.tags[0] ? tagColorMap[n.tags[0]] : "#ffffff",
      size: 10 + Math.min(n.linkedNoteIds.length * 3, 20)
    }))

    const edgeSet = new Set<string>()
    const edges: GraphEdge[] = []

    notes.forEach((n) => {
      n.linkedNoteIds.forEach((targetId) => {
        const edgeKey = [n.id, targetId].sort().join("--")
        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey)
          edges.push({ id: edgeKey, from: n.id, to: targetId })
        }
      })
    })

    return { nodes, edges }
  }

  async searchNotes(userId: string, query: string): Promise<Note[]> {
    const supabase = await this.client()
    const { data, error } = await supabase
      .from("notes")
      .select("id, title, content, tags, source, created_at, updated_at")
      .eq("user_id", userId)
      .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
      .order("updated_at", { ascending: false })
      .limit(20)

    if (error) throwSupabaseError(error)
    return (data ?? []).map((n) =>
      this.mapNote({ ...n, user_id: userId, notebook_id: null, outgoing: [], incoming: [] })
    )
  }

  private mapNote(raw: Record<string, unknown>): Note {
    const outgoing = (raw.outgoing as Array<{ target_note_id: string }>) ?? []
    const incoming = (
      raw.incoming as Array<{ source_note_id: string; source: { id: string; title: string } }>
    ) ?? []

    return {
      id: raw.id as string,
      userId: raw.user_id as string,
      title: raw.title as string,
      content: raw.content as string,
      tags: (raw.tags as string[]) ?? [],
      notebookId: raw.notebook_id as string | undefined,
      source: (raw.source as Note["source"]) ?? "manual",
      linkedNoteIds: outgoing.map((l) => l.target_note_id),
      backlinks: incoming.map((l) => ({
        noteId: l.source_note_id,
        noteTitle: (l.source as { id: string; title: string })?.title ?? ""
      })),
      createdAt: raw.created_at as string,
      updatedAt: raw.updated_at as string
    }
  }
}

export const zettelkastenService = new ZettelkastenService()
