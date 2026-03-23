import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import minddockLogo from "../../../public/lp/logo/logo minddock sem fundo.png"

export const metadata: Metadata = {
  title: "Welcome to MindDock",
  description:
    "Start your MindDock setup in minutes: open NotebookLM, connect your context, and activate Focus Docks."
}

const onboardingSteps = [
  {
    title: "Open NotebookLM",
    description:
      "MindDock works inside NotebookLM, so this is the fastest way to start your first workflow.",
    href: "https://notebooklm.google.com",
    cta: "Go to NotebookLM"
  },
  {
    title: "Enable Focus Docks",
    description:
      "Create isolated dock contexts per topic to keep your sessions clean and easy to resume.",
    href: "https://minddocklm.digital/#features",
    cta: "View Focus Docks"
  },
  {
    title: "Try Prompt Library",
    description:
      "Use ready-to-use prompts to save time and get stronger outputs with less rewriting.",
    href: "https://minddocklm.digital/#pricing",
    cta: "Explore plans"
  }
]

export default function WelcomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--page)] text-[var(--ink)]">
      <div className="site-background" aria-hidden="true" />

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(250,204,21,0.15),rgba(250,204,21,0)_30%),radial-gradient(circle_at_85%_6%,rgba(255,255,255,0.12),rgba(255,255,255,0)_24%)]" />

      <div className="relative z-[1] mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-10 lg:px-14">
        <header className="mx-auto flex w-full max-w-5xl items-center justify-between rounded-full border border-white/10 bg-black/40 px-4 py-3 backdrop-blur-md sm:px-5">
          <Image src={minddockLogo} alt="MindDock" className="h-10 w-auto object-contain" priority />
          <Link
            href="https://minddocklm.digital"
            className="inline-flex items-center rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-medium text-white/85 transition hover:border-white/25 hover:bg-white/[0.08]">
            Go to site
          </Link>
        </header>

        <section className="mx-auto mt-8 flex w-full max-w-5xl flex-1 items-center">
          <div className="w-full rounded-[2rem] border border-white/10 bg-black/65 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#facc15]/35 bg-[#facc15]/15 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#fde68a]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#facc15]" />
              Welcome
            </div>

            <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-tight tracking-[-0.04em] text-white sm:text-5xl">
              Welcome to MindDock.
              <span className="block text-white/75">Your NotebookLM superworkspace is ready.</span>
            </h1>

            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/62 sm:text-base">
              You can start in less than 2 minutes. Follow the quick steps below to activate your
              workflow and keep your research organized from day one.
            </p>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {onboardingSteps.map((step, index) => (
                <article
                  key={step.title}
                  className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#facc15]/50 bg-[#facc15]/12 text-sm font-semibold text-[#fde68a]">
                    {index + 1}
                  </div>
                  <h2 className="text-base font-semibold tracking-[-0.02em] text-white">{step.title}</h2>
                  <p className="mt-2 flex-1 text-xs leading-6 text-white/58">{step.description}</p>
                  <Link
                    href={step.href}
                    className="mt-4 inline-flex items-center justify-center rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-xs font-medium text-white transition hover:border-white/22 hover:bg-white/[0.08]">
                    {step.cta}
                  </Link>
                </article>
              ))}
            </div>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link href="https://notebooklm.google.com" className="cta-primary">
                Start now
              </Link>
              <Link href="https://minddocklm.digital/#pricing" className="cta-secondary">
                View pricing
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
