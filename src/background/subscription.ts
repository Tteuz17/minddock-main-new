/**
 * MindDock — Subscription Manager
 * Verifica e cacheia o plano do usuário.
 */

import { STORAGE_KEYS, CACHE_TTL, PLANS } from "~/lib/constants"
import { getFromStorage, setInStorage } from "~/lib/utils"
import { authManager } from "./auth-manager"
import type { SubscriptionTier, PlanLimits } from "~/lib/types"

interface SubscriptionCache {
  tier: SubscriptionTier
  status: string
  ts: number
}

class SubscriptionManager {
  async getTier(): Promise<SubscriptionTier> {
    // Verifica cache
    const cached = await getFromStorage<SubscriptionCache>(STORAGE_KEYS.SUBSCRIPTION)
    if (cached && Date.now() - cached.ts < CACHE_TTL.SUBSCRIPTION) {
      return cached.tier
    }

    // Busca do perfil
    const user = await authManager.getCurrentUser()
    const tier = user?.subscriptionTier ?? "free"

    await setInStorage(STORAGE_KEYS.SUBSCRIPTION, {
      tier,
      status: user?.subscriptionStatus ?? "inactive",
      ts: Date.now()
    })

    return tier
  }

  async getLimits(): Promise<PlanLimits> {
    const tier = await this.getTier()
    return PLANS[tier].limits
  }

  async canUseFeature(feature: keyof PlanLimits): Promise<boolean> {
    const limits = await this.getLimits()
    const val = limits[feature]
    if (typeof val === "boolean") return val
    if (val === "unlimited") return true
    return (val as number) > 0
  }

  async invalidate(): Promise<void> {
    await chrome.storage.local.remove(STORAGE_KEYS.SUBSCRIPTION)
  }
}

export const subscriptionManager = new SubscriptionManager()
