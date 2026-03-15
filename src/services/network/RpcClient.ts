import { SessionTokenVault, sessionTokenVault } from "./SessionTokenVault"
import { ExternalAuthLifecycleHandler, externalAuthLifecycleHandler } from "./ExternalAuthLifecycleHandler"

function resolvePlatformName(endpointUrl: string): string {
  try {
    const normalizedHost = new URL(endpointUrl).hostname.toLowerCase()
    if (normalizedHost.includes("chatgpt")) {
      return "chatgpt_platform"
    }
    if (normalizedHost.includes("claude")) {
      return "claude_platform"
    }
    if (normalizedHost.includes("gemini")) {
      return "gemini_platform"
    }
    return "generic_platform"
  } catch {
    return "generic_platform"
  }
}

export class RpcClient {
  constructor(
    private readonly vault: SessionTokenVault = sessionTokenVault,
    private readonly lifecycleHandler: ExternalAuthLifecycleHandler = externalAuthLifecycleHandler
  ) {}

  async executeRpcCall<TResponse = unknown>(endpoint: string, payload: unknown): Promise<TResponse> {
    if (!this.vault.hasValidTokens()) {
      await this.vault.getTokens()
    }

    if (!this.vault.hasValidTokens()) {
      throw new Error("MISSING_AUTH_TOKENS")
    }

    const normalizedEndpoint = String(endpoint ?? "").trim()
    if (!normalizedEndpoint) {
      throw new Error("INVALID_RPC_ENDPOINT")
    }

    const activeTokens = await this.vault.getTokens()
    if (!activeTokens) {
      throw new Error("MISSING_AUTH_TOKENS")
    }

    let response: Response
    try {
      response = await fetch(normalizedEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Primary-Token": activeTokens.primaryToken,
          "X-Secondary-Token": activeTokens.secondaryToken
        },
        body: JSON.stringify(payload)
      })
    } catch {
      throw new Error("RPC_CALL_FAILED: NETWORK")
    }

    const evaluatedPayload = await this.lifecycleHandler.evaluateRpcResponse(response, {
      endpointUrl: normalizedEndpoint,
      platformName: resolvePlatformName(normalizedEndpoint)
    })

    return evaluatedPayload as TResponse
  }
}

export const rpcClient = new RpcClient()
