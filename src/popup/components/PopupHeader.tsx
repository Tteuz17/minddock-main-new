import { Settings, PanelRight } from "lucide-react"
import { Button } from "~/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip"

interface PopupHeaderProps {
  onOpenSidePanel?: () => void
}

export function PopupHeader({ onOpenSidePanel }: PopupHeaderProps) {
  return (
    <div className="flex items-center justify-between px-3 py-3 border-b border-white/8">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-action flex items-center justify-center shadow-elevation-1">
          <span className="text-black text-xs font-bold leading-none">M</span>
        </div>
        <span className="text-sm font-semibold tracking-tight">MindDock</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onOpenSidePanel}>
                <PanelRight size={14} strokeWidth={1.5} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Notes Hub</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => chrome.runtime.openOptionsPage()}>
                <Settings size={14} strokeWidth={1.5} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Configurações</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  )
}
