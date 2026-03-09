"use client"

import React, { ElementType, RefObject } from "react"
import { motion, useInView, Variants } from "framer-motion"
import { cn } from "@/lib/utils"

interface TimelineContentProps {
  as?: ElementType
  animationNum?: number
  timelineRef?: RefObject<HTMLElement | null>
  customVariants?: Record<number, Variants> | Variants
  className?: string
  children?: React.ReactNode
  [key: string]: unknown
}

export function TimelineContent({
  as: Tag = "div",
  animationNum = 0,
  timelineRef,
  customVariants,
  className,
  children,
  ...props
}: TimelineContentProps) {
  const ref = React.useRef<HTMLElement>(null)
  const isInView = useInView(ref as RefObject<Element>, { once: true, margin: "-10% 0px" })

  const defaultVariants: Variants = {
    hidden: { opacity: 0, y: 20, filter: "blur(6px)" },
    visible: {
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      transition: { duration: 0.5, delay: (animationNum ?? 0) * 0.08 },
    },
  }

  const variants = customVariants
    ? typeof customVariants === "function" || "hidden" in customVariants
      ? (customVariants as Variants)
      : { hidden: { opacity: 0, y: -20, filter: "blur(10px)" }, visible: customVariants(animationNum ?? 0) }
    : defaultVariants

  return (
    <motion.div
      ref={ref as RefObject<HTMLDivElement>}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      variants={variants}
      custom={animationNum}
      className={cn(className)}
      {...(props as Record<string, unknown>)}
    >
      {children}
    </motion.div>
  )
}
