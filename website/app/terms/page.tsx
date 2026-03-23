import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Termos de Uso | MindDock",
  description: "Termos de Uso da plataforma MindDock."
}

const LAST_UPDATED = "13 de março de 2026"

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[var(--page)] text-[var(--ink)]">
      <div className="site-background" aria-hidden="true" />

      <div className="relative mx-auto w-full max-w-4xl px-6 py-10 sm:px-10 lg:py-14">
        <header className="rounded-3xl border border-white/10 bg-black/35 p-6 shadow-[0_18px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-8">
          <p className="text-[11px] uppercase tracking-[0.2em] text-white/45">MindDock Legal</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
            Termos de Uso
          </h1>
          <p className="mt-4 text-sm leading-7 text-white/65">
            Última atualização: {LAST_UPDATED}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link className="nav-chip" href="/privacy">
              Política de Privacidade
            </Link>
            <Link className="nav-chip" href="/">
              Voltar para a landing
            </Link>
          </div>
        </header>

        <section className="mt-6 rounded-3xl border border-white/10 bg-black/30 p-6 backdrop-blur-xl sm:p-8">
          <div className="space-y-5 text-sm leading-7 text-white/70">
            <p>
              Ao usar a MindDock, você concorda com estes termos. Se não concordar, não utilize a
              extensão, o site ou funcionalidades relacionadas.
            </p>

            <div>
              <h2 className="text-base font-semibold text-white">1. Uso da plataforma</h2>
              <p>
                A MindDock oferece recursos para organização de conhecimento, captura de conteúdo e
                automação de fluxos. O uso deve ser lícito e compatível com estes termos.
              </p>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">2. Conta e segurança</h2>
              <p>
                Você é responsável pelas informações de acesso da sua conta e por toda atividade
                realizada nela. Em caso de uso não autorizado, comunique imediatamente.
              </p>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">3. Condutas proibidas</h2>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>Uso ilegal ou violação de direitos de terceiros.</li>
                <li>Explorar vulnerabilidades ou interromper o funcionamento do serviço.</li>
                <li>Revender, distribuir ou copiar o serviço sem autorização.</li>
              </ul>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">4. Propriedade intelectual</h2>
              <p>
                Software, marca e identidade visual da MindDock são protegidos por leis de
                propriedade intelectual. O conteúdo criado por você permanece de sua titularidade.
              </p>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">5. Disponibilidade</h2>
              <p>
                Buscamos manter estabilidade do serviço, mas não garantimos disponibilidade contínua
                e ausência total de falhas. Recursos podem ser alterados ou descontinuados.
              </p>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">6. Alterações</h2>
              <p>
                Estes termos podem ser atualizados. A versão vigente sempre estará publicada nesta
                página e o uso contínuo após atualização indica concordância.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
