import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Politica de Privacidade | MindDock",
  description: "Politica de Privacidade da plataforma MindDock."
}

const LAST_UPDATED = "07 de abril de 2026"

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[var(--page)] text-[var(--ink)]">
      <div className="site-background" aria-hidden="true" />

      <div className="relative mx-auto w-full max-w-4xl px-6 py-10 sm:px-10 lg:py-14">
        <header className="rounded-3xl border border-white/10 bg-black/35 p-6 shadow-[0_18px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-8">
          <p className="text-[11px] uppercase tracking-[0.2em] text-white/45">MindDock Legal</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
            Politica de Privacidade
          </h1>
          <p className="mt-4 text-sm leading-7 text-white/65">Ultima atualizacao: {LAST_UPDATED}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link className="nav-chip" href="/terms">
              Termos de Uso
            </Link>
            <Link className="nav-chip" href="/">
              Voltar para a landing
            </Link>
          </div>
        </header>

        <section className="mt-6 rounded-3xl border border-white/10 bg-black/30 p-6 backdrop-blur-xl sm:p-8">
          <div className="space-y-5 text-sm leading-7 text-white/70">
            <p>
              Esta Politica explica como a MindDock coleta, usa, armazena, compartilha e protege
              dados ao utilizar a extensao Chrome e servicos associados.
            </p>

            <div>
              <h2 className="text-base font-semibold text-white">1. Quais dados tratamos</h2>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>
                  Dados de conta MindDock (identificadores de usuario e informacoes de assinatura).
                </li>
                <li>
                  Tokens tecnicos de sessao do NotebookLM (`at`, `bl`, `authUser`, `accountEmail`) para
                  executar acoes solicitadas por voce.
                </li>
                <li>
                  Conteudo capturado por voce (titulos, textos, links, identificadores de notebook/fonte).
                </li>
                <li>Dados necessarios para integracoes com Google Docs/Drive e Notion.</li>
                <li>Dados de assinatura e identificadores de cobranca processados por provedor externo.</li>
                <li>Diagnostico tecnico minimo para estabilidade e seguranca.</li>
              </ul>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">2. Armazenamento tecnico</h2>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>
                  Tokens de sessao do NotebookLM sao armazenados preferencialmente em `chrome.storage.session`,
                  com fallback tecnico para `chrome.storage.local` quando necessario.
                </li>
                <li>Token OAuth do Notion e armazenado atualmente em `chrome.storage.local`.</li>
                <li>Tokens do Google sao usados para operacoes autorizadas pelo usuario.</li>
              </ul>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">3. Como usamos os dados</h2>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>Autenticacao e manutencao de sessao.</li>
                <li>Execucao de funcionalidades da extensao e integracoes.</li>
                <li>Controle de limites de plano, faturamento e suporte.</li>
                <li>Prevencao de abuso, fraude e uso indevido.</li>
                <li>Diagnostico de falhas e melhoria do produto.</li>
              </ul>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">4. Compartilhamento com terceiros</h2>
              <p>
                Compartilhamos dados apenas quando necessario para operar recursos solicitados, com
                provedores como Supabase, Google APIs, Notion API, Stripe (ou equivalente) e provedor
                de IA via backend MindDock.
              </p>
              <p>Nao vendemos dados pessoais para anunciantes.</p>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">5. Bases legais e direitos (LGPD)</h2>
              <p>
                O tratamento pode ocorrer com base em execucao de contrato, cumprimento legal, legitimo
                interesse e consentimento, quando aplicavel.
              </p>
              <p>
                Voce pode solicitar acesso, correcao, exclusao e demais direitos previstos na LGPD por
                meio do contato oficial.
              </p>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">6. Retencao e seguranca</h2>
              <p>
                Mantemos dados pelo tempo necessario para operacao, suporte, seguranca e obrigacoes
                legais. Adotamos medidas tecnicas e organizacionais razoaveis para reduzir riscos.
              </p>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">7. Politica de dados do Google</h2>
              <p>
                Quando a MindDock acessa dados por meio de APIs do Google, o uso segue a Google API
                Services User Data Policy e requisitos de uso limitado, conforme aplicavel.
              </p>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">8. Alteracoes desta politica</h2>
              <p>
                Esta Politica pode ser atualizada periodicamente. A versao vigente sempre estara
                publicada nesta pagina com a data de revisao.
              </p>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">9. Contato</h2>
              <p>
                Em caso de duvidas sobre privacidade:{" "}
                <a className="text-[#facc15] hover:underline" href="mailto:hello@minddocklm.digital">
                  hello@minddocklm.digital
                </a>
                .
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
