import "~/styles/globals.css"

import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Network, StickyNote, Tag, Search } from "lucide-react"

import { NoteList } from "~/sidepanel/components/NoteList"
import { NoteEditor } from "~/sidepanel/components/NoteEditor"
import { GraphView } from "~/sidepanel/components/GraphView"
import { TagManager } from "~/sidepanel/components/TagManager"
import { useAuth } from "~/hooks/useAuth"
import { AuthScreen } from "~/popup/components/AuthScreen"
import { LoadingSpinner } from "~/components/LoadingSpinner"
import { useSubscription } from "~/hooks/useSubscription"
import { UpgradePrompt } from "~/components/UpgradePrompt"

export type SidePanelTab = "notes" | "graph" | "tags"

export default function SidePanel() {
  const { isAuthenticated, isLoading } = useAuth()
  const { canUse } = useSubscription()
  const [activeTab, setActiveTab] = useState<SidePanelTab>("notes")
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)

  if (isLoading) {
    return (
      <div className="sidepanel-container items-center justify-center flex">
        <LoadingSpinner size={24} />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <AuthScreen compact />
  }

  if (!canUse("zettelkasten")) {
    return <UpgradePrompt feature="Zettelkasten" requiredTier="thinker" />
  }

  const tabs = [
    { id: "notes" as const, icon: StickyNote, label: "Notas" },
    { id: "graph" as const, icon: Network, label: "Grafo" },
    { id: "tags" as const, icon: Tag, label: "Tags" }
  ]

  return (
    <div className="sidepanel-container">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded bg-action flex items-center justify-center">
            <span className="text-black text-xs font-bold">M</span>
          </div>
          <span className="text-sm font-semibold">Zettelkasten</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/8">
        {tabs.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => {
              setActiveTab(id)
              setIsEditing(false)
            }}
            className={[
              "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-all",
              activeTab === id
                ? "text-action border-b-2 border-action -mb-px"
                : "text-text-secondary hover:text-white"
            ].join(" ")}>
            <Icon size={13} strokeWidth={1.5} />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {activeTab === "notes" && !isEditing && (
            <motion.div
              key="note-list"
              className="h-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}>
              <NoteList
                onSelectNote={(id) => {
                  setSelectedNoteId(id)
                  setIsEditing(true)
                }}
                onCreateNote={() => {
                  setSelectedNoteId(null)
                  setIsEditing(true)
                }}
              />
            </motion.div>
          )}

          {activeTab === "notes" && isEditing && (
            <motion.div
              key="note-editor"
              className="h-full"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}>
              <NoteEditor
                noteId={selectedNoteId}
                onBack={() => {
                  setIsEditing(false)
                  setSelectedNoteId(null)
                }}
              />
            </motion.div>
          )}

          {activeTab === "graph" && (
            <motion.div
              key="graph"
              className="h-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}>
              <GraphView onSelectNote={(id) => {
                setSelectedNoteId(id)
                setActiveTab("notes")
                setIsEditing(true)
              }} />
            </motion.div>
          )}

          {activeTab === "tags" && (
            <motion.div
              key="tags"
              className="h-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}>
              <TagManager />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
