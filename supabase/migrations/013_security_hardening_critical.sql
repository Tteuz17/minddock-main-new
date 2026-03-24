-- ============================================================
-- MindDock - Migration 013: Critical security hardening
-- ============================================================

-- ------------------------------------------------------------------
-- 1) Restrict update_user_subscription execution to service_role only
--    and remove SECURITY DEFINER exposure.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_user_subscription(
  p_stripe_customer_id TEXT,
  p_tier TEXT,
  p_status TEXT
) RETURNS VOID
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.profiles
  SET
    subscription_tier = p_tier,
    subscription_status = p_status,
    updated_at = NOW()
  WHERE stripe_customer_id = p_stripe_customer_id;
$$;

CREATE OR REPLACE FUNCTION public.update_user_subscription(
  p_stripe_customer_id TEXT,
  p_tier TEXT,
  p_status TEXT,
  p_cycle TEXT DEFAULT 'none'
) RETURNS VOID
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.profiles
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
$$;

REVOKE ALL ON FUNCTION public.update_user_subscription(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_user_subscription(TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.update_user_subscription(TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_subscription(TEXT, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.update_user_subscription(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_user_subscription(TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.update_user_subscription(TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_subscription(TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ------------------------------------------------------------------
-- 2) Harden increment_prompt_use_count to caller-owned prompts only.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.increment_prompt_use_count(prompt_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF to_regclass('public.prompts') IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.prompts
  SET use_count = use_count + 1
  WHERE id = prompt_id
    AND user_id = v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_prompt_use_count(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_prompt_use_count(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.increment_prompt_use_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_prompt_use_count(UUID) TO service_role;
