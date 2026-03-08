import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Highlighter,
  Plus,
  Trash2,
  X,
} from "lucide-react"
import {
  getFolders,
  getSnippets,
  createFolder,
  deleteFolder,
  deleteSnippet,
  DEFAULT_FOLDERS,
  FOLDER_ICONS,
  type HighlightFolder,
  type HighlightSnippet,
} from "~/services/highlight-storage"
import { URLS } from "~/lib/constants"

interface HighlightHubProps {
  onBack: () => void
}

const FOLDER_COLORS = [
  "#3b82f6","#8b5cf6","#f97316","#22c55e","#ef4444","#facc15","#ec4899","#06b6d4"
]

function formatDate(ts: number) {
  const d = new Date(ts)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function HighlightHub({ onBack }: HighlightHubProps) {
  const [folders, setFolders] = useState<HighlightFolder[]>([])
  const [snippetsByFolder, setSnippetsByFolder] = useState<Record<string, HighlightSnippet[]>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState(FOLDER_COLORS[0])
  const [newIcon, setNewIcon] = useState(FOLDER_ICONS[0])
  const [savingFolder, setSavingFolder] = useState(false)

  const loadFolders = useCallback(async () => {
    const loaded = await getFolders()
    setFolders(loaded)
  }, [])

  useEffect(() => {
    void loadFolders()

    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && (changes["minddock_highlight_folders"] || changes["minddock_highlights"])) {
        void loadFolders()
        // Refresh open folder's snippets
        setExpandedId((prev) => {
          if (prev) void loadSnippetsForFolder(prev)
          return prev
        })
      }
    }
    chrome.storage.onChanged.addListener(handler)
    return () => chrome.storage.onChanged.removeListener(handler)
  }, [loadFolders])

  const loadSnippetsForFolder = async (folderId: string) => {
    const snippets = await getSnippets(folderId)
    setSnippetsByFolder((prev) => ({ ...prev, [folderId]: snippets }))
  }

  const toggleFolder = (folderId: string) => {
    if (expandedId === folderId) {
      setExpandedId(null)
    } else {
      setExpandedId(folderId)
      void loadSnippetsForFolder(folderId)
    }
  }

  const handleCreateFolder = async () => {
    if (!newName.trim()) return
    setSavingFolder(true)
    try {
      await createFolder(newName.trim(), newColor, newIcon)
      await loadFolders()
      setNewName("")
      setNewColor(FOLDER_COLORS[0])
      setNewIcon(FOLDER_ICONS[0])
      setIsCreating(false)
    } finally {
      setSavingFolder(false)
    }
  }

  const handleDeleteFolder = async (folderId: string) => {
    await deleteFolder(folderId)
    if (expandedId === folderId) setExpandedId(null)
    setSnippetsByFolder((prev) => { const n = { ...prev }; delete n[folderId]; return n })
    await loadFolders()
  }

  const handleDeleteSnippet = async (folderId: string, snippetId: string) => {
    await deleteSnippet(snippetId)
    setSnippetsByFolder((prev) => ({
      ...prev,
      [folderId]: (prev[folderId] ?? []).filter((s) => s.id !== snippetId),
    }))
  }

  const handleSendToNotebookLM = async (snippet: HighlightSnippet) => {
    const sourceTitle = `Highlight - ${snippet.sourceTitle || "Untitled"} - ${Date.now()}`
    const sourceBody = [`Source: ${snippet.sourceTitle || "Untitled"}`, `URL: ${snippet.sourceUrl || "N/A"}`, "", snippet.text].join("\n")
    await chrome.storage.local.set({
      minddock_pending_selection: { text: sourceBody, sourceUrl: snippet.sourceUrl, sourceTitle, savedAt: Date.now() },
    })
    const tabs = await chrome.tabs.query({ url: "*://notebooklm.google.com/*" })
    if (tabs.length > 0) {
      chrome.tabs.update(tabs[0].id!, { active: true })
    } else {
      chrome.tabs.create({ url: URLS.NOTEBOOKLM })
    }
    await chrome.runtime.sendMessage({ command: "MINDDOCK_HIGHLIGHT_SNIPE", payload: { content: sourceBody, title: sourceTitle } })
  }

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text)
  }

  const totalSnippets = Object.values(snippetsByFolder).reduce((acc, s) => acc + s.length, 0)

  return (
    <div className="relative flex h-full flex-col bg-[#050505] text-white">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
        <button
          type="button"
          onClick={onBack}
          className="liquid-glass-soft flex h-7 w-7 items-center justify-center rounded-xl text-zinc-400 transition hover:-translate-y-px hover:text-white">
          <ArrowLeft size={14} strokeWidth={2} />
        </button>
        <div className="flex items-center gap-2">
          <h1 className="text-[13px] font-bold tracking-[-0.03em] text-white">Highlights</h1>
          <span className="rounded-md bg-emerald-400/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-emerald-400">
            {folders.length} folders
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsCreating((v) => !v)}
          className="ml-auto liquid-glass-soft flex h-7 w-7 items-center justify-center rounded-xl text-zinc-400 transition hover:text-white">
          {isCreating ? <X size={13} strokeWidth={2} /> : <Plus size={13} strokeWidth={2} />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {/* Tip */}
        <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">
          Select text in NotebookLM → the panel appears automatically above the selection.
        </p>

        {/* Create folder form */}
        <AnimatePresence>
          {isCreating && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden">
              <div className="liquid-glass-panel mt-2 rounded-[14px] p-3">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                  New folder
                </p>
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleCreateFolder() }}
                  placeholder="Folder name…"
                  className="w-full rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-[11px] text-white placeholder-zinc-600 outline-none ring-1 ring-white/[0.08] focus:ring-white/[0.16]"
                />
                {/* Icon picker */}
                <div className="mt-2 grid grid-cols-8 gap-1">
                  {FOLDER_ICONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setNewIcon(emoji)}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-[13px] transition hover:bg-white/[0.08]"
                      style={{
                        background: newIcon === emoji ? "rgba(250,204,21,0.12)" : undefined,
                        outline: newIcon === emoji ? "1px solid rgba(250,204,21,0.4)" : "none",
                      }}>
                      {emoji}
                    </button>
                  ))}
                </div>
                {/* Color + action */}
                <div className="mt-2 flex items-center gap-1.5">
                  {FOLDER_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewColor(color)}
                      className="h-4 w-4 rounded-full transition-transform hover:scale-110"
                      style={{
                        background: color,
                        outline: newColor === color ? `2px solid ${color}` : "none",
                        outlineOffset: "2px",
                      }}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => void handleCreateFolder()}
                    disabled={!newName.trim() || savingFolder}
                    className="ml-auto rounded-lg bg-action/80 px-3 py-1 text-[10px] font-semibold text-black disabled:opacity-40 transition hover:bg-action">
                    {savingFolder ? "Saving…" : "Create"}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Folders grid */}
        <div className="mt-3">
          {folders.length === 0 ? (
            <div className="liquid-glass-panel rounded-[18px] p-4 text-center">
              <Highlighter size={20} strokeWidth={1.4} className="mx-auto mb-2 text-zinc-600" />
              <p className="text-[11px] text-zinc-500">No folders yet.</p>
              <p className="mt-0.5 text-[10px] text-zinc-600">Create a folder to start saving highlights.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-1.5 mb-2">
                {folders.map((folder, i) => {
                  const isOpen = expandedId === folder.id
                  const isDefault = DEFAULT_FOLDERS.some((d) => d.id === folder.id)
                  const snippets = snippetsByFolder[folder.id] ?? []

                  return (
                    <motion.button
                      key={folder.id}
                      type="button"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.14, delay: i * 0.03 }}
                      onClick={() => toggleFolder(folder.id)}
                      className="liquid-glass-panel group relative flex flex-col items-start rounded-[14px] p-2.5 text-left transition hover:border-white/[0.1]">
                      {!isDefault && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void handleDeleteFolder(folder.id) }}
                          className="absolute right-2 top-2 text-zinc-700 opacity-0 transition hover:text-red-400 group-hover:opacity-100">
                          <Trash2 size={9} strokeWidth={1.8} />
                        </button>
                      )}
                      <span className="mb-1.5 text-[18px] leading-none">{folder.icon || "📌"}</span>
                      <div className="flex items-center gap-1.5">
                        <div className="h-2 w-2 shrink-0 rounded-full" style={{ background: folder.color }} />
                        <p className="max-w-[72px] truncate text-[10px] font-semibold text-white">{folder.name}</p>
                      </div>
                      {isOpen ? (
                        <p className="mt-0.5 text-[9px] text-zinc-500">{snippets.length} highlight{snippets.length !== 1 ? "s" : ""}</p>
                      ) : (
                        <ChevronRight size={9} strokeWidth={2} className="mt-0.5 text-zinc-600" />
                      )}
                    </motion.button>
                  )
                })}
              </div>

              {/* Expanded folder snippets */}
              {folders.map((folder) => {
                const isOpen = expandedId === folder.id
                const snippets = snippetsByFolder[folder.id] ?? []
                return (
                  <AnimatePresence key={folder.id}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="overflow-hidden">
                        <div className="liquid-glass-panel mb-1.5 rounded-[14px] p-2">
                          <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
                            <span className="text-[13px]">{folder.icon || "📌"}</span>
                            <p className="text-[10px] font-semibold text-white">{folder.name}</p>
                            <div className="h-1.5 w-1.5 rounded-full" style={{ background: folder.color }} />
                          </div>
                          <div className="space-y-1 border-l pl-2.5" style={{ borderColor: `${folder.color}30` }}>
                            {snippets.length === 0 ? (
                              <p className="py-1.5 text-[10px] text-zinc-600">No highlights yet.</p>
                            ) : (
                              snippets.map((snippet) => (
                                <div
                                  key={snippet.id}
                                  className="group/snip rounded-xl p-2 transition hover:bg-white/[0.03]">
                                  <p className="line-clamp-2 text-[10px] leading-relaxed text-zinc-300">
                                    "{snippet.text}"
                                  </p>
                                  <div className="mt-1.5 flex items-center justify-between">
                                    <div>
                                      <p className="text-[9px] text-zinc-600">{snippet.sourceTitle || "Untitled"}</p>
                                      <p className="text-[9px] text-zinc-700">{formatDate(snippet.savedAt)}</p>
                                    </div>
                                    <div className="flex items-center gap-1 opacity-0 transition group-hover/snip:opacity-100">
                                      <button
                                        type="button"
                                        onClick={() => void handleCopy(snippet.text)}
                                        title="Copy"
                                        className="flex h-5 w-5 items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200">
                                        <Copy size={10} strokeWidth={1.8} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void handleSendToNotebookLM(snippet)}
                                        title="Send to NotebookLM"
                                        className="flex h-5 w-5 items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200">
                                        <ExternalLink size={10} strokeWidth={1.8} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void handleDeleteSnippet(folder.id, snippet.id)}
                                        title="Delete"
                                        className="flex h-5 w-5 items-center justify-center rounded-lg text-zinc-500 hover:text-red-400">
                                        <Trash2 size={10} strokeWidth={1.8} />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
