import { useState, useCallback, useEffect, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Layers,
  Plus,
  Trash2
} from "lucide-react"
import { URLS } from "~/lib/constants"
import { MESSAGE_ACTIONS } from "~/lib/contracts"
import { useNotebooks } from "~/hooks/useNotebooks"
import { useAuth } from "~/hooks/useAuth"
import { useSubscription } from "~/hooks/useSubscription"
import { UpgradePrompt } from "~/components/UpgradePrompt"
import type { Thread } from "~/lib/types"

interface DocksHubProps {
  onBack: () => void
}

interface DockListItem extends Thread {
  notebookTitle: string
}

export function DocksHub({ onBack }: DocksHubProps) {
  const { notebooks, isLoading } = useNotebooks()
  const { user } = useAuth()
  const { canUse } = useSubscription()
  const hasAccess = canUse("zettelkasten")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [docksByNotebook, setDocksByNotebook] = useState<Record<string, Thread[]>>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [isLoadingAllDocks, setIsLoadingAllDocks] = useState(false)
  const [creatingId, setCreatingId] = useState<string | null>(null)
  const [newDockName, setNewDockName] = useState("")
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const loadDocks = useCallback(
    async (
      notebookId: string,
      options?: { force?: boolean; silent?: boolean }
    ): Promise<Thread[]> => {
      const force = options?.force === true
      const silent = options?.silent === true

      if (!user) {
        return []
      }

      if (!force && docksByNotebook[notebookId]) {
        return docksByNotebook[notebookId]
      }

      if (!silent) {
        setLoadingId(notebookId)
      }

      setErrorMessage(null)
      try {
        const response = await chrome.runtime.sendMessage({
          command: MESSAGE_ACTIONS.THREAD_LIST,
          payload: { notebookId }
        })

        if (!response?.success) {
          throw new Error(String(response?.error ?? "Failed to load docks."))
        }

        const payload = (response.payload ?? response.data) as { threads?: Thread[] } | undefined
        const threads = payload?.threads ?? []
        setDocksByNotebook((prev) => ({ ...prev, [notebookId]: threads }))
        return threads
      } catch (error) {
        setDocksByNotebook((prev) => ({ ...prev, [notebookId]: [] }))
        setErrorMessage(error instanceof Error ? error.message : "Failed to load docks.")
        return []
      } finally {
        if (!silent) {
          setLoadingId((current) => (current === notebookId ? null : current))
        }
      }
    },
    [user, docksByNotebook]
  )

  useEffect(() => {
    if (!hasAccess || !user || isLoading || notebooks.length === 0) {
      return
    }

    const missingNotebookIds = notebooks
      .map((notebook) => notebook.id)
      .filter((notebookId) => docksByNotebook[notebookId] === undefined)

    if (missingNotebookIds.length === 0) {
      setIsLoadingAllDocks(false)
      return
    }

    let cancelled = false
    setIsLoadingAllDocks(true)

    void Promise.all(missingNotebookIds.map((notebookId) => loadDocks(notebookId, { silent: true }))).finally(
      () => {
        if (!cancelled) {
          setIsLoadingAllDocks(false)
        }
      }
    )

    return () => {
      cancelled = true
    }
  }, [hasAccess, user, isLoading, notebooks, docksByNotebook, loadDocks])

  const allDocks = useMemo<DockListItem[]>(() => {
    const merged = notebooks.flatMap((notebook) => {
      const notebookDocks = docksByNotebook[notebook.id] ?? []
      return notebookDocks.map((dock) => ({
        ...dock,
        notebookTitle: notebook.title
      }))
    })

    return merged.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  }, [notebooks, docksByNotebook])

  const loadedNotebookCount = useMemo(
    () => notebooks.filter((notebook) => docksByNotebook[notebook.id] !== undefined).length,
    [notebooks, docksByNotebook]
  )

  const toggleNotebook = (notebookId: string) => {
    if (expandedId === notebookId) {
      setExpandedId(null)
    } else {
      setExpandedId(notebookId)
      void loadDocks(notebookId)
    }
  }

  const handleCreateDock = async (notebookId: string) => {
    if (!user || !newDockName.trim()) return
    setCreatingId(notebookId)
    setErrorMessage(null)
    try {
      const response = await chrome.runtime.sendMessage({
        command: MESSAGE_ACTIONS.THREAD_CREATE,
        payload: { notebookId, name: newDockName.trim() }
      })

      if (!response?.success) {
        throw new Error(String(response?.error ?? "Failed to create dock."))
      }

      const payload = (response.payload ?? response.data) as { thread?: Thread } | undefined
      const thread = payload?.thread
      if (!thread) {
        throw new Error("Invalid response while creating dock.")
      }

      setDocksByNotebook((prev) => ({
        ...prev,
        [notebookId]: [thread, ...(prev[notebookId] ?? [])]
      }))
      setNewDockName("")
      setAddingTo(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create dock.")
    } finally {
      setCreatingId(null)
    }
  }

  const handleDeleteDock = async (notebookId: string, threadId: string) => {
    try {
      setErrorMessage(null)
      const response = await chrome.runtime.sendMessage({
        command: MESSAGE_ACTIONS.THREAD_DELETE,
        payload: { threadId }
      })
      if (!response?.success) {
        throw new Error(String(response?.error ?? "Failed to delete dock."))
      }

      setDocksByNotebook((prev) => ({
        ...prev,
        [notebookId]: (prev[notebookId] ?? []).filter((thread) => thread.id !== threadId)
      }))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete dock.")
    }
  }

  if (!hasAccess) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
          <button
            type="button"
            onClick={onBack}
            className="liquid-glass-soft flex h-7 w-7 items-center justify-center rounded-xl text-zinc-400 transition hover:-translate-y-px hover:text-white">
            <ArrowLeft size={14} strokeWidth={2} />
          </button>
          <div className="flex items-center gap-2">
            <h1 className="text-[13px] font-bold tracking-[-0.03em] text-white">Docks</h1>
            <span className="rounded-md bg-pink-400/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-pink-400">
              Focus
            </span>
          </div>
        </div>
        <div className="flex-1 px-3 py-3">
          <UpgradePrompt feature="Focus Docks" requiredTier="thinker" />
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-full flex-col bg-[#050505] text-white">
      <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
        <button
          type="button"
          onClick={onBack}
          className="liquid-glass-soft flex h-7 w-7 items-center justify-center rounded-xl text-zinc-400 transition hover:-translate-y-px hover:text-white">
          <ArrowLeft size={14} strokeWidth={2} />
        </button>
        <div className="flex items-center gap-2">
          <h1 className="text-[13px] font-bold tracking-[-0.03em] text-white">Docks</h1>
          <span className="rounded-md bg-pink-400/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-pink-400">
            Focus
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {errorMessage ? (
          <p className="mt-2 text-[10px] text-red-400">{errorMessage}</p>
        ) : null}
        <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">
          Each Dock is an isolated context inside a notebook - separate history, sources, and reasoning.
        </p>

        {isLoading ? (
          <div className="mt-6 flex items-center justify-center">
            <div className="h-4 w-4 animate-spin rounded-full border border-zinc-700 border-t-zinc-300" />
          </div>
        ) : notebooks.length === 0 ? (
          <div className="liquid-glass-panel mt-3 rounded-[18px] p-4 text-center">
            <Layers size={20} strokeWidth={1.4} className="mx-auto mb-2 text-zinc-600" />
            <p className="text-[11px] text-zinc-500">No notebooks found.</p>
            <p className="mt-0.5 text-[10px] text-zinc-600">Open NotebookLM to load them.</p>
          </div>
        ) : (
          <>
            <div className="liquid-glass-panel mt-3 rounded-[16px] p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-300">
                    All Focus Docks
                  </p>
                  <p className="mt-0.5 text-[9px] text-zinc-500">
                    {loadedNotebookCount}/{notebooks.length} notebooks synced
                  </p>
                </div>
                <div className="rounded-lg border border-white/10 px-2 py-1 text-[11px] font-semibold text-zinc-100">
                  {allDocks.length}
                </div>
              </div>

              {isLoadingAllDocks ? (
                <div className="mt-2 flex items-center gap-2 text-[10px] text-zinc-500">
                  <div className="h-3 w-3 animate-spin rounded-full border border-zinc-700 border-t-zinc-400" />
                  Loading all docks...
                </div>
              ) : allDocks.length === 0 ? (
                <p className="mt-2 text-[10px] text-zinc-600">No docks found for this account.</p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {allDocks.map((dock) => (
                    <div
                      key={`all-${dock.id}`}
                      className="group flex items-center justify-between rounded-xl bg-white/[0.02] px-2.5 py-1.5 transition hover:bg-white/[0.04]">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] text-zinc-200">{dock.name}</p>
                        <p className="text-[9px] text-zinc-500">{dock.notebookTitle}</p>
                      </div>
                      <div className="ml-2 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            chrome.tabs.create({
                              url: `${URLS.NOTEBOOKLM}/notebook/${dock.notebookId}`
                            })
                          }}
                          className="text-zinc-600 transition hover:text-zinc-300">
                          <ArrowUpRight size={11} strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteDock(dock.notebookId, dock.id)}
                          className="text-zinc-700 transition hover:text-red-400">
                          <Trash2 size={10} strokeWidth={1.8} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="mt-3 text-[9px] font-medium uppercase tracking-[0.12em] text-zinc-500">
              Manage by notebook
            </p>

            <div className="mt-1.5 space-y-1.5">
              {notebooks.map((notebook, i) => {
                const isOpen = expandedId === notebook.id
                const docks = docksByNotebook[notebook.id] ?? []
                const isLoadingDocks = loadingId === notebook.id

                return (
                  <motion.div
                    key={notebook.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15, delay: i * 0.03 }}>
                    <button
                      type="button"
                      onClick={() => toggleNotebook(notebook.id)}
                      className="liquid-glass-panel flex w-full items-center gap-2.5 rounded-[14px] px-3 py-2.5 text-left transition hover:border-white/[0.1]">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-pink-400/10">
                        <Layers size={12} strokeWidth={1.8} className="text-pink-300/80" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-medium text-white">{notebook.title}</p>
                        <p className="text-[9px] text-zinc-500">
                          {isOpen && !isLoadingDocks
                            ? `${docks.length} dock${docks.length !== 1 ? "s" : ""}`
                            : `${notebook.sourceCount ?? 0} sources`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            chrome.tabs.create({
                              url: `${URLS.NOTEBOOKLM}/notebook/${notebook.id}`
                            })
                          }}
                          className="text-zinc-600 transition hover:text-zinc-300">
                          <ArrowUpRight size={11} strokeWidth={2} />
                        </button>
                        {isOpen ? (
                          <ChevronDown size={11} strokeWidth={2} className="text-zinc-500" />
                        ) : (
                          <ChevronRight size={11} strokeWidth={2} className="text-zinc-500" />
                        )}
                      </div>
                    </button>

                    <AnimatePresence>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden">
                          <div className="ml-4 mt-1 space-y-1 border-l border-white/[0.06] pl-3">
                            {isLoadingDocks ? (
                              <div className="flex items-center gap-2 py-2 text-[10px] text-zinc-600">
                                <div className="h-3 w-3 animate-spin rounded-full border border-zinc-700 border-t-zinc-400" />
                                Loading docks...
                              </div>
                            ) : (
                              <>
                                {docks.length === 0 && addingTo !== notebook.id && (
                                  <p className="py-1.5 text-[10px] text-zinc-600">No docks yet.</p>
                                )}
                                {docks.map((dock) => (
                                  <div
                                    key={dock.id}
                                    className="group flex items-center justify-between rounded-xl px-2.5 py-1.5 transition hover:bg-white/[0.03]">
                                    <div className="flex min-w-0 items-center gap-2">
                                      <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-pink-400/50" />
                                      <span className="truncate text-[11px] text-zinc-300">
                                        {dock.name}
                                      </span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteDock(notebook.id, dock.id)}
                                      className="ml-2 shrink-0 text-zinc-700 opacity-0 transition hover:text-red-400 group-hover:opacity-100">
                                      <Trash2 size={10} strokeWidth={1.8} />
                                    </button>
                                  </div>
                                ))}

                                {addingTo === notebook.id ? (
                                  <div className="flex items-center gap-1.5 py-1">
                                    <input
                                      autoFocus
                                      type="text"
                                      value={newDockName}
                                      onChange={(event) => setNewDockName(event.target.value)}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                          void handleCreateDock(notebook.id)
                                        }
                                        if (event.key === "Escape") {
                                          setAddingTo(null)
                                          setNewDockName("")
                                        }
                                      }}
                                      placeholder="Dock name..."
                                      className="min-w-0 flex-1 rounded-lg bg-white/[0.06] px-2 py-1 text-[11px] text-white placeholder-zinc-600 outline-none ring-1 ring-white/[0.08] focus:ring-white/[0.16]"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => void handleCreateDock(notebook.id)}
                                      disabled={!newDockName.trim() || !!creatingId}
                                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-action/80 text-black disabled:opacity-40">
                                      {creatingId === notebook.id ? (
                                        <div className="h-2.5 w-2.5 animate-spin rounded-full border border-black/40 border-t-black" />
                                      ) : (
                                        <Plus size={11} strokeWidth={2.5} />
                                      )}
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAddingTo(notebook.id)
                                      setNewDockName("")
                                    }}
                                    className="flex items-center gap-1.5 py-1 text-[10px] text-zinc-600 transition hover:text-zinc-400">
                                    <Plus size={10} strokeWidth={2} />
                                    New Dock
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
