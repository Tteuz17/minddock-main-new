/**
 * MindDock — Stripe Webhook Edge Function
 * Validates the Stripe webhook signature before trusting any payload.
 * Without this, any attacker could POST fake events and upgrade their own account for free.
 *
 * Deploy:  supabase functions deploy stripe-webhook
 * Secrets: supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
 *          supabase secrets set STRIPE_SECRET_KEY=sk_live_...
 *
 * In the Stripe Dashboard, set the webhook endpoint to:
 *   https://<project-ref>.supabase.co/functions/v1/stripe-webhook
 * and subscribe to: customer.subscription.created, customer.subscription.updated,
 *                   customer.subscription.deleted, invoice.payment_failed
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, stripe-signature"
}

// Maps Stripe price IDs to MindDock tier names.
// ⚠️  REQUIRED: Replace the placeholder values below with the real Price IDs from the
//     Stripe Dashboard → Products → each plan → copy the price_xxx ID.
//     Without this, ALL paid subscriptions will resolve to "free" tier.
const PRICE_TO_TIER: Record<string, string> = {
  [Deno.env.get("STRIPE_PRICE_PRO_MONTHLY") ?? "MISSING_pro_monthly"]: "pro",
  [Deno.env.get("STRIPE_PRICE_PRO_YEARLY") ?? "MISSING_pro_yearly"]: "pro",
  [Deno.env.get("STRIPE_PRICE_THINKER_MONTHLY") ?? "MISSING_thinker_monthly"]: "thinker",
  [Deno.env.get("STRIPE_PRICE_THINKER_YEARLY") ?? "MISSING_thinker_yearly"]: "thinker",
  [Deno.env.get("STRIPE_PRICE_THINKER_PRO_MONTHLY") ?? "MISSING_thinker_pro_monthly"]: "thinker_pro",
  [Deno.env.get("STRIPE_PRICE_THINKER_PRO_YEARLY") ?? "MISSING_thinker_pro_yearly"]: "thinker_pro",
}

function resolveTier(priceId: string | null | undefined): string {
  if (!priceId) return "free"
  const tier = PRICE_TO_TIER[priceId]
  if (!tier || tier.startsWith("MISSING_")) {
    console.error(`[stripe-webhook] Unknown price ID: ${priceId} — defaulting to free. Add STRIPE_PRICE_* secrets.`)
    return "free"
  }
  return tier
}

// Startup validation — logs a warning if price env vars are missing
const missingPriceSecrets = [
  "STRIPE_PRICE_PRO_MONTHLY", "STRIPE_PRICE_PRO_YEARLY",
  "STRIPE_PRICE_THINKER_MONTHLY", "STRIPE_PRICE_THINKER_YEARLY",
  "STRIPE_PRICE_THINKER_PRO_MONTHLY", "STRIPE_PRICE_THINKER_PRO_YEARLY",
].filter(k => !Deno.env.get(k))
if (missingPriceSecrets.length > 0) {
  console.warn(`[stripe-webhook] ⚠️ Missing price secrets: ${missingPriceSecrets.join(", ")}. Paid subscriptions will not activate.`)
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

  // ── 1. Validate Stripe signature BEFORE reading the body ─────────────────
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

  // ── 2. Handle the verified event ─────────────────────────────────────────
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription
        const priceId = sub.items.data[0]?.price?.id ?? null
        const tier = resolveTier(priceId)
        const status = sub.status === "active" ? "active" : sub.status === "past_due" ? "past_due" : "inactive"

        const { error } = await supabase.rpc("update_user_subscription", {
          p_stripe_customer_id: sub.customer as string,
          p_tier: tier,
          p_status: status
        })

        if (error) {
          console.error("[stripe-webhook] Failed to update subscription:", error)
          return new Response("DB update failed", { status: 500 })
        }

        // Log event for audit trail
        await supabase.from("subscription_events").insert({
          stripe_customer_id: sub.customer as string,
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

        await supabase.rpc("update_user_subscription", {
          p_stripe_customer_id: sub.customer as string,
          p_tier: "free",
          p_status: "canceled"
        })

        await supabase.from("subscription_events").insert({
          stripe_customer_id: sub.customer as string,
          stripe_subscription_id: sub.id,
          event_type: event.type,
          tier: "free",
          status: "canceled"
        })

        break
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id

        await supabase.rpc("update_user_subscription", {
          p_stripe_customer_id: customerId ?? "",
          p_tier: "free",
          p_status: "past_due"
        })

        await supabase.from("subscription_events").insert({
          stripe_customer_id: customerId,
          event_type: event.type,
          tier: "free",
          status: "past_due"
        })

        break
      }

      default:
        // Unhandled event type — acknowledge receipt without processing
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
