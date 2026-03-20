import { tokenStorage } from "../storage/TokenStorage"

const ENDPOINT = "https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute"
const ANTI_HIJACK_PREFIX = ")]}'"
const TOKEN_RETRY_DELAY_MS = 500

export interface GoogleRPCResponse {
  parsedPayload: unknown | null
  rawText: string
  sanitizedText: string
}

function stripAntiHijackPrefix(value: string): string {
  const trimmedValue = String(value ?? "").trim()

  if (!trimmedValue.startsWith(ANTI_HIJACK_PREFIX)) {
    return trimmedValue
  }

  return trimmedValue.slice(ANTI_HIJACK_PREFIX.length).trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseResponsePayload(responseText: string): unknown | null {
  const normalizedResponse = String(responseText ?? "").trim()
  if (!normalizedResponse) {
    return null
  }

  const candidateLines = normalizedResponse
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("[") || line.startsWith("{"))

  for (const line of candidateLines) {
    try {
      return JSON.parse(line) as unknown
    } catch {
      // Keep scanning until a valid JSON segment is found.
    }
  }

  try {
    return JSON.parse(normalizedResponse) as unknown
  } catch {
    return null
  }
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs)
  })
}

export class GoogleRPC {
  async execute(
    rpcId: string,
    payload: unknown[],
    options?: {
      sourcePath?: string
      fSid?: string
      hl?: string
      socApp?: string
      socPlatform?: string
      socDevice?: string
      bl?: string
      at?: string
    }
  ): Promise<GoogleRPCResponse> {
    const normalizedRpcId = String(rpcId ?? "").trim()
    if (!normalizedRpcId) {
      throw new Error("INVALID_RPC_ID")
    }

    console.log("Checking tokens in storage...")

    let tokens = await tokenStorage.getTokens()
    if (!tokens?.at || !tokens?.bl) {
      console.warn("[GoogleRPC] Tokens missing via RAM, retrying disk read...")
      await delay(TOKEN_RETRY_DELAY_MS)
      tokens = await tokenStorage.getTokens()
    }

    const atToken = options?.at ?? tokens?.at
    const blToken = options?.bl ?? tokens?.bl

    if (!atToken || !blToken) {
      throw new Error("MISSING_AUTH")
    }

    const requestPayload = JSON.stringify([
      [[normalizedRpcId, JSON.stringify(payload), null, "generic"]]
    ])

    const requestUrl = new URL(ENDPOINT)
    requestUrl.searchParams.set("rpcids", normalizedRpcId)
    requestUrl.searchParams.set("bl", blToken)
    const sourcePath = options?.sourcePath ?? "/"
    requestUrl.searchParams.set("source-path", sourcePath)
    requestUrl.searchParams.set("rt", "c")
    if (options?.fSid) requestUrl.searchParams.set("f.sid", options.fSid)
    if (options?.hl) requestUrl.searchParams.set("hl", options.hl)
    if (options?.socApp) requestUrl.searchParams.set("soc-app", options.socApp)
    if (options?.socPlatform) requestUrl.searchParams.set("soc-platform", options.socPlatform)
    if (options?.socDevice) requestUrl.searchParams.set("soc-device", options.socDevice)
    if (options?.bl) {
      requestUrl.searchParams.set("bl", options.bl)
    }

    if (tokens.authUser && String(tokens.authUser).trim()) {
      requestUrl.searchParams.set("authuser", String(tokens.authUser).trim())
    }

    let response: Response

    try {
      response = await fetch(requestUrl.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
        },
        credentials: "include",
        body: new URLSearchParams({
          "f.req": requestPayload,
          at: atToken
        })
      })
    } catch (error) {
      throw new Error(
        error instanceof Error && error.message ? error.message : "RPC_NETWORK_ERROR"
      )
    }

    if (!response.ok) {
      throw new Error(`RPC_HTTP_${response.status}`)
    }

    const rawText = await response.text()
    const cleanedText = stripAntiHijackPrefix(rawText)
    if (!cleanedText) {
      throw new Error("RPC_EMPTY_RESULT")
    }

    if (/^\s*</.test(cleanedText) || /<html[\s>]/i.test(cleanedText)) {
      throw new Error("RPC_UNEXPECTED_HTML")
    }

    const parsedPayload = parseResponsePayload(cleanedText)
    if (parsedPayload !== null && !Array.isArray(parsedPayload) && !isRecord(parsedPayload)) {
      return {
        rawText,
        sanitizedText: cleanedText,
        parsedPayload
      }
    }

    return {
      rawText,
      sanitizedText: cleanedText,
      parsedPayload
    }
  }
}

export const googleRpc = new GoogleRPC()
