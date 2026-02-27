import { Plus, FolderOpen, BookMarked } from "lucide-react"
import { useState, useEffect } from "react"
import { PromptCard } from "~/components/PromptCard"
import { LoadingSpinner } from "~/components/LoadingSpinner"
import { Button } from "~/components/ui/button"
import { useAuth } from "~/hooks/useAuth"
import { promptsService } from "~/services/prompts"
import type { SavedPrompt } from "~/lib/types"

interface PromptLibraryProps {
  searchQuery?: string
}

export function PromptLibrary({ searchQuery }: PromptLibraryProps) {
  const { user } = useAuth()
  const [prompts, setPrompts] = useState<SavedPrompt[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    promptsService.getPrompts(user.id).then((data) => {
      setPrompts(data)
      setIsLoading(false)
    })
  }, [user])

  const filtered = searchQuery
    ? prompts.filter(
        (p) =>
          p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.content.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : prompts

  async function handleUsePrompt(prompt: SavedPrompt) {
    // Copia pra clipboard
    await navigator.clipboard.writeText(prompt.content)
    // Incrementa uso
    await promptsService.incrementUseCount(prompt.id)
    // Abre o NotebookLM se não estiver aberto
    const tabs = await chrome.tabs.query({ url: "*://notebooklm.google.com/*" })
    if (tabs.length > 0) {
      chrome.tabs.update(tabs[0].id!, { active: true })
    } else {
      chrome.tabs.create({ url: "https://notebooklm.google.com" })
    }
  }

  async function handleDelete(promptId: string) {
    await promptsService.deletePrompt(promptId)
    setPrompts((prev) => prev.filter((p) => p.id !== promptId))
  }

  async function handleCopy(content: string) {
    await navigator.clipboard.writeText(content)
  }

  if (isLoading) {
    return <div className="py-10"><LoadingSpinner /></div>
  }

  if (filtered.length === 0) {
    return (
      <div className="empty-state">
        <BookMarked size={24} strokeWidth={1} className="text-text-tertiary" />
        <div>
          <p className="text-sm text-text-secondary font-medium">
            {searchQuery ? "Nenhum prompt encontrado" : "Biblioteca vazia"}
          </p>
          <p className="text-xs text-text-tertiary mt-1">
            {searchQuery
              ? `Sem prompts com "${searchQuery}"`
              : "Salve prompts para reusar rapidamente."}
          </p>
        </div>
        {!searchQuery && (
          <Button variant="secondary" size="sm">
            <Plus size={13} strokeWidth={1.5} />
            Criar prompt
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="py-1">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-xs text-text-tertiary">
          {filtered.length} prompt{filtered.length !== 1 ? "s" : ""}
        </span>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
          <Plus size={11} strokeWidth={1.5} />
          Novo
        </Button>
      </div>

      {filtered.map((prompt, i) => (
        <PromptCard
          key={prompt.id}
          prompt={prompt}
          index={i}
          onUse={() => handleUsePrompt(prompt)}
          onCopy={() => handleCopy(prompt.content)}
          onDelete={() => handleDelete(prompt.id)}
        />
      ))}
    </div>
  )
}
