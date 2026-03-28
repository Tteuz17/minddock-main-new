import { createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { VoiceDictationButton } from "./VoiceDictationButton"

const VOICE_ANCHOR_ID = "nblm-voice-anchor"
const VOICE_TEXTAREA_ATTRIBUTE = "data-nblm-voice-textarea"
const VOICE_EDITABLE_ATTRIBUTE = "data-nblm-voice-editable"
const VOICE_TEXTAREA_SELECTOR = `textarea[${VOICE_TEXTAREA_ATTRIBUTE}="true"]`
const VOICE_EDITABLE_SELECTOR = `[${VOICE_EDITABLE_ATTRIBUTE}="true"]`
const VOICE_BUTTON_SIZE = 34
const VOICE_LANE_MIN_GAP = VOICE_BUTTON_SIZE + 14
const VOICE_LANE_RELAX_GAP = VOICE_LANE_MIN_GAP + 20
const VOICE_SOURCE_SPACING_ATTRIBUTE = "data-nblm-voice-spacing-applied"
const VOICE_SOURCE_ORIGINAL_MARGIN_ATTRIBUTE = "data-nblm-voice-original-inline-margin-right"
const VOICE_SOURCE_BASE_MARGIN_ATTRIBUTE = "data-nblm-voice-base-margin-right"
const VOICE_SOURCE_EXTRA_MARGIN_ATTRIBUTE = "data-nblm-voice-extra-margin-right"
const MINDDOCK_MODAL_SELECTOR = "[data-minddock-preview-modal='true'], [data-minddock-source-overlay='true'], [data-minddock-studio-export-overlay='true']"

let voiceUiObserver: MutationObserver | null = null
let mountedVoiceRoot: Root | null = null
let mountedVoiceAnchor: HTMLElement | null = null
let mountScheduleHandle: number | null = null
let pinnedSendButtonElement: HTMLButtonElement | null = null
let pinnedSourceCounterElement: HTMLElement | null = null

type EditableInputElement = HTMLTextAreaElement | HTMLElement

function isVisibleElement(element: HTMLElement): boolean {
  const computedStyle = window.getComputedStyle(element)
  if (computedStyle.display === "none" || computedStyle.visibility === "hidden") {
    return false
  }

  const boundingBox = element.getBoundingClientRect()
  return boundingBox.width > 0 && boundingBox.height > 0
}

function scoreBottomMostElement(candidate: HTMLElement): number {
  const rect = candidate.getBoundingClientRect()
  return rect.top + rect.height * 0.5
}

function resolveVisibleTextareaCandidate(): HTMLTextAreaElement | null {
  const allTextareaCandidates = Array.from(document.querySelectorAll<HTMLTextAreaElement>("main textarea, textarea"))
  const visibleTextareaCandidates = allTextareaCandidates.filter((candidate) => {
    if (candidate.disabled || candidate.readOnly) {
      return false
    }

    if (candidate.closest(MINDDOCK_MODAL_SELECTOR)) {
      return false
    }

    return isVisibleElement(candidate)
  })

  if (visibleTextareaCandidates.length === 0) {
    return null
  }

  visibleTextareaCandidates.sort((firstCandidate, secondCandidate) => scoreBottomMostElement(firstCandidate) - scoreBottomMostElement(secondCandidate))

  return visibleTextareaCandidates[visibleTextareaCandidates.length - 1] ?? null
}

function resolveVisibleEditableCandidate(): HTMLElement | null {
  const editableSelectors = [
    "main [contenteditable='true'][role='textbox']",
    "main [contenteditable='true']",
    "[contenteditable='true'][role='textbox']",
    "[contenteditable='true']"
  ] as const

  const candidateSet = new Set<HTMLElement>()
  for (const selector of editableSelectors) {
    for (const element of Array.from(document.querySelectorAll(selector))) {
      if (element instanceof HTMLElement) {
        candidateSet.add(element)
      }
    }
  }

  const visibleCandidates = Array.from(candidateSet).filter((candidate) => {
    if (!isVisibleElement(candidate)) {
      return false
    }

    if (candidate.closest(MINDDOCK_MODAL_SELECTOR)) {
      return false
    }

    const rect = candidate.getBoundingClientRect()
    return rect.top > window.innerHeight * 0.35
  })

  if (visibleCandidates.length === 0) {
    return null
  }

  visibleCandidates.sort((firstCandidate, secondCandidate) => scoreBottomMostElement(firstCandidate) - scoreBottomMostElement(secondCandidate))
  return visibleCandidates[visibleCandidates.length - 1] ?? null
}

function resolveNotebookInputElement(): EditableInputElement | null {
  const textareaCandidate = resolveVisibleTextareaCandidate()
  if (textareaCandidate) {
    return textareaCandidate
  }

  return resolveVisibleEditableCandidate()
}

function isMindDockModalOpen(): boolean {
  return Boolean(document.querySelector(MINDDOCK_MODAL_SELECTOR))
}


function clearVoiceInputMarkers(): void {
  const markedTextareaElements = document.querySelectorAll(`textarea[${VOICE_TEXTAREA_ATTRIBUTE}]`)
  markedTextareaElements.forEach((textareaElement) => {
    textareaElement.removeAttribute(VOICE_TEXTAREA_ATTRIBUTE)
  })

  const markedEditableElements = document.querySelectorAll(`[${VOICE_EDITABLE_ATTRIBUTE}]`)
  markedEditableElements.forEach((editableElement) => {
    editableElement.removeAttribute(VOICE_EDITABLE_ATTRIBUTE)
  })
}

function readNumericPx(value: string | null | undefined): number {
  const parsedValue = Number.parseFloat(String(value ?? ""))
  return Number.isFinite(parsedValue) ? parsedValue : 0
}

function clearSourceCounterSpacing(sourceCounterElement: HTMLElement): void {
  if (sourceCounterElement.getAttribute(VOICE_SOURCE_SPACING_ATTRIBUTE) !== "true") {
    return
  }

  const originalInlineMargin = sourceCounterElement.getAttribute(VOICE_SOURCE_ORIGINAL_MARGIN_ATTRIBUTE)
  if (originalInlineMargin && originalInlineMargin.trim().length > 0) {
    sourceCounterElement.style.marginRight = originalInlineMargin
  } else {
    sourceCounterElement.style.removeProperty("margin-right")
  }

  sourceCounterElement.removeAttribute(VOICE_SOURCE_SPACING_ATTRIBUTE)
  sourceCounterElement.removeAttribute(VOICE_SOURCE_ORIGINAL_MARGIN_ATTRIBUTE)
  sourceCounterElement.removeAttribute(VOICE_SOURCE_BASE_MARGIN_ATTRIBUTE)
  sourceCounterElement.removeAttribute(VOICE_SOURCE_EXTRA_MARGIN_ATTRIBUTE)
}

function clearAllSourceCounterSpacing(): void {
  const spacedElements = document.querySelectorAll<HTMLElement>(`[${VOICE_SOURCE_SPACING_ATTRIBUTE}="true"]`)
  spacedElements.forEach((spacedElement) => {
    clearSourceCounterSpacing(spacedElement)
  })
}

function ensureSourceCounterSpacing(
  sourceCounterElement: HTMLElement,
  minimumGapPx: number,
  currentGapPx: number
): void {
  const missingGap = minimumGapPx - currentGapPx
  const appliedExtraMargin = readNumericPx(sourceCounterElement.getAttribute(VOICE_SOURCE_EXTRA_MARGIN_ATTRIBUTE))

  // Hysteresis: if spacing was already applied, only clear it when there is plenty of room.
  if (missingGap <= 0 && (appliedExtraMargin <= 0 || currentGapPx >= VOICE_LANE_RELAX_GAP)) {
    clearSourceCounterSpacing(sourceCounterElement)
    return
  }

  if (missingGap <= 0) {
    return
  }

  if (
    sourceCounterElement.getAttribute(VOICE_SOURCE_SPACING_ATTRIBUTE) !== "true" ||
    !sourceCounterElement.hasAttribute(VOICE_SOURCE_BASE_MARGIN_ATTRIBUTE)
  ) {
    sourceCounterElement.setAttribute(VOICE_SOURCE_SPACING_ATTRIBUTE, "true")
    sourceCounterElement.setAttribute(
      VOICE_SOURCE_ORIGINAL_MARGIN_ATTRIBUTE,
      sourceCounterElement.style.marginRight ?? ""
    )

    const baseMarginRight = readNumericPx(window.getComputedStyle(sourceCounterElement).marginRight)
    sourceCounterElement.setAttribute(VOICE_SOURCE_BASE_MARGIN_ATTRIBUTE, String(baseMarginRight))
  }

  const baseMarginRight = readNumericPx(sourceCounterElement.getAttribute(VOICE_SOURCE_BASE_MARGIN_ATTRIBUTE))
  const targetExtraMargin = Math.max(appliedExtraMargin, Math.ceil(missingGap + 8))
  const targetMarginRight = Math.ceil(baseMarginRight + targetExtraMargin)
  sourceCounterElement.style.marginRight = `${targetMarginRight}px`
  sourceCounterElement.setAttribute(VOICE_SOURCE_EXTRA_MARGIN_ATTRIBUTE, String(targetExtraMargin))
}

function resolveSendButtonWithin(containerElement: HTMLElement): HTMLButtonElement | null {
  if (
    pinnedSendButtonElement &&
    pinnedSendButtonElement.isConnected &&
    containerElement.contains(pinnedSendButtonElement) &&
    isVisibleElement(pinnedSendButtonElement)
  ) {
    return pinnedSendButtonElement
  }

  const directCandidates = [
    "button[aria-label*='send' i]",
    "button[aria-label*='enviar' i]",
    "button[type='submit']",
    "button[class*='send']"
  ] as const

  for (const selector of directCandidates) {
    const directButton = containerElement.querySelector(selector)
    if (directButton instanceof HTMLButtonElement && isVisibleElement(directButton)) {
      pinnedSendButtonElement = directButton
      return pinnedSendButtonElement
    }
  }

  const allVisibleButtons = Array.from(containerElement.querySelectorAll("button")).filter(
    (candidate): candidate is HTMLButtonElement =>
      candidate instanceof HTMLButtonElement &&
      isVisibleElement(candidate) &&
      candidate.getBoundingClientRect().width >= 24 &&
      candidate.getBoundingClientRect().height >= 24
  )

  if (allVisibleButtons.length === 0) {
    return null
  }

  allVisibleButtons.sort((firstButton, secondButton) => {
    const firstRect = firstButton.getBoundingClientRect()
    const secondRect = secondButton.getBoundingClientRect()
    if (firstRect.right === secondRect.right) {
      return firstRect.top - secondRect.top
    }
    return firstRect.right - secondRect.right
  })

  pinnedSendButtonElement = allVisibleButtons[allVisibleButtons.length - 1] ?? null
  return pinnedSendButtonElement
}

function resolveSourcesCounterWithin(
  containerElement: HTMLElement,
  sendButtonElement: HTMLButtonElement | null
): HTMLElement | null {
  if (
    pinnedSourceCounterElement &&
    pinnedSourceCounterElement.isConnected &&
    containerElement.contains(pinnedSourceCounterElement) &&
    isVisibleElement(pinnedSourceCounterElement)
  ) {
    return pinnedSourceCounterElement
  }

  const sourceCounterSelectors = [
    "[class*='selected-num-container']",
    "[class*='selected-num']",
    "[class*='source-count']"
  ] as const

  const sourceCandidateSet = new Set<HTMLElement>()
  for (const selector of sourceCounterSelectors) {
    for (const matchedElement of Array.from(containerElement.querySelectorAll(selector))) {
      if (matchedElement instanceof HTMLElement && isVisibleElement(matchedElement)) {
        sourceCandidateSet.add(matchedElement)
      }
    }
  }

  const fallbackElements = Array.from(containerElement.querySelectorAll("div, span, p"))
  for (const fallbackElement of fallbackElements) {
    if (!(fallbackElement instanceof HTMLElement) || !isVisibleElement(fallbackElement)) {
      continue
    }

    const normalizedText = String(fallbackElement.textContent ?? "").trim().toLowerCase()
    if (/\b\d+\s*(fontes?|sources?)\b/.test(normalizedText)) {
      sourceCandidateSet.add(fallbackElement)
    }
  }

  const sourceCandidates = Array.from(sourceCandidateSet)
  if (sourceCandidates.length === 0) {
    return null
  }

  const stickyCandidate = sourceCandidates.find(
    (candidate) => candidate.getAttribute(VOICE_SOURCE_SPACING_ATTRIBUTE) === "true"
  )
  if (stickyCandidate) {
    pinnedSourceCounterElement = stickyCandidate
    return pinnedSourceCounterElement
  }

  if (sendButtonElement) {
    const sendRect = sendButtonElement.getBoundingClientRect()
    sourceCandidates.sort((firstCandidate, secondCandidate) => {
      const firstRect = firstCandidate.getBoundingClientRect()
      const secondRect = secondCandidate.getBoundingClientRect()
      const firstDistance = Math.abs(sendRect.left - firstRect.right) + Math.abs(sendRect.top - firstRect.top) * 0.3
      const secondDistance = Math.abs(sendRect.left - secondRect.right) + Math.abs(sendRect.top - secondRect.top) * 0.3
      return firstDistance - secondDistance
    })

    pinnedSourceCounterElement = sourceCandidates[0] ?? null
    return pinnedSourceCounterElement
  }

  pinnedSourceCounterElement = sourceCandidates[0] ?? null
  return pinnedSourceCounterElement
}

function resolveComposerContainer(inputElement: EditableInputElement): HTMLElement | null {
  let ancestorCursor: HTMLElement | null = inputElement instanceof HTMLElement ? inputElement : null
  while (ancestorCursor && ancestorCursor !== document.body) {
    if (ancestorCursor.classList.contains("message-container") || ancestorCursor.className.includes("message-container")) {
      return ancestorCursor
    }

    const candidateSendButton = resolveSendButtonWithin(ancestorCursor)
    if (candidateSendButton) {
      return ancestorCursor
    }

    ancestorCursor = ancestorCursor.parentElement
  }

  const fallbackContainer = document.querySelector("div.message-container, div[class*='message-container']")
  return fallbackContainer instanceof HTMLElement ? fallbackContainer : inputElement.parentElement
}

function ensureMicrophoneMountPoint(sendButtonElement: HTMLButtonElement): HTMLElement {
  const existingAnchor = document.getElementById(VOICE_ANCHOR_ID)
  const microphoneMountPoint = existingAnchor instanceof HTMLElement ? existingAnchor : document.createElement("div")

  microphoneMountPoint.id = VOICE_ANCHOR_ID
  microphoneMountPoint.style.display = "inline-flex"
  microphoneMountPoint.style.alignItems = "center"
  microphoneMountPoint.style.justifyContent = "center"
  microphoneMountPoint.style.width = `${VOICE_BUTTON_SIZE}px`
  microphoneMountPoint.style.height = `${VOICE_BUTTON_SIZE}px`
  microphoneMountPoint.style.margin = "0 8px 0 0"
  microphoneMountPoint.style.padding = "0"
  microphoneMountPoint.style.flex = "0 0 auto"
  microphoneMountPoint.style.pointerEvents = "auto"
  microphoneMountPoint.style.position = "relative"
  microphoneMountPoint.style.left = "auto"
  microphoneMountPoint.style.top = "auto"
  microphoneMountPoint.style.zIndex = "auto"
  microphoneMountPoint.style.opacity = "1"
  microphoneMountPoint.style.visibility = "visible"

  const sendButtonParent = sendButtonElement.parentElement
  if (sendButtonParent instanceof HTMLElement) {
    if (microphoneMountPoint.parentElement !== sendButtonParent || microphoneMountPoint.nextElementSibling !== sendButtonElement) {
      sendButtonParent.insertBefore(microphoneMountPoint, sendButtonElement)
    }
  } else if (!microphoneMountPoint.isConnected) {
    document.body.appendChild(microphoneMountPoint)
  }

  return microphoneMountPoint
}

function clampToViewport(horizontalValue: number, minValue: number, maxValue: number): number {
  return Math.min(Math.max(horizontalValue, minValue), maxValue)
}

function positionMicrophoneMountPoint(
  microphoneMountPoint: HTMLElement,
  inputElement: EditableInputElement,
  sourceCounterElement: HTMLElement | null,
  sendButtonElement: HTMLButtonElement | null
): void {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const horizontalPadding = 6
  const verticalPadding = 6

  const safeLeftMin = horizontalPadding
  const safeLeftMax = Math.max(horizontalPadding, viewportWidth - VOICE_BUTTON_SIZE - horizontalPadding)
  const safeTopMin = verticalPadding
  const safeTopMax = Math.max(verticalPadding, viewportHeight - VOICE_BUTTON_SIZE - verticalPadding)

  const inputRect = inputElement.getBoundingClientRect()
  let sourceRect = sourceCounterElement?.getBoundingClientRect() ?? null
  let sendRect = sendButtonElement?.getBoundingClientRect() ?? null

  let calculatedLeft = inputRect.right - VOICE_BUTTON_SIZE - 56
  let calculatedTop = inputRect.top + (inputRect.height - VOICE_BUTTON_SIZE) / 2

  if (sourceRect && sendRect && sourceCounterElement && sendButtonElement) {
    const initialAvailableGap = sendRect.left - sourceRect.right
    ensureSourceCounterSpacing(sourceCounterElement, VOICE_LANE_MIN_GAP, initialAvailableGap)

    sourceRect = sourceCounterElement.getBoundingClientRect()
    sendRect = sendButtonElement.getBoundingClientRect()

    const availableGap = Math.max(0, sendRect.left - sourceRect.right)
    calculatedLeft = sourceRect.right + (availableGap - VOICE_BUTTON_SIZE) / 2
    calculatedTop = sendRect.top + (sendRect.height - VOICE_BUTTON_SIZE) / 2
  } else if (sendRect) {
    calculatedLeft = sendRect.left - VOICE_BUTTON_SIZE - 10
    calculatedTop = sendRect.top + (sendRect.height - VOICE_BUTTON_SIZE) / 2
  } else if (sourceRect) {
    calculatedLeft = sourceRect.right + 8
    calculatedTop = sourceRect.top + (sourceRect.height - VOICE_BUTTON_SIZE) / 2
  }

  microphoneMountPoint.style.left = `${clampToViewport(calculatedLeft, safeLeftMin, safeLeftMax)}px`
  microphoneMountPoint.style.top = `${clampToViewport(calculatedTop, safeTopMin, safeTopMax)}px`
}

function mountVoiceUi(): void {
  if (isMindDockModalOpen()) {
    clearVoiceInputMarkers()
    clearAllSourceCounterSpacing()
    if (mountedVoiceAnchor) {
      mountedVoiceAnchor.style.display = "none"
      mountedVoiceAnchor.style.left = "-9999px"
      mountedVoiceAnchor.style.top = "-9999px"
    }
    return
  }
  const notebookInputElement = resolveNotebookInputElement()
  if (!(notebookInputElement instanceof HTMLElement)) {
    clearAllSourceCounterSpacing()
    if (mountedVoiceAnchor) {
      mountedVoiceAnchor.style.display = "none"
      mountedVoiceAnchor.style.left = "-9999px"
      mountedVoiceAnchor.style.top = "-9999px"
    }
    return
  }

  clearVoiceInputMarkers()
  if (mountedVoiceAnchor) {
    mountedVoiceAnchor.style.display = ""
  }
  if (notebookInputElement instanceof HTMLTextAreaElement) {
    notebookInputElement.setAttribute(VOICE_TEXTAREA_ATTRIBUTE, "true")
  } else {
    notebookInputElement.setAttribute(VOICE_EDITABLE_ATTRIBUTE, "true")
  }

  const composerContainer = resolveComposerContainer(notebookInputElement)
  if (!(composerContainer instanceof HTMLElement)) {
    return
  }

  const sendButtonElement = resolveSendButtonWithin(composerContainer)
  clearAllSourceCounterSpacing()
  if (!(sendButtonElement instanceof HTMLButtonElement)) {
    if (mountedVoiceAnchor) {
      mountedVoiceAnchor.style.display = "none"
    }
    return
  }

  const microphoneMountPoint = ensureMicrophoneMountPoint(sendButtonElement)
  if (!(microphoneMountPoint instanceof HTMLElement)) {
    return
  }
  microphoneMountPoint.style.display = ""

  if (mountedVoiceRoot && mountedVoiceAnchor === microphoneMountPoint) {
    mountedVoiceRoot.render(
      createElement(VoiceDictationButton, {
        textareaSelector: VOICE_TEXTAREA_SELECTOR,
        editableSelector: VOICE_EDITABLE_SELECTOR
      })
    )
    return
  }

  if (mountedVoiceRoot) {
    mountedVoiceRoot.unmount()
    mountedVoiceRoot = null
    mountedVoiceAnchor = null
  }

  mountedVoiceAnchor = microphoneMountPoint
  mountedVoiceRoot = createRoot(microphoneMountPoint)
  mountedVoiceRoot.render(
    createElement(VoiceDictationButton, {
      textareaSelector: VOICE_TEXTAREA_SELECTOR,
      editableSelector: VOICE_EDITABLE_SELECTOR
    })
  )
}

function scheduleVoiceUiMount(): void {
  if (mountScheduleHandle !== null) {
    window.cancelAnimationFrame(mountScheduleHandle)
  }

  mountScheduleHandle = window.requestAnimationFrame(() => {
    mountScheduleHandle = null
    mountVoiceUi()
  })
}

function teardownVoiceAssistantUI(): void {
  voiceUiObserver?.disconnect()
  voiceUiObserver = null
  pinnedSendButtonElement = null
  pinnedSourceCounterElement = null

  window.removeEventListener("resize", scheduleVoiceUiMount)
  window.removeEventListener("scroll", scheduleVoiceUiMount, true)

  if (mountScheduleHandle !== null) {
    window.cancelAnimationFrame(mountScheduleHandle)
    mountScheduleHandle = null
  }

  if (mountedVoiceRoot) {
    mountedVoiceRoot.unmount()
    mountedVoiceRoot = null
  }

  if (mountedVoiceAnchor) {
    mountedVoiceAnchor.remove()
    mountedVoiceAnchor = null
  }

  clearAllSourceCounterSpacing()
  clearVoiceInputMarkers()
}

export function initializeVoiceAssistantUI(): void {
  if (!(document.body instanceof HTMLBodyElement)) {
    return
  }

  mountVoiceUi()

  if (!voiceUiObserver) {
    voiceUiObserver = new MutationObserver(() => {
      scheduleVoiceUiMount()
    })
  }

  voiceUiObserver.observe(document.body, {
    childList: true,
    subtree: true
  })

  window.addEventListener("resize", scheduleVoiceUiMount)
  window.addEventListener("scroll", scheduleVoiceUiMount, true)
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initializeVoiceAssistantUI, { once: true })
} else {
  initializeVoiceAssistantUI()
}

window.addEventListener("pagehide", teardownVoiceAssistantUI)
window.addEventListener("beforeunload", teardownVoiceAssistantUI)




