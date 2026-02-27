import { useEffect, useState, useCallback } from "react"
import { useAuth } from "./useAuth"
import type { SubscriptionTier, PlanLimits } from "~/lib/types"
import { PLANS } from "~/lib/constants"
import { canUseFeature } from "~/lib/utils"

export function useSubscription() {
  const { user } = useAuth()
  const tier: SubscriptionTier = user?.subscriptionTier ?? "free"
  const limits: PlanLimits = PLANS[tier].limits

  const canUse = useCallback(
    (feature: keyof PlanLimits): boolean => canUseFeature(tier, feature),
    [tier]
  )

  const isPro = tier !== "free"
  const isThinker = tier === "thinker" || tier === "thinker_pro"
  const isThinkerPro = tier === "thinker_pro"

  return { tier, limits, canUse, isPro, isThinker, isThinkerPro }
}
