import { Copy, Edit2, Trash2, MoreVertical, PlayCircle } from "lucide-react"
import { motion } from "framer-motion"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "./ui/dropdown-menu"
import type { SavedPrompt } from "~/lib/types"
import { truncate } from "~/lib/utils"

interface PromptCardProps {
  prompt: SavedPrompt
  onUse?: () => void
  onEdit?: () => void
  onDelete?: () => void
  onCopy?: () => void
  index?: number
}

export function PromptCard({
  prompt,
  onUse,
  onEdit,
  onDelete,
  onCopy,
  index = 0
}: PromptCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.04 }}
      className="group flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 border border-transparent hover:border-white/8 transition-all duration-200 cursor-pointer"
      onClick={onUse}>
      {/* Use button */}
      <div className="mt-0.5 flex-shrink-0">
        <div className="w-7 h-7 rounded-md bg-white/5 group-hover:bg-action/15 flex items-center justify-center transition-colors">
          <PlayCircle
            size={14}
            strokeWidth={1.5}
            className="text-text-tertiary group-hover:text-action"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-secondary group-hover:text-white transition-colors truncate">
          {prompt.title}
        </p>
        <p className="text-xs text-text-tertiary mt-0.5 line-clamp-2">
          {truncate(prompt.content, 80)}
        </p>
        {prompt.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {prompt.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="default" className="text-[10px] px-1.5 py-0">
                {tag}
              </Badge>
            ))}
          </div>
        )}
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
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={onCopy}>
              <Copy size={13} strokeWidth={1.5} />
              Copiar
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit}>
              <Edit2 size={13} strokeWidth={1.5} />
              Editar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger onClick={onDelete}>
              <Trash2 size={13} strokeWidth={1.5} />
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.div>
  )
}
