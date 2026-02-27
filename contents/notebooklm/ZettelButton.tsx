/**
 * Botão "Atomizar" injetado nas respostas do NotebookLM.
 * Envia o texto pro Claude API para dividir em notas atômicas.
 */

import { useState } from "react"
import { Atom, Loader2 } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

interface ZettelButtonProps {
  content: string
}

export function ZettelButton({ content }: ZettelButtonProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleAtomize() {
    if (isLoading || done) return
    setIsLoading(true)

    try {
      const response = await chrome.runtime.sendMessage({
        command: "MINDDOCK_ATOMIZE_NOTE",
        payload: { content }
      })

      if (response?.success) {
        setDone(true)
        setTimeout(() => setDone(false), 3000)
      }
    } catch (err) {
      console.error("[MindDock] Erro ao atomizar:", err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <button
      onClick={handleAtomize}
      disabled={isLoading}
      title="Atomizar em notas Zettelkasten"
      className={[
        "inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all",
        done
          ? "bg-success/15 text-success"
          : "bg-white/5 text-text-secondary hover:bg-action/15 hover:text-action border border-white/8"
      ].join(" ")}>
      {isLoading ? (
        <Loader2 size={11} strokeWidth={1.5} className="animate-spin" />
      ) : (
        <Atom size={11} strokeWidth={1.5} />
      )}
      {done ? "Salvo!" : "Atomizar"}
    </button>
  )
}
