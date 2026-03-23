'use client';

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

const Beams = dynamic(() => import('./Beams'), { ssr: false });

const Y = '#facc15';
const Yi = 'rgba(250,204,21,0.08)';
const Yb = 'rgba(250,204,21,0.15)';

const features = [
  {
    eyebrow: 'Agile Prompts',
    title: 'AI that reads your prompt and makes it sharper',
    body: "MindDock's AI analyzes your request, identifies what's vague or missing, and rewrites it to extract deeper, more precise answers from NotebookLM — automatically, before you even hit send.",
    stat: 'AI',
    statLabel: 'powered refinement',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path d="M14 3L17.5 11H26L19.5 16L22 24L14 19L6 24L8.5 16L2 11H10.5L14 3Z"
          stroke={Y} strokeWidth="1.8" strokeLinejoin="round" fill={Yi} />
      </svg>
    ),
    visual: (
      <div className="flex flex-col gap-3">
        <div className="rounded-xl border border-white/8 bg-white/4 px-3 py-2.5">
          <p className="mb-1 text-[9px] uppercase tracking-widest text-white/25">Your prompt</p>
          <p className="text-xs leading-5 text-white/45">Summarize this topic</p>
        </div>
        <div className="flex justify-center">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2v10M7 12l-3-3M7 12l3-3" stroke={Y} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="rounded-xl px-3 py-2.5" style={{ border: `1px solid ${Yb}`, background: Yi }}>
          <p className="mb-1 text-[9px] uppercase tracking-widest text-yellow-400/50">Improved</p>
          <p className="text-xs leading-5 text-white/70">Analyze the key arguments, identify gaps, and structure a synthesis with contrasting viewpoints</p>
        </div>
      </div>
    ),
  },
  {
    eyebrow: 'Focus Docks',
    title: 'One notebook, multiple isolated contexts',
    body: 'Split any notebook into themed Docks. Each Dock keeps its own history, sources, and reasoning — no noise, no mixed context.',
    stat: '∞',
    statLabel: 'Docks per notebook',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect x="3" y="3" width="10" height="10" rx="3" stroke={Y} strokeWidth="1.8" fill={Yi} />
        <rect x="15" y="3" width="10" height="10" rx="3" stroke={Y} strokeWidth="1.8" fill={Yi} />
        <rect x="3" y="15" width="10" height="10" rx="3" stroke={Y} strokeWidth="1.8" fill={Yi} />
        <rect x="15" y="15" width="10" height="10" rx="3" stroke={Y} strokeWidth="1.8" fill={Yi} />
      </svg>
    ),
    visual: (
      <div className="grid grid-cols-2 gap-2">
        {['Market', 'Competitors', 'Strategy', 'Report'].map((d, i) => (
          <div key={i} className="rounded-xl p-3" style={{ border: `1px solid ${Yb}`, background: Yi }}>
            <div className="mb-2 h-1.5 w-1.5 rounded-full bg-yellow-400/60" />
            <span className="text-sm text-white/55">{d}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    eyebrow: 'Brain Merge',
    title: 'Merge multiple notebooks into one final AI synthesis',
    body: 'Select sources from different notebooks and generate one structured document that connects insights, removes duplication, and delivers a final answer.',
    stat: '5/mo',
    statLabel: 'Thinker Annual quota',
    availability: 'Thinker Annual',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path d="M7 8h6v4H7zM15 8h6v4h-6zM11 16h6v4h-6z" stroke={Y} strokeWidth="1.6" fill={Yi} />
        <path d="M10 12v2m8-2v2m-4 2v-2" stroke={Y} strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
    visual: (
      <div className="flex flex-col gap-2">
        {['Notebook A', 'Notebook B', 'Notebook C'].map((label, i) => (
          <div key={label} className="rounded-xl px-3 py-2 text-sm text-white/55" style={{ border: `1px solid ${Yb}`, background: Yi, opacity: 1 - i * 0.16 }}>
            {label}
          </div>
        ))}
        <div className="flex justify-center pt-1">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2v10M7 12l-3-3M7 12l3-3" stroke={Y} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="rounded-xl px-3 py-2 text-sm text-white/70" style={{ border: `1px solid ${Yb}`, background: Yi }}>
          Unified synthesis output
        </div>
      </div>
    ),
  },
  {
    eyebrow: 'Sniper Video Import',
    title: 'Capture YouTube clips and import the transcript',
    body: 'Pick a time range from a video and import the transcript straight into NotebookLM, ready to be summarized, quoted, and linked in your research flow.',
    stat: 'YT',
    statLabel: 'targeted capture',
    availability: 'Thinker (Monthly + Annual)',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect x="4" y="7" width="20" height="14" rx="4" stroke={Y} strokeWidth="1.8" fill={Yi} />
        <path d="M12 11l6 3-6 3v-6z" stroke={Y} strokeWidth="1.4" strokeLinejoin="round" fill="rgba(250,204,21,0.24)" />
      </svg>
    ),
    visual: (
      <div className="flex flex-col gap-2">
        <div className="rounded-xl px-3 py-2 text-[11px] text-white/55" style={{ border: `1px solid ${Yb}`, background: Yi }}>
          02:29 → 05:42
        </div>
        <div className="h-1.5 rounded-full bg-white/10">
          <div className="h-full w-2/5 rounded-full bg-yellow-400/70" />
        </div>
        <div className="rounded-xl px-3 py-2 text-xs text-white/60" style={{ border: `1px solid ${Yb}`, background: Yi }}>
          Transcript imported to NotebookLM
        </div>
      </div>
    ),
  },
  {
    eyebrow: 'AI Capture',
    title: 'Capture any response from any AI',
    body: 'ChatGPT, Claude, Gemini, Perplexity — MindDock captures and automatically imports the best of each conversation directly into your NotebookLM notebook.',
    stat: '5+',
    statLabel: 'AIs supported',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <circle cx="14" cy="14" r="5" stroke={Y} strokeWidth="1.8" fill={Yi} />
        <circle cx="4" cy="4" r="2.5" stroke={Y} strokeWidth="1.4" fill={Yi} />
        <circle cx="24" cy="4" r="2.5" stroke={Y} strokeWidth="1.4" fill={Yi} />
        <circle cx="4" cy="24" r="2.5" stroke={Y} strokeWidth="1.4" fill={Yi} />
        <circle cx="24" cy="24" r="2.5" stroke={Y} strokeWidth="1.4" fill={Yi} />
        <path d="M6 6L10 10M18 10L22 6M6 22L10 18M18 18L22 22" stroke={Y} strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
    visual: (
      <div className="flex flex-col gap-2">
        {['ChatGPT', 'Claude', 'Gemini', 'Perplexity'].map((ai, i) => (
          <div key={i} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ border: `1px solid ${Yb}`, background: Yi }}>
            <span className="text-sm text-white/55">{ai}</span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6h8M7 4l3 2-3 2" stroke={Y} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        ))}
      </div>
    ),
  },
  {
    eyebrow: 'Smart Export',
    title: 'Export everything in the formats you need',
    body: 'Markdown, TXT, JSON, PDF, or full ZIP. Export your NotebookLM sources and notes with one click and take your knowledge to any platform.',
    stat: '5',
    statLabel: 'export formats',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path d="M14 4v14M14 18l-5-5M14 18l5-5" stroke={Y} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 22v2a2 2 0 002 2h16a2 2 0 002-2v-2" stroke={Y} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
    visual: (
      <div className="flex flex-wrap gap-2">
        {['MD', 'TXT', 'JSON', 'PDF', 'ZIP'].map((fmt, i) => (
          <div key={i} className="rounded-lg px-3 py-2 text-sm font-mono font-semibold text-yellow-300/80"
            style={{ border: `1px solid ${Yb}`, background: Yi }}>
            .{fmt}
          </div>
        ))}
      </div>
    ),
  },
];

export default function FeaturesScrollSection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const cardsAreaRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<(HTMLDivElement | null)[]>([]);
  const [isSectionVisible, setIsSectionVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const numCards = features.length;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        setIsSectionVisible(entries[0]?.isIntersecting ?? false);
      },
      { rootMargin: '180% 0px 180% 0px' }
    );

    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    let sectionDocTop = 0;
    let sectionHeight = 0;
    let cardsAreaHeight = 0;
    let viewportHeight = window.innerHeight;
    let active = true;
    let rafId: number | null = null;
    let current = window.scrollY;
    let target = window.scrollY;

    const recalcMetrics = () => {
      sectionDocTop = section.getBoundingClientRect().top + window.scrollY;
      sectionHeight = section.offsetHeight;
      cardsAreaHeight = cardsAreaRef.current?.offsetHeight ?? window.innerHeight * 0.55;
      viewportHeight = window.innerHeight;
    };

    const updateCards = (scrollY: number) => {
      const scrolled = Math.max(0, scrollY - sectionDocTop);
      const totalScroll = Math.max(1, sectionHeight - viewportHeight);
      const perCard = totalScroll / numCards;

      cardsRef.current.forEach((card, i) => {
        if (!card) return;

        const p = Math.max(0, Math.min(1, (scrolled - i * perCard) / (perCard * 0.72)));

        let depth = 0;
        for (let j = i + 1; j < numCards; j++) {
          depth += Math.max(0, Math.min(1, (scrolled - j * perCard) / (perCard * 0.72)));
        }

        const eased = p < 1 ? 1 - Math.pow(1 - p, 3) : 1;

        const from = cardsAreaHeight + 60;
        const to = -(depth * 28);
        const y = from + (to - from) * eased;

        const scale = Math.max(0.82, 1 - depth * 0.045);
        const brightness = Math.max(0.55, 1 - depth * 0.15);

        card.style.transform = `translateY(${y}px) scale(${scale})`;
        card.style.filter = depth > 0.1 ? `brightness(${brightness})` : '';
        card.style.opacity = p > 0.04 ? '1' : '0';
        card.style.zIndex = String(i + 10);
      });
    };

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const stopRaf = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const loop = () => {
      if (!active) {
        stopRaf();
        return;
      }
      current = lerp(current, target, 0.1);
      updateCards(current);

      if (Math.abs(current - target) <= 0.5) {
        current = target;
        updateCards(current);
        stopRaf();
        return;
      }

      rafId = requestAnimationFrame(loop);
    };

    const requestLoop = () => {
      if (rafId === null) {
        rafId = requestAnimationFrame(loop);
      }
    };

    const onScroll = () => {
      target = window.scrollY;
      if (reduceMotion) {
        updateCards(target);
        return;
      }
      if (active) requestLoop();
    };

    const onResize = () => {
      recalcMetrics();
      target = window.scrollY;
      current = target;
      updateCards(target);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        active = entries[0]?.isIntersecting ?? false;
        if (!active) {
          stopRaf();
          return;
        }
        target = window.scrollY;
        current = target;
        updateCards(target);
        if (!reduceMotion) requestLoop();
      },
      { rootMargin: '180% 0px 180% 0px' }
    );
    observer.observe(section);

    recalcMetrics();
    updateCards(window.scrollY);
    if (!reduceMotion && active) requestLoop();

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });

    return () => {
      stopRaf();
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [numCards, reduceMotion]);

  return (
    <section
      ref={sectionRef}
      className="relative"
      style={{ height: `calc(100vh * ${numCards + 1})` }}
    >
      <div className="sticky top-0 flex h-auto flex-col items-center justify-center overflow-hidden gap-4 py-8 sm:gap-6 sm:py-14 border-t border-b border-white/60">

        {/* Beams background */}
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }}>
          {isSectionVisible && !reduceMotion ? (
            <Beams
              beamWidth={2}
              beamHeight={20}
              beamNumber={14}
              lightColor="#ffffff"
              speed={2}
              noiseIntensity={1.75}
              scale={0.2}
              rotation={30}
              active={isSectionVisible}
            />
          ) : (
            <div className="h-full w-full bg-black/90" />
          )}
        </div>

        {/* Heading */}
        <div className="relative w-full shrink-0 text-center" style={{ zIndex: 1 }}>
          <p className="text-[11px] uppercase tracking-[0.24em] text-white/35">Features</p>
          <h2 className="mx-auto mt-3 max-w-3xl text-2xl font-semibold tracking-[-0.05em] text-white sm:text-4xl lg:text-5xl">
            Everything NotebookLM is missing,
            <br className="hidden sm:block" /> MindDock adds.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-white/40">
            Every feature was designed to supercharge NotebookLM — not replace it.
          </p>
        </div>

        {/* Cards stack */}
        <div
          ref={cardsAreaRef}
          className="relative mx-auto w-full max-w-5xl shrink-0 overflow-hidden px-6"
          style={{ height: 'clamp(320px, 52vh, 420px)', zIndex: 1 }}
        >
          {features.map((feature, i) => (
            <div
              key={i}
              ref={(el) => { cardsRef.current[i] = el; }}
              className="absolute inset-0 px-6"
              style={{
                opacity: 0,
                zIndex: i + 10,
                willChange: 'transform, opacity, filter',
              }}
            >
              <div className="relative overflow-hidden rounded-3xl border border-white/8 bg-[#0d0d10]">
                {/* Yellow glow */}
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{ background: `radial-gradient(ellipse at top right, rgba(250,204,21,0.12), transparent 55%)` }}
                />

                <div className="relative flex flex-col justify-between gap-4 p-5 sm:gap-5 sm:p-7 lg:flex-row lg:items-center">
                  {/* Left: text */}
                  <div className="flex-1 space-y-3 sm:space-y-5">
                    <div className="flex items-center gap-3">
                      {feature.icon}
                      <span className="text-[10px] uppercase tracking-[0.22em] text-white/35">
                        {feature.eyebrow}
                      </span>
                    </div>
                    <h3 className="text-xl font-semibold leading-snug tracking-[-0.04em] text-white sm:text-2xl lg:text-3xl">
                      {feature.title}
                    </h3>
                    <p className="max-w-md text-xs leading-6 text-white/50 sm:text-sm sm:leading-7">{feature.body}</p>
                    <div className="flex items-center gap-5 pt-1">
                      <div>
                        <p className="text-2xl font-bold tracking-tight text-yellow-400 sm:text-3xl">
                          {feature.stat}
                        </p>
                        <p className="mt-0.5 text-[11px] text-white/30">{feature.statLabel}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/8 bg-white/4 px-3 py-1.5 text-[10px] text-white/35">
                          + NotebookLM
                        </span>
                        {feature.availability ? (
                          <span className="rounded-full border border-yellow-400/25 bg-yellow-400/10 px-3 py-1.5 text-[10px] text-yellow-300/80">
                            {feature.availability}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* Right: visual panel — hidden on small mobile to save space */}
                  <div className="hidden w-full shrink-0 rounded-2xl border border-white/6 bg-white/2 p-5 sm:block lg:w-64">
                    {feature.visual}
                  </div>
                </div>

                {/* Card index indicator */}
                <div className="absolute bottom-5 right-6 flex gap-1.5">
                  {features.map((_, j) => (
                    <div
                      key={j}
                      className="h-1 rounded-full transition-all"
                      style={{
                        width: j === i ? '20px' : '6px',
                        background: j === i ? Y : 'rgba(255,255,255,0.15)',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
