-- Focus Threads: abas de conversa por tópico no NotebookLM

CREATE TABLE threads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  notebook_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Nova thread',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON threads(user_id, notebook_id, updated_at DESC);

ALTER TABLE threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own threads"
  ON threads FOR ALL
  USING (auth.uid() = user_id);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_thread_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_thread_updated_at
  BEFORE UPDATE ON threads
  FOR EACH ROW EXECUTE FUNCTION update_thread_updated_at();

-- ─── Thread Messages ──────────────────────────────────────────────────────

CREATE TABLE thread_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id UUID REFERENCES threads(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON thread_messages(thread_id, created_at ASC);

ALTER TABLE thread_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own thread messages"
  ON thread_messages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM threads
      WHERE threads.id = thread_messages.thread_id
        AND threads.user_id = auth.uid()
    )
  );
