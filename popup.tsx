import "~/styles/globals.css"

import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"

import { UserMenu } from "~/popup/components/UserMenu"
import { HomeDashboard } from "~/popup/components/HomeDashboard"
import { ZettelHub } from "~/popup/components/ZettelHub"
import { useAuth } from "~/hooks/useAuth"
import { AuthScreen } from "~/popup/components/AuthScreen"
import { LoadingSpinner } from "~/components/LoadingSpinner"
import { STORAGE_KEYS } from "~/lib/constants"
import type { SidePanelLaunchTarget } from "~/lib/types"

export default function Popup() {
  const { isAuthenticated, isLoading } = useAuth()
  const [isZettelHubOpen, setIsZettelHubOpen] = useState(false)

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
        {isZettelHubOpen ? (
          <motion.div
            key="zettel-hub"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.18 }}
            className="flex h-full flex-col">
            <ZettelHub onBack={() => setIsZettelHubOpen(false)} />
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
              onOpenZettelHub={() => setIsZettelHubOpen(true)}
            />
            <UserMenu />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
