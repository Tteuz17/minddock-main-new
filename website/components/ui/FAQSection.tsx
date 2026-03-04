"use client";

import React, { useEffect, useMemo, useState } from "react";

const INTRO_STYLE_ID = "faq1-animations";

const faqs = [
  {
    question: "O MindDock substitui o NotebookLM?",
    answer:
      "Não. O MindDock é uma extensão que potencializa o NotebookLM. Ele adiciona camadas que o NotebookLM não tem — prompts estruturados, Zettelkasten, captura de IAs externas e exportação avançada — sem tirar nada do que você já usa.",
    meta: "Produto",
  },
  {
    question: "Funciona com qualquer conta do Google?",
    answer:
      "Sim. O MindDock é uma extensão do Chrome que funciona com qualquer conta Google que tenha acesso ao NotebookLM. Basta instalar, fazer login com sua conta MindDock e começar a usar.",
    meta: "Instalação",
  },
  {
    question: "Como funciona a captura de outras IAs?",
    answer:
      "O AI Capture detecta automaticamente respostas do ChatGPT, Claude, Gemini, Perplexity e outras plataformas enquanto você navega. Com um clique, envia o conteúdo capturado como fonte direto para o notebook ativo no NotebookLM.",
    meta: "AI Capture",
  },
  {
    question: "Meus dados ficam seguros?",
    answer:
      "Sim. Nenhum conteúdo do seu NotebookLM é armazenado nos nossos servidores. O processamento de notas e prompts acontece localmente ou via chamadas diretas à API, sem intermediários que retenham seu conteúdo.",
    meta: "Segurança",
  },
  {
    question: "Posso cancelar a assinatura a qualquer momento?",
    answer:
      "Sim, sem burocracia. Cancele pelo painel MindDock e seu plano continua ativo até o fim do período já pago. Nenhuma cobrança adicional após o cancelamento.",
    meta: "Planos",
  },
  {
    question: "O que é o Zettelkasten e por que ele importa?",
    answer:
      "Zettelkasten é um método de notas atômicas linkadas entre si — cada ideia vira uma nota, cada nota pode se conectar a outras. No MindDock, você visualiza essas conexões em um grafo interativo, transformando o NotebookLM em uma segunda memória permanente e navegável.",
    meta: "Zettelkasten",
  },
];

const palette = {
  surface: "bg-neutral-950 text-neutral-100",
  panel: "bg-neutral-900/50",
  border: "border-white/10",
  heading: "text-white",
  muted: "text-neutral-400",
  iconRing: "border-white/20",
  iconSurface: "bg-white/5",
  icon: "text-white",
  glow: "rgba(255, 255, 255, 0.08)",
  aurora: "radial-gradient(ellipse 50% 100% at 10% 0%, rgba(250,204,21,0.08), transparent 65%), #000000",
  shadow: "shadow-[0_36px_140px_-60px_rgba(10,10,10,0.95)]",
  overlay: "linear-gradient(130deg, rgba(250,204,21,0.03) 0%, transparent 65%)",
};

export default function FAQSection() {
  const [introReady, setIntroReady] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hasEntered, setHasEntered] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById(INTRO_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = INTRO_STYLE_ID;
    style.innerHTML = `
      @keyframes faq1-fade-up {
        0% { transform: translate3d(0, 20px, 0); opacity: 0; filter: blur(6px); }
        60% { filter: blur(0); }
        100% { transform: translate3d(0, 0, 0); opacity: 1; filter: blur(0); }
      }
      @keyframes faq1-beam-spin {
        0% { transform: rotate(0deg) scale(1); }
        100% { transform: rotate(360deg) scale(1); }
      }
      @keyframes faq1-pulse {
        0% { transform: scale(0.7); opacity: 0.55; }
        60% { opacity: 0.1; }
        100% { transform: scale(1.25); opacity: 0; }
      }
      @keyframes faq1-meter {
        0%, 20% { transform: scaleX(0); transform-origin: left; }
        45%, 60% { transform: scaleX(1); transform-origin: left; }
        80%, 100% { transform: scaleX(0); transform-origin: right; }
      }
      @keyframes faq1-tick {
        0%, 30% { transform: translateX(-6px); opacity: 0.4; }
        50% { transform: translateX(2px); opacity: 1; }
        100% { transform: translateX(20px); opacity: 0; }
      }
      .faq1-intro {
        position: relative;
        display: flex;
        align-items: center;
        gap: 0.85rem;
        padding: 0.85rem 1.4rem;
        border-radius: 9999px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(12, 12, 12, 0.42);
        color: rgba(248, 250, 252, 0.92);
        text-transform: uppercase;
        letter-spacing: 0.35em;
        font-size: 0.65rem;
        width: 100%;
        max-width: 24rem;
        margin: 0 auto;
        mix-blend-mode: screen;
        opacity: 0;
        transform: translate3d(0, 12px, 0);
        filter: blur(8px);
        transition: opacity 720ms ease, transform 720ms ease, filter 720ms ease;
        isolation: isolate;
      }
      .faq1-intro--active {
        opacity: 1;
        transform: translate3d(0, 0, 0);
        filter: blur(0);
      }
      .faq1-intro__beam,
      .faq1-intro__pulse {
        position: absolute;
        inset: -110%;
        pointer-events: none;
        border-radius: 50%;
      }
      .faq1-intro__beam {
        background: conic-gradient(from 160deg, rgba(250,204,21,0.25), transparent 32%, rgba(250,204,21,0.18) 58%, transparent 78%);
        animation: faq1-beam-spin 18s linear infinite;
        opacity: 0.55;
      }
      .faq1-intro__pulse {
        border: 1px solid currentColor;
        opacity: 0.25;
        animation: faq1-pulse 3.4s ease-out infinite;
      }
      .faq1-intro__label {
        position: relative;
        z-index: 1;
        font-weight: 600;
        letter-spacing: 0.4em;
      }
      .faq1-intro__meter {
        position: relative;
        z-index: 1;
        flex: 1 1 auto;
        height: 1px;
        background: linear-gradient(90deg, transparent, currentColor 35%, transparent 85%);
        transform: scaleX(0);
        transform-origin: left;
        animation: faq1-meter 5.8s ease-in-out infinite;
        opacity: 0.7;
      }
      .faq1-intro__tick {
        position: relative;
        z-index: 1;
        width: 0.55rem;
        height: 0.55rem;
        border-radius: 9999px;
        background: currentColor;
        box-shadow: 0 0 0 4px rgba(250,204,21,0.15);
        animation: faq1-tick 3.2s ease-in-out infinite;
      }
      .faq1-fade {
        opacity: 0;
        transform: translate3d(0, 24px, 0);
        filter: blur(12px);
        transition: opacity 700ms ease, transform 700ms ease, filter 700ms ease;
      }
      .faq1-fade--ready {
        animation: faq1-fade-up 860ms cubic-bezier(0.22, 0.68, 0, 1) forwards;
      }
    `;
    document.head.appendChild(style);
    return () => { if (style.parentNode) style.remove(); };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") { setIntroReady(true); return; }
    const frame = window.requestAnimationFrame(() => setIntroReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") { setHasEntered(true); return; }
    let timeout: ReturnType<typeof setTimeout>;
    const onLoad = () => { timeout = window.setTimeout(() => setHasEntered(true), 120); };
    if (document.readyState === "complete") { onLoad(); }
    else { window.addEventListener("load", onLoad, { once: true }); }
    return () => { window.removeEventListener("load", onLoad); clearTimeout(timeout); };
  }, []);

  const setCardGlow = (event: React.MouseEvent<HTMLLIElement>) => {
    const target = event.currentTarget;
    const rect = target.getBoundingClientRect();
    target.style.setProperty("--faq-x", `${event.clientX - rect.left}px`);
    target.style.setProperty("--faq-y", `${event.clientY - rect.top}px`);
  };

  const clearCardGlow = (event: React.MouseEvent<HTMLLIElement>) => {
    event.currentTarget.style.removeProperty("--faq-x");
    event.currentTarget.style.removeProperty("--faq-y");
  };

  return (
    <div className={`relative w-full overflow-hidden transition-colors duration-700 ${palette.surface}`}>
      <div className="absolute inset-0 z-0" style={{ background: palette.aurora }} />
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-80"
        style={{ background: palette.overlay, mixBlendMode: "screen" }}
      />

      <section
        className={`relative z-10 mx-auto flex max-w-4xl flex-col gap-12 px-6 py-24 lg:max-w-5xl lg:px-12 ${
          hasEntered ? "faq1-fade--ready" : "faq1-fade"
        }`}
      >
        <div className={`faq1-intro ${introReady ? "faq1-intro--active" : ""}`}>
          <span className="faq1-intro__beam" aria-hidden="true" />
          <span className="faq1-intro__pulse" aria-hidden="true" />
          <span className="faq1-intro__label">FAQ MindDock</span>
          <span className="faq1-intro__meter" aria-hidden="true" />
          <span className="faq1-intro__tick" aria-hidden="true" />
        </div>

        <header className="space-y-4">
          <p className={`text-xs uppercase tracking-[0.35em] ${palette.muted}`}>Perguntas frequentes</p>
          <h2 className={`text-4xl font-semibold leading-tight md:text-5xl ${palette.heading}`}>
            Tudo que você precisa saber<br className="hidden sm:block" /> antes de começar.
          </h2>
          <p className={`max-w-xl text-base ${palette.muted}`}>
            Respostas diretas sobre o MindDock, seus planos e como ele transforma o seu NotebookLM.
          </p>
        </header>

        <ul className="space-y-4">
          {faqs.map((item, index) => {
            const open = activeIndex === index;
            const panelId = `faq-panel-${index}`;
            const buttonId = `faq-trigger-${index}`;

            return (
              <li
                key={item.question}
                className={`group relative overflow-hidden rounded-3xl border backdrop-blur-xl transition-all duration-500 hover:-translate-y-0.5 focus-within:-translate-y-0.5 ${palette.border} ${palette.panel} ${palette.shadow}`}
                onMouseMove={setCardGlow}
                onMouseLeave={clearCardGlow}
              >
                <div
                  className={`pointer-events-none absolute inset-0 transition-opacity duration-500 ${
                    open ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                  style={{
                    background: `radial-gradient(240px circle at var(--faq-x, 50%) var(--faq-y, 50%), ${palette.glow}, transparent 70%)`,
                  }}
                />

                <button
                  type="button"
                  id={buttonId}
                  aria-controls={panelId}
                  aria-expanded={open}
                  onClick={() => setActiveIndex((prev) => (prev === index ? -1 : index))}
                  className="relative flex w-full items-start gap-6 px-8 py-7 text-left transition-colors duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/35"
                >
                  <span
                    className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition-all duration-500 group-hover:scale-105 ${palette.iconRing} ${palette.iconSurface}`}
                  >
                    <span
                      className={`pointer-events-none absolute inset-0 rounded-full border opacity-30 ${
                        palette.iconRing
                      } ${open ? "animate-ping" : ""}`}
                    />
                    <svg
                      className={`relative h-5 w-5 transition-transform duration-500 ${palette.icon} ${open ? "rotate-45" : ""}`}
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <path d="M12 5v14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </span>

                  <div className="flex flex-1 flex-col gap-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                      <h3 className={`text-lg font-medium leading-tight sm:text-xl ${palette.heading}`}>
                        {item.question}
                      </h3>
                      {item.meta && (
                        <span
                          className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.35em] transition-opacity duration-300 sm:ml-auto ${palette.border} ${palette.muted}`}
                        >
                          {item.meta}
                        </span>
                      )}
                    </div>

                    <div
                      id={panelId}
                      role="region"
                      aria-labelledby={buttonId}
                      className={`overflow-hidden text-sm leading-relaxed transition-[max-height] duration-500 ease-out ${
                        open ? "max-h-64" : "max-h-0"
                      } ${palette.muted}`}
                    >
                      <p className="pr-2">{item.answer}</p>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
