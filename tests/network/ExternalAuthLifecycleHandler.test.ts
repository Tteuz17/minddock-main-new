import assert from "node:assert/strict"
import {
  AuthExpiredException,
  ExternalAuthLifecycleHandler,
  ExternalServiceException
} from "../../src/services/network/ExternalAuthLifecycleHandler"
import { SecureTokenVault } from "../../src/services/security/SecureTokenVault"

interface DiagnosticEvent {
  errorType: string
  statusCode: number
  context: object
}

class TelemetryProbe {
  readonly events: DiagnosticEvent[] = []

  logRemoteDiagnostic(errorType: string, statusCode: number, context: object): void {
    this.events.push({
      errorType,
      statusCode,
      context
    })
  }
}

function createJsonResponse(statusCode: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: {
      "content-type": "application/json"
    }
  })
}

async function runCase(caseName: string, testFn: () => Promise<void>): Promise<void> {
  try {
    await testFn()
    console.log(`[PASS] ${caseName}`)
  } catch (error) {
    console.error(`[FAIL] ${caseName}`)
    console.error(error)
    throw error
  }
}

async function testSuccess200Case(): Promise<void> {
  const telemetryProbe = new TelemetryProbe()
  const lifecycleHandler = new ExternalAuthLifecycleHandler(telemetryProbe as never)

  const responsePayload = await lifecycleHandler.evaluateRpcResponse(
    createJsonResponse(200, { accepted: true }),
    { endpointUrl: "https://api.example.com/rpc/export", platformName: "chatgpt_platform" }
  )

  assert.deepEqual(responsePayload, { accepted: true })
  assert.equal(telemetryProbe.events.length, 0)
}

async function testAuthExpired401Case(): Promise<void> {
  const telemetryProbe = new TelemetryProbe()
  const lifecycleHandler = new ExternalAuthLifecycleHandler(telemetryProbe as never)

  let purgeCallCount = 0
  const mutableSecureVault = SecureTokenVault as unknown as {
    purgeStoredCredentials: () => Promise<void>
  }
  const originalPurgeMethod = mutableSecureVault.purgeStoredCredentials
  mutableSecureVault.purgeStoredCredentials = async () => {
    purgeCallCount += 1
  }

  try {
    await assert.rejects(
      () =>
        lifecycleHandler.evaluateRpcResponse(createJsonResponse(401, { message: "expired" }), {
          endpointUrl: "https://api.example.com/private/rpc/export?token=masked",
          platformName: "chatgpt_platform",
          userEmail: "hidden@example.com"
        }),
      (error: unknown) => {
        assert.ok(error instanceof AuthExpiredException)
        assert.equal(error.message, "Sessao externa expirada. Reautenticacao necessaria.")
        return true
      }
    )
  } finally {
    mutableSecureVault.purgeStoredCredentials = originalPurgeMethod
  }

  assert.equal(purgeCallCount, 1)
  assert.equal(telemetryProbe.events.length, 1)
  assert.equal(telemetryProbe.events[0]?.errorType, "AUTH_EXPIRED")
  assert.equal(telemetryProbe.events[0]?.statusCode, 401)
  assert.deepEqual(telemetryProbe.events[0]?.context, {
    endpointUrl: "https://api.example.com/private/rpc/export?token=masked",
    platformName: "chatgpt_platform"
  })
}

async function testServerFailure503Case(): Promise<void> {
  const telemetryProbe = new TelemetryProbe()
  const lifecycleHandler = new ExternalAuthLifecycleHandler(telemetryProbe as never)

  await assert.rejects(
    () =>
      lifecycleHandler.evaluateRpcResponse(createJsonResponse(503, { retryable: true }), {
        endpointUrl: "https://api.example.com/rpc/export",
        platformName: "chatgpt_platform"
      }),
    (error: unknown) => {
      assert.ok(error instanceof ExternalServiceException)
      assert.equal(error.message, "Servico de destino indisponivel.")
      return true
    }
  )

  assert.equal(telemetryProbe.events.length, 1)
  assert.equal(telemetryProbe.events[0]?.errorType, "EXTERNAL_SERVER_ERROR")
  assert.equal(telemetryProbe.events[0]?.statusCode, 503)
}

async function testUnexpectedStatus429Case(): Promise<void> {
  const telemetryProbe = new TelemetryProbe()
  const lifecycleHandler = new ExternalAuthLifecycleHandler(telemetryProbe as never)

  await assert.rejects(
    () =>
      lifecycleHandler.evaluateRpcResponse(createJsonResponse(429, { retryAfter: 1 }), {
        endpoint: "https://api.example.com/rpc/export",
        platform: "chatgpt_platform"
      }),
    (error: unknown) => {
      assert.ok(error instanceof ExternalServiceException)
      assert.equal(error.message, "Falha na chamada RPC externa (status 429).")
      return true
    }
  )

  assert.equal(telemetryProbe.events.length, 1)
  assert.equal(telemetryProbe.events[0]?.errorType, "EXTERNAL_UNEXPECTED_STATUS")
  assert.equal(telemetryProbe.events[0]?.statusCode, 429)
  assert.deepEqual(telemetryProbe.events[0]?.context, {
    endpointUrl: "https://api.example.com/rpc/export",
    platformName: "chatgpt_platform"
  })
}

async function run(): Promise<void> {
  await runCase("evaluateRpcResponse returns parsed payload for 200", testSuccess200Case)
  await runCase("evaluateRpcResponse purges credentials and raises AuthExpiredException for 401", testAuthExpired401Case)
  await runCase("evaluateRpcResponse raises ExternalServiceException and emits server telemetry for 503", testServerFailure503Case)
  await runCase("evaluateRpcResponse raises ExternalServiceException for unexpected non-success status", testUnexpectedStatus429Case)
}

void run().catch(() => {
  process.exitCode = 1
})
