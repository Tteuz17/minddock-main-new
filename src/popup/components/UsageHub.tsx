import { useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import { ArrowLeft, BrainCircuit, Sparkles, Wand2 } from "lucide-react"
import { STORAGE_KEYS } from "~/lib/constants"
import { useSubscription } from "~/hooks/useSubscription"

interface UsageHubProps {
  onBack: () => void
}

interface DailyUsage {
  date: string
  imports: number
  exports: number
  aiCalls: number
  captures: number
}

interface AiMonthlyUsage {
  monthKey: string
  agilePrompts: number
  docksSummaries: number
  brainMerges: number
}

const EMPTY_DAILY_USAGE: DailyUsage = { date: "", imports: 0, exports: 0, aiCalls: 0, captures: 0 }
const EMPTY_MONTHLY_USAGE: AiMonthlyUsage = {
  monthKey: "",
  agilePrompts: 0,
  docksSummaries: 0,
  brainMerges: 0
}

function getCurrentMonthKey(): string {
  return new Date().toISOString().slice(0, 7) // YYYY-MM
}

function normalizeMonthlyUsage(value: unknown): AiMonthlyUsage {
  const currentMonth = getCurrentMonthKey()
  if (!value || typeof value !== "object") {
    return { ...EMPTY_MONTHLY_USAGE, monthKey: currentMonth }
  }

  const candidate = value as Partial<AiMonthlyUsage>
  if (String(candidate.monthKey ?? "").trim() !== currentMonth) {
    return { ...EMPTY_MONTHLY_USAGE, monthKey: currentMonth }
  }

  return {
    monthKey: currentMonth,
    agilePrompts: Math.max(0, Math.floor(Number(candidate.agilePrompts ?? 0))),
    docksSummaries: Math.max(0, Math.floor(Number(candidate.docksSummaries ?? 0))),
    brainMerges: Math.max(0, Math.floor(Number(candidate.brainMerges ?? 0)))
  }
}

function normalizeDailyUsage(value: unknown): DailyUsage {
  if (!value || typeof value !== "object") {
    return EMPTY_DAILY_USAGE
  }

  const candidate = value as Partial<DailyUsage>
  return {
    date: String(candidate.date ?? ""),
    imports: Math.max(0, Math.floor(Number(candidate.imports ?? 0))),
    exports: Math.max(0, Math.floor(Number(candidate.exports ?? 0))),
    aiCalls: Math.max(0, Math.floor(Number(candidate.aiCalls ?? 0))),
    captures: Math.max(0, Math.floor(Number(candidate.captures ?? 0)))
  }
}

function toPercent(used: number, limit: number | null): number {
  if (!limit || limit <= 0) {
    return 0
  }
  return Math.min((used / limit) * 100, 100)
}

export function UsageHub({ onBack }: UsageHubProps) {
  const { limits } = useSubscription()
  const [dailyUsage, setDailyUsage] = useState<DailyUsage>(EMPTY_DAILY_USAGE)
  const [monthlyUsage, setMonthlyUsage] = useState<AiMonthlyUsage>({
    ...EMPTY_MONTHLY_USAGE,
    monthKey: getCurrentMonthKey()
  })

  const agileLimit =
    typeof limits.agile_prompts_per_month === "number" ? limits.agile_prompts_per_month : null
  const docksLimit =
    typeof limits.docks_summaries_per_month === "number" ? limits.docks_summaries_per_month : null
  const brainMergeLimit =
    typeof limits.brain_merges_per_month === "number" ? limits.brain_merges_per_month : null

  useEffect(() => {
    const hydrate = (): void => {
      chrome.storage.local.get(
        [STORAGE_KEYS.DAILY_USAGE, STORAGE_KEYS.AI_MONTHLY_USAGE],
        (snapshot) => {
          const normalizedDaily = normalizeDailyUsage(snapshot[STORAGE_KEYS.DAILY_USAGE])
          const normalizedMonthly = normalizeMonthlyUsage(snapshot[STORAGE_KEYS.AI_MONTHLY_USAGE])
          setDailyUsage(normalizedDaily)
          setMonthlyUsage(normalizedMonthly)

          if (
            normalizedMonthly.monthKey !== String(snapshot[STORAGE_KEYS.AI_MONTHLY_USAGE]?.monthKey ?? "")
          ) {
            void chrome.storage.local.set({ [STORAGE_KEYS.AI_MONTHLY_USAGE]: normalizedMonthly })
          }
        }
      )
    }

    hydrate()

    const handleStorage = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ): void => {
      if (area !== "local") {
        return
      }

      if (changes[STORAGE_KEYS.DAILY_USAGE]?.newValue) {
        setDailyUsage(normalizeDailyUsage(changes[STORAGE_KEYS.DAILY_USAGE].newValue))
      }
      if (changes[STORAGE_KEYS.AI_MONTHLY_USAGE]?.newValue) {
        setMonthlyUsage(normalizeMonthlyUsage(changes[STORAGE_KEYS.AI_MONTHLY_USAGE].newValue))
      }
    }

    chrome.storage.onChanged.addListener(handleStorage)
    return () => chrome.storage.onChanged.removeListener(handleStorage)
  }, [])

  const agileRemaining = useMemo(() => {
    if (agileLimit === null) return null
    return Math.max(agileLimit - monthlyUsage.agilePrompts, 0)
  }, [agileLimit, monthlyUsage.agilePrompts])

  const docksRemaining = useMemo(() => {
    if (docksLimit === null) return null
    return Math.max(docksLimit - monthlyUsage.docksSummaries, 0)
  }, [docksLimit, monthlyUsage.docksSummaries])

  const brainMergeRemaining = useMemo(() => {
    if (brainMergeLimit === null) return null
    return Math.max(brainMergeLimit - monthlyUsage.brainMerges, 0)
  }, [brainMergeLimit, monthlyUsage.brainMerges])

  return (
    <div className="relative flex h-full flex-col bg-[#050505] text-white">
      <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
        <button
          type="button"
          onClick={onBack}
          className="liquid-glass-soft flex h-7 w-7 items-center justify-center rounded-xl text-zinc-400 transition hover:-translate-y-px hover:text-white">
          <ArrowLeft size={14} strokeWidth={2} />
        </button>
        <div className="flex items-center gap-2">
          <h1 className="text-[13px] font-bold tracking-[-0.03em] text-white">Usage</h1>
          <span className="rounded-md bg-[#facc15]/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-[#facc15]">
            AI
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="liquid-glass-panel mt-2 rounded-[18px] p-2.5">
          <div className="liquid-glass-content space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
              AI Plan
            </p>
            <div className="flex items-center gap-2 text-[11px] text-zinc-300">
              <BrainCircuit size={13} className="text-[#facc15]" />
              <span>Claude Sonnet 4.6</span>
            </div>
            <p className="text-[10px] leading-relaxed text-zinc-400">
              {`Current limits: ${
                agileLimit !== null ? `${agileLimit} Agile Prompts` : "Agile unlimited"
              } + ${
                docksLimit !== null ? `${docksLimit} Dock summaries` : "Docks unlimited"
              } + ${
                brainMergeLimit !== null ? `${brainMergeLimit} Brain Merges` : "Brain Merge unlimited"
              } per month.`}
            </p>
            <p className="text-[10px] text-zinc-500">AI calls today: {dailyUsage.aiCalls}</p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, delay: 0.05 }}
          className="liquid-glass-panel mt-2 rounded-[18px] p-2.5">
          <div className="liquid-glass-content">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                Agile prompts
              </p>
              <p className="text-[10px] text-zinc-400">
                {monthlyUsage.agilePrompts}
                {agileLimit !== null ? ` / ${agileLimit}` : " / unlimited"}
              </p>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#facc15,#f59e0b)]"
                style={{ width: `${toPercent(monthlyUsage.agilePrompts, agileLimit)}%` }}
              />
            </div>
            <p className="mt-1 text-[10px] text-zinc-500">
              {agileRemaining !== null ? `${agileRemaining} remaining this month` : "Unlimited"}
            </p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, delay: 0.08 }}
          className="liquid-glass-panel mt-2 rounded-[18px] p-2.5">
          <div className="liquid-glass-content">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                Dock summaries
              </p>
              <p className="text-[10px] text-zinc-400">
                {monthlyUsage.docksSummaries}
                {docksLimit !== null ? ` / ${docksLimit}` : " / unlimited"}
              </p>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#38bdf8,#0ea5e9)]"
                style={{ width: `${toPercent(monthlyUsage.docksSummaries, docksLimit)}%` }}
              />
            </div>
            <p className="mt-1 text-[10px] text-zinc-500">
              {docksRemaining !== null ? `${docksRemaining} remaining this month` : "Unlimited"}
            </p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, delay: 0.11 }}
          className="liquid-glass-panel mt-2 rounded-[18px] p-2.5">
          <div className="liquid-glass-content">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                Brain merge
              </p>
              <p className="text-[10px] text-zinc-400">
                {monthlyUsage.brainMerges}
                {brainMergeLimit !== null ? ` / ${brainMergeLimit}` : " / unlimited"}
              </p>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#a855f7,#9333ea)]"
                style={{ width: `${toPercent(monthlyUsage.brainMerges, brainMergeLimit)}%` }}
              />
            </div>
            <p className="mt-1 text-[10px] text-zinc-500">
              {brainMergeRemaining !== null ? `${brainMergeRemaining} remaining this month` : "Unlimited"}
            </p>
          </div>
        </motion.div>

        <div className="mt-2 rounded-[14px] border border-white/8 bg-white/[0.02] px-3 py-2">
          <div className="flex items-center gap-2">
            <Sparkles size={12} className="text-[#facc15]" />
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-400">
              Usage rules
            </span>
          </div>
          <ul className="mt-1.5 space-y-1 text-[10px] leading-relaxed text-zinc-500">
            <li className="flex items-start gap-1.5">
              <Wand2 size={10} className="mt-0.5 shrink-0 text-zinc-500" />
              Each click on "Improve with AI" in Agile uses 1 credit.
            </li>
            <li className="flex items-start gap-1.5">
              <Wand2 size={10} className="mt-0.5 shrink-0 text-zinc-500" />
              Each Dock summary/atomization uses 1 credit.
            </li>
            <li className="flex items-start gap-1.5">
              <Wand2 size={10} className="mt-0.5 shrink-0 text-zinc-500" />
              Each Brain Merge generation uses 1 credit.
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
