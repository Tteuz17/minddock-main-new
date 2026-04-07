import type { CSSProperties } from "react"

export type StrategyMenuAlign = "left" | "right"

export interface StrategyPlacement {
  style: CSSProperties
  menuAlign: StrategyMenuAlign
}

export interface ContentStrategy {
  readonly id: string
  matches(url: string): boolean
  getRootContainer(): HTMLElement | null
  mountHost?(host: HTMLElement): boolean
  getStyles(): CSSProperties
  getMenuAlign(): StrategyMenuAlign
  isInlineOnly?(): boolean
}
