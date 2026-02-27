import "~/styles/globals.css"

import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"

import { PopupHeader } from "~/popup/components/PopupHeader"
import { NotebookList } from "~/popup/components/NotebookList"
import { PromptLibrary } from "~/popup/components/PromptLibrary"
import { QuickActions } from "~/popup/components/QuickActions"
import { UserMenu } from "~/popup/components/UserMenu"
import { SearchBar } from "~/popup/components/SearchBar"
import { useAuth } from "~/hooks/useAuth"
import { AuthScreen } from "~/popup/components/AuthScreen"
import { LoadingSpinner } from "~/components/LoadingSpinner"

export type PopupTab = "notebooks" | "prompts" | "actions"

export default function Popup() {
  const { isAuthenticated, isLoading } = useAuth()
  const [activeTab, setActiveTab] = useState<PopupTab>("notebooks")
  const [searchQuery, setSearchQuery] = useState("")

  // Abre o side panel do Zettelkasten
  const openSidePanel = () => {
    chrome.sidePanel?.open({ windowId: chrome.windows.WINDOW_ID_CURRENT })
  }

  if (isLoading) {
    return (
      <div className="popup-container items-center justify-center flex">
        <LoadingSpinner size={24} />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <AuthScreen />
  }

  return (
    <div className="popup-container">
      {/* Header */}
      <PopupHeader onOpenSidePanel={openSidePanel} />

      {/* Search */}
      <div className="px-3 pt-3 pb-2">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Buscar notebooks, fontes, prompts..."
        />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/8 px-3">
        {(["notebooks", "prompts", "actions"] as PopupTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              "flex-1 py-2.5 text-xs font-medium capitalize transition-all duration-200",
              activeTab === tab
                ? "text-action border-b-2 border-action -mb-px"
                : "text-text-secondary hover:text-white"
            ].join(" ")}>
            {tab === "notebooks" ? "Notebooks" : tab === "prompts" ? "Prompts" : "Ações"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <AnimatePresence mode="wait">
          {activeTab === "notebooks" && (
            <motion.div
              key="notebooks"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}>
              <NotebookList searchQuery={searchQuery} />
            </motion.div>
          )}
          {activeTab === "prompts" && (
            <motion.div
              key="prompts"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}>
              <PromptLibrary searchQuery={searchQuery} />
            </motion.div>
          )}
          {activeTab === "actions" && (
            <motion.div
              key="actions"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}>
              <QuickActions />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <UserMenu />
    </div>
  )
}
