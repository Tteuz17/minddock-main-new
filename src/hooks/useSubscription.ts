import { useCallback, useEffect, useState } from "react"
import { useAuth } from "./useAuth"
import type { SubscriptionTier, PlanLimits, SubscriptionCycle } from "~/lib/types"
import { resolvePlanLimits } from "~/lib/constants"
import { canUseFeature } from "~/lib/utils"

type ResolvedSubscription = { tier: SubscriptionTier; cycle: SubscriptionCycle }
type SubscriptionProbePayload = { tier?: SubscriptionTier; cycle?: SubscriptionCycle } | null

const SUBSCRIPTION_PROBE_TTL_MS = 30_000
let subscriptionProbeCache: { ts: number; userId: string; payload: SubscriptionProbePayload } | null = null
let subscriptionProbeInFlight: Promise<SubscriptionProbePayload> | null = null

function getSafeRuntime(): typeof chrome.runtime | null {
  if (typeof chrome === "undefined") {
    return null
  }

  try {
    const runtime = chrome.runtime
    if (!runtime?.id) {
      return null
    }
    return runtime
  } catch {
    return null
  }
}

function normalizeTier(value: unknown, fallback: SubscriptionTier): SubscriptionTier {
  const candidate = String(value ?? "")
    .trim()
    .toLowerCase()
  if (candidate === "free" || candidate === "pro" || candidate === "thinker" || candidate === "thinker_pro") {
    return candidate as SubscriptionTier
  }
  return fallback
}

function normalizeCycle(value: unknown, fallback: SubscriptionCycle): SubscriptionCycle {
  const candidate = String(value ?? "")
    .trim()
    .toLowerCase()
  if (candidate === "monthly" || candidate === "yearly") {
    return candidate as SubscriptionCycle
  }
  return fallback
}

async function fetchSubscriptionProbe(
  runtime: typeof chrome.runtime
): Promise<SubscriptionProbePayload> {
  try {
    const response = await runtime.sendMessage({ command: "MINDDOCK_CHECK_SUBSCRIPTION" })
    if (response?.success === false) return null
    const payload = (response?.payload ?? response?.data) as
      | { tier?: SubscriptionTier; cycle?: SubscriptionCycle }
      | undefined
    if (!payload) return null
    return { tier: payload.tier, cycle: payload.cycle }
  } catch {
    return null
  }
}

export function useSubscription() {
  const { user } = useAuth()
  const baseTier: SubscriptionTier = user?.subscriptionTier ?? "free"
  const baseCycle: SubscriptionCycle = user?.subscriptionCycle ?? "none"
  const [resolved, setResolved] = useState<ResolvedSubscription | null>(null)

  useEffect(() => {
    if (!user) {
      setResolved(null)
      return
    }

    const runtime = getSafeRuntime()
    if (!runtime?.sendMessage) {
      setResolved(null)
      return
    }

    const userId = String(user.id ?? "").trim()
    if (userId && subscriptionProbeCache) {
      const isFresh =
        subscriptionProbeCache.userId === userId &&
        Date.now() - subscriptionProbeCache.ts < SUBSCRIPTION_PROBE_TTL_MS
      if (isFresh) {
        const cached = subscriptionProbeCache.payload
        if (cached) {
          const tier = normalizeTier(cached.tier, baseTier)
          const cycle = normalizeCycle(cached.cycle, baseCycle)
          setResolved({ tier, cycle })
          return
        }
      }
    }

    let isMounted = true
    const inFlight =
      subscriptionProbeInFlight ?? fetchSubscriptionProbe(runtime)
    subscriptionProbeInFlight = inFlight

    inFlight
      .then((payload) => {
        if (!isMounted) return
        subscriptionProbeCache = { ts: Date.now(), userId, payload }
        if (!payload) return
        const tier = normalizeTier(payload.tier, baseTier)
        const cycle = normalizeCycle(payload.cycle, baseCycle)
        setResolved({ tier, cycle })
      })
      .finally(() => {
        subscriptionProbeInFlight = null
      })

    return () => {
      isMounted = false
    }
  }, [user?.id, baseTier, baseCycle])

  const tier = resolved?.tier ?? baseTier
  const cycle = resolved?.cycle ?? baseCycle
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
