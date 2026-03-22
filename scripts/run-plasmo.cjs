#!/usr/bin/env node

const fs = require("node:fs")
const { spawn } = require("node:child_process")
const path = require("node:path")

const mode = String(process.argv[2] ?? "").trim()

if (!mode) {
  console.error("[minddock-plasmo] Missing mode argument. Use: dev | build | package")
  process.exit(1)
}

function disablePlasmoRemoteVersionCheck() {
  try {
    const plasmoDistPath = path.resolve(__dirname, "..", "node_modules", "plasmo", "dist", "index.js")
    if (!fs.existsSync(plasmoDistPath)) {
      return
    }

    const source = fs.readFileSync(plasmoDistPath, "utf8")
    const patched = source.replace(/fe\(\),kt\(\),process\.env\.NODE_ENV=/g, "fe(),process.env.NODE_ENV=")

    if (patched !== source) {
      fs.writeFileSync(plasmoDistPath, patched, "utf8")
    }
  } catch (error) {
    console.warn("[minddock-plasmo] Unable to patch plasmo version check:", error)
  }
}

disablePlasmoRemoteVersionCheck()

const plasmoCliPath = path.resolve(__dirname, "..", "node_modules", "plasmo", "bin", "index.mjs")
const child = spawn(process.execPath, ["--no-deprecation", plasmoCliPath, mode], {
  stdio: "inherit",
  env: {
    ...process.env,
    CI: process.env.CI || "1",
    NO_UPDATE_NOTIFIER: process.env.NO_UPDATE_NOTIFIER || "1",
    npm_config_update_notifier: process.env.npm_config_update_notifier || "false"
  }
})

child.on("error", (error) => {
  console.error("[minddock-plasmo] Failed to start plasmo:", error)
  process.exit(1)
})

child.on("close", (code) => {
  process.exit(code ?? 1)
})