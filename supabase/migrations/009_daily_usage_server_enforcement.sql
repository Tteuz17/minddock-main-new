-- ============================================================
-- MindDock - Migration 009: Server-side daily usage counters
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_usage (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL DEFAULT ((NOW() AT TIME ZONE 'utc')::date),
  imports INTEGER NOT NULL DEFAULT 0 CHECK (imports >= 0),
  exports INTEGER NOT NULL DEFAULT 0 CHECK (exports >= 0),
  ai_calls INTEGER NOT NULL DEFAULT 0 CHECK (ai_calls >= 0),
  captures INTEGER NOT NULL DEFAULT 0 CHECK (captures >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, usage_date)
);

CREATE INDEX IF NOT EXISTS daily_usage_user_idx ON daily_usage(user_id);

DROP TRIGGER IF EXISTS daily_usage_updated_at ON daily_usage;
CREATE TRIGGER daily_usage_updated_at
  BEFORE UPDATE ON daily_usage
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE daily_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own daily usage" ON daily_usage;
CREATE POLICY "Users can read own daily usage"
  ON daily_usage FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION increment_daily_usage(p_metric TEXT)
RETURNS TABLE(current_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_metric TEXT := LOWER(TRIM(COALESCE(p_metric, '')));
  v_user_id UUID := auth.uid();
  v_today DATE := (NOW() AT TIME ZONE 'utc')::date;
  v_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF v_metric NOT IN ('imports', 'exports', 'ai_calls', 'captures') THEN
    RAISE EXCEPTION 'INVALID_USAGE_METRIC';
  END IF;

  INSERT INTO daily_usage (user_id, usage_date)
  VALUES (v_user_id, v_today)
  ON CONFLICT (user_id, usage_date) DO NOTHING;

  IF v_metric = 'imports' THEN
    UPDATE daily_usage
    SET imports = imports + 1, updated_at = NOW()
    WHERE user_id = v_user_id AND usage_date = v_today
    RETURNING imports INTO v_count;
  ELSIF v_metric = 'exports' THEN
    UPDATE daily_usage
    SET exports = exports + 1, updated_at = NOW()
    WHERE user_id = v_user_id AND usage_date = v_today
    RETURNING exports INTO v_count;
  ELSIF v_metric = 'ai_calls' THEN
    UPDATE daily_usage
    SET ai_calls = ai_calls + 1, updated_at = NOW()
    WHERE user_id = v_user_id AND usage_date = v_today
    RETURNING ai_calls INTO v_count;
  ELSE
    UPDATE daily_usage
    SET captures = captures + 1, updated_at = NOW()
    WHERE user_id = v_user_id AND usage_date = v_today
    RETURNING captures INTO v_count;
  END IF;

  RETURN QUERY SELECT COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION increment_daily_usage(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_daily_usage(TEXT) TO authenticated;
