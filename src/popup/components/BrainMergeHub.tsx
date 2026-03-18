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
            [id]: {
              notebookId: id,
              notebookTitle: title,
              sources: [],
              selected: new Set(),
              expanded: false,
              loading: false
            }
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
      setNotebookSourcesMap((m) => ({
        ...m,
        [notebookId]: { ...m[notebookId], expanded: !m[notebookId].expanded }
      }))
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

  const handleReset = () => {
    setStep(1)
    setResult(null)
    setGoal("")
    setSelectedNotebookIds(new Set())
    setNotebookSourcesMap({})
    setError(null)
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
                        <div
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                            isSelected ? "border-yellow-400 bg-yellow-400/20" : "border-zinc-600"
                          }`}
                        >
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

          {/* Step 2 — Select sources + goal */}
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
                  <div
                    key={id}
                    className="rounded-[12px] border border-white/[0.07] bg-white/[0.02]"
                  >
                    <button
                      type="button"
                      onClick={() => void toggleExpand(id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left"
                    >
                      {nb.loading ? (
                        <Loader2 size={12} className="shrink-0 animate-spin text-zinc-500" />
                      ) : nb.expanded ? (
                        <ChevronDown size={12} className="shrink-0 text-zinc-400" />
                      ) : (
                        <ChevronRight size={12} className="shrink-0 text-zinc-400" />
                      )}
                      <span className="flex-1 truncate text-[11px] font-medium text-zinc-200">
                        {nb.notebookTitle}
                      </span>
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
                                isSelected
                                  ? "bg-yellow-400/10 text-yellow-200"
                                  : "text-zinc-400 hover:bg-white/[0.04]"
                              }`}
                            >
                              <div
                                className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition ${
                                  isSelected
                                    ? "border-yellow-400 bg-yellow-400/20"
                                    : "border-zinc-600"
                                }`}
                              >
                                {isSelected && <Check size={8} className="text-yellow-400" />}
                              </div>
                              <span className="flex-1 truncate">{src.title}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {nb.expanded && !nb.loading && nb.sources.length === 0 && (
                      <p className="px-3 pb-2 pt-1 text-[10px] text-zinc-600">No sources found.</p>
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
                onClick={handleReset}
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
              onClick={() => void handleGenerate()}
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
