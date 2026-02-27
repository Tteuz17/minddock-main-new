-- ============================================================
-- MindDock — Migration 006: Stripe + Usage tracking
-- ============================================================

-- Tabela de eventos de subscription do Stripe
CREATE TABLE IF NOT EXISTS subscription_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id TEXT,
  event_type TEXT NOT NULL,
  tier TEXT,
  status TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS sub_events_user_idx ON subscription_events(user_id);
CREATE INDEX IF NOT EXISTS sub_events_stripe_customer_idx ON subscription_events(stripe_customer_id);

-- Função que o Stripe webhook chama para atualizar o perfil
CREATE OR REPLACE FUNCTION update_user_subscription(
  p_stripe_customer_id TEXT,
  p_tier TEXT,
  p_status TEXT
) RETURNS VOID AS $$
  UPDATE profiles
  SET
    subscription_tier = p_tier,
    subscription_status = p_status,
    updated_at = NOW()
  WHERE stripe_customer_id = p_stripe_customer_id;
$$ LANGUAGE sql SECURITY DEFINER;

-- RLS (eventos só leitura pelo usuário dono)
ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own subscription events"
  ON subscription_events FOR SELECT USING (auth.uid() = user_id);

-- Apenas service role pode inserir (via Edge Function)
CREATE POLICY "Service role can insert subscription events"
  ON subscription_events FOR INSERT WITH CHECK (auth.role() = 'service_role');
