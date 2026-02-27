/**
 * MindDock — AI Service (Claude API)
 * MVP: chamadas direto do background (client-side).
 * Produção: mover para Supabase Edge Functions.
 */

import Anthropic from "@anthropic-ai/sdk"
import { CLAUDE_CONFIG } from "~/lib/constants"
import { getFromStorage } from "~/lib/utils"
import { STORAGE_KEYS } from "~/lib/constants"
import type { Note, SubscriptionTier } from "~/lib/types"

const CLAUDE_API_KEY = process.env.PLASMO_PUBLIC_CLAUDE_API_KEY!

class AIService {
  private getClient(tier: SubscriptionTier = "thinker"): Anthropic {
    return new Anthropic({
      apiKey: CLAUDE_API_KEY,
      dangerouslyAllowBrowser: true // MVP apenas
    })
  }

  private getModel(tier: SubscriptionTier): string {
    return tier === "thinker_pro" ? CLAUDE_CONFIG.MODEL_PRO : CLAUDE_CONFIG.MODEL_DEFAULT
  }

  // ─── Melhorar Prompt ──────────────────────────────────────────────────────

  async improvePrompt(userPrompt: string): Promise<string> {
    const client = this.getClient()

    const systemPrompt = `Você é um especialista em engenharia de prompts para o Google NotebookLM.
Sua tarefa é melhorar o prompt do usuário para obter respostas mais precisas, detalhadas e úteis do NotebookLM.

Regras:
- Adicione contexto específico e objetivo claro
- Especifique o formato de saída desejado
- Inclua critérios de qualidade quando relevante
- Mantenha o prompt em português
- Retorne APENAS o prompt melhorado, sem explicações`

    const response = await client.messages.create({
      model: CLAUDE_CONFIG.MODEL_DEFAULT,
      max_tokens: 500,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Melhore este prompt: "${userPrompt}"`
        }
      ]
    })

    return (response.content[0] as { text: string }).text.trim()
  }

  // ─── Atomizar Conteúdo (Zettel Maker) ────────────────────────────────────

  async atomizeContent(content: string): Promise<Omit<Note, "id" | "userId" | "notebookId" | "linkedNoteIds" | "backlinks" | "createdAt" | "updatedAt">[]> {
    const client = this.getClient()

    const systemPrompt = `Você é especialista em Zettelkasten, o método de gestão do conhecimento de Niklas Luhmann.

Sua tarefa é dividir o texto fornecido em notas atômicas — onde cada nota contém exatamente UM conceito ou ideia.

Retorne um JSON array com o seguinte formato:
[
  {
    "title": "título conciso da nota (max 60 chars)",
    "content": "conteúdo completo e autocontido da nota (markdown)",
    "tags": ["tag1", "tag2"],
    "source": "zettel_maker"
  }
]

Regras das notas atômicas:
- 1 ideia = 1 nota
- Cada nota deve fazer sentido sem o contexto das outras
- Título deve ser uma frase curta ou conceito preciso
- Conteúdo em markdown, entre 50-300 palavras
- Tags relevantes ao conteúdo (2-5 por nota)
- Mínimo de 3 notas, máximo de 15 por chamada`

    const response = await client.messages.create({
      model: CLAUDE_CONFIG.MODEL_DEFAULT,
      max_tokens: CLAUDE_CONFIG.MAX_TOKENS,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Atomize este conteúdo em notas Zettelkasten:\n\n${content.slice(0, 8000)}`
        }
      ]
    })

    try {
      const text = (response.content[0] as { text: string }).text
      // Extrai o JSON da resposta (pode vir com markdown code block)
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) return []
      return JSON.parse(jsonMatch[0])
    } catch {
      console.error("[MindDock] Erro ao parsear notas atômicas")
      return []
    }
  }

  // ─── Sugerir Links ────────────────────────────────────────────────────────

  async suggestLinks(
    noteContent: string,
    existingNotes: Array<{ id: string; title: string; content: string }>
  ): Promise<Array<{ noteId: string; noteTitle: string; relevance: number }>> {
    if (existingNotes.length === 0) return []

    const client = this.getClient()

    const notesSummary = existingNotes
      .slice(0, 30)
      .map((n) => `ID:${n.id} | Título: ${n.title}`)
      .join("\n")

    const response = await client.messages.create({
      model: CLAUDE_CONFIG.MODEL_DEFAULT,
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `Dada esta nota:\n"${noteContent.slice(0, 500)}"\n\nE estas notas existentes:\n${notesSummary}\n\nRetorne um JSON array com as notas mais relevantes para linkar (max 5):\n[{"noteId": "...", "noteTitle": "...", "relevance": 0.0-1.0}]`
        }
      ]
    })

    try {
      const text = (response.content[0] as { text: string }).text
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) return []
      return JSON.parse(jsonMatch[0])
    } catch {
      return []
    }
  }
}

export const aiService = new AIService()
