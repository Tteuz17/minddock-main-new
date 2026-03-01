/**
 * Focus Threads — barra compacta no header do NotebookLM.
 * Mostra as últimas 3 threads + botão "+". Design flat, sem glass.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Plus, Trash2, ChevronDown, ChevronUp, Loader2, MessageSquare, Hash } from "lucide-react"

import { useAuth } from "~/hooks/useAuth"
import type { Thread, ThreadMessage } from "~/lib/types"
import { captureVisibleMessages } from "./sourceDom"

const MAX_VISIBLE = 3

function getNotebookIdFromUrl(): string {
  const match = window.location.pathname.match(/\/notebook\/([^/?#]+)/)
  return match?.[1] ?? ""
}

export function FocusThreadsBar() {
  const { user, isLoading: authLoading } = useAuth()
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

  // ── Load threads ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user || !notebookId.current) return
    setIsLoadingThreads(true)
    chrome.runtime.sendMessage({
      command: "MINDDOCK_THREAD_LIST",
      payload: { userId: user.id, notebookId: notebookId.current }
    }).then((res) => {
      if (res?.success) {
        const list: Thread[] = res.payload?.threads ?? res.data?.threads ?? []
        setThreads(list)
      }
    }).finally(() => setIsLoadingThreads(false))
  }, [user])

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  // ── Actions ─────────────────────────────────────────────────────────────────

  const saveCurrentToThread = useCallback(async (threadId: string) => {
    const captured = captureVisibleMessages()
    if (captured.length === 0) return
    await chrome.runtime.sendMessage({
      command: "MINDDOCK_THREAD_SAVE_MESSAGES",
      payload: { threadId, messages: captured }
    })
  }, [])

  const loadMessages = useCallback(async (threadId: string) => {
    setIsLoadingMessages(true)
    const res = await chrome.runtime.sendMessage({
      command: "MINDDOCK_THREAD_MESSAGES",
      payload: { threadId }
    })
    const msgs: ThreadMessage[] = res?.payload?.messages ?? res?.data?.messages ?? []
    setMessages(msgs)
    setIsLoadingMessages(false)
  }, [])

  async function handleSelectThread(thread: Thread) {
    if (thread.id === activeId) {
      setHistoryOpen((v) => !v)
      return
    }
    if (activeId) await saveCurrentToThread(activeId)
    setActiveId(thread.id)
    setHistoryOpen(true)
    await loadMessages(thread.id)
    setThreads((prev) =>
      prev.map((t) => (t.id === thread.id ? { ...t, updatedAt: new Date().toISOString() } : t))
    )
  }

  async function handleCreateThread() {
    if (!user || !notebookId.current) return
    const name = `Thread ${threads.length + 1}`
    const res = await chrome.runtime.sendMessage({
      command: "MINDDOCK_THREAD_CREATE",
      payload: { userId: user.id, notebookId: notebookId.current, name }
    })
    if (res?.success) {
      const thread: Thread = res.payload?.thread ?? res.data?.thread
      setThreads((prev) => [thread, ...prev])
      setActiveId(thread.id)
      setMessages([])
      setHistoryOpen(false)
    } else {
      console.error("[MindDock] Thread create failed:", res?.error ?? "unknown error")
      alert(`[MindDock] Erro ao criar thread: ${res?.error ?? "verifique se a migration SQL foi aplicada no Supabase"}`)
    }
  }

  async function handleDeleteThread(threadId: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (confirmDeleteId !== threadId) {
      setConfirmDeleteId(threadId)
      setTimeout(() => setConfirmDeleteId(null), 2500)
      return
    }
    setConfirmDeleteId(null)
    await chrome.runtime.sendMessage({
      command: "MINDDOCK_THREAD_DELETE",
      payload: { threadId }
    })
    setThreads((prev) => prev.filter((t) => t.id !== threadId))
    if (activeId === threadId) {
      setActiveId(null)
      setHistoryOpen(false)
      setMessages([])
    }
  }

  function handleDoubleClick(thread: Thread, e: React.MouseEvent) {
    e.stopPropagation()
    setRenamingId(thread.id)
    setRenameValue(thread.name)
  }

  async function commitRename() {
    if (!renamingId || !renameValue.trim()) { setRenamingId(null); return }
    const res = await chrome.runtime.sendMessage({
      command: "MINDDOCK_THREAD_RENAME",
      payload: { threadId: renamingId, name: renameValue.trim() }
    })
    if (res?.success) {
      const updated: Thread = res.payload?.thread ?? res.data?.thread
      setThreads((prev) => prev.map((t) => (t.id === renamingId ? updated : t)))
    }
    setRenamingId(null)
  }

  // ── Guards ──────────────────────────────────────────────────────────────────

  if (!notebookId.current) return null

  // Sem login: mostra placeholders vazios + botão "+"
  if (!user) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: "5px",
            background: "#27272a", borderRadius: "8px",
            padding: "5px 10px", opacity: 0.5
          }}>
            <Hash size={9} strokeWidth={2.5} color="#71717a" />
            <span style={{ fontSize: "10px", color: "#71717a", fontFamily: "system-ui, sans-serif" }}>
              Thread {i + 1}
            </span>
          </div>
        ))}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "#27272a", borderRadius: "8px",
          padding: "5px 8px", opacity: 0.5, cursor: "default"
        }}>
          <Plus size={11} strokeWidth={2.5} color="#71717a" />
        </div>
      </div>
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const visibleThreads = threads.slice(0, MAX_VISIBLE)
  const activeThread = threads.find((t) => t.id === activeId)

  return (
    <div className="flex flex-col">

      {/* ── Compact bar ── */}
      <div className="flex items-center gap-1">

        {isLoadingThreads ? (
          <div className="flex items-center gap-1.5 px-1">
            <Loader2 size={10} className="animate-spin text-zinc-600" />
            <span className="text-[10px] text-zinc-600">Carregando…</span>
          </div>
        ) : (
          <>
            {visibleThreads.map((thread, idx) => {
              const isActive = thread.id === activeId
              const isConfirmDelete = confirmDeleteId === thread.id
              return (
                <div
                  key={thread.id}
                  className={[
                    "group relative flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 cursor-pointer select-none transition-all duration-150",
                    isActive
                      ? "bg-[#facc15] text-black shadow-[0_2px_8px_rgba(250,204,21,0.3)]"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white"
                  ].join(" ")}
                  style={{ maxWidth: 130 }}
                  onClick={() => handleSelectThread(thread)}
                  onDoubleClick={(e) => handleDoubleClick(thread, e)}>

                  {/* Icon */}
                  <Hash
                    size={9}
                    strokeWidth={2.5}
                    className={isActive ? "text-black/60 shrink-0" : "text-zinc-500 shrink-0"}
                  />

                  {/* Name / rename input */}
                  {renamingId === thread.id ? (
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void commitRename()
                        if (e.key === "Escape") setRenamingId(null)
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-16 bg-transparent text-[10px] font-medium outline-none"
                    />
                  ) : (
                    <span className="truncate text-[10px] font-medium">{thread.name}</span>
                  )}

                  {/* Delete (hover) */}
                  <button
                    type="button"
                    onClick={(e) => void handleDeleteThread(thread.id, e)}
                    className={[
                      "shrink-0 rounded transition-all",
                      isConfirmDelete
                        ? "opacity-100 text-red-500"
                        : "opacity-0 group-hover:opacity-60 hover:!opacity-100"
                    ].join(" ")}>
                    <Trash2 size={8} strokeWidth={2} />
                  </button>

                  {/* Chevron for active */}
                  {isActive && (
                    <span className="shrink-0 opacity-50">
                      {historyOpen
                        ? <ChevronUp size={8} strokeWidth={3} />
                        : <ChevronDown size={8} strokeWidth={3} />}
                    </span>
                  )}
                </div>
              )
            })}

            {/* Counter badge if more than MAX_VISIBLE */}
            {threads.length > MAX_VISIBLE && (
              <span className="flex items-center justify-center rounded-md bg-zinc-800 px-1.5 py-1 text-[9px] text-zinc-400">
                +{threads.length - MAX_VISIBLE}
              </span>
            )}

            {/* "+" new thread button */}
            <button
              type="button"
              onClick={() => void handleCreateThread()}
              title="Nova thread"
              className="flex shrink-0 items-center justify-center rounded-lg bg-zinc-800 p-1.5 text-zinc-400 hover:bg-[#facc15] hover:text-black transition-all duration-150">
              <Plus size={11} strokeWidth={2.5} />
            </button>
          </>
        )}
      </div>

      {/* ── History panel ── */}
      <AnimatePresence>
        {historyOpen && activeThread && (
          <motion.div
            key="thread-history"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full mt-1 z-50"
            style={{ minWidth: 280, maxWidth: 360 }}>

            <div className="rounded-xl border border-white/10 bg-[#0f0f0f] shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
              style={{ maxHeight: 320, display: "flex", flexDirection: "column" }}>

              {/* Header */}
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
                  className="flex h-5 w-5 items-center justify-center rounded-md text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-300 transition-colors text-[12px]">
                  ×
                </button>
              </div>

              {/* Messages */}
              <div className="overflow-y-auto px-3 py-2.5" style={{ maxHeight: 270 }}>
                {isLoadingMessages ? (
                  <div className="flex items-center justify-center gap-2 py-6">
                    <Loader2 size={12} className="animate-spin text-zinc-600" />
                    <span className="text-[10px] text-zinc-600">Carregando histórico…</span>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-8">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.04]">
                      <MessageSquare size={14} className="text-zinc-700" strokeWidth={1.5} />
                    </span>
                    <p className="text-[10px] text-zinc-600">Sem mensagens nesta thread</p>
                    <p className="text-[9px] text-zinc-700">Troque de thread para salvar a conversa</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={[
                          "rounded-lg px-2.5 py-2",
                          msg.role === "user"
                            ? "bg-[#facc15]/[0.07] border border-[#facc15]/[0.12] ml-6"
                            : "bg-white/[0.03] border border-white/[0.07] mr-6"
                        ].join(" ")}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={[
                            "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm",
                            msg.role === "user" ? "bg-[#facc15]/20" : "bg-white/[0.06]"
                          ].join(" ")}>
                            <MessageSquare
                              size={7}
                              strokeWidth={2}
                              className={msg.role === "user" ? "text-[#facc15]" : "text-zinc-500"}
                            />
                          </span>
                          <p className={[
                            "text-[9px] font-semibold uppercase tracking-[0.1em]",
                            msg.role === "user" ? "text-[#facc15]/60" : "text-zinc-600"
                          ].join(" ")}>
                            {msg.role === "user" ? "você" : "notebooklm"}
                          </p>
                        </div>
                        <p className="text-[10px] leading-[1.55] text-zinc-300 whitespace-pre-wrap">
                          {msg.content.length > 280
                            ? `${msg.content.slice(0, 280)}…`
                            : msg.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  )
}
