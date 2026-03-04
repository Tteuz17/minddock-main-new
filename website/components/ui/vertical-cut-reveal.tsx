'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

interface TextProps {
  children: React.ReactNode
  reverse?: boolean
  transition?: Record<string, unknown>
  splitBy?: "words" | "characters" | "lines" | string
  staggerDuration?: number
  staggerFrom?: "first" | "last" | "center" | "random" | number
  containerClassName?: string
  wordLevelClassName?: string
  elementLevelClassName?: string
  onClick?: () => void
  onStart?: () => void
  onComplete?: () => void
  autoStart?: boolean
}

export interface VerticalCutRevealRef {
  startAnimation: () => void
  reset: () => void
}

interface WordObject {
  characters: string[]
  needsSpace: boolean
}

const VerticalCutReveal = forwardRef<VerticalCutRevealRef, TextProps>(
  ({
    children,
    reverse = false,
    transition = { type: "spring", stiffness: 190, damping: 22 },
    splitBy = "words",
    staggerDuration = 0.2,
    staggerFrom = "first",
    containerClassName,
    wordLevelClassName,
    elementLevelClassName,
    onClick,
    onStart,
    onComplete,
    autoStart = true,
  }, ref) => {
    const containerRef = useRef<HTMLSpanElement>(null)
    const text = typeof children === "string" ? children : children?.toString() || ""
    const [isAnimating, setIsAnimating] = useState(false)

    const elements = useMemo(() => {
      const words = text.split(" ")
      if (splitBy === "characters") {
        return words.map((word, i) => ({ characters: Array.from(word), needsSpace: i !== words.length - 1 }))
      }
      return splitBy === "words"
        ? text.split(" ")
        : splitBy === "lines"
          ? text.split("\n")
          : text.split(splitBy)
    }, [text, splitBy])

    const getStaggerDelay = useCallback((index: number) => {
      const total = splitBy === "characters"
        ? (elements as WordObject[]).reduce((acc, w) => acc + w.characters.length, 0)
        : elements.length
      if (staggerFrom === "first") return index * staggerDuration
      if (staggerFrom === "last") return (total - 1 - index) * staggerDuration
      if (staggerFrom === "center") return Math.abs(Math.floor(total / 2) - index) * staggerDuration
      if (staggerFrom === "random") return Math.abs(Math.floor(Math.random() * total) - index) * staggerDuration
      return Math.abs((staggerFrom as number) - index) * staggerDuration
    }, [elements, staggerFrom, staggerDuration, splitBy])

    const startAnimation = useCallback(() => { setIsAnimating(true); onStart?.() }, [onStart])

    useImperativeHandle(ref, () => ({ startAnimation, reset: () => setIsAnimating(false) }))

    useEffect(() => { if (autoStart) startAnimation() }, [autoStart, startAnimation])

    const variants = {
      hidden: { y: reverse ? "-100%" : "100%" },
      visible: (i: number) => ({
        y: 0,
        transition: { ...(transition as object), delay: ((transition?.delay as number) || 0) + getStaggerDelay(i) },
      }),
    }

    const wordObjs: WordObject[] = splitBy === "characters"
      ? (elements as WordObject[])
      : (elements as string[]).map((el, i) => ({ characters: [el], needsSpace: i !== elements.length - 1 }))

    return (
      <span
        className={cn(containerClassName, "flex flex-wrap whitespace-pre-wrap", splitBy === "lines" && "flex-col")}
        onClick={onClick}
        ref={containerRef}
      >
        <span className="sr-only">{text}</span>
        {wordObjs.map((wordObj, wordIndex, array) => {
          const previousCharsCount = array.slice(0, wordIndex).reduce((sum, w) => sum + w.characters.length, 0)
          return (
            <span key={wordIndex} aria-hidden="true" className={cn("inline-flex overflow-hidden", wordLevelClassName)}>
              {wordObj.characters.map((char, charIndex) => (
                <span key={charIndex} className={cn(elementLevelClassName, "whitespace-pre-wrap relative")}>
                  <motion.span
                    custom={previousCharsCount + charIndex}
                    initial="hidden"
                    animate={isAnimating ? "visible" : "hidden"}
                    variants={variants}
                    onAnimationComplete={
                      wordIndex === elements.length - 1 && charIndex === wordObj.characters.length - 1
                        ? onComplete : undefined
                    }
                    className="inline-block"
                  >
                    {char}
                  </motion.span>
                </span>
              ))}
              {wordObj.needsSpace && <span> </span>}
            </span>
          )
        })}
      </span>
    )
  }
)

VerticalCutReveal.displayName = "VerticalCutReveal"
export { VerticalCutReveal }
