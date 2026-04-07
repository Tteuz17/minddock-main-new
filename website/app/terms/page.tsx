import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Termos de Uso | MindDock",
  description: "Termos de Uso da plataforma MindDock."
}

const LAST_UPDATED = "07 de abril de 2026"

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
          <p className="mt-4 text-sm leading-7 text-white/65">Ultima atualizacao: {LAST_UPDATED}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link className="nav-chip" href="/privacy">
              Politica de Privacidade
            </Link>
            <Link className="nav-chip" href="/">
              Voltar para a landing
            </Link>
          </div>
        </header>

        <section className="mt-6 rounded-3xl border border-white/10 bg-black/30 p-6 backdrop-blur-xl sm:p-8">
          <div className="space-y-5 text-sm leading-7 text-white/70">
            <p>
              Estes Termos de Uso regulam o acesso e o uso da extensao MindDock para Google Chrome e
              dos servicos associados no site oficial.
            </p>
            <p>
              Ao instalar a extensao, criar conta ou usar os recursos da MindDock, voce declara que
              leu e concorda com estes Termos e com a Politica de Privacidade. Se nao concordar, nao
              utilize a extensao.
            </p>

            <div>
              <h2 className="text-base font-semibold text-white">1. Objeto do servico</h2>
              <p>
                A MindDock e uma extensao de navegador que ajuda voce a capturar, organizar, exportar
                e gerenciar conteudo de ferramentas de IA e do Google NotebookLM, com integracoes
                opcionais como Google Docs, Google Drive e Notion.
              </p>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">2. Elegibilidade e conta</h2>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>Ter capacidade legal para contratar.</li>
                <li>Usar conta valida nos servicos conectados, quando necessario.</li>
                <li>Manter dados de acesso corretos e atualizados.</li>
                <li>Proteger credenciais e sessao de acesso.</li>
              </ul>
              <p className="mt-2">Voce e responsavel por toda atividade realizada na sua conta.</p>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">3. Planos, cobranca e cancelamento</h2>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>Planos gratuitos e pagos podem ser oferecidos conforme disponibilidade.</li>
                <li>Processamento de pagamento por provedor terceiro (ex.: Stripe).</li>
                <li>Cancelamento pode ser feito a qualquer momento.</li>
                <li>Acesso pago permanece ate o fim do periodo ja quitado.</li>
                <li>Sem reembolso proporcional, salvo exigencia legal.</li>
              </ul>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">4. Licenca de uso</h2>
              <p>
                Concedemos uma licenca limitada, nao exclusiva, intransferivel e revogavel para uso
                da extensao conforme estes termos.
              </p>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>Proibido revender, sublicenciar ou explorar comercialmente sem autorizacao.</li>
                <li>Proibido tentar engenharia reversa, descompilar ou contornar seguranca.</li>
                <li>Proibido uso ilegal, abusivo ou que viole direitos de terceiros.</li>
              </ul>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">5. Integracoes de terceiros</h2>
              <p>
                A MindDock depende de APIs e servicos de terceiros (Google, Notion e Stripe, entre
                outros). Mudancas externas podem afetar funcionalidades, e voce tambem se sujeita aos
                termos desses provedores.
              </p>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">6. Conteudo e propriedade intelectual</h2>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>Software, marca e elementos visuais da MindDock sao protegidos por lei.</li>
                <li>Seu conteudo capturado/exportado permanece de sua titularidade.</li>
                <li>Voce deve ter base legal para tratar conteudo de terceiros.</li>
              </ul>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">7. Disponibilidade e encerramento</h2>
              <p>
                Podemos atualizar, suspender ou descontinuar funcionalidades, com aviso razoavel quando
                aplicavel. Tambem podemos suspender acesso em caso de violacao, fraude ou risco de
                seguranca.
              </p>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">8. Limitacao de responsabilidade</h2>
              <p>
                Na extensao permitida por lei, a MindDock nao responde por danos indiretos, perdas
                consequenciais, indisponibilidade de terceiros ou falhas fora de controle razoavel.
              </p>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">9. Privacidade e dados pessoais</h2>
              <p>
                O tratamento de dados pessoais ocorre conforme a Politica de Privacidade da MindDock,
                que integra estes Termos.
              </p>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">10. Lei aplicavel e foro</h2>
              <p>
                Estes Termos sao regidos pelas leis da Republica Federativa do Brasil. Quando
                permitido por lei, aplica-se o foro legalmente competente.
              </p>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">11. Alteracoes destes termos</h2>
              <p>
                Estes termos podem ser atualizados periodicamente. A versao vigente sempre estara
                publicada nesta pagina.
              </p>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white">12. Contato</h2>
              <p>
                Em caso de duvidas, suporte ou solicitacoes contratuais:{" "}
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
