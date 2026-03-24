/**
 * MindDock - Storage Manager
 * Chrome Storage API + server-backed counters for quota-sensitive usage.
 */

import { STORAGE_KEYS, CACHE_TTL } from "~/lib/constants"
import { FIXED_STORAGE_KEYS } from "~/lib/contracts"
import { setInStorage, getFromStorage, todayKey } from "~/lib/utils"
import { authManager } from "./auth-manager"

interface DailyUsage {
  date: string
  imports: number
  exports: number
  aiCalls: number
  captures: number
}

type UsageType = "imports" | "exports" | "aiCalls" | "captures"
type ServerUsageMetric = "imports" | "exports" | "ai_calls" | "captures"
type AiMonthlyUsageType = "agilePrompts" | "docksSummaries" | "brainMerges"
type ServerAiMonthlyUsageMetric = "agile_prompts" | "docks_summaries" | "brain_merges"

interface AiMonthlyUsage {
  monthKey: string
  agilePrompts: number
  docksSummaries: number
  brainMerges: number
}

interface ServerUsageCache {
  token: string
  ts: number
  usage: DailyUsage
}

interface ServerAiMonthlyUsageCache {
  token: string
  ts: number
  usage: AiMonthlyUsage
}

interface ServerAiMonthlyIncrementResult {
  currentCount: number
  monthKey: string
}

const SERVER_USAGE_CACHE_TTL_MS = 30_000
const SERVER_AI_MONTHLY_CACHE_TTL_MS = 30_000
const USAGE_TYPE_TO_SERVER_METRIC: Record<UsageType, ServerUsageMetric> = {
  imports: "imports",
  exports: "exports",
  aiCalls: "ai_calls",
  captures: "captures"
}
const AI_MONTHLY_USAGE_TYPE_TO_SERVER_METRIC: Record<
  AiMonthlyUsageType,
  ServerAiMonthlyUsageMetric
> = {
  agilePrompts: "agile_prompts",
  docksSummaries: "docks_summaries",
  brainMerges: "brain_merges"
}

class StorageManager {
  private serverUsageCache: ServerUsageCache | null = null
  private serverAiMonthlyUsageCache: ServerAiMonthlyUsageCache | null = null

  async initDefaults(): Promise<void> {
    const existing = await getFromStorage(STORAGE_KEYS.SETTINGS)
    if (!existing) {
      await setInStorage(STORAGE_KEYS.SETTINGS, {
        theme: "dark",
        defaultNotebookId: null,
        agileBarVisible: true,
        clipperEnabled: true,
        notificationsEnabled: true
      })
    }
  }

  async getDailyUsage(): Promise<DailyUsage> {
    const stored = await getFromStorage<DailyUsage>(STORAGE_KEYS.DAILY_USAGE)
    const today = todayKey()

    if (!stored || stored.date !== today) {
      const fresh: DailyUsage = { date: today, imports: 0, exports: 0, aiCalls: 0, captures: 0 }
      await setInStorage(STORAGE_KEYS.DAILY_USAGE, fresh)
      return fresh
    }

    return stored
  }

  async getAiMonthlyUsage(): Promise<AiMonthlyUsage> {
    const localUsage = await this.getLocalAiMonthlyUsage()
    const serverUsage = await this.fetchServerAiMonthlyUsage(true)
    if (!serverUsage) {
      return localUsage
    }

    const merged = this.mergeAiMonthlyUsage(localUsage, serverUsage)
    if (JSON.stringify(merged) !== JSON.stringify(localUsage)) {
      await setInStorage(STORAGE_KEYS.AI_MONTHLY_USAGE, merged)
    }

    return merged
  }

  async incrementUsage(type: UsageType): Promise<void> {
    const localUsage = await this.getDailyUsage()
    localUsage[type] += 1
    await setInStorage(STORAGE_KEYS.DAILY_USAGE, localUsage)

    const serverCount = await this.incrementServerUsage(type)
    if (!Number.isFinite(serverCount) || Number(serverCount) < 0) {
      return
    }

    const refreshedLocal = await this.getDailyUsage()
    const normalizedServerCount = Math.floor(Number(serverCount))
    if (normalizedServerCount <= refreshedLocal[type]) {
      return
    }

    const syncedUsage: DailyUsage = {
      ...refreshedLocal,
      [type]: normalizedServerCount
    }
    await setInStorage(STORAGE_KEYS.DAILY_USAGE, syncedUsage)
  }

  async incrementAiMonthlyUsage(type: AiMonthlyUsageType): Promise<void> {
    const localUsage = await this.getLocalAiMonthlyUsage()
    localUsage[type] += 1
    await setInStorage(STORAGE_KEYS.AI_MONTHLY_USAGE, localUsage)

    const serverResult = await this.incrementServerAiMonthlyUsage(type)
    if (!serverResult) {
      return
    }

    await this.syncLocalAiMonthlyUsageFromServerCount(type, serverResult.currentCount, serverResult.monthKey)
  }

  async checkUsageLimit(type: UsageType, limit: number | "unlimited"): Promise<boolean> {
    if (limit === "unlimited") return true

    const localUsage = await this.getDailyUsage()
    const serverUsage = await this.fetchServerDailyUsage(true)
    if (!serverUsage) {
      return localUsage[type] < limit
    }

    const mergedUsage = this.mergeUsage(localUsage, serverUsage)
    await setInStorage(STORAGE_KEYS.DAILY_USAGE, mergedUsage)
    return mergedUsage[type] < limit
  }

  async checkAiMonthlyLimit(
    type: AiMonthlyUsageType,
    limit: number | "unlimited"
  ): Promise<boolean> {
    if (limit === "unlimited") {
      return true
    }

    const runtime = await this.resolveSupabaseRuntime()
    if (!runtime) {
      const localUsage = await this.getLocalAiMonthlyUsage()
      return localUsage[type] < limit
    }

    const localUsage = await this.getLocalAiMonthlyUsage()
    const serverUsage = await this.fetchServerAiMonthlyUsage(true)
    if (!serverUsage) {
      // When authenticated with server runtime, fail closed if quota validation is unavailable.
      return false
    }

    const merged = this.mergeAiMonthlyUsage(localUsage, serverUsage)
    if (JSON.stringify(merged) !== JSON.stringify(localUsage)) {
      await setInStorage(STORAGE_KEYS.AI_MONTHLY_USAGE, merged)
    }

    return merged[type] < limit
  }

  async cleanExpiredCache(): Promise<void> {
    const now = Date.now()

    const nbCache = await getFromStorage<{ ts: number }>(STORAGE_KEYS.NOTEBOOKS_CACHE)
    if (nbCache && now - nbCache.ts > CACHE_TTL.NOTEBOOKS) {
      await chrome.storage.local.remove(STORAGE_KEYS.NOTEBOOKS_CACHE)
    }

    chrome.storage.local.get(null, (items) => {
      const toRemove: string[] = []
      for (const [key, value] of Object.entries(items)) {
        if (key.startsWith(STORAGE_KEYS.SOURCES_CACHE)) {
          const cached = value as { ts: number }
          if (now - cached.ts > CACHE_TTL.SOURCES) {
            toRemove.push(key)
          }
        }
      }
      if (toRemove.length > 0) {
        chrome.storage.local.remove(toRemove)
      }
    })
  }

  async getSettings(): Promise<Record<string, unknown>> {
    return (await getFromStorage<Record<string, unknown>>(STORAGE_KEYS.SETTINGS)) ?? {}
  }

  async updateSettings(patch: Record<string, unknown>): Promise<void> {
    const current = await this.getSettings()
    await setInStorage(STORAGE_KEYS.SETTINGS, { ...current, ...patch })
  }

  private mergeUsage(localUsage: DailyUsage, serverUsage: DailyUsage): DailyUsage {
    return {
      date: serverUsage.date,
      imports: Math.max(localUsage.imports, serverUsage.imports),
      exports: Math.max(localUsage.exports, serverUsage.exports),
      aiCalls: Math.max(localUsage.aiCalls, serverUsage.aiCalls),
      captures: Math.max(localUsage.captures, serverUsage.captures)
    }
  }

  private buildEmptyAiMonthlyUsage(monthKey: string): AiMonthlyUsage {
    return {
      monthKey,
      agilePrompts: 0,
      docksSummaries: 0,
      brainMerges: 0
    }
  }

  private mergeAiMonthlyUsage(localUsage: AiMonthlyUsage, serverUsage: AiMonthlyUsage): AiMonthlyUsage {
    const monthKey = serverUsage.monthKey
    const localForMonth = localUsage.monthKey === monthKey ? localUsage : this.buildEmptyAiMonthlyUsage(monthKey)

    return {
      monthKey,
      agilePrompts: Math.max(localForMonth.agilePrompts, serverUsage.agilePrompts),
      docksSummaries: Math.max(localForMonth.docksSummaries, serverUsage.docksSummaries),
      brainMerges: Math.max(localForMonth.brainMerges, serverUsage.brainMerges)
    }
  }

  private normalizeServerMonthKey(value: unknown, fallbackMonthKey: string): string {
    const normalized = String(value ?? "").trim()
    const match = normalized.match(/^(\d{4}-\d{2})/)
    return match?.[1] ?? fallbackMonthKey
  }

  private normalizeNonNegativeInt(value: unknown): number {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) {
      return 0
    }
    return Math.max(0, Math.floor(numeric))
  }

  private mapServerUsageToLocal(row: Record<string, unknown> | null, date: string): DailyUsage {
    return {
      date,
      imports: this.normalizeNonNegativeInt(row?.imports),
      exports: this.normalizeNonNegativeInt(row?.exports),
      aiCalls: this.normalizeNonNegativeInt(row?.ai_calls),
      captures: this.normalizeNonNegativeInt(row?.captures)
    }
  }

  private mapServerAiMonthlyUsageToLocal(
    row: Record<string, unknown> | null,
    fallbackMonthKey: string
  ): AiMonthlyUsage {
    const monthKey = this.normalizeServerMonthKey(row?.month_key, fallbackMonthKey)
    return {
      monthKey,
      agilePrompts: this.normalizeNonNegativeInt(row?.agile_prompts),
      docksSummaries: this.normalizeNonNegativeInt(row?.docks_summaries),
      brainMerges: this.normalizeNonNegativeInt(row?.brain_merges)
    }
  }

  private async getLocalAiMonthlyUsage(): Promise<AiMonthlyUsage> {
    const stored = await getFromStorage<AiMonthlyUsage>(STORAGE_KEYS.AI_MONTHLY_USAGE)
    const currentMonth = this.monthKey()

    if (!stored || stored.monthKey !== currentMonth) {
      const fresh = this.buildEmptyAiMonthlyUsage(currentMonth)
      await setInStorage(STORAGE_KEYS.AI_MONTHLY_USAGE, fresh)
      return fresh
    }

    return {
      monthKey: currentMonth,
      agilePrompts: this.normalizeNonNegativeInt(stored.agilePrompts),
      docksSummaries: this.normalizeNonNegativeInt(stored.docksSummaries),
      brainMerges: this.normalizeNonNegativeInt(stored.brainMerges)
    }
  }

  private monthKey(): string {
    return new Date().toISOString().slice(0, 7) // YYYY-MM
  }

  private monthStartDate(monthKey: string): string {
    return `${monthKey}-01`
  }

  private async resolveSupabaseRuntime(): Promise<{
    token: string
    supabaseUrl: string
    anonKey: string
  } | null> {
    const token = await authManager.getAccessToken()
    if (!token) {
      this.serverUsageCache = null
      this.serverAiMonthlyUsageCache = null
      return null
    }

    const supabaseUrl =
      (await getFromStorage<string>(FIXED_STORAGE_KEYS.PROJECT_URL)) ??
      process.env.PLASMO_PUBLIC_SUPABASE_URL
    const anonKey =
      (await getFromStorage<string>(FIXED_STORAGE_KEYS.ANON_KEY)) ??
      process.env.PLASMO_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !anonKey) {
      return null
    }

    return { token, supabaseUrl, anonKey }
  }

  private async fetchServerDailyUsage(forceRefresh = false): Promise<DailyUsage | null> {
    try {
      const runtime = await this.resolveSupabaseRuntime()
      if (!runtime) {
        return null
      }

      const today = todayKey()
      const cache = this.serverUsageCache
      if (
        !forceRefresh &&
        cache &&
        cache.token === runtime.token &&
        cache.usage.date === today &&
        Date.now() - cache.ts < SERVER_USAGE_CACHE_TTL_MS
      ) {
        return { ...cache.usage }
      }

      const query = new URLSearchParams({
        select: "usage_date,imports,exports,ai_calls,captures",
        usage_date: `eq.${today}`,
        limit: "1"
      })

      const res = await fetch(`${runtime.supabaseUrl}/rest/v1/daily_usage?${query.toString()}`, {
        headers: {
          apikey: runtime.anonKey,
          Authorization: `Bearer ${runtime.token}`,
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        }
      })

      if (!res.ok) {
        return null
      }

      const rows = (await res.json()) as Array<Record<string, unknown>>
      const serverUsage = this.mapServerUsageToLocal(rows?.[0] ?? null, today)
      this.serverUsageCache = {
        token: runtime.token,
        ts: Date.now(),
        usage: serverUsage
      }
      return { ...serverUsage }
    } catch {
      return null
    }
  }

  private async fetchServerAiMonthlyUsage(forceRefresh = false): Promise<AiMonthlyUsage | null> {
    try {
      const runtime = await this.resolveSupabaseRuntime()
      if (!runtime) {
        return null
      }

      const currentMonthKey = this.monthKey()
      const monthStart = this.monthStartDate(currentMonthKey)
      const cache = this.serverAiMonthlyUsageCache

      if (
        !forceRefresh &&
        cache &&
        cache.token === runtime.token &&
        cache.usage.monthKey === currentMonthKey &&
        Date.now() - cache.ts < SERVER_AI_MONTHLY_CACHE_TTL_MS
      ) {
        return { ...cache.usage }
      }

      const query = new URLSearchParams({
        select: "month_key,agile_prompts,docks_summaries,brain_merges",
        month_key: `eq.${monthStart}`,
        limit: "1"
      })

      const res = await fetch(`${runtime.supabaseUrl}/rest/v1/ai_monthly_usage?${query.toString()}`, {
        headers: {
          apikey: runtime.anonKey,
          Authorization: `Bearer ${runtime.token}`,
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        }
      })

      if (!res.ok) {
        return null
      }

      const rows = (await res.json()) as Array<Record<string, unknown>>
      const serverUsage = this.mapServerAiMonthlyUsageToLocal(rows?.[0] ?? null, currentMonthKey)
      this.serverAiMonthlyUsageCache = {
        token: runtime.token,
        ts: Date.now(),
        usage: serverUsage
      }

      return { ...serverUsage }
    } catch {
      return null
    }
  }

  private async incrementServerUsage(type: UsageType): Promise<number | null> {
    try {
      const runtime = await this.resolveSupabaseRuntime()
      if (!runtime) {
        return null
      }

      const metric = USAGE_TYPE_TO_SERVER_METRIC[type]
      const res = await fetch(`${runtime.supabaseUrl}/rest/v1/rpc/increment_daily_usage`, {
        method: "POST",
        headers: {
          apikey: runtime.anonKey,
          Authorization: `Bearer ${runtime.token}`,
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        },
        body: JSON.stringify({ p_metric: metric })
      })

      if (!res.ok) {
        return null
      }

      const payload = (await res.json()) as
        | { current_count?: unknown }
        | Array<{ current_count?: unknown }>
      const currentCountValue = Array.isArray(payload)
        ? payload?.[0]?.current_count
        : payload?.current_count
      const currentCount = this.normalizeNonNegativeInt(currentCountValue)

      const today = todayKey()
      const existing = this.serverUsageCache
      const nextUsage: DailyUsage =
        existing?.usage?.date === today
          ? { ...existing.usage, [type]: Math.max(existing.usage[type], currentCount) }
          : {
              date: today,
              imports: type === "imports" ? currentCount : 0,
              exports: type === "exports" ? currentCount : 0,
              aiCalls: type === "aiCalls" ? currentCount : 0,
              captures: type === "captures" ? currentCount : 0
            }

      this.serverUsageCache = {
        token: runtime.token,
        ts: Date.now(),
        usage: nextUsage
      }

      return currentCount
    } catch {
      return null
    }
  }

  private async incrementServerAiMonthlyUsage(
    type: AiMonthlyUsageType
  ): Promise<ServerAiMonthlyIncrementResult | null> {
    try {
      const runtime = await this.resolveSupabaseRuntime()
      if (!runtime) {
        return null
      }

      const metric = AI_MONTHLY_USAGE_TYPE_TO_SERVER_METRIC[type]
      const res = await fetch(`${runtime.supabaseUrl}/rest/v1/rpc/increment_ai_monthly_usage`, {
        method: "POST",
        headers: {
          apikey: runtime.anonKey,
          Authorization: `Bearer ${runtime.token}`,
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        },
        body: JSON.stringify({ p_metric: metric })
      })

      if (!res.ok) {
        return null
      }

      const payload = (await res.json()) as
        | { current_count?: unknown; month_key?: unknown }
        | Array<{ current_count?: unknown; month_key?: unknown }>
      const row = Array.isArray(payload) ? payload?.[0] : payload
      const currentCount = this.normalizeNonNegativeInt(row?.current_count)

      const fallbackMonthKey = this.monthKey()
      const monthKey = this.normalizeServerMonthKey(row?.month_key, fallbackMonthKey)
      const existingUsage =
        this.serverAiMonthlyUsageCache?.usage?.monthKey === monthKey
          ? this.serverAiMonthlyUsageCache.usage
          : this.buildEmptyAiMonthlyUsage(monthKey)

      const nextUsage: AiMonthlyUsage = {
        ...existingUsage,
        [type]: Math.max(existingUsage[type], currentCount)
      }

      this.serverAiMonthlyUsageCache = {
        token: runtime.token,
        ts: Date.now(),
        usage: nextUsage
      }

      return {
        currentCount,
        monthKey
      }
    } catch {
      return null
    }
  }

  private async syncLocalAiMonthlyUsageFromServerCount(
    type: AiMonthlyUsageType,
    serverCount: number,
    monthKey: string
  ): Promise<void> {
    const localUsage = await this.getLocalAiMonthlyUsage()
    const baseUsage =
      localUsage.monthKey === monthKey ? localUsage : this.buildEmptyAiMonthlyUsage(monthKey)

    if (serverCount <= baseUsage[type] && baseUsage.monthKey === localUsage.monthKey) {
      return
    }

    await setInStorage(STORAGE_KEYS.AI_MONTHLY_USAGE, {
      ...baseUsage,
      [type]: Math.max(baseUsage[type], serverCount)
    })
  }
}

export const storageManager = new StorageManager()
