/**
 * Docks bar for NotebookLM.
 * Demo mode is local-only so the UI works for recording without saving to Supabase.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  FileText,
  Hash,
  Loader2,
  MessageSquare,
  Plus,
  Trash2,
  Wand2,
  X
} from "lucide-react"

import { useAuth } from "~/hooks/useAuth"
import { MESSAGE_ACTIONS } from "~/lib/contracts"
import type { Thread, ThreadMessage } from "~/lib/types"
import { captureVisibleMessages, triggerNotebookNewConversation } from "./sourceDom"

const MAX_VISIBLE = 3
const DOCKS_DEMO_MODE = true
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

function truncateText(value: string, maxLength: number): string {
  const normalized = value.trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength).trimEnd()}...`
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

function buildDemoThread(userId: string, notebookId: string, name: string, index: number): Thread {
  const now = new Date().toISOString()
  return {
    id: `demo-dock-${notebookId}-${index}-${Date.now()}`,
    userId,
    notebookId,
    name,
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
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [actionFeedback, setActionFeedback] = useState<{
    type: "success" | "error"
    text: string
  } | null>(null)
  const createInputRef = useRef<HTMLInputElement | null>(null)
  const actionFeedbackTimeoutRef = useRef<number | null>(null)

  const openNativeNewConversation = useCallback(() => {
    ;[120, 360, 720].forEach((delay) => {
      window.setTimeout(() => {
        void triggerNotebookNewConversation()
      }, delay)
    })
  }, [])

  useEffect(() => {
    if (showCreateModal && createInputRef.current) {
      createInputRef.current.focus()
      createInputRef.current.select()
    }
  }, [showCreateModal])

  useEffect(() => {
    return () => {
      if (actionFeedbackTimeoutRef.current) {
        window.clearTimeout(actionFeedbackTimeoutRef.current)
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
        command: "MINDDOCK_THREAD_LIST",
        payload: { userId: user.id, notebookId: notebookId.current }
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
    async (threadId: string) => {
      const captured = captureVisibleMessages()
      if (captured.length === 0) return

      if (DOCKS_DEMO_MODE) {
        if (!user || !notebookId.current) return

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
        return
      }

      await chrome.runtime.sendMessage({
        command: "MINDDOCK_THREAD_SAVE_MESSAGES",
        payload: { threadId, messages: captured }
      })
    },
    [user]
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
        command: "MINDDOCK_THREAD_MESSAGES",
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
      setHistoryOpen((value) => !value)
      return
    }

    if (activeId) {
      await saveCurrentToDock(activeId)
    }

    setActiveId(thread.id)
    setHistoryOpen(true)
    await loadMessages(thread.id)
    setThreads((prev) =>
      prev.map((item) => (item.id === thread.id ? { ...item, updatedAt: new Date().toISOString() } : item))
    )
  }

  function handleUseInCurrentChat() {
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
    const context = extractDockContext(messages)
    const dockContextBlock = [
      `Context from my saved dock "${activeThread.name}":`,
      "",
      `Original question: ${context.question}`,
      "",
      "Saved insight:",
      context.insight,
      "",
      "Use this saved context to continue the current conversation."
    ].join("\n")

    const nextValue = currentValue ? `${currentValue}\n\n${dockContextBlock}` : dockContextBlock

    writeComposerValue(composer, nextValue)
    setHistoryOpen(false)
    pushActionFeedback("Dock context inserted into the current chat.")
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
    setCreateError(null)
    setShowCreateModal(true)
  }

  function closeCreateModal() {
    setShowCreateModal(false)
    setCreateError(null)
  }

  async function handleCreateDock() {
    const name = newDockName.trim()
    if (!name || !user || !notebookId.current) return

    setIsCreating(true)
    setCreateError(null)

    if (DOCKS_DEMO_MODE) {
      const thread = buildDemoThread(user.id, notebookId.current, name, threads.length)
      const nextThreads = [thread, ...threads]
      const starterMessages = buildLightCopyStarterMessages(thread.id)
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
      setIsCreating(false)
      closeCreateModal()
      openNativeNewConversation()
      return
    }

    const res = await chrome.runtime.sendMessage({
      command: "MINDDOCK_THREAD_CREATE",
      payload: { userId: user.id, notebookId: notebookId.current, name }
    })

    setIsCreating(false)

    if (res?.success) {
      const thread: Thread = res.payload?.thread ?? res.data?.thread
      setThreads((prev) => [thread, ...prev])
      setActiveId(thread.id)
      setMessages([])
      setHistoryOpen(false)
      closeCreateModal()
      openNativeNewConversation()
    } else {
      setCreateError(res?.error ?? "Failed to create dock.")
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
        command: "MINDDOCK_THREAD_DELETE",
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
      command: "MINDDOCK_THREAD_RENAME",
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

  return (
    <>
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
                const isConfirmDelete = confirmDeleteId === thread.id

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
                    <Hash
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
                      <span className="truncate text-[10px] font-medium">{thread.name}</span>
                    )}

                    <button
                      type="button"
                      onClick={(event) => void handleDeleteDock(thread.id, event)}
                      className={[
                        "shrink-0 rounded transition-all",
                        isConfirmDelete
                          ? "text-red-500 opacity-100"
                          : "opacity-0 group-hover:opacity-60 hover:!opacity-100"
                      ].join(" ")}>
                      <Trash2 size={8} strokeWidth={2} />
                    </button>

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

        <AnimatePresence>
          {historyOpen && activeThread && (
            <motion.div
              key="dock-history"
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full z-50 mt-1"
              style={{ minWidth: 280, maxWidth: 360 }}>
              <div
                className="rounded-xl border border-white/10 bg-[#0f0f0f] shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
                style={{ maxHeight: 320, display: "flex", flexDirection: "column" }}>
                <div className="flex items-center justify-between border-b border-white/[0.07] px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[#facc15]/10">
                      <Hash size={9} strokeWidth={2.5} className="text-[#facc15]" />
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                      {activeThread.name}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setHistoryOpen(false)}
                    className="flex h-5 w-5 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-white/[0.06] hover:text-zinc-300">
                    <X size={12} strokeWidth={2} />
                  </button>
                </div>

                <div className="overflow-y-auto px-3 py-2.5" style={{ maxHeight: 270 }}>
                  {isLoadingMessages ? (
                    <div className="flex items-center justify-center gap-2 py-6">
                      <Loader2 size={12} className="animate-spin text-zinc-600" />
                      <span className="text-[10px] text-zinc-600">Loading history...</span>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-8">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.04]">
                        <MessageSquare size={14} className="text-zinc-700" strokeWidth={1.5} />
                      </span>
                      <p className="text-[10px] text-zinc-600">No messages in this dock</p>
                      <p className="text-[9px] text-zinc-700">Switch docks to save the conversation</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {messages.map((message) => (
                        <div
                          key={message.id}
                          className={[
                            "rounded-lg px-2.5 py-2",
                            message.role === "user"
                              ? "ml-6 border border-[#facc15]/[0.12] bg-[#facc15]/[0.07]"
                              : "mr-6 border border-white/[0.07] bg-white/[0.03]"
                          ].join(" ")}>
                          <div className="mb-1 flex items-center gap-1.5">
                            <span
                              className={[
                                "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm",
                                message.role === "user" ? "bg-[#facc15]/20" : "bg-white/[0.06]"
                              ].join(" ")}>
                              <MessageSquare
                                size={7}
                                strokeWidth={2}
                                className={message.role === "user" ? "text-[#facc15]" : "text-zinc-500"}
                              />
                            </span>
                            <p
                              className={[
                                "text-[9px] font-semibold uppercase tracking-[0.1em]",
                                message.role === "user" ? "text-[#facc15]/60" : "text-zinc-600"
                              ].join(" ")}>
                              {message.role === "user" ? "you" : "notebooklm"}
                            </p>
                          </div>
                          <p className="whitespace-pre-wrap text-[10px] leading-[1.55] text-zinc-300">
                            {message.content.length > 280
                              ? `${message.content.slice(0, 280)}...`
                              : message.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-t border-white/[0.07] px-3 py-2.5">
                  {actionFeedback && (
                    <p
                      className={[
                        "mb-2 text-[9px] font-medium",
                        actionFeedback.type === "error" ? "text-red-400" : "text-[#facc15]/80"
                      ].join(" ")}>
                      {actionFeedback.text}
                    </p>
                  )}

                  <div className="grid gap-1.5">
                    <button
                      type="button"
                      onClick={handleUseInCurrentChat}
                      disabled={messages.length === 0 || isLoadingMessages}
                      className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-2 text-left transition-colors hover:border-[#facc15]/20 hover:bg-[#facc15]/[0.05] disabled:cursor-default disabled:opacity-40">
                      <span className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[#facc15]/10">
                          <ArrowUpRight size={10} strokeWidth={2} className="text-[#facc15]" />
                        </span>
                        <span className="text-[10px] font-medium text-zinc-200">
                          Use in current chat
                        </span>
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={handleGenerateNextPrompt}
                      disabled={messages.length === 0 || isLoadingMessages}
                      className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-2 text-left transition-colors hover:border-[#facc15]/20 hover:bg-[#facc15]/[0.05] disabled:cursor-default disabled:opacity-40">
                      <span className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[#facc15]/10">
                          <Wand2 size={10} strokeWidth={2} className="text-[#facc15]" />
                        </span>
                        <span className="text-[10px] font-medium text-zinc-200">
                          Generate next prompt
                        </span>
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleSendToNotes()}
                      disabled={messages.length === 0 || isLoadingMessages}
                      className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-2 text-left transition-colors hover:border-[#facc15]/20 hover:bg-[#facc15]/[0.05] disabled:cursor-default disabled:opacity-40">
                      <span className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[#facc15]/10">
                          <FileText size={10} strokeWidth={2} className="text-[#facc15]" />
                        </span>
                        <span className="text-[10px] font-medium text-zinc-200">
                          Send to notes
                        </span>
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
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
                      <Hash size={12} strokeWidth={2.5} color="#facc15" />
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
                    marginBottom: createError ? 8 : 16
                  }}
                />

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
    </>
  )
}
