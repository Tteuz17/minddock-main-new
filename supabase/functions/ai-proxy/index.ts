/**
 * MindDock — AI Proxy Edge Function
 * Validates auth + subscription tier server-side, then calls Claude API.
 * The CLAUDE_API_KEY secret is stored only here, never in the extension bundle.
 *
 * Deploy: supabase functions deploy ai-proxy
 * Secret:  supabase secrets set CLAUDE_API_KEY=sk-ant-...
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.27.3"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
}

const AI_ACTIONS = ["improvePrompt", "atomizeContent", "generatePromptOptions", "suggestLinks", "brainMerge"] as const
type AIAction = (typeof AI_ACTIONS)[number]

// Tiers that can use AI features
const AI_ALLOWED_TIERS = new Set(["thinker", "thinker_pro"])

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  // ── 1. Validate JWT ─────────────────────────────────────────────────────────
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

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return jsonResponse({ error: "Invalid or expired session" }, 401)
  }

  // ── 2. Verify subscription tier from DB (server-side truth) ─────────────────
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

  // ── 3. Parse request body ───────────────────────────────────────────────────
  let body: { action: AIAction; payload: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400)
  }

  if (!AI_ACTIONS.includes(body.action)) {
    return jsonResponse({ error: "Unknown action" }, 400)
  }

  // ── 4. Call Claude API ──────────────────────────────────────────────────────
  const claude = new Anthropic({ apiKey: claudeApiKey })
  const model = "claude-sonnet-4-6"

  try {
    const result = await dispatchAction(claude, model, body.action, body.payload)
    return jsonResponse({ success: true, result })
  } catch (err) {
    console.error("[ai-proxy] Claude error:", err)
    return jsonResponse({ error: "AI call failed" }, 502)
  }
})

async function dispatchAction(
  claude: Anthropic,
  model: string,
  action: AIAction,
  payload: Record<string, unknown>
): Promise<unknown> {
  switch (action) {
    case "improvePrompt": {
      const userPrompt = String(payload.userPrompt ?? "")
      const response = await claude.messages.create({
        model,
        max_tokens: 500,
        system: `You are an expert prompt engineer for Google NotebookLM.
Your task is to rewrite the user's prompt so it produces a stronger answer in NotebookLM.
Rules:
- Keep the user's original intent.
- Make the prompt clearer, more specific, and more useful.
- Add a concrete objective, output expectations, and quality criteria when helpful.
- The final rewritten prompt must be in English only.
- Return only the rewritten prompt, with no explanation.`,
        messages: [{ role: "user", content: `Rewrite this prompt in better English for NotebookLM:\n\n${userPrompt}` }]
      })
      return extractText(response)
    }

    case "atomizeContent": {
      const content = String(payload.content ?? "").slice(0, 8000)
      const response = await claude.messages.create({
        model,
        max_tokens: 4096,
        system: `You are a Zettelkasten specialist.
Split the provided text into atomic notes, where each note contains exactly one concept or idea.
Return a JSON array in this format:
[{"title":"concise note title (max 60 chars)","content":"complete self-contained note content in markdown","tags":["tag1","tag2"],"source":"zettel_maker"}]
Rules:
- One idea per note.
- Each note must make sense on its own.
- Titles must be short and precise.
- Content should be markdown and between 50 and 300 words.
- Use 2 to 5 relevant tags.
- Return at least 3 notes and at most 15 notes.`,
        messages: [{ role: "user", content: `Atomize this content into Zettelkasten notes:\n\n${content}` }]
      })
      const text = extractText(response)
      const match = text.match(/\[[\s\S]*\]/)
      return match ? JSON.parse(match[0]) : []
    }

    case "generatePromptOptions": {
      const userPrompt = String(payload.userPrompt ?? "").trim().slice(0, 900)
      const response = await claude.messages.create({
        model,
        max_tokens: 1200,
        system: `You are a senior prompt architect for Google NotebookLM.
Transform the user's exact question into exactly 3 excellent prompt options ready to paste into NotebookLM.
Critical requirements:
- Preserve the user's true intent.
- Write everything in English only.
- Return exactly 3 options.
- Return JSON only, no markdown, no commentary.
The 3 options must use: "Deep analysis", "Structured brief", "Practical synthesis".
Every prompt must include sections: Goal, Context to use, Required output, Quality bar.
Return: [{"title":"...","prompt":"..."},{"title":"...","prompt":"..."},{"title":"...","prompt":"..."}]`,
        messages: [{
          role: "user",
          content: `Build 3 prompt options for this exact user question. Do not answer it.\n\n<user_question>\n${userPrompt}\n</user_question>`
        }]
      })
      const text = extractText(response)
      const match = text.match(/\[[\s\S]*\]/)
      return match ? JSON.parse(match[0]) : []
    }

    case "suggestLinks": {
      const noteContent = String(payload.noteContent ?? "").slice(0, 500)
      const existingNotes = (payload.existingNotes as Array<{ id: string; title: string }> ?? []).slice(0, 30)
      const notesSummary = existingNotes.map((n) => `ID:${n.id} | Title: ${n.title}`).join("\n")
      const response = await claude.messages.create({
        model,
        max_tokens: 500,
        messages: [{
          role: "user",
          content: [
            `Given this note:\n"${noteContent}"`,
            `\nAnd these existing notes:\n${notesSummary}`,
            '\nReturn a JSON array with the most relevant notes to link (max 5):',
            '[{"noteId":"...","noteTitle":"...","relevance":0.0}]'
          ].join("\n")
        }]
      })
      const text = extractText(response)
      const match = text.match(/\[[\s\S]*\]/)
      return match ? JSON.parse(match[0]) : []
    }

    case "brainMerge": {
      const sources = (payload.sources as Array<{ notebookTitle: string; sourceTitle: string; content: string }> ?? [])
        .slice(0, 20)
        .map((s) => ({
          notebookTitle: String(s.notebookTitle ?? "").slice(0, 120),
          sourceTitle: String(s.sourceTitle ?? "").slice(0, 120),
          content: String(s.content ?? "").slice(0, 6000)
        }))

      const goal = String(payload.goal ?? "").slice(0, 600)

      const sourcesBlock = sources.map((s, i) =>
        `### Source ${i + 1}: ${s.sourceTitle} (from notebook: ${s.notebookTitle})\n\n${s.content}`
      ).join("\n\n---\n\n")

      const response = await claude.messages.create({
        model,
        max_tokens: 4096,
        system: `You are a knowledge synthesis expert.
You receive content from multiple knowledge sources (from different notebooks) and a user goal.
Your task is to produce a single, coherent, well-structured document that synthesizes the most relevant information from all sources specifically to serve the user's goal.

Rules:
- Focus strictly on what is relevant to the goal.
- Combine and connect insights from different notebooks when they complement each other.
- Structure the output as a clear markdown document with sections.
- Start with a brief "Brain Merge Summary" section explaining what was synthesized and why.
- Be specific — cite which notebook or source each insight comes from.
- Do NOT pad. Only include what is genuinely useful for the goal.
- Write in the same language the user used for the goal.`,
        messages: [{
          role: "user",
          content: `Goal: ${goal}\n\n## Sources\n\n${sourcesBlock}`
        }]
      })
      return extractText(response)
    }
  }
}

function extractText(response: Anthropic.Message): string {
  const block = response.content?.[0]
  return String((block as { text?: string })?.text ?? "").trim()
}
