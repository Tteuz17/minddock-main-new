/**
 * Toggle flutuante do MindDock injetado no NotebookLM.
 * Liga/desliga todos os elementos de UI do MindDock na página.
 */

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { STORAGE_KEYS } from "~/lib/constants"

const HIDE_STYLE_ID = "minddock-global-visibility-override"

const HIDDEN_CSS = `
  #minddock-agile-bar-root,
  #minddock-source-actions-root,
  #minddock-source-filters-root {
    opacity: 0 !important;
    pointer-events: none !important;
    transform: scale(0.96) !important;
    transition: opacity 0.25s ease, transform 0.25s ease !important;
  }
  [data-minddock="true"] {
    display: none !important;
  }
`

function applyVisibility(enabled: boolean) {
  const existing = document.getElementById(HIDE_STYLE_ID)
  if (enabled) {
    existing?.remove()
  } else if (!existing) {
    const style = document.createElement("style")
    style.id = HIDE_STYLE_ID
    style.textContent = HIDDEN_CSS
    document.head.appendChild(style)
  }
}

export function MindDockToggle() {
  const [enabled, setEnabled] = useState(true)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    let cancelled = false

    chrome.storage.local.get(STORAGE_KEYS.NOTEBOOKLM_UI_ENABLED, (snapshot) => {
      if (cancelled) return

      const stored = snapshot[STORAGE_KEYS.NOTEBOOKLM_UI_ENABLED]
      const initial = typeof stored === "boolean" ? stored : true
      setEnabled(initial)

      // Delay para aguardar outros componentes montarem
      window.setTimeout(() => applyVisibility(initial), 400)
    })

    const handleStorage = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local" || !changes[STORAGE_KEYS.NOTEBOOKLM_UI_ENABLED]) {
        return
      }

      const nextValue = changes[STORAGE_KEYS.NOTEBOOKLM_UI_ENABLED].newValue
      const nextEnabled = typeof nextValue === "boolean" ? nextValue : true
      setEnabled(nextEnabled)
      applyVisibility(nextEnabled)
    }

    chrome.storage.onChanged.addListener(handleStorage)

    return () => {
      cancelled = true
      chrome.storage.onChanged.removeListener(handleStorage)
    }
  }, [])

  function toggle() {
    const next = !enabled
    setEnabled(next)
    void chrome.storage.local.set({ [STORAGE_KEYS.NOTEBOOKLM_UI_ENABLED]: next })
    applyVisibility(next)
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 24, scale: 0.88 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ delay: 0.6, type: "spring", stiffness: 260, damping: 22 }}>

      <motion.button
        onClick={toggle}
        onHoverStart={() => setHovered(true)}
        onHoverEnd={() => setHovered(false)}
        whileTap={{ scale: 0.94 }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "8px 12px 8px 10px",
          borderRadius: "14px",
          background: "rgba(0, 0, 0, 0.92)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: enabled
            ? "1px solid rgba(250, 204, 21, 0.35)"
            : "1px solid rgba(255, 255, 255, 0.13)",
          boxShadow: enabled
            ? "0 0 0 1px rgba(250,204,21,0.08), 0 8px 32px rgba(0,0,0,0.7), 0 0 24px rgba(250,204,21,0.08)"
            : "0 8px 32px rgba(0,0,0,0.6)",
          cursor: "pointer",
          outline: "none",
          transition: "border 0.3s ease, box-shadow 0.3s ease",
          userSelect: "none",
        }}>

        {/* Logo M */}
        <motion.div
          animate={{
            background: enabled ? "#facc15" : "rgba(255,255,255,0.07)",
            boxShadow: enabled
              ? "0 0 10px rgba(250,204,21,0.5)"
              : "none"
          }}
          transition={{ duration: 0.3 }}
          style={{
            width: "24px",
            height: "24px",
            borderRadius: "7px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            border: enabled ? "none" : "1px solid rgba(255,255,255,0.12)",
          }}>
          <span style={{
            color: enabled ? "#000" : "rgba(255,255,255,0.35)",
            fontSize: "13px",
            fontWeight: "800",
            lineHeight: 1,
            fontFamily: "Inter, system-ui, sans-serif",
            transition: "color 0.3s ease",
          }}>
            M
          </span>
        </motion.div>

        {/* Label */}
        <AnimatePresence>
          {(enabled || hovered) && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.2 }}
              style={{
                fontSize: "12px",
                fontWeight: "500",
                color: enabled ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.35)",
                fontFamily: "Inter, system-ui, sans-serif",
                letterSpacing: "0.01em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                transition: "color 0.3s ease",
              }}>
              MindDock
            </motion.span>
          )}
        </AnimatePresence>

        {/* Toggle switch */}
        <motion.div
          animate={{
            background: enabled
              ? "rgba(250, 204, 21, 0.18)"
              : "rgba(255,255,255,0.06)",
            borderColor: enabled
              ? "rgba(250, 204, 21, 0.45)"
              : "rgba(255,255,255,0.14)"
          }}
          transition={{ duration: 0.25 }}
          style={{
            width: "34px",
            height: "19px",
            borderRadius: "100px",
            border: "1px solid",
            position: "relative",
            flexShrink: 0,
          }}>
          <motion.div
            animate={{
              x: enabled ? 16 : 2,
              background: enabled ? "#facc15" : "rgba(255,255,255,0.28)",
              boxShadow: enabled
                ? "0 0 6px rgba(250,204,21,0.7)"
                : "none",
            }}
            transition={{ type: "spring", stiffness: 420, damping: 28 }}
            style={{
              position: "absolute",
              top: "2.5px",
              width: "12px",
              height: "12px",
              borderRadius: "50%",
            }}
          />
        </motion.div>
      </motion.button>
    </motion.div>
  )
}
