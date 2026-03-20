-- ============================================================
-- MindDock - Migration 008: Lock down billing fields in profiles
-- ============================================================

-- Remove broad UPDATE grants from client roles.
REVOKE UPDATE ON TABLE profiles FROM authenticated;
REVOKE UPDATE ON TABLE profiles FROM anon;

-- Allow authenticated users to update only basic profile fields.
GRANT UPDATE (email, display_name, avatar_url) ON TABLE profiles TO authenticated;
