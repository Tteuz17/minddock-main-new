/**
 * MindDock — Supabase Client (popup/sidepanel/content scripts)
 * Lazy init para evitar crash no import quando variaveis ainda nao estao carregadas.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { FIXED_STORAGE_KEYS } from "~/lib/contracts"

interface SupabaseConfig {
  url: string
  anonKey: string
}

let cachedClient: SupabaseClient | null = null
let pendingClient: Promise<SupabaseClient> | null = null
let missingConfigLogged = false

export async function getSupabaseClient(): Promise<SupabaseClient> {
  if (cachedClient) {
    return cachedClient
  }

  if (pendingClient) {
    return pendingClient
  }

  pendingClient = (async () => {
    const config = await resolveSupabaseConfig()
    const client = createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    })

    cachedClient = client
    return client
  })().finally(() => {
    pendingClient = null
  })

  return pendingClient
}

async function resolveSupabaseConfig(): Promise<SupabaseConfig> {
  const fromStorage = await getConfigFromStorage()
  const fromEnv = getConfigFromEnv()

  const url = fromStorage.url || fromEnv.url
  const anonKey = fromStorage.anonKey || fromEnv.anonKey

  if (!url || !anonKey) {
    if (!missingConfigLogged) {
      missingConfigLogged = true
      console.error(
        "[MindDock][supabase] Configuracao ausente. Defina nexus_project_url/nexus_anon_key no chrome.storage.local ou PLASMO_PUBLIC_SUPABASE_URL/PLASMO_PUBLIC_SUPABASE_ANON_KEY no ambiente."
      )
    }

    throw new Error(
      "Configuracao Supabase ausente. Configure nexus_project_url/nexus_anon_key ou variaveis PLASMO_PUBLIC_SUPABASE_URL e PLASMO_PUBLIC_SUPABASE_ANON_KEY."
    )
  }

  // Mantem storage canonical preenchido sempre que possivel.
  if (canUseChromeStorage()) {
    void chrome.storage.local.set({
      [FIXED_STORAGE_KEYS.PROJECT_URL]: url,
      [FIXED_STORAGE_KEYS.ANON_KEY]: anonKey
    })
  }

  return { url, anonKey }
}

async function getConfigFromStorage(): Promise<Partial<SupabaseConfig>> {
  if (!canUseChromeStorage()) {
    return {}
  }

  try {
    const snapshot = await chrome.storage.local.get([
      FIXED_STORAGE_KEYS.PROJECT_URL,
      FIXED_STORAGE_KEYS.ANON_KEY
    ])

    const url = String(snapshot[FIXED_STORAGE_KEYS.PROJECT_URL] ?? "").trim()
    const anonKey = String(snapshot[FIXED_STORAGE_KEYS.ANON_KEY] ?? "").trim()

    return {
      url: url || undefined,
      anonKey: anonKey || undefined
    }
  } catch (error) {
    console.warn("[MindDock][supabase] Falha ao ler configuracao do storage local.", error)
    return {}
  }
}

function getConfigFromEnv(): Partial<SupabaseConfig> {
  const url = String(process.env.PLASMO_PUBLIC_SUPABASE_URL ?? "").trim()
  const anonKey = String(process.env.PLASMO_PUBLIC_SUPABASE_ANON_KEY ?? "").trim()

  return {
    url: url || undefined,
    anonKey: anonKey || undefined
  }
}

function canUseChromeStorage(): boolean {
  return typeof chrome !== "undefined" && !!chrome.storage?.local
}
