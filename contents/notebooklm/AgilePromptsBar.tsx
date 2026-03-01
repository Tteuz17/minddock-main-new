/**
 * Prompts Ágeis — design flat, sem glass.
 * Lê o prompt do usuário, gera 3 versões melhoradas via Claude.
 */

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ChevronUp, Sparkles, RefreshCw, Check, Loader2 } from "lucide-react"

// ─── Composer helpers ────────────────────────────────────────────────────────

const COMPOSER_SELECTORS = [
  "textarea",
  "div[contenteditable='true'][role='textbox']",
  "div[contenteditable='true']",
  "input[type='text']"
] as const

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

// ─── Types ───────────────────────────────────────────────────────────────────

interface PromptOption { title: string; prompt: string }
type Phase = "idle" | "loading" | "options" | "done"

// ─── Component ───────────────────────────────────────────────────────────────

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
      const c = resolveActiveComposer()
      setComposer(c)
      const v = readComposerValue(c)
      setCurrentPrompt(v)
      if (!v.trim()) {
        setPhase("idle"); setOptions([]); setAppliedIndex(null); setError(null)
      }
    }
    sync()
    const id = window.setInterval(sync, 220)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return
      setIsExpanded(false)
    }
    document.addEventListener("mousedown", handler, true)
    return () => document.removeEventListener("mousedown", handler, true)
  }, [])

  const visible = !!composer && currentPrompt.trim().length >= 8
  useEffect(() => {
    if (!visible) { setIsExpanded(false); setPhase("idle"); setOptions([]) }
  }, [visible])

  async function generateOptions() {
    if (!currentPrompt.trim() || phase === "loading") return
    setPhase("loading"); setOptions([]); setAppliedIndex(null); setError(null)
    try {
      const res = await chrome.runtime.sendMessage({
        command: "MINDDOCK_PROMPT_OPTIONS",
        payload: { prompt: currentPrompt.trim() }
      })
      if (!res?.success) throw new Error(res?.error ?? "Não foi possível gerar.")
      const opts: PromptOption[] = res?.payload?.options ?? res?.data?.options ?? []
      if (!Array.isArray(opts) || opts.length === 0) throw new Error("Resposta inválida.")
      setOptions(opts); setPhase("options")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao gerar opções.")
      setPhase("idle")
    }
  }

  function applyOption(i: number) {
    if (!composer || !options[i]) return
    writeComposerValue(composer, options[i].prompt)
    setAppliedIndex(i); setPhase("done")
    setTimeout(() => setIsExpanded(false), 800)
  }

  if (!visible) return null

  return (
    <div ref={containerRef} className="flex flex-col items-center gap-0">

      {/* ── Painel ── */}
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

            <div className="rounded-2xl bg-[#0f0f0f] border border-white/10 p-3 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">

              {/* Cabeçalho */}
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Prompts melhorados
                  </p>
                  <p className="text-[10px] text-zinc-400 mt-0.5">
                    3 versões aprimoradas do seu prompt
                  </p>
                </div>
                {(phase === "options" || phase === "done") && (
                  <button
                    type="button"
                    onClick={() => { setPhase("idle"); setOptions([]); setAppliedIndex(null); setError(null); void generateOptions() }}
                    className="flex items-center gap-1 rounded-lg bg-white/5 border border-white/8 px-2 py-1.5 text-[9px] text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
                    <RefreshCw size={9} strokeWidth={2} />
                    Refazer
                  </button>
                )}
              </div>

              {/* Idle */}
              {phase === "idle" && !error && (
                <button
                  type="button"
                  onClick={() => void generateOptions()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#facc15] py-2.5 text-[11px] font-semibold text-black hover:bg-[#fbbf24] transition-colors">
                  <Sparkles size={12} strokeWidth={2} />
                  Melhorar com IA
                </button>
              )}

              {/* Erro */}
              {phase === "idle" && error && (
                <div className="flex flex-col gap-2">
                  <p className="text-[10px] text-red-400">{error}</p>
                  <button
                    type="button"
                    onClick={() => { setError(null); void generateOptions() }}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-white/5 border border-white/8 py-2 text-[10px] text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
                    <RefreshCw size={10} strokeWidth={2} />
                    Tentar novamente
                  </button>
                </div>
              )}

              {/* Loading */}
              {phase === "loading" && (
                <div className="flex items-center justify-center gap-2 py-5">
                  <Loader2 size={13} className="animate-spin text-zinc-500" />
                  <span className="text-[10px] text-zinc-500">Melhorando com IA…</span>
                </div>
              )}

              {/* Opções */}
              {(phase === "options" || phase === "done") && options.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {options.map((opt, i) => {
                    const applied = appliedIndex === i
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => applyOption(i)}
                        className={[
                          "flex items-start justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition-colors",
                          applied
                            ? "bg-[#facc15]/10 border border-[#facc15]/30"
                            : "bg-white/[0.04] border border-white/8 hover:bg-white/[0.07] hover:border-white/12"
                        ].join(" ")}>
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold text-white">{opt.title}</p>
                          <p className="mt-0.5 text-[9px] leading-[1.5] text-zinc-400 line-clamp-2">
                            {opt.prompt}
                          </p>
                        </div>
                        <span className="mt-0.5 shrink-0 text-[9px]">
                          {applied
                            ? <Check size={10} className="text-[#facc15]" />
                            : <span className="text-zinc-600">aplicar</span>}
                        </span>
                      </button>
                    )
                  })}
                  {phase === "done" && (
                    <p className="mt-0.5 text-center text-[9px] text-zinc-600">
                      Prompt colado no chat ✓
                    </p>
                  )}
                </div>
              )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Trigger ── */}
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="flex h-[42px] items-center justify-between gap-3 rounded-[14px] border border-[#eab308] bg-[#facc15] px-3 shadow-[0_8px_24px_rgba(250,204,21,0.25)] hover:bg-[#fbbf24] transition-colors"
        style={{ width: 252 }}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-black/10">
            <Sparkles size={12} strokeWidth={2} className="text-black" />
          </span>
          <span className="truncate text-[11px] font-semibold tracking-[-0.01em] text-black">
            Melhorar prompt com IA
          </span>
        </div>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-black/10">
          <ChevronUp size={13} strokeWidth={2.2} className={`text-black ${isExpanded ? "" : "rotate-180"}`} />
        </span>
      </button>

    </div>
  )
}
