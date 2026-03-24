-- ============================================================
-- MindDock - Migration 010: Subscription billing cycle
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS subscription_cycle TEXT NOT NULL DEFAULT 'none'
    CHECK (subscription_cycle IN ('none', 'monthly', 'yearly'));

-- Best-effort backfill for existing paid profiles.
WITH latest_events AS (
  SELECT DISTINCT ON (stripe_customer_id)
    stripe_customer_id,
    current_period_start,
    current_period_end
  FROM subscription_events
  WHERE stripe_customer_id IS NOT NULL
  ORDER BY stripe_customer_id, created_at DESC
)
UPDATE profiles AS p
SET subscription_cycle = CASE
  WHEN p.subscription_status <> 'active' OR p.subscription_tier = 'free' THEN 'none'
  WHEN le.current_period_start IS NOT NULL
    AND le.current_period_end IS NOT NULL
    AND (le.current_period_end - le.current_period_start) >= INTERVAL '330 days'
    THEN 'yearly'
  ELSE 'monthly'
END
FROM latest_events AS le
WHERE p.stripe_customer_id = le.stripe_customer_id;

-- Paid active profiles without events still default to monthly.
UPDATE profiles
SET subscription_cycle = 'monthly'
WHERE subscription_status = 'active'
  AND subscription_tier IN ('pro', 'thinker', 'thinker_pro')
  AND subscription_cycle = 'none';

-- Non-active or free profiles must always be cycle "none".
UPDATE profiles
SET subscription_cycle = 'none'
WHERE subscription_status <> 'active'
   OR subscription_tier = 'free';

CREATE OR REPLACE FUNCTION update_user_subscription(
  p_stripe_customer_id TEXT,
  p_tier TEXT,
  p_status TEXT,
  p_cycle TEXT DEFAULT 'none'
) RETURNS VOID AS $$
  UPDATE profiles
  SET
    subscription_tier = p_tier,
    subscription_status = p_status,
    subscription_cycle = CASE
      WHEN p_status = 'active' AND p_tier IN ('pro', 'thinker', 'thinker_pro')
        THEN CASE
          WHEN lower(coalesce(p_cycle, '')) = 'yearly' THEN 'yearly'
          ELSE 'monthly'
        END
      ELSE 'none'
    END,
    updated_at = NOW()
  WHERE stripe_customer_id = p_stripe_customer_id;
$$ LANGUAGE sql SECURITY DEFINER;
