/**
 * Agile Prompts - flat UI, no glass.
 * Reads the user's prompt and generates 3 improved versions via Claude.
 */

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, ChevronUp, Loader2, RefreshCw, Sparkles } from "lucide-react"

const COMPOSER_SELECTORS = [
  "textarea",
  "div[contenteditable='true'][role='textbox']",
  "div[contenteditable='true']",
  "input[type='text']"
] as const

const MINDDOCK_LOGO_SRC = new URL(
  "../../public/images/logo/logo minddock sem fundo.png",
  import.meta.url
).href

function isVisibleElement(el: HTMLElement): boolean {
  if (!el.isConnected || el.offsetParent === null) return false
  const s = window.getComputedStyle(el)
  if (s.visibility === "hidden" || s.display === "none") return false
  const r = el.getBoundingClientRect()
  return r.width > 40 && r.height > 18
}

function resolveActiveComposer(): HTMLElement | null {
  let best: HTMLElement | null = null
  for (const sel of COMPOSER_SELECTORS) {
    for (const node of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      if (!isVisibleElement(node)) continue
      const r = node.getBoundingClientRect()
      if (r.top < window.innerHeight * 0.35) continue
      if (!best || r.top > best.getBoundingClientRect().top) best = node
    }
  }
  return best
}

function readComposerValue(el: HTMLElement | null): string {
  if (!el) return ""
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value ?? ""
  return el.textContent ?? ""
}

function focusEditable(el: HTMLElement): void {
  el.focus()
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
}

function writeComposerValue(el: HTMLElement, value: string): void {
  if (el instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
    setter ? setter.call(el, value) : (el.value = value)
  } else if (el instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    setter ? setter.call(el, value) : (el.value = value)
  } else {
    el.textContent = value
  }
  el.dispatchEvent(new Event("input", { bubbles: true }))
  el.dispatchEvent(new Event("change", { bubbles: true }))
  focusEditable(el)
}

interface PromptOption {
  title: string
  prompt: string
}

type Phase = "idle" | "loading" | "options" | "done"

export function AgilePromptsBar() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [composer, setComposer] = useState<HTMLElement | null>(null)
  const [currentPrompt, setCurrentPrompt] = useState("")
  const [isExpanded, setIsExpanded] = useState(false)
  const [phase, setPhase] = useState<Phase>("idle")
  const [options, setOptions] = useState<PromptOption[]>([])
  const [appliedIndex, setAppliedIndex] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const sync = () => {
      const nextComposer = resolveActiveComposer()
      setComposer(nextComposer)
      const value = readComposerValue(nextComposer)
      setCurrentPrompt(value)
      if (!value.trim()) {
        setPhase("idle")
        setOptions([])
        setAppliedIndex(null)
        setError(null)
      }
    }

    sync()
    const id = window.setInterval(sync, 220)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return
      setIsExpanded(false)
    }

    document.addEventListener("mousedown", handler, true)
    return () => document.removeEventListener("mousedown", handler, true)
  }, [])

  const visible = !!composer && currentPrompt.trim().length >= 8

  useEffect(() => {
    if (!visible) {
      setIsExpanded(false)
      setPhase("idle")
      setOptions([])
    }
  }, [visible])

  async function generateOptions() {
    if (!currentPrompt.trim() || phase === "loading") return

    setPhase("loading")
    setOptions([])
    setAppliedIndex(null)
    setError(null)

    try {
      const res = await chrome.runtime.sendMessage({
        command: "MINDDOCK_PROMPT_OPTIONS",
        payload: { prompt: currentPrompt.trim() }
      })

      if (!res?.success) {
        throw new Error(res?.error ?? "Unable to generate options.")
      }

      const nextOptions: PromptOption[] = res?.payload?.options ?? res?.data?.options ?? []
      if (!Array.isArray(nextOptions) || nextOptions.length === 0) {
        throw new Error("Invalid response.")
      }

      setOptions(nextOptions)
      setPhase("options")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate options.")
      setPhase("idle")
    }
  }

  function applyOption(index: number) {
    if (!composer || !options[index]) return
    writeComposerValue(composer, options[index].prompt)
    setAppliedIndex(index)
    setPhase("done")
    setTimeout(() => setIsExpanded(false), 800)
  }

  if (!visible) return null

  return (
    <div ref={containerRef} className="flex flex-col items-center gap-0">
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.16 }}
            className="mb-2"
            style={{ width: 300 }}>
            <div className="rounded-2xl border border-white/10 bg-[#0f0f0f] p-3 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Improved prompts
                  </p>
                  <p className="mt-0.5 text-[10px] text-zinc-400">
                    3 improved versions of your prompt
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <img
                    src={MINDDOCK_LOGO_SRC}
                    alt="MindDock"
                    className="h-3 w-auto shrink-0 opacity-75"
                  />
                  {(phase === "options" || phase === "done") && (
                    <button
                      type="button"
                      onClick={() => {
                        setPhase("idle")
                        setOptions([])
                        setAppliedIndex(null)
                        setError(null)
                        void generateOptions()
                      }}
                      className="flex items-center gap-1 rounded-lg border border-white/8 bg-white/5 px-2 py-1.5 text-[9px] text-zinc-400 transition-colors hover:bg-white/10 hover:text-white">
                      <RefreshCw size={9} strokeWidth={2} />
                      Retry
                    </button>
                  )}
                </div>
              </div>

              {phase === "idle" && !error && (
                <button
                  type="button"
                  onClick={() => void generateOptions()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#facc15] py-2.5 text-[11px] font-semibold text-black transition-colors hover:bg-[#fbbf24]">
                  <Sparkles size={12} strokeWidth={2} />
                  Improve with AI
                </button>
              )}

              {phase === "idle" && error && (
                <div className="flex flex-col gap-2">
                  <p className="text-[10px] text-red-400">{error}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null)
                      void generateOptions()
                    }}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/8 bg-white/5 py-2 text-[10px] text-zinc-400 transition-colors hover:bg-white/10 hover:text-white">
                    <RefreshCw size={10} strokeWidth={2} />
                    Try again
                  </button>
                </div>
              )}

              {phase === "loading" && (
                <div className="flex items-center justify-center gap-2 py-5">
                  <Loader2 size={13} className="animate-spin text-zinc-500" />
                  <span className="text-[10px] text-zinc-500">Improving with AI...</span>
                </div>
              )}

              {(phase === "options" || phase === "done") && options.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {options.map((opt, index) => {
                    const applied = appliedIndex === index
                    return (
                      <button
                        key={index}
                        type="button"
                        onClick={() => applyOption(index)}
                        className={[
                          "flex items-start justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition-colors",
                          applied
                            ? "border border-[#facc15]/30 bg-[#facc15]/10"
                            : "border border-white/8 bg-white/[0.04] hover:border-white/12 hover:bg-white/[0.07]"
                        ].join(" ")}>
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold text-white">{opt.title}</p>
                          <p className="mt-0.5 line-clamp-2 text-[9px] leading-[1.5] text-zinc-400">
                            {opt.prompt}
                          </p>
                        </div>
                        <span className="mt-0.5 shrink-0 text-[9px]">
                          {applied ? (
                            <Check size={10} className="text-[#facc15]" />
                          ) : (
                            <span className="text-zinc-600">apply</span>
                          )}
                        </span>
                      </button>
                    )
                  })}

                  {phase === "done" && (
                    <p className="mt-0.5 text-center text-[9px] text-zinc-600">
                      Prompt pasted into chat
                    </p>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setIsExpanded((value) => !value)}
        className="flex h-[42px] items-center justify-between gap-3 rounded-[14px] border border-[#eab308] bg-[#facc15] px-3 shadow-[0_8px_24px_rgba(250,204,21,0.25)] transition-colors hover:bg-[#fbbf24]"
        style={{ width: 252 }}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-black/10">
            <Sparkles size={12} strokeWidth={2} className="text-black" />
          </span>
          <span className="truncate text-[11px] font-semibold tracking-[-0.01em] text-black">
            Improve prompt with AI
          </span>
        </div>

        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-black/10">
          <ChevronUp
            size={13}
            strokeWidth={2.2}
            className={`text-black ${isExpanded ? "" : "rotate-180"}`}
          />
        </span>
      </button>
    </div>
  )
}
