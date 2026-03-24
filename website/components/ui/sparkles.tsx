"use client"

import { useEffect, useId, useState } from "react"
import Particles, { initParticlesEngine } from "@tsparticles/react"
import { loadSlim } from "@tsparticles/slim"
import type { IOptions, MoveDirection, RecursivePartial } from "@tsparticles/engine"

let particlesEnginePromise: Promise<void> | null = null

const ensureParticlesEngine = () => {
  if (!particlesEnginePromise) {
    particlesEnginePromise = initParticlesEngine(async (engine) => {
      await loadSlim(engine)
    })
  }
  return particlesEnginePromise
}

interface SparklesProps {
  className?: string
  size?: number
  minSize?: number | null
  density?: number
  speed?: number
  minSpeed?: number | null
  opacity?: number
  opacitySpeed?: number
  minOpacity?: number | null
  color?: string
  background?: string
  direction?: string
  options?: RecursivePartial<IOptions>
}

export function Sparkles({
  className,
  size = 1,
  minSize = null,
  density = 800,
  speed = 1,
  minSpeed = null,
  opacity = 1,
  opacitySpeed = 3,
  minOpacity = null,
  color = "#FFFFFF",
  background = "transparent",
  options = {},
}: SparklesProps) {
  const [isReady, setIsReady] = useState(false)
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
    let isMounted = true

    void ensureParticlesEngine()
      .then(() => {
        if (isMounted) {
          setIsReady(true)
        }
      })
      .catch((error: unknown) => {
        // Some browsers/ad blockers can block particle internals in dev.
        // Avoid bubbling an unhandled rejection (`[object Event]`) to Next overlay.
        console.warn("[Sparkles] Particle engine init failed.", error)
        if (isMounted) {
          setIsReady(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  const id = useId()

  const defaultOptions: RecursivePartial<IOptions> = {
    background: { color: { value: background } },
    fullScreen: { enable: false, zIndex: 1 },
    fpsLimit: reduceMotion ? 30 : 60,
    pauseOnBlur: true,
    pauseOnOutsideViewport: true,
    particles: {
      color: { value: color },
      move: {
        enable: !reduceMotion,
        direction: "none" as MoveDirection,
        speed: { min: minSpeed ?? speed / 10, max: speed },
        straight: false,
      },
      number: { value: density },
      opacity: {
        value: { min: minOpacity ?? opacity / 10, max: opacity },
        animation: { enable: true, sync: false, speed: opacitySpeed },
      },
      size: { value: { min: minSize ?? size / 2.5, max: size } },
    },
    detectRetina: false,
  }

  if (!isReady) return null
  return <Particles id={id} options={{ ...defaultOptions, ...options }} className={className} />
}
