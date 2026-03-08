import Image from "next/image"
import { InfiniteRibbon } from "@/components/ui/infinite-ribbon"
import FeaturesScrollSection from "@/components/ui/FeaturesScrollSection"
import PricingSection from "@/components/ui/PricingSection"
import FAQSection from "@/components/ui/FAQSection"
import CTASection from "@/components/ui/CTASection"
import LandingFooter from "@/components/ui/LandingFooter"
import heroBackground from "../../public/lp/backgroundhero.png"
import minddockLogo from "../../public/lp/logo/logo minddock sem fundo.png"

const agilePromptVideoSrc = "/api/lp/agile-prompts"
const docksVideoSrc = "/api/lp/docks"

const overviewMiniCards = [
  {
    eyebrow: "AI capture",
    title: "Import from any AI.",
    body: "Grab text from ChatGPT, Claude, Gemini and Perplexity and send it straight into NotebookLM.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={16} height={16}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
    )
  },
  {
    eyebrow: "Second brain",
    title: "One click to save.",
    body: "Save chats, sources and insights into a permanent, searchable second brain.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={16} height={16}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
      </svg>
    )
  },
  {
    eyebrow: "Cross-project",
    title: "Connect the dots.",
    body: "Reference anything you have already saved or created, across all your projects.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={16} height={16}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
      </svg>
    )
  },
  {
    eyebrow: "Deep organization",
    title: "Keep it clean.",
    body: "Organize with nested folders and tags to structure your growing knowledge base.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={16} height={16}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
      </svg>
    )
  }
]

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[var(--page)] text-[var(--ink)]">
      <div className="site-background" aria-hidden="true" />

      <section
        className="relative min-h-[70vh] overflow-hidden lg:min-h-[76vh]"
        style={{
          backgroundImage: `url(${heroBackground.src})`,
          backgroundSize: "cover",
          backgroundPosition: "center"
        }}>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(5, 6, 8, 0.08) 0%, rgba(5, 6, 8, 0.14) 36%, rgba(5, 6, 8, 0.36) 70%, rgba(5, 6, 8, 0.68) 100%), radial-gradient(circle at 50% 40%, rgba(5, 6, 8, 0.22) 0%, rgba(5, 6, 8, 0.08) 28%, rgba(5, 6, 8, 0) 58%)"
          }}
        />

        <div className="relative z-[1] mx-auto flex min-h-[70vh] w-full max-w-7xl flex-col px-6 pb-10 pt-6 sm:px-10 lg:min-h-[76vh] lg:px-14">
          <header className="mx-auto flex w-full max-w-5xl items-center justify-between rounded-full border border-white/10 bg-black/[0.14] px-4 py-3 shadow-[0_10px_24px_rgba(0,0,0,0.12)] backdrop-blur-md sm:px-5">
            <div className="flex items-center">
              <Image
                src={minddockLogo}
                alt="MindDock"
                className="h-10 w-auto object-contain"
                priority
              />
            </div>

            <nav className="hidden items-center gap-2 md:flex">
              <a className="nav-chip" href="#features">
                Features
              </a>
              <a className="nav-chip" href="#pricing">
                Pricing
              </a>
            </nav>
          </header>

          <section className="relative flex flex-1 flex-col justify-center py-10 lg:py-12">
            <div className="relative z-[1] mx-auto flex w-full max-w-5xl flex-col items-center space-y-9 text-center">
              <div className="space-y-5">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/[0.12] px-4 py-2 text-[10px] uppercase tracking-[0.18em] sm:tracking-[0.24em] text-white/60 backdrop-blur-sm">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />
                  The same NotebookLM. but now with superpowers
                </div>

                <div className="space-y-4">
                  <h1 className="mx-auto text-[clamp(1.6rem,5vw,3.2rem)] font-normal leading-[1.08] tracking-[-0.05em] text-white [text-shadow:0_10px_28px_rgba(0,0,0,0.22)] sm:text-[clamp(1.8rem,3.8vw,3.2rem)] sm:leading-[1.05] sm:tracking-[-0.06em]">
                    <span className="block text-[0.8em] font-normal tracking-[-0.035em] text-white/65 sm:tracking-[-0.045em]">
                      NotebookLM was just the beginning.
                    </span>
                    <span className="mt-2 block font-normal tracking-[-0.045em] sm:whitespace-nowrap sm:tracking-[-0.055em]">
                      This is where your <span className="hero-serif">superpowers</span> begin.
                    </span>
                  </h1>
                  <p className="mx-auto max-w-3xl text-sm leading-7 text-white/72 [text-shadow:0_6px_20px_rgba(0,0,0,0.18)] sm:text-base sm:leading-8 lg:text-lg">
                    More topics. Smarter prompts. A single notebook and several subjects.
                    A brilliant and connected mind.
                  </p>
                </div>
              </div>

              <div className="flex flex-col justify-center gap-3 sm:flex-row">
                <a
                  className="cta-primary"
                  href="https://chromewebstore.google.com/detail/minddock/your-extension-id"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    {/* Red sector — top right */}
                    <path d="M12 2a10 10 0 0 1 8.66 5H12Z" fill="#EA4335" />
                    {/* Green sector — bottom left */}
                    <path d="M3.34 7A10 10 0 0 0 7.5 21.33L12 13Z" fill="#34A853" />
                    {/* Yellow sector — bottom right */}
                    <path d="M12 22a10 10 0 0 0 8.66-15H12l-4.5 7.33Z" fill="#FBBC05" />
                    {/* White inner ring */}
                    <circle cx="12" cy="12" r="5" fill="#fff" />
                    {/* Blue center */}
                    <circle cx="12" cy="12" r="3.5" fill="#4285F4" />
                  </svg>
                  Add to Chrome
                </a>
                <a className="cta-secondary" href="#features">
                  Explore the product
                </a>
              </div>
            </div>
          </section>
        </div>
      </section>

      <InfiniteRibbon />

      <div className="relative mx-auto w-full max-w-7xl px-6 pb-16 sm:px-10 lg:px-14">
        <section className="pt-10">
          <div className="mb-8 text-center">
            <p className="text-[11px] uppercase tracking-[0.24em] text-white/35">Inside MindDock</p>
            <h2 className="mx-auto mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.05em] text-white sm:text-5xl">
              A research workspace built to think in layers.
            </h2>
          </div>

          <div className="grid gap-6">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {overviewMiniCards.map((card) => (
                <article key={card.title} className="panel-flat space-y-3">
                  <div className="text-white/40">{card.icon}</div>
                  <h3 className="text-base font-semibold tracking-[-0.03em] text-white">
                    {card.title}
                  </h3>
                  <p className="text-xs leading-5 text-white/45">{card.body}</p>
                </article>
              ))}
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <article className="panel-flat">
                <div className="flex h-full flex-col gap-5">
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-white/35">Docks</p>
                    <h3 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white">
                      Split one notebook into focused docks.
                    </h3>
                    <p className="mt-3 max-w-xl text-sm leading-7 text-white/50">
                      Keep context isolated by topic so each line of reasoning stays clean,
                      recoverable, and easier to refine.
                    </p>
                  </div>
                  <div className="flex-1 overflow-hidden rounded-[1.25rem]">
                    <video
                      autoPlay muted loop playsInline preload="auto"
                      className="h-full min-h-48 w-full object-cover object-center">
                      <source src={docksVideoSrc} type="video/mp4" />
                    </video>
                  </div>
                </div>
              </article>

              <article className="panel-flat">
                <div className="flex h-full flex-col-reverse gap-5 sm:flex-col">
                  <div className="overflow-hidden rounded-[1.25rem]">
                    <video
                      autoPlay muted loop playsInline preload="auto"
                      className="h-48 w-full object-cover object-[center_82%] sm:h-52">
                      <source src={agilePromptVideoSrc} type="video/mp4" />
                    </video>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-white/35">Agile prompts</p>
                    <h3 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white">
                      Launch better prompts faster.
                    </h3>
                    <p className="mt-3 max-w-xl text-sm leading-7 text-white/50">
                      Use tighter prompt structures to get clearer answers without rewriting your
                      workflow every time.
                    </p>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* Section title */}
        <div className="pt-20 pb-10 text-center">
          <p className="text-[11px] uppercase tracking-[0.24em] text-white/35">The difference</p>
          <h2 className="mx-auto mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.05em] text-white sm:text-5xl">
            See what changes when research has a home.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-white/45">
            Without structure, every session starts from zero. With MindDock, every session builds on the last.
          </p>
        </div>

        <section className="pb-2">
          <div className="grid gap-6 lg:grid-cols-2">

            {/* Before card — pure white, black text */}
            <div className="relative overflow-hidden rounded-3xl bg-white p-7">
              {/* Status bar */}
              <div className="mb-5 flex items-center justify-between">
                <span className="text-[10px] text-black/50">9:41</span>
                <span className="flex gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-1 w-1 rounded-full bg-black/35" />
                  ))}
                </span>
              </div>
              {/* Badge */}
              <div className="inline-flex items-center gap-2 rounded-full border border-black/20 bg-black/8 px-3 py-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-black/60" />
                <span className="text-[10px] uppercase tracking-[0.2em] text-black/70">Without MindDock</span>
              </div>
              {/* Title */}
              <h3 className="mt-5 text-xl font-semibold leading-snug tracking-[-0.03em] text-black/55 line-through decoration-black/30">
                Research gets trapped in<br />temporary conversations.
              </h3>
              {/* Timeline */}
              <div className="mt-7">
                {[
                  "Insights buried in scrollback",
                  "No structure survives a new chat",
                  "Sources pile up, recall goes down",
                  "Ideas vanish before they connect",
                ].map((text, i, arr) => (
                  <div key={i} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-black/30 bg-transparent" />
                      {i < arr.length - 1 && (
                        <div className="my-1.5 w-px flex-1 bg-black/20" style={{ minHeight: "26px" }} />
                      )}
                    </div>
                    <div className="pb-5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-black/45">
                        Step {i + 1}
                      </p>
                      <p className="mt-1 text-sm font-medium text-black/80">{text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* After card — yellow, black text */}
            <div className="relative overflow-hidden rounded-3xl bg-[#facc15] p-7">
              <div className="relative">
                {/* Status bar with logo */}
                <div className="mb-5 flex items-center justify-between">
                  <Image
                    src={minddockLogo}
                    alt="MindDock"
                    className="h-8 w-auto object-contain"
                  />
                  <button className="flex h-5 w-5 items-center justify-center rounded-full border border-black/20 text-[9px] text-black/50">
                    ✕
                  </button>
                </div>
                {/* Badge */}
                <div className="inline-flex items-center gap-2 rounded-full border border-black/20 bg-black/10 px-3 py-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-black/70" />
                  <span className="text-[10px] uppercase tracking-[0.2em] text-black/70">With MindDock</span>
                </div>
                {/* Title */}
                <h3 className="mt-5 text-xl font-semibold leading-snug tracking-[-0.03em] text-black">
                  Your knowledge compounds<br />session after session.
                </h3>
                {/* Timeline */}
                <div className="mt-7">
                  {[
                    {
                      text: "Notes persist and stay linked",
                      icon: (
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                          <path d="M5.5 8.5l-2 2A2 2 0 1 0 6.5 13.5L8.5 11.5M8.5 5.5l2-2A2 2 0 1 0 7.5.5L5.5 2.5M5.5 8.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      ),
                    },
                    {
                      text: "Each dock keeps its own clean context",
                      icon: (
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                          <rect x="1" y="1" width="5" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
                          <rect x="8" y="1" width="5" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
                          <rect x="1" y="8" width="5" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
                          <rect x="8" y="8" width="5" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
                        </svg>
                      ),
                    },
                    {
                      text: "Everything is searchable, always",
                      icon: (
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                          <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.5" />
                          <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      ),
                    },
                    {
                      text: "Ideas connect and build over time",
                      icon: (
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                          <circle cx="7" cy="7" r="1.8" fill="currentColor" />
                          <circle cx="2" cy="2" r="1.3" stroke="currentColor" strokeWidth="1.2" />
                          <circle cx="12" cy="2" r="1.3" stroke="currentColor" strokeWidth="1.2" />
                          <circle cx="2" cy="12" r="1.3" stroke="currentColor" strokeWidth="1.2" />
                          <circle cx="12" cy="12" r="1.3" stroke="currentColor" strokeWidth="1.2" />
                          <path d="M3.2 3.2L5.5 5.5M8.5 5.5L10.8 3.2M3.2 10.8L5.5 8.5M8.5 8.5L10.8 10.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                        </svg>
                      ),
                    },
                  ].map((item, i, arr) => (
                    <div key={i} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-black/20 bg-black/10 text-black">
                          {item.icon}
                        </div>
                        {i < arr.length - 1 && (
                          <div className="my-1.5 w-px flex-1 bg-black/25" style={{ minHeight: "20px" }} />
                        )}
                      </div>
                      <div className="pb-5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-black/50">
                          Step {i + 1}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-black/85">{item.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>

          {/* Benefit cards */}
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              {
                eyebrow: "Productivity",
                title: "8x faster every session",
                body: "8 ready-made prompts injected directly into NotebookLM. One click to get structured answers without rewriting anything from scratch.",
                stat: "8 prompts",
                statLabel: "ready to use",
                icon: (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M9 1.5L11.5 7H17L12.5 10.5L14.5 16L9 12.5L3.5 16L5.5 10.5L1 7H6.5L9 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                ),
              },
              {
                eyebrow: "Precision",
                title: "Richer, more organized results",
                body: "Capture insights from any AI and save by notebook automatically. Never lose an important finding between sessions.",
                stat: "100%",
                statLabel: "of answers saved",
                icon: (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M3 9.5l4 4L15 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ),
              },
              {
                eyebrow: "Learning",
                title: "Knowledge that grows with you",
                body: "Linked notes, idea graph, and native Zettelkasten. Each session builds on the last — NotebookLM becomes your second memory.",
                stat: "∞",
                statLabel: "note connections",
                icon: (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5" />
                    <circle cx="3" cy="3" r="1.8" stroke="currentColor" strokeWidth="1.4" />
                    <circle cx="15" cy="3" r="1.8" stroke="currentColor" strokeWidth="1.4" />
                    <circle cx="3" cy="15" r="1.8" stroke="currentColor" strokeWidth="1.4" />
                    <circle cx="15" cy="15" r="1.8" stroke="currentColor" strokeWidth="1.4" />
                    <path d="M4.5 4.5L7 7M11 7l2.5-2.5M4.5 13.5L7 11M11 11l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                ),
              },
            ].map((card) => (
              <div
                key={card.title}
                className="relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/8 bg-white/3 p-6"
              >
                {/* Top row */}
                <div>
                  <div className="flex items-start justify-between">
                    <span className="text-[10px] uppercase tracking-[0.22em] text-white/35">{card.eyebrow}</span>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-(--accent)/25 bg-(--accent)/10 text-(--accent)">
                      {card.icon}
                    </div>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold leading-snug tracking-[-0.03em] text-white">
                    {card.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/50">{card.body}</p>
                </div>
                {/* Bottom stat */}
                <div className="mt-6 flex items-end justify-between border-t border-white/6 pt-4">
                  <div>
                    <p className="text-2xl font-bold tracking-tight text-(--accent)">{card.stat}</p>
                    <p className="mt-0.5 text-[11px] text-white/35">{card.statLabel}</p>
                  </div>
                  <span className="rounded-full border border-white/8 bg-white/4 px-2.5 py-1 text-[10px] text-white/30">
                    + NotebookLM
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

      </div>

      <FeaturesScrollSection />

      <PricingSection />

      <FAQSection />

      <CTASection />

      <LandingFooter />

    </main>
  )
}
