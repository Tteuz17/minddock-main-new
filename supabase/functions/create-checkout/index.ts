/**
 * MindDock — Stripe Checkout Session Creator
 * Receives the chosen priceId + user JWT, creates a Stripe Checkout Session
 * tied to the user's stripe_customer_id, and returns the hosted checkout URL.
 *
 * Deploy:  supabase functions deploy create-checkout
 * Secrets: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info"
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

Deno.serve(async (req: Request) => {
  try {
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
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

    let body: { priceId?: string }
    try {
      body = await req.json()
    } catch {
      return new Response("Invalid JSON", { status: 400, headers: CORS_HEADERS })
    }

    const { priceId } = body
    if (!priceId) {
      return new Response("Missing priceId", { status: 400, headers: CORS_HEADERS })
    }

    // Get or create profile row before handling Stripe customer linkage.
    const { data: initialProfile, error: initialProfileError } = await supabase
      .from("profiles")
      .select("stripe_customer_id, email, display_name, subscription_tier, subscription_status")
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
      .select("stripe_customer_id, email, display_name, subscription_tier, subscription_status")
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

    const profileTier = String(profile?.subscription_tier ?? "")
      .trim()
      .toLowerCase()
    const profileStatus = String(profile?.subscription_status ?? "")
      .trim()
      .toLowerCase()

    if (
      (profileStatus === "active" || profileStatus === "trialing") &&
      profileTier === "thinker_pro"
    ) {
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
      status: "active",
      limit: 1
    })
    if (activeSubscriptions.data.length > 0) {
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
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: "https://notebooklm.google.com/?minddock_checkout=success",
        cancel_url: "https://notebooklm.google.com/?minddock_checkout=canceled",
        allow_promotion_codes: true,
        client_reference_id: user.id,
        metadata: { supabase_user_id: user.id },
        subscription_data: {
          metadata: {
            supabase_user_id: user.id,
            minddock_price_id: priceId
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
