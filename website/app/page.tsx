import Image from "next/image"
import { CardDemo } from "@/components/ui/card-demo"
import { InfiniteRibbon } from "@/components/ui/infinite-ribbon"
import heroBackground from "../../public/lp/backgroundhero.png"
import minddockLogo from "../../public/lp/logo/logo minddock sem fundo.png"

const agilePromptVideoSrc = "/api/lp/agile-prompts"
const docksVideoSrc = "/api/lp/docks"

const pillars = [
  {
    eyebrow: "Structure first",
    title: "Turn NotebookLM into an actual research system.",
    body:
      "MindDock adds the layer NotebookLM is missing: persistent threads, atomic notes, linked ideas, and a graph that exposes how your thinking connects."
  },
  {
    eyebrow: "Built for depth",
    title: "Capture less noise. Keep only the signal.",
    body:
      "Instead of letting insight disappear inside long chats, MindDock helps convert useful responses into reusable knowledge that can be refined, linked, and revisited."
  }
]

const features = [
  {
    title: "Daily import control",
    text:
      "Track how much you are sending into NotebookLM and keep the workflow predictable for free users."
  },
  {
    title: "Threads",
    text:
      "Split one notebook into topic-specific conversations so each line of thought keeps its own context."
  },
  {
    title: "Zettelkasten mode",
    text:
      "Turn ideas into atomic notes with links that keep growing as your research gets sharper."
  },
  {
    title: "Graph view",
    text:
      "See the hidden structure of your notes and spot where new insight is emerging."
  }
]

const workflow = [
  {
    step: "01",
    title: "Capture",
    text: "Move source material into NotebookLM faster, without losing control of what enters your workspace."
  },
  {
    step: "02",
    title: "Distill",
    text: "Convert useful answers into durable notes, not disposable chat history."
  },
  {
    step: "03",
    title: "Connect",
    text: "Link threads, notes, and themes into a system that compounds over time."
  }
]

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
              <a className="nav-chip" href="#workflow">
                Workflow
              </a>
              <a className="nav-chip" href="#cta">
                Launch
              </a>
            </nav>
          </header>

          <section className="relative flex flex-1 flex-col justify-center py-10 lg:py-12">
            <div className="relative z-[1] mx-auto flex w-full max-w-4xl flex-col items-center space-y-9 text-center">
              <div className="space-y-5">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/[0.12] px-4 py-2 text-[10px] uppercase tracking-[0.24em] text-white/60 backdrop-blur-sm">
                  <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
                  Free trial
                </div>

                <div className="space-y-4">
                  <h1 className="mx-auto max-w-4xl text-[clamp(2.3rem,5.8vw,4.9rem)] font-normal leading-[0.94] tracking-[-0.06em] text-white [text-shadow:0_10px_28px_rgba(0,0,0,0.22)]">
                    <span className="block whitespace-nowrap text-[0.64em] font-normal tracking-[-0.045em]">
                      <span className="hero-serif text-[1.18em]">Knowledge work</span> is now
                    </span>
                    <span className="mt-2 block whitespace-nowrap text-[0.98em] font-normal tracking-[-0.06em]">
                      structured for NotebookLM.
                    </span>
                  </h1>
                  <p className="mx-auto max-w-3xl text-base leading-8 text-white/72 [text-shadow:0_6px_20px_rgba(0,0,0,0.18)] sm:text-lg">
                    MindDock gives NotebookLM the structure it is missing: durable notes, cleaner
                    threads, connected ideas, and a workflow that actually holds up during serious
                    study.
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
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
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
                <div className="flex h-full flex-col gap-5">
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

        <section className="pt-8">
          <div className="relative overflow-hidden rounded-4xl border border-white/8">
            <div className="grid divide-y divide-white/8 lg:grid-cols-2 lg:divide-x lg:divide-y-0">

              {/* Before */}
              <div className="p-8 sm:p-10">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/4 px-3 py-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-white/25" />
                  <span className="text-[10px] uppercase tracking-[0.2em] text-white/35">Without MindDock</span>
                </div>
                <p className="mt-6 text-[clamp(1.5rem,2.8vw,2.1rem)] font-semibold leading-tight tracking-[-0.04em] text-white/30 line-through decoration-white/15">
                  Research gets trapped in temporary conversations.
                </p>
                <ul className="mt-8 space-y-5">
                  {[
                    "Insights buried in scrollback",
                    "No structure survives a new chat",
                    "Sources pile up, recall goes down",
                    "Ideas vanish before they connect"
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-3 text-sm text-white/30">
                      <svg className="shrink-0" width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              {/* After */}
              <div className="relative overflow-hidden p-8 sm:p-10">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(234,179,8,0.07),transparent_65%)]" />
                <div className="relative">
                  <div className="inline-flex items-center gap-2 rounded-full border border-(--accent)/25 bg-(--accent)/8 px-3 py-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-(--accent)" />
                    <span className="text-[10px] uppercase tracking-[0.2em] text-(--accent)/80">With MindDock</span>
                  </div>
                  <p className="mt-6 text-[clamp(1.5rem,2.8vw,2.1rem)] font-semibold leading-tight tracking-[-0.04em] text-white">
                    Your knowledge compounds session after session.
                  </p>
                  <ul className="mt-8 space-y-5">
                    {[
                      "Notes persist and stay linked",
                      "Each dock keeps its own clean context",
                      "Everything is searchable, always",
                      "Ideas connect and build over time"
                    ].map((item) => (
                      <li key={item} className="flex items-center gap-3 text-sm text-white/70">
                        <svg className="shrink-0 text-(--accent)" width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path d="M2 7l3.5 3.5L12 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="pt-10">
          <div className="mx-auto mb-8 grid w-full max-w-5xl gap-5 md:grid-cols-2">
            {pillars.map((pillar) => (
              <article key={pillar.title} className="panel-flat">
                <p className="text-[11px] uppercase tracking-[0.22em] text-white/35">{pillar.eyebrow}</p>
                <h2 className="mt-4 text-2xl font-semibold tracking-[-0.04em] text-white">{pillar.title}</h2>
                <p className="mt-4 text-sm leading-7 text-white/58">{pillar.body}</p>
              </article>
            ))}
          </div>

          <div className="mx-auto w-full max-w-5xl">
            <section className="hero-shell">
              <div className="hero-dot-grid" aria-hidden="true" />

              <div className="flex items-center justify-between rounded-3xl border border-white/6 bg-black/30 px-4 py-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-white/35">Control panel</p>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">
                    Research, organized.
                  </p>
                </div>
                <span className="rounded-full border border-white/8 bg-white/[0.04] px-4 py-2 text-xs text-white/70">
                  Thinker Pro
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {features.map((feature) => (
                  <article key={feature.title} className="feature-card">
                    <div className="flex items-center justify-between">
                      <span className="grid h-11 w-11 place-items-center rounded-2xl border border-white/8 bg-white/[0.03] text-white/85">
                        +
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.24em] text-white/30">MindDock</span>
                    </div>
                    <h3 className="mt-7 text-xl font-semibold tracking-[-0.04em] text-white">{feature.title}</h3>
                    <p className="mt-3 text-sm leading-7 text-white/55">{feature.text}</p>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </section>

        <section
          id="features"
          className="grid gap-6 border-t border-white/8 py-10 lg:grid-cols-[0.9fr_1.1fr] lg:py-16">
          <div className="space-y-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-white/35">Why MindDock</p>
            <h2 className="max-w-xl text-4xl font-semibold tracking-[-0.05em] text-white">
              The missing operating system for serious study and research.
            </h2>
            <p className="max-w-lg text-sm leading-8 text-white/58">
              NotebookLM is powerful, but chat alone does not create a durable system. MindDock adds
              the layer that keeps your work structured, connected, and reusable.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="panel-flat">
              <p className="text-sm text-white/45">Problem</p>
              <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white">
                Good insights vanish inside temporary conversations.
              </p>
            </div>
            <div className="panel-flat">
              <p className="text-sm text-white/45">Answer</p>
              <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white">
                MindDock turns each useful answer into a persistent, navigable knowledge asset.
              </p>
            </div>
          </div>
        </section>

        <section
          id="workflow"
          className="rounded-[2rem] border border-white/8 bg-white/[0.02] px-6 py-8 backdrop-blur-sm sm:px-8 sm:py-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-white/35">Workflow</p>
              <h2 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-white">
                A cleaner path from source to insight.
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-7 text-white/55">
              Built for researchers, operators, creators, and anyone who needs more than scattered AI
              chat logs.
            </p>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {workflow.map((item) => (
              <article key={item.step} className="workflow-card">
                <p className="text-sm text-[var(--accent)]">{item.step}</p>
                <h3 className="mt-5 text-2xl font-semibold tracking-[-0.04em] text-white">{item.title}</h3>
                <p className="mt-4 text-sm leading-7 text-white/55">{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section
          id="cta"
          className="mt-10 rounded-[2.25rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.01))] px-6 py-10 sm:px-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-[11px] uppercase tracking-[0.24em] text-white/35">Launch with structure</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-white sm:text-5xl">
                If NotebookLM is where you think, MindDock is how you keep that thinking alive.
              </h2>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <a className="cta-primary" href="mailto:hello@minddock.ai">
                Contact the team
              </a>
              <a className="cta-secondary" href="https://github.com/Tteuz17/minddock-main-new">
                View the project
              </a>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
