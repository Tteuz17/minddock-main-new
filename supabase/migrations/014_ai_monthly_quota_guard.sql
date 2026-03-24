-- ============================================================
-- MindDock - Migration 014: Atomic AI monthly quota enforcement
-- ============================================================

CREATE OR REPLACE FUNCTION public.consume_ai_monthly_usage(
  p_user_id UUID,
  p_metric TEXT,
  p_limit INTEGER
)
RETURNS TABLE(allowed BOOLEAN, current_count INTEGER, month_key DATE)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := p_user_id;
  v_metric TEXT := LOWER(TRIM(COALESCE(p_metric, '')));
  v_limit INTEGER := GREATEST(COALESCE(p_limit, 0), 0);
  v_month DATE := DATE_TRUNC('month', NOW() AT TIME ZONE 'utc')::date;
  v_count INTEGER := 0;
  v_allowed BOOLEAN := FALSE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_USER_ID';
  END IF;

  IF v_metric NOT IN ('agile_prompts', 'docks_summaries', 'brain_merges') THEN
    RAISE EXCEPTION 'INVALID_AI_MONTHLY_USAGE_METRIC';
  END IF;

  INSERT INTO public.ai_monthly_usage (user_id, month_key)
  VALUES (v_user_id, v_month)
  ON CONFLICT ON CONSTRAINT ai_monthly_usage_pkey DO NOTHING;

  IF v_limit <= 0 THEN
    IF v_metric = 'agile_prompts' THEN
      SELECT COALESCE(agile_prompts, 0) INTO v_count
      FROM public.ai_monthly_usage
      WHERE user_id = v_user_id AND month_key = v_month;
    ELSIF v_metric = 'docks_summaries' THEN
      SELECT COALESCE(docks_summaries, 0) INTO v_count
      FROM public.ai_monthly_usage
      WHERE user_id = v_user_id AND month_key = v_month;
    ELSE
      SELECT COALESCE(brain_merges, 0) INTO v_count
      FROM public.ai_monthly_usage
      WHERE user_id = v_user_id AND month_key = v_month;
    END IF;

    RETURN QUERY SELECT FALSE, COALESCE(v_count, 0), v_month;
    RETURN;
  END IF;

  IF v_metric = 'agile_prompts' THEN
    UPDATE public.ai_monthly_usage
    SET agile_prompts = agile_prompts + 1, updated_at = NOW()
    WHERE user_id = v_user_id
      AND month_key = v_month
      AND agile_prompts < v_limit
    RETURNING agile_prompts INTO v_count;
  ELSIF v_metric = 'docks_summaries' THEN
    UPDATE public.ai_monthly_usage
    SET docks_summaries = docks_summaries + 1, updated_at = NOW()
    WHERE user_id = v_user_id
      AND month_key = v_month
      AND docks_summaries < v_limit
    RETURNING docks_summaries INTO v_count;
  ELSE
    UPDATE public.ai_monthly_usage
    SET brain_merges = brain_merges + 1, updated_at = NOW()
    WHERE user_id = v_user_id
      AND month_key = v_month
      AND brain_merges < v_limit
    RETURNING brain_merges INTO v_count;
  END IF;

  IF FOUND THEN
    v_allowed := TRUE;
    RETURN QUERY SELECT TRUE, COALESCE(v_count, 0), v_month;
    RETURN;
  END IF;

  IF v_metric = 'agile_prompts' THEN
    SELECT COALESCE(agile_prompts, 0) INTO v_count
    FROM public.ai_monthly_usage
    WHERE user_id = v_user_id AND month_key = v_month;
  ELSIF v_metric = 'docks_summaries' THEN
    SELECT COALESCE(docks_summaries, 0) INTO v_count
    FROM public.ai_monthly_usage
    WHERE user_id = v_user_id AND month_key = v_month;
  ELSE
    SELECT COALESCE(brain_merges, 0) INTO v_count
    FROM public.ai_monthly_usage
    WHERE user_id = v_user_id AND month_key = v_month;
  END IF;

  RETURN QUERY SELECT v_allowed, COALESCE(v_count, 0), v_month;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_monthly_usage(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_ai_monthly_usage(UUID, TEXT, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.consume_ai_monthly_usage(UUID, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_monthly_usage(UUID, TEXT, INTEGER) TO service_role;

