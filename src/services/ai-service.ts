import type { Note } from "~/lib/types"

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "by",
  "com",
  "da",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "for",
  "in",
  "is",
  "na",
  "no",
  "of",
  "on",
  "or",
  "para",
  "por",
  "the",
  "to",
  "um",
  "uma",
  "with"
])

function normalizeWhitespace(value: string): string {
  return String(value ?? "")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function tokenize(value: string): string[] {
  return normalizeWhitespace(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
}

function jaccardSimilarity(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a)
  const setB = new Set(b)
  if (setA.size === 0 || setB.size === 0) {
    return 0
  }

  let intersection = 0
  for (const token of setA) {
    if (setB.has(token)) {
      intersection += 1
    }
  }

  const union = setA.size + setB.size - intersection
  return union <= 0 ? 0 : intersection / union
}

function buildTitleFromChunk(contentChunk: string, index: number): string {
  const firstSentence = contentChunk.split(/[.!?]/u).map((part) => part.trim()).find(Boolean) ?? ""
  const clipped = firstSentence.slice(0, 58).trim()
  return clipped || `Atomic note ${index + 1}`
}

class AIService {
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

  async improvePrompt(userPrompt: string): Promise<string> {
    const normalizedPrompt = normalizeWhitespace(userPrompt)
    if (!normalizedPrompt) {
      return ""
    }

    return [
      `Question to answer: "${normalizedPrompt}"`,
      "",
      "Goal:",
      "- Provide a clear, direct answer first.",
      "",
      "Context to use:",
      "- Use the notebook sources as the primary evidence base.",
      "- Separate source-backed facts from inference when uncertainty exists.",
      "",
      "Required output:",
      "- Direct answer in one paragraph.",
      "- Key evidence as bullet points.",
      "- Final section: practical implications and next steps.",
      "",
      "Quality bar:",
      "- Be precise, concise, and explicit about limitations."
    ].join("\n")
  }

  async atomizeContent(
    content: string
  ): Promise<
    Omit<
      Note,
      "id" | "userId" | "notebookId" | "linkedNoteIds" | "backlinks" | "createdAt" | "updatedAt"
    >[]
  > {
    const normalized = normalizeWhitespace(content)
    if (!normalized) {
      return []
    }

    const paragraphChunks = normalized
      .split(/\n{2,}/u)
      .map((chunk) => chunk.trim())
      .filter(Boolean)

    const chunks = (paragraphChunks.length > 0 ? paragraphChunks : [normalized]).slice(0, 15)

    return chunks.map((chunk, index) => {
      const chunkTokens = tokenize(chunk)
      const tags = Array.from(new Set(chunkTokens)).slice(0, 5)
      return {
        title: buildTitleFromChunk(chunk, index),
        content: chunk.slice(0, 2500),
        tags,
        source: "zettel_maker"
      }
    })
  }

  async generatePromptOptions(
    userPrompt: string
  ): Promise<Array<{ title: string; prompt: string }>> {
    return this.buildPromptOptionFallbacks(userPrompt)
  }

  async suggestLinks(
    noteContent: string,
    existingNotes: Array<{ id: string; title: string; content: string }>
  ): Promise<Array<{ noteId: string; noteTitle: string; relevance: number }>> {
    if (!Array.isArray(existingNotes) || existingNotes.length === 0) {
      return []
    }

    const sourceTokens = tokenize(noteContent)

    return existingNotes
      .map((note) => {
        const noteTokens = tokenize(`${note.title} ${note.content}`)
        const relevance = jaccardSimilarity(sourceTokens, noteTokens)
        return {
          noteId: String(note.id ?? "").trim(),
          noteTitle: String(note.title ?? "").trim() || "Untitled note",
          relevance: Math.round(relevance * 1000) / 1000
        }
      })
      .filter((candidate) => candidate.noteId && candidate.relevance > 0)
      .sort((left, right) => right.relevance - left.relevance)
      .slice(0, 5)
  }
}

export const aiService = new AIService()
