/**
 * MindDock — Highlight Storage
 * Manages local highlight folders and saved snippets.
 */

export interface HighlightFolder {
  id: string
  name: string
  color: string
  icon: string
  createdAt: number
}

export interface HighlightSnippet {
  id: string
  folderId: string
  text: string
  sourceTitle: string
  sourceUrl: string
  savedAt: number
}

const FOLDERS_KEY = "minddock_highlight_folders"
const SNIPPETS_KEY = "minddock_highlights"

export const DEFAULT_FOLDERS: HighlightFolder[] = [
  { id: "research", name: "Research", color: "#3b82f6", icon: "🔬", createdAt: 0 },
  { id: "ideas", name: "Ideas", color: "#8b5cf6", icon: "💡", createdAt: 0 },
  { id: "important", name: "Important", color: "#f97316", icon: "⭐", createdAt: 0 },
]

export const FOLDER_ICONS = ["📌","💡","🔬","⭐","📚","🎯","💎","🔑","📝","🚀","💼","🌟","🔥","🧠","📊","🎨"]

export async function getFolders(): Promise<HighlightFolder[]> {
  const snap = await chrome.storage.local.get(FOLDERS_KEY)
  const stored = snap[FOLDERS_KEY] as HighlightFolder[] | undefined
  if (!stored || stored.length === 0) {
    await chrome.storage.local.set({ [FOLDERS_KEY]: DEFAULT_FOLDERS })
    return DEFAULT_FOLDERS
  }
  return stored
}

export async function createFolder(name: string, color: string, icon = "📌"): Promise<HighlightFolder> {
  const folders = await getFolders()
  const folder: HighlightFolder = {
    id: `folder_${Date.now()}`,
    name: name.trim(),
    color,
    icon,
    createdAt: Date.now(),
  }
  await chrome.storage.local.set({ [FOLDERS_KEY]: [...folders, folder] })
  return folder
}

export async function deleteFolder(folderId: string): Promise<void> {
  const [folders, snippets] = await Promise.all([getFolders(), getSnippets()])
  await chrome.storage.local.set({
    [FOLDERS_KEY]: folders.filter((f) => f.id !== folderId),
    [SNIPPETS_KEY]: snippets.filter((s) => s.folderId !== folderId),
  })
}

export async function getSnippets(folderId?: string): Promise<HighlightSnippet[]> {
  const snap = await chrome.storage.local.get(SNIPPETS_KEY)
  const all = (snap[SNIPPETS_KEY] as HighlightSnippet[] | undefined) ?? []
  return folderId ? all.filter((s) => s.folderId === folderId) : all
}

export async function saveSnippet(
  folderId: string,
  text: string,
  sourceTitle: string,
  sourceUrl: string
): Promise<HighlightSnippet> {
  const snippets = await getSnippets()
  const snippet: HighlightSnippet = {
    id: `snip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    folderId,
    text,
    sourceTitle,
    sourceUrl,
    savedAt: Date.now(),
  }
  await chrome.storage.local.set({ [SNIPPETS_KEY]: [snippet, ...snippets] })
  return snippet
}

export async function deleteSnippet(snippetId: string): Promise<void> {
  const snippets = await getSnippets()
  await chrome.storage.local.set({
    [SNIPPETS_KEY]: snippets.filter((s) => s.id !== snippetId),
  })
}
