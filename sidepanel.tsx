import "~/styles/globals.css"

import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Network, StickyNote, Tag } from "lucide-react"

import { NoteList } from "~/sidepanel/components/NoteList"
import { NoteEditor } from "~/sidepanel/components/NoteEditor"
import { GraphView } from "~/sidepanel/components/GraphView"
import { TagManager } from "~/sidepanel/components/TagManager"
import { useAuth } from "~/hooks/useAuth"
import { AuthScreen } from "~/popup/components/AuthScreen"
import { LoadingSpinner } from "~/components/LoadingSpinner"
import { useSubscription } from "~/hooks/useSubscription"
import { UpgradePrompt } from "~/components/UpgradePrompt"
import { STORAGE_KEYS } from "~/lib/constants"
import type { SidePanelLaunchTarget } from "~/lib/types"

export type SidePanelTab = "notes" | "graph" | "tags"
type NoteDraftMode = "blank" | "link"

export default function SidePanel() {
  const { isAuthenticated, isLoading } = useAuth()
  const { canUse } = useSubscription()
  const [activeTab, setActiveTab] = useState<SidePanelTab>("notes")
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [draftMode, setDraftMode] = useState<NoteDraftMode>("blank")

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEYS.SIDEPANEL_VIEW, (snapshot) => {
      const target = snapshot[STORAGE_KEYS.SIDEPANEL_VIEW] as SidePanelLaunchTarget | undefined
      if (!target) return

      switch (target) {
        case "graph":
          setActiveTab("graph")
          setIsEditing(false)
          setSelectedNoteId(null)
          setDraftMode("blank")
          break
        case "create_note":
          setActiveTab("notes")
          setIsEditing(true)
          setSelectedNoteId(null)
          setDraftMode("blank")
          break
        case "link_note":
          setActiveTab("notes")
          setIsEditing(true)
          setSelectedNoteId(null)
          setDraftMode("link")
          break
        case "notes":
        default:
          setActiveTab("notes")
          setIsEditing(false)
          setSelectedNoteId(null)
          setDraftMode("blank")
          break
      }

      chrome.storage.local.remove(STORAGE_KEYS.SIDEPANEL_VIEW)
    })
  }, [])

  if (isLoading) {
    return (
      <div className="sidepanel-container flex items-center justify-center">
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
      <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
        <div className="flex items-center gap-1.5">
          <div className="flex h-5 w-5 items-center justify-center rounded bg-action">
            <span className="text-xs font-bold text-black">M</span>
          </div>
          <span className="text-sm font-semibold">Zettelkasten</span>
        </div>
      </div>

      <div className="flex border-b border-white/8">
        {tabs.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => {
              setActiveTab(id)
              setIsEditing(false)
              setSelectedNoteId(null)
              setDraftMode("blank")
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
                  setDraftMode("blank")
                }}
                onCreateNote={() => {
                  setSelectedNoteId(null)
                  setIsEditing(true)
                  setDraftMode("blank")
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
                draftMode={draftMode}
                onBack={() => {
                  setIsEditing(false)
                  setSelectedNoteId(null)
                  setDraftMode("blank")
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
              <GraphView
                onSelectNote={(id) => {
                  setSelectedNoteId(id)
                  setActiveTab("notes")
                  setIsEditing(true)
                  setDraftMode("blank")
                }}
              />
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
