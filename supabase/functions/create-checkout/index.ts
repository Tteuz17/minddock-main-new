/**
 * MindDock — Stripe Checkout Session Creator
 * Receives the chosen priceId + user JWT, creates a Stripe Checkout Session
 * tied to the user's stripe_customer_id, and returns the hosted checkout URL.
 *
 * Deploy:  supabase functions deploy create-checkout
 * Secrets:
 *   STRIPE_SECRET_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   STRIPE_PRICE_PRO_MONTHLY
 *   STRIPE_PRICE_PRO_YEARLY
 *   STRIPE_PRICE_THINKER_MONTHLY
 *   STRIPE_PRICE_THINKER_YEARLY
 *   STRIPE_PRICE_THINKER_PRO_MONTHLY (optional)
 *   STRIPE_PRICE_THINKER_PRO_YEARLY (optional)
 *   ALLOWED_ORIGINS (optional)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info"
}

const CHROME_EXTENSION_ORIGIN_REGEX = /^chrome-extension:\/\/[a-z]{32}$/i
const MOZ_EXTENSION_ORIGIN_REGEX = /^moz-extension:\/\/[a-z0-9-]+$/i
const LOCALHOST_ORIGIN_REGEX = /^https?:\/\/localhost(?::\d{1,5})?$/i

type SubscriptionTier = "free" | "pro" | "thinker" | "thinker_pro"
type SubscriptionStatus = "active" | "trialing" | "past_due" | "inactive" | "canceled"
type SubscriptionCycle = "none" | "monthly" | "yearly"

interface AllowedPriceConfig {
  tier: SubscriptionTier
  cycle: Exclude<SubscriptionCycle, "none">
}

const PRICE_ENV_CONFIG: Array<{ envKey: string; config: AllowedPriceConfig }> = [
  { envKey: "STRIPE_PRICE_PRO_MONTHLY", config: { tier: "pro", cycle: "monthly" } },
  { envKey: "STRIPE_PRICE_PRO_YEARLY", config: { tier: "pro", cycle: "yearly" } },
  { envKey: "STRIPE_PRICE_THINKER_MONTHLY", config: { tier: "thinker", cycle: "monthly" } },
  { envKey: "STRIPE_PRICE_THINKER_YEARLY", config: { tier: "thinker", cycle: "yearly" } },
  {
    envKey: "STRIPE_PRICE_THINKER_PRO_MONTHLY",
    config: { tier: "thinker_pro", cycle: "monthly" }
  },
  {
    envKey: "STRIPE_PRICE_THINKER_PRO_YEARLY",
    config: { tier: "thinker_pro", cycle: "yearly" }
  }
]

const SUBSCRIPTION_TIER_RANK: Record<SubscriptionTier, number> = {
  free: 0,
  pro: 1,
  thinker: 2,
  thinker_pro: 3
}

function normalizeSubscriptionTier(value: unknown): SubscriptionTier {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
  if (normalized === "pro" || normalized === "thinker" || normalized === "thinker_pro") {
    return normalized
  }
  return "free"
}

function normalizeSubscriptionStatus(value: unknown): SubscriptionStatus {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
  if (
    normalized === "active" ||
    normalized === "trialing" ||
    normalized === "past_due" ||
    normalized === "canceled"
  ) {
    return normalized
  }
  return "inactive"
}

function readAllowedPricesFromEnv(): Map<string, AllowedPriceConfig> {
  const allowedPriceMap = new Map<string, AllowedPriceConfig>()
  for (const entry of PRICE_ENV_CONFIG) {
    const value = String(Deno.env.get(entry.envKey) ?? "").trim()
    if (!value) {
      continue
    }
    allowedPriceMap.set(value, entry.config)
  }
  return allowedPriceMap
}

function sanitizeStripeErrorMessage(message: string): string {
  const normalized = String(message ?? "").trim()
  if (!normalized) {
    return "Falha ao criar sessao no Stripe."
  }

  if (/invalid api key provided/i.test(normalized)) {
    return "STRIPE_AUTH_FAILED: STRIPE_SECRET_KEY invalida ou em modo incorreto (test/live)."
  }

  return normalized.replace(/sk_(test|live)_[A-Za-z0-9]+/g, "sk_$1_***")
}

function parseCsvSet(value: string | null | undefined): Set<string> {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  )
}

const allowedOrigins = parseCsvSet(Deno.env.get("ALLOWED_ORIGINS"))

function isAllowedOrigin(origin: string): boolean {
  const normalized = String(origin ?? "").trim()
  if (!normalized) {
    return true
  }

  if (
    CHROME_EXTENSION_ORIGIN_REGEX.test(normalized) ||
    MOZ_EXTENSION_ORIGIN_REGEX.test(normalized) ||
    LOCALHOST_ORIGIN_REGEX.test(normalized)
  ) {
    return true
  }

  return allowedOrigins.has(normalized.toLowerCase())
}

function isBrowserOriginAllowed(req: Request): boolean {
  const origin = String(req.headers.get("origin") ?? "").trim()
  if (!origin) {
    return true
  }
  return isAllowedOrigin(origin)
}

Deno.serve(async (req: Request) => {
  try {
    if (!isBrowserOriginAllowed(req)) {
      return new Response("Origin not allowed", { status: 403, headers: CORS_HEADERS })
    }

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS })
    }

    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS })
    }

    const authHeader = req.headers.get("Authorization")
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS })
    }

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")
    if (!stripeSecretKey) {
      return new Response("Stripe not configured", { status: 503, headers: CORS_HEADERS })
    }

    const supabaseUrl = String(Deno.env.get("SUPABASE_URL") ?? "").trim()
    const supabaseServiceKey = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim()
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response("Supabase not configured", { status: 503, headers: CORS_HEADERS })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Verify JWT and get user
    const token = authHeader.slice(7).trim()
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS })
    }

    let body: { priceId?: unknown }
    try {
      body = await req.json()
    } catch {
      return new Response("Invalid JSON", { status: 400, headers: CORS_HEADERS })
    }

    const normalizedPriceId = String(body.priceId ?? "").trim()
    if (!normalizedPriceId) {
      return new Response("Missing priceId", { status: 400, headers: CORS_HEADERS })
    }

    const allowedPriceMap = readAllowedPricesFromEnv()
    if (allowedPriceMap.size === 0) {
      return new Response("Stripe prices not configured", { status: 503, headers: CORS_HEADERS })
    }

    const selectedPriceConfig = allowedPriceMap.get(normalizedPriceId)
    if (!selectedPriceConfig) {
      return new Response("Invalid priceId", { status: 400, headers: CORS_HEADERS })
    }

    // Get or create profile row before handling Stripe customer linkage.
    const { data: initialProfile, error: initialProfileError } = await supabase
      .from("profiles")
      .select(
        "stripe_customer_id, email, display_name, subscription_tier, subscription_status, subscription_cycle"
      )
      .eq("id", user.id)
      .maybeSingle()

    if (initialProfileError) {
      return new Response(JSON.stringify({ error: `PROFILE_QUERY_FAILED: ${initialProfileError.message}` }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      })
    }

    if (!initialProfile) {
      const { error: profileInsertError } = await supabase
        .from("profiles")
        .upsert(
          {
            id: user.id,
            email: user.email ?? null,
            display_name: (user.user_metadata?.full_name as string | undefined) ?? null,
            avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? null
          },
          { onConflict: "id" }
        )

      if (profileInsertError) {
        return new Response(
          JSON.stringify({ error: `PROFILE_CREATE_FAILED: ${profileInsertError.message}` }),
          {
            status: 500,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
          }
        )
      }
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select(
        "stripe_customer_id, email, display_name, subscription_tier, subscription_status, subscription_cycle"
      )
      .eq("id", user.id)
      .maybeSingle()

    if (profileError) {
      return new Response(JSON.stringify({ error: `PROFILE_QUERY_FAILED: ${profileError.message}` }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      })
    }

    if (!profile) {
      return new Response(JSON.stringify({ error: "PROFILE_NOT_FOUND_AFTER_UPSERT" }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      })
    }

    const profileTier = normalizeSubscriptionTier(profile?.subscription_tier)
    const profileStatus = normalizeSubscriptionStatus(profile?.subscription_status)
    const hasActivePaidPlan =
      (profileStatus === "active" || profileStatus === "trialing") && profileTier !== "free"

    if (
      hasActivePaidPlan &&
      SUBSCRIPTION_TIER_RANK[profileTier] >= SUBSCRIPTION_TIER_RANK[selectedPriceConfig.tier]
    ) {
      return new Response(
        JSON.stringify({
          error:
            "Sua conta ja possui um plano ativo igual ou superior. Use Subscription para gerenciar alteracoes."
        }),
        {
          status: 409,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        }
      )
    }

    if (hasActivePaidPlan && profileTier === "thinker_pro") {
      return new Response(
        JSON.stringify({
          error:
            "Conta ja esta no Thinker Pro ativo. Use Subscription para gerenciar alteracoes de plano."
        }),
        {
          status: 409,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        }
      )
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-04-10" })
    let customerId = profile?.stripe_customer_id as string | undefined

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: (profile?.email as string) ?? user.email ?? "",
        name: (profile?.display_name as string) ?? undefined,
        metadata: { supabase_user_id: user.id }
      })
      customerId = customer.id

      const { error: profileUpdateError } = await supabase
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id)
      if (profileUpdateError) {
        return new Response(
          JSON.stringify({ error: `PROFILE_UPDATE_FAILED: ${profileUpdateError.message}` }),
          {
            status: 500,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
          }
        )
      }
    }

    if (!customerId) {
      return new Response(JSON.stringify({ error: "STRIPE_CUSTOMER_MISSING" }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      })
    }

    // Defensive guard: avoid creating duplicate subscription checkouts for active customers.
    const activeSubscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10
    })

    const hasBlockingSubscription = activeSubscriptions.data.some((sub) =>
      ["trialing", "active", "past_due", "unpaid", "incomplete"].includes(String(sub.status))
    )

    if (hasBlockingSubscription) {
      return new Response(
        JSON.stringify({
          error:
            "Ja existe uma assinatura ativa para esta conta. Use Subscription para gerenciar alteracoes."
        }),
        {
          status: 409,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        }
      )
    }

    let session: Stripe.Checkout.Session
    try {
      session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [{ price: normalizedPriceId, quantity: 1 }],
        success_url: "https://notebooklm.google.com/?minddock_checkout=success",
        cancel_url: "https://notebooklm.google.com/?minddock_checkout=canceled",
        allow_promotion_codes: true,
        client_reference_id: user.id,
        metadata: { supabase_user_id: user.id },
        subscription_data: {
          metadata: {
            supabase_user_id: user.id,
            minddock_price_id: normalizedPriceId
          }
        }
      })
    } catch (error) {
      const stripeErrorMessage = sanitizeStripeErrorMessage(
        error instanceof Error ? error.message : "Falha ao criar sessao no Stripe."
      )
      return new Response(JSON.stringify({ error: stripeErrorMessage }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      })
    }

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    })
  } catch (error) {
    const message = sanitizeStripeErrorMessage(
      error instanceof Error ? error.message : "Internal Server Error"
    )
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    })
  }
})
