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

interface ServerUsageCache {
  token: string
  ts: number
  usage: DailyUsage
}

const SERVER_USAGE_CACHE_TTL_MS = 30_000
const USAGE_TYPE_TO_SERVER_METRIC: Record<UsageType, ServerUsageMetric> = {
  imports: "imports",
  exports: "exports",
  aiCalls: "ai_calls",
  captures: "captures"
}

class StorageManager {
  private serverUsageCache: ServerUsageCache | null = null

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

  private async resolveSupabaseRuntime(): Promise<{
    token: string
    supabaseUrl: string
    anonKey: string
  } | null> {
    const token = await authManager.getAccessToken()
    if (!token) {
      this.serverUsageCache = null
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
}

export const storageManager = new StorageManager()
