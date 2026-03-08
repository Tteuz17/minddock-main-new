import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowLeft, ArrowUpRight, Download, Bot, FileDown, ChevronDown, ChevronRight } from "lucide-react"
import { STORAGE_KEYS, URLS } from "~/lib/constants"
import { useNotebooks } from "~/hooks/useNotebooks"

interface ImportsHubProps {
  onBack: () => void
}

interface DailyUsage {
  date: string
  imports: number
  exports: number
  aiCalls: number
  captures: number
}


const EMPTY_USAGE: DailyUsage = { date: "", imports: 0, exports: 0, aiCalls: 0, captures: 0 }

export function ImportsHub({ onBack }: ImportsHubProps) {
  const [usage, setUsage] = useState<DailyUsage>(EMPTY_USAGE)
  const [expandedNotebook, setExpandedNotebook] = useState<string | null>(null)
  const { notebooks, isLoading } = useNotebooks()

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEYS.DAILY_USAGE, (snap) => {
      const stored = snap[STORAGE_KEYS.DAILY_USAGE] as Partial<DailyUsage> | undefined
      if (stored) setUsage((c) => ({ ...c, ...stored }))
    })

    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local" || !changes[STORAGE_KEYS.DAILY_USAGE]?.newValue) return
      setUsage((c) => ({ ...c, ...changes[STORAGE_KEYS.DAILY_USAGE].newValue }))
    }
    chrome.storage.onChanged.addListener(handler)
    return () => chrome.storage.onChanged.removeListener(handler)
  }, [])

  const totalActivity = usage.imports + usage.captures + usage.exports

  const statItems = [
    { label: "Imports", value: usage.imports, icon: Download, color: "text-yellow-400" },
    { label: "Captures", value: usage.captures, icon: Bot, color: "text-blue-400" },
    { label: "Exports", value: usage.exports, icon: FileDown, color: "text-emerald-400" },
  ]

  return (
    <div className="relative flex h-full flex-col bg-[#050505] text-white">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
        <button
          type="button"
          onClick={onBack}
          className="liquid-glass-soft flex h-7 w-7 items-center justify-center rounded-xl text-zinc-400 transition hover:-translate-y-px hover:text-white">
          <ArrowLeft size={14} strokeWidth={2} />
        </button>
        <div className="flex items-center gap-2">
          <h1 className="text-[13px] font-bold tracking-[-0.03em] text-white">Imports</h1>
          <span className="rounded-md bg-yellow-400/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-yellow-400">
            Today
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {/* Stats row */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="liquid-glass-panel mt-2 rounded-[18px] p-2.5">
          <div className="liquid-glass-content">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                  Total activity
                </p>
                <div className="mt-1 flex items-end gap-2">
                  <span className="text-[24px] font-semibold leading-none tracking-[-0.05em] text-white">
                    {totalActivity}
                  </span>
                  <span className="pb-0.5 text-[11px] text-zinc-400">today</span>
                </div>
              </div>
              <div className="liquid-glass-soft rounded-full px-2.5 py-1">
                <span className="liquid-glass-content text-[9px] font-medium uppercase tracking-[0.14em] text-zinc-300">
                  Live
                </span>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-1.5">
              {statItems.map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="liquid-glass-soft rounded-xl p-2 text-center">
                  <Icon size={12} className={`mx-auto mb-1 ${color}`} strokeWidth={1.8} />
                  <p className="text-[16px] font-semibold leading-none text-white">{value}</p>
                  <p className="mt-0.5 text-[9px] text-zinc-500">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Notebooks section */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, delay: 0.05 }}>
          <div className="mb-1.5 mt-3 flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
              Notebooks
            </span>
            <button
              type="button"
              onClick={() => chrome.tabs.create({ url: URLS.NOTEBOOKLM })}
              className="text-[10px] text-zinc-500 transition hover:text-zinc-300">
              Open NotebookLM
            </button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <div className="h-4 w-4 animate-spin rounded-full border border-zinc-700 border-t-zinc-300" />
            </div>
          ) : notebooks.length === 0 ? (
            <div className="liquid-glass-panel rounded-[18px] p-4 text-center">
              <p className="text-[11px] text-zinc-500">No notebooks found.</p>
              <p className="mt-1 text-[10px] text-zinc-600">Open NotebookLM to load them.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {notebooks.map((notebook, i) => (
                <motion.div
                  key={notebook.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15, delay: 0.06 + i * 0.03 }}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedNotebook((prev) => (prev === notebook.id ? null : notebook.id))
                    }
                    className="liquid-glass-panel flex w-full items-center gap-2.5 rounded-[14px] px-3 py-2.5 text-left transition hover:border-white/[0.1]">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-yellow-400/10">
                      <span className="text-[10px]">📓</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-medium text-white">
                        {notebook.title}
                      </p>
                      <p className="text-[9px] text-zinc-500">
                        {notebook.sourceCount ?? 0} sources
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          chrome.tabs.create({
                            url: `${URLS.NOTEBOOKLM}/notebook/${notebook.id}`
                          })
                        }}
                        className="text-zinc-600 transition hover:text-zinc-300">
                        <ArrowUpRight size={11} strokeWidth={2} />
                      </button>
                      {expandedNotebook === notebook.id ? (
                        <ChevronDown size={11} strokeWidth={2} className="text-zinc-500" />
                      ) : (
                        <ChevronRight size={11} strokeWidth={2} className="text-zinc-500" />
                      )}
                    </div>
                  </button>

                  <AnimatePresence>
                    {expandedNotebook === notebook.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden">
                        <div className="ml-4 mt-1 space-y-1 border-l border-white/[0.06] pl-3">
                          <div className="rounded-xl px-2.5 py-2 text-[10px] text-zinc-500">
                            <p className="text-zinc-400">No import logs yet for this notebook.</p>
                            <p className="mt-0.5 text-zinc-600">
                              Imports will appear here as you add sources.
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
