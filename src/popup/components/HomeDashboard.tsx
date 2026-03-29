import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import {
  Check,
  ChevronDown,
  BookMarked,
  BookOpenText,
  Eye,
  EyeOff,
  GitMerge,
  Highlighter,
  Lock,
  RefreshCw,
  Settings2,
  Sparkles,
  X,
  Workflow
} from "lucide-react"

import { STORAGE_KEYS, URLS } from "~/lib/constants"
import { useSubscription } from "~/hooks/useSubscription"
import { useNotebookList } from "~/hooks/useNotebookList"
import {
  buildNotebookAccountKey,
  buildScopedStorageKey,
  isConfirmedNotebookAccountKey,
  isDefaultNotebookAccountKey,
  normalizeAccountEmail,
  normalizeAuthUser
} from "~/lib/notebook-account-scope"
import type { SidePanelLaunchTarget } from "~/lib/types"

interface HomeDashboardProps {
  onOpenSidePanel: (target: SidePanelLaunchTarget) => void | Promise<void>
  onOpenZettelHub?: () => void
  onOpenPromptLab?: () => void
  onOpenBrainMerge?: () => void
  onOpenHighlights?: () => void
  onOpenDocks?: () => void
  onOpenPlans?: () => void
}

interface DailyUsageSnapshot {
  date: string
  imports: number
  exports: number
  aiCalls: number
  captures: number
}

const EMPTY_USAGE: DailyUsageSnapshot = {
  date: "",
  imports: 0,
  exports: 0,
  aiCalls: 0,
  captures: 0
}

interface NotebookOption {
  id: string
  title: string
}

interface NotebookAccountScope {
  accountKey: string
  accountEmail: string | null
  authUser: string | null
  confirmed: boolean
}

type GatedCapability = "ai_features" | "zettelkasten"

const SETTINGS_KEY = STORAGE_KEYS.SETTINGS
const AUTH_USER_KEY = STORAGE_KEYS.AUTH_USER
const ACCOUNT_EMAIL_KEY = "nexus_notebook_account_email"
const TOKEN_STORAGE_KEY = "notebooklm_session"
const DEFAULT_NOTEBOOK_KEY = "nexus_default_notebook_id"
const LEGACY_DEFAULT_NOTEBOOK_KEY = "minddock_default_notebook"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim()
}

function resolveNotebookAccountScope(snapshot: Record<string, unknown>): NotebookAccountScope {
  const settings = isRecord(snapshot[SETTINGS_KEY]) ? snapshot[SETTINGS_KEY] : {}
  const session = isRecord(snapshot[TOKEN_STORAGE_KEY]) ? snapshot[TOKEN_STORAGE_KEY] : {}
  const accountEmail = normalizeAccountEmail(
    settings.notebookAccountEmail ?? snapshot[ACCOUNT_EMAIL_KEY] ?? session.accountEmail
  )
  const authUser = normalizeAuthUser(
    settings.authUser ?? settings.notebookAuthUser ?? snapshot[AUTH_USER_KEY] ?? session.authUser
  )
  const accountKey = buildNotebookAccountKey({ accountEmail, authUser })

  return {
    accountKey,
    accountEmail,
    authUser,
    confirmed: isConfirmedNotebookAccountKey(accountKey)
  }
}

function resolveDefaultNotebookIdFromSnapshot(
  snapshot: Record<string, unknown>,
  accountScope: NotebookAccountScope
): string {
  const settings = isRecord(snapshot[SETTINGS_KEY]) ? snapshot[SETTINGS_KEY] : {}

  if (accountScope.confirmed) {
    const defaultByAccount = isRecord(settings.defaultNotebookByAccount)
      ? (settings.defaultNotebookByAccount as Record<string, unknown>)
      : {}
    const fromScopedSettings = normalizeString(defaultByAccount[accountScope.accountKey])
    if (fromScopedSettings) {
      return fromScopedSettings
    }

    const scopedDefaultKey = buildScopedStorageKey(DEFAULT_NOTEBOOK_KEY, accountScope.accountKey)
    const scopedLegacyDefaultKey = buildScopedStorageKey(
      LEGACY_DEFAULT_NOTEBOOK_KEY,
      accountScope.accountKey
    )
    const fromScopedCanonical = normalizeString(snapshot[scopedDefaultKey])
    if (fromScopedCanonical) {
      return fromScopedCanonical
    }

    const fromScopedLegacy = normalizeString(snapshot[scopedLegacyDefaultKey])
    if (fromScopedLegacy) {
      return fromScopedLegacy
    }

    if (isDefaultNotebookAccountKey(accountScope.accountKey)) {
      return (
        normalizeString(snapshot[DEFAULT_NOTEBOOK_KEY]) ||
        normalizeString(snapshot[LEGACY_DEFAULT_NOTEBOOK_KEY]) ||
        normalizeString(settings.defaultNotebookId)
      )
    }

    return ""
  }

  return (
    normalizeString(snapshot[DEFAULT_NOTEBOOK_KEY]) ||
    normalizeString(snapshot[LEGACY_DEFAULT_NOTEBOOK_KEY]) ||
    normalizeString(settings.defaultNotebookId)
  )
}

export function HomeDashboard({
  onOpenSidePanel,
  onOpenZettelHub,
  onOpenPromptLab,
  onOpenBrainMerge,
  onOpenHighlights,
  onOpenDocks,
  onOpenPlans
}: HomeDashboardProps) {
  const { limits } = useSubscription()
  const {
    notebooks: fetchedNotebooks,
    isLoading: isLoadingNotebooks,
    reload: reloadNotebooks
  } = useNotebookList()
  const [dailyUsage, setDailyUsage] = useState<DailyUsageSnapshot>(EMPTY_USAGE)
  const [componentsVisible, setComponentsVisible] = useState(true)
  const [defaultNotebookId, setDefaultNotebookId] = useState("")
  const [notebookAccountLabel, setNotebookAccountLabel] = useState("NotebookLM account not confirmed")
  const [isSavingDefaultNotebook, setIsSavingDefaultNotebook] = useState(false)
  const [isDefaultNotebookMenuOpen, setIsDefaultNotebookMenuOpen] = useState(false)
  const [selectedLockedModuleKey, setSelectedLockedModuleKey] = useState<string | null>(null)

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEYS.DAILY_USAGE, (snapshot) => {
      const stored = snapshot[STORAGE_KEYS.DAILY_USAGE] as Partial<DailyUsageSnapshot> | undefined
      if (!stored) return

      setDailyUsage((current) => ({
        ...current,
        ...stored,
        captures: typeof stored.captures === "number" ? stored.captures : current.captures
      }))
    })

    const handleStorage = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local" || !changes[STORAGE_KEYS.DAILY_USAGE]?.newValue) return

      const nextValue = changes[STORAGE_KEYS.DAILY_USAGE].newValue as Partial<DailyUsageSnapshot>
      setDailyUsage((current) => ({
        ...current,
        ...nextValue,
        captures:
          typeof nextValue.captures === "number" ? nextValue.captures : current.captures
      }))
    }

    chrome.storage.onChanged.addListener(handleStorage)
    return () => chrome.storage.onChanged.removeListener(handleStorage)
  }, [])

  useEffect(() => {
    const loadDefaultNotebook = async (): Promise<void> => {
      const snapshot = (await chrome.storage.local.get([
        SETTINGS_KEY,
        AUTH_USER_KEY,
        ACCOUNT_EMAIL_KEY,
        TOKEN_STORAGE_KEY,
        DEFAULT_NOTEBOOK_KEY,
        LEGACY_DEFAULT_NOTEBOOK_KEY
      ])) as Record<string, unknown>

      const accountScope = resolveNotebookAccountScope(snapshot)
      const label = accountScope.accountEmail ?? (accountScope.authUser ? `authuser:${accountScope.authUser}` : "")
      setNotebookAccountLabel(label || "NotebookLM account not confirmed")
      setDefaultNotebookId(resolveDefaultNotebookIdFromSnapshot(snapshot, accountScope))
    }

    void loadDefaultNotebook()

    const handleStorage = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ): void => {
      if (areaName !== "local") {
        return
      }

      if (
        changes[SETTINGS_KEY] ||
        changes[AUTH_USER_KEY] ||
        changes[ACCOUNT_EMAIL_KEY] ||
        changes[TOKEN_STORAGE_KEY] ||
        changes[DEFAULT_NOTEBOOK_KEY] ||
        changes[LEGACY_DEFAULT_NOTEBOOK_KEY]
      ) {
        void loadDefaultNotebook()
      }
    }

    chrome.storage.onChanged.addListener(handleStorage)
    return () => chrome.storage.onChanged.removeListener(handleStorage)
  }, [])

  const handleDefaultNotebookChange = async (nextNotebookId: string): Promise<void> => {
    const normalizedNotebookId = normalizeString(nextNotebookId)
    if (!normalizedNotebookId) {
      return
    }

    setIsSavingDefaultNotebook(true)
    try {
      const snapshot = (await chrome.storage.local.get([
        SETTINGS_KEY,
        AUTH_USER_KEY,
        ACCOUNT_EMAIL_KEY,
        TOKEN_STORAGE_KEY
      ])) as Record<string, unknown>
      const settings = isRecord(snapshot[SETTINGS_KEY]) ? snapshot[SETTINGS_KEY] : {}
      const accountScope = resolveNotebookAccountScope(snapshot)

      if (accountScope.confirmed) {
        const defaultByAccount = isRecord(settings.defaultNotebookByAccount)
          ? (settings.defaultNotebookByAccount as Record<string, unknown>)
          : {}

        const nextSettings: Record<string, unknown> = {
          ...settings,
          defaultNotebookByAccount: {
            ...defaultByAccount,
            [accountScope.accountKey]: normalizedNotebookId
          }
        }

        const storagePatch: Record<string, unknown> = {
          [SETTINGS_KEY]: nextSettings,
          [buildScopedStorageKey(DEFAULT_NOTEBOOK_KEY, accountScope.accountKey)]: normalizedNotebookId,
          [buildScopedStorageKey(LEGACY_DEFAULT_NOTEBOOK_KEY, accountScope.accountKey)]: normalizedNotebookId
        }

        if (isDefaultNotebookAccountKey(accountScope.accountKey)) {
          storagePatch[DEFAULT_NOTEBOOK_KEY] = normalizedNotebookId
          storagePatch[LEGACY_DEFAULT_NOTEBOOK_KEY] = normalizedNotebookId
          storagePatch[SETTINGS_KEY] = { ...nextSettings, defaultNotebookId: normalizedNotebookId }
        }

        await chrome.storage.local.set(storagePatch)
      } else {
        await chrome.storage.local.set({
          [DEFAULT_NOTEBOOK_KEY]: normalizedNotebookId,
          [LEGACY_DEFAULT_NOTEBOOK_KEY]: normalizedNotebookId,
          [SETTINGS_KEY]: { ...settings, defaultNotebookId: normalizedNotebookId }
        })
      }

      setDefaultNotebookId(normalizedNotebookId)
    } finally {
      setIsSavingDefaultNotebook(false)
    }
  }

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEYS.NOTEBOOKLM_UI_ENABLED, (snapshot) => {
      const stored = snapshot[STORAGE_KEYS.NOTEBOOKLM_UI_ENABLED]
      setComponentsVisible(typeof stored === "boolean" ? stored : true)
    })

    const handleStorage = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local" || !changes[STORAGE_KEYS.NOTEBOOKLM_UI_ENABLED]) {
        return
      }

      const nextValue = changes[STORAGE_KEYS.NOTEBOOKLM_UI_ENABLED].newValue
      setComponentsVisible(typeof nextValue === "boolean" ? nextValue : true)
    }

    chrome.storage.onChanged.addListener(handleStorage)
    return () => chrome.storage.onChanged.removeListener(handleStorage)
  }, [])

  const importLimit =
    typeof limits.imports_per_day === "number" ? limits.imports_per_day : null
  const usedImports = importLimit
    ? Math.min(dailyUsage.imports, importLimit)
    : dailyUsage.imports
  const remainingImports =
    importLimit === null ? null : Math.max(importLimit - usedImports, 0)
  const progressValue = importLimit
    ? Math.min(usedImports / importLimit, 1)
    : usedImports > 0
      ? 1
      : 0.14
  const notebookOptions: NotebookOption[] = fetchedNotebooks.map((notebookManifest) => ({
    id: notebookManifest.id,
    title: notebookManifest.title
  }))
  const selectedNotebookTitle = notebookOptions.find((item) => item.id === defaultNotebookId)?.title || ""
  const VisibilityIcon = componentsVisible ? Eye : EyeOff
  const brandLogoSrc = new URL(
    "../../../public/images/logo/logo minddock sem fundo.png",
    import.meta.url
  ).href

  const openPricing = () => chrome.tabs.create({ url: `${URLS.MINDDOCK_LANDING}/pricing` })
  const openUpgradePlans = () => {
    setSelectedLockedModuleKey(null)
    if (onOpenPlans) {
      onOpenPlans()
      return
    }
    openPricing()
  }

  const cards = [
    {
      key: "prompt-library",
      title: "Prompt Library",
      note: "Ready-to-use prompts for faster workflows.",
      whatItIs:
        "A curated prompt workspace to speed up writing, ideation and study workflows.",
      howItHelps: [
        "Reduces blank-page time with reusable prompt patterns.",
        "Keeps output quality consistent across notebooks."
      ],
      requiredCapability: "ai_features" as GatedCapability,
      requiredPlanLabel: "Thinker",
      icon: BookMarked,
      accent: "rgba(250,204,21,0.18)",
      accentEdge: "rgba(250,204,21,0.24)",
      onClick: () => (onOpenPromptLab ? onOpenPromptLab() : undefined)
    },
    {
      key: "focus-dock",
      title: "Focus Dock",
      note: "Isolated context tabs for each conversation flow.",
      whatItIs:
        "Focused workspace tabs that separate contexts, goals and references per thread.",
      howItHelps: [
        "Avoids context mixing between different conversations.",
        "Makes long workflows easier to continue without losing structure."
      ],
      requiredCapability: "zettelkasten" as GatedCapability,
      requiredPlanLabel: "Thinker",
      icon: Workflow,
      accent: "rgba(59,130,246,0.16)",
      accentEdge: "rgba(96,165,250,0.22)",
      onClick: () =>
        onOpenDocks
          ? onOpenDocks()
          : onOpenSidePanel("create_note")
    },
    {
      key: "brain-merge",
      title: "Brain Merge",
      note: "Combine multiple notebooks with AI for a specific goal.",
      whatItIs:
        "AI synthesis engine that merges insights from multiple notebooks into one clear output.",
      howItHelps: [
        "Connects scattered sources into one consolidated analysis.",
        "Accelerates research conclusions and decision-ready summaries."
      ],
      requiredCapability: "ai_features" as GatedCapability,
      requiredPlanLabel: "Thinker",
      icon: GitMerge,
      accent: "rgba(168,85,247,0.16)",
      accentEdge: "rgba(192,132,252,0.22)",
      onClick: () => (onOpenBrainMerge ? onOpenBrainMerge() : undefined)
    },
    {
      key: "highlight-mode",
      title: "Highlight Mode",
      note: "Turn key citations into reusable insight cards.",
      whatItIs:
        "A focused review space to collect, revisit and reuse your strongest citations from NotebookLM.",
      howItHelps: [
        "Builds a clean bank of references you can reuse across projects.",
        "Makes it easier to convert raw highlights into final insights."
      ],
      requiredCapability: "ai_features" as GatedCapability,
      requiredPlanLabel: "Thinker",
      icon: Highlighter,
      accent: "rgba(56,189,248,0.14)",
      accentEdge: "rgba(125,211,252,0.22)",
      onClick: () => {
        if (onOpenHighlights) {
          onOpenHighlights()
          return
        }
        void onOpenSidePanel("notes")
      }
    }
  ]
  const selectedLockedModule = cards.find((card) => card.key === selectedLockedModuleKey) ?? null

  useEffect(() => {
    if (!isDefaultNotebookMenuOpen) {
      return
    }

    const handleClose = (event: MouseEvent): void => {
      const target = event.target as Element | null
      if (!target) {
        return
      }

      if (!target.closest("[data-default-notebook-picker='true']")) {
        setIsDefaultNotebookMenuOpen(false)
      }
    }

    window.addEventListener("mousedown", handleClose, true)
    return () => window.removeEventListener("mousedown", handleClose, true)
  }, [isDefaultNotebookMenuOpen])

  return (
    <div className="relative flex-1 bg-[#050505] text-white">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px)",
            backgroundSize: "18px 18px",
            backgroundPosition: "center",
            maskImage:
              "radial-gradient(circle at 50% 22%, black 0%, rgba(0,0,0,0.95) 28%, transparent 78%)",
            WebkitMaskImage:
              "radial-gradient(circle at 50% 22%, black 0%, rgba(0,0,0,0.95) 28%, transparent 78%)"
          }}
        />
        <div className="absolute inset-x-0 top-0 h-44 bg-[radial-gradient(circle_at_50%_18%,rgba(255,255,255,0.16),rgba(255,255,255,0.05)_18%,rgba(5,5,5,0)_42%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,5,5,0.18),rgba(5,5,5,0)_18%,rgba(5,5,5,0)_82%,rgba(5,5,5,0.3))]" />
      </div>

      <div className="relative flex h-full flex-col px-4 pb-[104px] pt-2">
        <div>
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center">
              <img
                src={brandLogoSrc}
                alt="MindDock"
                className="h-8 w-auto max-w-[148px] object-contain"
              />
            </div>

            <div className="liquid-metal-toolbar">
              <button
                type="button"
                onClick={() => {
                  const nextValue = !componentsVisible
                  setComponentsVisible(nextValue)
                  void chrome.storage.local.set({
                    [STORAGE_KEYS.NOTEBOOKLM_UI_ENABLED]: nextValue
                  })
                }}
                title={
                  componentsVisible
                    ? "Turn off MindDock overlays in NotebookLM"
                    : "Turn on MindDock overlays in NotebookLM"
                }
                data-active={componentsVisible ? "true" : "false"}
                className="liquid-metal-button">
                <VisibilityIcon size={14} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onClick={() => chrome.tabs.create({ url: URLS.NOTEBOOKLM })}
                className="liquid-metal-button">
                <BookOpenText size={14} strokeWidth={1.7} />
              </button>
              <button
                type="button"
                onClick={() => chrome.runtime.openOptionsPage()}
                className="liquid-metal-button">
                <Settings2 size={14} strokeWidth={1.7} />
              </button>
            </div>
          </motion.div>

          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.02 }}
            className="liquid-glass-panel mt-2 rounded-[16px] p-2">
            <div className="liquid-glass-content">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[9px] font-medium uppercase tracking-[0.15em] text-zinc-500">
                    Daily imports
                  </p>
                  <div className="mt-0.5 flex items-end gap-1.5">
                    <span className="text-[21px] font-semibold leading-none tracking-[-0.05em] text-white">
                      {usedImports}
                    </span>
                    <span className="pb-0.5 text-[10px] text-zinc-400">
                      {importLimit ? `/ ${importLimit}` : "today"}
                    </span>
                  </div>
                </div>

                <div className="liquid-glass-soft rounded-full px-2 py-0.5">
                  <span className="liquid-glass-content text-[8px] font-medium uppercase tracking-[0.13em] text-zinc-300">
                    Live
                  </span>
                </div>
              </div>

              <div className="liquid-glass-soft mt-1.5 rounded-xl p-0.5">
                <div className="relative h-4 overflow-hidden rounded-[10px] bg-black/25">
                  <div className="pointer-events-none absolute inset-0 rounded-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" />
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(progressValue * 100, 10)}%` }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                    className="relative h-full rounded-[10px] bg-[linear-gradient(90deg,rgba(250,204,21,0.92)_0%,rgba(251,191,36,0.9)_45%,rgba(245,158,11,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
                    <motion.div
                      animate={{ x: [-36, 140, -36] }}
                      transition={{ duration: 3.2, repeat: Infinity, ease: "linear" }}
                      className="absolute inset-y-0 left-0 w-14 rounded-full bg-white/18 blur-sm"
                    />
                  </motion.div>
                </div>
              </div>

              <div className="mt-1 text-[9px] text-zinc-500">
                {importLimit
                  ? `${remainingImports} remaining today`
                  : `${usedImports} ${usedImports === 1 ? "import" : "imports"} today`}
              </div>
            </div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.04 }}
            className="liquid-glass-panel relative z-30 mt-1.5 overflow-visible rounded-[16px] p-2">
            <div className="liquid-glass-content">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[9px] font-medium uppercase tracking-[0.15em] text-zinc-500">
                  Default notebook
                </p>
                <p className="max-w-[180px] truncate text-[9px] text-zinc-400" title={notebookAccountLabel}>
                  {notebookAccountLabel}
                </p>
              </div>

              <div className="mt-1.5 flex items-center gap-1.5">
                <div className="relative flex-1" data-default-notebook-picker="true">
                  <button
                    type="button"
                    disabled={isLoadingNotebooks || isSavingDefaultNotebook || notebookOptions.length === 0}
                    onClick={() => setIsDefaultNotebookMenuOpen((current) => !current)}
                    className="flex h-8 w-full items-center justify-between gap-2 rounded-[10px] border border-white/10 bg-black/30 px-2 text-left text-[11px] text-zinc-100 transition hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-60">
                    <span className="truncate">
                      {isLoadingNotebooks
                        ? "Loading notebooks..."
                        : selectedNotebookTitle || "Select default notebook"}
                    </span>
                    <ChevronDown
                      size={13}
                      className={`shrink-0 text-zinc-400 transition-transform ${isDefaultNotebookMenuOpen ? "rotate-180" : ""}`}
                    />
                  </button>

                  {isDefaultNotebookMenuOpen && notebookOptions.length > 0 ? (
                    <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[120] overflow-hidden rounded-[12px] border border-white/10 bg-[#0b0f14] shadow-[0_14px_30px_rgba(0,0,0,0.45)]">
                      <div className="max-h-40 overflow-y-auto py-1 [scrollbar-width:thin] [scrollbar-color:#000000_#0b0f14] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-[#0b0f14] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-black">
                        {notebookOptions.map((notebook) => {
                          const isSelected = notebook.id === defaultNotebookId

                          return (
                            <button
                              key={notebook.id}
                              type="button"
                              onClick={() => {
                                setIsDefaultNotebookMenuOpen(false)
                                void handleDefaultNotebookChange(notebook.id)
                              }}
                              className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] transition ${
                                isSelected ? "bg-[#facc15]/15 text-[#fff1a6]" : "text-zinc-200 hover:bg-white/5"
                              }`}>
                              <span className="min-w-0 flex-1 truncate">{notebook.title}</span>
                              {isSelected ? <Check size={12} className="shrink-0" /> : null}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  disabled={isLoadingNotebooks}
                  onClick={() => {
                    void reloadNotebooks()
                  }}
                  className="liquid-glass-soft inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-white/8 text-zinc-200 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                  title="Refresh notebooks">
                  <RefreshCw
                    size={12}
                    strokeWidth={1.8}
                    className={isLoadingNotebooks ? "animate-spin" : ""}
                  />
                </button>
              </div>
            </div>
          </motion.section>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.05 }}
            className="mt-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                Thinker Modules
              </span>
              <span className="text-[10px] text-zinc-600">{cards.length} modules</span>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {cards.map((card, index) => {
                const {
                  key,
                  title,
                  note,
                  icon: Icon,
                  accent,
                  accentEdge,
                  requiredCapability,
                  requiredPlanLabel,
                  onClick
                } = card
                const isLocked = !Boolean(limits[requiredCapability])

                return (
                  <motion.button
                    key={key}
                    type="button"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22, delay: 0.07 + index * 0.03 }}
                    whileHover={{ y: -2, scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => {
                      if (isLocked) {
                        setSelectedLockedModuleKey(key)
                        return
                      }
                      if (typeof onClick === "function") {
                        void onClick()
                      }
                    }}
                    disabled={!isLocked && typeof onClick !== "function"}
                    className={`liquid-glass-panel h-[112px] rounded-[18px] p-2 text-left hover:border-white/[0.1] ${
                      isLocked ? "opacity-95" : ""
                    }`}
                    style={{
                      background: isLocked
                        ? "linear-gradient(155deg, rgba(120,120,120,0.18) 0%, rgba(10,10,10,0.84) 45%, rgba(5,5,5,0.96) 100%)"
                        : `linear-gradient(155deg, ${accent} 0%, rgba(6,6,7,0.52) 36%, rgba(6,6,7,0.85) 100%)`,
                      boxShadow: isLocked
                        ? "inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px rgba(255,255,255,0.16)"
                        : `inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 1px ${accentEdge}`
                    }}>
                    <div className="liquid-glass-content flex items-start justify-between gap-3">
                      <div
                        className={`liquid-glass-soft flex h-7 w-7 items-center justify-center rounded-[14px] ${
                          isLocked ? "text-zinc-300" : "text-zinc-100"
                        }`}>
                        <Icon size={12} strokeWidth={1.8} />
                      </div>
                      {isLocked ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/25 bg-black/45 text-zinc-200">
                          <Lock size={9} />
                        </span>
                      ) : null}
                    </div>

                    <div className="liquid-glass-content">
                      <div className={`mt-2 h-[2px] w-7 rounded-full ${isLocked ? "bg-white/[0.08]" : "bg-white/[0.14]"}`} />
                      <h2 className={`mt-2 text-[11px] font-semibold tracking-[-0.02em] ${isLocked ? "text-zinc-200" : "text-white"}`}>
                        {title}
                      </h2>
                      <p className={`mt-0.5 text-[9px] ${isLocked ? "text-zinc-400" : "text-zinc-300"}`}>{note}</p>
                    </div>
                  </motion.button>
                )
              })}
            </div>
          </motion.div>
        </div>

      </div>

      <AnimatePresence>
        {selectedLockedModule ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedLockedModuleKey(null)}
            className="absolute inset-0 z-[160] flex items-end bg-black/70 p-3 backdrop-blur-[2px]">
            <motion.div
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={(event) => event.stopPropagation()}
              className="w-full rounded-2xl border border-[#facc15]/35 bg-[linear-gradient(170deg,rgba(250,204,21,0.13),rgba(10,10,10,0.96)_40%)] p-3 shadow-[0_20px_45px_rgba(0,0,0,0.45)]">
              <div className="flex items-start justify-between gap-2">
                <span className="inline-flex items-center gap-1 rounded-full border border-[#facc15]/45 bg-[#facc15]/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.13em] text-[#fde68a]">
                  <Lock size={10} />
                  {selectedLockedModule.requiredPlanLabel} required
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedLockedModuleKey(null)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/15 bg-black/25 text-zinc-300 transition hover:text-white">
                  <X size={12} />
                </button>
              </div>

              <h3 className="mt-2 text-[15px] font-semibold tracking-[-0.02em] text-white">
                {selectedLockedModule.title}
              </h3>
              <p className="mt-1 text-[11px] text-zinc-300">
                {selectedLockedModule.whatItIs}
              </p>

              <div className="mt-2 rounded-xl border border-white/10 bg-black/35 p-2.5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  How this helps
                </p>
                <ul className="mt-1.5 space-y-1.5">
                  {selectedLockedModule.howItHelps.map((item) => (
                    <li key={item} className="text-[11px] text-zinc-200">
                      <span className="mr-1 text-[#facc15]">•</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <button
                type="button"
                onClick={openUpgradePlans}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#facc15] py-2.5 text-[12px] font-semibold text-black transition hover:bg-[#f7c700]">
                <Sparkles size={12} />
                Unlock with {selectedLockedModule.requiredPlanLabel}
              </button>
              <button
                type="button"
                onClick={() => setSelectedLockedModuleKey(null)}
                className="mt-2 w-full rounded-xl border border-white/15 bg-white/[0.03] py-2 text-[11px] text-zinc-200 transition hover:bg-white/[0.07]">
                Not now
              </button>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
