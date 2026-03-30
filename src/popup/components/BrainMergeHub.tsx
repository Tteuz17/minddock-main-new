import { useState, useCallback, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  GitMerge,
  Loader2,
  Sparkles,
  BookOpen,
  RefreshCw,
  Copy,
  Target,
  Layers,
  Zap,
} from "lucide-react"
import { MESSAGE_ACTIONS } from "~/lib/contracts"
import { STORAGE_KEYS } from "~/lib/constants"
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
  loading: boolean
  loaded: boolean
}

interface BrainMergeHubProps {
  onBack: () => void
}

const DEFAULT_BRAIN_MERGE_GOAL =
  "Create a professional executive summary of everything saved in the selected notebooks, focused on actionable insights."

interface GoalPreset {
  id: string
  title: string
  description: string
  method: string
  depthLabel: string
  outputs: string[]
  goal: string
}

const GOAL_PRESETS: GoalPreset[] = [
  {
    id: "executive",
    title: "Executive Summary",
    description: "Board-level synthesis with evidence-weighted conclusions.",
    method: "Hypothesis-driven synthesis with confidence scoring",
    depthLabel: "Harvard-level",
    outputs: ["Executive Thesis", "Decision Options", "Recommended Path", "Validation Gaps"],
    goal: [
      "Build a Harvard-level executive synthesis from the selected notebooks.",
      "",
      "Analytical standard:",
      "- Separate facts, assumptions, and inferences.",
      "- Reconcile conflicting evidence and state confidence levels.",
      "- Prioritize decision relevance over narration.",
      "",
      "Required output format:",
      "1) Executive Thesis (max 5 bullets)",
      "2) Critical Findings (grouped by theme, with evidence strength)",
      "3) Strategic Implications (short-term vs long-term)",
      "4) Decision Options (A/B/C with trade-offs)",
      "5) Recommended Path and rationale",
      "6) Open Questions to validate next",
      "",
      "Tone: concise, executive, evidence-driven."
    ].join("\n")
  },
  {
    id: "strategy",
    title: "Strategy Focus",
    description: "Competitive positioning and strategic trade-off analysis.",
    method: "Scenario-based strategy with optionality mapping",
    depthLabel: "MBA-case",
    outputs: ["Strategic Bets", "Scenarios", "Trade-offs", "Priority Matrix"],
    goal: [
      "Produce a strategy memo from the selected notebooks with Harvard-case rigor.",
      "",
      "Strategic lens:",
      "- Identify structural opportunities and constraints.",
      "- Compare strategic pathways under uncertainty.",
      "- Explicitly quantify or rank major trade-offs.",
      "",
      "Required output format:",
      "1) Strategic Context Snapshot",
      "2) Opportunity Landscape (ranked by impact and feasibility)",
      "3) Scenario Analysis (Base / Upside / Downside)",
      "4) Strategic Trade-offs and second-order effects",
      "5) Priority Matrix (Now, Next, Later)",
      "6) Leadership recommendations",
      "",
      "Tone: analytical, sharp, decision-oriented."
    ].join("\n")
  },
  {
    id: "risks",
    title: "Risk Review",
    description: "Structured risk architecture with mitigation sequencing.",
    method: "Risk taxonomy + likelihood-impact prioritization",
    depthLabel: "Audit-grade",
    outputs: ["Risk Register", "Heatmap Logic", "Mitigation Sequence", "Control Gaps"],
    goal: [
      "Create an audit-grade risk review from the selected notebooks.",
      "",
      "Risk standards:",
      "- Build a clear risk taxonomy (strategic, operational, financial, reputational).",
      "- Score likelihood and impact (High/Medium/Low with justification).",
      "- Flag unknown-unknowns and evidence blind spots.",
      "",
      "Required output format:",
      "1) Risk Taxonomy Overview",
      "2) Top Risks (with drivers, signals, and exposure)",
      "3) Mitigation Plan (preventive vs corrective actions)",
      "4) Residual Risks after mitigation",
      "5) Control and monitoring recommendations",
      "6) Immediate escalations",
      "",
      "Tone: precise, risk-aware, action-ready."
    ].join("\n")
  },
  {
    id: "action-plan",
    title: "Action Plan",
    description: "Execution blueprint with ownership and measurable milestones.",
    method: "Outcome-back planning with milestone architecture",
    depthLabel: "Operator mode",
    outputs: ["30-60-90 Plan", "Owners", "Milestones", "Success Metrics"],
    goal: [
      "Turn the selected notebooks into a high-clarity execution blueprint.",
      "",
      "Execution standards:",
      "- Translate insights into outcomes, not tasks only.",
      "- Assign ownership and sequencing dependencies.",
      "- Define measurable success criteria and review cadence.",
      "",
      "Required output format:",
      "1) Objective and expected outcomes",
      "2) 30-60-90 day action plan",
      "3) Owners, dependencies, and critical path",
      "4) Milestones and success metrics",
      "5) Failure modes and contingency actions",
      "6) Weekly operating rhythm",
      "",
      "Tone: pragmatic, structured, implementation-first."
    ].join("\n")
  }
]

// ─── Usage tracking ───────────────────────────────────────────────────────────

interface AiMonthlyUsageSnapshot {
  monthKey: string
  brainMerges: number
}

function getMonthKey(): string {
  return new Date().toISOString().slice(0, 7)
}

function normalizeBrainMergeUsage(value: unknown): AiMonthlyUsageSnapshot {
  const currentMonth = getMonthKey()
  if (!value || typeof value !== "object") {
    return { monthKey: currentMonth, brainMerges: 0 }
  }

  const candidate = value as Partial<AiMonthlyUsageSnapshot>
  if (String(candidate.monthKey ?? "").trim() !== currentMonth) {
    return { monthKey: currentMonth, brainMerges: 0 }
  }

  return {
    monthKey: currentMonth,
    brainMerges: Math.max(0, Math.floor(Number(candidate.brainMerges ?? 0)))
  }
}

function useBrainMergeQuota(limitPerMonth: number | "unlimited") {
  const [used, setUsed] = useState(0)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const snapshot = await chrome.storage.local.get(STORAGE_KEYS.AI_MONTHLY_USAGE)
    const usage = normalizeBrainMergeUsage(snapshot[STORAGE_KEYS.AI_MONTHLY_USAGE])
    setUsed(usage.brainMerges)
    setLoaded(true)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    const handleStorage = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ): void => {
      if (area !== "local" || !changes[STORAGE_KEYS.AI_MONTHLY_USAGE]) {
        return
      }
      const usage = normalizeBrainMergeUsage(changes[STORAGE_KEYS.AI_MONTHLY_USAGE].newValue)
      setUsed(usage.brainMerges)
      setLoaded(true)
    }

    chrome.storage.onChanged.addListener(handleStorage)
    return () => chrome.storage.onChanged.removeListener(handleStorage)
  }, [])

  const limit = limitPerMonth === "unlimited" ? Infinity : limitPerMonth
  const remaining = Math.max(0, limit - used)
  const pct = limit === Infinity ? 0 : Math.min(1, used / limit)
  const exhausted = limit !== Infinity && used >= limit

  return { used, remaining, limit, pct, exhausted, loaded, refresh }
}

// ─── Quota Bar ────────────────────────────────────────────────────────────────

function QuotaBar({
  used,
  limit,
  remaining,
  pct,
  loaded,
}: {
  used: number
  limit: number
  remaining: number
  pct: number
  loaded: boolean
}) {
  if (limit === Infinity) return null
  if (!loaded) return null

  const color = pct >= 1 ? "#ef4444" : pct >= 0.7 ? "#f97316" : "#facc15"
  const label =
    remaining === 0
      ? "Limit reached this month"
      : remaining === 1
      ? "1 Brain Merge left this month"
      : `${remaining} Brain Merges left this month`

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="mx-4 mb-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 space-y-2"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-[10px] font-medium text-zinc-300">{label}</span>
        </div>
        <span className="text-[10px] font-semibold tabular-nums" style={{ color }}>
          {used}/{limit}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct * 100}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
        />
      </div>
      {remaining === 0 && (
        <p className="text-[9px] text-zinc-600 leading-relaxed">
          Resets on the 1st of next month.{" "}
          <span className="text-zinc-500">Upgrade plan for higher monthly Brain Merge limits.</span>
        </p>
      )}
    </motion.div>
  )
}

// ─── Step Indicator ───────────────────────────────────────────────────────────
const STEPS = [
  { num: 1, label: "Notebooks", icon: BookOpen },
  { num: 2, label: "Sources", icon: Layers },
  { num: 3, label: "Result", icon: Sparkles },
]

function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center gap-0 px-4 py-3">
      {STEPS.map((s, i) => {
        const done = current > s.num
        const active = current === s.num
        return (
          <div key={s.num} className="flex items-center gap-0 flex-1">
            <div className="flex flex-col items-center gap-1 min-w-0">
              <motion.div
                animate={{
                  backgroundColor: done ? "#facc15" : active ? "rgba(250,204,21,0.15)" : "rgba(255,255,255,0.05)",
                  borderColor: done || active ? "#facc15" : "rgba(255,255,255,0.1)",
                  scale: active ? 1.08 : 1,
                }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="flex h-7 w-7 items-center justify-center rounded-full border"
              >
                {done ? (
                  <Check size={12} className="text-black" strokeWidth={2.5} />
                ) : (
                  <span
                    className={`text-[11px] font-bold ${active ? "text-[#facc15]" : "text-zinc-600"}`}
                  >
                    {s.num}
                  </span>
                )}
              </motion.div>
              <span
                className={`text-[9px] font-medium tracking-wide truncate max-w-[52px] text-center ${
                  active ? "text-[#facc15]" : done ? "text-zinc-400" : "text-zinc-600"
                }`}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <motion.div
                animate={{ backgroundColor: done ? "#facc15" : "rgba(255,255,255,0.08)" }}
                transition={{ duration: 0.3 }}
                className="h-[1px] flex-1 mx-1 mt-[-10px] rounded-full"
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Notebook Card ─────────────────────────────────────────────────────────────
function NotebookCard({
  id,
  title,
  selected,
  onToggle,
  index,
}: {
  id: string
  title: string
  selected: boolean
  onToggle: () => void
  index: number
}) {
  const shortTitle = title.length > 32 ? title.slice(0, 32) + "…" : title
  const initial = title.trim().charAt(0).toUpperCase() || "N"

  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.04 }}
      onClick={onToggle}
      className={`group relative w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-200 ${
        selected
          ? "border-yellow-400/40 bg-yellow-400/[0.07] shadow-[0_0_0_1px_rgba(250,204,21,0.2)_inset]"
          : "border-white/[0.07] bg-white/[0.03] hover:border-white/[0.14] hover:bg-white/[0.05]"
      }`}
    >
      {/* Avatar */}
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold transition-all duration-200 ${
          selected ? "bg-yellow-400/20 text-yellow-300" : "bg-white/[0.07] text-zinc-400"
        }`}
      >
        {initial}
      </div>

      {/* Title */}
      <span
        className={`flex-1 text-[11px] font-medium leading-tight transition-colors duration-200 ${
          selected ? "text-white" : "text-zinc-300 group-hover:text-zinc-100"
        }`}
      >
        {shortTitle}
      </span>

      {/* Checkbox */}
      <motion.div
        animate={{
          backgroundColor: selected ? "#facc15" : "transparent",
          borderColor: selected ? "#facc15" : "rgba(255,255,255,0.18)",
          scale: selected ? [1, 1.15, 1] : 1,
        }}
        transition={{ duration: 0.2 }}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border"
      >
        {selected && <Check size={11} className="text-black" strokeWidth={3} />}
      </motion.div>
    </motion.button>
  )
}

// ─── Source Row ────────────────────────────────────────────────────────────────
function SourceRow({
  src,
  selected,
  onToggle,
}: {
  src: Source
  selected: boolean
  onToggle: () => void
}) {
  return (
    <motion.button
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onToggle}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-all duration-150 ${
        selected ? "bg-yellow-400/10 text-yellow-200" : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200"
      }`}
    >
      <div
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-all duration-150 ${
          selected ? "border-yellow-400 bg-yellow-400/25" : "border-zinc-600"
        }`}
      >
        {selected && <Check size={8} className="text-yellow-300" strokeWidth={3} />}
      </div>
      <span className="flex-1 truncate text-[10px]">{src.title}</span>
    </motion.button>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function BrainMergeHub({ onBack }: BrainMergeHubProps) {
  const { notebooks, isLoading: isLoadingNotebooks, error: notebooksError, refetch } = useNotebooks()
  const { isThinker, limits } = useSubscription()
  const quota = useBrainMergeQuota(limits.brain_merges_per_month ?? 5)

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [selectedNotebookIds, setSelectedNotebookIds] = useState<Set<string>>(new Set())
  const [notebookSourcesMap, setNotebookSourcesMap] = useState<Record<string, NotebookSources>>({})
  const [goal, setGoal] = useState("")
  const [selectedGoalPresetId, setSelectedGoalPresetId] = useState<string>("custom")
  const [isPresetDropdownOpen, setIsPresetDropdownOpen] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const presetDropdownRef = useRef<HTMLDivElement | null>(null)
  const selectedGoalPreset =
    GOAL_PRESETS.find((preset) => preset.id === selectedGoalPresetId) ?? null

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
            [id]: {
              notebookId: id,
              notebookTitle: title,
              sources: [],
              loading: false,
              loaded: false
            },
          }))
        }
      }
      return next
    })
  }

  const loadSources = useCallback(async (notebookId: string) => {
    setNotebookSourcesMap((currentMap) => {
      const entry = currentMap[notebookId]
      if (!entry) {
        return currentMap
      }
      return {
        ...currentMap,
        [notebookId]: { ...entry, loading: true }
      }
    })

    try {
      const response = await chrome.runtime.sendMessage({
        command: MESSAGE_ACTIONS.CMD_GET_NOTEBOOK_SOURCES,
        payload: { notebookId }
      })
      const sources: Source[] = response?.success
        ? ((response.payload ?? response.data) as { sources?: Source[] })?.sources ?? []
        : []

      setNotebookSourcesMap((currentMap) => {
        const entry = currentMap[notebookId]
        if (!entry) {
          return currentMap
        }
        return {
          ...currentMap,
          [notebookId]: { ...entry, sources, loading: false, loaded: true }
        }
      })
    } catch {
      setNotebookSourcesMap((currentMap) => {
        const entry = currentMap[notebookId]
        if (!entry) {
          return currentMap
        }
        return {
          ...currentMap,
          [notebookId]: { ...entry, loading: false, loaded: true }
        }
      })
    }
  }, [])

  const selectedCount = Object.values(notebookSourcesMap)
    .filter((nb) => selectedNotebookIds.has(nb.notebookId))
    .reduce((sum, nb) => sum + nb.sources.length, 0)

  const isLoadingSelectedSources = Array.from(selectedNotebookIds).some((id) => {
    const entry = notebookSourcesMap[id]
    return !entry || entry.loading || !entry.loaded
  })

  useEffect(() => {
    if (step !== 2 || selectedNotebookIds.size === 0) {
      return
    }

    for (const notebookId of selectedNotebookIds) {
      const notebookFromList = notebooks.find((item) => item.id === notebookId)
      const notebookTitle =
        notebookFromList?.title ?? notebookSourcesMap[notebookId]?.notebookTitle ?? "Notebook"

      if (!notebookSourcesMap[notebookId]) {
        setNotebookSourcesMap((current) => ({
          ...current,
          [notebookId]: {
            notebookId,
            notebookTitle,
            sources: [],
            loading: false,
            loaded: false
          }
        }))
      }

      const entry = notebookSourcesMap[notebookId]
      if (!entry || (!entry.loading && !entry.loaded)) {
        void loadSources(notebookId)
      }
    }
  }, [step, selectedNotebookIds, notebookSourcesMap, notebooks, loadSources])

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!presetDropdownRef.current) {
        return
      }
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }
      if (!presetDropdownRef.current.contains(target)) {
        setIsPresetDropdownOpen(false)
      }
    }

    document.addEventListener("mousedown", handleOutsideClick)
    return () => document.removeEventListener("mousedown", handleOutsideClick)
  }, [])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsPresetDropdownOpen(false)
      }
    }

    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [])

  const handleGenerate = async () => {
    setError(null)
    setIsGenerating(true)
    try {
      const notebookSources = Array.from(selectedNotebookIds)
        .map((id) => {
          const notebookEntry = notebookSourcesMap[id]
          const notebookTitle =
            notebookEntry?.notebookTitle ??
            notebooks.find((item) => item.id === id)?.title ??
            "Notebook"

          return {
            notebookId: id,
            notebookTitle,
            sourceIds: (notebookEntry?.sources ?? []).map((source) => source.id)
          }
        })

      if (notebookSources.length === 0) {
        setError("Select at least 1 notebook to generate a Brain Merge.")
        setIsGenerating(false)
        return
      }

      const normalizedGoal = goal.trim() || DEFAULT_BRAIN_MERGE_GOAL
      const response = await chrome.runtime.sendMessage({
        command: MESSAGE_ACTIONS.CMD_BRAIN_MERGE,
        payload: { notebookSources, goal: normalizedGoal },
      })
      if (!response?.success) throw new Error(String(response?.error ?? "Failed to generate Brain Merge."))
      const doc = (response.payload ?? response.data) as { document?: string }
      setResult(doc?.document ?? "")
      await quota.refresh()
      setStep(3)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.")
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

  const handleCopy = async () => {
    if (!result) return
    await navigator.clipboard.writeText(result)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleReset = () => {
    setStep(1); setResult(null); setGoal(""); setSelectedGoalPresetId("custom")
    setIsPresetDropdownOpen(false)
    setSelectedNotebookIds(new Set()); setNotebookSourcesMap({}); setError(null)
  }

  const applyGoalPreset = (preset: GoalPreset) => {
    setSelectedGoalPresetId(preset.id)
    setGoal(preset.goal)
    setIsPresetDropdownOpen(false)
  }

  if (!isThinker) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-white/[0.06]">
          <button type="button" onClick={onBack} className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:text-white hover:bg-white/8 transition-all">
            <ArrowLeft size={15} />
          </button>
          <GitMerge size={14} className="text-yellow-400" />
          <span className="text-[13px] font-semibold text-white">Brain Merge</span>
        </div>
        <div className="flex-1 px-4 py-3">
          <UpgradePrompt feature="Brain Merge" requiredTier="thinker" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-[#0d0d0d]">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-4 pt-3.5 pb-3">
        <button
          type="button"
          onClick={onBack}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-white/[0.07] hover:text-white transition-all duration-150"
        >
          <ArrowLeft size={14} />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-yellow-400/15">
            <GitMerge size={13} className="text-yellow-400" />
          </div>
          <span className="text-[13px] font-semibold text-white tracking-tight">Brain Merge</span>
          <span className="rounded-full bg-yellow-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-yellow-500">
            Beta
          </span>
        </div>
      </div>

      {/* Step Indicator */}
      <StepIndicator current={step} />

      {/* Divider */}
      <div className="h-[1px] bg-white/[0.05] mx-4" />

      {/* Quota bar (step 2 only) */}
      {step === 2 && (
        <div className="pt-3">
          <QuotaBar
            used={quota.used}
            limit={quota.limit}
            remaining={quota.remaining}
            pct={quota.pct}
            loaded={quota.loaded}
          />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <AnimatePresence mode="wait">
          {/* ── Step 1: Notebooks ── */}
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="px-4 py-3 space-y-3"
            >
              <div className="space-y-0.5">
                <p className="text-[12px] font-semibold text-white">Choose notebooks</p>
                <p className="text-[10px] text-zinc-500 leading-relaxed">Select 2 or more notebooks to synthesize knowledge across them.</p>
              </div>

              {isLoadingNotebooks ? (
                <div className="flex flex-col items-center gap-3 py-8">
                  <div className="relative h-8 w-8">
                    <Loader2 size={32} className="animate-spin text-yellow-400/40" strokeWidth={1.5} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="h-2 w-2 rounded-full bg-yellow-400/60" />
                    </div>
                  </div>
                  <p className="text-[10px] text-zinc-600">Fetching notebooks…</p>
                </div>
              ) : notebooksError || notebooks.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-8 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.05]">
                    <BookOpen size={18} className="text-zinc-600" strokeWidth={1.5} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium text-zinc-400">No notebooks found</p>
                    <p className="text-[10px] text-zinc-600 leading-relaxed">
                      Open <span className="text-zinc-400 font-medium">notebooklm.google.com</span> in a tab,<br />then retry.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => refetch()}
                    className="flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-1.5 text-[10px] font-medium text-zinc-300 hover:bg-white/[0.09] hover:text-white transition-all"
                  >
                    <RefreshCw size={10} />
                    Retry
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {notebooks.map((nb, i) => (
                    <NotebookCard
                      key={nb.id}
                      id={nb.id}
                      title={nb.title}
                      selected={selectedNotebookIds.has(nb.id)}
                      onToggle={() => toggleNotebook(nb.id, nb.title)}
                      index={i}
                    />
                  ))}
                </div>
              )}

              {selectedNotebookIds.size > 0 && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-[10px] text-zinc-500 text-center"
                >
                  <span className="text-yellow-400 font-semibold">{selectedNotebookIds.size}</span> notebook{selectedNotebookIds.size !== 1 ? "s" : ""} selected
                </motion.p>
              )}
            </motion.div>
          )}

          {/* ── Step 2: Sources + Goal ── */}
          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="px-4 py-3 space-y-3"
            >
              <div className="space-y-0.5">
                <p className="text-[12px] font-semibold text-white">Sources (automatic)</p>
                <p className="text-[10px] text-zinc-500 leading-relaxed">
                  All sources from selected notebooks are included automatically.
                </p>
              </div>

              <div className="overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div className="flex snap-x snap-mandatory gap-2.5 pr-1">
                  {Array.from(selectedNotebookIds).map((id) => {
                    const notebookEntry = notebookSourcesMap[id]
                    const notebookTitle =
                      notebookEntry?.notebookTitle ??
                      notebooks.find((item) => item.id === id)?.title ??
                      "Notebook"
                    const isLoadingNotebook = !notebookEntry || notebookEntry.loading || !notebookEntry.loaded
                    const sourceCount = notebookEntry?.sources.length ?? 0

                    return (
                      <div
                        key={id}
                        className="min-h-[106px] min-w-[118px] snap-start rounded-xl border border-white/[0.08] bg-white/[0.03] p-2.5"
                      >
                        <div className="flex h-full flex-col justify-between">
                          <div className="space-y-1">
                            <p className="max-h-[28px] overflow-hidden text-[10px] font-semibold leading-tight text-zinc-100">
                              {notebookTitle}
                            </p>
                            <p className="text-[9px] text-zinc-500">
                              {isLoadingNotebook
                                ? "Loading..."
                                : sourceCount > 0
                                  ? "Auto included"
                                  : "No sources"}
                            </p>
                          </div>
                          <div className="pt-1">
                            {isLoadingNotebook ? (
                              <span className="inline-flex items-center gap-1 text-[9px] text-zinc-500">
                                <Loader2 size={9} className="animate-spin text-yellow-400/70" />
                                Syncing
                              </span>
                            ) : (
                              <span className="inline-flex rounded-full bg-yellow-400/12 px-2 py-0.5 text-[8px] font-semibold text-yellow-300">
                                {sourceCount} source{sourceCount !== 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
              <p className="text-[9px] text-zinc-600">Swipe horizontally to preview selected notebooks.</p>

              {/* Goal input */}
              <div className="space-y-2.5 pt-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Target size={11} className="text-zinc-300" />
                    <label className="text-[11px] font-medium text-zinc-100">Merge Goal</label>
                  </div>
                  <span className="rounded-full border border-white/[0.14] bg-white/[0.04] px-2 py-0.5 text-[9px] text-zinc-400">
                    Optional
                  </span>
                </div>

                <div className="space-y-2 rounded-2xl border border-white/[0.1] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))] p-3 shadow-[0_14px_40px_rgba(0,0,0,0.28)]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <p className="text-[11px] font-semibold text-white">Custom goal</p>
                      <p className="text-[9px] text-zinc-500">
                        Primary input. This defines what the merge should optimize for.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedGoalPresetId("custom")}
                      className={`rounded-full border px-2 py-0.5 text-[8px] font-medium tracking-wide transition-all ${
                        selectedGoalPresetId === "custom"
                          ? "border-yellow-400/40 bg-yellow-400/12 text-yellow-200"
                          : "border-white/[0.15] text-zinc-400 hover:border-white/[0.22] hover:text-zinc-200"
                      }`}
                    >
                      Primary
                    </button>
                  </div>
                  <textarea
                    value={goal}
                    onChange={(e) => {
                      setGoal(e.target.value)
                      setSelectedGoalPresetId("custom")
                    }}
                    placeholder="Type your merge goal. Example: Build an executive synthesis with key opportunities, risks, and next actions."
                    rows={4}
                    className="w-full resize-none rounded-2xl border border-white/[0.12] bg-[#0f1012] px-3 py-3 text-[12px] leading-relaxed text-zinc-100 placeholder-zinc-500 outline-none transition-all duration-200 focus:border-white/[0.26] focus:bg-[#121316] focus:shadow-[0_0_0_2px_rgba(255,255,255,0.06)]"
                  />
                </div>

                <div className="space-y-2 rounded-2xl border border-white/[0.1] bg-white/[0.03] p-3">
                  <div className="space-y-0.5">
                    <p className="text-[11px] font-semibold text-white">Quick Presets</p>
                    <p className="text-[9px] text-zinc-500">
                      Advanced frameworks with structured method and expected deliverables.
                    </p>
                  </div>
                  <div ref={presetDropdownRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setIsPresetDropdownOpen((prev) => !prev)}
                      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-all ${
                        isPresetDropdownOpen
                          ? "border-white/[0.26] bg-white/[0.08] shadow-[0_0_0_2px_rgba(255,255,255,0.05)]"
                          : "border-white/[0.12] bg-[#111215] hover:border-white/[0.2] hover:bg-[#14161a]"
                      }`}
                    >
                      <span
                        className={`text-[11px] font-medium ${
                          selectedGoalPreset ? "text-zinc-100" : "text-zinc-400"
                        }`}
                      >
                        {selectedGoalPreset?.title ?? "Select a preset"}
                      </span>
                      <ChevronDown
                        size={13}
                        className={`text-zinc-400 transition-transform duration-150 ${
                          isPresetDropdownOpen ? "rotate-180" : "rotate-0"
                        }`}
                      />
                    </button>

                    {isPresetDropdownOpen && (
                      <div className="absolute left-0 right-0 z-30 mt-1.5 rounded-xl border border-white/[0.12] bg-[#0f1115] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.48)] backdrop-blur">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedGoalPresetId("custom")
                            setIsPresetDropdownOpen(false)
                          }}
                          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition-all ${
                            selectedGoalPresetId === "custom"
                              ? "bg-yellow-400/12 text-yellow-200"
                              : "text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-100"
                          }`}
                        >
                          <div className="space-y-0.5">
                            <p className="text-[10px] font-semibold">No preset (Custom)</p>
                            <p className="text-[9px] text-zinc-500">Keep only your own goal text.</p>
                          </div>
                          {selectedGoalPresetId === "custom" && (
                            <Check size={11} className="text-yellow-300" />
                          )}
                        </button>

                        {GOAL_PRESETS.map((preset) => {
                          const selected = selectedGoalPresetId === preset.id
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => applyGoalPreset(preset)}
                              className={`mt-1 flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition-all ${
                                selected
                                  ? "bg-yellow-400/12 text-yellow-200"
                                  : "text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-100"
                              }`}
                            >
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-1.5">
                                  <p className="text-[10px] font-semibold">{preset.title}</p>
                                  <span className="rounded-full border border-white/[0.14] bg-white/[0.04] px-1.5 py-0.5 text-[8px] text-zinc-400">
                                    {preset.depthLabel}
                                  </span>
                                </div>
                                <p className="text-[9px] text-zinc-500">{preset.description}</p>
                                <p className="text-[9px] text-zinc-500">Method: {preset.method}</p>
                              </div>
                              {selected && <Check size={11} className="text-yellow-300" />}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {selectedGoalPreset && (
                    <div className="space-y-1.5 rounded-xl border border-white/[0.1] bg-black/20 p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] font-semibold text-zinc-100">
                          {selectedGoalPreset.title} Framework
                        </p>
                        <span className="rounded-full border border-yellow-400/35 bg-yellow-400/10 px-1.5 py-0.5 text-[8px] text-yellow-200">
                          {selectedGoalPreset.depthLabel}
                        </span>
                      </div>
                      <p className="text-[9px] text-zinc-400">Method: {selectedGoalPreset.method}</p>
                      <div className="flex flex-wrap gap-1">
                        {selectedGoalPreset.outputs.map((output) => (
                          <span
                            key={output}
                            className="rounded-full border border-white/[0.12] bg-white/[0.04] px-2 py-0.5 text-[8px] text-zinc-300"
                          >
                            {output}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {selectedCount > 0 && (
                <p className="text-[10px] text-zinc-500 text-center">
                  <span className="text-yellow-400 font-semibold">{selectedCount}</span> source{selectedCount !== 1 ? "s" : ""} included automatically
                </p>
              )}
              {!isLoadingSelectedSources && selectedCount === 0 && (
                <p className="text-[10px] text-zinc-500 text-center">
                  Sources are not preloaded in the popup. Brain Merge will fetch everything automatically from the selected notebooks.
                </p>
              )}

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.08] px-3 py-2"
                >
                  <div className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />
                  <p className="text-[10px] text-red-400">{error}</p>
                </motion.div>
              )}
            </motion.div>
          )}

          {/* ── Step 3: Result ── */}
          {step === 3 && result !== null && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="px-4 py-3 space-y-3"
            >
              {/* Success badge */}
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="flex items-center gap-2 rounded-xl border border-yellow-400/20 bg-yellow-400/[0.06] px-3 py-2.5"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-yellow-400/15">
                  <Sparkles size={14} className="text-yellow-400" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-white">Brain Merge complete</p>
                  <p className="text-[9px] text-zinc-500">Your synthesized document is ready</p>
                </div>
              </motion.div>

              {/* Result preview */}
              <div className="relative overflow-hidden rounded-xl border border-white/[0.07] bg-black/40">
                <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
                  <span className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">Preview</span>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex items-center gap-1 text-[9px] text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    {copied ? <Check size={9} className="text-green-400" /> : <Copy size={9} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="max-h-[180px] overflow-y-auto px-3 py-2.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                  <pre className="whitespace-pre-wrap font-sans text-[10px] leading-relaxed text-zinc-300">
                    {result}
                  </pre>
                </div>
              </div>

              {/* Actions */}
              <button
                type="button"
                onClick={handleDownload}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-yellow-400/30 bg-yellow-400/10 py-2.5 text-[11px] font-semibold text-yellow-300 transition-all duration-200 hover:bg-yellow-400/20 hover:border-yellow-400/50 active:scale-[0.98]"
              >
                <Download size={12} />
                Download .md
              </button>

              <button
                type="button"
                onClick={handleReset}
                className="w-full text-center text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                Start a new merge
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer nav */}
      {step !== 3 && (
        <div className="border-t border-white/[0.05] px-4 py-3">
          <div className="flex items-center gap-2">
            {step === 2 && (
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] px-3 py-2 text-[11px] font-medium text-zinc-400 hover:border-white/[0.14] hover:text-white transition-all duration-150"
              >
                <ArrowLeft size={11} />
                Back
              </button>
            )}
            <div className="flex-1" />

            {step === 1 && (
              <motion.button
                type="button"
                disabled={selectedNotebookIds.size < 2}
                onClick={() => {
                  setError(null)
                  setStep(2)
                }}
                whileTap={{ scale: 0.97 }}
                className="flex items-center gap-2 rounded-xl bg-yellow-400 px-5 py-2 text-[11px] font-bold text-black transition-all duration-150 hover:bg-yellow-300 disabled:opacity-35 disabled:cursor-not-allowed"
              >
                <Zap size={11} />
                Next
                <span className="opacity-60 text-[9px]">({selectedNotebookIds.size}/2+)</span>
              </motion.button>
            )}

            {step === 2 && (
              <motion.button
                type="button"
                disabled={isLoadingSelectedSources || selectedNotebookIds.size === 0 || isGenerating || quota.exhausted}
                onClick={() => void handleGenerate()}
                whileTap={{ scale: 0.97 }}
                className="flex items-center gap-2 rounded-xl bg-yellow-400 px-5 py-2 text-[11px] font-bold text-black transition-all duration-150 hover:bg-yellow-300 disabled:opacity-35 disabled:cursor-not-allowed"
              >
                {isLoadingSelectedSources ? (
                  <>
                    <Loader2 size={11} className="animate-spin" />
                    Loading...
                  </>
                ) : isGenerating ? (
                  <>
                    <Loader2 size={11} className="animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Sparkles size={11} />
                    Generate
                  </>
                )}
              </motion.button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}


