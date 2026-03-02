import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ChevronUp, Sparkles, Wand2 } from "lucide-react"

import { useSubscription } from "~/hooks/useSubscription"

const COMPOSER_SELECTORS = [
  "textarea",
  "div[contenteditable='true'][role='textbox']",
  "div[contenteditable='true']",
  "input[type='text']"
] as const

const PANEL_WIDTH = 280
const TRIGGER_WIDTH = 252
const TRIGGER_HEIGHT = 42
const BUBBLE_GAP = 14

interface PromptSuggestion {
  key: string
  label: string
  hint: string
  suffix: string
}

function isVisibleElement(element: HTMLElement): boolean {
  if (!element.isConnected || element.offsetParent === null) {
    return false
  }

  const style = window.getComputedStyle(element)
  if (style.visibility === "hidden" || style.display === "none") {
    return false
  }

  const rect = element.getBoundingClientRect()
  return rect.width > 40 && rect.height > 18
}

function resolveActiveComposer(): HTMLElement | null {
  let bestCandidate: HTMLElement | null = null

  for (const selector of COMPOSER_SELECTORS) {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector))

    for (const node of nodes) {
      if (!isVisibleElement(node)) {
        continue
      }

      const rect = node.getBoundingClientRect()
      if (rect.top < window.innerHeight * 0.35) {
        continue
      }

      if (!bestCandidate || rect.top > bestCandidate.getBoundingClientRect().top) {
        bestCandidate = node
      }
    }
  }

  return bestCandidate
}

function readComposerValue(element: HTMLElement | null): string {
  if (!element) return ""

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value ?? ""
  }

  return element.textContent ?? ""
}

function focusEditable(element: HTMLElement): void {
  element.focus()

  if (!(element instanceof HTMLTextAreaElement) && !(element instanceof HTMLInputElement)) {
    const selection = window.getSelection()
    if (!selection) return

    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }
}

function writeComposerValue(element: HTMLElement, nextValue: string): void {
  if (element instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set
    setter ? setter.call(element, nextValue) : (element.value = nextValue)
  } else if (element instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    setter ? setter.call(element, nextValue) : (element.value = nextValue)
  } else {
    element.textContent = nextValue
  }

  element.dispatchEvent(new Event("input", { bubbles: true }))
  element.dispatchEvent(new Event("change", { bubbles: true }))
  focusEditable(element)
}

function buildSuggestions(prompt: string): PromptSuggestion[] {
  const normalized = prompt.toLowerCase()
  const suggestions: PromptSuggestion[] = []

  if (prompt.trim().length < 70) {
    suggestions.push({
      key: "context",
      label: "Add context",
      hint: "Clarify the scenario to reduce vague answers.",
      suffix:
        "\n\nContext: consider the topic, the notebook sources, and the final goal before answering."
    })
  }

  if (!/(topics|table|step by step|format|markdown|list|outline|topicos|tabela|passo a passo|formato|lista|quadro)/.test(normalized)) {
    suggestions.push({
      key: "format",
      label: "Define format",
      hint: "Ask for a more predictable output structure.",
      suffix:
        "\n\nOutput format: answer in short bullet points, with clear subheadings and a final conclusion."
    })
  }

  if (!/(criteria|priority|compare|difference|advantage|disadvantage|evidence|criterio|priori|diferenca|vantagem|desvantagem|evidencia)/.test(normalized)) {
    suggestions.push({
      key: "criteria",
      label: "Add criteria",
      hint: "Push NotebookLM to prioritize quality and accuracy.",
      suffix:
        "\n\nCriteria: prioritize accuracy, use evidence from the sources, and highlight divergences when they exist."
    })
  }

  if (!/(example|examples|use case|practical|apply|real world|exemplo|caso pratico|aplique|na pratica)/.test(normalized)) {
    suggestions.push({
      key: "examples",
      label: "Ask for examples",
      hint: "Make the answer more practical and useful.",
      suffix: "\n\nInclude practical examples and real-world applications at the end of the answer."
    })
  }

  if (suggestions.length === 0) {
    suggestions.push({
      key: "depth",
      label: "Ask for more depth",
      hint: "Make the answer more useful for study and research.",
      suffix:
        "\n\nGo deeper in the answer, organize it in steps, and highlight critical points for study."
    })
  }

  return suggestions.slice(0, 3)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function PromptCoachBubble() {
  const { isThinker } = useSubscription()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [composer, setComposer] = useState<HTMLElement | null>(null)
  const [prompt, setPrompt] = useState("")
  const [bubbleStyle, setBubbleStyle] = useState<{ left: number; top: number }>({
    left: 16,
    top: 16
  })
  const [isExpanded, setIsExpanded] = useState(false)
  const [isImproving, setIsImproving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    let feedbackTimer: number | null = null

    const syncState = () => {
      const activeComposer = resolveActiveComposer()
      setComposer(activeComposer)
      setPrompt(readComposerValue(activeComposer))

      if (!activeComposer) {
        return
      }

      const rect = activeComposer.getBoundingClientRect()
      const left = clamp(rect.right - TRIGGER_WIDTH, 16, window.innerWidth - TRIGGER_WIDTH - 16)
      const top = Math.max(16, rect.top - TRIGGER_HEIGHT - BUBBLE_GAP)
      setBubbleStyle({ left, top })
    }

    syncState()

    const intervalId = window.setInterval(syncState, 220)
    const handleViewport = () => syncState()

    window.addEventListener("resize", handleViewport)
    window.addEventListener("scroll", handleViewport, true)

    if (feedback) {
      feedbackTimer = window.setTimeout(() => setFeedback(null), 2400)
    }

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener("resize", handleViewport)
      window.removeEventListener("scroll", handleViewport, true)
      if (feedbackTimer !== null) {
        window.clearTimeout(feedbackTimer)
      }
    }
  }, [feedback])

  const visible = !!composer && prompt.trim().length >= 8
  const suggestions = useMemo(() => buildSuggestions(prompt), [prompt])

  useEffect(() => {
    if (!visible) {
      setIsExpanded(false)
    }
  }, [visible])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current) return
      if (containerRef.current.contains(event.target as Node)) return
      setIsExpanded(false)
    }

    document.addEventListener("mousedown", handlePointerDown, true)
    return () => document.removeEventListener("mousedown", handlePointerDown, true)
  }, [])

  async function improveWithAI() {
    if (!composer || !prompt.trim() || isImproving) {
      return
    }

    setIsImproving(true)
    setFeedback(null)

    try {
      const response = await chrome.runtime.sendMessage({
        command: "MINDDOCK_IMPROVE_PROMPT",
        payload: { prompt: prompt.trim() }
      })

      if (!response?.success) {
        throw new Error(response?.error ?? "Unable to improve the prompt.")
      }

      const improved = response?.payload?.improved ?? response?.data?.improved
      if (typeof improved !== "string" || !improved.trim()) {
        throw new Error("Invalid response while improving the prompt.")
      }

      writeComposerValue(composer, improved.trim())
      setPrompt(improved.trim())
      setFeedback("Prompt refined")
      setIsExpanded(false)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Improvement failed")
    } finally {
      setIsImproving(false)
    }
  }

  function applySuggestion(suggestion: PromptSuggestion) {
    if (!composer) return

    const current = readComposerValue(composer).trimEnd()
    const separator = current.length > 0 ? "\n\n" : ""
    const nextPrompt = `${current}${separator}${suggestion.suffix.trim()}`
    writeComposerValue(composer, nextPrompt)
    setPrompt(nextPrompt)
    setFeedback("Suggestion applied")
    setIsExpanded(false)
  }

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="prompt-coach"
          initial={{ opacity: 0, y: 10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.18 }}
          className="pointer-events-none fixed z-[2147483646]"
          style={{
            left: bubbleStyle.left,
            top: bubbleStyle.top,
            width: `${TRIGGER_WIDTH}px`
          }}>
          <div ref={containerRef} className="pointer-events-none relative">
            <AnimatePresence>
              {isExpanded ? (
                <motion.div
                  key="prompt-coach-panel"
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={{ duration: 0.16 }}
                  className="pointer-events-auto absolute bottom-[calc(100%+10px)] right-0"
                  style={{ width: `${PANEL_WIDTH}px` }}>
                  <div className="liquid-glass-panel rounded-[18px] p-3">
                    <div className="liquid-glass-content">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                            Optimizations
                          </p>
                          <p className="mt-0.5 text-[10px] text-zinc-300">
                            Improvements to get better results.
                          </p>
                        </div>

                        {isThinker ? (
                          <button
                            type="button"
                            onClick={() => void improveWithAI()}
                            className="liquid-glass-soft inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[12px] px-2.5 text-[10px] font-medium text-zinc-100 hover:-translate-y-px hover:text-white">
                            <Wand2 size={11} strokeWidth={1.9} />
                            {isImproving ? "Refining..." : "AI"}
                          </button>
                        ) : null}
                      </div>

                      <div className="mt-2 grid gap-1.5">
                        {suggestions.map((suggestion) => (
                          <button
                            key={suggestion.key}
                            type="button"
                            onClick={() => applySuggestion(suggestion)}
                            className="liquid-glass-soft flex items-start justify-between gap-3 rounded-[14px] px-2.5 py-2 text-left hover:-translate-y-px">
                            <div className="liquid-glass-content min-w-0">
                              <p className="text-[10px] font-medium text-white">{suggestion.label}</p>
                              <p className="mt-0.5 text-[9px] leading-4 text-zinc-400">
                                {suggestion.hint}
                              </p>
                            </div>
                            <span className="liquid-glass-content mt-0.5 text-[9px] text-zinc-500">
                              apply
                            </span>
                          </button>
                        ))}
                      </div>

                      {feedback ? (
                        <p className="mt-2 text-[9px] font-medium text-zinc-400">{feedback}</p>
                      ) : null}
                    </div>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <button
              type="button"
              onClick={() => setIsExpanded((current) => !current)}
              className="pointer-events-auto flex h-[42px] w-full items-center justify-between gap-3 rounded-[14px] border border-[#eab308] bg-[#facc15] px-3 text-left shadow-[0_10px_28px_rgba(250,204,21,0.22)]">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-black/10 text-black">
                  <Sparkles size={12} strokeWidth={2} />
                </span>
                <span className="truncate text-[11px] font-semibold tracking-[-0.01em] text-black">
                  We have optimizations for your prompt
                </span>
              </div>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-black/10 text-black">
                <ChevronUp
                  size={13}
                  strokeWidth={2.2}
                  className={isExpanded ? "" : "rotate-180"}
                />
              </span>
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
