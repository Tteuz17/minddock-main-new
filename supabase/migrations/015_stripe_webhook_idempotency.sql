-- ============================================================
-- MindDock - Migration 015: Stripe webhook idempotency guard
-- ============================================================

CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can insert stripe webhook events" ON public.stripe_webhook_events;
CREATE POLICY "Service role can insert stripe webhook events"
  ON public.stripe_webhook_events
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

