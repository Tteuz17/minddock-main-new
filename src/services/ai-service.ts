/**
 * MindDock AI Service (Claude API)
 * Current MVP calls Claude directly from the background.
 * Production path should move this to server-side functions.
 */

import Anthropic from "@anthropic-ai/sdk"
import { CLAUDE_CONFIG } from "~/lib/constants"
import type { Note, SubscriptionTier } from "~/lib/types"

const CLAUDE_API_KEY = process.env.PLASMO_PUBLIC_CLAUDE_API_KEY!

class AIService {
  private getClient(tier: SubscriptionTier = "thinker"): Anthropic {
    void tier
    return new Anthropic({
      apiKey: CLAUDE_API_KEY,
      dangerouslyAllowBrowser: true
    })
  }

  private getModel(tier: SubscriptionTier): string {
    return tier === "thinker_pro" ? CLAUDE_CONFIG.MODEL_PRO : CLAUDE_CONFIG.MODEL_DEFAULT
  }

  private extractMessageText(response: unknown): string {
    const firstBlock = (response as { content?: Array<{ text?: string }> })?.content?.[0]
    return String(firstBlock?.text ?? "").trim()
  }

  private buildPromptOptionFallbacks(
    userPrompt: string
  ): Array<{ title: string; prompt: string }> {
    const sourceQuestion = userPrompt.trim()

    return [
      {
        title: "Deep analysis",
        prompt: [
          `Use this exact question as the core task: "${sourceQuestion}"`,
          "",
          "Goal:",
          "- Deliver a rigorous, evidence-based analysis grounded in the notebook sources.",
          "",
          "Context to use:",
          "- Use the uploaded NotebookLM sources as the primary knowledge base.",
          "- If the sources are incomplete, clearly separate source-backed statements from inference.",
          "",
          "Required output:",
          "- Start with a direct answer.",
          "- Then provide a deeper analysis with comparisons, tradeoffs, and key patterns.",
          "- End with the 3 most important takeaways.",
          "",
          "Quality bar:",
          "- Use the strongest evidence available from the sources.",
          "- Surface uncertainty, disagreement, or missing context when relevant.",
          "- Keep the answer concise but intellectually rigorous."
        ].join("\n")
      },
      {
        title: "Structured brief",
        prompt: [
          `Answer this question in English: "${sourceQuestion}"`,
          "",
          "Goal:",
          "- Produce a highly structured response optimized for study and fast review.",
          "",
          "Context to use:",
          "- Prioritize the notebook sources before adding any inference.",
          "- Consolidate overlapping source material into one coherent explanation.",
          "",
          "Required output:",
          "- Use clear section headings.",
          "- Include a short summary, a bullet list of core points, and a step-by-step explanation.",
          "- Finish with a final section called 'What matters most'.",
          "",
          "Quality bar:",
          "- Be precise, organized, and easy to scan.",
          "- Avoid filler.",
          "- Explicitly note any source limitations."
        ].join("\n")
      },
      {
        title: "Practical synthesis",
        prompt: [
          `Turn this question into a practical answer: "${sourceQuestion}"`,
          "",
          "Goal:",
          "- Convert the source material into useful actions, decisions, and real-world understanding.",
          "",
          "Context to use:",
          "- Base the answer on the notebook sources first.",
          "- Translate abstract points into practical implications.",
          "",
          "Required output:",
          "- Give a concise answer first.",
          "- Then explain what it means in practice.",
          "- Include 2 to 3 concrete examples or scenarios.",
          "- Finish with clear next steps or recommendations.",
          "",
          "Quality bar:",
          "- Keep it actionable.",
          "- Preserve nuance from the sources.",
          "- Call out assumptions before making recommendations."
        ].join("\n")
      }
    ]
  }

  private normalizePromptOptions(
    rawOptions: unknown,
    userPrompt: string
  ): Array<{ title: string; prompt: string }> {
    const fallback = this.buildPromptOptionFallbacks(userPrompt)

    if (!Array.isArray(rawOptions)) {
      return fallback
    }

    const normalized = rawOptions
      .slice(0, 3)
      .map((item, index) => {
        const title =
          String((item as { title?: string })?.title ?? "").trim() || fallback[index].title
        const prompt = String((item as { prompt?: string })?.prompt ?? "").trim()

        if (!prompt) {
          return fallback[index]
        }

        return {
          title,
          prompt
        }
      })

    while (normalized.length < 3) {
      normalized.push(fallback[normalized.length])
    }

    return normalized
  }

  async improvePrompt(userPrompt: string): Promise<string> {
    const client = this.getClient()

    const systemPrompt = `You are an expert prompt engineer for Google NotebookLM.
Your task is to rewrite the user's prompt so it produces a stronger answer in NotebookLM.

Rules:
- Keep the user's original intent.
- Make the prompt clearer, more specific, and more useful.
- Add a concrete objective, output expectations, and quality criteria when helpful.
- The final rewritten prompt must be in English only.
- Return only the rewritten prompt, with no explanation.`

    const response = await client.messages.create({
      model: this.getModel("thinker"),
      max_tokens: 500,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Rewrite this prompt in better English for NotebookLM:\n\n${userPrompt}`
        }
      ]
    })

    return this.extractMessageText(response)
  }

  async atomizeContent(
    content: string
  ): Promise<
    Omit<
      Note,
      "id" | "userId" | "notebookId" | "linkedNoteIds" | "backlinks" | "createdAt" | "updatedAt"
    >[]
  > {
    const client = this.getClient()

    const systemPrompt = `You are a Zettelkasten specialist.

Split the provided text into atomic notes, where each note contains exactly one concept or idea.

Return a JSON array in this format:
[
  {
    "title": "concise note title (max 60 chars)",
    "content": "complete self-contained note content in markdown",
    "tags": ["tag1", "tag2"],
    "source": "zettel_maker"
  }
]

Rules:
- One idea per note.
- Each note must make sense on its own.
- Titles must be short and precise.
- Content should be markdown and between 50 and 300 words.
- Use 2 to 5 relevant tags.
- Return at least 3 notes and at most 15 notes.`

    const response = await client.messages.create({
      model: this.getModel("thinker"),
      max_tokens: CLAUDE_CONFIG.MAX_TOKENS,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Atomize this content into Zettelkasten notes:\n\n${content.slice(0, 8000)}`
        }
      ]
    })

    try {
      const text = this.extractMessageText(response)
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) return []
      return JSON.parse(jsonMatch[0])
    } catch {
      console.error("[MindDock] Failed to parse atomic notes")
      return []
    }
  }

  async generatePromptOptions(
    userPrompt: string
  ): Promise<Array<{ title: string; prompt: string }>> {
    const client = this.getClient()
    const safePrompt = userPrompt.trim().slice(0, 900)

    if (!safePrompt) {
      return this.buildPromptOptionFallbacks(userPrompt)
    }

    const systemPrompt = `You are a senior prompt architect for Google NotebookLM.
Your job is to transform the user's exact question into exactly 3 excellent prompt options that are ready to paste into NotebookLM.

Critical requirements:
- Preserve the user's true intent.
- Use the user's real question as the core task in every option.
- Write everything in English only.
- Return exactly 3 options.
- Return JSON only, with no markdown and no extra commentary.

The 3 options must use these fixed angles:
1. "Deep analysis" -> rigorous analysis, comparisons, evidence, nuance.
2. "Structured brief" -> clear sections, scan-friendly formatting, strong organization.
3. "Practical synthesis" -> practical implications, examples, decisions, next steps.

Every prompt must:
- Be fully self-contained.
- Explicitly tell NotebookLM to rely on the notebook sources first.
- Explicitly tell NotebookLM to separate source-backed statements from inference when needed.
- Be significantly better than the user's original wording.
- Be between 120 and 220 words.

Each prompt body must contain these exact sections:
- Goal:
- Context to use:
- Required output:
- Quality bar:

Return this exact JSON shape:
[
  {"title":"Deep analysis","prompt":"..."},
  {"title":"Structured brief","prompt":"..."},
  {"title":"Practical synthesis","prompt":"..."}
]`

    const response = await client.messages.create({
      model: this.getModel("thinker"),
      max_tokens: 1200,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            "Build 3 prompt options for this exact user question.",
            "Do not answer the question itself.",
            "Do not drift away from the user's intent.",
            "",
            "<user_question>",
            safePrompt,
            "</user_question>"
          ].join("\n")
        }
      ]
    })

    try {
      const text = this.extractMessageText(response)
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        return this.buildPromptOptionFallbacks(userPrompt)
      }

      const parsed = JSON.parse(jsonMatch[0])
      return this.normalizePromptOptions(parsed, userPrompt)
    } catch {
      console.error("[MindDock] Failed to parse prompt options")
      return this.buildPromptOptionFallbacks(userPrompt)
    }
  }

  async suggestLinks(
    noteContent: string,
    existingNotes: Array<{ id: string; title: string; content: string }>
  ): Promise<Array<{ noteId: string; noteTitle: string; relevance: number }>> {
    if (existingNotes.length === 0) return []

    const client = this.getClient()

    const notesSummary = existingNotes
      .slice(0, 30)
      .map((note) => `ID:${note.id} | Title: ${note.title}`)
      .join("\n")

    const response = await client.messages.create({
      model: this.getModel("thinker"),
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            `Given this note:\n"${noteContent.slice(0, 500)}"`,
            "",
            `And these existing notes:\n${notesSummary}`,
            "",
            'Return a JSON array with the most relevant notes to link (max 5):',
            '[{"noteId": "...", "noteTitle": "...", "relevance": 0.0}]'
          ].join("\n")
        }
      ]
    })

    try {
      const text = this.extractMessageText(response)
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) return []
      return JSON.parse(jsonMatch[0])
    } catch {
      return []
    }
  }
}

export const aiService = new AIService()
