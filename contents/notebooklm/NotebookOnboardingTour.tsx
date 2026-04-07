import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  markNotebookTourCompleted,
  markNotebookTourSkipped,
  markNotebookTourStarted,
  markNotebookTourStepSeen,
  markNotebookWelcomeSeen,
  readNotebookOnboardingState,
  type NotebookOnboardingScope
} from "./notebookOnboardingState"
import {
  NOTEBOOK_ONBOARDING_STEPS,
  type NotebookOnboardingAction,
  type NotebookOnboardingStep
} from "./notebookOnboardingSteps"
import { SOURCE_PANEL_EXPORT_EVENT, SOURCE_PANEL_TOGGLE_EVENT } from "./sourceDom"

type OnboardingMode = "loading" | "welcome" | "tour" | "hidden"
type RuntimeOnboardingMode = Exclude<OnboardingMode, "loading">

interface HighlightRect {
  top: number
  left: number
  width: number
  height: number
}

interface TooltipCoords {
  top: number
  left: number
}

const TOUR_SCOPE: NotebookOnboardingScope = "notebook_main"
const HIGHLIGHT_PADDING = 8
const ONBOARDING_ROOT_ID = "minddock-notebook-onboarding-root"
// O onboarding deve aparecer uma unica vez por instalacao da extensao.
// O estado fica no chrome.storage.local e nao depende da conta ativa no NotebookLM.
let runtimeTourSnapshot: { mode: RuntimeOnboardingMode; stepIndex: number } | null = null

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}

function resolveTargetElement(selector: string): HTMLElement | null {
  const normalized = String(selector ?? "").trim()
  if (!normalized) {
    return null
  }

  const direct = document.querySelector(normalized)
  if (direct instanceof HTMLElement) {
    return direct
  }

  const queue: Array<Document | ShadowRoot> = [document]
  const visited = new Set<Node>([document])

  while (queue.length > 0) {
    const root = queue.shift()
    if (!root) {
      continue
    }

    const found = root.querySelector(normalized)
    if (found instanceof HTMLElement) {
      return found
    }

    const hosts = root.querySelectorAll<HTMLElement>("*")
    for (const host of hosts) {
      const shadowRoot = host.shadowRoot
      if (!shadowRoot || visited.has(shadowRoot)) {
        continue
      }
      visited.add(shadowRoot)
      queue.push(shadowRoot)
    }
  }

  return null
}

async function waitForElement(selector: string, timeoutMs = 4000): Promise<HTMLElement | null> {
  const immediate = resolveTargetElement(selector)
  if (immediate) {
    return immediate
  }

  return new Promise((resolve) => {
    let settled = false
    let observer: MutationObserver | null = null
    let timeoutId = 0
    let pollId = 0

    const finish = (element: HTMLElement | null) => {
      if (settled) {
        return
      }

      settled = true
      observer?.disconnect()
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
      if (pollId) {
        window.clearInterval(pollId)
      }
      resolve(element)
    }

    const check = () => {
      const element = resolveTargetElement(selector)
      if (element) {
        finish(element)
      }
    }

    const startObserver = () => {
      if (!(document.body instanceof HTMLBodyElement) || observer) {
        return
      }

      observer = new MutationObserver(() => {
        check()
      })

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden", "aria-hidden", "data-state"]
      })
    }

    startObserver()
    check()

    pollId = window.setInterval(() => {
      if (settled) {
        return
      }
      startObserver()
      check()
    }, 120)

    timeoutId = window.setTimeout(() => {
      finish(null)
    }, Math.max(500, timeoutMs))
  })
}

function toHighlightRect(element: HTMLElement): HighlightRect | null {
  const bounds = element.getBoundingClientRect()
  if (bounds.width <= 0 || bounds.height <= 0) {
    return null
  }

  const top = Math.max(0, bounds.top - HIGHLIGHT_PADDING)
  const left = Math.max(0, bounds.left - HIGHLIGHT_PADDING)
  const width = Math.max(0, bounds.width + HIGHLIGHT_PADDING * 2)
  const height = Math.max(0, bounds.height + HIGHLIGHT_PADDING * 2)

  return {
    top: Math.round(top),
    left: Math.round(left),
    width: Math.round(width),
    height: Math.round(height)
  }
}

export function NotebookOnboardingTour() {
  const [mode, setMode] = useState<OnboardingMode>("loading")
  const [stepIndex, setStepIndex] = useState(0)
  const [highlightRect, setHighlightRect] = useState<HighlightRect | null>(null)
  const [tooltipCoords, setTooltipCoords] = useState<TooltipCoords>({ top: 24, left: 24 })
  const [isWaitingTarget, setIsWaitingTarget] = useState(false)
  const activeTargetRef = useRef<HTMLElement | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const resolveStepTokenRef = useRef(0)

  const steps = useMemo(() => NOTEBOOK_ONBOARDING_STEPS, [])
  const totalSteps = steps.length
  const maxStepIndex = Math.max(totalSteps - 1, 0)
  const activeStep = mode === "tour" ? steps[stepIndex] : null
  const isLastStep = mode === "tour" && stepIndex >= maxStepIndex

  const runActionBefore = useCallback(async (action?: NotebookOnboardingAction) => {
    if (!action) {
      return
    }

    if (action === "ensure_source_filters_panel") {
      const closeButton = resolveTargetElement('[data-tour-id="source-vault-close-btn"]')
      closeButton?.click()

      window.dispatchEvent(
        new CustomEvent(SOURCE_PANEL_TOGGLE_EVENT, {
          detail: { isVisible: true }
        })
      )
      await new Promise<void>((resolve) => window.setTimeout(resolve, 180))
      return
    }

    if (action === "open_source_vault") {
      window.dispatchEvent(new CustomEvent(SOURCE_PANEL_EXPORT_EVENT))
      await new Promise<void>((resolve) => window.setTimeout(resolve, 220))
      return
    }

    if (action === "close_source_vault") {
      const closeButton = resolveTargetElement('[data-tour-id="source-vault-close-btn"]')
      if (closeButton) {
        closeButton.click()
      } else {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 180))
      return
    }

    if (action === "open_chat_export_menu") {
      const menu = resolveTargetElement('[data-tour-id="chat-export-menu"]')
      if (!menu) {
        const exportButton = resolveTargetElement('[data-tour-id="chat-export-main-btn"]')
        exportButton?.click()
        await waitForElement('[data-tour-id="chat-export-menu"]', 2200)
      } else {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 120))
      }
      return
    }

    if (action === "close_chat_export_menu") {
      const menu = resolveTargetElement('[data-tour-id="chat-export-menu"]')
      if (menu) {
        const exportButton = resolveTargetElement('[data-tour-id="chat-export-main-btn"]')
        exportButton?.click()
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 160))
      return
    }

  }, [])

  const closeOpenUi = useCallback(async () => {
    const sourceCloseButton = resolveTargetElement('[data-tour-id="source-vault-close-btn"]')
    sourceCloseButton?.click()

    const chatMenu = resolveTargetElement('[data-tour-id="chat-export-menu"]')
    if (chatMenu) {
      const exportButton = resolveTargetElement('[data-tour-id="chat-export-main-btn"]')
      exportButton?.click()
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 220))
  }, [])

  const finishTour = useCallback(async (asCompleted: boolean) => {
    if (asCompleted) {
      await markNotebookTourCompleted(TOUR_SCOPE)
    } else {
      await markNotebookTourSkipped(TOUR_SCOPE)
    }

    await closeOpenUi()
    activeTargetRef.current = null
    setHighlightRect(null)
    setIsWaitingTarget(false)
    setStepIndex(0)
    runtimeTourSnapshot = { mode: "hidden", stepIndex: 0 }
    setMode("hidden")
  }, [closeOpenUi])

  const startTour = useCallback(async () => {
    await markNotebookWelcomeSeen()
    await markNotebookTourStarted(TOUR_SCOPE)
    activeTargetRef.current = null
    setHighlightRect(null)
    setStepIndex(0)
    runtimeTourSnapshot = { mode: "tour", stepIndex: 0 }
    setMode("tour")
  }, [])

  const skipFromWelcome = useCallback(async () => {
    await markNotebookWelcomeSeen()
    await markNotebookTourSkipped(TOUR_SCOPE)
    await closeOpenUi()
    activeTargetRef.current = null
    setHighlightRect(null)
    setIsWaitingTarget(false)
    setStepIndex(0)
    runtimeTourSnapshot = { mode: "hidden", stepIndex: 0 }
    setMode("hidden")
  }, [closeOpenUi])

  const goNext = useCallback(async () => {
    if (mode !== "tour") {
      return
    }

    if (isLastStep) {
      await finishTour(true)
      return
    }

    setStepIndex((current) => Math.min(current + 1, maxStepIndex))
  }, [finishTour, isLastStep, maxStepIndex, mode])

  const goPrevious = useCallback(() => {
    setStepIndex((current) => Math.max(current - 1, 0))
  }, [])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (runtimeTourSnapshot?.mode === "tour") {
        setStepIndex(clamp(runtimeTourSnapshot.stepIndex, 0, maxStepIndex))
        setMode("tour")
        return
      }

      if (runtimeTourSnapshot?.mode === "welcome") {
        setMode("welcome")
        return
      }

      if (runtimeTourSnapshot?.mode === "hidden") {
        setMode("hidden")
        return
      }

      const state = await readNotebookOnboardingState()
      if (cancelled) {
        return
      }

      if (!state.welcomeSeenAt) {
        // Marca a exibicao no primeiro render para garantir one-shot mesmo sem clique.
        await markNotebookWelcomeSeen()
        if (cancelled) {
          return
        }
        setMode("welcome")
        return
      }

      setMode("hidden")
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [maxStepIndex])

  useEffect(() => {
    if (mode === "tour") {
      runtimeTourSnapshot = {
        mode: "tour",
        stepIndex: clamp(stepIndex, 0, maxStepIndex)
      }
      return
    }
    if (mode === "welcome") {
      runtimeTourSnapshot = { mode: "welcome", stepIndex: 0 }
      return
    }
    if (mode === "hidden") {
      runtimeTourSnapshot = { mode: "hidden", stepIndex: 0 }
    }
  }, [maxStepIndex, mode, stepIndex])

  useEffect(() => {
    if (mode !== "tour") {
      return
    }

    const step = steps[stepIndex]
    if (!step) {
      void finishTour(true)
      return
    }

    let cancelled = false
    const token = resolveStepTokenRef.current + 1
    resolveStepTokenRef.current = token

    const resolveStep = async (currentStep: NotebookOnboardingStep) => {
      const hasTarget = !currentStep.isInfoStep && Boolean(currentStep.target)
      setIsWaitingTarget(hasTarget)

      await markNotebookTourStepSeen(TOUR_SCOPE, currentStep.id)

      await runActionBefore(currentStep.actionBefore)

      if (cancelled || resolveStepTokenRef.current !== token) {
        return
      }

      if (currentStep.isInfoStep || !currentStep.target) {
        activeTargetRef.current = null
        setHighlightRect(null)
        setIsWaitingTarget(false)
        return
      }

      const element = await waitForElement(currentStep.target, currentStep.timeoutMs ?? 4000)

      if (cancelled || resolveStepTokenRef.current !== token) {
        return
      }

      if (!element) {
        activeTargetRef.current = null
        setHighlightRect(null)
        setIsWaitingTarget(false)

        if (currentStep.required) {
          await finishTour(false)
          return
        }

        setStepIndex((current) => Math.min(current + 1, steps.length - 1))
        return
      }

      activeTargetRef.current = element
      setHighlightRect(toHighlightRect(element))
      setIsWaitingTarget(false)
    }

    void resolveStep(step)

    return () => {
      cancelled = true
    }
  }, [finishTour, mode, runActionBefore, stepIndex, steps])

  useEffect(() => {
    if (mode !== "tour") {
      return
    }

    if (isWaitingTarget) {
      return
    }

    const updateHighlight = () => {
      const element = activeTargetRef.current
      if (!(element instanceof HTMLElement) || !element.isConnected) {
        setHighlightRect(null)
        return
      }
      setHighlightRect(toHighlightRect(element))
    }

    const scheduleUpdate = () => {
      window.requestAnimationFrame(updateHighlight)
    }

    scheduleUpdate()

    const pollTimer = window.setInterval(updateHighlight, 260)
    window.addEventListener("scroll", scheduleUpdate, true)
    window.addEventListener("resize", scheduleUpdate)

    return () => {
      window.clearInterval(pollTimer)
      window.removeEventListener("scroll", scheduleUpdate, true)
      window.removeEventListener("resize", scheduleUpdate)
    }
  }, [isWaitingTarget, mode, stepIndex])

  useEffect(() => {
    if (mode !== "tour") {
      return
    }

    const step = activeStep
    const tooltipEl = tooltipRef.current
    if (!step || !tooltipEl) {
      return
    }

    const tooltipRect = tooltipEl.getBoundingClientRect()
    const margin = 16
    const gap = 14

    let nextTop = margin
    let nextLeft = margin

    if (!highlightRect || step.isInfoStep || step.position === "center") {
      nextTop = (window.innerHeight - tooltipRect.height) / 2
      nextLeft = (window.innerWidth - tooltipRect.width) / 2
    } else {
      const maxLeft = Math.max(margin, window.innerWidth - tooltipRect.width - margin)
      const maxTop = Math.max(margin, window.innerHeight - tooltipRect.height - margin)

      type Placement = "bottom" | "right" | "left"
      interface PlacementResult {
        clampedTop: number
        clampedLeft: number
        fitsViewport: boolean
        overlapArea: number
        centerDistance: number
      }

      const preferred = step.position ?? "bottom"
      const orderedPlacements: Placement[] =
        preferred === "left"
          ? ["left", "bottom", "right"]
          : preferred === "right"
            ? ["right", "bottom", "left"]
            : ["bottom", "right", "left"]

      const evaluatePlacement = (placement: Placement): PlacementResult => {
        let rawTop = highlightRect.top + highlightRect.height + gap
        let rawLeft = highlightRect.left + highlightRect.width / 2 - tooltipRect.width / 2

        if (placement === "right") {
          rawTop = highlightRect.top
          rawLeft = highlightRect.left + highlightRect.width + gap
        } else if (placement === "left") {
          rawTop = highlightRect.top
          rawLeft = highlightRect.left - tooltipRect.width - gap
        }

        const fitsViewport =
          rawLeft >= margin &&
          rawTop >= margin &&
          rawLeft + tooltipRect.width <= window.innerWidth - margin &&
          rawTop + tooltipRect.height <= window.innerHeight - margin

        const clampedLeft = Math.round(clamp(rawLeft, margin, maxLeft))
        const clampedTop = Math.round(clamp(rawTop, margin, maxTop))

        const tooltipLeft = clampedLeft
        const tooltipRight = clampedLeft + tooltipRect.width
        const tooltipTop = clampedTop
        const tooltipBottom = clampedTop + tooltipRect.height

        const highlightRight = highlightRect.left + highlightRect.width
        const highlightBottom = highlightRect.top + highlightRect.height

        const overlapWidth = Math.max(
          0,
          Math.min(tooltipRight, highlightRight) - Math.max(tooltipLeft, highlightRect.left)
        )
        const overlapHeight = Math.max(
          0,
          Math.min(tooltipBottom, highlightBottom) - Math.max(tooltipTop, highlightRect.top)
        )
        const overlapArea = overlapWidth * overlapHeight

        const tooltipCenterX = tooltipLeft + tooltipRect.width / 2
        const tooltipCenterY = tooltipTop + tooltipRect.height / 2
        const highlightCenterX = highlightRect.left + highlightRect.width / 2
        const highlightCenterY = highlightRect.top + highlightRect.height / 2
        const centerDistance =
          Math.abs(tooltipCenterX - highlightCenterX) + Math.abs(tooltipCenterY - highlightCenterY)

        return {
          clampedTop,
          clampedLeft,
          fitsViewport,
          overlapArea,
          centerDistance
        }
      }

      const placementResults = orderedPlacements.map((placement) => evaluatePlacement(placement))
      const fullyVisibleIndex = placementResults.findIndex(
        (result) => result.fitsViewport && result.overlapArea === 0
      )

      if (fullyVisibleIndex >= 0) {
        nextTop = placementResults[fullyVisibleIndex].clampedTop
        nextLeft = placementResults[fullyVisibleIndex].clampedLeft
      } else {
        let bestIndex = 0
        for (let index = 1; index < placementResults.length; index += 1) {
          const current = placementResults[index]
          const best = placementResults[bestIndex]
          const hasLessOverlap = current.overlapArea < best.overlapArea
          const sameOverlap = current.overlapArea === best.overlapArea
          const hasMoreDistance = current.centerDistance > best.centerDistance
          if (hasLessOverlap || (sameOverlap && hasMoreDistance)) {
            bestIndex = index
          }
        }
        nextTop = placementResults[bestIndex].clampedTop
        nextLeft = placementResults[bestIndex].clampedLeft
      }
    }

    const maxLeft = Math.max(margin, window.innerWidth - tooltipRect.width - margin)
    const maxTop = Math.max(margin, window.innerHeight - tooltipRect.height - margin)
    const clampedLeft = Math.round(clamp(nextLeft, margin, maxLeft))
    const clampedTop = Math.round(clamp(nextTop, margin, maxTop))

    setTooltipCoords((current) => {
      if (current.left === clampedLeft && current.top === clampedTop) {
        return current
      }
      return { left: clampedLeft, top: clampedTop }
    })
  }, [activeStep, highlightRect, mode, stepIndex])

  useEffect(() => {
    if (mode === "hidden" || mode === "loading") {
      return
    }

    const root = document.getElementById(ONBOARDING_ROOT_ID)
    if (root && root.parentElement === document.body) {
      // Keeps the tour root as the last body child to avoid z-index ties with other overlays.
      document.body.appendChild(root)
    }
  }, [mode, stepIndex])

  if (mode === "hidden" || mode === "loading") {
    return null
  }

  if (mode === "welcome") {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2147483647,
          background: "rgba(0, 0, 0, 0.62)",
          backdropFilter: "blur(2px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px"
        }}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Boas-vindas do tour MindDock"
          style={{
            width: "min(420px, 100%)",
            borderRadius: "16px",
            border: "1px solid rgba(250, 204, 21, 0.35)",
            background:
              "linear-gradient(170deg, rgba(250, 204, 21, 0.12), rgba(10, 10, 10, 0.94) 42%)",
            boxShadow: "0 20px 45px rgba(0, 0, 0, 0.45)",
            color: "#f4f4f5",
            padding: "16px"
          }}>
          <p
            style={{
              margin: 0,
              fontSize: "10px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#fde68a",
              fontWeight: 700
            }}>
            MindDock Onboarding
          </p>
          <h2 style={{ margin: "8px 0 0", fontSize: "20px", lineHeight: 1.1 }}>
            Quer fazer um tour rapido?
          </h2>
          <p style={{ margin: "10px 0 0", fontSize: "13px", lineHeight: 1.5, color: "#d4d4d8" }}>
            Em poucos passos voce vai ver onde ficam os pontos principais do MindDock dentro do NotebookLM.
          </p>

          <div style={{ marginTop: "14px", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
            <button
              type="button"
              onClick={() => {
                void skipFromWelcome()
              }}
              style={{
                borderRadius: "10px",
                border: "1px solid rgba(255, 255, 255, 0.16)",
                background: "rgba(10, 10, 10, 0.45)",
                color: "#e4e4e7",
                padding: "8px 12px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer"
              }}>
              Agora nao
            </button>
            <button
              type="button"
              onClick={() => {
                void startTour()
              }}
              style={{
                borderRadius: "10px",
                border: "1px solid #facc15",
                background: "#facc15",
                color: "#111827",
                padding: "8px 12px",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer"
              }}>
              Iniciar tour
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!activeStep) {
    return null
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        pointerEvents: "auto"
      }}>
      {!highlightRect ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.62)",
            backdropFilter: "blur(2px)"
          }}
        />
      ) : (
        <div
          style={{
            position: "fixed",
            top: highlightRect.top,
            left: highlightRect.left,
            width: highlightRect.width,
            height: highlightRect.height,
            borderRadius: "12px",
            border: "2px solid rgba(250, 204, 21, 0.95)",
            boxShadow:
              "0 0 0 1px rgba(250, 204, 21, 0.45), 0 0 0 9999px rgba(0, 0, 0, 0.58), 0 0 24px rgba(250, 204, 21, 0.35)",
            pointerEvents: "none",
            transition: "all 140ms ease"
          }}
        />
      )}

      <div
        ref={tooltipRef}
        role="dialog"
        aria-modal="true"
        aria-label="Tour guiado MindDock"
        style={{
          position: "fixed",
          top: tooltipCoords.top,
          left: tooltipCoords.left,
          width: "min(360px, calc(100vw - 32px))",
          borderRadius: "14px",
          border: "1px solid rgba(255, 255, 255, 0.14)",
          background: "rgba(8, 8, 8, 0.96)",
          boxShadow: "0 24px 48px rgba(0, 0, 0, 0.52)",
          color: "#f4f4f5",
          padding: "14px"
        }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "10px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#fde68a",
              fontWeight: 700
            }}>
            Tour MindDock
          </span>
          <button
            type="button"
            aria-label="Fechar tour"
            onClick={() => {
              void finishTour(false)
            }}
            style={{
              width: "24px",
              height: "24px",
              borderRadius: "8px",
              border: "1px solid rgba(255, 255, 255, 0.18)",
              background: "rgba(10, 10, 10, 0.45)",
              color: "#e4e4e7",
              fontSize: "13px",
              lineHeight: 1,
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer"
            }}>
            X
          </button>
        </div>

        <h3 style={{ margin: "8px 0 0", fontSize: "16px", lineHeight: 1.2 }}>{activeStep.title}</h3>
        <p style={{ margin: "8px 0 0", fontSize: "13px", lineHeight: 1.55, color: "#d4d4d8" }}>
          {activeStep.description}
        </p>

        {isWaitingTarget && activeStep.target ? (
          <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#facc15" }}>Procurando item na tela...</p>
        ) : null}

        <div style={{ marginTop: "14px", display: "flex", justifyContent: "space-between", gap: "8px" }}>
          <button
            type="button"
            onClick={goPrevious}
            disabled={stepIndex <= 0}
            style={{
              borderRadius: "10px",
              border: "1px solid rgba(255, 255, 255, 0.14)",
              background: stepIndex <= 0 ? "rgba(39, 39, 42, 0.45)" : "rgba(10, 10, 10, 0.45)",
              color: stepIndex <= 0 ? "#71717a" : "#e4e4e7",
              padding: "8px 12px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: stepIndex <= 0 ? "not-allowed" : "pointer"
            }}>
            Voltar
          </button>

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={() => {
                void finishTour(false)
              }}
              style={{
                borderRadius: "10px",
                border: "1px solid rgba(255, 255, 255, 0.16)",
                background: "rgba(10, 10, 10, 0.45)",
                color: "#e4e4e7",
                padding: "8px 12px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer"
              }}>
              Pular
            </button>
            <button
              type="button"
              onClick={() => {
                void goNext()
              }}
              style={{
                borderRadius: "10px",
                border: "1px solid #facc15",
                background: "#facc15",
                color: "#111827",
                padding: "8px 12px",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer"
              }}>
              {isLastStep ? "Finalizar" : "Proximo"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
