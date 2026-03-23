import { useState, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  ArrowLeft,
  NotebookPen,
  Sparkles,
  Network
} from "lucide-react"

import { useSubscription } from "~/hooks/useSubscription"
import { ZettelNoteList } from "./zettel/ZettelNoteList"
import { ZettelNoteDetail } from "./zettel/ZettelNoteDetail"
import { ZettelMaker } from "./zettel/ZettelMaker"
import { ZettelCanvas } from "./zettel/ZettelCanvas"

type ZettelTab = "notes" | "maker" | "canvas"

interface ZettelHubProps {
  onBack: () => void
}

const TABS: Array<{ id: ZettelTab; label: string; icon: typeof NotebookPen }> = [
  { id: "notes", label: "Notes", icon: NotebookPen },
  { id: "maker", label: "Maker", icon: Sparkles },
  { id: "canvas", label: "Canvas", icon: Network }
]

export function ZettelHub({ onBack }: ZettelHubProps) {
  const { canUse } = useSubscription()
  const [activeTab, setActiveTab] = useState<ZettelTab>("notes")
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)

  const hasAccess = canUse("zettelkasten")

  const handleSelectNote = useCallback((noteId: string) => {
    setSelectedNoteId(noteId)
  }, [])

  const handleBackFromDetail = useCallback(() => {
    setSelectedNoteId(null)
  }, [])

  if (!hasAccess) {
    return (
      <div className="relative flex h-full flex-col bg-[#050505] text-white">
        <Header onBack={onBack} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
          <div className="liquid-glass-soft flex h-12 w-12 items-center justify-center rounded-2xl">
            <NotebookPen size={20} className="text-action" />
          </div>
          <p className="text-center text-[13px] font-medium text-white">
            Notes Hub
          </p>
          <p className="text-center text-[11px] text-zinc-400">
            This feature requires the Thinker plan or higher.
          </p>
          <button
            type="button"
            onClick={() => chrome.runtime.openOptionsPage()}
            className="mt-2 rounded-xl bg-action/90 px-4 py-2 text-[11px] font-semibold text-black transition hover:bg-action">
            View plans
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-full flex-col bg-[#050505] text-white">
      <Header onBack={onBack} />

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-white/[0.04] px-3 pb-1">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id)
                if (tab.id !== "notes") setSelectedNoteId(null)
              }}
              className={[
                "relative flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-medium transition-all",
                isActive
                  ? "text-action"
                  : "text-zinc-500 hover:text-zinc-300"
              ].join(" ")}>
              <Icon size={12} strokeWidth={isActive ? 2.2 : 1.6} />
              <span>{tab.label}</span>
              {isActive && (
                <motion.div
                  className="absolute -bottom-1 left-2 right-2 h-[2px] rounded-full bg-action"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* Content area */}
      <div className="relative flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {/* Note detail overlay */}
          {selectedNoteId && activeTab === "notes" ? (
            <motion.div
              key="note-detail"
              initial={{ x: "100%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="absolute inset-0 z-10 bg-[#050505]">
              <ZettelNoteDetail
                noteId={selectedNoteId}
                onBack={handleBackFromDetail}
              />
            </motion.div>
          ) : (
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              className="h-full">
              {activeTab === "notes" && (
                <ZettelNoteList onSelectNote={handleSelectNote} />
              )}
              {activeTab === "maker" && <ZettelMaker />}
              {activeTab === "canvas" && <ZettelCanvas />}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
      <button
        type="button"
        onClick={onBack}
        className="liquid-glass-soft flex h-7 w-7 items-center justify-center rounded-xl text-zinc-400 transition hover:-translate-y-px hover:text-white">
        <ArrowLeft size={14} strokeWidth={2} />
      </button>
      <div className="flex items-center gap-2">
        <h1 className="text-[13px] font-bold tracking-[-0.03em] text-white">
          Notes Hub
        </h1>
        <span className="rounded-md bg-action/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-action">
          AI
        </span>
      </div>
    </div>
  )
}
