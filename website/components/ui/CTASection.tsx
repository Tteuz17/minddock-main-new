"use client"

import { useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import WaitlistForm from "@/components/ui/WaitlistForm"

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

        <div className="mt-10 flex w-full flex-col items-center gap-2">
          <WaitlistForm />
        </div>
      </div>
    </section>
  )
}
