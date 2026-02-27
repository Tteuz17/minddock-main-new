-- ============================================================
-- MindDock — Migration 003: Links bidirecionais entre notas
-- ============================================================

CREATE TABLE IF NOT EXISTS note_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  source_note_id UUID REFERENCES notes(id) ON DELETE CASCADE NOT NULL,
  target_note_id UUID REFERENCES notes(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_note_id, target_note_id)
);

-- Índices
CREATE INDEX IF NOT EXISTS note_links_source_idx ON note_links(source_note_id);
CREATE INDEX IF NOT EXISTS note_links_target_idx ON note_links(target_note_id);
CREATE INDEX IF NOT EXISTS note_links_user_idx ON note_links(user_id);

-- RLS
ALTER TABLE note_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own note links"
  ON note_links FOR ALL USING (auth.uid() = user_id);
