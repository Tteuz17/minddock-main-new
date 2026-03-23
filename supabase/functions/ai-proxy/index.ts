/**
 * MindDock AI Proxy Edge Function
 * Validates auth/subscription server-side, then routes AI actions.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.27.3"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
}

const AI_ACTIONS = [
  "improvePrompt",
  "atomizeContent",
  "generatePromptOptions",
  "suggestLinks",
  "brainMerge"
] as const

type AIAction = (typeof AI_ACTIONS)[number]
type JsonMap = Record<string, unknown>

const AI_ALLOWED_TIERS = new Set(["thinker", "thinker_pro"])

const SHARED_SYSTEM_RULES = `You are MindDock AI, used in Focus Docks, Agile Prompts, and Brain Merge.
General rules:
- Keep outputs practical, specific, and grounded in the provided input.
- Never invent citations, sources, notebook names, or factual claims not present in the input.
- If information is missing, acknowledge the gap briefly instead of guessing.
- Respect the user's language by default, unless the user explicitly requests a different one.
- Do not include preambles, boilerplate, or meta commentary unless requested.`

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  })
}

function isRecord(value: unknown): value is JsonMap {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function normalizeString(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength)
}

function buildContextHints(payload: JsonMap): string {
  const context = payload.context
  if (!isRecord(context)) {
    return ""
  }

  const allowedKeys = [
    "surface",
    "operation",
    "intent",
    "tone",
    "targetAudience",
    "notebookCount",
    "sourceSnippetCount"
  ]

  const hints: string[] = []
  for (const key of allowedKeys) {
    const raw = context[key]
    if (raw === null || raw === undefined) {
      continue
    }

    const normalized = String(raw).trim().slice(0, 140)
    if (!normalized) {
      continue
    }

    hints.push(`- ${key}: ${normalized}`)
  }

  if (hints.length === 0) {
    return ""
  }

  return `\n\nApp context hints:\n${hints.join("\n")}`
}

function sanitizeTag(tag: unknown): string {
  return String(tag ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
}

function extractText(response: Anthropic.Message): string {
  const blocks = Array.isArray(response.content) ? response.content : []
  return blocks
    .map((block) => {
      if (!block || typeof block !== "object") {
        return ""
      }
      return String((block as { text?: unknown }).text ?? "")
    })
    .filter(Boolean)
    .join("\n")
    .trim()
}

function sliceFirstJsonArray(value: string): string | null {
  const input = String(value ?? "")
  const start = input.indexOf("[")
  if (start < 0) {
    return null
  }

  let depth = 0
  let inString = false
  let escaping = false

  for (let i = start; i < input.length; i += 1) {
    const ch = input[i]

    if (inString) {
      if (escaping) {
        escaping = false
      } else if (ch === "\\") {
        escaping = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === "[") {
      depth += 1
      continue
    }

    if (ch === "]") {
      depth -= 1
      if (depth === 0) {
        return input.slice(start, i + 1)
      }
    }
  }

  return null
}

function parseJsonArray(text: string): unknown[] | null {
  const candidates = new Set<string>()
  const trimmed = String(text ?? "").trim()
  if (trimmed) {
    candidates.add(trimmed)
  }

  const fencedRegex = /```(?:json)?\s*([\s\S]*?)```/gi
  let fenceMatch: RegExpExecArray | null
  while ((fenceMatch = fencedRegex.exec(trimmed)) !== null) {
    const candidate = String(fenceMatch[1] ?? "").trim()
    if (candidate) {
      candidates.add(candidate)
    }
  }

  const sliced = sliceFirstJsonArray(trimmed)
  if (sliced) {
    candidates.add(sliced)
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (Array.isArray(parsed)) {
        return parsed
      }
      if (isRecord(parsed)) {
        for (const key of ["items", "options", "notes", "links", "data"]) {
          if (Array.isArray(parsed[key])) {
            return parsed[key] as unknown[]
          }
        }
      }
    } catch {
      // Keep trying next candidate.
    }
  }

  return null
}

interface PromptOption {
  title: string
  prompt: string
}

interface AtomicNoteResult {
  title: string
  content: string
  tags: string[]
  source: string
}

interface SuggestedLinkResult {
  noteId: string
  noteTitle: string
  relevance: number
}

function buildPromptFallbackOptions(userPrompt: string): PromptOption[] {
  const question = normalizeString(userPrompt, 1600)
  return [
    {
      title: "Deep analysis",
      prompt: [
        "Goal:",
        `Provide a deep, evidence-based analysis of: ${question}`,
        "",
        "Context to use:",
        "- Use only the sources in this NotebookLM workspace.",
        "- Surface assumptions and missing information.",
        "",
        "Required output:",
        "- Main argument",
        "- Supporting evidence",
        "- Counterpoints",
        "- Final recommendation",
        "",
        "Quality bar:",
        "- Specific, structured, and source-grounded."
      ].join("\n")
    },
    {
      title: "Structured brief",
      prompt: [
        "Goal:",
        `Create an executive brief about: ${question}`,
        "",
        "Context to use:",
        "- Prioritize high-signal facts from uploaded sources.",
        "- Keep concise language.",
        "",
        "Required output:",
        "- Summary (5 bullets max)",
        "- Key findings",
        "- Risks or unknowns",
        "- Next steps",
        "",
        "Quality bar:",
        "- Actionable and clear for fast decision-making."
      ].join("\n")
    },
    {
      title: "Practical synthesis",
      prompt: [
        "Goal:",
        `Turn this topic into a practical plan: ${question}`,
        "",
        "Context to use:",
        "- Merge ideas from multiple sources when possible.",
        "- Prefer implementation-ready guidance.",
        "",
        "Required output:",
        "- Step-by-step plan",
        "- Tools/resources needed",
        "- Success criteria",
        "- Common mistakes to avoid",
        "",
        "Quality bar:",
        "- Concrete, prioritized, and easy to execute."
      ].join("\n")
    }
  ]
}

function normalizePromptOptions(raw: unknown[], userPrompt: string): PromptOption[] {
  const normalized: PromptOption[] = []
  const seen = new Set<string>()

  for (const item of raw) {
    if (!isRecord(item)) {
      continue
    }

    const title = normalizeString(item.title, 60)
    const prompt = normalizeString(item.prompt, 3200)
    if (!title || !prompt) {
      continue
    }

    const dedupeKey = prompt.toLowerCase()
    if (seen.has(dedupeKey)) {
      continue
    }
    seen.add(dedupeKey)
    normalized.push({ title, prompt })
    if (normalized.length >= 3) {
      break
    }
  }

  for (const fallback of buildPromptFallbackOptions(userPrompt)) {
    if (normalized.length >= 3) {
      break
    }
    normalized.push(fallback)
  }

  return normalized.slice(0, 3)
}

function normalizeAtomicNotes(raw: unknown[]): AtomicNoteResult[] {
  const normalized: AtomicNoteResult[] = []

  for (const item of raw) {
    if (!isRecord(item)) {
      continue
    }

    const title = normalizeString(item.title, 80) || "Atomic note"
    const content = normalizeString(item.content, 3200)
    if (!content) {
      continue
    }

    const tagsInput = Array.isArray(item.tags) ? item.tags : []
    const tags = Array.from(
      new Set(
        tagsInput
          .map((tag) => sanitizeTag(tag))
          .filter(Boolean)
      )
    ).slice(0, 5)

    normalized.push({
      title,
      content,
      tags: tags.length > 0 ? tags : ["minddock"],
      source: "zettel_maker"
    })

    if (normalized.length >= 15) {
      break
    }
  }

  return normalized
}

function normalizeSuggestedLinks(raw: unknown[]): SuggestedLinkResult[] {
  const normalized: SuggestedLinkResult[] = []
  const seen = new Set<string>()

  for (const item of raw) {
    if (!isRecord(item)) {
      continue
    }

    const noteId = normalizeString(item.noteId, 120)
    const noteTitle = normalizeString(item.noteTitle, 120)
    if (!noteId || !noteTitle || seen.has(noteId)) {
      continue
    }

    const relevanceRaw = Number(item.relevance ?? 0)
    const relevance = Number.isFinite(relevanceRaw)
      ? Math.max(0, Math.min(1, relevanceRaw))
      : 0

    seen.add(noteId)
    normalized.push({ noteId, noteTitle, relevance })
    if (normalized.length >= 5) {
      break
    }
  }

  return normalized
}

async function callClaude(
  claude: Anthropic,
  model: string,
  system: string,
  userContent: string,
  maxTokens: number
): Promise<string> {
  const response = await claude.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: userContent }]
  })

  return extractText(response)
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const authHeader = req.headers.get("Authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Missing authorization" }, 401)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const claudeApiKey = Deno.env.get("CLAUDE_API_KEY")

  if (!claudeApiKey) {
    return jsonResponse({ error: "AI service not configured" }, 503)
  }

  const token = authHeader.slice(7)
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return jsonResponse({ error: "Invalid or expired session" }, 401)
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("subscription_tier, subscription_status")
    .eq("id", user.id)
    .single()

  if (profileError || !profile) {
    return jsonResponse({ error: "Profile not found" }, 403)
  }

  if (!AI_ALLOWED_TIERS.has(profile.subscription_tier)) {
    return jsonResponse(
      { error: "AI features require Thinker plan or above", tier: profile.subscription_tier },
      403
    )
  }

  if (profile.subscription_status !== "active") {
    return jsonResponse(
      { error: "Subscription is not active", status: profile.subscription_status },
      403
    )
  }

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400)
  }

  if (!isRecord(rawBody)) {
    return jsonResponse({ error: "Invalid request body" }, 400)
  }

  const action = String(rawBody.action ?? "") as AIAction
  if (!AI_ACTIONS.includes(action)) {
    return jsonResponse({ error: "Unknown action" }, 400)
  }

  const payload = isRecord(rawBody.payload) ? rawBody.payload : {}
  const claude = new Anthropic({ apiKey: claudeApiKey })
  const model = "claude-sonnet-4-6"

  try {
    const result = await dispatchAction(claude, model, action, payload)
    return jsonResponse({ success: true, result })
  } catch (err) {
    console.error("[ai-proxy] AI call failed:", err)
    const message = err instanceof Error ? err.message : "AI call failed"
    return jsonResponse({ error: message }, 502)
  }
})

async function dispatchAction(
  claude: Anthropic,
  model: string,
  action: AIAction,
  payload: JsonMap
): Promise<unknown> {
  switch (action) {
    case "improvePrompt": {
      const userPrompt = normalizeString(payload.userPrompt, 4000)
      if (!userPrompt) {
        throw new Error("Missing prompt content for improvePrompt")
      }

      const text = await callClaude(
        claude,
        model,
        `${SHARED_SYSTEM_RULES}

You are a prompt engineer for Agile Prompts.
Task:
- Rewrite the user's prompt so NotebookLM can answer with higher quality.
- Keep the original intent and constraints.
- Keep the same language as the user's prompt unless explicitly requested otherwise.
- Make it concrete and structured.

Output rules:
- Return only one rewritten prompt (plain text).
- Do not include markdown fences.
- Do not include explanations.`,
        `Rewrite this prompt for NotebookLM:\n\n${userPrompt}${buildContextHints(payload)}`,
        700
      )

      const improved = text.trim()
      if (!improved) {
        throw new Error("Empty response from improvePrompt")
      }
      return improved
    }

    case "generatePromptOptions": {
      const userPrompt = normalizeString(payload.userPrompt, 2200)
      if (!userPrompt) {
        throw new Error("Missing prompt content for generatePromptOptions")
      }

      const text = await callClaude(
        claude,
        model,
        `${SHARED_SYSTEM_RULES}

You are a senior prompt architect for Agile Prompts.
Generate exactly 3 prompt options that improve the same user request.

Hard requirements:
- Preserve user intent.
- Do not answer the question itself. Only craft prompts.
- Each prompt must contain these headings: Goal, Context to use, Required output, Quality bar.
- Return JSON array only (no commentary, no markdown).
- Use this schema:
[{"title":"Deep analysis","prompt":"..."},{"title":"Structured brief","prompt":"..."},{"title":"Practical synthesis","prompt":"..."}]`,
        `Create 3 improved prompt options for this user request:\n\n${userPrompt}${buildContextHints(payload)}`,
        1400
      )

      const parsed = parseJsonArray(text)
      return normalizePromptOptions(parsed ?? [], userPrompt)
    }

    case "atomizeContent": {
      const content = normalizeString(payload.content, 16000)
      if (!content) {
        throw new Error("Missing content for atomizeContent")
      }

      const text = await callClaude(
        claude,
        model,
        `${SHARED_SYSTEM_RULES}

You are the Focus Docks atomizer.
Split the input into atomic notes, one core idea per note.

Hard requirements:
- Return JSON array only.
- Each item must follow:
  {"title":"...","content":"...","tags":["tag1","tag2"],"source":"zettel_maker"}
- Keep notes self-contained and useful out of context.
- Title max 60 chars.
- Content in markdown, about 50-220 words.
- 2 to 5 tags per note.
- Return 3 to 15 notes.`,
        `Atomize this content into Focus Docks notes:\n\n${content}${buildContextHints(payload)}`,
        4096
      )

      const parsed = parseJsonArray(text)
      const notes = normalizeAtomicNotes(parsed ?? [])
      if (notes.length === 0) {
        throw new Error("AI returned invalid atomized notes payload")
      }
      return notes
    }

    case "suggestLinks": {
      const noteContent = normalizeString(payload.noteContent, 1200)
      const existingNotes = Array.isArray(payload.existingNotes)
        ? payload.existingNotes.slice(0, 40)
        : []

      const notesSummary = existingNotes
        .map((item) => {
          if (!isRecord(item)) {
            return ""
          }
          const id = normalizeString(item.id, 120)
          const title = normalizeString(item.title, 160)
          return id && title ? `ID:${id} | Title:${title}` : ""
        })
        .filter(Boolean)
        .join("\n")

      const text = await callClaude(
        claude,
        model,
        `${SHARED_SYSTEM_RULES}

You suggest semantic links between notes.
Return a JSON array with up to 5 links:
[{"noteId":"...","noteTitle":"...","relevance":0.0}]

Rules:
- relevance must be between 0 and 1.
- Only include links that are genuinely relevant.`,
        [
          `Current note:\n${noteContent}`,
          "",
          `Existing notes:\n${notesSummary || "(none)"}`,
          "",
          "Return only JSON."
        ].join("\n"),
        700
      )

      const parsed = parseJsonArray(text)
      return normalizeSuggestedLinks(parsed ?? [])
    }

    case "brainMerge": {
      const goal = normalizeString(payload.goal, 1200)
      if (!goal) {
        throw new Error("Missing goal for brainMerge")
      }

      const sources = (Array.isArray(payload.sources) ? payload.sources : [])
        .slice(0, 28)
        .map((item) => {
          if (!isRecord(item)) {
            return null
          }

          const notebookTitle = normalizeString(item.notebookTitle, 120)
          const sourceTitle = normalizeString(item.sourceTitle, 120)
          const content = normalizeString(item.content, 7000)
          if (!notebookTitle || !sourceTitle || !content) {
            return null
          }

          return { notebookTitle, sourceTitle, content }
        })
        .filter(
          (item): item is { notebookTitle: string; sourceTitle: string; content: string } =>
            Boolean(item)
        )

      if (sources.length === 0) {
        throw new Error("No valid sources for brainMerge")
      }

      const sourcesBlock = sources
        .map(
          (source, index) =>
            `### Source ${index + 1}: ${source.sourceTitle} (Notebook: ${source.notebookTitle})\n${source.content}`
        )
        .join("\n\n---\n\n")

      const text = await callClaude(
        claude,
        model,
        `${SHARED_SYSTEM_RULES}

You are the Brain Merge synthesis engine.
Build one coherent markdown document from many notebook sources.

Hard requirements:
- Focus strictly on the user's goal.
- Merge overlapping ideas and call out meaningful disagreements.
- Cite origin inline using this format:
  [Notebook: <name> | Source: <title>]
- Start with "## Brain Merge Summary".
- Then provide practical sections with clear headings.
- Keep it concise and high-signal.`,
        `Goal:\n${goal}\n\nSources:\n${sourcesBlock}${buildContextHints(payload)}`,
        4096
      )

      const document = text.trim()
      if (!document) {
        throw new Error("Empty response from brainMerge")
      }
      return document
    }
  }
}
