import { getTelemetryErrorsEndpoint } from "./networkConfig"

const TELEMETRY_TIMEOUT_MS = 4000

interface SafeTelemetryContext {
  endpointUrl: string
  platformName: string
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim()
}

function normalizeStatusCode(value: unknown): number {
  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 0
}

function sanitizeEndpointUrl(rawValue: unknown): string {
  const normalizedValue = normalizeText(rawValue)
  if (!normalizedValue) {
    return "unknown_endpoint"
  }

  const withoutQuery = normalizedValue.split("?")[0]?.split("#")[0] ?? ""
  const normalizedWithoutQuery = normalizeText(withoutQuery)
  if (!normalizedWithoutQuery) {
    return "unknown_endpoint"
  }

  try {
    const parsedUrl = new URL(normalizedWithoutQuery)
    return `${parsedUrl.origin}${parsedUrl.pathname}`
  } catch {
    if (normalizedWithoutQuery.startsWith("/")) {
      return normalizedWithoutQuery
    }
    return "unknown_endpoint"
  }
}

function sanitizePlatformName(rawValue: unknown): string {
  const normalizedValue = normalizeText(rawValue).toLowerCase()
  if (!normalizedValue) {
    return "unknown_platform"
  }

  const safePlatformName = normalizedValue.replace(/[^a-z0-9_]/g, "_")
  return safePlatformName || "unknown_platform"
}

function extractSafeContext(inputContext: unknown): SafeTelemetryContext {
  const contextRecord = typeof inputContext === "object" && inputContext !== null ? (inputContext as Record<string, unknown>) : {}

  const endpointCandidate = contextRecord.endpointUrl ?? contextRecord.endpoint ?? contextRecord.url
  const platformCandidate = contextRecord.platformName ?? contextRecord.platform

  return {
    endpointUrl: sanitizeEndpointUrl(endpointCandidate),
    platformName: sanitizePlatformName(platformCandidate)
  }
}

export class SilentTelemetryEngine {
  private static singletonInstance: SilentTelemetryEngine | null = null

  private constructor() {}

  static getInstance(): SilentTelemetryEngine {
    if (!SilentTelemetryEngine.singletonInstance) {
      SilentTelemetryEngine.singletonInstance = new SilentTelemetryEngine()
    }

    return SilentTelemetryEngine.singletonInstance
  }

  logRemoteDiagnostic(errorType: string, statusCode: number, context: object): void {
    const safeContext = extractSafeContext(context)
    const normalizedErrorType = normalizeText(errorType) || "UNKNOWN_ERROR"
    const normalizedStatusCode = normalizeStatusCode(statusCode)

    const telemetryPayload = {
      errorType: normalizedErrorType,
      statusCode: normalizedStatusCode,
      context: safeContext,
      createdAt: new Date().toISOString()
    }

    const abortController = typeof AbortController === "function" ? new AbortController() : null
    const timeoutId =
      abortController !== null
        ? setTimeout(() => {
            abortController.abort()
          }, TELEMETRY_TIMEOUT_MS)
        : null

    try {
      void fetch(getTelemetryErrorsEndpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(telemetryPayload),
        keepalive: true,
        signal: abortController?.signal
      })
        .catch(() => {
          // Silent by design: telemetry failure must never impact user flow.
        })
        .finally(() => {
          if (timeoutId !== null) {
            clearTimeout(timeoutId)
          }
        })
    } catch {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }
    }
  }
}

export const silentTelemetryEngine = SilentTelemetryEngine.getInstance()
