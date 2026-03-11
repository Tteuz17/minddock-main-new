import "~/styles/globals.css"

import { Suspense, lazy } from "react"
import { LoadingSpinner } from "~/components/LoadingSpinner"
import { registerOffscreenPdfListener } from "~/lib/offscreen-pdf-listener"

const PopupApplication = lazy(() => import("~/popup/PopupApplication"))

export default function Popup() {
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
