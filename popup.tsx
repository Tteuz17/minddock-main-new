import "~/styles/globals.css"

import { Suspense, lazy, useEffect } from "react"
import { LoadingSpinner } from "~/components/LoadingSpinner"
import { registerOffscreenPdfListener } from "~/lib/offscreen-pdf-listener"

const PopupApplication = lazy(() => import("~/popup/PopupApplication"))
const POPUP_LOCK_CLASS = "minddock-popup-shell"

export default function Popup() {
  useEffect(() => {
    document.documentElement.classList.add(POPUP_LOCK_CLASS)
    document.body.classList.add(POPUP_LOCK_CLASS)

    return () => {
      document.documentElement.classList.remove(POPUP_LOCK_CLASS)
      document.body.classList.remove(POPUP_LOCK_CLASS)
    }
  }, [])

  if (isOffscreenPdfContext()) {
    registerOffscreenPdfListener()
    return null
  }

  return (
    <Suspense
      fallback={
        <div className="popup-container flex items-center justify-center">
          <LoadingSpinner size={24} />
        </div>
      }>
      <PopupApplication />
    </Suspense>
  )
}

function isOffscreenPdfContext(): boolean {
  if (typeof window === "undefined") {
    return false
  }

  const searchParams = new URLSearchParams(window.location.search)
  return searchParams.get("minddock_offscreen") === "1"
}
