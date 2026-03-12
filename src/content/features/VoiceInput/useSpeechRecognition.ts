import { useCallback, useEffect, useRef, useState } from "react"

interface BrowserSpeechRecognitionAlternative {
  transcript: string
}

interface BrowserSpeechRecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: BrowserSpeechRecognitionAlternative
}

interface BrowserSpeechRecognitionResultList {
  readonly length: number
  [index: number]: BrowserSpeechRecognitionResult
}

interface BrowserSpeechRecognitionResultEvent extends Event {
  readonly results: BrowserSpeechRecognitionResultList
}

interface BrowserSpeechRecognitionErrorEvent extends Event {
  readonly error: string
}

interface BrowserSpeechRecognitionInstance extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: BrowserSpeechRecognitionResultEvent) => void) | null
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null
  onend: ((event: Event) => void) | null
  start: () => void
  stop: () => void
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognitionInstance

interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: BrowserSpeechRecognitionConstructor
  webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor
}

interface UseSpeechRecognitionResult {
  isListening: boolean
  transcript: string
  error: string | null
  startListening: () => void
  stopListening: () => void
}

function resolveSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null
  }

  const speechWindow = window as SpeechRecognitionWindow
  return speechWindow.webkitSpeechRecognition ?? speechWindow.SpeechRecognition ?? null
}

function normalizeSpeechRecognitionError(rawError: unknown): string {
  const normalizedError = String(rawError ?? "").trim().toLowerCase()
  if (!normalizedError) {
    return "Speech recognition failed."
  }

  if (normalizedError.includes("not-allowed") || normalizedError.includes("service-not-allowed")) {
    return "Microphone permission denied. Allow microphone access for NotebookLM."
  }

  if (normalizedError.includes("no-speech")) {
    return "No speech detected. Try speaking closer to the microphone."
  }

  if (normalizedError.includes("audio-capture")) {
    return "No microphone device was found."
  }

  if (normalizedError.includes("network")) {
    return "Speech recognition network error."
  }

  return normalizedError
}

export function useSpeechRecognition(): UseSpeechRecognitionResult {
  const recognitionRef = useRef<BrowserSpeechRecognitionInstance | null>(null)
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [error, setError] = useState<string | null>(null)

  const createRecognitionSession = useCallback((): BrowserSpeechRecognitionInstance | null => {
    const recognitionConstructor = resolveSpeechRecognitionConstructor()
    if (!recognitionConstructor) {
      return null
    }

    return new recognitionConstructor()
  }, [])

  const startListening = useCallback(() => {
    const existingSession = recognitionRef.current
    if (existingSession) {
      try {
        existingSession.stop()
      } catch {
        // Ignore state mismatch while replacing recognition session.
      }
      recognitionRef.current = null
    }

    const activeTranscriptionSession = createRecognitionSession()
    if (!activeTranscriptionSession) {
      setError("Speech recognition is not supported in this browser.")
      setIsListening(false)
      return
    }

    activeTranscriptionSession.continuous = false
    activeTranscriptionSession.interimResults = true
    activeTranscriptionSession.lang = navigator.language || "en-US"

    activeTranscriptionSession.onresult = (speechEvent) => {
      let currentTranscript = ""

      for (let resultIndex = 0; resultIndex < speechEvent.results.length; resultIndex += 1) {
        const speechResult = speechEvent.results[resultIndex]
        if (!speechResult || speechResult.length === 0) {
          continue
        }

        currentTranscript += speechResult[0].transcript
      }

      setTranscript(currentTranscript.trim())
    }

    activeTranscriptionSession.onerror = (speechErrorEvent) => {
      const friendlyErrorMessage = normalizeSpeechRecognitionError(speechErrorEvent.error)
      setError(friendlyErrorMessage)
      recognitionRef.current = null
      setIsListening(false)
    }

    activeTranscriptionSession.onend = () => {
      recognitionRef.current = null
      setIsListening(false)
    }

    setTranscript("")
    setError(null)

    try {
      recognitionRef.current = activeTranscriptionSession
      activeTranscriptionSession.start()
      setIsListening(true)
    } catch (startFailure) {
      recognitionRef.current = null
      const failureMessage =
        startFailure instanceof Error ? normalizeSpeechRecognitionError(startFailure.message) : "Failed to start speech recognition."
      setError(failureMessage)
      setIsListening(false)
    }
  }, [createRecognitionSession])

  const stopListening = useCallback(() => {
    const activeTranscriptionSession = recognitionRef.current
    if (!activeTranscriptionSession) {
      setIsListening(false)
      return
    }

    try {
      activeTranscriptionSession.stop()
    } catch {
      // Ignore invalid stop transitions from browser recognition engines.
    } finally {
      setIsListening(false)
    }
  }, [])

  useEffect(() => {
    return () => {
      const activeTranscriptionSession = recognitionRef.current
      if (!activeTranscriptionSession) {
        return
      }

      activeTranscriptionSession.onresult = null
      activeTranscriptionSession.onerror = null
      activeTranscriptionSession.onend = null

      try {
        activeTranscriptionSession.stop()
      } catch {
        // Ignore teardown failures from recognition engine.
      }

      recognitionRef.current = null
    }
  }, [])

  return {
    isListening,
    transcript,
    error,
    startListening,
    stopListening
  }
}
