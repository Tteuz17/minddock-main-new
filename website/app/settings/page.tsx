import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Settings | Termos e Privacidade | MindDock",
  description:
    "Termos de Uso e Política de Privacidade da MindDock, disponíveis na área de Settings."
}

const LAST_UPDATED = "13 de março de 2026"

export default function SettingsPage() {
  return (
    <main className="min-h-screen bg-[var(--page)] text-[var(--ink)]">
      <div className="site-background" aria-hidden="true" />

      <div className="relative mx-auto w-full max-w-4xl px-6 py-10 sm:px-10 lg:py-14">
        <header className="rounded-3xl border border-white/10 bg-black/35 p-6 shadow-[0_18px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-8">
          <p className="text-[11px] uppercase tracking-[0.2em] text-white/45">MindDock Settings</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
            Termos de Uso e Política de Privacidade
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-white/65">
            Última atualização: {LAST_UPDATED}. Esta página centraliza as regras de uso da
            plataforma e como os dados são tratados.
          </p>

          <nav className="mt-6 flex flex-wrap gap-2" aria-label="Navegação dos documentos">
            <a className="nav-chip" href="#termos">
              Termos de Uso
            </a>
            <a className="nav-chip" href="#privacidade">
              Política de Privacidade
            </a>
            <Link className="nav-chip" href="/">
              Voltar para o site
            </Link>
          </nav>
        </header>

        <section
          id="termos"
          className="mt-6 rounded-3xl border border-white/10 bg-black/30 p-6 backdrop-blur-xl sm:p-8"
          style={{ scrollMarginTop: 24 }}>
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white">Termos de Uso</h2>
          <div className="mt-5 space-y-5 text-sm leading-7 text-white/70">
            <p>
              Ao usar a MindDock, você concorda com estes termos. Se não concordar, não utilize a
              extensão, o site ou qualquer funcionalidade associada.
            </p>

            <div>
              <h3 className="text-base font-semibold text-white">1. Uso da plataforma</h3>
              <p>
                A MindDock oferece recursos para organização de conhecimento, captura de conteúdo e
                automação de fluxos em ferramentas de pesquisa. O uso deve ser lícito e compatível
                com estes termos.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-white">2. Conta e segurança</h3>
              <p>
                Você é responsável pelas informações de acesso da sua conta e por toda atividade
                realizada nela. Em caso de uso não autorizado, entre em contato imediatamente.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-white">3. Condutas proibidas</h3>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>Usar a plataforma para fins ilegais ou violação de direitos de terceiros.</li>
                <li>Tentar explorar falhas de segurança ou interromper o funcionamento do serviço.</li>
                <li>Reproduzir, revender ou distribuir o serviço sem autorização expressa.</li>
              </ul>
            </div>

            <div>
              <h3 className="text-base font-semibold text-white">4. Propriedade intelectual</h3>
              <p>
                O software, identidade visual, marca e materiais da MindDock são protegidos por leis
                de propriedade intelectual. O conteúdo criado por você permanece de sua titularidade.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-white">
                5. Disponibilidade e limitações
              </h3>
              <p>
                Buscamos manter a plataforma estável, mas não garantimos disponibilidade contínua ou
                ausência total de falhas. Recursos podem ser alterados, suspensos ou descontinuados.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-white">6. Alterações destes termos</h3>
              <p>
                Estes termos podem ser atualizados periodicamente. A data de revisão sempre será
                publicada nesta página. O uso contínuo após atualização indica concordância.
              </p>
            </div>
          </div>
        </section>

        <section
          id="privacidade"
          className="mt-6 rounded-3xl border border-white/10 bg-black/30 p-6 backdrop-blur-xl sm:p-8"
          style={{ scrollMarginTop: 24 }}>
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white">
            Política de Privacidade
          </h2>
          <div className="mt-5 space-y-5 text-sm leading-7 text-white/70">
            <p>
              Esta política descreve como coletamos, usamos e protegemos dados pessoais relacionados
              ao uso da MindDock.
            </p>

            <div>
              <h3 className="text-base font-semibold text-white">1. Dados que podemos coletar</h3>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>Dados de conta, como nome e e-mail.</li>
                <li>Dados de uso, como interações com recursos e configurações salvas.</li>
                <li>Dados técnicos, como identificadores de dispositivo, navegador e logs.</li>
              </ul>
            </div>

            <div>
              <h3 className="text-base font-semibold text-white">2. Finalidades de uso</h3>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>Entregar, manter e melhorar o funcionamento da plataforma.</li>
                <li>Personalizar a experiência e oferecer suporte.</li>
                <li>Cumprir obrigações legais e prevenir fraudes/abusos.</li>
              </ul>
            </div>

            <div>
              <h3 className="text-base font-semibold text-white">3. Compartilhamento de dados</h3>
              <p>
                Podemos compartilhar dados apenas com provedores necessários para operação (ex:
                autenticação, hospedagem, pagamentos e analytics), sempre sob obrigações de
                confidencialidade e segurança.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-white">4. Retenção e segurança</h3>
              <p>
                Mantemos dados pelo tempo necessário às finalidades desta política e exigências
                legais. Adotamos medidas técnicas e administrativas para proteger as informações.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-white">5. Seus direitos</h3>
              <p>
                Você pode solicitar acesso, correção, atualização e exclusão de dados pessoais, nos
                termos da legislação aplicável (incluindo LGPD quando aplicável).
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-white">6. Contato</h3>
              <p>
                Para dúvidas sobre privacidade ou uso da plataforma, entre em contato:
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
