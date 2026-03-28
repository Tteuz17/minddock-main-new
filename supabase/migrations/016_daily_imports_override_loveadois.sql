-- ============================================================
-- MindDock - Migration 016: Grant unlimited daily imports
-- Target account: loveadoisoficial@gmail.com
-- ============================================================

DO $$
DECLARE
  v_rows_updated INTEGER := 0;
BEGIN
  UPDATE public.profiles
  SET
    subscription_tier = 'pro',
    subscription_status = 'active',
    subscription_cycle = 'monthly',
    updated_at = NOW()
  WHERE lower(trim(email)) = 'loveadoisoficial@gmail.com';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RAISE NOTICE 'No profile row found for loveadoisoficial@gmail.com';
  ELSE
    RAISE NOTICE 'Updated % profile row(s) to pro/active/monthly for unlimited imports.', v_rows_updated;
  END IF;
END
$$;
