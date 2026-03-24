# Brain Merge Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Brain Merge" feature to the extension popup that lets Thinker-tier users select sources from multiple notebooks, describe a goal, and generate an AI-curated document they can download and use as a source in NotebookLM.

**Architecture:** The popup gets a new `BrainMergeHub` view (3-step wizard). The front-end sends a `CMD_BRAIN_MERGE` chrome message to the background router, which fetches source contents via existing NotebookLM RPCs, then calls the AI proxy edge function with a new `brainMerge` action. The result (markdown) is returned to the popup and offered as a download.

**Tech Stack:** React 18 + TypeScript, Tailwind CSS, Lucide icons, Framer Motion, chrome.runtime.sendMessage, Supabase Edge Function (Deno), Anthropic SDK, chrome.downloads

---

## Files

| File | Action |
|---|---|
| `src/lib/contracts.ts` | Add `CMD_BRAIN_MERGE` to `MESSAGE_ACTIONS` |
| `src/services/ai-service.ts` | Add `brainMerge(sources, goal)` method |
| `supabase/functions/ai-proxy/index.ts` | Add `brainMerge` action |
| `src/background/router.ts` | Register + implement `handleBrainMerge` |
| `src/popup/components/BrainMergeHub.tsx` | **Create** — 3-step wizard UI |
| `src/popup/PopupApplication.tsx` | Add `brain-merge` view + navigation |
| `src/popup/components/HomeDashboard.tsx` | Replace "Smart Video Import" card with Brain Merge |

---

## Task 1: Add contract constant

**Files:**
- Modify: `src/lib/contracts.ts`

- [ ] Add `CMD_BRAIN_MERGE` to `MESSAGE_ACTIONS`:

```typescript
// In MESSAGE_ACTIONS object, after CMD_CREATE_CHECKOUT:
CMD_BRAIN_MERGE: "MINDDOCK_CMD_BRAIN_MERGE"
```

- [ ] Commit:
```bash
git add src/lib/contracts.ts
git commit -m "feat(brain-merge): add CMD_BRAIN_MERGE contract constant"
```

---

## Task 2: Add brainMerge to AI service

**Files:**
- Modify: `src/services/ai-service.ts`

- [ ] Add the `brainMerge` method to the `AIService` class, after `suggestLinks`:

```typescript
async brainMerge(
  sources: Array<{ notebookTitle: string; sourceTitle: string; content: string }>,
  goal: string
): Promise<string> {
  return callAiProxy<string>("brainMerge", { sources, goal })
}
```

- [ ] Commit:
```bash
git add src/services/ai-service.ts
git commit -m "feat(brain-merge): add brainMerge method to AIService"
```

---

## Task 3: Add brainMerge action to AI proxy edge function

**Files:**
- Modify: `supabase/functions/ai-proxy/index.ts`

- [ ] Add `"brainMerge"` to `AI_ACTIONS` array:

```typescript
const AI_ACTIONS = ["improvePrompt", "atomizeContent", "generatePromptOptions", "suggestLinks", "brainMerge"] as const
```

- [ ] Add the `brainMerge` case inside `dispatchAction` switch, after `suggestLinks`:

```typescript
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
```

- [ ] Commit:
```bash
git add supabase/functions/ai-proxy/index.ts
git commit -m "feat(brain-merge): add brainMerge action to ai-proxy edge function"
```

---

## Task 4: Add background router handler

**Files:**
- Modify: `src/background/router.ts`

- [ ] Register the handler in the `constructor()`, after `CMD_CREATE_CHECKOUT`:

```typescript
this.register(MESSAGE_ACTIONS.CMD_BRAIN_MERGE, this.handleBrainMerge)
```

- [ ] Add `handleBrainMerge` method to the `MessageRouter` class. Place it near the other AI handlers (after `handlePromptOptions`):

```typescript
private async handleBrainMerge(payload: unknown): Promise<StandardResponse> {
  const data = (payload as {
    notebookSources?: Array<{ notebookId: string; notebookTitle: string; sourceIds: string[] }>
    goal?: string
  }) ?? {}

  const notebookSources = Array.isArray(data.notebookSources) ? data.notebookSources : []
  const goal = String(data.goal ?? "").trim()

  if (notebookSources.length === 0) {
    return this.fail("Selecione pelo menos um notebook com fontes.")
  }

  if (!goal) {
    return this.fail("Descreva o objetivo do Brain Merge.")
  }

  try {
    const service = new NotebookLMService()
    const flatSources: Array<{ notebookTitle: string; sourceTitle: string; content: string }> = []

    for (const nb of notebookSources) {
      const notebookId = String(nb.notebookId ?? "").trim()
      const notebookTitle = String(nb.notebookTitle ?? "").trim()
      const sourceIds = Array.isArray(nb.sourceIds)
        ? nb.sourceIds.map((id) => String(id ?? "").trim()).filter(Boolean)
        : []

      if (!notebookId || sourceIds.length === 0) continue

      const result = await service.getSourcesContent(notebookId, sourceIds)
      const snippets = result.sourceSnippets ?? []

      for (const snippet of snippets) {
        flatSources.push({
          notebookTitle,
          sourceTitle: String(snippet.title ?? "Untitled"),
          content: String(snippet.content ?? "")
        })
      }
    }

    if (flatSources.length === 0) {
      return this.fail("Nenhum conteudo encontrado nas fontes selecionadas.")
    }

    const document = await aiService.brainMerge(flatSources, goal)
    return this.ok({ document })
  } catch (error) {
    return this.fail(error instanceof Error ? error.message : "Falha no Brain Merge.")
  }
}
```

- [ ] Commit:
```bash
git add src/background/router.ts
git commit -m "feat(brain-merge): register and implement handleBrainMerge in router"
```

---

## Task 5: Create BrainMergeHub component

**Files:**
- Create: `src/popup/components/BrainMergeHub.tsx`

The component is a 3-step wizard:
- **Step 1** — Select notebooks (multi-checkbox from `useNotebooks`)
- **Step 2** — For each selected notebook, pick sources (fetched on demand via `CMD_GET_NOTEBOOK_SOURCES`)
- **Step 3** — Enter goal → Generate → Show result + Download button

Gate: show upgrade prompt if `!isThinker`.

- [ ] Create the file:

```tsx
import { useState, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  GitMerge,
  Loader2,
  Sparkles
} from "lucide-react"
import { MESSAGE_ACTIONS } from "~/lib/contracts"
import { useNotebooks } from "~/hooks/useNotebooks"
import { useSubscription } from "~/hooks/useSubscription"
import { UpgradePrompt } from "~/components/UpgradePrompt"

interface Source {
  id: string
  title: string
}

interface NotebookSources {
  notebookId: string
  notebookTitle: string
  sources: Source[]
  selected: Set<string>
  expanded: boolean
  loading: boolean
}

interface BrainMergeHubProps {
  onBack: () => void
}

export function BrainMergeHub({ onBack }: BrainMergeHubProps) {
  const { notebooks, isLoading: isLoadingNotebooks } = useNotebooks()
  const { isThinker } = useSubscription()

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [selectedNotebookIds, setSelectedNotebookIds] = useState<Set<string>>(new Set())
  const [notebookSourcesMap, setNotebookSourcesMap] = useState<Record<string, NotebookSources>>({})
  const [goal, setGoal] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggleNotebook = (id: string, title: string) => {
    setSelectedNotebookIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
        if (!notebookSourcesMap[id]) {
          setNotebookSourcesMap((m) => ({
            ...m,
            [id]: { notebookId: id, notebookTitle: title, sources: [], selected: new Set(), expanded: false, loading: false }
          }))
        }
      }
      return next
    })
  }

  const loadSources = useCallback(async (notebookId: string) => {
    setNotebookSourcesMap((m) => ({
      ...m,
      [notebookId]: { ...m[notebookId], loading: true, expanded: true }
    }))
    try {
      const response = await chrome.runtime.sendMessage({
        command: MESSAGE_ACTIONS.CMD_GET_NOTEBOOK_SOURCES,
        payload: { notebookId }
      })
      const sources: Source[] = response?.success
        ? ((response.payload ?? response.data) as { sources?: Source[] })?.sources ?? []
        : []
      setNotebookSourcesMap((m) => ({
        ...m,
        [notebookId]: { ...m[notebookId], sources, loading: false }
      }))
    } catch {
      setNotebookSourcesMap((m) => ({
        ...m,
        [notebookId]: { ...m[notebookId], loading: false }
      }))
    }
  }, [])

  const toggleExpand = async (notebookId: string) => {
    const nb = notebookSourcesMap[notebookId]
    if (!nb) return
    if (!nb.expanded && nb.sources.length === 0) {
      await loadSources(notebookId)
    } else {
      setNotebookSourcesMap((m) => ({ ...m, [notebookId]: { ...m[notebookId], expanded: !m[notebookId].expanded } }))
    }
  }

  const toggleSource = (notebookId: string, sourceId: string) => {
    setNotebookSourcesMap((m) => {
      const nb = m[notebookId]
      if (!nb) return m
      const next = new Set(nb.selected)
      if (next.has(sourceId)) next.delete(sourceId)
      else next.add(sourceId)
      return { ...m, [notebookId]: { ...nb, selected: next } }
    })
  }

  const selectedCount = Object.values(notebookSourcesMap)
    .filter((nb) => selectedNotebookIds.has(nb.notebookId))
    .reduce((sum, nb) => sum + nb.selected.size, 0)

  const handleGenerate = async () => {
    setError(null)
    setIsGenerating(true)
    try {
      const notebookSources = Array.from(selectedNotebookIds)
        .map((id) => notebookSourcesMap[id])
        .filter((nb) => nb && nb.selected.size > 0)
        .map((nb) => ({
          notebookId: nb.notebookId,
          notebookTitle: nb.notebookTitle,
          sourceIds: Array.from(nb.selected)
        }))

      if (notebookSources.length === 0) {
        setError("Selecione pelo menos uma fonte.")
        setIsGenerating(false)
        return
      }

      const response = await chrome.runtime.sendMessage({
        command: MESSAGE_ACTIONS.CMD_BRAIN_MERGE,
        payload: { notebookSources, goal }
      })

      if (!response?.success) {
        throw new Error(String(response?.error ?? "Falha ao gerar Brain Merge."))
      }

      const doc = (response.payload ?? response.data) as { document?: string }
      setResult(doc?.document ?? "")
      setStep(3)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado.")
    } finally {
      setIsGenerating(false)
    }
  }

  const handleDownload = () => {
    if (!result) return
    const blob = new Blob([result], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `brain-merge-${Date.now()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!isThinker) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          <button type="button" onClick={onBack} className="text-zinc-400 hover:text-white transition">
            <ArrowLeft size={16} />
          </button>
          <span className="text-[13px] font-medium text-white">Brain Merge</span>
        </div>
        <div className="flex-1 px-4">
          <UpgradePrompt feature="Brain Merge" requiredTier="thinker" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-white/[0.06]">
        <button type="button" onClick={onBack} className="text-zinc-400 hover:text-white transition">
          <ArrowLeft size={16} />
        </button>
        <GitMerge size={14} className="text-yellow-400" />
        <span className="text-[13px] font-medium text-white">Brain Merge</span>
        <span className="ml-auto text-[10px] text-zinc-500">Step {step}/3</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <AnimatePresence mode="wait">
          {/* Step 1 — Select notebooks */}
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.16 }}
              className="space-y-3"
            >
              <p className="text-[11px] text-zinc-400">Select the notebooks to merge.</p>
              {isLoadingNotebooks ? (
                <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                  <Loader2 size={12} className="animate-spin" />
                  Loading notebooks...
                </div>
              ) : (
                <div className="space-y-1.5">
                  {notebooks.map((nb) => {
                    const isSelected = selectedNotebookIds.has(nb.id)
                    return (
                      <button
                        key={nb.id}
                        type="button"
                        onClick={() => toggleNotebook(nb.id, nb.title)}
                        className={`flex w-full items-center gap-2.5 rounded-[10px] border px-3 py-2 text-left text-[11px] transition ${
                          isSelected
                            ? "border-yellow-400/40 bg-yellow-400/10 text-white"
                            : "border-white/[0.07] bg-white/[0.03] text-zinc-300 hover:border-white/[0.14]"
                        }`}
                      >
                        <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                          isSelected ? "border-yellow-400 bg-yellow-400/20" : "border-zinc-600"
                        }`}>
                          {isSelected && <Check size={10} className="text-yellow-400" />}
                        </div>
                        <span className="flex-1 truncate">{nb.title}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </motion.div>
          )}

          {/* Step 2 — Select sources + enter goal */}
          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.16 }}
              className="space-y-3"
            >
              <p className="text-[11px] text-zinc-400">Pick sources from each notebook.</p>
              {Array.from(selectedNotebookIds).map((id) => {
                const nb = notebookSourcesMap[id]
                if (!nb) return null
                return (
                  <div key={id} className="rounded-[12px] border border-white/[0.07] bg-white/[0.02]">
                    <button
                      type="button"
                      onClick={() => toggleExpand(id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left"
                    >
                      {nb.loading ? (
                        <Loader2 size={12} className="shrink-0 animate-spin text-zinc-500" />
                      ) : nb.expanded ? (
                        <ChevronDown size={12} className="shrink-0 text-zinc-400" />
                      ) : (
                        <ChevronRight size={12} className="shrink-0 text-zinc-400" />
                      )}
                      <span className="flex-1 truncate text-[11px] font-medium text-zinc-200">{nb.notebookTitle}</span>
                      {nb.selected.size > 0 && (
                        <span className="rounded-full bg-yellow-400/20 px-1.5 py-0.5 text-[9px] text-yellow-400">
                          {nb.selected.size}
                        </span>
                      )}
                    </button>
                    {nb.expanded && nb.sources.length > 0 && (
                      <div className="border-t border-white/[0.05] px-3 pb-2 pt-1.5 space-y-1">
                        {nb.sources.map((src) => {
                          const isSelected = nb.selected.has(src.id)
                          return (
                            <button
                              key={src.id}
                              type="button"
                              onClick={() => toggleSource(id, src.id)}
                              className={`flex w-full items-center gap-2 rounded-[8px] px-2 py-1 text-[10px] transition ${
                                isSelected ? "bg-yellow-400/10 text-yellow-200" : "text-zinc-400 hover:bg-white/[0.04]"
                              }`}
                            >
                              <div className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition ${
                                isSelected ? "border-yellow-400 bg-yellow-400/20" : "border-zinc-600"
                              }`}>
                                {isSelected && <Check size={8} className="text-yellow-400" />}
                              </div>
                              <span className="flex-1 truncate">{src.title}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}

              <div className="space-y-1.5 pt-1">
                <label className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                  What is your goal?
                </label>
                <textarea
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="E.g. Create a sales script combining psychology and marketing"
                  rows={3}
                  className="w-full resize-none rounded-[10px] border border-white/[0.08] bg-black/30 px-3 py-2 text-[11px] text-zinc-100 placeholder-zinc-600 outline-none focus:border-yellow-400/40"
                />
              </div>
              {error && <p className="text-[10px] text-red-400">{error}</p>}
            </motion.div>
          )}

          {/* Step 3 — Result */}
          {step === 3 && result !== null && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.16 }}
              className="space-y-3"
            >
              <div className="flex items-center gap-2">
                <Sparkles size={13} className="text-yellow-400" />
                <p className="text-[11px] font-medium text-white">Brain Merge ready!</p>
              </div>
              <div className="max-h-[240px] overflow-y-auto rounded-[10px] border border-white/[0.07] bg-black/30 p-3">
                <pre className="whitespace-pre-wrap text-[10px] text-zinc-300 font-sans leading-relaxed">
                  {result}
                </pre>
              </div>
              <button
                type="button"
                onClick={handleDownload}
                className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-yellow-400/40 bg-yellow-400/10 py-2.5 text-[12px] font-medium text-yellow-300 transition hover:bg-yellow-400/20"
              >
                <Download size={13} />
                Download .md
              </button>
              <button
                type="button"
                onClick={() => { setStep(1); setResult(null); setGoal(""); setSelectedNotebookIds(new Set()); setNotebookSourcesMap({}); setError(null) }}
                className="w-full text-center text-[10px] text-zinc-500 hover:text-zinc-300 transition"
              >
                Start over
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer nav */}
      {step !== 3 && (
        <div className="flex items-center gap-2 border-t border-white/[0.06] px-4 py-3">
          {step === 2 && (
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex items-center gap-1.5 rounded-[10px] border border-white/[0.08] px-3 py-2 text-[11px] text-zinc-400 hover:text-white transition"
            >
              <ArrowLeft size={12} />
              Back
            </button>
          )}
          <div className="flex-1" />
          {step === 1 && (
            <button
              type="button"
              disabled={selectedNotebookIds.size === 0}
              onClick={() => setStep(2)}
              className="flex items-center gap-1.5 rounded-[10px] bg-yellow-400 px-4 py-2 text-[11px] font-semibold text-black transition hover:bg-yellow-300 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
              <ArrowRight size={12} />
            </button>
          )}
          {step === 2 && (
            <button
              type="button"
              disabled={selectedCount === 0 || !goal.trim() || isGenerating}
              onClick={handleGenerate}
              className="flex items-center gap-1.5 rounded-[10px] bg-yellow-400 px-4 py-2 text-[11px] font-semibold text-black transition hover:bg-yellow-300 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles size={12} />
                  Generate
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] Commit:
```bash
git add src/popup/components/BrainMergeHub.tsx
git commit -m "feat(brain-merge): create BrainMergeHub 3-step wizard component"
```

---

## Task 6: Wire view in PopupApplication

**Files:**
- Modify: `src/popup/PopupApplication.tsx`

- [ ] Add `"brain-merge"` to the `PopupView` type:

```typescript
type PopupView = "home" | "imports" | "agile" | "docks" | "highlights" | "usage" | "plans" | "zettel" | "prompt-lab" | "brain-merge"
```

- [ ] Add the import at the top:

```typescript
import { BrainMergeHub } from "~/popup/components/BrainMergeHub"
```

- [ ] Add the view case inside `AnimatePresence`, after the `prompt-lab` block (before the `home` default):

```tsx
) : view === "brain-merge" ? (
  <motion.div
    key="brain-merge"
    initial={{ opacity: 0, x: 20 }}
    animate={{ opacity: 1, x: 0 }}
    exit={{ opacity: 0, x: 20 }}
    transition={{ duration: 0.18 }}
    className="flex h-full flex-col">
    <BrainMergeHub onBack={() => setView("home")} />
  </motion.div>
```

- [ ] Pass `onOpenBrainMerge` to `HomeDashboard`. Update `HomeDashboard`'s call in the home view:

```tsx
<HomeDashboard
  onOpenSidePanel={openSidePanel}
  onOpenZettelHub={() => setView("zettel")}
  onOpenPromptLab={() => setView("prompt-lab")}
  onOpenBrainMerge={() => setView("brain-merge")}
/>
```

- [ ] Commit:
```bash
git add src/popup/PopupApplication.tsx
git commit -m "feat(brain-merge): add brain-merge view to PopupApplication"
```

---

## Task 7: Replace "Smart Video Import" card with Brain Merge in HomeDashboard

**Files:**
- Modify: `src/popup/components/HomeDashboard.tsx`

- [ ] Add `onOpenBrainMerge` to the `HomeDashboardProps` interface:

```typescript
interface HomeDashboardProps {
  onOpenSidePanel: (target: SidePanelLaunchTarget) => void | Promise<void>
  onOpenZettelHub?: () => void
  onOpenPromptLab?: () => void
  onOpenBrainMerge?: () => void
}
```

- [ ] Update the function signature:

```typescript
export function HomeDashboard({ onOpenSidePanel, onOpenZettelHub, onOpenPromptLab, onOpenBrainMerge }: HomeDashboardProps) {
```

- [ ] Add `GitMerge` to the lucide-react import:

```typescript
import {
  Check,
  ChevronDown,
  ArrowUpRight,
  BookMarked,
  BookOpenText,
  Eye,
  EyeOff,
  GitMerge,   // ← add
  Network,
  NotebookPen,
  RefreshCw,
  Settings2,
  Workflow
} from "lucide-react"
```

- [ ] Replace the "Smart Video Import" card entry in the `cards` array with Brain Merge:

```typescript
// Replace:
{
  title: "Smart Video Import",
  note: "Import and process video context automatically.",
  icon: Network,
  accent: "rgba(16,185,129,0.16)",
  accentEdge: "rgba(52,211,153,0.22)",
  comingSoon: true
}

// With:
{
  title: "Brain Merge",
  note: "Combine multiple notebooks with AI for a specific goal.",
  icon: GitMerge,
  accent: "rgba(168,85,247,0.16)",
  accentEdge: "rgba(192,132,252,0.22)",
  onClick: () => onOpenBrainMerge ? onOpenBrainMerge() : undefined
}
```

- [ ] Commit:
```bash
git add src/popup/components/HomeDashboard.tsx
git commit -m "feat(brain-merge): add Brain Merge card to HomeDashboard Thinker Modules"
```

---

## Verification

- [ ] Build the extension (`pnpm build` or `npm run build`) — no TypeScript errors
- [ ] Load unpacked in Chrome — extension opens without errors
- [ ] As free/pro user: Brain Merge card appears, clicking shows upgrade prompt
- [ ] As thinker user: Full wizard works — notebook selection → source selection → goal → generate → download
- [ ] AI proxy deployed: `supabase functions deploy ai-proxy`
