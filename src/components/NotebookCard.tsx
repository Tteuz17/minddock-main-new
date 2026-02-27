import { BookOpen, FileText, MoreVertical, ExternalLink } from "lucide-react"
import { motion } from "framer-motion"
import { formatRelativeTime } from "~/lib/utils"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "./ui/dropdown-menu"
import type { Notebook } from "~/lib/types"

interface NotebookCardProps {
  notebook: Notebook
  isActive?: boolean
  onClick?: () => void
  onOpenInNotebookLM?: () => void
  onSetDefault?: () => void
  index?: number
}

export function NotebookCard({
  notebook,
  isActive,
  onClick,
  onOpenInNotebookLM,
  onSetDefault,
  index = 0
}: NotebookCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.04 }}
      onClick={onClick}
      className={[
        "group relative flex items-start gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-200",
        isActive
          ? "bg-action/10 border border-action/25"
          : "hover:bg-white/5 border border-transparent"
      ].join(" ")}>
      {/* Icon */}
      <div
        className={[
          "mt-0.5 flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center",
          isActive ? "bg-action/20" : "bg-white/8 group-hover:bg-white/12"
        ].join(" ")}>
        <BookOpen
          size={16}
          strokeWidth={1.5}
          className={isActive ? "text-action" : "text-text-secondary"}
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={[
              "text-sm font-medium truncate",
              isActive ? "text-white" : "text-text-secondary group-hover:text-white"
            ].join(" ")}>
            {notebook.title}
          </span>
          {isActive && (
            <Badge variant="yellow" className="text-[10px] px-1.5 py-0.5">
              padrão
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {notebook.sourceCount !== undefined && (
            <span className="text-xs text-text-tertiary flex items-center gap-1">
              <FileText size={10} strokeWidth={1.5} />
              {notebook.sourceCount} fonte{notebook.sourceCount !== 1 ? "s" : ""}
            </span>
          )}
          <span className="text-xs text-text-tertiary">
            {formatRelativeTime(notebook.updateTime)}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div
        className="opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <MoreVertical size={13} strokeWidth={1.5} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={onOpenInNotebookLM}>
              <ExternalLink size={13} strokeWidth={1.5} />
              Abrir no NotebookLM
            </DropdownMenuItem>
            {!isActive && (
              <DropdownMenuItem onClick={onSetDefault}>
                <BookOpen size={13} strokeWidth={1.5} />
                Definir como padrão
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.div>
  )
}
