import { Sparkles, Lock } from "lucide-react"
import { Button } from "./ui/button"
import type { SubscriptionTier } from "~/lib/types"
import { PLAN_NAMES } from "~/lib/constants"

interface UpgradePromptProps {
  feature: string
  requiredTier: SubscriptionTier
  compact?: boolean
}

export function UpgradePrompt({ feature, requiredTier, compact }: UpgradePromptProps) {
  function openUpgrade() {
    chrome.tabs.create({ url: "https://minddock.app/pricing" })
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-action/8 border border-action/20 rounded-lg">
        <Lock size={13} strokeWidth={1.5} className="text-action" />
        <span className="text-xs text-text-secondary flex-1">
          {feature} requer {PLAN_NAMES[requiredTier]}
        </span>
        <Button variant="primary" size="sm" onClick={openUpgrade}>
          Upgrade
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12 px-6 text-center">
      <div className="w-14 h-14 rounded-xl bg-action/10 border border-action/20 flex items-center justify-center">
        <Sparkles size={24} strokeWidth={1.5} className="text-action" />
      </div>
      <div className="space-y-1.5">
        <h3 className="text-base font-semibold text-white">{feature}</h3>
        <p className="text-sm text-text-secondary max-w-[240px]">
          Esta funcionalidade requer o plano{" "}
          <span className="text-action font-medium">{PLAN_NAMES[requiredTier]}</span> ou superior.
        </p>
      </div>
      <Button variant="primary" size="lg" onClick={openUpgrade} className="gap-2">
        <Sparkles size={14} strokeWidth={1.5} />
        Ver planos
      </Button>
    </div>
  )
}
