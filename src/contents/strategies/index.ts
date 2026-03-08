import { ChatGPTStrategy } from "./ChatGPTStrategy"
import { ClaudeStrategy } from "./ClaudeStrategy"
import { DefaultStrategy } from "./DefaultStrategy"
import { GeminiStrategy } from "./GeminiStrategy"
import { GoogleDocsStrategy } from "./GoogleDocsStrategy"
import { GrokStrategy } from "./GrokStrategy"
import { KimiStrategy } from "./KimiStrategy"
import { LinkedInStrategy } from "./LinkedInStrategy"
import { PerplexityStrategy } from "./PerplexityStrategy"
import { RedditStrategy } from "./RedditStrategy"
import { XStrategy } from "./XStrategy"
import type { ContentStrategy } from "./types"

const CONTENT_STRATEGIES: ContentStrategy[] = [
  new LinkedInStrategy(),
  new ChatGPTStrategy(),
  new ClaudeStrategy(),
  new GeminiStrategy(),
  new PerplexityStrategy(),
  new GoogleDocsStrategy(),
  new RedditStrategy(),
  new GrokStrategy(),
  new XStrategy(),
  new KimiStrategy(),
  new DefaultStrategy()
]

export function resolveContentStrategy(url: string): ContentStrategy {
  for (const strategy of CONTENT_STRATEGIES) {
    if (strategy.matches(url)) {
      return strategy
    }
  }

  return CONTENT_STRATEGIES[CONTENT_STRATEGIES.length - 1]
}

export function getContentStrategies(): ContentStrategy[] {
  return [...CONTENT_STRATEGIES]
}

export type { ContentStrategy, StrategyMenuAlign, StrategyPlacement } from "./types"
