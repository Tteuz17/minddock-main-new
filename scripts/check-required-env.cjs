const fs = require("node:fs")
const path = require("node:path")

function parseEnvFile(filePath) {
  const parsed = {}
  if (!fs.existsSync(filePath)) {
    return parsed
  }

  const raw = fs.readFileSync(filePath, "utf8")
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }
    const sep = trimmed.indexOf("=")
    if (sep <= 0) {
      continue
    }
    const key = trimmed.slice(0, sep).trim()
    let value = trimmed.slice(sep + 1).trim()
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    parsed[key] = value
  }
  return parsed
}

function resolveEnvValue(key, fileEnv) {
  const processValue = String(process.env[key] ?? "").trim()
  if (processValue) {
    return processValue
  }
  return String(fileEnv[key] ?? "").trim()
}

function isPlaceholderValue(value) {
  const normalized = String(value ?? "").toLowerCase()
  if (!normalized) {
    return true
  }
  return (
    normalized.includes("your-project") ||
    normalized.includes("your-anon-key") ||
    normalized.includes("changeme") ||
    normalized.includes("coloque")
  )
}

const cwd = process.cwd()
const fileEnv = {
  ...parseEnvFile(path.join(cwd, ".env")),
  ...parseEnvFile(path.join(cwd, ".env.local"))
}

const requiredKeys = [
  "PLASMO_PUBLIC_SUPABASE_URL",
  "PLASMO_PUBLIC_SUPABASE_ANON_KEY"
]

const missingKeys = requiredKeys.filter((key) => {
  const value = resolveEnvValue(key, fileEnv)
  return isPlaceholderValue(value)
})

if (missingKeys.length > 0) {
  console.error("[minddock-env] Missing required environment variables:")
  for (const key of missingKeys) {
    console.error(` - ${key}`)
  }
  console.error("[minddock-env] Copy .env.example to .env and fill real values before build/dev.")
  process.exit(1)
}

console.log("[minddock-env] Required auth env vars are present.")
