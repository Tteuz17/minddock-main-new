import { useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import {
  ArrowLeft,
  Bell,
  Eye,
  Highlighter,
  RefreshCw,
  Sparkles
} from "lucide-react"
import { STORAGE_KEYS } from "~/lib/constants"

interface SettingsHubProps {
  onBack: () => void
}

interface SettingsState {
  notebookUiEnabled: boolean
  clipperEnabled: boolean
  agileBarVisible: boolean
  notificationsEnabled: boolean
}

type LocalSettingsRecord = Record<string, unknown>

const SETTINGS_DEFAULTS: SettingsState = {
  notebookUiEnabled: true,
  clipperEnabled: true,
  agileBarVisible: true,
  notificationsEnabled: true
}
const NOTEBOOK_ONBOARDING_STORAGE_KEY = "minddock_notebook_onboarding_state_v1"

function asSettingsRecord(value: unknown): LocalSettingsRecord {
  if (!value || typeof value !== "object") {
    return {}
  }
  return value as LocalSettingsRecord
}

function resolveBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function mergeSettingsState(settingsRecord: LocalSettingsRecord, notebookUiRaw: unknown): SettingsState {
  return {
    notebookUiEnabled: resolveBool(notebookUiRaw, SETTINGS_DEFAULTS.notebookUiEnabled),
    clipperEnabled: resolveBool(settingsRecord.clipperEnabled, SETTINGS_DEFAULTS.clipperEnabled),
    agileBarVisible: resolveBool(settingsRecord.agileBarVisible, SETTINGS_DEFAULTS.agileBarVisible),
    notificationsEnabled: resolveBool(
      settingsRecord.notificationsEnabled,
      SETTINGS_DEFAULTS.notificationsEnabled
    )
  }
}

function ToggleChip({
  checked,
  onClick
}: {
  checked: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onClick}
      className={[
        "relative h-6 w-11 rounded-full border transition-all duration-150",
        checked
          ? "border-[#facc15]/50 bg-[#facc15]/15"
          : "border-white/10 bg-white/[0.06]"
      ].join(" ")}>
      <span
        className={[
          "absolute top-0.5 h-5 w-5 rounded-full transition-all duration-150",
          checked
            ? "left-[22px] bg-[#facc15] shadow-[0_0_0_1px_rgba(250,204,21,0.25)]"
            : "left-0.5 bg-zinc-300"
        ].join(" ")}
      />
    </button>
  )
}

function SettingRow({
  icon: Icon,
  title,
  description,
  checked,
  onToggle
}: {
  icon: typeof Eye
  title: string
  description: string
  checked: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <div className="flex items-center gap-2.5 rounded-[13px] border border-white/[0.08] bg-white/[0.02] px-2.5 py-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.03] text-zinc-300">
        <Icon size={13} strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-white">{title}</p>
        <p className="text-[9px] leading-relaxed text-zinc-500">{description}</p>
      </div>
      <ToggleChip checked={checked} onClick={onToggle} />
    </div>
  )
}

export function SettingsHub({ onBack }: SettingsHubProps) {
  const [settingsRecord, setSettingsRecord] = useState<LocalSettingsRecord>({})
  const [settingsState, setSettingsState] = useState<SettingsState>(SETTINGS_DEFAULTS)
  const [isSaving, setIsSaving] = useState(false)
  const [isResettingTour, setIsResettingTour] = useState(false)
  const [tourResetAt, setTourResetAt] = useState<number | null>(null)

  useEffect(() => {
    const hydrate = (): void => {
      chrome.storage.local.get([STORAGE_KEYS.SETTINGS, STORAGE_KEYS.NOTEBOOKLM_UI_ENABLED], (snapshot) => {
        const settings = asSettingsRecord(snapshot[STORAGE_KEYS.SETTINGS])
        const nextState = mergeSettingsState(settings, snapshot[STORAGE_KEYS.NOTEBOOKLM_UI_ENABLED])
        setSettingsRecord(settings)
        setSettingsState(nextState)
      })
    }

    hydrate()

    const handleStorage = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ): void => {
      if (areaName !== "local") {
        return
      }

      if (changes[STORAGE_KEYS.SETTINGS] || changes[STORAGE_KEYS.NOTEBOOKLM_UI_ENABLED]) {
        hydrate()
      }
    }

    chrome.storage.onChanged.addListener(handleStorage)
    return () => chrome.storage.onChanged.removeListener(handleStorage)
  }, [])

  const setNotebookUiEnabled = async (value: boolean): Promise<void> => {
    setSettingsState((current) => ({ ...current, notebookUiEnabled: value }))
    await chrome.storage.local.set({ [STORAGE_KEYS.NOTEBOOKLM_UI_ENABLED]: value })
  }

  const patchSettings = async (patch: Partial<SettingsState>): Promise<void> => {
    const nextRecord: LocalSettingsRecord = {
      ...settingsRecord,
      ...(patch.clipperEnabled !== undefined ? { clipperEnabled: patch.clipperEnabled } : {}),
      ...(patch.agileBarVisible !== undefined ? { agileBarVisible: patch.agileBarVisible } : {}),
      ...(patch.notificationsEnabled !== undefined
        ? { notificationsEnabled: patch.notificationsEnabled }
        : {})
    }

    setSettingsRecord(nextRecord)
    setSettingsState((current) => ({ ...current, ...patch }))
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: nextRecord })
  }

  const restoreDefaults = async (): Promise<void> => {
    setIsSaving(true)
    try {
      const baseRecord = {
        ...settingsRecord,
        clipperEnabled: SETTINGS_DEFAULTS.clipperEnabled,
        agileBarVisible: SETTINGS_DEFAULTS.agileBarVisible,
        notificationsEnabled: SETTINGS_DEFAULTS.notificationsEnabled
      }

      setSettingsRecord(baseRecord)
      setSettingsState(SETTINGS_DEFAULTS)

      await chrome.storage.local.set({
        [STORAGE_KEYS.NOTEBOOKLM_UI_ENABLED]: SETTINGS_DEFAULTS.notebookUiEnabled,
        [STORAGE_KEYS.SETTINGS]: baseRecord
      })
    } finally {
      setIsSaving(false)
    }
  }

  const resetNotebookTour = async (): Promise<void> => {
    setIsResettingTour(true)
    try {
      await chrome.storage.local.remove(NOTEBOOK_ONBOARDING_STORAGE_KEY)
      setTourResetAt(Date.now())
    } catch (error) {
      console.warn("[MindDock] Failed to reset notebook onboarding tour", error)
    } finally {
      setIsResettingTour(false)
    }
  }

  const enabledCount = useMemo(() => {
    return Object.values(settingsState).filter(Boolean).length
  }, [settingsState])

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
          <h1 className="text-[13px] font-bold tracking-[-0.03em] text-white">Settings</h1>
          <span className="rounded-md bg-[#facc15]/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-[#facc15]">
            {enabledCount}/4 enabled
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="liquid-glass-panel mt-2 rounded-[18px] p-2.5">
          <div className="liquid-glass-content space-y-1.5">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
              Workspace
            </p>

            <SettingRow
              icon={Eye}
              title="NotebookLM overlays"
              description="Show or hide MindDock UI overlays inside NotebookLM."
              checked={settingsState.notebookUiEnabled}
              onToggle={() => void setNotebookUiEnabled(!settingsState.notebookUiEnabled)}
            />

            <SettingRow
              icon={Highlighter}
              title="Highlight clipper"
              description="Enable text highlight capture panel in NotebookLM."
              checked={settingsState.clipperEnabled}
              onToggle={() => void patchSettings({ clipperEnabled: !settingsState.clipperEnabled })}
            />

            <SettingRow
              icon={Sparkles}
              title="Agile bar"
              description="Show quick agile prompt controls when available."
              checked={settingsState.agileBarVisible}
              onToggle={() => void patchSettings({ agileBarVisible: !settingsState.agileBarVisible })}
            />

            <SettingRow
              icon={Bell}
              title="Notifications"
              description="Allow status and helper notifications from MindDock."
              checked={settingsState.notificationsEnabled}
              onToggle={() =>
                void patchSettings({ notificationsEnabled: !settingsState.notificationsEnabled })
              }
            />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, delay: 0.05 }}
          className="mt-2 flex items-center justify-between gap-2 rounded-[14px] border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
          <div>
            <p className="text-[11px] font-semibold text-zinc-200">Notebook tour</p>
            <p className="text-[9px] text-zinc-500">
              {tourResetAt
                ? "Tour reset. It will appear again when NotebookLM is opened again."
                : "Show onboarding again for this extension install (account-independent)."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void resetNotebookTour()}
            disabled={isResettingTour}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-semibold text-zinc-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45">
            <RefreshCw size={11} className={isResettingTour ? "animate-spin" : ""} />
            {isResettingTour ? "Resetting..." : "Reset tour"}
          </button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, delay: 0.08 }}
          className="mt-2 flex items-center justify-between gap-2 rounded-[14px] border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
          <div>
            <p className="text-[11px] font-semibold text-zinc-200">Restore defaults</p>
            <p className="text-[9px] text-zinc-500">Reset all switches to recommended defaults.</p>
          </div>
          <button
            type="button"
            onClick={() => void restoreDefaults()}
            disabled={isSaving}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-semibold text-zinc-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45">
            <RefreshCw size={11} className={isSaving ? "animate-spin" : ""} />
            {isSaving ? "Saving..." : "Reset"}
          </button>
        </motion.div>
      </div>
    </div>
  )
}
