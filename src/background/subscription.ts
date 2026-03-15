/**
 * MindDock - Subscription Manager
 * Uses Supabase as source of truth for plan checks.
 * Keeps only a short-lived in-memory cache bound to the current auth token.
 */

import { STORAGE_KEYS, PLANS } from "~/lib/constants"
import { FIXED_STORAGE_KEYS } from "~/lib/contracts"
import { getFromStorage } from "~/lib/utils"
import { authManager } from "./auth-manager"
import type { SubscriptionTier, PlanLimits } from "~/lib/types"

const SERVER_CACHE_TTL_MS = 5 * 60 * 1000 // 5 min
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"])

interface SubscriptionCache {
  tier: SubscriptionTier
  status: string
  ts: number
  token: string
}

class SubscriptionManager {
  private memoryCache: SubscriptionCache | null = null

  async getTier(): Promise<SubscriptionTier> {
    const bypassTier = await this.getBypassTier()
    if (bypassTier) {
      return bypassTier
    }

    const token = await authManager.getAccessToken()
    if (!token) {
      this.memoryCache = null
      return "free"
    }

    // Reuse only a server-verified cache bound to this exact token.
    const cached = this.memoryCache
    if (cached && cached.token === token && Date.now() - cached.ts < SERVER_CACHE_TTL_MS) {
      return cached.tier
    }

    // Always prioritize server verification.
    const fresh = await this.fetchTierFromServer(token)
    if (fresh) {
      return fresh
    }

    // Fail closed when server check is unavailable.
    if (cached && cached.token === token && Date.now() - cached.ts < SERVER_CACHE_TTL_MS) {
      return cached.tier
    }

    return "free"
  }

  private async fetchTierFromServer(token: string): Promise<SubscriptionTier | null> {
    try {
      const supabaseUrl =
        (await getFromStorage<string>(FIXED_STORAGE_KEYS.PROJECT_URL)) ??
        process.env.PLASMO_PUBLIC_SUPABASE_URL

      const anonKey =
        (await getFromStorage<string>(FIXED_STORAGE_KEYS.ANON_KEY)) ??
        process.env.PLASMO_PUBLIC_SUPABASE_ANON_KEY

      if (!supabaseUrl || !anonKey || !token) {
        return null
      }

      const res = await fetch(
        `${supabaseUrl}/rest/v1/profiles?select=subscription_tier,subscription_status&limit=1`,
        {
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          }
        }
      )

      if (!res.ok) {
        return null
      }

      const rows = (await res.json()) as Array<{
        subscription_tier?: string
        subscription_status?: string
      }>

      const row = rows?.[0]
      if (!row) {
        return null
      }

      const tier = this.normalizeTier(row.subscription_tier)
      const status = String(row.subscription_status ?? "inactive")
        .trim()
        .toLowerCase()
      const effectiveTier = ACTIVE_SUBSCRIPTION_STATUSES.has(status) ? tier : "free"

      this.memoryCache = {
        tier: effectiveTier,
        status,
        token,
        ts: Date.now()
      }

      return effectiveTier
    } catch {
      return null
    }
  }

  private normalizeTier(rawTier: string | undefined): SubscriptionTier {
    const candidate = String(rawTier ?? "")
      .trim()
      .toLowerCase()
    if (candidate && candidate in PLANS) {
      return candidate as SubscriptionTier
    }
    return "free"
  }

  private async getBypassTier(): Promise<SubscriptionTier | null> {
    const raw = await getFromStorage<Record<string, unknown>>(STORAGE_KEYS.DEV_AUTH_BYPASS)
    if (!raw || typeof raw !== "object" || raw.enabled !== true) {
      return null
    }

    const tier = this.normalizeTier(String(raw.tier ?? ""))
    if (tier === "free" || tier === "pro") {
      return "thinker"
    }
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
    this.memoryCache = null
    // Backwards-compat cleanup for previous persisted cache key.
    await chrome.storage.local.remove(STORAGE_KEYS.SUBSCRIPTION)
  }
}

export const subscriptionManager = new SubscriptionManager()
