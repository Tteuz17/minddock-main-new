const fs = require("node:fs")
const path = require("node:path")

function readText(relativePath) {
  const absolutePath = path.join(process.cwd(), relativePath)
  return fs.readFileSync(absolutePath, "utf8")
}

function assertCondition(condition, message, errors) {
  if (!condition) {
    errors.push(message)
  }
}

const errors = []

const packageJson = JSON.parse(readText("package.json"))
const manifest = packageJson?.manifest ?? {}
assertCondition(
  typeof manifest.key === "string" && manifest.key.trim().length > 0,
  "package.json: manifest.key must be defined to keep extension ID stable.",
  errors
)

const authScreenSource = readText("src/popup/components/AuthScreen.tsx")
assertCondition(!authScreenSource.includes("DEV_TEST_USER"), "AuthScreen must not include DEV_TEST_USER.", errors)
assertCondition(
  !authScreenSource.includes("handleDevAccess"),
  "AuthScreen must not include handleDevAccess bypass.",
  errors
)

const authManagerSource = readText("src/background/auth-manager.ts")
assertCondition(
  !authManagerSource.includes('startsWith("dev-")'),
  "auth-manager must not trust dev-* local profiles.",
  errors
)
assertCondition(
  authManagerSource.includes("await client.auth.getSession()"),
  "auth-manager must validate Supabase session in getCurrentUser().",
  errors
)

const envExampleSource = readText(".env.example")
assertCondition(!/sk-ant-/u.test(envExampleSource), ".env.example must not contain real-looking API keys.", errors)
assertCondition(
  !envExampleSource.includes("PLASMO_PUBLIC_NOTION_CLIENT_SECRET"),
  ".env.example must not expose Notion client secret in extension env.",
  errors
)

const notionAuthSource = readText("src/background/services/notionAuthManager.ts")
assertCondition(
  !notionAuthSource.includes("PLASMO_PUBLIC_NOTION_CLIENT_SECRET"),
  "Notion auth manager must not read public client secret from extension env.",
  errors
)
assertCondition(
  !notionAuthSource.includes("Authorization: `Basic"),
  "Notion auth manager must not perform client-secret token exchange in extension runtime.",
  errors
)

const routerSource = readText("src/background/router.ts")
assertCondition(
  !routerSource.includes("PLASMO_PUBLIC_CLAUDE_API_KEY"),
  "Router messages must not instruct client-side public Claude key usage.",
  errors
)

if (errors.length > 0) {
  console.error("[auth-invariants] FAILED")
  for (const error of errors) {
    console.error(` - ${error}`)
  }
  process.exit(1)
}

console.log("[auth-invariants] OK")
