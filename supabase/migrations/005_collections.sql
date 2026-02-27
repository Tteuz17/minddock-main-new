-- ============================================================
-- MindDock — Migration 005: Coleções e Tags
-- ============================================================

CREATE TABLE IF NOT EXISTS collections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#facc15',
  notebook_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#ffffff',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- Índices
CREATE INDEX IF NOT EXISTS collections_user_id_idx ON collections(user_id);
CREATE INDEX IF NOT EXISTS tags_user_id_idx ON tags(user_id);

-- RLS
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own collections"
  ON collections FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can CRUD own tags"
  ON tags FOR ALL USING (auth.uid() = user_id);
