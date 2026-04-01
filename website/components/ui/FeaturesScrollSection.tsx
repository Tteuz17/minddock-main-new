'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

const Beams = dynamic(() => import('./Beams'), { ssr: false });

const features = [
  {
    eyebrow: 'Agile Prompts',
    title: 'AI that reads your prompt and makes it sharper.',
    body: "MindDock analyzes your request, identifies what's vague or missing, and rewrites it to extract deeper, more precise answers — automatically, before you even hit send.",
    tag: '+ NotebookLM',
    visual: (
      <div className="flex flex-col gap-2.5">
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
          <p className="mb-2 text-[9px] uppercase tracking-[0.18em] text-white/25">Original</p>
          <p className="text-[13px] leading-5 text-white/40">Summarize this topic</p>
        </div>
        <div className="flex items-center gap-2 px-1">
          <div className="h-px flex-1 bg-white/[0.07]" />
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0">
            <path d="M6 2v8M3.5 7.5L6 10l2.5-2.5" stroke="rgba(255,255,255,0.25)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="h-px flex-1 bg-white/[0.07]" />
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3">
          <p className="mb-2 text-[9px] uppercase tracking-[0.18em] text-white/35">Refined</p>
          <p className="text-[13px] leading-5 text-white/65">Analyze the key arguments, identify gaps, and structure a synthesis with contrasting viewpoints.</p>
        </div>
      </div>
    ),
  },
  {
    eyebrow: 'Focus Docks',
    title: 'One notebook, multiple isolated contexts.',
    body: 'Split any notebook into themed Docks. Each Dock keeps its own history, sources, and reasoning — no noise, no mixed context.',
    tag: '+ NotebookLM',
    visual: (
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'Market', active: true },
          { label: 'Competitors', active: false },
          { label: 'Strategy', active: false },
          { label: 'Report', active: false },
        ].map((d) => (
          <div
            key={d.label}
            className="rounded-xl border px-3 py-3 transition-all"
            style={{
              borderColor: d.active ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)',
              background: d.active ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.02)',
            }}
          >
            <div className="mb-2.5 flex items-center gap-1.5">
              <div
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: d.active ? '#fff' : 'rgba(255,255,255,0.2)' }}
              />
            </div>
            <span
              className="text-[13px]"
              style={{ color: d.active ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.3)' }}
            >
              {d.label}
            </span>
          </div>
        ))}
      </div>
    ),
  },
  {
    eyebrow: 'Brain Merge',
    title: 'Merge multiple notebooks into one synthesis.',
    body: 'Select sources from different notebooks and generate one structured document that connects insights, removes duplication, and delivers a final answer.',
    tag: 'Thinker Annual',
    visual: (
      <div className="flex flex-col gap-2">
        {[
          { label: 'Research · 12 sources', opacity: 'rgba(255,255,255,0.55)' },
          { label: 'Interviews · 8 sources', opacity: 'rgba(255,255,255,0.38)' },
          { label: 'Insights · 5 sources', opacity: 'rgba(255,255,255,0.24)' },
        ].map((item) => (
          <div
            key={item.label}
            className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-2.5"
          >
            <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/20" />
            <span className="text-[13px]" style={{ color: item.opacity }}>{item.label}</span>
          </div>
        ))}
        <div className="my-0.5 flex items-center gap-2 px-1">
          <div className="h-px flex-1 bg-white/[0.07]" />
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M3.5 7.5L6 10l2.5-2.5" stroke="rgba(255,255,255,0.25)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="h-px flex-1 bg-white/[0.07]" />
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5">
          <span className="text-[13px] text-white/65">Unified synthesis</span>
        </div>
      </div>
    ),
  },
  {
    eyebrow: 'Video Sniper',
    title: 'Capture the exact clip. Import only what matters.',
    body: 'Pick a time range from any YouTube video and send the transcript straight into NotebookLM — ready to be summarized, quoted, and linked in your research.',
    tag: 'Thinker',
    visual: (
      <div className="flex flex-col gap-3">
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] text-white/30">youtube.com/watch…</span>
            <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/40">HD</span>
          </div>
          <div className="relative h-1 w-full rounded-full bg-white/[0.08]">
            <div className="absolute left-[28%] h-full w-[32%] rounded-full bg-white/30" />
            <div className="absolute left-[28%] top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-white/60" />
            <div className="absolute left-[60%] top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-white/60" />
          </div>
          <div className="mt-2.5 flex justify-between text-[11px] text-white/25">
            <span>02:29</span>
            <span>05:42</span>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5">
          <span className="text-[13px] text-white/55">Transcript sent to NotebookLM</span>
        </div>
      </div>
    ),
  },
  {
    eyebrow: 'AI Capture',
    title: 'Capture any response from any AI.',
    body: 'ChatGPT, Claude, Gemini, Perplexity — MindDock captures and imports the best of each conversation directly into your NotebookLM notebook.',
    tag: '+ NotebookLM',
    visual: (
      <div className="flex flex-col gap-2">
        {[
          { name: 'ChatGPT', hint: 'openai.com' },
          { name: 'Claude', hint: 'claude.ai' },
          { name: 'Gemini', hint: 'gemini.google.com' },
          { name: 'Perplexity', hint: 'perplexity.ai' },
        ].map((ai) => (
          <div
            key={ai.name}
            className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-2.5"
          >
            <div>
              <p className="text-[13px] text-white/60">{ai.name}</p>
              <p className="text-[10px] text-white/22">{ai.hint}</p>
            </div>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2.5 7h9M8.5 4.5L11 7l-2.5 2.5" stroke="rgba(255,255,255,0.25)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        ))}
      </div>
    ),
  },
  {
    eyebrow: 'Smart Export',
    title: 'Export everything in the formats you need.',
    body: 'Markdown, TXT, JSON, PDF, or full ZIP. Export your NotebookLM sources and notes with one click and take your knowledge to any platform.',
    tag: '+ NotebookLM',
    visual: (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2">
          {['Markdown', 'Plain text', 'JSON', 'PDF', 'ZIP'].map((fmt, i) => (
            <div
              key={fmt}
              className="flex flex-col items-start rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5"
              style={{ opacity: i === 0 ? 1 : 0.6 + i * 0.08 }}
            >
              <span className="mb-1 font-mono text-[10px] text-white/30">.{['md','txt','json','pdf','zip'][i]}</span>
              <span className="text-[12px] text-white/50">{fmt}</span>
            </div>
          ))}
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.07] px-3 py-2.5">
            <span className="text-[11px] text-white/20">more</span>
          </div>
        </div>
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
  const [isMobile, setIsMobile] = useState(false);
  const [activeCard, setActiveCard] = useState(0);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const autoAdvanceRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const numCards = features.length;

  // Reduce motion
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  // Mobile detection
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check, { passive: true });
    return () => window.removeEventListener('resize', check);
  }, []);

  // Beams visibility
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => { setIsSectionVisible(entries[0]?.isIntersecting ?? false); },
      { rootMargin: '180% 0px 180% 0px' }
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  // Auto-advance reset helper
  const resetAutoAdvance = useCallback(() => {
    if (autoAdvanceRef.current) clearInterval(autoAdvanceRef.current);
    autoAdvanceRef.current = setInterval(
      () => setActiveCard((prev) => (prev + 1) % numCards),
      4000
    );
  }, [numCards]);

  // Mobile auto-advance
  useEffect(() => {
    if (!isMobile) return;
    resetAutoAdvance();
    return () => {
      if (autoAdvanceRef.current) clearInterval(autoAdvanceRef.current);
    };
  }, [isMobile, resetAutoAdvance]);

  // Desktop scroll animation
  useEffect(() => {
    if (isMobile) return;
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
      if (!active) { stopRaf(); return; }
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
      if (rafId === null) rafId = requestAnimationFrame(loop);
    };

    const onScroll = () => {
      target = window.scrollY;
      if (reduceMotion) { updateCards(target); return; }
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
        if (!active) { stopRaf(); return; }
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
  }, [numCards, reduceMotion, isMobile]);

  // Touch handlers for mobile swipe
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.changedTouches[0].clientX;
    touchStartY.current = e.changedTouches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = touchStartX.current - e.changedTouches[0].clientX;
    const dy = touchStartY.current - e.changedTouches[0].clientY;
    // Only handle horizontal swipes (not vertical scroll)
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    const next = dx > 0
      ? (activeCard + 1) % numCards
      : (activeCard - 1 + numCards) % numCards;
    setActiveCard(next);
    resetAutoAdvance();
  };

  const goToCard = (index: number) => {
    setActiveCard(index);
    resetAutoAdvance();
  };

  // ─── MOBILE RENDER ────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <section className="relative overflow-hidden border-t border-b border-white/60">
        {/* Background */}
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }}>
          {!reduceMotion ? (
            <Beams
              beamWidth={2}
              beamHeight={20}
              beamNumber={8}
              lightColor="#ffffff"
              speed={2}
              noiseIntensity={1.75}
              scale={0.2}
              rotation={30}
              active={true}
            />
          ) : (
            <div className="h-full w-full bg-black/90" />
          )}
        </div>

        <div className="relative flex flex-col gap-6 px-4 py-10" style={{ zIndex: 1 }}>
          {/* Heading */}
          <div className="text-center">
            <p className="text-[11px] uppercase tracking-[0.24em] text-white/35">Features</p>
            <h2 className="mx-auto mt-3 text-2xl font-semibold tracking-[-0.05em] text-white">
              Everything NotebookLM is missing,{' '}
              <span className="whitespace-nowrap">MindDock adds.</span>
            </h2>
            <p className="mx-auto mt-3 text-sm leading-7 text-white/40">
              Every feature was designed to supercharge NotebookLM — not replace it.
            </p>
          </div>

          {/* Carousel container */}
          <div
            className="relative"
            style={{ minHeight: 480 }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {features.map((feature, i) => (
              <div
                key={i}
                className="absolute inset-0"
                style={{
                  opacity: i === activeCard ? 1 : 0,
                  transform: i === activeCard
                    ? 'translateX(0) scale(1)'
                    : i < activeCard
                      ? 'translateX(-16px) scale(0.97)'
                      : 'translateX(16px) scale(0.97)',
                  transition: reduceMotion
                    ? 'none'
                    : 'opacity 350ms ease, transform 350ms ease',
                  pointerEvents: i === activeCard ? 'auto' : 'none',
                  willChange: 'opacity, transform',
                }}
              >
                <div className="overflow-hidden rounded-3xl border border-white/[0.07] bg-[#0c0c0f]">
                  <div className="flex flex-col gap-5 p-5">
                    {/* Text */}
                    <div className="flex flex-col gap-3">
                      <span className="text-[10px] uppercase tracking-[0.22em] text-white/28">
                        {feature.eyebrow}
                      </span>
                      <h3 className="text-xl font-semibold leading-snug tracking-[-0.04em] text-white">
                        {feature.title}
                      </h3>
                      <p className="text-sm leading-7 text-white/40">{feature.body}</p>
                      <div className="pt-1">
                        <span className="rounded-full border border-white/9 bg-white/4 px-3 py-1.5 text-[11px] text-white/30">
                          {feature.tag}
                        </span>
                      </div>
                    </div>
                    {/* Visual */}
                    <div className="w-full">{feature.visual}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Dots */}
          <div className="flex justify-center items-center gap-3 pt-1">
            {features.map((_, j) => (
              <button
                key={j}
                onClick={() => goToCard(j)}
                aria-label={`Go to feature ${j + 1}: ${features[j].eyebrow}`}
                style={{
                  padding: '10px 4px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <span
                  className="block rounded-full transition-all duration-300"
                  style={{
                    height: '3px',
                    width: j === activeCard ? '18px' : '5px',
                    background: j === activeCard
                      ? 'rgba(255,255,255,0.5)'
                      : 'rgba(255,255,255,0.12)',
                  }}
                />
              </button>
            ))}
          </div>
        </div>
      </section>
    );
  }

  // ─── DESKTOP RENDER ───────────────────────────────────────────────────────
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
              <div className="relative overflow-hidden rounded-3xl border border-white/[0.07] bg-[#0c0c0f]">
                <div className="relative flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-start lg:gap-10">
                  {/* Left: text */}
                  <div className="flex flex-1 flex-col gap-4">
                    <span className="text-[10px] uppercase tracking-[0.22em] text-white/28">
                      {feature.eyebrow}
                    </span>
                    <h3 className="text-xl font-semibold leading-snug tracking-[-0.04em] text-white sm:text-2xl lg:text-[1.65rem]">
                      {feature.title}
                    </h3>
                    <p className="max-w-sm text-sm leading-7 text-white/40">{feature.body}</p>
                    <div className="mt-auto pt-2">
                      <span className="rounded-full border border-white/9 bg-white/4 px-3 py-1.5 text-[11px] text-white/30">
                        {feature.tag}
                      </span>
                    </div>
                  </div>

                  {/* Right: visual panel */}
                  <div className="w-full shrink-0 lg:w-60">
                    {feature.visual}
                  </div>
                </div>

                {/* Progress dots */}
                <div className="absolute bottom-5 right-6 flex gap-1.5">
                  {features.map((_, j) => (
                    <div
                      key={j}
                      className="h-[3px] rounded-full transition-all duration-300"
                      style={{
                        width: j === i ? '18px' : '5px',
                        background: j === i ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.12)',
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