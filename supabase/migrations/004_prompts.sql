-- ============================================================
-- MindDock — Migration 004: Biblioteca de Prompts
-- ============================================================

CREATE TABLE IF NOT EXISTS prompt_folders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES prompt_folders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prompts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  folder_id UUID REFERENCES prompt_folders(id) ON DELETE SET NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS prompts_user_id_idx ON prompts(user_id);
CREATE INDEX IF NOT EXISTS prompts_use_count_idx ON prompts(use_count DESC);
CREATE INDEX IF NOT EXISTS prompt_folders_user_id_idx ON prompt_folders(user_id);

-- updated_at trigger
CREATE TRIGGER prompts_updated_at
  BEFORE UPDATE ON prompts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE prompt_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own prompt folders"
  ON prompt_folders FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can CRUD own prompts"
  ON prompts FOR ALL USING (auth.uid() = user_id);
