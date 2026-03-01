import type { PlasmoCSConfig } from "plasmo"
import "../src/contents/secure-bridge-listener"

export const config: PlasmoCSConfig = {
  matches: ["https://notebooklm.google.com/*"],
  run_at: "document_start"
}
