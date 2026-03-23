import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Política de Privacidade | MindDock",
  description: "Política de Privacidade da plataforma MindDock."
}

const LAST_UPDATED = "13 de março de 2026"

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[var(--page)] text-[var(--ink)]">
      <div className="site-background" aria-hidden="true" />

      <div className="relative mx-auto w-full max-w-4xl px-6 py-10 sm:px-10 lg:py-14">
        <header className="rounded-3xl border border-white/10 bg-black/35 p-6 shadow-[0_18px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-8">
          <p className="text-[11px] uppercase tracking-[0.2em] text-white/45">MindDock Legal</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
            Política de Privacidade
          </h1>
          <p className="mt-4 text-sm leading-7 text-white/65">
            Última atualização: {LAST_UPDATED}
          </p>
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
              Esta política descreve como a MindDock coleta, usa, compartilha e protege dados
              pessoais relacionados ao uso da plataforma.
            </p>

            <div>
              <h2 className="text-base font-semibold text-white">1. Dados coletados</h2>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>Dados de conta, como nome e e-mail.</li>
                <li>Dados de uso, como interações com recursos e configurações.</li>
                <li>Dados técnicos, como navegador, dispositivo e registros de acesso.</li>
              </ul>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">2. Finalidades</h2>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>Operar, manter e melhorar a plataforma.</li>
                <li>Personalizar experiência e prestar suporte.</li>
                <li>Prevenir fraudes, abusos e cumprir obrigações legais.</li>
              </ul>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">3. Compartilhamento</h2>
              <p>
                Dados podem ser compartilhados com provedores necessários para operação (ex:
                autenticação, hospedagem, pagamentos e analytics), sob deveres de segurança e
                confidencialidade.
              </p>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">4. Retenção e segurança</h2>
              <p>
                Dados são mantidos pelo período necessário às finalidades desta política e às
                exigências legais. Aplicamos medidas técnicas e administrativas de proteção.
              </p>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">5. Seus direitos</h2>
              <p>
                Você pode solicitar acesso, correção, atualização e exclusão de dados, nos termos
                da legislação aplicável, incluindo a LGPD quando pertinente.
              </p>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">6. Contato</h2>
              <p>
                Em caso de dúvidas sobre privacidade, entre em contato:
                {" "}
                <a className="text-[#facc15] hover:underline" href="mailto:hello@minddock.ai">
                  hello@minddock.ai
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
