/**
 * Barra flutuante de Prompts Ágeis injetada no NotebookLM.
 * Aparece na parte inferior da tela, centralizada.
 */

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronUp, ChevronDown, Zap, Lock } from "lucide-react"
import { AGILE_PROMPTS } from "~/lib/constants"
import { useSubscription } from "~/hooks/useSubscription"

export function AgilePromptsBar() {
  const [isExpanded, setIsExpanded] = useState(true)
  const { tier } = useSubscription()

  const isPro = tier === "pro" || tier === "thinker" || tier === "thinker_pro"

  function injectPrompt(prompt: string) {
    // Tenta encontrar o input do chat do NotebookLM
    const selectors = [
      "textarea[placeholder]",
      "[contenteditable='true']",
      "input[type='text']"
    ]

    let inputEl: HTMLElement | null = null
    for (const sel of selectors) {
      const el = document.querySelector(sel) as HTMLElement
      if (el && el.offsetParent !== null) {
        inputEl = el
        break
      }
    }

    if (!inputEl) {
      console.warn("[MindDock] Input do chat não encontrado.")
      return
    }

    // Seta o valor e dispara eventos para o React/Angular detectar
    const nativeInputSetter = Object.getOwnPropertyDescriptor(
      inputEl.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value"
    )?.set

    if (nativeInputSetter && inputEl instanceof HTMLInputElement) {
      nativeInputSetter.call(inputEl, prompt)
    } else {
      inputEl.textContent = prompt
    }

    inputEl.dispatchEvent(new Event("input", { bubbles: true }))
    inputEl.dispatchEvent(new Event("change", { bubbles: true }))
    inputEl.focus()

    // Tenta submeter automaticamente após 100ms
    setTimeout(() => {
      const submitBtn = document.querySelector(
        "button[type='submit'], button[aria-label*='Send'], button[aria-label*='Enviar']"
      ) as HTMLButtonElement

      submitBtn?.click()
    }, 100)
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Toggle */}
      <button
        onClick={() => setIsExpanded((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass border border-white/10 text-xs text-text-secondary hover:text-white transition-all shadow-elevation-2">
        <Zap size={11} strokeWidth={1.5} className="text-action" />
        Prompts Ágeis
        {isExpanded ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
      </button>

      {/* Prompt buttons */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            className="flex flex-wrap items-center justify-center gap-1.5 glass rounded-xl px-3 py-2.5 shadow-elevation-2 max-w-2xl border border-white/8">
            {AGILE_PROMPTS.map((p) => {
              const locked = !isPro
              return (
                <button
                  key={p.key}
                  onClick={() => !locked && injectPrompt(p.prompt)}
                  title={locked ? "Requer plano Pro ou superior" : p.label}
                  className={[
                    "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all",
                    locked
                      ? "opacity-50 cursor-not-allowed text-text-tertiary"
                      : "text-text-secondary hover:text-white hover:bg-white/8 cursor-pointer"
                  ].join(" ")}>
                  <span>{p.icon}</span>
                  <span>{p.label}</span>
                  {locked && <Lock size={9} strokeWidth={1.5} />}
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
