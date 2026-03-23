import {
  Download,
  Upload,
  Scissors,
  RefreshCw,
  ExternalLink,
  MessageSquare
} from "lucide-react"
import { motion } from "framer-motion"
import { URLS } from "~/lib/constants"

interface Action {
  icon: React.ReactNode
  label: string
  description: string
  onClick: () => void
}

export function QuickActions() {
  const actions: Action[] = [
    {
      icon: <MessageSquare size={16} strokeWidth={1.5} />,
      label: "Import conversation",
      description: "Go to a supported site and click the universal MindDock button",
      onClick: () => chrome.tabs.create({ url: URLS.CHATGPT })
    },
    {
      icon: <Scissors size={16} strokeWidth={1.5} />,
      label: "Highlight & Snipe",
      description: "Select text on any site and send it to NotebookLM",
      onClick: () => chrome.tabs.create({ url: URLS.NOTEBOOKLM })
    },
    {
      icon: <Upload size={16} strokeWidth={1.5} />,
      label: "Sync Google Docs",
      description: "Open a Google Doc and click 'Sync with NotebookLM'",
      onClick: () => chrome.tabs.create({ url: URLS.GOOGLE_DOCS })
    },
    {
      icon: <Download size={16} strokeWidth={1.5} />,
      label: "Download sources",
      description: "Select a notebook and download its sources in MD, TXT, or PDF",
      onClick: () => chrome.tabs.create({ url: URLS.NOTEBOOKLM })
    },
    {
      icon: <RefreshCw size={16} strokeWidth={1.5} />,
      label: "Refresh cache",
      description: "Force refresh the notebooks list",
      onClick: async () => {
        await chrome.storage.local.remove(["minddock_notebooks_cache"])
        window.location.reload()
      }
    },
    {
      icon: <ExternalLink size={16} strokeWidth={1.5} />,
      label: "Open NotebookLM",
      description: "Open Google NotebookLM in a new tab",
      onClick: () => chrome.tabs.create({ url: URLS.NOTEBOOKLM })
    }
  ]

  return (
    <div className="p-3 space-y-1">
      {actions.map((action, i) => (
        <motion.button
          key={action.label}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15, delay: i * 0.04 }}
          onClick={action.onClick}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 border border-transparent hover:border-white/8 transition-all duration-200 text-left group">
          <div className="flex-shrink-0 w-8 h-8 rounded-md bg-white/5 group-hover:bg-action/15 flex items-center justify-center transition-colors">
            <span className="text-text-tertiary group-hover:text-action transition-colors">
              {action.icon}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-secondary group-hover:text-white transition-colors">
              {action.label}
            </p>
            <p className="text-xs text-text-tertiary line-clamp-1 mt-0.5">
              {action.description}
            </p>
          </div>
        </motion.button>
      ))}
    </div>
  )
}

