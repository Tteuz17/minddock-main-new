-- ============================================================
-- MindDock - Migration 012: Fix ambiguous month_key in AI monthly function
-- ============================================================

CREATE OR REPLACE FUNCTION increment_ai_monthly_usage(p_metric TEXT)
RETURNS TABLE(current_count INTEGER, month_key DATE)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_metric TEXT := LOWER(TRIM(COALESCE(p_metric, '')));
  v_user_id UUID := auth.uid();
  v_month DATE := DATE_TRUNC('month', NOW() AT TIME ZONE 'utc')::date;
  v_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF v_metric NOT IN ('agile_prompts', 'docks_summaries', 'brain_merges') THEN
    RAISE EXCEPTION 'INVALID_AI_MONTHLY_USAGE_METRIC';
  END IF;

  INSERT INTO ai_monthly_usage (user_id, month_key)
  VALUES (v_user_id, v_month)
  ON CONFLICT ON CONSTRAINT ai_monthly_usage_pkey DO NOTHING;

  IF v_metric = 'agile_prompts' THEN
    UPDATE ai_monthly_usage
    SET agile_prompts = agile_prompts + 1, updated_at = NOW()
    WHERE ai_monthly_usage.user_id = v_user_id
      AND ai_monthly_usage.month_key = v_month
    RETURNING agile_prompts INTO v_count;
  ELSIF v_metric = 'docks_summaries' THEN
    UPDATE ai_monthly_usage
    SET docks_summaries = docks_summaries + 1, updated_at = NOW()
    WHERE ai_monthly_usage.user_id = v_user_id
      AND ai_monthly_usage.month_key = v_month
    RETURNING docks_summaries INTO v_count;
  ELSE
    UPDATE ai_monthly_usage
    SET brain_merges = brain_merges + 1, updated_at = NOW()
    WHERE ai_monthly_usage.user_id = v_user_id
      AND ai_monthly_usage.month_key = v_month
    RETURNING brain_merges INTO v_count;
  END IF;

  RETURN QUERY SELECT COALESCE(v_count, 0), v_month;
END;
$$;
