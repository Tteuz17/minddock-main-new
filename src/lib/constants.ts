import type { AgilePrompt, PlanLimits, SubscriptionTier } from "./types"

// ─── NotebookLM RPC ─────────────────────────────────────────────────────────

export const NOTEBOOKLM_BASE_URL = "https://notebooklm.google.com"
export const NOTEBOOKLM_RPC_ENDPOINT =
  `${NOTEBOOKLM_BASE_URL}/_/LabsTailwindUi/data/batchexecute`

export const RPC_IDS = {
  LIST_NOTEBOOKS: "wXbhsf",
  LIST_SOURCES: "rLM1Ne",
  GET_SOURCE_CONTENT: "hizoJc",
  ADD_SOURCE: "izAoDd",
  SYNC_GDOC: "FLmJqe"
} as const

// ─── Storage Keys ───────────────────────────────────────────────────────────

export const STORAGE_KEYS = {
  PROJECT_URL: "nexus_project_url",
  ANON_KEY: "nexus_anon_key",
  SUPABASE_SESSION: "minddock_supabase_session",
  AT_TOKEN: "nexus_at_token",
  BL_TOKEN: "nexus_bl_token",
  SESSION_ID: "nexus_session_id",
  AUTH_USER: "nexus_auth_user",
  TOKEN_EXPIRES_AT: "nexus_token_expires_at",
  USER_PROFILE: "minddock_user_profile",
  SUBSCRIPTION: "minddock_subscription",
  SIDEPANEL_VIEW: "minddock_sidepanel_view",
  SIDEPANEL_NOTE_DRAFT: "minddock_sidepanel_note_draft",
  NOTEBOOKS_CACHE: "minddock_notebooks_cache",
  SOURCES_CACHE: "minddock_sources_cache",
  DAILY_USAGE: "minddock_daily_usage",
  SETTINGS: "minddock_settings",
  NOTEBOOKLM_UI_ENABLED: "minddock_ui_enabled"
} as const

// ─── Plans & Limits ─────────────────────────────────────────────────────────

export const PLANS: Record<SubscriptionTier, { price_monthly?: number; price_yearly?: number; limits: PlanLimits }> = {
  free: {
    limits: {
      imports_per_day: 10,
      exports_per_day: 10,
      prompts_saved: 10,
      prompt_folders: 3,
      source_views: 5,
      captures: 3,
      collections: 3,
      ai_features: false,
      zettelkasten: false,
      cloud_sync: false
    }
  },
  pro: {
    price_monthly: 2.99,
    price_yearly: 1.99,
    limits: {
      imports_per_day: "unlimited",
      exports_per_day: "unlimited",
      prompts_saved: "unlimited",
      prompt_folders: "unlimited",
      source_views: "unlimited",
      captures: "unlimited",
      collections: "unlimited",
      ai_features: false,
      zettelkasten: false,
      cloud_sync: true,
      agile_prompts_basic: true
    }
  },
  thinker: {
    price_monthly: 7.99,
    price_yearly: 5.99,
    limits: {
      imports_per_day: "unlimited",
      exports_per_day: "unlimited",
      prompts_saved: "unlimited",
      prompt_folders: "unlimited",
      source_views: "unlimited",
      captures: "unlimited",
      collections: "unlimited",
      ai_features: true,
      zettelkasten: true,
      cloud_sync: true,
      agile_prompts_basic: true,
      agile_prompts_ai: true,
      ai_calls_per_day: 50,
      notes_limit: 500
    }
  },
  thinker_pro: {
    price_monthly: 14.99,
    price_yearly: 10.99,
    limits: {
      imports_per_day: "unlimited",
      exports_per_day: "unlimited",
      prompts_saved: "unlimited",
      prompt_folders: "unlimited",
      source_views: "unlimited",
      captures: "unlimited",
      collections: "unlimited",
      ai_features: true,
      zettelkasten: true,
      cloud_sync: true,
      agile_prompts_basic: true,
      agile_prompts_ai: true,
      ai_calls_per_day: "unlimited",
      notes_limit: "unlimited",
      priority_support: true,
      early_access: true
    }
  }
}

export const PLAN_NAMES: Record<SubscriptionTier, string> = {
  free: "Free",
  pro: "Pro",
  thinker: "Thinker",
  thinker_pro: "Thinker Pro"
}

// ─── Agile Prompts ──────────────────────────────────────────────────────────

export const AGILE_PROMPTS: AgilePrompt[] = [
  {
    key: "study_roadmap",
    icon: "📚",
    label: "Roteiro de Estudo",
    tier: "pro",
    prompt: `Com base nas fontes disponíveis neste notebook, crie um roteiro de estudo progressivo e estruturado. O roteiro deve:

1. Começar pelos conceitos fundamentais e avançar gradualmente
2. Ter entre 8-12 módulos/etapas
3. Para cada módulo incluir:
   - Objetivo de aprendizagem (1 frase)
   - Conceitos-chave abordados (lista)
   - 3 perguntas de verificação para testar compreensão
4. Indicar pré-requisitos entre módulos (ex: "requer módulo 3")
5. Estimar tempo de estudo por módulo

Organize de forma clara e acionável.`
  },
  {
    key: "executive_summary",
    icon: "📋",
    label: "Resumo Executivo",
    tier: "pro",
    prompt: `Crie um resumo executivo conciso e acionável das fontes deste notebook. Estruture assim:

1. CONTEXTO (2-3 frases): O que essas fontes cobrem
2. PRINCIPAIS DESCOBERTAS (3-5 pontos): Os insights mais importantes
3. IMPLICAÇÕES: O que isso significa na prática
4. RECOMENDAÇÕES: Próximos passos concretos
5. GAPS: O que falta ou precisa de mais investigação

Mantenha em no máximo 500 palavras. Seja direto e específico.`
  },
  {
    key: "extract_concepts",
    icon: "🔑",
    label: "Extrair Conceitos",
    tier: "pro",
    prompt: `Extraia os conceitos-chave das fontes deste notebook. Para cada conceito:

1. **Nome do conceito** (termo preciso)
2. **Definição** (1-2 frases claras)
3. **Por que importa** (relevância prática)
4. **Relação com outros conceitos** (como se conecta)

Organize do mais fundamental ao mais avançado. Inclua pelo menos 10 conceitos.`
  },
  {
    key: "compare_sources",
    icon: "⚖️",
    label: "Comparar Fontes",
    tier: "pro",
    prompt: `Faça uma análise comparativa entre as fontes deste notebook. Identifique:

1. **Pontos de concordância**: Onde as fontes dizem a mesma coisa
2. **Pontos de divergência**: Onde discordam ou apresentam perspectivas diferentes
3. **Informação exclusiva**: O que cada fonte traz de único
4. **Credibilidade relativa**: Qual fonte parece mais fundamentada em cada tópico
5. **Síntese**: Uma visão unificada que combine o melhor de todas as fontes

Seja específico — cite qual fonte diz o quê.`
  },
  {
    key: "flashcards",
    icon: "🃏",
    label: "Gerar Flashcards",
    tier: "pro",
    prompt: `Crie um conjunto de flashcards de estudo baseados nas fontes deste notebook. Para cada flashcard:

**FRENTE**: Uma pergunta clara e específica
**VERSO**: A resposta concisa e precisa

Regras:
- Crie pelo menos 15 flashcards
- Varie os tipos: definições, comparações, aplicações, causa-efeito
- Ordene do mais básico ao mais avançado
- Cada resposta deve ter no máximo 3 frases
- Inclua exemplos quando possível`
  },
  {
    key: "deep_analysis",
    icon: "🔍",
    label: "Análise Profunda",
    tier: "pro",
    prompt: `Faça uma análise crítica e profunda do conteúdo das fontes deste notebook:

1. **Tese central**: Qual é o argumento principal?
2. **Evidências**: Quais dados/fatos suportam essa tese?
3. **Pontos fortes**: O que é bem fundamentado e convincente?
4. **Pontos fracos**: Onde há falhas de lógica, dados insuficientes, ou viés?
5. **Contra-argumentos**: Quais objeções alguém poderia levantar?
6. **Gaps de conhecimento**: O que as fontes NÃO cobrem mas deveriam?
7. **Aplicação prática**: Como usar esse conhecimento no mundo real?

Seja rigoroso mas justo.`
  },
  {
    key: "mind_map",
    icon: "🗺️",
    label: "Mapa Mental",
    tier: "pro",
    prompt: `Crie um mapa mental textual hierárquico baseado nas fontes deste notebook:

Use esta estrutura:
🎯 TEMA CENTRAL
├── Tópico Principal 1
│   ├── Subtópico 1.1
│   │   ├── Detalhe
│   │   └── Detalhe
│   └── Subtópico 1.2
├── Tópico Principal 2
│   ├── Subtópico 2.1
│   └── Subtópico 2.2
└── Tópico Principal 3

Inclua todos os temas relevantes das fontes. Mostre as conexões entre tópicos quando existirem.`
  },
  {
    key: "rewrite",
    icon: "✍️",
    label: "Reescrever",
    tier: "pro",
    prompt: `Reescreva sua última resposta em um formato diferente e mais útil. Considere:

- Se era um texto corrido → transforme em tópicos estruturados
- Se era uma lista → transforme em parágrafos narrativos com contexto
- Simplifique a linguagem mantendo a precisão
- Adicione exemplos práticos onde possível
- Destaque as informações mais acionáveis

Mantenha a mesma informação, mude a apresentação para máxima clareza.`
  }
]

// ─── Claude API Config ──────────────────────────────────────────────────────

export const CLAUDE_CONFIG = {
  MODEL_DEFAULT: "claude-haiku-4-5-20251001",  // Haiku para velocidade (thinker)
  MODEL_PRO: "claude-sonnet-4-6",              // Sonnet para thinker_pro
  MAX_TOKENS: 4096,
  TEMPERATURE: 0.7
} as const

// ─── URLs ────────────────────────────────────────────────────────────────────

export const URLS = {
  NOTEBOOKLM: "https://notebooklm.google.com",
  CHATGPT: "https://chat.openai.com",
  CHATGPT_NEW: "https://chatgpt.com",
  CLAUDE: "https://claude.ai",
  GEMINI: "https://gemini.google.com",
  PERPLEXITY: "https://perplexity.ai",
  PERPLEXITY_WWW: "https://www.perplexity.ai",
  GOOGLE_DOCS: "https://docs.google.com",
  MINDDOCK_LANDING: "https://minddock.app",
  STRIPE_PORTAL: "https://billing.stripe.com"
} as const

// ─── Message Handshake ──────────────────────────────────────────────────────

export const SECURE_TOKEN_EVENT_TYPE = "MINDDOCK_SECURE_TOKEN_BROADCAST"
export const HANDSHAKE_TOKEN = "md-v1-secure"

// ─── Stripe Price IDs ───────────────────────────────────────────────────────

export const STRIPE_PRICES = {
  pro_monthly: "price_pro_monthly",
  pro_yearly: "price_pro_yearly",
  thinker_monthly: "price_thinker_monthly",
  thinker_yearly: "price_thinker_yearly",
  thinker_pro_monthly: "price_thinker_pro_monthly",
  thinker_pro_yearly: "price_thinker_pro_yearly"
} as const

// ─── Cache TTL ──────────────────────────────────────────────────────────────

export const CACHE_TTL = {
  NOTEBOOKS: 5 * 60 * 1000,  // 5 minutos
  SOURCES: 3 * 60 * 1000,    // 3 minutos
  SUBSCRIPTION: 60 * 60 * 1000  // 1 hora
} as const
