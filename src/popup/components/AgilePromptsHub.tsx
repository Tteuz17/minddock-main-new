import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { ArrowLeft, Check, Copy, ExternalLink } from "lucide-react"
import { AGILE_PROMPTS, STORAGE_KEYS, URLS } from "~/lib/constants"

interface AgilePromptsHubProps {
  onBack: () => void
}

interface AgileSettings {
  autoImprove: boolean
  showBar: boolean
}

const DEFAULT_SETTINGS: AgileSettings = { autoImprove: true, showBar: true }

export function AgilePromptsHub({ onBack }: AgilePromptsHubProps) {
  const [settings, setSettings] = useState<AgileSettings>(DEFAULT_SETTINGS)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEYS.SETTINGS, (snap) => {
      const stored = snap[STORAGE_KEYS.SETTINGS] as Record<string, unknown> | undefined
      if (!stored) return
      setSettings({
        autoImprove: stored.agileAutoImprove !== false,
        showBar: stored.agileShowBar !== false,
      })
    })
  }, [])

  const updateSetting = (key: keyof AgileSettings, value: boolean) => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    chrome.storage.local.get(STORAGE_KEYS.SETTINGS, (snap) => {
      const stored = (snap[STORAGE_KEYS.SETTINGS] as Record<string, unknown>) ?? {}
      void chrome.storage.local.set({
        [STORAGE_KEYS.SETTINGS]: {
          ...stored,
          agileAutoImprove: next.autoImprove,
          agileShowBar: next.showBar,
        },
      })
    })
  }

  const handleCopy = async (key: string, content: string) => {
    await navigator.clipboard.writeText(content)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1800)
  }

  const handleUse = async (content: string) => {
    await navigator.clipboard.writeText(content)
    const tabs = await chrome.tabs.query({ url: "*://notebooklm.google.com/*" })
    if (tabs.length > 0) {
      chrome.tabs.update(tabs[0].id!, { active: true })
    } else {
      chrome.tabs.create({ url: URLS.NOTEBOOKLM })
    }
  }

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
          <h1 className="text-[13px] font-bold tracking-[-0.03em] text-white">Agile Prompts</h1>
          <span className="rounded-md bg-action/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-action">
            AI
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {/* Settings toggles */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="liquid-glass-panel mt-2 rounded-[18px] p-2.5">
          <div className="liquid-glass-content">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
              Settings
            </p>

            {[
              {
                key: "autoImprove" as const,
                label: "Auto-improve prompts",
                desc: "AI refines your prompt before sending to NotebookLM",
              },
              {
                key: "showBar" as const,
                label: "Show Agile bar",
                desc: "Display the prompt bar inside NotebookLM",
              },
            ].map(({ key, label, desc }) => (
              <div key={key} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-white">{label}</p>
                  <p className="mt-0.5 text-[10px] text-zinc-500">{desc}</p>
                </div>
                <button
                  type="button"
                  onClick={() => updateSetting(key, !settings[key])}
                  className={[
                    "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-200",
                    settings[key] ? "bg-action/80" : "bg-zinc-700",
                  ].join(" ")}>
                  <span
                    className={[
                      "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all duration-200",
                      settings[key] ? "left-[calc(100%-18px)]" : "left-0.5",
                    ].join(" ")}
                  />
                </button>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Built-in templates */}
        <div className="mb-1.5 mt-3 flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
            Templates
          </span>
          <span className="text-[10px] text-zinc-600">{AGILE_PROMPTS.length} built-in</span>
        </div>

        <div className="space-y-1.5">
          {AGILE_PROMPTS.map((prompt, i) => (
            <motion.div
              key={prompt.key}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15, delay: 0.06 + i * 0.025 }}
              className="liquid-glass-panel rounded-[14px] p-2.5">
              <div className="liquid-glass-content">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-[14px] leading-none">{prompt.icon}</span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-white">{prompt.label}</p>
                      <span className="rounded-sm bg-zinc-800 px-1 py-0.5 text-[8px] uppercase tracking-wider text-zinc-500">
                        {prompt.tier}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleCopy(prompt.key, prompt.prompt)}
                      title="Copy prompt"
                      className="flex h-6 w-6 items-center justify-center rounded-lg text-zinc-500 transition hover:text-zinc-300">
                      {copiedKey === prompt.key ? (
                        <Check size={11} strokeWidth={2} className="text-emerald-400" />
                      ) : (
                        <Copy size={11} strokeWidth={1.8} />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUse(prompt.prompt)}
                      title="Use in NotebookLM"
                      className="flex h-6 w-6 items-center justify-center rounded-lg text-zinc-500 transition hover:text-zinc-300">
                      <ExternalLink size={11} strokeWidth={1.8} />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}
