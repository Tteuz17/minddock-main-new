import { RefreshCw, AlertCircle, BookOpen } from "lucide-react"
import { useNotebooks } from "~/hooks/useNotebooks"
import { NotebookCard } from "~/components/NotebookCard"
import { LoadingSpinner } from "~/components/LoadingSpinner"
import { Button } from "~/components/ui/button"
import { useState, useCallback, useEffect } from "react"
import { storageManager } from "~/background/storage-manager"
import { URLS } from "~/lib/constants"

interface NotebookListProps {
  searchQuery?: string
}

export function NotebookList({ searchQuery }: NotebookListProps) {
  const { notebooks, isLoading, error, refetch } = useNotebooks()
  const [defaultId, setDefaultId] = useState<string | null>(null)

  useEffect(() => {
    chrome.storage.local.get(["nexus_default_notebook_id", "minddock_default_notebook"], (snap) => {
      const resolved =
        String(snap.nexus_default_notebook_id ?? "").trim() ||
        String(snap.minddock_default_notebook ?? "").trim() ||
        null
      setDefaultId(resolved)
    })
  }, [])

  const filtered = searchQuery
    ? notebooks.filter((n) =>
        n.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : notebooks

  const handleSetDefault = useCallback(async (id: string) => {
    setDefaultId(id)
    await chrome.storage.local.set({
      nexus_default_notebook_id: id,
      minddock_default_notebook: id
    })
    await storageManager.updateSettings({ defaultNotebookId: id })
  }, [])

  const handleOpenInNotebookLM = useCallback((notebookId: string) => {
    chrome.tabs.create({ url: `${URLS.NOTEBOOKLM}/notebook/${notebookId}` })
  }, [])

  if (isLoading) {
    return (
      <div className="py-10">
        <LoadingSpinner label="Loading notebooks..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 px-4 text-center">
        <AlertCircle size={20} strokeWidth={1.5} className="text-error" />
        <div>
          <p className="text-sm text-text-secondary">{error}</p>
          {error.includes("Tokens") && (
            <p className="text-xs text-text-tertiary mt-1">
              Open NotebookLM and wait a moment.
            </p>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={refetch}>
          <RefreshCw size={13} strokeWidth={1.5} />
          Try again
        </Button>
      </div>
    )
  }

  if (filtered.length === 0) {
    return (
      <div className="empty-state">
        <BookOpen size={24} strokeWidth={1} className="text-text-tertiary" />
        <div>
          <p className="text-sm text-text-secondary font-medium">
            {searchQuery ? "No results" : "No notebooks found"}
          </p>
          <p className="text-xs text-text-tertiary mt-1">
            {searchQuery
              ? `No notebooks matching "${searchQuery}"`
              : "Open NotebookLM to load your notebooks."}
          </p>
        </div>
        {!searchQuery && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => chrome.tabs.create({ url: URLS.NOTEBOOKLM })}>
            Open NotebookLM
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="py-1">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-xs text-text-tertiary">
          {filtered.length} notebook{filtered.length !== 1 ? "s" : ""}
        </span>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={refetch}>
          <RefreshCw size={11} strokeWidth={1.5} />
          Refresh
        </Button>
      </div>

      {/* List */}
      {filtered.map((notebook, i) => (
        <NotebookCard
          key={notebook.id}
          notebook={notebook}
          isActive={notebook.id === defaultId}
          index={i}
          onSetDefault={() => handleSetDefault(notebook.id)}
          onOpenInNotebookLM={() => handleOpenInNotebookLM(notebook.id)}
        />
      ))}
    </div>
  )
}
