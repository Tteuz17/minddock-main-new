/**
 * Docks bar for NotebookLM.
 * Uses persisted docks via the extension background router.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import {
  ArrowUpRight,
  BookOpen,
  Briefcase,
  ChevronDown,
  ChevronUp,
  FileText,
  Folder,
  Hash,
  Lightbulb,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  Trash2,
  Wand2,
  X,
  type LucideIcon
} from "lucide-react"

import { useAuth } from "~/hooks/useAuth"
import { MESSAGE_ACTIONS } from "~/lib/contracts"
import type { Thread, ThreadMessage } from "~/lib/types"
import {
  captureVisibleMessages,
  triggerNotebookDeleteConversationHistory
} from "./sourceDom"

const MAX_VISIBLE = 3
const DOCKS_DEMO_MODE = false
const DEMO_DOCKS_STORAGE_KEY_PREFIX = "minddock:docks-demo"
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

type DockIconKey = "hash" | "folder" | "target" | "lightbulb" | "book" | "briefcase" | "sparkles"
type SummaryReuseMode = "summary_only" | "summary_with_conversation"

const DEFAULT_DOCK_ICON: DockIconKey = "hash"

const DOCK_ICON_OPTIONS: Array<{ value: DockIconKey; label: string; Icon: LucideIcon }> = [
  { value: "hash", label: "General", Icon: Hash },
  { value: "folder", label: "Organize", Icon: Folder },
  { value: "target", label: "Goal", Icon: Target },
  { value: "lightbulb", label: "Ideas", Icon: Lightbulb },
  { value: "book", label: "Study", Icon: BookOpen },
  { value: "briefcase", label: "Work", Icon: Briefcase },
  { value: "sparkles", label: "Creative", Icon: Sparkles }
]

function normalizeDockTopic(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120)
}

function normalizeDockIcon(value: unknown): DockIconKey {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")

  const isKnown = DOCK_ICON_OPTIONS.some((option) => option.value === normalized)
  return isKnown ? (normalized as DockIconKey) : DEFAULT_DOCK_ICON
}

function resolveDockIconOption(value: unknown): { value: DockIconKey; label: string; Icon: LucideIcon } {
  const normalized = normalizeDockIcon(value)
  return DOCK_ICON_OPTIONS.find((option) => option.value === normalized) ?? DOCK_ICON_OPTIONS[0]
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
  let best: HTMLElement | null = null

  for (const selector of COMPOSER_SELECTORS) {
    for (const node of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (!isVisibleElement(node)) {
        continue
      }

      const rect = node.getBoundingClientRect()
      if (rect.top < window.innerHeight * 0.35) {
        continue
      }

      if (!best || rect.top > best.getBoundingClientRect().top) {
        best = node
      }
    }
  }

  return best
}

function readComposerValue(element: HTMLElement | null): string {
  if (!element) {
    return ""
  }

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value ?? ""
  }

  return element.textContent ?? ""
}

function focusEditable(element: HTMLElement): void {
  element.focus()

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return
  }

  const selection = window.getSelection()
  if (!selection) {
    return
  }

  const range = document.createRange()
  range.selectNodeContents(element)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

function writeComposerValue(element: HTMLElement, value: string): void {
  if (element instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
    setter ? setter.call(element, value) : (element.value = value)
  } else if (element instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    setter ? setter.call(element, value) : (element.value = value)
  } else {
    element.textContent = value
  }

  element.dispatchEvent(new Event("input", { bubbles: true }))
  element.dispatchEvent(new Event("change", { bubbles: true }))
  focusEditable(element)
}

const MAX_COMPOSER_CHARS = 9_000

function truncateText(value: string, maxLength: number): string {
  const normalized = value.trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength).trimEnd()}...`
}

function buildRecentTranscript(
  messages: ThreadMessage[],
  maxChars: number
): { text: string; truncated: boolean } {
  const lines = messages.map((message) =>
    `${message.role === "user" ? "User" : "NotebookLM"}:\n${message.content.trim()}`
  )

  const kept: string[] = []
  let total = 0

  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = lines[i]
    const addedLength = entry.length + (kept.length > 0 ? 2 : 0)
    if (total + addedLength > maxChars) {
      break
    }
    kept.unshift(entry)
    total += addedLength
  }

  return {
    text: kept.join("\n\n").trim() || "No transcript available.",
    truncated: kept.length < lines.length
  }
}

function extractDockContext(messages: ThreadMessage[]): {
  question: string
  insight: string
  transcript: string
} {
  const firstUserMessage = messages.find((message) => message.role === "user")?.content ?? ""
  const lastAssistantMessage =
    [...messages].reverse().find((message) => message.role === "assistant")?.content ?? ""
  const transcript = messages
    .map((message) =>
      `${message.role === "user" ? "User" : "NotebookLM"}:\n${message.content.trim()}`
    )
    .join("\n\n")
    .trim()

  return {
    question: truncateText(firstUserMessage || "No saved user message.", 240),
    insight: truncateText(lastAssistantMessage || "No saved assistant reply.", 420),
    transcript
  }
}

function inferPreferredLanguage(messages: ThreadMessage[]): "Portuguese" | "English" | "Mixed" {
  const fullText = messages.map((message) => message.content).join("\n").toLowerCase()
  const portugueseSignals = [
    " você ",
    " para ",
    " como ",
    " que ",
    " não ",
    " conversa ",
    " resumo ",
    "aplique",
    "estrutur"
  ]
  const englishSignals = [
    " the ",
    " and ",
    " with ",
    " how ",
    " continue ",
    " prompt ",
    "copywriting",
    "summary"
  ]

  const countSignals = (signals: string[]) =>
    signals.reduce((acc, signal) => acc + (fullText.includes(signal) ? 1 : 0), 0)

  const ptScore = countSignals(portugueseSignals)
  const enScore = countSignals(englishSignals)

  if (Math.abs(ptScore - enScore) <= 1) {
    return "Mixed"
  }

  return ptScore > enScore ? "Portuguese" : "English"
}

function inferLearningStyleSignals(messages: ThreadMessage[]): string[] {
  const userMessages = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.toLowerCase())

  const signals: string[] = []
  const hasPattern = (pattern: RegExp) => userMessages.some((content) => pattern.test(content))

  if (hasPattern(/\b(passo a passo|step by step|estrutura|structured|organizado|organized)\b/u)) {
    signals.push("Prefers structured, step-by-step guidance.")
  }
  if (hasPattern(/\b(exemplo|examples?|na prática|practical|aplicação|apply)\b/u)) {
    signals.push("Learns better with concrete examples and practical application.")
  }
  if (hasPattern(/\b(sem enrolação|direto|objetivo|conciso|straight to the point)\b/u)) {
    signals.push("Values concise and direct responses.")
  }
  if (hasPattern(/\b(detalhe|detalhado|deep|profundo|aprofundar)\b/u)) {
    signals.push("Wants depth and detail when useful.")
  }
  if (hasPattern(/\b(continuar|continue|de onde parou|where we left off)\b/u)) {
    signals.push("Expects continuity and context preservation across sessions.")
  }

  if (signals.length === 0) {
    signals.push("No explicit learning-style markers detected; preserve current interaction pattern.")
  }

  return signals
}

function buildProfessionalContinuationPrompt(
  thread: Thread,
  messages: ThreadMessage[]
): string {
  const userMessages = messages.filter((message) => message.role === "user")
  const assistantMessages = messages.filter((message) => message.role === "assistant")
  const firstUser = userMessages[0]?.content.trim() || "No first user message found."
  const latestUser = userMessages[userMessages.length - 1]?.content.trim() || "No latest user message found."
  const latestAssistant =
    assistantMessages[assistantMessages.length - 1]?.content.trim() || "No latest assistant response found."
  const language = inferPreferredLanguage(messages)
  const learningSignals = inferLearningStyleSignals(messages)
  const context = extractDockContext(messages)
  const recentUserQuotes = userMessages
    .slice(-5)
    .map((message, index) => `${index + 1}. "${truncateText(message.content, 220)}"`)
    .join("\n")

  const preamble = [
    `CONTINUITY BRIEF FROM SAVED DOCK: "${thread.name}"`,
    thread.topic ? `Dock topic: ${thread.topic}` : "Dock topic: not specified",
    "",
    "You are continuing an existing conversation. Do not restart from zero.",
    "",
    "NON-NEGOTIABLE CONTINUITY RULES:",
    "1. Preserve every relevant detail from this dock context.",
    "2. Preserve the user's language, tone, and study style.",
    "3. Keep the same project direction and avoid generic reset answers.",
    "4. If information is missing, ask only the minimum clarifying question.",
    "5. Keep outputs practical, actionable, and easy to execute.",
    "",
    "INFERRED USER PROFILE:",
    `- Preferred language: ${language}`,
    `- Interaction style signals: ${learningSignals.join(" | ")}`,
    "",
    "CONVERSATION MEMORY SNAPSHOT:",
    `- Initial user intent: ${truncateText(firstUser, 420)}`,
    `- Latest user intent: ${truncateText(latestUser, 420)}`,
    `- Latest assistant state: ${truncateText(latestAssistant, 460)}`,
    `- Core saved insight: ${context.insight}`,
    "",
    "RECENT USER VOICE SAMPLES (style anchor):",
    recentUserQuotes || "No recent user quotes.",
    "",
    "TASK NOW:",
    "1. Start with a 5-bullet continuity checkpoint that proves you understood the full history.",
    "2. Continue exactly from the last pending point.",
    "3. Deliver a professional, implementation-ready next step.",
    ""
  ].join("\n")

  const transcriptBudget = Math.max(500, MAX_COMPOSER_CHARS - preamble.length - 80)
  const { text: transcriptText, truncated } = buildRecentTranscript(messages, transcriptBudget)
  const transcriptHeader = truncated
    ? "PARTIAL TRANSCRIPT (most recent messages — full history too long for chat input):"
    : "FULL TRANSCRIPT (SOURCE OF TRUTH - DO NOT IGNORE):"

  return `${preamble}${transcriptHeader}\n${transcriptText}`
}

function buildSummaryOnlyContinuationPrompt(thread: Thread, messages: ThreadMessage[]): string {
  const userMessages = messages.filter((message) => message.role === "user")
  const assistantMessages = messages.filter((message) => message.role === "assistant")
  const firstUser = userMessages[0]?.content.trim() || "No first user message found."
  const latestUser = userMessages[userMessages.length - 1]?.content.trim() || "No latest user message found."
  const latestAssistant =
    assistantMessages[assistantMessages.length - 1]?.content.trim() || "No latest assistant response found."
  const language = inferPreferredLanguage(messages)
  const learningSignals = inferLearningStyleSignals(messages)
  const context = extractDockContext(messages)
  const assistantHighlights = assistantMessages
    .slice(-4)
    .map((message, index) => `${index + 1}. ${truncateText(message.content, 220)}`)
    .join("\n")

  return [
    `CONTINUITY SUMMARY FROM SAVED DOCK: "${thread.name}"`,
    thread.topic ? `Dock topic: ${thread.topic}` : "Dock topic: not specified",
    "",
    "Use this summary as your memory. Continue from the exact pending point without restarting.",
    "",
    "SUMMARY:",
    `- Initial user intent: ${truncateText(firstUser, 420)}`,
    `- Original intent anchor: ${context.question}`,
    `- Latest user intent: ${truncateText(latestUser, 420)}`,
    `- Latest assistant state: ${truncateText(latestAssistant, 460)}`,
    `- Core insight to preserve: ${context.insight}`,
    `- Preferred language: ${language}`,
    `- Interaction style signals: ${learningSignals.join(" | ")}`,
    "",
    "RECENT ASSISTANT TAKEAWAYS:",
    assistantHighlights || "No assistant takeaways available.",
    "",
    "CONTINUITY RULES:",
    "1. Do not restart from zero.",
    "2. Keep the same language and tone.",
    "3. Preserve the same project direction and assumptions.",
    "4. Continue with practical, implementation-ready next steps."
  ].join("\n")
}

function buildConversationTranscript(messages: ThreadMessage[]): { text: string; truncated: boolean } {
  return buildRecentTranscript(messages, MAX_COMPOSER_CHARS)
}

const MANUAL_USER_LABELS = new Set([
  "user",
  "you",
  "usuario",
  "usuário",
  "voce",
  "você",
  "eu",
  "pergunta"
])

const MANUAL_ASSISTANT_LABELS = new Set([
  "assistant",
  "ai",
  "notebooklm",
  "minddock",
  "modelo",
  "resposta",
  "bot"
])

function normalizeManualRoleLabel(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
}

function waitForUi(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs)
  })
}

function parseManualConversationInput(
  rawValue: string
): Array<{ role: "user" | "assistant"; content: string }> {
  const lines = String(rawValue ?? "").replace(/\r/g, "").split("\n")
  const output: Array<{ role: "user" | "assistant"; content: string }> = []

  let currentRole: "user" | "assistant" | null = null
  let currentBuffer: string[] = []

  const flush = () => {
    if (!currentRole) {
      currentBuffer = []
      return
    }

    const content = currentBuffer.join("\n").trim()
    if (content.length > 0) {
      output.push({ role: currentRole, content })
    }

    currentRole = null
    currentBuffer = []
  }

  for (const rawLine of lines) {
    const line = rawLine ?? ""
    const markerMatch = line.match(/^\s*([A-Za-zÀ-ÿ][\wÀ-ÿ \-]{0,24})\s*[:\-]\s*(.*)$/u)

    if (markerMatch) {
      const marker = normalizeManualRoleLabel(markerMatch[1] ?? "")
      const content = String(markerMatch[2] ?? "")
      const isUser = MANUAL_USER_LABELS.has(marker)
      const isAssistant = MANUAL_ASSISTANT_LABELS.has(marker)

      if (isUser || isAssistant) {
        flush()
        currentRole = isUser ? "user" : "assistant"
        if (content.trim()) {
          currentBuffer.push(content)
        }
        continue
      }
    }

    if (!currentRole && line.trim().length > 0) {
      // Fallback: sem marcador, salva como resposta única para não perder contexto.
      currentRole = "assistant"
    }

    if (currentRole) {
      currentBuffer.push(line)
    }
  }

  flush()

  return output
    .map((message) => ({
      role: message.role,
      content: message.content.trim()
    }))
    .filter((message) => message.content.length > 0)
    .slice(0, 250)
}

const SAMPLE_DOCKS: Array<{
  name: string
  messages: Array<{ role: "user" | "assistant"; content: string }>
}> = [
  {
    name: "Hooks that stop the scroll",
    messages: [
      {
        role: "user",
        content: "Teach me the foundations of writing stronger hooks for a landing page."
      },
      {
        role: "assistant",
        content: [
          "Strong hooks earn attention by creating immediate relevance, tension, or curiosity.",
          "",
          "Use these principles:",
          "1. Lead with the pain, desire, or shift the reader cares about most.",
          "2. Make the promise concrete, not abstract.",
          "3. Compress the value into one fast, clear idea.",
          "4. Avoid vague adjectives unless the proof is obvious.",
          "",
          "A reliable formula is: problem + contrast + outcome.",
          'Example: "Your team is drowning in notes. MindDock turns them into a system you can actually use."'
        ].join("\n")
      }
    ]
  },
  {
    name: "Benefits over features",
    messages: [
      {
        role: "user",
        content: "Show me how to turn product features into persuasive copywriting benefits."
      },
      {
        role: "assistant",
        content: [
          "Features describe what the product has. Benefits explain why the buyer should care.",
          "",
          "Use this translation pattern:",
          "- Feature: what it does",
          "- Functional result: what changes immediately",
          "- Emotional result: why that change matters",
          "",
          'Example: "Persistent threads" becomes "Keep every line of thought organized, so ideas do not disappear after one chat."',
          "",
          "Ask this every time: what friction is removed, what time is saved, what risk is reduced, or what result becomes easier?"
        ].join("\n")
      }
    ]
  },
  {
    name: "Offer and CTA clarity",
    messages: [
      {
        role: "user",
        content: "Teach me how to make an offer and CTA feel clearer and more compelling."
      },
      {
        role: "assistant",
        content: [
          "A strong offer reduces uncertainty. A strong CTA removes hesitation.",
          "",
          "To improve the offer:",
          "- State the outcome in plain language.",
          "- Define who it is for.",
          "- Explain why this matters now.",
          "",
          "To improve the CTA:",
          "- Use action-led language.",
          "- Make the next step feel easy and low-risk.",
          "- Align the CTA with the promise above it.",
          "",
          'Weak CTA: "Learn more"',
          'Stronger CTA: "See how MindDock organizes your NotebookLM workflow"'
        ].join("\n")
      }
    ]
  }
]

function buildLightCopyStarterMessages(threadId: string): ThreadMessage[] {
  const now = new Date().toISOString()

  return [
    {
      id: `${threadId}-starter-1`,
      threadId,
      role: "user",
      content: "how to apply light copy in copies for luxury goods sales",
      createdAt: now
    },
    {
      id: `${threadId}-starter-2`,
      threadId,
      role: "assistant",
      content: [
        "To apply the concept of Light Copy to the sale of luxury goods, you must move away from the aggressive tactics of traditional marketing and focus on communication that appears unassuming, honest, and deeply sophisticated. The luxury clientele tends to be well-educated and averse to being \"convinced,\" so lightness and intelligence are essential.",
        "",
        "Below, I detail how to structure your copy for this niche based on the principles of the sources:",
        "",
        "1. Avoid \"Marketing spiel\"",
        "In the luxury market, words like \"exclusive,\" \"unique,\" or \"unmissable\" can, ironically, cheapen your product and make you seem like a shady marketer.",
        "The technique: copy should read like a frank conversation. Instead of selling an \"exclusive lifestyle,\" describe specific and sensitive moments that only that item provides.",
        "Do not underestimate their intelligence: luxury consumers immediately pick up on obvious mental triggers or lies, such as false scarcity, which destroys trust and brand authority.",
        "",
        "2. Use Premise Marketing",
        "The basis of Light Copy is the use of irrefutable premises that lead the customer to an inevitable logical conclusion: your product is the right choice.",
        "How to apply it: instead of making an outlandish promise, present facts about the construction, origin, or market value of the product. If the person agrees with your initial arguments, the premises, the yes to the purchase becomes much more natural.",
        "",
        "3. Focus on the \"Decorated\" (Parallel Benefits)",
        "In the sources, the concept of \"Decorated\" refers to what the client truly desires beyond the object itself.",
        "Application in luxury: an expensive watch is not just for telling time; it is about acceptance, recognition, and how the customer feels when wearing it.",
        "Be specific. Do not speak generically about freedom or status. Use the detail of the detail. Describe the feel of the leather, the sound of the engine, or the peace of a specific environment.",
        "",
        "4. Use Literary Elements (Landscapes)",
        "To make the copy for a luxury product memorable, use resources that go beyond common sense.",
        "Chronicle: write texts that convey an idea or value without the explicit intention of selling at the beginning. This creates a connection with the client's values.",
        "Visual impact and the unusual: luxury marketing often gains traction by being unusual or quirky, deviating from the visual standards of common advertisements.",
        "Skin/body experience: describe the sensory experience of the product so vividly that the reader can feel the luxury item while reading.",
        "",
        "5. Transparent Value Anchoring",
        "If the product is expensive, do not try to hide it. Light Copy suggests being transparent about the price, which can even spark more curiosity and establish authority.",
        "Anchoring: compare the value of the asset with other investment possibilities or with the cost of not having that experience, but avoid silly comparisons, such as saying it costs less than a cup of coffee, because that degrades the image of luxury.",
        "",
        "In short, Light Copy for luxury goods is about promising little and delivering much, treating the customer with the dignity of someone who knows they are dealing with something truly valuable, without needing to shout or exaggerate."
      ].join("\n"),
      createdAt: now
    }
  ]
}

interface DemoDockStore {
  threads: Thread[]
  messagesById: Record<string, ThreadMessage[]>
}

function getNotebookIdFromUrl(): string {
  const match = window.location.pathname.match(/\/notebook\/([^/?#]+)/)
  return match?.[1] ?? ""
}

function getDemoStorageKey(userId: string, notebookId: string): string {
  return `${DEMO_DOCKS_STORAGE_KEY_PREFIX}:${userId}:${notebookId}`
}

function buildDemoThread(
  userId: string,
  notebookId: string,
  name: string,
  index: number,
  options: { topic?: string; icon?: string } = {}
): Thread {
  const now = new Date().toISOString()
  const topic = normalizeDockTopic(options.topic ?? "")
  const icon = normalizeDockIcon(options.icon)

  return {
    id: `demo-dock-${notebookId}-${index}-${Date.now()}`,
    userId,
    notebookId,
    name,
    ...(topic ? { topic } : {}),
    ...(icon ? { icon } : {}),
    createdAt: now,
    updatedAt: now
  }
}

function buildInitialDemoStore(userId: string, notebookId: string): DemoDockStore {
  const threads: Thread[] = []
  const messagesById: Record<string, ThreadMessage[]> = {}

  SAMPLE_DOCKS.forEach((sample, index) => {
    const thread = buildDemoThread(userId, notebookId, sample.name, index)
    threads.push(thread)
    messagesById[thread.id] = sample.messages.map((message, messageIndex) => ({
      id: `${thread.id}-message-${messageIndex + 1}`,
      threadId: thread.id,
      role: message.role,
      content: message.content,
      createdAt: thread.createdAt
    }))
  })

  return { threads, messagesById }
}

function readDemoStore(userId: string, notebookId: string): DemoDockStore {
  if (typeof window === "undefined") {
    return buildInitialDemoStore(userId, notebookId)
  }

  const storageKey = getDemoStorageKey(userId, notebookId)

  try {
    const raw = window.sessionStorage.getItem(storageKey)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DemoDockStore>
      if (Array.isArray(parsed.threads) && parsed.messagesById && typeof parsed.messagesById === "object") {
        return {
          threads: parsed.threads as Thread[],
          messagesById: parsed.messagesById as Record<string, ThreadMessage[]>
        }
      }
    }
  } catch {
    // Ignore malformed demo state and recreate it below.
  }

  const seeded = buildInitialDemoStore(userId, notebookId)
  writeDemoStore(userId, notebookId, seeded)
  return seeded
}

function writeDemoStore(userId: string, notebookId: string, store: DemoDockStore): void {
  if (typeof window === "undefined") {
    return
  }

  try {
    window.sessionStorage.setItem(getDemoStorageKey(userId, notebookId), JSON.stringify(store))
  } catch {
    // Ignore storage failures in demo mode.
  }
}

export function FocusThreadsBar() {
  const { user } = useAuth()
  const notebookId = useRef(getNotebookIdFromUrl())

  const [threads, setThreads] = useState<Thread[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [isLoadingThreads, setIsLoadingThreads] = useState(false)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const renameInputRef = useRef<HTMLInputElement | null>(null)

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newDockName, setNewDockName] = useState("")
  const [newDockTopic, setNewDockTopic] = useState("")
  const [newDockIcon, setNewDockIcon] = useState<DockIconKey>(DEFAULT_DOCK_ICON)
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [showPasteModal, setShowPasteModal] = useState(false)
  const [pasteInputValue, setPasteInputValue] = useState("")
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [isSavingPastedConversation, setIsSavingPastedConversation] = useState(false)
  const [isUpdatingDockSnapshot, setIsUpdatingDockSnapshot] = useState(false)
  const [showClearConversationModal, setShowClearConversationModal] = useState(false)
  const [clearConversationContext, setClearConversationContext] = useState<{ dockName: string } | null>(null)
  const [summaryReuseMode, setSummaryReuseMode] = useState<SummaryReuseMode>("summary_with_conversation")
  const [expandAllMessages, setExpandAllMessages] = useState(false)
  const [actionFeedback, setActionFeedback] = useState<{
    type: "success" | "error"
    text: string
  } | null>(null)
  const createInputRef = useRef<HTMLInputElement | null>(null)
  const pasteInputRef = useRef<HTMLTextAreaElement | null>(null)
  const actionFeedbackTimeoutRef = useRef<number | null>(null)
  const clearConversationResolverRef = useRef<((confirmed: boolean) => void) | null>(null)

  useEffect(() => {
    if (showCreateModal && createInputRef.current) {
      createInputRef.current.focus()
      createInputRef.current.select()
    }
  }, [showCreateModal])

  useEffect(() => {
    if (showPasteModal && pasteInputRef.current) {
      pasteInputRef.current.focus()
    }
  }, [showPasteModal])

  useEffect(() => {
    if (!historyOpen) {
      setExpandAllMessages(false)
    }
  }, [historyOpen, activeId])

  useEffect(() => {
    return () => {
      if (actionFeedbackTimeoutRef.current) {
        window.clearTimeout(actionFeedbackTimeoutRef.current)
      }

      if (clearConversationResolverRef.current) {
        clearConversationResolverRef.current(false)
        clearConversationResolverRef.current = null
      }
    }
  }, [])

  const pushActionFeedback = useCallback(
    (text: string, type: "success" | "error" = "success") => {
      setActionFeedback({ text, type })

      if (actionFeedbackTimeoutRef.current) {
        window.clearTimeout(actionFeedbackTimeoutRef.current)
      }

      actionFeedbackTimeoutRef.current = window.setTimeout(() => {
        setActionFeedback(null)
      }, 2400)
    },
    []
  )

  const captureCurrentConversation = useCallback(async (): Promise<
    Array<{ role: "user" | "assistant"; content: string }>
  > => {
    let bestCapture = captureVisibleMessages()
    if (bestCapture.length >= 2) {
      return bestCapture
    }

    for (const delay of [90, 180, 320]) {
      await waitForUi(delay)
      const nextCapture = captureVisibleMessages()
      if (nextCapture.length > bestCapture.length) {
        bestCapture = nextCapture
      }
      if (nextCapture.length >= 2) {
        return nextCapture
      }
    }

    return bestCapture
  }, [])

  const resetNotebookConversation = useCallback(async (): Promise<boolean> => {
    return triggerNotebookDeleteConversationHistory()
  }, [])

  const requestClearConversationConfirmation = useCallback((dockName: string): Promise<boolean> => {
    const normalizedDockName = dockName.trim() || "current dock"

    return new Promise((resolve) => {
      if (clearConversationResolverRef.current) {
        clearConversationResolverRef.current(false)
      }
      clearConversationResolverRef.current = resolve
      setClearConversationContext({ dockName: normalizedDockName })
      setShowClearConversationModal(true)
    })
  }, [])

  const resolveClearConversationConfirmation = useCallback((confirmed: boolean) => {
    setShowClearConversationModal(false)
    setClearConversationContext(null)

    const resolver = clearConversationResolverRef.current
    clearConversationResolverRef.current = null
    resolver?.(confirmed)
  }, [])

  const maybePromptToClearConversationAfterSave = useCallback(
    async (dockName: string): Promise<boolean> => {
      const confirmed = await requestClearConversationConfirmation(dockName)

      if (!confirmed) {
        pushActionFeedback("Saved to Dock. Conversation history was kept.")
        return false
      }

      const cleared = await resetNotebookConversation()
      if (!cleared) {
        pushActionFeedback(
          "Saved to Dock, but history delete could not be confirmed. If NotebookLM asked for confirmation, confirm it and try again.",
          "error"
        )
        return false
      }

      pushActionFeedback("Conversation history cleared. Dock and sources were preserved.")
      return true
    },
    [pushActionFeedback, requestClearConversationConfirmation, resetNotebookConversation]
  )

  useEffect(() => {
    if (!user || !notebookId.current) return

    setIsLoadingThreads(true)

    if (DOCKS_DEMO_MODE) {
      const store = readDemoStore(user.id, notebookId.current)
      setThreads(store.threads)
      setIsLoadingThreads(false)
      return
    }

    chrome.runtime
      .sendMessage({
        command: MESSAGE_ACTIONS.THREAD_LIST,
        payload: { notebookId: notebookId.current }
      })
      .then((res) => {
        if (res?.success) {
          const list: Thread[] = res.payload?.threads ?? res.data?.threads ?? []
          setThreads(list)
        }
      })
      .finally(() => setIsLoadingThreads(false))
  }, [user])

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  const saveCurrentToDock = useCallback(
    async (threadId: string): Promise<boolean> => {
      const captured = await captureCurrentConversation()
      if (captured.length === 0) return false

      if (DOCKS_DEMO_MODE) {
        if (!user || !notebookId.current) return false

        const store = readDemoStore(user.id, notebookId.current)
        const now = new Date().toISOString()
        const nextMessages: ThreadMessage[] = captured.map((message, index) => ({
          id: `${threadId}-capture-${Date.now()}-${index}`,
          threadId,
          role: message.role,
          content: message.content,
          createdAt: now
        }))

        const nextThreads = store.threads.map((thread) =>
          thread.id === threadId ? { ...thread, updatedAt: now } : thread
        )

        writeDemoStore(user.id, notebookId.current, {
          threads: nextThreads,
          messagesById: {
            ...store.messagesById,
            [threadId]: nextMessages
          }
        })

        setThreads(nextThreads)
        return true
      }

      const response = await chrome.runtime.sendMessage({
        command: MESSAGE_ACTIONS.THREAD_SAVE_MESSAGES,
        payload: { threadId, messages: captured }
      })
      if (!response?.success) {
        pushActionFeedback(response?.error ?? "Failed to save this conversation in the dock.", "error")
        return false
      }

      return true
    },
    [captureCurrentConversation, pushActionFeedback, user]
  )

  const loadMessages = useCallback(
    async (threadId: string) => {
      setIsLoadingMessages(true)

      if (DOCKS_DEMO_MODE) {
        if (!user || !notebookId.current) {
          setMessages([])
          setIsLoadingMessages(false)
          return
        }

        const store = readDemoStore(user.id, notebookId.current)
        setMessages(store.messagesById[threadId] ?? [])
        setIsLoadingMessages(false)
        return
      }

      const res = await chrome.runtime.sendMessage({
        command: MESSAGE_ACTIONS.THREAD_MESSAGES,
        payload: { threadId }
      })
      const nextMessages: ThreadMessage[] = res?.payload?.messages ?? res?.data?.messages ?? []
      setMessages(nextMessages)
      setIsLoadingMessages(false)
    },
    [user]
  )

  async function handleSelectDock(thread: Thread) {
    if (thread.id === activeId) {
      const nextHistoryOpen = !historyOpen
      if (nextHistoryOpen) {
        await loadMessages(thread.id)
      }
      setHistoryOpen(nextHistoryOpen)
      return
    }

    setActiveId(thread.id)
    setHistoryOpen(true)
    await loadMessages(thread.id)
    setThreads((prev) =>
      prev.map((item) => (item.id === thread.id ? { ...item, updatedAt: new Date().toISOString() } : item))
    )
  }

  function handleUseAiSummary() {
    if (!activeThread || messages.length === 0) {
      pushActionFeedback("This dock has no saved context yet.", "error")
      return
    }

    const composer = resolveActiveComposer()
    if (!composer) {
      pushActionFeedback("No active NotebookLM composer found.", "error")
      return
    }

    const currentValue = readComposerValue(composer).trim()
    const dockContextBlock =
      summaryReuseMode === "summary_only"
        ? buildSummaryOnlyContinuationPrompt(activeThread, messages)
        : buildProfessionalContinuationPrompt(activeThread, messages)

    const nextValue = currentValue ? `${currentValue}\n\n${dockContextBlock}` : dockContextBlock

    writeComposerValue(composer, nextValue)
    setHistoryOpen(false)
    pushActionFeedback(
      summaryReuseMode === "summary_only"
        ? "AI summary inserted into the current chat."
        : "AI summary plus full conversation inserted into the current chat."
    )
  }

  function handlePasteFullConversationOnly() {
    if (!activeThread || messages.length === 0) {
      pushActionFeedback("This dock has no saved context yet.", "error")
      return
    }

    const composer = resolveActiveComposer()
    if (!composer) {
      pushActionFeedback("No active NotebookLM composer found.", "error")
      return
    }

    const currentValue = readComposerValue(composer).trim()
    const { text: dockContextBlock, truncated } = buildConversationTranscript(messages)

    const nextValue = currentValue ? `${currentValue}\n\n${dockContextBlock}` : dockContextBlock

    writeComposerValue(composer, nextValue)
    setHistoryOpen(false)
    pushActionFeedback(
      truncated
        ? "Recent messages pasted (conversation was too long — oldest messages omitted)."
        : "Full conversation pasted into the current chat."
    )
  }

  function handleGenerateNextPrompt() {
    if (!activeThread || messages.length === 0) {
      pushActionFeedback("This dock has no saved context yet.", "error")
      return
    }

    const composer = resolveActiveComposer()
    if (!composer) {
      pushActionFeedback("No active NotebookLM composer found.", "error")
      return
    }

    const context = extractDockContext(messages)
    const nextPrompt = [
      `Use the saved dock "${activeThread.name}" as context and continue from it.`,
      "",
      `Primary question: ${context.question}`,
      "",
      "Key saved insight:",
      context.insight,
      "",
      "Now help me go deeper by:",
      "1. Extracting the most reusable principles.",
      "2. Applying them to one concrete scenario.",
      "3. Giving 3 stronger examples I can reuse.",
      "4. Ending with one tighter version of the final copy/prompt."
    ].join("\n")

    writeComposerValue(composer, nextPrompt)
    setHistoryOpen(false)
    pushActionFeedback("A follow-up prompt was generated in the chat.")
  }

  async function handleUpdateDockSnapshot() {
    if (!activeThread || isUpdatingDockSnapshot) {
      return
    }

    try {
      setIsUpdatingDockSnapshot(true)
      const saved = await saveCurrentToDock(activeThread.id)
      if (!saved) {
        pushActionFeedback(
          "Could not detect the visible conversation. Scroll the chat and try Update snapshot again.",
          "error"
        )
        return
      }

      await loadMessages(activeThread.id)
      pushActionFeedback("Dock snapshot updated. New messages are saved only when you click update.")
    } finally {
      setIsUpdatingDockSnapshot(false)
    }
  }

  async function handleSendToNotes() {
    if (!activeThread || messages.length === 0) {
      pushActionFeedback("This dock has no saved context yet.", "error")
      return
    }

    const context = extractDockContext(messages)
    const draftTitle = `${activeThread.name} dock`
    const draftContent = [
      `# ${activeThread.name}`,
      "",
      `Original question: ${context.question}`,
      "",
      "Key saved insight:",
      context.insight,
      "",
      "## Full dock transcript",
      context.transcript
    ].join("\n")

    const response = await chrome.runtime.sendMessage({
      command: MESSAGE_ACTIONS.OPEN_SIDEPANEL,
      payload: {
        target: "create_note",
        draft: {
          title: draftTitle,
          content: draftContent,
          tags: ["dock", "notebooklm"]
        }
      }
    })

    if (!response?.success) {
      pushActionFeedback(response?.error ?? "Failed to open notes.", "error")
      return
    }

    setHistoryOpen(false)
    pushActionFeedback("Dock sent to notes.")
  }

  function openCreateModal() {
    setNewDockName("")
    setNewDockTopic("")
    setNewDockIcon(DEFAULT_DOCK_ICON)
    setCreateError(null)
    setShowCreateModal(true)
  }

  function closeCreateModal() {
    setShowCreateModal(false)
    setNewDockTopic("")
    setNewDockIcon(DEFAULT_DOCK_ICON)
    setCreateError(null)
  }

  function openPasteModal() {
    if (!activeId) {
      pushActionFeedback("Select a dock first to paste and save conversation.", "error")
      return
    }

    setPasteInputValue("")
    setPasteError(null)
    setShowPasteModal(true)
  }

  function closePasteModal() {
    if (isSavingPastedConversation) return
    setShowPasteModal(false)
    setPasteError(null)
  }

  async function handleSavePastedConversation() {
    if (!activeId) {
      setPasteError("Select a dock before saving pasted conversation.")
      return
    }

    const parsedMessages = parseManualConversationInput(pasteInputValue)
    if (parsedMessages.length === 0) {
      setPasteError("Could not parse messages. Use lines like 'User:' and 'NotebookLM:'.")
      return
    }

    try {
      setIsSavingPastedConversation(true)
      setPasteError(null)

      if (DOCKS_DEMO_MODE) {
        if (!user || !notebookId.current) {
          setPasteError("No user session available.")
          return
        }

        const store = readDemoStore(user.id, notebookId.current)
        const now = new Date().toISOString()
        const nextMessages: ThreadMessage[] = parsedMessages.map((message, index) => ({
          id: `${activeId}-manual-${Date.now()}-${index}`,
          threadId: activeId,
          role: message.role,
          content: message.content,
          createdAt: now
        }))

        const nextThreads = store.threads.map((thread) =>
          thread.id === activeId ? { ...thread, updatedAt: now } : thread
        )

        writeDemoStore(user.id, notebookId.current, {
          threads: nextThreads,
          messagesById: {
            ...store.messagesById,
            [activeId]: nextMessages
          }
        })

        setThreads(nextThreads)
        setMessages(nextMessages)
        setShowPasteModal(false)
        pushActionFeedback(`Saved ${nextMessages.length} pasted messages to dock.`)
        return
      }

      const saveResponse = await chrome.runtime.sendMessage({
        command: MESSAGE_ACTIONS.THREAD_SAVE_MESSAGES,
        payload: { threadId: activeId, messages: parsedMessages }
      })

      if (!saveResponse?.success) {
        setPasteError(saveResponse?.error ?? "Failed to save pasted conversation.")
        return
      }

      await loadMessages(activeId)
      setShowPasteModal(false)
      pushActionFeedback(`Saved ${parsedMessages.length} pasted messages to dock.`)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save pasted conversation."
      setPasteError(message)
    } finally {
      setIsSavingPastedConversation(false)
    }
  }

  async function handleCreateDock() {
    const name = newDockName.trim()
    const topic = normalizeDockTopic(newDockTopic)
    const icon = normalizeDockIcon(newDockIcon)
    if (!name || !user || !notebookId.current) return

    try {
      setIsCreating(true)
      setCreateError(null)
      const capturedCurrentConversation = await captureCurrentConversation()
      if (capturedCurrentConversation.length === 0) {
        pushActionFeedback("No visible conversation was detected. The dock may start empty.", "error")
      }

      if (DOCKS_DEMO_MODE) {
        const thread = buildDemoThread(user.id, notebookId.current, name, threads.length, {
          topic,
          icon
        })
        const nextThreads = [thread, ...threads]
        const now = new Date().toISOString()
        const starterMessages =
          capturedCurrentConversation.length > 0
            ? capturedCurrentConversation.map((message, index) => ({
                id: `${thread.id}-capture-${Date.now()}-${index}`,
                threadId: thread.id,
                role: message.role,
                content: message.content,
                createdAt: now
              }))
            : buildLightCopyStarterMessages(thread.id)
        const currentStore = readDemoStore(user.id, notebookId.current)

        writeDemoStore(user.id, notebookId.current, {
          threads: nextThreads,
          messagesById: {
            ...currentStore.messagesById,
            [thread.id]: starterMessages
          }
        })

        setThreads(nextThreads)
        setActiveId(thread.id)
        setMessages(starterMessages)
        setHistoryOpen(false)
        closeCreateModal()
        if (capturedCurrentConversation.length > 0) {
          await maybePromptToClearConversationAfterSave(name)
        }
        return
      }

      const res = await chrome.runtime.sendMessage({
        command: MESSAGE_ACTIONS.THREAD_CREATE,
        payload: {
          notebookId: notebookId.current,
          name,
          topic: topic || undefined,
          icon
        }
      })

      if (res?.success) {
        const thread: Thread = res.payload?.thread ?? res.data?.thread

        if (capturedCurrentConversation.length > 0) {
          const saveResponse = await chrome.runtime.sendMessage({
            command: MESSAGE_ACTIONS.THREAD_SAVE_MESSAGES,
            payload: { threadId: thread.id, messages: capturedCurrentConversation }
          })

          if (!saveResponse?.success) {
            pushActionFeedback(saveResponse?.error ?? "Failed to save captured conversation.", "error")
          }
        }

        const loadedMessagesResponse = await chrome.runtime.sendMessage({
          command: MESSAGE_ACTIONS.THREAD_MESSAGES,
          payload: { threadId: thread.id }
        })
        const loadedMessages: ThreadMessage[] =
          loadedMessagesResponse?.payload?.messages ?? loadedMessagesResponse?.data?.messages ?? []

        setThreads((prev) => [thread, ...prev])
        setActiveId(thread.id)
        setMessages(loadedMessages)
        setHistoryOpen(false)
        closeCreateModal()
        if (capturedCurrentConversation.length > 0) {
          await maybePromptToClearConversationAfterSave(name)
        }
      } else {
        setCreateError(res?.error ?? "Failed to create dock.")
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to create dock."
      setCreateError(errorMessage)
      pushActionFeedback(errorMessage, "error")
    } finally {
      setIsCreating(false)
    }
  }

  async function handleDeleteDock(threadId: string, event: React.MouseEvent) {
    event.stopPropagation()

    if (confirmDeleteId !== threadId) {
      setConfirmDeleteId(threadId)
      setTimeout(() => setConfirmDeleteId(null), 2500)
      return
    }

    setConfirmDeleteId(null)

    if (DOCKS_DEMO_MODE) {
      if (user && notebookId.current) {
        const store = readDemoStore(user.id, notebookId.current)
        const nextThreads = store.threads.filter((thread) => thread.id !== threadId)
        const nextMessagesById = { ...store.messagesById }
        delete nextMessagesById[threadId]

        writeDemoStore(user.id, notebookId.current, {
          threads: nextThreads,
          messagesById: nextMessagesById
        })

        setThreads(nextThreads)
      }
    } else {
      await chrome.runtime.sendMessage({
        command: MESSAGE_ACTIONS.THREAD_DELETE,
        payload: { threadId }
      })
      setThreads((prev) => prev.filter((thread) => thread.id !== threadId))
    }

    if (activeId === threadId) {
      setActiveId(null)
      setHistoryOpen(false)
      setMessages([])
    }
  }

  function handleDoubleClick(thread: Thread, event: React.MouseEvent) {
    event.stopPropagation()
    setRenamingId(thread.id)
    setRenameValue(thread.name)
  }

  async function commitRename() {
    const nextName = renameValue.trim()
    if (!renamingId || !nextName) {
      setRenamingId(null)
      return
    }

    if (DOCKS_DEMO_MODE) {
      if (user && notebookId.current) {
        const store = readDemoStore(user.id, notebookId.current)
        const nextThreads = store.threads.map((thread) =>
          thread.id === renamingId
            ? { ...thread, name: nextName, updatedAt: new Date().toISOString() }
            : thread
        )

        writeDemoStore(user.id, notebookId.current, {
          threads: nextThreads,
          messagesById: store.messagesById
        })

        setThreads(nextThreads)
      }

      setRenamingId(null)
      return
    }

    const res = await chrome.runtime.sendMessage({
      command: MESSAGE_ACTIONS.THREAD_RENAME,
      payload: { threadId: renamingId, name: nextName }
    })

    if (res?.success) {
      const updated: Thread = res.payload?.thread ?? res.data?.thread
      setThreads((prev) => prev.map((thread) => (thread.id === renamingId ? updated : thread)))
    }

    setRenamingId(null)
  }

  if (!notebookId.current) return null

  if (!user) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              background: "#27272a",
              borderRadius: "8px",
              padding: "5px 10px",
              opacity: 0.5
            }}>
            <Hash size={9} strokeWidth={2.5} color="#71717a" />
            <span style={{ fontSize: "10px", color: "#71717a", fontFamily: "system-ui, sans-serif" }}>
              Dock {index + 1}
            </span>
          </div>
        ))}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#27272a",
            borderRadius: "8px",
            padding: "5px 8px",
            opacity: 0.5,
            cursor: "default"
          }}>
          <Plus size={11} strokeWidth={2.5} color="#71717a" />
        </div>
      </div>
    )
  }

  const visibleThreads = threads.slice(0, MAX_VISIBLE)
  const activeThread = threads.find((thread) => thread.id === activeId)
  const activeDockIconOption = resolveDockIconOption(activeThread?.icon)
  const ActiveDockIcon = activeDockIconOption.Icon
  const createDockIconOption = resolveDockIconOption(newDockIcon)
  const CreateDockIcon = createDockIconOption.Icon
  const isConfirmDeleteActive = !!activeThread && confirmDeleteId === activeThread.id
  const historyPanelSize = expandAllMessages
    ? {
        width: "min(94vw, 1120px)",
        cardHeight: "82vh",
        minCardHeight: 560,
        listMinHeight: 360
      }
    : {
        width: 420,
        cardHeight: "min(76vh, 560px)",
        minCardHeight: 460,
        listMinHeight: 240
      }

  return (
    <div style={{ display: "contents" }}>
      <div className="flex flex-col">
        <div className="flex items-center gap-1">
          {isLoadingThreads ? (
            <div className="flex items-center gap-1.5 px-1">
              <Loader2 size={10} className="animate-spin text-zinc-600" />
              <span className="text-[10px] text-zinc-600">Loading...</span>
            </div>
          ) : (
            <>
              {visibleThreads.map((thread) => {
                const isActive = thread.id === activeId
                const dockIcon = resolveDockIconOption(thread.icon)
                const DockIcon = dockIcon.Icon

                return (
                  <div
                    key={thread.id}
                    className={[
                      "group relative flex shrink-0 select-none items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-all duration-150",
                      isActive
                        ? "bg-[#facc15] text-black shadow-[0_2px_8px_rgba(250,204,21,0.3)]"
                        : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white",
                      "cursor-pointer"
                    ].join(" ")}
                    style={{ maxWidth: 130 }}
                    onClick={() => void handleSelectDock(thread)}
                    onDoubleClick={(event) => handleDoubleClick(thread, event)}>
                    <DockIcon
                      size={9}
                      strokeWidth={2.5}
                      className={isActive ? "shrink-0 text-black/60" : "shrink-0 text-zinc-500"}
                    />

                    {renamingId === thread.id ? (
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onBlur={() => void commitRename()}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void commitRename()
                          if (event.key === "Escape") setRenamingId(null)
                        }}
                        onClick={(event) => event.stopPropagation()}
                        className="w-16 bg-transparent text-[10px] font-medium outline-none"
                      />
                    ) : (
                      <span className="truncate text-[10px] font-medium" title={thread.topic || thread.name}>
                        {thread.name}
                      </span>
                    )}

                    {isActive && (
                      <span className="shrink-0 opacity-50">
                        {historyOpen ? (
                          <ChevronUp size={8} strokeWidth={3} />
                        ) : (
                          <ChevronDown size={8} strokeWidth={3} />
                        )}
                      </span>
                    )}
                  </div>
                )
              })}

              {threads.length > MAX_VISIBLE && (
                <span className="flex items-center justify-center rounded-md bg-zinc-800 px-1.5 py-1 text-[9px] text-zinc-400">
                  +{threads.length - MAX_VISIBLE}
                </span>
              )}

              <button
                type="button"
                onClick={openCreateModal}
                title="New dock"
                className="flex shrink-0 items-center justify-center rounded-lg bg-zinc-800 p-1.5 text-zinc-400 transition-all duration-150 hover:bg-[#facc15] hover:text-black">
                <Plus size={11} strokeWidth={2.5} />
              </button>
            </>
          )}
        </div>

        <AnimatePresence mode="wait">
          {historyOpen && activeThread && (
            <motion.div
              key="dock-history"
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full z-50 mt-1"
              style={{ width: historyPanelSize.width, maxWidth: "94vw" }}>
              <div
                className="relative overflow-hidden rounded-2xl border border-[#facc15]/20 bg-[#07090c] shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
                style={{
                  height: historyPanelSize.cardHeight,
                  minHeight: historyPanelSize.minCardHeight,
                  display: "flex",
                  flexDirection: "column"
                }}>
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(250,204,21,0.14),transparent_48%)]" />

                <div className="relative z-10 shrink-0 flex items-center justify-between border-b border-[#facc15]/10 px-3.5 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg border border-[#facc15]/30 bg-[#facc15]/12">
                      <ActiveDockIcon size={10} strokeWidth={2.5} className="text-[#facc15]" />
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                        {activeThread.name}
                      </span>
                      {activeThread.topic ? (
                        <span className="truncate text-[10px] text-zinc-300">{activeThread.topic}</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {messages.length > 0 && !isLoadingMessages ? (
                      <button
                        type="button"
                        onClick={() => setExpandAllMessages((previous) => !previous)}
                        className="rounded-lg border border-white/[0.1] bg-white/[0.03] px-2 py-1 text-[9px] font-semibold text-zinc-300 transition-colors hover:border-[#facc15]/40 hover:bg-[#facc15]/[0.08] hover:text-[#fde68a]">
                        {expandAllMessages ? "Collapse reader" : "Expand reader"}
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => setHistoryOpen(false)}
                      className="flex h-6 w-6 items-center justify-center rounded-lg border border-transparent text-zinc-500 transition-colors hover:border-white/[0.1] hover:bg-white/[0.05] hover:text-zinc-300">
                      <X size={12} strokeWidth={2} />
                    </button>
                  </div>
                </div>

                <div
                  className="relative z-10 flex-1 overflow-y-auto px-3.5 py-3"
                  style={{ minHeight: historyPanelSize.listMinHeight }}>
                  {isLoadingMessages ? (
                    <div className="flex items-center justify-center gap-2 py-6">
                      <Loader2 size={12} className="animate-spin text-zinc-600" />
                      <span className="text-[10px] text-zinc-600">Loading history...</span>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center gap-2.5 py-8">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04]">
                        <MessageSquare size={14} className="text-zinc-600" strokeWidth={1.5} />
                      </span>
                      <p className="text-[10px] font-medium text-zinc-500">No messages in this dock</p>
                      <p className="text-[9px] text-zinc-600">Use update snapshot to save current conversation</p>
                      <button
                        type="button"
                        onClick={openPasteModal}
                        className="mt-1 rounded-lg border border-[#facc15]/30 bg-[#facc15]/10 px-2.5 py-1.5 text-[9px] font-semibold text-[#fde047] transition-colors hover:bg-[#facc15]/20">
                        Paste conversation manually
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      {messages.map((message) => (
                        <div
                          key={message.id}
                          className={[
                            "rounded-xl px-3 py-2.5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset]",
                            message.role === "user"
                              ? expandAllMessages
                                ? "ml-2 border border-[#facc15]/30 bg-[#231b08]/85"
                                : "ml-6 border border-[#facc15]/30 bg-[#231b08]/85"
                              : expandAllMessages
                                ? "mr-2 border border-white/[0.08] bg-[#0f1217]/85"
                                : "mr-6 border border-white/[0.08] bg-[#0f1217]/85"
                          ].join(" ")}>
                          <div className="mb-1.5 flex items-center gap-2">
                            <span
                              className={[
                                "flex h-4 w-4 shrink-0 items-center justify-center rounded-md",
                                message.role === "user" ? "bg-[#facc15]/20" : "bg-white/[0.08]"
                              ].join(" ")}>
                              <MessageSquare
                                size={8}
                                strokeWidth={2}
                                className={message.role === "user" ? "text-[#facc15]" : "text-zinc-500"}
                              />
                            </span>
                            <p
                              className={[
                                "text-[9px] font-semibold uppercase tracking-[0.14em]",
                                message.role === "user" ? "text-[#fde047]" : "text-zinc-500"
                              ].join(" ")}>
                              {message.role === "user" ? "you" : "notebooklm"}
                            </p>
                          </div>
                          <p
                            className={[
                              "whitespace-pre-wrap text-zinc-200",
                              expandAllMessages ? "text-[11px] leading-[1.68]" : "text-[10px] leading-[1.55]"
                            ].join(" ")}>
                            {!expandAllMessages && message.content.length > 480
                              ? `${message.content.slice(0, 480)}...`
                              : message.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="relative z-10 shrink-0 border-t border-[#facc15]/10 bg-black/20 px-3.5 py-3">
                  {actionFeedback && (
                    <p
                      className={[
                        "mb-2 rounded-lg border px-2 py-1.5 text-[9px] font-medium",
                        actionFeedback.type === "error"
                          ? "border-red-500/30 bg-red-500/10 text-red-300"
                          : "border-[#facc15]/30 bg-[#facc15]/10 text-[#fde047]"
                      ].join(" ")}>
                      {actionFeedback.text}
                    </p>
                  )}

                  <div className="grid gap-1.5">
                    <div className="rounded-xl border border-[#facc15]/20 bg-[#1a1607]/55 p-2">
                      <p className="px-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#fde68a]">
                        AI summary mode
                      </p>
                      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSummaryReuseMode("summary_only")}
                          className={[
                            "rounded-lg border px-2 py-1.5 text-[9px] font-medium transition-colors",
                            summaryReuseMode === "summary_only"
                              ? "border-[#facc15]/45 bg-[#facc15]/18 text-[#fef3c7]"
                              : "border-white/[0.1] bg-white/[0.04] text-zinc-400 hover:border-[#facc15]/25 hover:text-zinc-200"
                          ].join(" ")}>
                          Summary only
                        </button>

                        <button
                          type="button"
                          onClick={() => setSummaryReuseMode("summary_with_conversation")}
                          className={[
                            "rounded-lg border px-2 py-1.5 text-[9px] font-medium transition-colors",
                            summaryReuseMode === "summary_with_conversation"
                              ? "border-[#facc15]/45 bg-[#facc15]/18 text-[#fef3c7]"
                              : "border-white/[0.1] bg-white/[0.04] text-zinc-400 hover:border-[#facc15]/25 hover:text-zinc-200"
                          ].join(" ")}>
                          Summary + full conversation
                        </button>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleUseAiSummary}
                      disabled={messages.length === 0 || isLoadingMessages}
                      className="flex items-center justify-between rounded-xl border border-[#facc15]/35 bg-[#2a2008]/70 px-3 py-2.5 text-left transition-colors hover:border-[#facc15]/55 hover:bg-[#33280a]/85 disabled:cursor-default disabled:opacity-40">
                      <span className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-md border border-[#facc15]/30 bg-[#facc15]/18">
                          <Sparkles size={10} strokeWidth={2} className="text-[#facc15]" />
                        </span>
                        <span className="text-[10px] font-medium text-[#fef3c7]">
                          Reuse with AI summary
                        </span>
                      </span>
                      <span className="text-[9px] text-[#fde68a]">
                        {summaryReuseMode === "summary_only" ? "Summary only" : "Summary + chat"}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={handlePasteFullConversationOnly}
                      disabled={messages.length === 0 || isLoadingMessages}
                      className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-[#0d1117]/85 px-3 py-2.5 text-left transition-colors hover:border-[#facc15]/25 hover:bg-[#121823] disabled:cursor-default disabled:opacity-40">
                      <span className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-md border border-[#facc15]/20 bg-[#facc15]/12">
                          <ArrowUpRight size={10} strokeWidth={2} className="text-[#facc15]" />
                        </span>
                        <span className="text-[10px] font-medium text-zinc-200">
                          Paste full conversation only
                        </span>
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={handleGenerateNextPrompt}
                      disabled={messages.length === 0 || isLoadingMessages}
                      className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-[#0d1117]/85 px-3 py-2.5 text-left transition-colors hover:border-[#facc15]/25 hover:bg-[#121823] disabled:cursor-default disabled:opacity-40">
                      <span className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-md border border-[#facc15]/20 bg-[#facc15]/12">
                          <Wand2 size={10} strokeWidth={2} className="text-[#facc15]" />
                        </span>
                        <span className="text-[10px] font-medium text-zinc-200">
                          Generate next prompt
                        </span>
                      </span>
                    </button>
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => void handleUpdateDockSnapshot()}
                      disabled={!activeThread || isLoadingMessages || isUpdatingDockSnapshot}
                      title="Update dock snapshot"
                      aria-label="Update dock snapshot"
                      className="flex h-10 w-full items-center justify-center rounded-xl border border-white/[0.08] bg-[#0d1117]/90 text-zinc-300 transition-colors hover:border-[#facc15]/35 hover:bg-[#121823] hover:text-[#facc15] disabled:cursor-default disabled:opacity-40">
                      {isUpdatingDockSnapshot ? (
                        <Loader2 size={14} strokeWidth={2.1} className="animate-spin" />
                      ) : (
                        <RefreshCw size={14} strokeWidth={2.1} />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleSendToNotes()}
                      disabled={messages.length === 0 || isLoadingMessages}
                      title="Send to notes"
                      aria-label="Send to notes"
                      className="flex h-10 w-full items-center justify-center rounded-xl border border-white/[0.08] bg-[#0d1117]/90 text-zinc-300 transition-colors hover:border-[#facc15]/35 hover:bg-[#121823] hover:text-[#facc15] disabled:cursor-default disabled:opacity-40">
                      <FileText size={14} strokeWidth={2.1} />
                    </button>

                    <button
                      type="button"
                      onClick={(event) => {
                        if (!activeThread) {
                          return
                        }
                        void handleDeleteDock(activeThread.id, event)
                      }}
                      disabled={!activeThread}
                      title={isConfirmDeleteActive ? "Click again to delete dock" : "Delete dock"}
                      aria-label={isConfirmDeleteActive ? "Confirm delete dock" : "Delete dock"}
                      className={[
                        "flex h-10 w-full items-center justify-center rounded-xl border text-zinc-300 transition-colors disabled:cursor-default disabled:opacity-40",
                        isConfirmDeleteActive
                          ? "border-red-500/45 bg-red-500/15 text-red-300 hover:bg-red-500/20"
                          : "border-white/[0.08] bg-[#0d1117]/90 hover:border-[#facc15]/35 hover:bg-[#121823] hover:text-[#facc15]"
                      ].join(" ")}>
                      <Trash2 size={14} strokeWidth={2.1} />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait">
        {showCreateModal && (
          <>
            <motion.div
              key="modal-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={closeCreateModal}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.65)",
                zIndex: 2147483646
              }}
            />

            <motion.div
              key="modal-card"
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 2147483647,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 24
              }}>
              <div
                style={{
                  width: 320,
                  background: "#0f0f0f",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 16,
                  padding: "20px 20px 16px",
                  boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
                  fontFamily: "system-ui, -apple-system, sans-serif"
                }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 16
                  }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        background: "rgba(250,204,21,0.1)"
                      }}>
                      <CreateDockIcon size={12} strokeWidth={2.5} color="#facc15" />
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#ffffff",
                        letterSpacing: "-0.01em"
                      }}>
                      New dock
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={closeCreateModal}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      border: "none",
                      background: "transparent",
                      color: "#71717a",
                      cursor: "pointer"
                    }}>
                    <X size={13} strokeWidth={2} />
                  </button>
                </div>

                <p style={{ marginBottom: 8, fontSize: 11, color: "#71717a", fontWeight: 500 }}>
                  Dock name
                </p>

                <input
                  ref={createInputRef}
                  type="text"
                  value={newDockName}
                  onChange={(event) => setNewDockName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && newDockName.trim()) void handleCreateDock()
                    if (event.key === "Escape") closeCreateModal()
                  }}
                  placeholder="Ex: Offer angles..."
                  maxLength={60}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    padding: "9px 12px",
                    fontSize: 13,
                    color: "#ffffff",
                    outline: "none",
                    marginBottom: 12
                  }}
                />

                <p style={{ marginBottom: 8, fontSize: 11, color: "#71717a", fontWeight: 500 }}>
                  Conversation theme
                </p>

                <input
                  type="text"
                  value={newDockTopic}
                  onChange={(event) => setNewDockTopic(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && newDockName.trim()) void handleCreateDock()
                    if (event.key === "Escape") closeCreateModal()
                  }}
                  placeholder="Ex: Luxury copywriting"
                  maxLength={120}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    padding: "9px 12px",
                    fontSize: 13,
                    color: "#ffffff",
                    outline: "none",
                    marginBottom: 12
                  }}
                />

                <p style={{ marginBottom: 8, fontSize: 11, color: "#71717a", fontWeight: 500 }}>
                  Organization icon
                </p>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                    gap: 6,
                    marginBottom: createError ? 8 : 16
                  }}>
                  {DOCK_ICON_OPTIONS.map((option) => {
                    const OptionIcon = option.Icon
                    const isActive = option.value === newDockIcon
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setNewDockIcon(option.value)}
                        title={option.label}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          height: 32,
                          borderRadius: 8,
                          border: isActive
                            ? "1px solid rgba(250,204,21,0.75)"
                            : "1px solid rgba(255,255,255,0.12)",
                          background: isActive ? "rgba(250,204,21,0.14)" : "rgba(255,255,255,0.03)",
                          color: isActive ? "#facc15" : "#a1a1aa",
                          cursor: "pointer"
                        }}>
                        <OptionIcon size={14} strokeWidth={2.2} />
                      </button>
                    )
                  })}
                </div>

                {createError && (
                  <p style={{ marginBottom: 12, fontSize: 10, color: "#ef4444", lineHeight: 1.4 }}>
                    {createError}
                  </p>
                )}

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={closeCreateModal}
                    style={{
                      padding: "7px 14px",
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: "transparent",
                      color: "#a1a1aa",
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: "pointer"
                    }}>
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleCreateDock()}
                    disabled={!newDockName.trim() || isCreating}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "7px 16px",
                      borderRadius: 8,
                      border: "none",
                      background: newDockName.trim() && !isCreating ? "#facc15" : "#3f3f46",
                      color: newDockName.trim() && !isCreating ? "#000000" : "#71717a",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: newDockName.trim() && !isCreating ? "pointer" : "default"
                    }}>
                    {isCreating ? (
                      <>
                        <Loader2 size={11} className="animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Plus size={11} strokeWidth={2.5} />
                        Create
                      </>
                    )}
                  </button>
                </div>

                <img
                  src={MINDDOCK_LOGO_SRC}
                  alt="MindDock"
                  style={{
                    display: "block",
                    height: 16,
                    width: "auto",
                    margin: "14px auto 0",
                    opacity: 0.8
                  }}
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showPasteModal && (
          <>
            <motion.div
              key="paste-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={closePasteModal}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.65)",
                zIndex: 2147483646
              }}
            />

            <motion.div
              key="paste-card"
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 2147483647,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 24
              }}>
              <div
                style={{
                  width: 420,
                  maxWidth: "92vw",
                  background: "#0f0f0f",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 16,
                  padding: "20px 20px 16px",
                  boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
                  fontFamily: "system-ui, -apple-system, sans-serif"
                }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 12
                  }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        background: "rgba(250,204,21,0.1)"
                      }}>
                      <MessageSquare size={12} strokeWidth={2.3} color="#facc15" />
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#ffffff",
                        letterSpacing: "-0.01em"
                      }}>
                      Paste conversation into dock
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={closePasteModal}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      border: "none",
                      background: "transparent",
                      color: "#71717a",
                      cursor: "pointer"
                    }}>
                    <X size={13} strokeWidth={2} />
                  </button>
                </div>

                <p style={{ marginBottom: 8, fontSize: 11, color: "#71717a", lineHeight: 1.5 }}>
                  Paste plain text. Prefer this format:
                  <br />
                  <span style={{ color: "#a1a1aa" }}>User: ...</span>
                  <br />
                  <span style={{ color: "#a1a1aa" }}>NotebookLM: ...</span>
                </p>

                <textarea
                  ref={pasteInputRef}
                  value={pasteInputValue}
                  onChange={(event) => setPasteInputValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      closePasteModal()
                    }

                    if (
                      event.key === "Enter" &&
                      (event.ctrlKey || event.metaKey) &&
                      !isSavingPastedConversation
                    ) {
                      event.preventDefault()
                      void handleSavePastedConversation()
                    }
                  }}
                  placeholder={"User: ...\nNotebookLM: ...\nUser: ..."}
                  style={{
                    width: "100%",
                    minHeight: 180,
                    maxHeight: 320,
                    resize: "vertical",
                    boxSizing: "border-box",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    padding: "10px 12px",
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: "#ffffff",
                    outline: "none",
                    marginBottom: pasteError ? 8 : 12
                  }}
                />

                {pasteError && (
                  <p style={{ marginBottom: 10, fontSize: 10, color: "#ef4444", lineHeight: 1.4 }}>
                    {pasteError}
                  </p>
                )}

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={closePasteModal}
                    style={{
                      padding: "7px 14px",
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: "transparent",
                      color: "#a1a1aa",
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: "pointer"
                    }}>
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleSavePastedConversation()}
                    disabled={!pasteInputValue.trim() || isSavingPastedConversation}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "7px 16px",
                      borderRadius: 8,
                      border: "none",
                      background:
                        pasteInputValue.trim() && !isSavingPastedConversation ? "#facc15" : "#3f3f46",
                      color: pasteInputValue.trim() && !isSavingPastedConversation ? "#000000" : "#71717a",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: pasteInputValue.trim() && !isSavingPastedConversation ? "pointer" : "default"
                    }}>
                    {isSavingPastedConversation ? (
                      <>
                        <Loader2 size={11} className="animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <MessageSquare size={11} strokeWidth={2.5} />
                        Save to dock
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showClearConversationModal && (
          <>
            <motion.div
              key="clear-conversation-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => resolveClearConversationConfirmation(false)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.65)",
                zIndex: 2147483646
              }}
            />

            <motion.div
              key="clear-conversation-card"
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 2147483647,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 24
              }}>
              <div
                style={{
                  width: 480,
                  maxWidth: "94vw",
                  background: "#0f0f0f",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 16,
                  padding: "20px 20px 16px",
                  boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
                  fontFamily: "system-ui, -apple-system, sans-serif"
                }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 12
                  }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        background: "rgba(250,204,21,0.12)"
                      }}>
                      <Trash2 size={12} strokeWidth={2.3} color="#facc15" />
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#ffffff",
                        letterSpacing: "-0.01em"
                      }}>
                      Clear conversation to start fresh?
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => resolveClearConversationConfirmation(false)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      border: "none",
                      background: "transparent",
                      color: "#71717a",
                      cursor: "pointer"
                    }}>
                    <X size={13} strokeWidth={2} />
                  </button>
                </div>

                <div style={{ marginBottom: 14, color: "#d4d4d8", fontSize: 12, lineHeight: 1.6 }}>
                  <p style={{ margin: 0 }}>
                    Your full conversation is already saved in{" "}
                    <span style={{ color: "#facc15", fontWeight: 600 }}>
                      Dock "{clearConversationContext?.dockName ?? "current dock"}"
                    </span>
                    .
                  </p>
                  <p style={{ margin: "8px 0 0" }}>
                    You will not lose anything saved in Docks.
                  </p>
                  <p style={{ margin: "8px 0 0", color: "#fde68a", fontWeight: 600 }}>
                    Safe to clear: your full content is already stored in this Dock.
                  </p>
                  <p style={{ margin: "8px 0 0" }}>
                    This clears only NotebookLM conversation history to keep focus on a new chat.
                  </p>
                  <p style={{ margin: "8px 0 0" }}>
                    Your sources stay connected and unchanged.
                  </p>
                </div>

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => resolveClearConversationConfirmation(false)}
                    style={{
                      padding: "7px 14px",
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: "transparent",
                      color: "#a1a1aa",
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: "pointer"
                    }}>
                    Keep history
                  </button>

                  <button
                    type="button"
                    onClick={() => resolveClearConversationConfirmation(true)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "7px 16px",
                      borderRadius: 8,
                      border: "none",
                      background: "#facc15",
                      color: "#000000",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer"
                    }}>
                    <Trash2 size={11} strokeWidth={2.4} />
                    Clear history
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
