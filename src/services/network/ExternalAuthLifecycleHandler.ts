import { SecureTokenVault } from "../security/SecureTokenVault"
import { SilentTelemetryEngine, silentTelemetryEngine } from "./SilentTelemetryEngine"

export class AuthExpiredException extends Error {
  constructor(message = "Sessao externa expirada. Reautenticacao necessaria.") {
    super(message)
    this.name = "AuthExpiredException"
  }
}

export class ExternalServiceException extends Error {
  constructor(message = "Servico de destino indisponivel.") {
    super(message)
    this.name = "ExternalServiceException"
  }
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim()
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const responseText = await response.text()
  if (!responseText.trim()) {
    return null
  }

  const responseContentType = normalizeText(response.headers.get("content-type")).toLowerCase()
  if (responseContentType.includes("application/json")) {
    try {
      return JSON.parse(responseText) as unknown
    } catch {
      return responseText
    }
  }

  try {
    return JSON.parse(responseText) as unknown
  } catch {
    return responseText
  }
}

function buildSafeDiagnosticContext(payloadContext: unknown): { endpointUrl: string; platformName: string } {
  const contextRecord =
    typeof payloadContext === "object" && payloadContext !== null ? (payloadContext as Record<string, unknown>) : {}

  return {
    endpointUrl: normalizeText(contextRecord.endpointUrl ?? contextRecord.endpoint ?? contextRecord.url),
    platformName: normalizeText(contextRecord.platformName ?? contextRecord.platform)
  }
}

export class ExternalAuthLifecycleHandler {
  constructor(private readonly telemetryEngine: SilentTelemetryEngine = silentTelemetryEngine) {}

  async evaluateRpcResponse(response: Response, payloadContext: any): Promise<unknown> {
    const statusCode = Number(response.status)
    const safeDiagnosticContext = buildSafeDiagnosticContext(payloadContext)

    if (statusCode === 200 || statusCode === 201) {
      return parseResponseBody(response)
    }

    if (statusCode === 401 || statusCode === 403) {
      try {
        await SecureTokenVault.purgeStoredCredentials()
      } catch {
        // Silent by design: auth cleanup failure cannot mask auth expiration.
      }

      this.telemetryEngine.logRemoteDiagnostic("AUTH_EXPIRED", statusCode, safeDiagnosticContext)
      throw new AuthExpiredException("Sessao externa expirada. Reautenticacao necessaria.")
    }

    if (statusCode >= 500) {
      this.telemetryEngine.logRemoteDiagnostic("EXTERNAL_SERVER_ERROR", statusCode, safeDiagnosticContext)
      throw new ExternalServiceException("Servico de destino indisponivel.")
    }

    this.telemetryEngine.logRemoteDiagnostic("EXTERNAL_UNEXPECTED_STATUS", statusCode, safeDiagnosticContext)
    throw new ExternalServiceException(`Falha na chamada RPC externa (status ${statusCode}).`)
  }
}

export const externalAuthLifecycleHandler = new ExternalAuthLifecycleHandler()
