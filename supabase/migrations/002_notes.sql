-- ============================================================
-- MindDock — Migration 002: Notas Zettelkasten
-- ============================================================

CREATE TABLE IF NOT EXISTS notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  notebook_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'zettel_maker', 'import')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS notes_user_id_idx ON notes(user_id);
CREATE INDEX IF NOT EXISTS notes_updated_at_idx ON notes(updated_at DESC);
CREATE INDEX IF NOT EXISTS notes_tags_idx ON notes USING GIN(tags);

-- Full-text search
CREATE INDEX IF NOT EXISTS notes_fts_idx ON notes
  USING GIN(to_tsvector('portuguese', title || ' ' || content));

-- updated_at trigger
CREATE TRIGGER notes_updated_at
  BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own notes"
  ON notes FOR ALL USING (auth.uid() = user_id);

-- Função para incrementar uso de prompts (usada em prompts.ts)
CREATE OR REPLACE FUNCTION increment_prompt_use_count(prompt_id UUID)
RETURNS VOID AS $$
  UPDATE prompts SET use_count = use_count + 1 WHERE id = prompt_id;
$$ LANGUAGE sql SECURITY DEFINER;
