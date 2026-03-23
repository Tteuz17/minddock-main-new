import { useCallback } from "react"
import { useAuth } from "./useAuth"
import type { SubscriptionTier, PlanLimits, SubscriptionCycle } from "~/lib/types"
import { resolvePlanLimits } from "~/lib/constants"
import { canUseFeature } from "~/lib/utils"

export function useSubscription() {
  const { user } = useAuth()
  const tier: SubscriptionTier = user?.subscriptionTier ?? "free"
  const cycle: SubscriptionCycle = user?.subscriptionCycle ?? "none"
  const limits: PlanLimits = resolvePlanLimits(tier, cycle)

  const canUse = useCallback(
    (feature: keyof PlanLimits): boolean => canUseFeature(tier, feature, cycle),
    [tier, cycle]
  )

  const isPro = tier !== "free"
  const isThinker = tier === "thinker" || tier === "thinker_pro"
  const isThinkerPro = tier === "thinker_pro"

  return { tier, cycle, limits, canUse, isPro, isThinker, isThinkerPro }
}
