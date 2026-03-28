const NOTEBOOK_ONBOARDING_STORAGE_KEY = "minddock_notebook_onboarding_state_v1"
const NOTEBOOK_ONBOARDING_VERSION = 1

export type NotebookOnboardingScope = "notebook_main"

interface NotebookTourState {
  startedAt?: string
  completedAt?: string
  skippedAt?: string
  lastStepId?: string
}

interface NotebookOnboardingState {
  version: number
  welcomeSeenAt?: string
  tours: Record<NotebookOnboardingScope, NotebookTourState | undefined>
}

const DEFAULT_STATE: NotebookOnboardingState = {
  version: NOTEBOOK_ONBOARDING_VERSION,
  tours: {
    notebook_main: undefined
  }
}

function toIsoNow(): string {
  return new Date().toISOString()
}

function normalizeTourState(value: unknown): NotebookTourState | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const record = value as Record<string, unknown>
  const output: NotebookTourState = {}

  if (typeof record.startedAt === "string" && record.startedAt.trim().length > 0) {
    output.startedAt = record.startedAt
  }
  if (typeof record.completedAt === "string" && record.completedAt.trim().length > 0) {
    output.completedAt = record.completedAt
  }
  if (typeof record.skippedAt === "string" && record.skippedAt.trim().length > 0) {
    output.skippedAt = record.skippedAt
  }
  if (typeof record.lastStepId === "string" && record.lastStepId.trim().length > 0) {
    output.lastStepId = record.lastStepId
  }

  return Object.keys(output).length > 0 ? output : undefined
}

function normalizeState(value: unknown): NotebookOnboardingState {
  if (!value || typeof value !== "object") {
    return DEFAULT_STATE
  }

  const record = value as Record<string, unknown>
  const toursRecord = record.tours && typeof record.tours === "object"
    ? (record.tours as Record<string, unknown>)
    : {}

  return {
    version: NOTEBOOK_ONBOARDING_VERSION,
    welcomeSeenAt:
      typeof record.welcomeSeenAt === "string" && record.welcomeSeenAt.trim().length > 0
        ? record.welcomeSeenAt
        : undefined,
    tours: {
      notebook_main: normalizeTourState(toursRecord.notebook_main)
    }
  }
}

async function getStorageSnapshot(): Promise<Record<string, unknown>> {
  return await chrome.storage.local.get(NOTEBOOK_ONBOARDING_STORAGE_KEY)
}

async function writeState(state: NotebookOnboardingState): Promise<void> {
  await chrome.storage.local.set({
    [NOTEBOOK_ONBOARDING_STORAGE_KEY]: state
  })
}

async function updateState(
  updater: (current: NotebookOnboardingState) => NotebookOnboardingState
): Promise<NotebookOnboardingState> {
  try {
    const snapshot = await getStorageSnapshot()
    const current = normalizeState(snapshot[NOTEBOOK_ONBOARDING_STORAGE_KEY])
    const next = updater(current)
    await writeState(next)
    return next
  } catch (error) {
    console.warn("[MindDock] Notebook onboarding state update failed", error)
    return DEFAULT_STATE
  }
}

export async function readNotebookOnboardingState(): Promise<NotebookOnboardingState> {
  try {
    const snapshot = await getStorageSnapshot()
    return normalizeState(snapshot[NOTEBOOK_ONBOARDING_STORAGE_KEY])
  } catch (error) {
    console.warn("[MindDock] Notebook onboarding state read failed", error)
    return DEFAULT_STATE
  }
}

export async function markNotebookWelcomeSeen(): Promise<void> {
  await updateState((current) => ({
    ...current,
    welcomeSeenAt: current.welcomeSeenAt ?? toIsoNow()
  }))
}

export async function markNotebookTourStarted(scope: NotebookOnboardingScope): Promise<void> {
  await updateState((current) => ({
    ...current,
    tours: {
      ...current.tours,
      [scope]: {
        startedAt: toIsoNow(),
        completedAt: undefined,
        skippedAt: undefined,
        lastStepId: current.tours[scope]?.lastStepId
      }
    }
  }))
}

export async function markNotebookTourStepSeen(
  scope: NotebookOnboardingScope,
  stepId: string
): Promise<void> {
  const normalizedStepId = String(stepId ?? "").trim()
  if (!normalizedStepId) {
    return
  }

  await updateState((current) => ({
    ...current,
    tours: {
      ...current.tours,
      [scope]: {
        ...current.tours[scope],
        lastStepId: normalizedStepId
      }
    }
  }))
}

export async function markNotebookTourCompleted(scope: NotebookOnboardingScope): Promise<void> {
  await updateState((current) => ({
    ...current,
    tours: {
      ...current.tours,
      [scope]: {
        ...current.tours[scope],
        completedAt: toIsoNow(),
        skippedAt: undefined
      }
    }
  }))
}

export async function markNotebookTourSkipped(scope: NotebookOnboardingScope): Promise<void> {
  await updateState((current) => ({
    ...current,
    tours: {
      ...current.tours,
      [scope]: {
        ...current.tours[scope],
        skippedAt: toIsoNow(),
        completedAt: undefined
      }
    }
  }))
}

