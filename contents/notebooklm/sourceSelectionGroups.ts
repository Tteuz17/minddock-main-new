export interface SavedSourceSelectionEntry {
  sourceId: string
  backendId: string | null
  titleKey: string
}

export interface SavedSourceSelectionGroup {
  id: string
  notebookId: string
  name: string
  entries: SavedSourceSelectionEntry[]
  selectionCount?: number
  createdAt: number
  updatedAt: number
}

export interface SourceSelectionSourceLike {
  sourceId: string
  backendId: string | null
  sourceTitle: string
}

const STORAGE_KEY = "minddock:source-download:saved-selection-groups:v1"
const MAX_GROUPS = 36

export function normalizeTitleKey(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

export function normalizeGroupName(rawName: unknown): string {
  return String(rawName ?? "")
    .replace(/\s+/g, " ")
    .trim()
}

export function normalizeGroupNameKey(rawName: unknown): string {
  return normalizeGroupName(rawName).toLowerCase()
}

export function buildSavedSelectionEntriesFromSources(
  selectedRows: SourceSelectionSourceLike[]
): SavedSourceSelectionEntry[] {
  const entries: SavedSourceSelectionEntry[] = []
  const seen = new Set<string>()

  for (const source of selectedRows) {
    const entry: SavedSourceSelectionEntry = {
      sourceId: String(source.sourceId ?? "").trim(),
      backendId: String(source.backendId ?? "").trim() || null,
      titleKey: normalizeTitleKey(source.sourceTitle)
    }

    if (!entry.sourceId && !entry.backendId && !entry.titleKey) {
      continue
    }

    const dedupeKey = `${entry.sourceId}::${entry.backendId ?? ""}::${entry.titleKey}`
    if (seen.has(dedupeKey)) {
      continue
    }

    seen.add(dedupeKey)
    entries.push(entry)
  }

  return entries
}

export function loadSavedSourceSelectionGroups(): SavedSourceSelectionGroup[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    const hydrated: SavedSourceSelectionGroup[] = []
    for (const item of parsed) {
      if (!item || typeof item !== "object") {
        continue
      }

      const record = item as Partial<SavedSourceSelectionGroup>
      const notebookId = String(record.notebookId ?? "").trim()
      const name = normalizeGroupName(record.name)
      if (!notebookId || !name || !Array.isArray(record.entries)) {
        continue
      }

      const entries: SavedSourceSelectionEntry[] = []
      for (const rawEntry of record.entries) {
        if (!rawEntry || typeof rawEntry !== "object") {
          continue
        }

        const entryRecord = rawEntry as Partial<SavedSourceSelectionEntry>
        const sourceId = String(entryRecord.sourceId ?? "").trim()
        const backendIdRaw = String(entryRecord.backendId ?? "").trim()
        const titleKey = normalizeTitleKey(String(entryRecord.titleKey ?? ""))
        if (!sourceId && !backendIdRaw && !titleKey) {
          continue
        }

        entries.push({
          sourceId: sourceId || backendIdRaw || titleKey,
          backendId: backendIdRaw || null,
          titleKey
        })
      }

      if (entries.length === 0) {
        continue
      }

      hydrated.push({
        id: String(record.id ?? `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        notebookId,
        name,
        entries,
        selectionCount: normalizeSelectionCount(record.selectionCount, entries.length),
        createdAt: Number(record.createdAt ?? Date.now()),
        updatedAt: Number(record.updatedAt ?? Date.now())
      })
    }

    return hydrated
  } catch {
    return []
  }
}

export function persistSavedSourceSelectionGroups(groups: SavedSourceSelectionGroup[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(groups))
  } catch {
    // Ignore storage failures.
  }
}

export function listSavedSourceSelectionGroupsByNotebook(
  notebookId: string,
  groups?: SavedSourceSelectionGroup[]
): SavedSourceSelectionGroup[] {
  const all = Array.isArray(groups) ? groups : loadSavedSourceSelectionGroups()
  const targetNotebookId = String(notebookId ?? "").trim()
  if (!targetNotebookId) {
    return []
  }
  return all.filter((group) => group.notebookId === targetNotebookId)
}

export function upsertSavedSourceSelectionGroup(params: {
  notebookId: string
  groupName: string
  entries: SavedSourceSelectionEntry[]
  selectionCount?: number
  groups?: SavedSourceSelectionGroup[]
}): { groups: SavedSourceSelectionGroup[]; group: SavedSourceSelectionGroup } {
  const notebookId = String(params.notebookId ?? "").trim()
  const groupName = normalizeGroupName(params.groupName)
  const entries = Array.isArray(params.entries) ? params.entries : []
  const selectionCount = normalizeSelectionCount(params.selectionCount, entries.length)
  const currentGroups = Array.isArray(params.groups) ? params.groups : loadSavedSourceSelectionGroups()
  const now = Date.now()

  if (!notebookId) {
    throw new Error("Notebook ID obrigatorio para salvar grupo.")
  }
  if (!groupName) {
    throw new Error("Nome do grupo obrigatorio.")
  }
  if (entries.length === 0) {
    throw new Error("O grupo precisa ter pelo menos uma fonte.")
  }

  const nextNameKey = normalizeGroupNameKey(groupName)
  const existingIndex = currentGroups.findIndex(
    (group) =>
      group.notebookId === notebookId &&
      normalizeGroupNameKey(group.name) === nextNameKey
  )

  if (existingIndex >= 0) {
    const updated = [...currentGroups]
    const mergedGroup: SavedSourceSelectionGroup = {
      ...updated[existingIndex],
      name: groupName,
      entries,
      selectionCount,
      updatedAt: now
    }
    updated[existingIndex] = mergedGroup
    return {
      groups: updated,
      group: mergedGroup
    }
  }

  const created: SavedSourceSelectionGroup = {
    id: `group-${now}-${Math.random().toString(36).slice(2, 8)}`,
    notebookId,
    name: groupName,
    entries,
    selectionCount,
    createdAt: now,
    updatedAt: now
  }

  const merged = [created, ...currentGroups]
  const capped = merged.length <= MAX_GROUPS ? merged : merged.slice(0, MAX_GROUPS)
  return {
    groups: capped,
    group: created
  }
}

export function deleteSavedSourceSelectionGroup(
  groups: SavedSourceSelectionGroup[],
  groupId: string
): SavedSourceSelectionGroup[] {
  const nextGroupId = String(groupId ?? "").trim()
  if (!nextGroupId) {
    return groups
  }
  return groups.filter((group) => group.id !== nextGroupId)
}

export function resolveMatchingSourceIdsForGroup(
  group: SavedSourceSelectionGroup,
  sources: SourceSelectionSourceLike[]
): Set<string> {
  const matching = new Set<string>()
  const sourcesById = new Map<string, SourceSelectionSourceLike>()
  const sourceIdsByBackendId = new Map<string, string[]>()
  const sourceIdsByTitleKey = new Map<string, string[]>()

  for (const source of sources) {
    const sourceId = String(source.sourceId ?? "").trim()
    if (!sourceId) {
      continue
    }

    sourcesById.set(sourceId, source)

    const backendId = String(source.backendId ?? "").trim()
    if (backendId) {
      const current = sourceIdsByBackendId.get(backendId) ?? []
      current.push(sourceId)
      sourceIdsByBackendId.set(backendId, current)
    }

    const titleKey = normalizeTitleKey(source.sourceTitle)
    if (titleKey) {
      const current = sourceIdsByTitleKey.get(titleKey) ?? []
      current.push(sourceId)
      sourceIdsByTitleKey.set(titleKey, current)
    }
  }

  const pendingTitleNeeds = new Map<string, number>()

  for (const entry of group.entries) {
    const entrySourceId = String(entry.sourceId ?? "").trim()
    if (entrySourceId && sourcesById.has(entrySourceId)) {
      matching.add(entrySourceId)
      continue
    }

    const entryBackendId = String(entry.backendId ?? "").trim()
    if (entryBackendId) {
      const backendCandidates = sourceIdsByBackendId.get(entryBackendId) ?? []
      const availableBackendCandidate = backendCandidates.find((candidateId) => !matching.has(candidateId))
      if (availableBackendCandidate) {
        matching.add(availableBackendCandidate)
        continue
      }
    }

    const entryTitleKey = normalizeTitleKey(entry.titleKey ?? "")
    if (!entryTitleKey) {
      continue
    }

    pendingTitleNeeds.set(entryTitleKey, (pendingTitleNeeds.get(entryTitleKey) ?? 0) + 1)
  }

  for (const [titleKey, neededCount] of pendingTitleNeeds.entries()) {
    const titleCandidates = (sourceIdsByTitleKey.get(titleKey) ?? []).filter(
      (candidateId) => !matching.has(candidateId)
    )
    if (titleCandidates.length === 0) {
      continue
    }

    const takeCount = Math.min(neededCount, titleCandidates.length)
    for (let index = 0; index < takeCount; index += 1) {
      matching.add(titleCandidates[index])
    }
  }

  return matching
}

function normalizeSelectionCount(rawCount: unknown, fallbackCount: number): number {
  const parsed = Number(rawCount)
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.max(1, Math.round(parsed))
  }
  return Math.max(1, Math.round(Number(fallbackCount) || 1))
}
