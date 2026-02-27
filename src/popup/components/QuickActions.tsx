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
      label: "Importar conversa",
      description: "Vá para ChatGPT, Claude ou Gemini e clique no botão MindDock",
      onClick: () => chrome.tabs.create({ url: URLS.CHATGPT })
    },
    {
      icon: <Scissors size={16} strokeWidth={1.5} />,
      label: "Highlight & Snipe",
      description: "Selecione texto em qualquer site e envie para o NotebookLM",
      onClick: () => chrome.tabs.create({ url: URLS.NOTEBOOKLM })
    },
    {
      icon: <Upload size={16} strokeWidth={1.5} />,
      label: "Sync Google Docs",
      description: "Abra um Google Doc e clique em 'Sync com NotebookLM'",
      onClick: () => chrome.tabs.create({ url: URLS.GOOGLE_DOCS })
    },
    {
      icon: <Download size={16} strokeWidth={1.5} />,
      label: "Exportar fontes",
      description: "Selecione um notebook e exporte suas fontes em MD, PDF ou JSON",
      onClick: () => chrome.tabs.create({ url: URLS.NOTEBOOKLM })
    },
    {
      icon: <RefreshCw size={16} strokeWidth={1.5} />,
      label: "Atualizar cache",
      description: "Força atualização da lista de notebooks",
      onClick: async () => {
        await chrome.storage.local.remove(["minddock_notebooks_cache"])
        window.location.reload()
      }
    },
    {
      icon: <ExternalLink size={16} strokeWidth={1.5} />,
      label: "Abrir NotebookLM",
      description: "Abre o Google NotebookLM em nova aba",
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
