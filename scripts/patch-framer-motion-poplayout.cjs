"use strict"

const fs = require("fs")
const path = require("path")

const projectRoot = process.cwd()

const targets = [
  {
    label: "framer-motion es PresenceChild",
    relativePath: "node_modules/framer-motion/dist/es/components/AnimatePresence/PresenceChild.mjs",
    transforms: [
      {
        search: /if\s*\(\s*mode\s*===\s*"popLayout"\s*\)\s*\{/g,
        replace: 'if (false && mode === "popLayout") {'
      }
    ],
    verify: (code) => code.includes('if (false && mode === "popLayout") {')
  },
  {
    label: "framer-motion es PopChild",
    relativePath: "node_modules/framer-motion/dist/es/components/AnimatePresence/PopChild.mjs",
    transforms: [
      {
        search: /document\.head\.appendChild\(style\);/g,
        replace: "/* minddock-poplayout patched */ void 0;"
      },
      {
        search: /document\.head\.removeChild\(style\);/g,
        replace: "/* minddock-poplayout patched */ void 0;"
      }
    ],
    verify: (code) => code.includes("minddock-poplayout patched")
  },
  {
    label: "framer-motion cjs index",
    relativePath: "node_modules/framer-motion/dist/cjs/index.js",
    transforms: [
      {
        search: /if\s*\(\s*mode\s*===\s*"popLayout"\s*\)\s*\{/g,
        replace: 'if (false && mode === "popLayout") {'
      },
      {
        search: /document\.head\.appendChild\(style\);/g,
        replace: "/* minddock-poplayout patched */ void 0;"
      },
      {
        search: /document\.head\.removeChild\(style\);/g,
        replace: "/* minddock-poplayout patched */ void 0;"
      }
    ],
    verify: (code) =>
      code.includes('if (false && mode === "popLayout") {') ||
      code.includes("minddock-poplayout patched")
  }
]

function applyTransforms(code, transforms) {
  let next = code
  for (const transform of transforms) {
    next = next.replace(transform.search, transform.replace)
  }
  return next
}

function patchTarget(target) {
  const absolutePath = path.resolve(projectRoot, target.relativePath)
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`[minddock-poplayout] Missing target file: ${target.relativePath}`)
  }

  const originalCode = fs.readFileSync(absolutePath, "utf8")
  const patchedCode = applyTransforms(originalCode, target.transforms)

  if (patchedCode !== originalCode) {
    fs.writeFileSync(absolutePath, patchedCode, "utf8")
    console.log(`[minddock-poplayout] patched: ${target.label}`)
  } else {
    console.log(`[minddock-poplayout] unchanged (already patched): ${target.label}`)
  }

  const verifyCode = fs.readFileSync(absolutePath, "utf8")
  if (!target.verify(verifyCode)) {
    throw new Error(`[minddock-poplayout] Verification failed for: ${target.relativePath}`)
  }
}

function run() {
  for (const target of targets) {
    patchTarget(target)
  }
}

try {
  run()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
}
