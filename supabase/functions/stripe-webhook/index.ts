/**
 * MindDock - Stripe Webhook Edge Function
 *
 * Deploy:
 *   supabase functions deploy stripe-webhook --project-ref <project-ref> --no-verify-jwt
 *
 * Required secrets:
 *   STRIPE_WEBHOOK_SECRET
 *   STRIPE_SECRET_KEY
 *   STRIPE_PRICE_PRO_MONTHLY
 *   STRIPE_PRICE_PRO_YEARLY
 *   STRIPE_PRICE_THINKER_MONTHLY
 *   STRIPE_PRICE_THINKER_YEARLY
 *   STRIPE_PRICE_THINKER_PRO_MONTHLY
 *   STRIPE_PRICE_THINKER_PRO_YEARLY
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, stripe-signature"
}

type SubscriptionTier = "free" | "pro" | "thinker" | "thinker_pro"
type SubscriptionCycle = "none" | "monthly" | "yearly"

type ProfileUpdateResult = {
  updated: boolean
  userId: string | null
}

type WebhookEventRegistrationResult = "inserted" | "duplicate"

const PRICE_TO_TIER: Record<string, SubscriptionTier> = {
  [Deno.env.get("STRIPE_PRICE_PRO_MONTHLY") ?? "MISSING_pro_monthly"]: "pro",
  [Deno.env.get("STRIPE_PRICE_PRO_YEARLY") ?? "MISSING_pro_yearly"]: "pro",
  [Deno.env.get("STRIPE_PRICE_THINKER_MONTHLY") ?? "MISSING_thinker_monthly"]: "thinker",
  [Deno.env.get("STRIPE_PRICE_THINKER_YEARLY") ?? "MISSING_thinker_yearly"]: "thinker",
  [Deno.env.get("STRIPE_PRICE_THINKER_PRO_MONTHLY") ?? "MISSING_thinker_pro_monthly"]: "thinker_pro",
  [Deno.env.get("STRIPE_PRICE_THINKER_PRO_YEARLY") ?? "MISSING_thinker_pro_yearly"]: "thinker_pro"
}

function resolveCycle(interval: string | null | undefined): SubscriptionCycle {
  if (interval === "year") return "yearly"
  if (interval === "month") return "monthly"
  return "none"
}

function resolveTier(priceId: string | null | undefined): SubscriptionTier | null {
  if (!priceId) return null
  const tier = PRICE_TO_TIER[priceId]
  if (!tier || String(tier).startsWith("MISSING_")) {
    return null
  }
  return tier
}

function buildEffectiveCycle(tier: SubscriptionTier, status: string, cycle: SubscriptionCycle): SubscriptionCycle {
  if (status === "active" && tier !== "free") {
    return cycle === "yearly" ? "yearly" : "monthly"
  }
  return "none"
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false
  }

  const code = String((error as { code?: unknown }).code ?? "").trim()
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase()
  return code === "23505" || message.includes("duplicate key")
}

async function registerWebhookEvent(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
  eventType: string
): Promise<WebhookEventRegistrationResult> {
  const { error } = await supabase.from("stripe_webhook_events").insert({
    event_id: eventId,
    event_type: eventType
  })

  if (!error) {
    return "inserted"
  }

  if (isUniqueViolation(error)) {
    return "duplicate"
  }

  throw new Error(`WEBHOOK_EVENT_REGISTER_FAILED: ${String(error.message ?? error)}`)
}

async function applySubscriptionToProfile(
  supabase: ReturnType<typeof createClient>,
  params: {
    customerId: string | null
    userId: string | null
    tier: SubscriptionTier
    status: string
    cycle: SubscriptionCycle
  }
): Promise<ProfileUpdateResult> {
  const { customerId, userId, tier, status, cycle } = params

  const payload = {
    subscription_tier: tier,
    subscription_status: status,
    subscription_cycle: buildEffectiveCycle(tier, status, cycle),
    updated_at: new Date().toISOString()
  }

  if (customerId) {
    const { data: updatedByCustomer, error: updateByCustomerError } = await supabase
      .from("profiles")
      .update(payload)
      .eq("stripe_customer_id", customerId)
      .select("id")

    if (updateByCustomerError) {
      throw new Error(`PROFILE_UPDATE_BY_CUSTOMER_FAILED: ${updateByCustomerError.message}`)
    }

    if (Array.isArray(updatedByCustomer) && updatedByCustomer.length > 0) {
      return {
        updated: true,
        userId: String(updatedByCustomer[0]?.id ?? userId ?? "").trim() || null
      }
    }
  }

  if (userId) {
    const payloadWithCustomer = customerId
      ? { ...payload, stripe_customer_id: customerId }
      : payload

    const { data: updatedById, error: updateByIdError } = await supabase
      .from("profiles")
      .update(payloadWithCustomer)
      .eq("id", userId)
      .select("id")

    if (updateByIdError) {
      throw new Error(`PROFILE_UPDATE_BY_ID_FAILED: ${updateByIdError.message}`)
    }

    if (Array.isArray(updatedById) && updatedById.length > 0) {
      return { updated: true, userId }
    }
  }

  return { updated: false, userId: userId ?? null }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS })
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS })
  }

  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")

  if (!webhookSecret || !stripeSecretKey) {
    console.error("[stripe-webhook] Missing STRIPE_WEBHOOK_SECRET or STRIPE_SECRET_KEY")
    return new Response("Webhook not configured", { status: 503 })
  }

  const signature = req.headers.get("stripe-signature")
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 })
  }

  const rawBody = await req.text()
  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-04-10" })

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret)
  } catch (err) {
    console.error("[stripe-webhook] Invalid signature:", err)
    return new Response("Invalid webhook signature", { status: 401 })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const registrationResult = await registerWebhookEvent(supabase, event.id, event.type)
    if (registrationResult === "duplicate") {
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      })
    }

    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription
        const customerId = typeof sub.customer === "string" ? sub.customer : null
        const metadataUserId = String(sub.metadata?.supabase_user_id ?? "").trim() || null
        const priceId = sub.items.data[0]?.price?.id ?? null
        const recurringInterval = sub.items.data[0]?.price?.recurring?.interval ?? null
        const tier = resolveTier(priceId)
        const status =
          sub.status === "active"
            ? "active"
            : sub.status === "past_due"
              ? "past_due"
              : "inactive"
        const cycle = resolveCycle(recurringInterval)

        if (!tier) {
          console.error("[stripe-webhook] Unknown Stripe price id", {
            priceId,
            eventType: event.type,
            customerId
          })
          return new Response("Unknown Stripe price ID for subscription.", { status: 500 })
        }

        const updateResult = await applySubscriptionToProfile(supabase, {
          customerId,
          userId: metadataUserId,
          tier,
          status,
          cycle
        })

        if (!updateResult.updated) {
          console.error("[stripe-webhook] No profile matched for subscription update", {
            customerId,
            metadataUserId,
            eventType: event.type
          })
          return new Response("Profile not linked to Stripe customer.", { status: 500 })
        }

        await supabase.from("subscription_events").insert({
          user_id: updateResult.userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: sub.id,
          stripe_price_id: priceId,
          event_type: event.type,
          tier,
          status,
          current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
          current_period_end: new Date(sub.current_period_end * 1000).toISOString()
        })

        break
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription
        const customerId = typeof sub.customer === "string" ? sub.customer : null
        const metadataUserId = String(sub.metadata?.supabase_user_id ?? "").trim() || null

        const updateResult = await applySubscriptionToProfile(supabase, {
          customerId,
          userId: metadataUserId,
          tier: "free",
          status: "canceled",
          cycle: "none"
        })

        await supabase.from("subscription_events").insert({
          user_id: updateResult.userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: sub.id,
          event_type: event.type,
          tier: "free",
          status: "canceled"
        })

        break
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice
        const customerId =
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id ?? null

        const updateResult = await applySubscriptionToProfile(supabase, {
          customerId,
          userId: null,
          tier: "free",
          status: "past_due",
          cycle: "none"
        })

        await supabase.from("subscription_events").insert({
          user_id: updateResult.userId,
          stripe_customer_id: customerId,
          event_type: event.type,
          tier: "free",
          status: "past_due"
        })

        break
      }

      default:
        console.log(`[stripe-webhook] Unhandled event type: ${event.type}`)
    }
  } catch (err) {
    console.error("[stripe-webhook] Handler error:", err)
    return new Response("Handler error", { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  })
})
