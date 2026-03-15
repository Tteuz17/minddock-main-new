const DEFAULT_EXTERNAL_EXPORT_RPC_ENDPOINT = "https://api.nosso-saas.com/v1/rpc/export"
const DEFAULT_TELEMETRY_ERRORS_ENDPOINT = "https://api.nosso-saas.com/v1/telemetry/errors"

function normalizeText(value: unknown): string {
  return String(value ?? "").trim()
}

function resolveAbsoluteEndpoint(candidateValue: unknown, fallbackValue: string): string {
  const normalizedCandidate = normalizeText(candidateValue)
  if (!normalizedCandidate) {
    return fallbackValue
  }

  try {
    return new URL(normalizedCandidate).toString()
  } catch {
    return fallbackValue
  }
}

export function getExternalExportRpcEndpoint(): string {
  return resolveAbsoluteEndpoint(
    process.env.PLASMO_PUBLIC_EXTERNAL_EXPORT_RPC_ENDPOINT,
    DEFAULT_EXTERNAL_EXPORT_RPC_ENDPOINT
  )
}

export function getTelemetryErrorsEndpoint(): string {
  return resolveAbsoluteEndpoint(
    process.env.PLASMO_PUBLIC_TELEMETRY_ERRORS_ENDPOINT,
    DEFAULT_TELEMETRY_ERRORS_ENDPOINT
  )
}
