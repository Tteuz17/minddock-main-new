import type { PlasmoCSConfig } from "plasmo"

import "~/contents/UniversalMindDockButton"

export const config: PlasmoCSConfig = {
  matches: [
    "https://chat.openai.com/*",
    "https://chatgpt.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*",
    "https://youtube.com/*",
    "https://www.youtube.com/*",
    "https://*.youtube.com/*",
    "https://perplexity.ai/*",
    "https://www.perplexity.ai/*",
    "https://docs.google.com/document/d/*",
    "https://notebooklm.google.com/*",
    "https://linkedin.com/*",
    "https://www.linkedin.com/*",
    "https://reddit.com/*",
    "https://www.reddit.com/*",
    "https://x.com/*",
    "https://www.x.com/*",
    "https://twitter.com/*",
    "https://www.twitter.com/*",
    "https://grok.com/*",
    "https://www.grok.com/*",
    "https://genspark.ai/*",
    "https://www.genspark.ai/*",
    "https://genspark.im/*",
    "https://www.genspark.im/*",
    "https://kimi.moonshot.cn/*",
    "https://www.kimi.moonshot.cn/*",
    "https://kimi.com/*",
    "https://www.kimi.com/*",
    "https://openevidence.com/*",
    "https://www.openevidence.com/*"
  ],
  run_at: "document_idle",
  world: "ISOLATED"
}

export {}
