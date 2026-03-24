"use client"

import { useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"

const Sparkles = dynamic(
  () => import("@/components/ui/sparkles").then((mod) => mod.Sparkles),
  { ssr: false }
)

export default function CTASection() {
  const sectionRef = useRef<HTMLElement>(null)
  const [effectsEnabled, setEffectsEnabled] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReduceMotion(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  useEffect(() => {
    const section = sectionRef.current
    if (!section || typeof IntersectionObserver === "undefined") {
      setEffectsEnabled(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => setEffectsEnabled(entries[0]?.isIntersecting ?? false),
      { rootMargin: "120% 0px 120% 0px" }
    )

    observer.observe(section)
    return () => observer.disconnect()
  }, [])

  return (
    <section ref={sectionRef} className="relative overflow-hidden bg-[#050608] py-20 sm:py-32">
      {/* Sparkles layer */}
      <div className="pointer-events-none absolute inset-0">
        {effectsEnabled && !reduceMotion ? (
          <Sparkles
            className="h-full w-full"
            density={320}
            size={0.9}
            minSize={0.3}
            speed={0.6}
            opacity={0.55}
            minOpacity={0.08}
            color="#facc15"
            background="transparent"
          />
        ) : null}
      </div>

      {/* Glow orb */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(ellipse, rgba(250,204,21,0.11) 0%, rgba(250,204,21,0.03) 50%, transparent 70%)"
        }}
      />

      {/* Content */}
      <div className="relative mx-auto flex max-w-4xl flex-col items-center px-6 text-center sm:px-10">
        <p className="mb-6 text-[10px] uppercase tracking-[0.3em] text-white/28">
          Start free today
        </p>

        <h2 className="text-[clamp(2.4rem,5.5vw,4.5rem)] font-semibold leading-[1.02] tracking-[-0.05em] text-white">
          Your notes deserve<br />
          <span style={{ color: "#facc15" }}>better than a chat log.</span>
        </h2>

        <p className="mx-auto mt-7 max-w-md text-sm leading-7 text-white/40">
          Install MindDock and turn NotebookLM into a research system that actually grows with you.
        </p>

        <a
          href="https://chromewebstore.google.com/detail/minddock/your-extension-id"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-10 inline-flex items-center gap-2.5 rounded-full px-7 py-4 text-sm font-semibold transition-opacity hover:opacity-88"
          style={{ background: "#ffffff", color: "#000000" }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
            <path d="M12 2a10 10 0 0 1 8.66 5H12Z" fill="#EA4335" />
            <path d="M3.34 7A10 10 0 0 0 7.5 21.33L12 13Z" fill="#34A853" />
            <path d="M12 22a10 10 0 0 0 8.66-15H12l-4.5 7.33Z" fill="#FBBC05" />
            <circle cx="12" cy="12" r="5" fill="#fff" />
            <circle cx="12" cy="12" r="3.5" fill="#4285F4" />
          </svg>
          Add to Chrome — it's free
        </a>

        <p className="mt-5 text-[11px] text-white/22">
          No account required &nbsp;·&nbsp; Chrome extension &nbsp;·&nbsp; Free plan forever
        </p>
      </div>
    </section>
  )
}
