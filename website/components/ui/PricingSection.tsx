"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Sparkles } from "@/components/ui/sparkles";
import { TimelineContent } from "@/components/ui/timeline-animation";
import { VerticalCutReveal } from "@/components/ui/vertical-cut-reveal";
import { cn } from "@/lib/utils";
import NumberFlow from "@number-flow/react";
import { motion } from "framer-motion";
import { useRef, useState } from "react";

const plans = [
  {
    name: "Free",
    description: "For those who want to try the power of MindDock with NotebookLM.",
    price: 0,
    yearlyPrice: 0,
    buttonText: "Get started free",
    buttonVariant: "outline" as const,
    includes: [
      "Included in Free:",
      "3 Agile Prompts",
      "MD and TXT export",
      "Basic AI Capture",
      "1 Focus Dock",
      "Community support",
    ],
  },
  {
    name: "Pro",
    description: "The best value for serious researchers and students.",
    price: 2.99,
    yearlyPrice: 24.99,
    buttonText: "Subscribe to Pro",
    buttonVariant: "default" as const,
    popular: true,
    includes: [
      "Everything in Free, plus:",
      "All 8 Agile Prompts",
      "AI Capture (5+ AIs)",
      "Smart Export (all formats)",
      "Unlimited Focus Docks",
      "Priority support",
    ],
  },
  {
    name: "Thinker",
    description: "For researchers who need the full knowledge system.",
    price: 7.99,
    yearlyPrice: 64.99,
    buttonText: "Subscribe to Thinker",
    buttonVariant: "outline" as const,
    includes: [
      "Everything in Pro, plus:",
      "Full Zettelkasten",
      "Interactive idea graph",
      "Wikilinks between notes",
      "Session history",
      "Advanced export",
    ],
  },
  {
    name: "Thinker Pro",
    description: "For those who take knowledge seriously and need everything.",
    price: 14.99,
    yearlyPrice: 119.99,
    buttonText: "Subscribe to Thinker Pro",
    buttonVariant: "outline" as const,
    includes: [
      "Everything in Thinker, plus:",
      "Custom AI prompts",
      "Early access to features",
      "Dedicated support",
      "Multi-workspace",
      "API access",
    ],
  },
];

const PricingSwitch = ({ onSwitch }: { onSwitch: (value: string) => void }) => {
  const [selected, setSelected] = useState("0");

  const handleSwitch = (value: string) => {
    setSelected(value);
    onSwitch(value);
  };

  return (
    <div className="flex justify-center">
      <div className="relative z-10 mx-auto flex w-fit rounded-full bg-neutral-900 border border-gray-700 p-1">
        <button
          onClick={() => handleSwitch("0")}
          className={cn(
            "relative z-10 w-fit h-10 rounded-full sm:px-6 px-3 sm:py-2 py-1 font-medium transition-colors",
            selected === "0" ? "text-black" : "text-gray-200",
          )}
        >
          {selected === "0" && (
            <motion.span
              layoutId="switch"
              className="absolute top-0 left-0 h-10 w-full rounded-full border-2 shadow-sm shadow-yellow-500 border-yellow-400 bg-gradient-to-t from-yellow-500 to-yellow-400"
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          )}
          <span className="relative">Monthly</span>
        </button>

        <button
          onClick={() => handleSwitch("1")}
          className={cn(
            "relative z-10 w-fit h-10 flex-shrink-0 rounded-full sm:px-6 px-3 sm:py-2 py-1 font-medium transition-colors",
            selected === "1" ? "text-black" : "text-gray-200",
          )}
        >
          {selected === "1" && (
            <motion.span
              layoutId="switch"
              className="absolute top-0 left-0 h-10 w-full rounded-full border-2 shadow-sm shadow-yellow-500 border-yellow-400 bg-gradient-to-t from-yellow-500 to-yellow-400"
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          )}
          <span className="relative flex items-center gap-2">Yearly</span>
        </button>
      </div>
    </div>
  );
};

export default function PricingSection() {
  const [isYearly, setIsYearly] = useState(false);
  const pricingRef = useRef<HTMLDivElement>(null);

  const revealVariants = {
    visible: (i: number) => ({
      y: 0,
      opacity: 1,
      filter: "blur(0px)",
      transition: { delay: i * 0.4, duration: 0.5 },
    }),
    hidden: { filter: "blur(10px)", y: -20, opacity: 0 },
  };

  const togglePricingPeriod = (value: string) =>
    setIsYearly(Number.parseInt(value) === 1);

  return (
    <div
      className="mx-auto relative bg-black overflow-hidden border-b-2 border-white/60"
      ref={pricingRef}
    >
      {/* Top sparkles */}
      <TimelineContent
        animationNum={4}
        timelineRef={pricingRef}
        customVariants={revealVariants}
        className="absolute top-0 h-96 w-screen overflow-hidden [mask-image:radial-gradient(50%_50%,white,transparent)]"
      >
        <div className="absolute bottom-0 left-0 right-0 top-0 bg-[linear-gradient(to_right,#ffffff2c_1px,transparent_1px),linear-gradient(to_bottom,#3a3a3a01_1px,transparent_1px)] bg-[size:70px_80px]" />
        <Sparkles
          density={1800}
          direction="bottom"
          speed={1}
          color="#FFFFFF"
          className="absolute inset-x-0 bottom-0 h-full w-full [mask-image:radial-gradient(50%_50%,white,transparent_85%)]"
        />
      </TimelineContent>

      {/* Yellow glow ring */}
      <TimelineContent
        animationNum={5}
        timelineRef={pricingRef}
        customVariants={revealVariants}
        className="absolute left-0 top-[-114px] w-full h-[113.625vh] flex flex-col items-start justify-start content-start flex-none flex-nowrap gap-2.5 overflow-hidden p-0 z-0"
      >
        <div className="relative w-full h-full">
          <div
            className="absolute left-[-568px] right-[-568px] top-0 h-[2053px] flex-none rounded-full"
            style={{
              border: "200px solid #facc15",
              filter: "blur(92px)",
              WebkitFilter: "blur(92px)",
            }}
          />
        </div>
      </TimelineContent>

      {/* Header */}
      <article className="text-center mb-6 pt-32 max-w-3xl mx-auto space-y-2 relative z-50">
        <h2 className="text-4xl font-medium text-white">
          <VerticalCutReveal
            splitBy="words"
            staggerDuration={0.15}
            staggerFrom="first"
            reverse={true}
            containerClassName="justify-center"
            transition={{ type: "spring", stiffness: 250, damping: 40, delay: 0 }}
          >
            Plans that work for you
          </VerticalCutReveal>
        </h2>

        <TimelineContent
          as="p"
          animationNum={0}
          timelineRef={pricingRef}
          customVariants={revealVariants}
          className="text-gray-300"
        >
          From free to full mastery — choose the plan that fits your pace.
        </TimelineContent>

        <TimelineContent
          as="div"
          animationNum={1}
          timelineRef={pricingRef}
          customVariants={revealVariants}
        >
          <PricingSwitch onSwitch={togglePricingPeriod} />
        </TimelineContent>
      </article>

      {/* Yellow radial bg glow */}
      <div
        className="absolute top-0 left-[10%] right-[10%] w-[80%] h-full z-0"
        style={{
          backgroundImage: `radial-gradient(circle at center, #facc15 0%, transparent 70%)`,
          opacity: 0.08,
          mixBlendMode: "screen",
        }}
      />

      {/* Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 max-w-6xl gap-4 py-6 mx-auto px-4">
        {plans.map((plan, index) => (
          <TimelineContent
            key={plan.name}
            as="div"
            animationNum={2 + index}
            timelineRef={pricingRef}
            customVariants={revealVariants}
          >
            <Card
              className={`relative text-white border-neutral-800 h-full ${
                plan.popular
                  ? "bg-gradient-to-r from-neutral-900 via-neutral-800 to-neutral-900 shadow-[0px_-13px_300px_0px_rgba(250,204,21,0.5)] z-20"
                  : "bg-gradient-to-r from-neutral-900 via-neutral-800 to-neutral-900 z-10"
              }`}
            >
              <CardHeader className="text-left">
                <div className="flex justify-between items-start">
                  <h3 className="text-2xl mb-2">{plan.name}</h3>
                  {plan.popular && (
                    <span className="rounded-full bg-yellow-400/15 border border-yellow-400/30 px-2.5 py-1 text-[10px] uppercase tracking-wider text-yellow-400">
                      Popular
                    </span>
                  )}
                </div>
                <div className="flex items-baseline">
                  <span className="text-3xl font-semibold">
                    $
                    <NumberFlow
                      value={isYearly ? plan.yearlyPrice : plan.price}
                      className="text-3xl font-semibold"
                    />
                  </span>
                  <span className="text-gray-300 ml-1 text-sm">
                    /{isYearly ? "year" : "month"}
                  </span>
                </div>
                {isYearly && plan.price > 0 && (
                  <p className="text-[11px] text-yellow-400/80">
                    Save ${((plan.price * 12) - plan.yearlyPrice).toFixed(2)}/year
                  </p>
                )}
                <p className="text-sm text-gray-400 mt-1">{plan.description}</p>
              </CardHeader>

              <CardContent className="pt-0">
                <button
                  className={`w-full mb-6 p-3 text-base rounded-xl transition-all ${
                    plan.popular
                      ? "bg-gradient-to-t from-yellow-500 to-yellow-400 shadow-lg shadow-yellow-800 border border-yellow-400 text-black font-semibold"
                      : "bg-gradient-to-t from-neutral-950 to-neutral-600 shadow-lg shadow-neutral-900 border border-neutral-800 text-white"
                  }`}
                >
                  {plan.buttonText}
                </button>

                <div className="space-y-3 pt-4 border-t border-neutral-700">
                  <h4 className="font-medium text-sm mb-3 text-white/70">{plan.includes[0]}</h4>
                  <ul className="space-y-2">
                    {plan.includes.slice(1).map((feature, featureIndex) => (
                      <li key={featureIndex} className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 bg-yellow-400/60 rounded-full shrink-0" />
                        <span className="text-sm text-gray-300">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TimelineContent>
        ))}
      </div>

      {/* Support card */}
      <TimelineContent
        animationNum={6}
        timelineRef={pricingRef}
        customVariants={revealVariants}
        className="max-w-6xl mx-auto px-4 pb-16"
      >
        <div className="relative overflow-hidden rounded-2xl border border-neutral-800 bg-gradient-to-r from-neutral-900 via-neutral-800 to-neutral-900 p-6 sm:p-8">
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(ellipse at left center, rgba(250,204,21,0.06), transparent 60%)" }}
          />
          <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-yellow-400/20 bg-yellow-400/10">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="10" r="8" stroke="#facc15" strokeWidth="1.5" />
                  <path d="M10 9v5M10 7v.5" stroke="#facc15" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Need help choosing?</h3>
                <p className="mt-1 text-sm text-gray-400 max-w-lg">
                  Our team replies within 24h. Reach us by email, browse the docs, or join the community.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-3">
              <a
                href="mailto:hello@minddock.ai"
                className="flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm text-white transition-colors hover:border-yellow-400/40 hover:bg-neutral-700"
              >
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <rect x="1" y="3" width="13" height="9" rx="1.5" stroke="#facc15" strokeWidth="1.3" />
                  <path d="M1 5l6.5 4L14 5" stroke="#facc15" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                Email
              </a>
              <a
                href="#"
                className="flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm text-white transition-colors hover:border-yellow-400/40 hover:bg-neutral-700"
              >
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <path d="M2 2h11v9H9l-3 2v-2H2V2z" stroke="#facc15" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
                Community
              </a>
              <a
                href="#"
                className="flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm text-white transition-colors hover:border-yellow-400/40 hover:bg-neutral-700"
              >
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <path d="M1.5 7.5h12M7.5 1.5v12" stroke="#facc15" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Docs
              </a>
            </div>
          </div>
        </div>
      </TimelineContent>
    </div>
  );
}
