import {
  createClient,
  type Session,
  type SupabaseClient,
  type User
} from "@supabase/supabase-js"
import { STORAGE_KEYS } from "~/lib/constants"
import { FIXED_STORAGE_KEYS } from "~/lib/contracts"
import { getFromStorage, removeFromStorage, setInStorage } from "~/lib/utils"
import type { UserProfile } from "~/lib/types"

interface SupabaseConfig {
  url: string
  anonKey: string
}

class AuthManager {
  private supabase: SupabaseClient | null = null
  private listeners: Array<(user: UserProfile | null) => void> = []
  private authListenerBound = false

  async initializeSession(): Promise<UserProfile | null> {
    const client = await this.getClient()
    const { data, error } = await client.auth.getSession()

    if (error && !this.isAuthSessionMissingError(error)) {
      throw new Error(`Falha ao inicializar sessao Supabase: ${error.message}`)
    }

    if (data.session) {
      await this.persistSession(data.session)
      const profile = await this.fetchProfile(data.session.user)
      this.notifyListeners(profile)
      return profile
    }

    // Sem sessão Supabase — mas preserva perfis dev (id começa com "dev-")
    const existingProfile = await getFromStorage<UserProfile>(STORAGE_KEYS.USER_PROFILE)
    if (existingProfile?.id?.startsWith("dev-")) {
      this.notifyListeners(existingProfile)
      return existingProfile
    }

    await removeFromStorage(FIXED_STORAGE_KEYS.SUPABASE_SESSION)
    await removeFromStorage(STORAGE_KEYS.USER_PROFILE)
    this.notifyListeners(null)
    return null
  }

  async signIn(email: string, password: string): Promise<UserProfile> {
    if (!email?.trim()) {
      throw new Error("Email obrigatorio para autenticar.")
    }
    if (!password?.trim()) {
      throw new Error("Senha obrigatoria para autenticar.")
    }

    const client = await this.getClient()
    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim(),
      password
    })

    if (error || !data.session?.user) {
      throw new Error(`Falha no login Supabase: ${error?.message ?? "credenciais invalidas"}`)
    }

    await this.persistSession(data.session)
    const profile = await this.fetchProfile(data.session.user)
    this.notifyListeners(profile)
    return profile
  }

  // Legacy path kept for existing popup flow.
  async signInWithGoogle(): Promise<{ url: string }> {
    const client = await this.getClient()
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: chrome.identity.getRedirectURL("supabase"),
        queryParams: { access_type: "offline", prompt: "consent" }
      }
    })

    if (error || !data.url) {
      throw new Error(`Falha ao iniciar login Google: ${error?.message ?? "sem URL de redirect"}`)
    }

    return { url: data.url }
  }

  async completeOAuthFlow(redirectUrl: string): Promise<UserProfile> {
    const client = await this.getClient()
    const parsed = new URL(redirectUrl)
    const code = parsed.searchParams.get("code")

    if (code) {
      const { data, error } = await client.auth.exchangeCodeForSession(code)
      if (error || !data.session?.user) {
        throw new Error(`Falha ao concluir OAuth Supabase: ${error?.message ?? "codigo invalido"}`)
      }

      await this.persistSession(data.session)
      const profile = await this.fetchProfile(data.session.user)
      this.notifyListeners(profile)
      return profile
    }

    const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash
    const hashParams = new URLSearchParams(hash)
    const accessToken = hashParams.get("access_token")
    const refreshToken = hashParams.get("refresh_token")

    if (accessToken && refreshToken) {
      const { data, error } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      })

      if (error || !data.session?.user) {
        throw new Error(
          `Falha ao aplicar sessao OAuth Supabase: ${error?.message ?? "token invalido"}`
        )
      }

      await this.persistSession(data.session)
      const profile = await this.fetchProfile(data.session.user)
      this.notifyListeners(profile)
      return profile
    }

    throw new Error("Redirect OAuth invalido: nenhum codigo/token encontrado.")
  }

  async signOut(): Promise<void> {
    const client = await this.getClient()
    const { error } = await client.auth.signOut()

    if (error) {
      throw new Error(`Falha no logout Supabase: ${error.message}`)
    }

    await removeFromStorage(FIXED_STORAGE_KEYS.SUPABASE_SESSION)
    await removeFromStorage(STORAGE_KEYS.USER_PROFILE)
    await removeFromStorage(STORAGE_KEYS.SUBSCRIPTION)
    this.notifyListeners(null)
  }

  async getCurrentUser(): Promise<UserProfile | null> {
    const cached = await getFromStorage<UserProfile>(STORAGE_KEYS.USER_PROFILE)
    if (cached) {
      return cached
    }

    const client = await this.getClient()
    const { data: sessionData, error: sessionError } = await client.auth.getSession()

    if (sessionError && !this.isAuthSessionMissingError(sessionError)) {
      throw new Error(`Falha ao obter sessao atual: ${sessionError.message}`)
    }

    const sessionUser = sessionData.session?.user
    if (!sessionUser) {
      return null
    }

    return this.fetchProfile(sessionUser)
  }

  onAuthStateChange(listener: (user: UserProfile | null) => void): void {
    this.listeners.push(listener)
  }

  private async getClient(): Promise<SupabaseClient> {
    if (this.supabase) {
      return this.supabase
    }

    const { url, anonKey } = await this.resolveSupabaseConfig()
    this.supabase = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        storageKey: FIXED_STORAGE_KEYS.SUPABASE_SESSION,
        storage: {
          getItem: async (key: string) => {
            const value = await getFromStorage<string>(key)
            return value ?? null
          },
          setItem: async (key: string, value: string) => {
            await setInStorage(key, value)
          },
          removeItem: async (key: string) => {
            await removeFromStorage(key)
          }
        }
      }
    })

    this.bindAuthStateListener()
    return this.supabase
  }

  private bindAuthStateListener(): void {
    if (!this.supabase || this.authListenerBound) {
      return
    }

    this.authListenerBound = true
    this.supabase.auth.onAuthStateChange((_event, session) => {
      void this.handleAuthStateChanged(session)
    })
  }

  private async handleAuthStateChanged(session: Session | null): Promise<void> {
    if (!session?.user) {
      await removeFromStorage(FIXED_STORAGE_KEYS.SUPABASE_SESSION)
      await removeFromStorage(STORAGE_KEYS.USER_PROFILE)
      this.notifyListeners(null)
      return
    }

    await this.persistSession(session)
    const profile = await this.fetchProfile(session.user)
    this.notifyListeners(profile)
  }

  private async resolveSupabaseConfig(): Promise<SupabaseConfig> {
    const storedUrl = await getFromStorage<string>(FIXED_STORAGE_KEYS.PROJECT_URL)
    const storedAnonKey = await getFromStorage<string>(FIXED_STORAGE_KEYS.ANON_KEY)

    const envUrl = process.env.PLASMO_PUBLIC_SUPABASE_URL
    const envAnonKey = process.env.PLASMO_PUBLIC_SUPABASE_ANON_KEY

    const url = storedUrl ?? envUrl
    const anonKey = storedAnonKey ?? envAnonKey

    if (!url || !anonKey) {
      throw new Error(
        "Configuracao Supabase ausente. Defina PLASMO_PUBLIC_SUPABASE_URL e PLASMO_PUBLIC_SUPABASE_ANON_KEY."
      )
    }

    // Keep canonical config in required keys.
    await setInStorage(FIXED_STORAGE_KEYS.PROJECT_URL, url)
    await setInStorage(FIXED_STORAGE_KEYS.ANON_KEY, anonKey)

    return { url, anonKey }
  }

  private async persistSession(session: Session): Promise<void> {
    await setInStorage(FIXED_STORAGE_KEYS.SUPABASE_SESSION, JSON.stringify(session))
  }

  private async fetchProfile(user: User): Promise<UserProfile> {
    const client = await this.getClient()
    const { data: profile } = await client
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle()

    const mapped: UserProfile = {
      id: user.id,
      email: user.email ?? "",
      displayName: profile?.display_name ?? user.user_metadata?.full_name,
      avatarUrl: profile?.avatar_url ?? user.user_metadata?.avatar_url,
      stripeCustomerId: profile?.stripe_customer_id,
      subscriptionTier: profile?.subscription_tier ?? "free",
      subscriptionStatus: profile?.subscription_status ?? "inactive",
      createdAt: profile?.created_at ?? new Date().toISOString(),
      updatedAt: profile?.updated_at ?? new Date().toISOString()
    }

    await setInStorage(STORAGE_KEYS.USER_PROFILE, mapped)
    return mapped
  }

  private notifyListeners(user: UserProfile | null): void {
    for (const listener of this.listeners) {
      listener(user)
    }
  }

  private isAuthSessionMissingError(error: { message?: string } | null | undefined): boolean {
    const message = String(error?.message ?? "")
      .toLowerCase()
      .trim()

    return (
      message.includes("auth session missing") ||
      message.includes("session missing") ||
      message.includes("invalid refresh token")
    )
  }
}

export const authManager = new AuthManager()
