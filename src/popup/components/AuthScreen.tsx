import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ChevronRight, Chrome, Loader2 } from "lucide-react"
import { Button } from "~/components/ui/button"

interface AuthScreenProps {
  compact?: boolean
  onSignIn: () => Promise<void>
  error?: string | null
}

const MINDDOCK_LOGO_SRC = new URL(
  "../../../public/images/logo/logo minddock sem fundo.png",
  import.meta.url
).href

const FEATURE_CAROUSEL = [
  {
    title: "Capture In Seconds",
    description: "Collect insights from supported sites in one click."
  },
  {
    title: "Organize With Structure",
    description: "Keep notebooks clean with folders, tags, and clear context."
  },
  {
    title: "Keep Continuity",
    description: "Resume conversations exactly where your workflow stopped."
  },
  {
    title: "Ship Better Outputs",
    description: "Use guided prompts to turn notes into execution-ready assets."
  }
] as const

export function AuthScreen({ compact, onSignIn, error }: AuthScreenProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [activeSlide, setActiveSlide] = useState(0)

  useEffect(() => {
    if (compact) {
      return
    }

    const timer = window.setInterval(() => {
      setActiveSlide((previous) => (previous + 1) % FEATURE_CAROUSEL.length)
    }, 3600)

    return () => window.clearInterval(timer)
  }, [compact])

  async function handleSignIn() {
    setIsLoading(true)
    try {
      await onSignIn()
    } catch {
      // The hook already surfaces auth errors.
    } finally {
      setIsLoading(false)
    }
  }

  if (compact) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-6 text-center">
        <img src={MINDDOCK_LOGO_SRC} alt="MindDock" className="h-10 w-auto object-contain" />
        <p className="text-sm text-text-secondary">Sign in to activate your workspace</p>
        <Button variant="primary" size="md" onClick={handleSignIn} disabled={isLoading}>
          {isLoading ? (
            <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
          ) : (
            <Chrome size={14} strokeWidth={1.5} />
          )}
          Continue with Google
        </Button>
      </div>
    )
  }

  return (
    <div className="popup-container relative overflow-hidden bg-[#050506] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,#0a0a0a,#050506_40%,#040404_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-60 [background-size:2.8rem_2.8rem] [background-image:linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_78%_48%_at_50%_0%,#000_62%,transparent_100%)]" />
      <div className="pointer-events-none absolute left-1/2 top-[76%] h-[440px] w-[620px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(250,204,21,0.2)_0%,rgba(250,204,21,0.04)_42%,rgba(250,204,21,0)_74%)]" />

      <section className="relative z-10 flex h-full flex-col px-6 pb-6 pt-8">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.26 }}
          className="flex flex-col items-center">
          <img src={MINDDOCK_LOGO_SRC} alt="MindDock" className="h-12 w-auto object-contain" />
          <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-400">
            NotebookLM Extension
            <ChevronRight size={10} strokeWidth={2.2} className="text-zinc-500" />
          </span>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.3 }}
          className="mt-5">
          <h1 className="text-balance text-center text-[29px] font-semibold leading-[1.03] tracking-tight text-white">
            Build sharper thinking
          </h1>
          <p className="mx-auto mt-2 max-w-[290px] text-balance text-center text-[13px] leading-relaxed text-zinc-400">
            Focused context, cleaner continuity, and faster output.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.32 }}
          className="mt-6 rounded-2xl border border-white/[0.09] bg-black/30 px-4 py-4 backdrop-blur-[1px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSlide}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="min-h-[84px]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#facc15]/80">
                {String(activeSlide + 1).padStart(2, "0")} / {String(FEATURE_CAROUSEL.length).padStart(2, "0")}
              </p>
              <h2 className="mt-2 text-[22px] font-semibold leading-none tracking-tight text-white">
                {FEATURE_CAROUSEL[activeSlide].title}
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
                {FEATURE_CAROUSEL[activeSlide].description}
              </p>
            </motion.div>
          </AnimatePresence>

          <div className="mt-3 flex items-center justify-center gap-2">
            {FEATURE_CAROUSEL.map((item, index) => (
              <button
                key={item.title}
                type="button"
                onClick={() => setActiveSlide(index)}
                aria-label={`Go to slide ${index + 1}`}
                className={[
                  "h-1.5 rounded-full transition-all duration-200",
                  index === activeSlide ? "w-6 bg-[#facc15]" : "w-2.5 bg-white/20 hover:bg-white/35"
                ].join(" ")}
              />
            ))}
          </div>
        </motion.div>

        <div className="mt-auto pt-5">
          <Button
            variant="primary"
            size="lg"
            onClick={handleSignIn}
            disabled={isLoading}
            className="h-11 w-full gap-2 rounded-xl border border-[#facc15]/55 bg-[#facc15] text-[14px] font-semibold text-black shadow-[0_10px_28px_rgba(250,204,21,0.25)] hover:bg-[#f4c400]">
            {isLoading ? (
              <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
            ) : (
              <Chrome size={16} strokeWidth={1.5} />
            )}
            {isLoading ? "Signing in..." : "Continue with Google"}
          </Button>

          {error ? (
            <div className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-left">
              <p className="text-xs leading-relaxed text-red-200">{error}</p>
            </div>
          ) : null}

          <p className="mt-4 text-center text-[11px] text-zinc-500">Free to start, no credit card required</p>
        </div>
      </section>
    </div>
  )
}
