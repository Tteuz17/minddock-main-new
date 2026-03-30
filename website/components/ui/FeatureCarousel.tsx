"use client"

import React from "react"

type Card = {
  eyebrow: string
  title: string
  body: string
  icon: React.ReactNode
}

export default function FeatureCarousel({ cards }: { cards: Card[] }) {
  const doubled = [...cards, ...cards]

  return (
    <div className="group -mx-6 overflow-hidden py-4 sm:-mx-10 lg:-mx-14">
      <div
        className="feature-marquee-track flex gap-4 group-hover:[animation-play-state:paused]"
        style={{ animation: "feature-marquee 38s linear infinite" }}
      >
        {doubled.map((card, i) => (
          <article
            key={i}
            aria-hidden={i >= cards.length}
            className="relative flex w-72 shrink-0 cursor-default flex-col justify-between rounded-2xl border border-white/[0.07] bg-[#0a0a0c] p-5 transition-all duration-300 ease-out hover:z-10 hover:scale-[1.06] hover:border-white/[0.15] hover:bg-[#0f0f12] hover:shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
            style={{ minHeight: "200px" }}
          >
            <div className="flex items-start justify-between">
              <span className="font-mono text-[10px] text-white/18">{String((i % cards.length) + 1).padStart(2, "0")}</span>
              <div className="text-white/28">{card.icon}</div>
            </div>
            <div className="mt-5">
              <p className="mb-1.5 text-[9px] uppercase tracking-[0.2em] text-white/25">{card.eyebrow}</p>
              <h3 className="text-[14px] font-semibold leading-snug tracking-[-0.03em] text-white">
                {card.title}
              </h3>
              <p className="mt-2 text-[12px] leading-5 text-white/35">{card.body}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
