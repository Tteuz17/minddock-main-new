import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import {
  ArrowUpRight,
  BookOpenText,
  Eye,
  EyeOff,
  GitBranchPlus,
  Network,
  NotebookPen,
  Settings2,
  Workflow
} from "lucide-react"

import { STORAGE_KEYS, URLS } from "~/lib/constants"
import { useSubscription } from "~/hooks/useSubscription"
import type { SidePanelLaunchTarget } from "~/lib/types"

interface HomeDashboardProps {
  onOpenSidePanel: (target: SidePanelLaunchTarget) => void | Promise<void>
  onOpenZettelHub?: () => void
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

export function HomeDashboard({ onOpenSidePanel, onOpenZettelHub }: HomeDashboardProps) {
  const { limits } = useSubscription()
  const [dailyUsage, setDailyUsage] = useState<DailyUsageSnapshot>(EMPTY_USAGE)
  const [componentsVisible, setComponentsVisible] = useState(true)

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
  const VisibilityIcon = componentsVisible ? Eye : EyeOff
  const brandLogoSrc = new URL(
    "../../../public/images/logo/logo minddock sem fundo.png",
    import.meta.url
  ).href

  const cards = [
    {
      title: "Modo Zettel",
      note: "Criar nota atomica",
      icon: NotebookPen,
      accent: "rgba(250,204,21,0.18)",
      accentEdge: "rgba(250,204,21,0.24)",
      onClick: () => onOpenZettelHub?.()
    },
    {
      title: "Graph View",
      note: "Abrir mapa de notas",
      icon: Network,
      accent: "rgba(59,130,246,0.16)",
      accentEdge: "rgba(96,165,250,0.22)",
      onClick: () => onOpenSidePanel("graph")
    },
    {
      title: "Conectar Notas",
      note: "Criar nota-ponte",
      icon: GitBranchPlus,
      accent: "rgba(16,185,129,0.16)",
      accentEdge: "rgba(52,211,153,0.22)",
      onClick: () => onOpenSidePanel("link_note")
    },
    {
      title: "Threads",
      note: "Ver estrutura",
      icon: Workflow,
      accent: "rgba(244,114,182,0.14)",
      accentEdge: "rgba(244,114,182,0.18)",
      onClick: () => chrome.tabs.create({ url: URLS.MINDDOCK_LANDING })
    }
  ]

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
                    ? "Desligar visualizacoes do MindDock no NotebookLM"
                    : "Ligar visualizacoes do MindDock no NotebookLM"
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
            className="liquid-glass-panel mt-2 rounded-[18px] p-2.5">
            <div className="liquid-glass-content">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                    Importacao diaria
                  </p>
                  <div className="mt-1 flex items-end gap-2">
                    <span className="text-[24px] font-semibold leading-none tracking-[-0.05em] text-white">
                      {usedImports}
                    </span>
                    <span className="pb-0.5 text-[11px] text-zinc-400">
                      {importLimit ? `/ ${importLimit}` : "hoje"}
                    </span>
                  </div>
                </div>

                <div className="liquid-glass-soft rounded-full px-2.5 py-1">
                  <span className="liquid-glass-content text-[9px] font-medium uppercase tracking-[0.14em] text-zinc-300">
                    Live
                  </span>
                </div>
              </div>

              <div className="liquid-glass-soft mt-2 rounded-2xl p-1">
                <div className="relative h-6 overflow-hidden rounded-[12px] bg-black/25">
                  <div className="pointer-events-none absolute inset-0 rounded-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" />
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(progressValue * 100, 10)}%` }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                    className="relative h-full rounded-[12px] bg-[linear-gradient(90deg,rgba(250,204,21,0.92)_0%,rgba(251,191,36,0.9)_45%,rgba(245,158,11,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
                    <motion.div
                      animate={{ x: [-36, 140, -36] }}
                      transition={{ duration: 3.2, repeat: Infinity, ease: "linear" }}
                      className="absolute inset-y-0 left-0 w-16 rounded-full bg-white/18 blur-md"
                    />
                    <motion.div
                      animate={{ x: [0, 14, 0], y: [0, 1, 0] }}
                      transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                      className="absolute -top-1 left-6 h-4 w-10 rounded-full bg-white/12 blur-sm"
                    />
                    <motion.div
                      animate={{ x: [6, 24, 6] }}
                      transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                      className="absolute bottom-1 left-4 h-2 w-8 rounded-full bg-black/10"
                    />
                  </motion.div>
                </div>
              </div>

              <div className="mt-1.5 text-[10px] text-zinc-500">
                {importLimit
                  ? `${remainingImports} restante${remainingImports === 1 ? "" : "s"} hoje`
                  : `${usedImports} ${usedImports === 1 ? "importacao" : "importacoes"} hoje`}
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
                Modo Caneta
              </span>
              <span className="text-[10px] text-zinc-600">4 modulos</span>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {cards.map(({ title, note, icon: Icon, accent, accentEdge, onClick }, index) => (
                <motion.button
                  key={title}
                  type="button"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, delay: 0.07 + index * 0.03 }}
                  whileHover={{ y: -2, scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={onClick}
                  className="liquid-glass-panel h-[104px] rounded-[18px] p-2 text-left hover:border-white/[0.1]">
                  <div className="liquid-glass-content flex items-start justify-between gap-3">
                    <div
                      className="liquid-glass-soft flex h-7 w-7 items-center justify-center rounded-[14px] text-zinc-100">
                      <Icon size={12} strokeWidth={1.8} />
                    </div>
                    <ArrowUpRight size={11} strokeWidth={2} className="mt-0.5 text-zinc-500" />
                  </div>

                  <div className="liquid-glass-content">
                    <div className="mt-2 h-[2px] w-7 rounded-full bg-white/[0.14]" />
                    <h2 className="mt-2 text-[11px] font-semibold tracking-[-0.02em] text-white">{title}</h2>
                    <p className="mt-0.5 text-[9px] text-zinc-400">{note}</p>
                  </div>
                </motion.button>
              ))}
            </div>
          </motion.div>
        </div>

        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.1 }}
          className="liquid-glass-panel mt-2 min-h-[64px] rounded-[18px] p-2.5">
          <div className="liquid-glass-content flex w-full items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                Modo Marca Texto
              </p>
              <p className="mt-1 text-[10px] text-zinc-400">Suas citacoes ficam prontas para revisao.</p>
            </div>

            <button
              type="button"
              onClick={() => onOpenSidePanel("notes")}
              className="liquid-glass-soft inline-flex h-8 shrink-0 items-center rounded-[12px] px-3 text-[10px] font-medium text-zinc-100 hover:-translate-y-px hover:text-white">
              Ver todas as citacoes salvas
            </button>
          </div>
        </motion.section>
      </div>
    </div>
  )
}
