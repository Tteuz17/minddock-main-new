import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["https://notebooklm.google.com/*"],
  run_at: "document_start"
}

interface InterceptedTokenPayload {
  at?: unknown
  bl?: unknown
  accountEmail?: unknown
  authUser?: unknown
}

interface InterceptMessageEventData {
  payload?: InterceptedTokenPayload
  type?: unknown
}

interface RelayTokensPayload {
  at?: string
  bl?: string
  accountEmail?: string
  authUser?: string
}

const INTERCEPT_MESSAGE_TYPE = "MINDDOCK_INTERCEPT"
const RELAY_MESSAGE_TYPE = "TOKENS_UPDATED"

let lastForwardedSignature = ""
let relayTimerId: number | null = null
let pendingPayload: RelayTokensPayload | null = null

function normalizeString(value: unknown): string {
  return String(value ?? "").trim()
}

function buildTokenSignature(payload: RelayTokensPayload): string {
  return JSON.stringify({
    at: normalizeString(payload.at),
    bl: normalizeString(payload.bl),
    accountEmail: normalizeString(payload.accountEmail),
    authUser: normalizeString(payload.authUser)
  })
}

function flushPendingPayload(): void {
  const runtimeApi = typeof chrome !== "undefined" ? chrome.runtime : undefined
  const nextPayload = pendingPayload

  pendingPayload = null
  relayTimerId = null

  if (!nextPayload?.at && !nextPayload?.bl) {
    return
  }

  if (!runtimeApi?.sendMessage) {
    console.warn("[MindDock Relay] chrome.runtime.sendMessage unavailable.")
    return
  }

  try {
    runtimeApi.sendMessage(
      {
        type: RELAY_MESSAGE_TYPE,
        payload: nextPayload
      },
      () => {
        void chrome.runtime?.lastError
      }
    )

    console.log("[MindDock Relay] Tokens forwarded to background.")
  } catch (error) {
    console.warn("[MindDock Relay] Failed to forward tokens.", error)
  }
}

function scheduleForward(payload: RelayTokensPayload): void {
  const signature = buildTokenSignature(payload)
  if (!payload.at && !payload.bl) {
    return
  }

  if (signature === lastForwardedSignature) {
    return
  }

  lastForwardedSignature = signature
  pendingPayload = payload

  if (relayTimerId !== null) {
    window.clearTimeout(relayTimerId)
  }

  relayTimerId = window.setTimeout(() => {
    flushPendingPayload()
  }, 80)
}

function handleMessage(event: MessageEvent<unknown>): void {
  if (event.source !== window) {
    return
  }

  const eventData =
    typeof event.data === "object" && event.data !== null
      ? (event.data as InterceptMessageEventData)
      : null
  if (!eventData || normalizeString(eventData.type) !== INTERCEPT_MESSAGE_TYPE) {
    return
  }

  const payloadRecord =
    typeof eventData.payload === "object" && eventData.payload !== null ? eventData.payload : {}
  const payload: RelayTokensPayload = {
    at: normalizeString(payloadRecord.at) || undefined,
    bl: normalizeString(payloadRecord.bl) || undefined,
    accountEmail: normalizeString(payloadRecord.accountEmail) || undefined,
    authUser: normalizeString((payloadRecord as Record<string, unknown>).authUser) || undefined
  }

  scheduleForward(payload)
}

window.addEventListener("message", handleMessage)
