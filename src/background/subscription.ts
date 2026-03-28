/**
 * MindDock - Subscription Manager
 * Uses Supabase as source of truth for plan checks.
 * Keeps only a short-lived in-memory cache bound to the current auth token.
 */

import { STORAGE_KEYS, PLANS, resolvePlanLimits } from "~/lib/constants"
import { FIXED_STORAGE_KEYS } from "~/lib/contracts"
import { getFromStorage } from "~/lib/utils"
import { authManager } from "./auth-manager"
import type { SubscriptionCycle, SubscriptionTier, PlanLimits } from "~/lib/types"

const SERVER_CACHE_TTL_MS = 5 * 60 * 1000 // 5 min
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"])
const DAILY_IMPORTS_UNLIMITED_EMAILS = new Set(["loveadoisoficial@gmail.com"])

interface SubscriptionCache {
  tier: SubscriptionTier
  cycle: SubscriptionCycle
  status: string
  ts: number
  token: string
}

interface ResolvedSubscription {
  tier: SubscriptionTier
  cycle: SubscriptionCycle
}

class SubscriptionManager {
  private memoryCache: SubscriptionCache | null = null

  private hasDailyImportsUnlimitedOverride(email: string | null | undefined): boolean {
    const normalizedEmail = String(email ?? "")
      .trim()
      .toLowerCase()

    if (!normalizedEmail) {
      return false
    }

    return DAILY_IMPORTS_UNLIMITED_EMAILS.has(normalizedEmail)
  }

  async getTier(): Promise<SubscriptionTier> {
    const resolved = await this.getResolvedSubscription()
    return resolved.tier
  }

  async getCycle(): Promise<SubscriptionCycle> {
    const resolved = await this.getResolvedSubscription()
    return resolved.cycle
  }

  private async getResolvedSubscription(): Promise<ResolvedSubscription> {
    const bypass = await this.getBypassSubscription()
    if (bypass) {
      return bypass
    }

    const token = await authManager.getAccessToken()
    if (!token) {
      this.memoryCache = null
      return { tier: "free", cycle: "none" }
    }

    const cached = this.memoryCache
    if (cached && cached.token === token && Date.now() - cached.ts < SERVER_CACHE_TTL_MS) {
      return { tier: cached.tier, cycle: cached.cycle }
    }

    const fresh = await this.fetchTierFromServer(token)
    if (fresh) {
      return fresh
    }

    if (cached && cached.token === token && Date.now() - cached.ts < SERVER_CACHE_TTL_MS) {
      return { tier: cached.tier, cycle: cached.cycle }
    }

    return { tier: "free", cycle: "none" }
  }

  private async fetchTierFromServer(token: string): Promise<ResolvedSubscription | null> {
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

      const userId = this.extractUserIdFromJwt(token) || (await authManager.getCurrentUser())?.id || ""
      const query = new URLSearchParams({
        select: "subscription_tier,subscription_status,subscription_cycle",
        limit: "1"
      })
      if (userId) {
        query.set("id", `eq.${userId}`)
      }

      const res = await fetch(`${supabaseUrl}/rest/v1/profiles?${query.toString()}`, {
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          }
        })

      if (!res.ok) {
        return null
      }

      const rows = (await res.json()) as Array<{
        subscription_tier?: string
        subscription_status?: string
        subscription_cycle?: string
      }>

      const row = rows?.[0]
      if (!row) {
        return null
      }

      const tier = this.normalizeTier(row.subscription_tier)
      const status = String(row.subscription_status ?? "inactive")
        .trim()
        .toLowerCase()
      const cycle = this.normalizeCycle(row.subscription_cycle)
      const effectiveTier = ACTIVE_SUBSCRIPTION_STATUSES.has(status) ? tier : "free"
      const effectiveCycle = effectiveTier === "free" ? "none" : cycle

      this.memoryCache = {
        tier: effectiveTier,
        cycle: effectiveCycle,
        status,
        token,
        ts: Date.now()
      }

      return {
        tier: effectiveTier,
        cycle: effectiveCycle
      }
    } catch {
      return null
    }
  }

  private extractUserIdFromJwt(token: string | null | undefined): string | null {
    const raw = String(token ?? "").trim()
    if (!raw) return null
    const parts = raw.split(".")
    if (parts.length < 2) return null
    const payloadPart = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const padded = payloadPart.padEnd(Math.ceil(payloadPart.length / 4) * 4, "=")

    try {
      const decoded = atob(padded)
      const parsed = JSON.parse(decoded) as { sub?: unknown; user_id?: unknown }
      const id = String(parsed?.sub ?? parsed?.user_id ?? "").trim()
      return id || null
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

  private normalizeCycle(rawCycle: unknown): SubscriptionCycle {
    const candidate = String(rawCycle ?? "")
      .trim()
      .toLowerCase()
    if (candidate === "monthly" || candidate === "yearly") {
      return candidate
    }
    return "none"
  }

  private async getBypassSubscription(): Promise<ResolvedSubscription | null> {
    const raw = await getFromStorage<Record<string, unknown>>(STORAGE_KEYS.DEV_AUTH_BYPASS)
    if (!raw || typeof raw !== "object" || raw.enabled !== true) {
      return null
    }

    const tier = this.normalizeTier(String(raw.tier ?? ""))
    const cycle = this.normalizeCycle(raw.cycle)
    if (tier === "free" || tier === "pro") {
      return { tier: "thinker", cycle: cycle === "none" ? "monthly" : cycle }
    }
    return { tier, cycle: cycle === "none" ? "monthly" : cycle }
  }

  async getLimits(): Promise<PlanLimits> {
    const { tier, cycle } = await this.getResolvedSubscription()
    const resolvedLimits = resolvePlanLimits(tier, cycle)
    const currentUser = await authManager.getCurrentUser()

    if (!this.hasDailyImportsUnlimitedOverride(currentUser?.email)) {
      return resolvedLimits
    }

    return {
      ...resolvedLimits,
      imports_per_day: "unlimited"
    }
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
