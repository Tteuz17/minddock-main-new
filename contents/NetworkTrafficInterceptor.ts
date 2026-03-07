import type { PlasmoCSConfig } from "plasmo"
import "../src/contents/NetworkTrafficInterceptor"

export const config: PlasmoCSConfig = {
  matches: ["https://notebooklm.google.com/*"],
  world: "MAIN",
  run_at: "document_start"
}
