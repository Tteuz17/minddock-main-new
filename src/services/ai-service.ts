/**
 * MindDock AI Service
 * All AI calls are proxied through the Supabase Edge Function `ai-proxy`.
 * The Claude API key is stored only as a Supabase secret — never in the extension bundle.
 */

import { getFromStorage } from "~/lib/utils"
import { FIXED_STORAGE_KEYS } from "~/lib/contracts"
import { authManager } from "~/background/auth-manager"
import type { Note, SubscriptionTier } from "~/lib/types"

type AtomicNote = Omit<
  Note,
  "id" | "userId" | "notebookId" | "linkedNoteIds" | "backlinks" | "createdAt" | "updatedAt"
>

async function callAiProxy<T>(
  action: string,
  payload: Record<string, unknown>
): Promise<T> {
  const supabaseUrl = await getFromStorage<string>(FIXED_STORAGE_KEYS.PROJECT_URL)
    ?? process.env.PLASMO_PUBLIC_SUPABASE_URL

  if (!supabaseUrl) {
    throw new Error("Supabase URL not configured")
  }

  const token = await authManager.getAccessToken()
  if (!token) {
    throw new Error("Not authenticated")
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/ai-proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ action, payload })
  })

  const json = await res.json() as { success?: boolean; result?: T; error?: string; tier?: string }

  if (!res.ok || !json.success) {
    if (res.status === 403 && json.tier) {
      throw new Error(`AI features require Thinker plan. Current plan: ${json.tier}`)
    }
    throw new Error(json.error ?? `AI proxy error (${res.status})`)
  }

  return json.result as T
}

class AIService {
  // tier param kept for API compatibility — actual enforcement is server-side
  async improvePrompt(_userPrompt: string): Promise<string>
  async improvePrompt(userPrompt: string): Promise<string> {
    return callAiProxy<string>("improvePrompt", { userPrompt })
  }

  async atomizeContent(
    content: string
  ): Promise<AtomicNote[]> {
    return callAiProxy<AtomicNote[]>("atomizeContent", { content })
  }

  async generatePromptOptions(
    userPrompt: string
  ): Promise<Array<{ title: string; prompt: string }>> {
    return callAiProxy<Array<{ title: string; prompt: string }>>("generatePromptOptions", {
      userPrompt
    })
  }

  async suggestLinks(
    noteContent: string,
    existingNotes: Array<{ id: string; title: string; content: string }>
  ): Promise<Array<{ noteId: string; noteTitle: string; relevance: number }>> {
    return callAiProxy<Array<{ noteId: string; noteTitle: string; relevance: number }>>(
      "suggestLinks",
      { noteContent, existingNotes }
    )
  }
}

export const aiService = new AIService()

// Kept for backwards compat — tier enforcement is now server-side
export type { SubscriptionTier }
