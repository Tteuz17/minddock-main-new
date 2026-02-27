/**
 * MindDock — Storage Manager
 * Chrome Storage API + IndexedDB para dados maiores.
 */

import { STORAGE_KEYS, CACHE_TTL } from "~/lib/constants"
import { setInStorage, getFromStorage, todayKey } from "~/lib/utils"

interface DailyUsage {
  date: string
  imports: number
  exports: number
  aiCalls: number
  captures: number
}

class StorageManager {
  // ─── Defaults ─────────────────────────────────────────────────────────────

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

  // ─── Daily usage tracking ─────────────────────────────────────────────────

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

  async incrementUsage(type: "imports" | "exports" | "aiCalls" | "captures"): Promise<void> {
    const usage = await this.getDailyUsage()
    usage[type]++
    await setInStorage(STORAGE_KEYS.DAILY_USAGE, usage)
  }

  async checkUsageLimit(
    type: "imports" | "exports" | "aiCalls" | "captures",
    limit: number | "unlimited"
  ): Promise<boolean> {
    if (limit === "unlimited") return true
    const usage = await this.getDailyUsage()
    return usage[type] < limit
  }

  // ─── Cache cleanup ────────────────────────────────────────────────────────

  async cleanExpiredCache(): Promise<void> {
    const now = Date.now()

    // Notebooks cache
    const nbCache = await getFromStorage<{ ts: number }>(STORAGE_KEYS.NOTEBOOKS_CACHE)
    if (nbCache && now - nbCache.ts > CACHE_TTL.NOTEBOOKS) {
      await chrome.storage.local.remove(STORAGE_KEYS.NOTEBOOKS_CACHE)
    }

    // Sources caches (prefixed keys)
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

  // ─── Settings ─────────────────────────────────────────────────────────────

  async getSettings(): Promise<Record<string, unknown>> {
    return (await getFromStorage<Record<string, unknown>>(STORAGE_KEYS.SETTINGS)) ?? {}
  }

  async updateSettings(patch: Record<string, unknown>): Promise<void> {
    const current = await this.getSettings()
    await setInStorage(STORAGE_KEYS.SETTINGS, { ...current, ...patch })
  }
}

export const storageManager = new StorageManager()
