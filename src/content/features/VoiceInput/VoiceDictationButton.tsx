import { useCallback, useEffect, useRef } from "react"
import { injectTextIntoReactTextarea } from "./domUtils"
import { useSpeechRecognition } from "./useSpeechRecognition"

const VOICE_BUTTON_STYLE_ID = "nblm-voice-button-style"

interface VoiceDictationButtonProps {
  textareaSelector?: string
  editableSelector?: string
}

function ensureVoiceButtonStyles(): void {
  if (document.getElementById(VOICE_BUTTON_STYLE_ID)) {
    return
  }

  const styleElement = document.createElement("style")
  styleElement.id = VOICE_BUTTON_STYLE_ID
  styleElement.textContent = `
    .nblm-voice-button {
      width: 34px;
      height: 34px;
      border-radius: 9999px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.85);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      pointer-events: auto;
      transition: transform 120ms ease, background-color 120ms ease, border-color 120ms ease;
      flex: 0 0 auto;
    }

    .nblm-voice-button:hover {
      transform: translateY(-1px);
      background: rgba(255, 255, 255, 0.16);
    }

    .nblm-voice-button--listening {
      background: #facc15;
      border-color: #f59e0b;
      color: #111827;
      animation: nblm-voice-pulse 1.2s infinite;
    }

    .nblm-voice-button--error {
      border-color: #ef4444;
    }

    @keyframes nblm-voice-pulse {
      0% {
        box-shadow: 0 0 0 0 rgba(250, 204, 21, 0.45);
      }
      70% {
        box-shadow: 0 0 0 10px rgba(250, 204, 21, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(250, 204, 21, 0);
      }
    }
  `

  document.head.appendChild(styleElement)
}

function resolveClosestTextareaCandidate(buttonElement: HTMLButtonElement | null): HTMLTextAreaElement | null {
  if (!buttonElement) {
    return null
  }

  const searchRoots: Element[] = []
  const nearestContainer = buttonElement.closest("form, section, main, div")
  if (nearestContainer) {
    searchRoots.push(nearestContainer)
  }

  let parentCursor: Element | null = buttonElement.parentElement
  while (parentCursor) {
    searchRoots.push(parentCursor)
    parentCursor = parentCursor.parentElement
  }

  for (const searchRoot of searchRoots) {
    const textareaElement = searchRoot.querySelector("textarea")
    if (textareaElement instanceof HTMLTextAreaElement) {
      return textareaElement
    }
  }

  return null
}

function resolveClosestEditableCandidate(buttonElement: HTMLButtonElement | null): HTMLElement | null {
  if (!buttonElement) {
    return null
  }

  const editableSelector = "[contenteditable='true'][role='textbox'], [contenteditable='true']"
  const searchRoots: Element[] = []
  const nearestContainer = buttonElement.closest("form, section, main, div")
  if (nearestContainer) {
    searchRoots.push(nearestContainer)
  }

  let parentCursor: Element | null = buttonElement.parentElement
  while (parentCursor) {
    searchRoots.push(parentCursor)
    parentCursor = parentCursor.parentElement
  }

  for (const searchRoot of searchRoots) {
    const editableElement = searchRoot.querySelector(editableSelector)
    if (editableElement instanceof HTMLElement) {
      return editableElement
    }
  }

  return null
}

function placeCaretAtEditableEnd(editableElement: HTMLElement): void {
  const activeSelection = window.getSelection()
  if (!activeSelection) {
    return
  }

  const range = document.createRange()
  range.selectNodeContents(editableElement)
  range.collapse(false)
  activeSelection.removeAllRanges()
  activeSelection.addRange(range)
}

function injectTextIntoContentEditable(editableElement: HTMLElement, textToInject: string): void {
  editableElement.textContent = textToInject
  try {
    editableElement.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        data: textToInject,
        inputType: "insertText"
      })
    )
  } catch {
    editableElement.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }))
  }
  editableElement.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }))
}

function buildMergedVoiceText(baseText: string, separator: string, spokenText: string): string {
  const normalizedSpokenText = spokenText.trim()
  if (!normalizedSpokenText) {
    return baseText
  }

  return `${baseText}${separator}${normalizedSpokenText}`
}

export function VoiceDictationButton({ textareaSelector, editableSelector }: VoiceDictationButtonProps) {
  const { isListening, transcript, error, startListening, stopListening } = useSpeechRecognition()
  const microphoneButtonRef = useRef<HTMLButtonElement | null>(null)
  const lastAppliedTranscriptRef = useRef<string>("")
  const activeTextareaTargetRef = useRef<HTMLTextAreaElement | null>(null)
  const activeEditableTargetRef = useRef<HTMLElement | null>(null)
  const sessionBaseTextRef = useRef<string>("")
  const sessionSeparatorRef = useRef<string>("")

  useEffect(() => {
    ensureVoiceButtonStyles()
  }, [])

  const resolveTargetTextarea = useCallback((): HTMLTextAreaElement | null => {
    if (textareaSelector) {
      const selectedTextarea = document.querySelector(textareaSelector)
      if (selectedTextarea instanceof HTMLTextAreaElement) {
        return selectedTextarea
      }
    }

    const closestTextarea = resolveClosestTextareaCandidate(microphoneButtonRef.current)
    if (closestTextarea) {
      return closestTextarea
    }

    const fallbackTextarea = document.querySelector("main textarea, textarea")
    return fallbackTextarea instanceof HTMLTextAreaElement ? fallbackTextarea : null
  }, [textareaSelector])

  const resolveTargetEditable = useCallback((): HTMLElement | null => {
    if (editableSelector) {
      const selectedEditableElement = document.querySelector(editableSelector)
      if (selectedEditableElement instanceof HTMLElement) {
        return selectedEditableElement
      }
    }

    const closestEditable = resolveClosestEditableCandidate(microphoneButtonRef.current)
    if (closestEditable) {
      return closestEditable
    }

    const fallbackEditable = document.querySelector("[contenteditable='true'][role='textbox'], [contenteditable='true']")
    return fallbackEditable instanceof HTMLElement ? fallbackEditable : null
  }, [editableSelector])

  useEffect(() => {
    const normalizedTranscript = transcript.trim()
    if (isListening && !normalizedTranscript) {
      return
    }

    if (lastAppliedTranscriptRef.current === normalizedTranscript) {
      return
    }

    const chatTextareaElement = activeTextareaTargetRef.current ?? resolveTargetTextarea()
    if (chatTextareaElement) {
      const mergedTextareaText = buildMergedVoiceText(
        sessionBaseTextRef.current,
        sessionSeparatorRef.current,
        normalizedTranscript
      )
      if (chatTextareaElement.value !== mergedTextareaText) {
        injectTextIntoReactTextarea(chatTextareaElement, mergedTextareaText)
      }
      if (document.activeElement !== chatTextareaElement) {
        chatTextareaElement.focus()
      }

      const caretPosition = mergedTextareaText.length
      chatTextareaElement.setSelectionRange(caretPosition, caretPosition)
      lastAppliedTranscriptRef.current = normalizedTranscript
      if (!isListening) {
        activeTextareaTargetRef.current = null
        activeEditableTargetRef.current = null
      }
      return
    }

    const chatEditableElement = activeEditableTargetRef.current ?? resolveTargetEditable()
    if (!(chatEditableElement instanceof HTMLElement)) {
      return
    }

    const mergedEditableText = buildMergedVoiceText(
      sessionBaseTextRef.current,
      sessionSeparatorRef.current,
      normalizedTranscript
    )
    if (document.activeElement !== chatEditableElement) {
      chatEditableElement.focus()
    }
    placeCaretAtEditableEnd(chatEditableElement)
    if ((chatEditableElement.textContent ?? "") !== mergedEditableText) {
      injectTextIntoContentEditable(chatEditableElement, mergedEditableText)
    }
    placeCaretAtEditableEnd(chatEditableElement)
    lastAppliedTranscriptRef.current = normalizedTranscript
    if (!isListening) {
      activeTextareaTargetRef.current = null
      activeEditableTargetRef.current = null
    }
  }, [isListening, resolveTargetEditable, resolveTargetTextarea, transcript])

  const handleVoiceToggle = useCallback(() => {
    if (isListening) {
      stopListening()
      return
    }

    const preferredTextareaTarget = resolveTargetTextarea()
    const preferredEditableTarget = preferredTextareaTarget ? null : resolveTargetEditable()
    activeTextareaTargetRef.current = preferredTextareaTarget
    activeEditableTargetRef.current = preferredEditableTarget

    if (preferredTextareaTarget) {
      const baseTextareaText = preferredTextareaTarget.value || ""
      sessionBaseTextRef.current = baseTextareaText
      sessionSeparatorRef.current = baseTextareaText.length > 0 && !/\s$/.test(baseTextareaText) ? " " : ""
      if (document.activeElement !== preferredTextareaTarget) {
        preferredTextareaTarget.focus()
      }
      const caretPosition = preferredTextareaTarget.value.length
      preferredTextareaTarget.setSelectionRange(caretPosition, caretPosition)
    } else if (preferredEditableTarget) {
      const baseEditableText = preferredEditableTarget.textContent ?? ""
      sessionBaseTextRef.current = baseEditableText
      sessionSeparatorRef.current = baseEditableText.length > 0 && !/\s$/.test(baseEditableText) ? " " : ""
      if (document.activeElement !== preferredEditableTarget) {
        preferredEditableTarget.focus()
      }
      placeCaretAtEditableEnd(preferredEditableTarget)
    } else {
      sessionBaseTextRef.current = ""
      sessionSeparatorRef.current = ""
    }

    lastAppliedTranscriptRef.current = ""
    startListening()
  }, [isListening, resolveTargetEditable, resolveTargetTextarea, startListening, stopListening])

  const buttonClassName = [
    "nblm-voice-button",
    isListening ? "nblm-voice-button--listening" : "",
    error ? "nblm-voice-button--error" : ""
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <button
      ref={microphoneButtonRef}
      type="button"
      className={buttonClassName}
      aria-label={isListening ? "Stop voice dictation" : "Start voice dictation"}
      title={error ? `Voice input error: ${error}` : "Voice dictation"}
      onClick={handleVoiceToggle}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 3.5C10.067 3.5 8.5 5.067 8.5 7V12C8.5 13.933 10.067 15.5 12 15.5C13.933 15.5 15.5 13.933 15.5 12V7C15.5 5.067 13.933 3.5 12 3.5Z"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <path
          d="M5.5 11.5C5.5 15.09 8.41 18 12 18C15.59 18 18.5 15.09 18.5 11.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path d="M12 18V21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  )
}
