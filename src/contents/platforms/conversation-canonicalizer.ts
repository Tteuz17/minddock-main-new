export type CanonicalCaptureRole = "assistant" | "user" | "document"

export interface CanonicalCaptureTurn {
  role: CanonicalCaptureRole
  content: string
}

interface CanonicalizerOptions {
  normalizeText: (value: string) => string
  buildContentKey: (value: string) => string
  isNoise?: (value: string) => boolean
  minLength?: number
  dropAggregateWrappers?: boolean
  aggregateMinChars?: number
  aggregateMinLines?: number
  maxEmbeddedFragments?: number
}

const DEFAULT_MIN_LENGTH = 2
const DEFAULT_AGGREGATE_MIN_CHARS = 90
const DEFAULT_AGGREGATE_MIN_LINES = 3
const DEFAULT_MAX_EMBEDDED_FRAGMENTS = 1

export function canonicalizeConversationTurns(
  rawTurns: CanonicalCaptureTurn[],
  options: CanonicalizerOptions
): CanonicalCaptureTurn[] {
  const {
    normalizeText,
    buildContentKey,
    isNoise = () => false,
    minLength = DEFAULT_MIN_LENGTH,
    dropAggregateWrappers = true,
    aggregateMinChars = DEFAULT_AGGREGATE_MIN_CHARS,
    aggregateMinLines = DEFAULT_AGGREGATE_MIN_LINES,
    maxEmbeddedFragments = DEFAULT_MAX_EMBEDDED_FRAGMENTS
  } = options

  const normalizedTurns = rawTurns
    .map((turn) => ({
      role: turn.role,
      content: normalizeText(String(turn.content ?? ""))
    }))
    .filter((turn) => turn.content.length >= minLength && !isNoise(turn.content))

  if (normalizedTurns.length === 0) {
    return []
  }

  const cleanedTurns = dropAggregateWrappers
    ? removeAggregateWrappers(
        normalizedTurns,
        buildContentKey,
        aggregateMinChars,
        aggregateMinLines,
        maxEmbeddedFragments
      )
    : normalizedTurns
  if (cleanedTurns.length === 0) {
    return []
  }

  const bestByKey = pickBestTurnByKey(cleanedTurns, buildContentKey)
  const dedupedInOrder: CanonicalCaptureTurn[] = []
  const emittedKeys = new Set<string>()

  for (const turn of cleanedTurns) {
    const key = buildContentKey(turn.content)
    if (!key || emittedKeys.has(key)) {
      continue
    }

    const bestTurn = bestByKey.get(key)
    if (!bestTurn) {
      continue
    }

    emittedKeys.add(key)
    dedupedInOrder.push(bestTurn)
  }

  return collapseAdjacentFragments(dedupedInOrder, buildContentKey)
}

function removeAggregateWrappers(
  turns: CanonicalCaptureTurn[],
  buildContentKey: (value: string) => string,
  aggregateMinChars: number,
  aggregateMinLines: number,
  maxEmbeddedFragments: number
): CanonicalCaptureTurn[] {
  const keys = turns.map((turn) => buildContentKey(turn.content))
  const keepMask = turns.map((turn, turnIndex) => {
    const key = keys[turnIndex]
    if (!key) {
      return false
    }

    const lineCount = turn.content.split("\n").filter((line) => line.trim().length > 0).length
    if (turn.content.length < aggregateMinChars || lineCount < aggregateMinLines) {
      return true
    }

    let embeddedFragments = 0
    for (let checkIndex = 0; checkIndex < turns.length; checkIndex += 1) {
      if (checkIndex === turnIndex) {
        continue
      }

      const fragmentKey = keys[checkIndex]
      if (!fragmentKey || fragmentKey.length < 8 || fragmentKey.length >= key.length) {
        continue
      }

      if (key.includes(fragmentKey)) {
        embeddedFragments += 1
        if (embeddedFragments > maxEmbeddedFragments) {
          return false
        }
      }
    }

    return true
  })

  return turns.filter((_turn, index) => keepMask[index])
}

function pickBestTurnByKey(
  turns: CanonicalCaptureTurn[],
  buildContentKey: (value: string) => string
): Map<string, CanonicalCaptureTurn> {
  const roleWeight: Record<CanonicalCaptureRole, number> = {
    user: 3,
    assistant: 2,
    document: 1
  }

  const bestMap = new Map<string, { turn: CanonicalCaptureTurn; score: number }>()
  for (const turn of turns) {
    const key = buildContentKey(turn.content)
    if (!key) {
      continue
    }

    const score = roleWeight[turn.role] * 10 - Math.max(0, Math.floor(turn.content.length / 180))
    const current = bestMap.get(key)
    if (!current || score > current.score) {
      bestMap.set(key, { turn, score })
    }
  }

  const output = new Map<string, CanonicalCaptureTurn>()
  for (const [key, value] of bestMap.entries()) {
    output.set(key, value.turn)
  }
  return output
}

function collapseAdjacentFragments(
  turns: CanonicalCaptureTurn[],
  buildContentKey: (value: string) => string
): CanonicalCaptureTurn[] {
  const compacted: CanonicalCaptureTurn[] = []
  for (const turn of turns) {
    if (compacted.length === 0) {
      compacted.push(turn)
      continue
    }

    const previous = compacted[compacted.length - 1]
    const previousKey = buildContentKey(previous.content)
    const currentKey = buildContentKey(turn.content)
    if (!currentKey || currentKey === previousKey) {
      continue
    }

    if (previous.role === turn.role) {
      if (turn.content.length <= previous.content.length && previous.content.includes(turn.content)) {
        continue
      }
      if (previous.content.length <= turn.content.length && turn.content.includes(previous.content)) {
        compacted[compacted.length - 1] = turn
        continue
      }
    }

    compacted.push(turn)
  }

  return compacted
}
