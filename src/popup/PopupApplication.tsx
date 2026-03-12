import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { UserMenu } from "~/popup/components/UserMenu"
import { HomeDashboard } from "~/popup/components/HomeDashboard"
import { ImportsHub } from "~/popup/components/ImportsHub"
import { AgilePromptsHub } from "~/popup/components/AgilePromptsHub"
import { DocksHub } from "~/popup/components/DocksHub"
import { HighlightHub } from "~/popup/components/HighlightHub"
import { useAuth } from "~/hooks/useAuth"
import { AuthScreen } from "~/popup/components/AuthScreen"
import { LoadingSpinner } from "~/components/LoadingSpinner"
import { STORAGE_KEYS } from "~/lib/constants"
import type { SidePanelLaunchTarget } from "~/lib/types"

type PopupView = "home" | "imports" | "agile" | "docks" | "highlights"

export default function PopupApplication() {
  const { isAuthenticated, isLoading } = useAuth()
  const [view, setView] = useState<PopupView>("home")

  const openSidePanel = async (target: SidePanelLaunchTarget) => {
    await chrome.storage.local.set({ [STORAGE_KEYS.SIDEPANEL_VIEW]: target })
    await chrome.sidePanel?.open({ windowId: chrome.windows.WINDOW_ID_CURRENT })
  }

  if (isLoading) {
    return (
      <div className="popup-container flex items-center justify-center">
        <LoadingSpinner size={24} />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <AuthScreen />
  }

  return (
    <div className="popup-container relative bg-[#060606]">
      <AnimatePresence mode="wait">
        {view === "imports" ? (
          <motion.div
            key="imports"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.18 }}
            className="flex h-full flex-col">
            <ImportsHub onBack={() => setView("home")} />
          </motion.div>
        ) : view === "agile" ? (
          <motion.div
            key="agile"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.18 }}
            className="flex h-full flex-col">
            <AgilePromptsHub onBack={() => setView("home")} />
          </motion.div>
        ) : view === "docks" ? (
          <motion.div
            key="docks"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.18 }}
            className="flex h-full flex-col">
            <DocksHub onBack={() => setView("home")} />
          </motion.div>
        ) : view === "highlights" ? (
          <motion.div
            key="highlights"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.18 }}
            className="flex h-full flex-col">
            <HighlightHub onBack={() => setView("home")} />
          </motion.div>
        ) : (
          <motion.div
            key="home"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.18 }}
            className="flex h-full flex-col">
            <HomeDashboard
              onOpenSidePanel={openSidePanel}
              onOpenZettelHub={() => setView("docks")}
            />
            <UserMenu />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
