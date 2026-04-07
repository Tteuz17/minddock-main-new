import type { Root } from "react-dom/client"

export type InsertionMethod = "BEFORE" | "AFTER" | "PREPEND" | "APPEND"

export interface InsertionStrategyConfig {
  anchorSelector: string
  relativeSiblingSelector?: string
  insertionMethod: InsertionMethod
}

export interface MountIntegrityGuardOptions {
  platformAnchorSelector: string
  insertionStrategyConfig: InsertionStrategyConfig
  render: (hostElement: HTMLElement) => Root
  hostId?: string
  debounceMs?: number
}

export class MountIntegrityGuard {
  public readonly insertionStrategyConfig: InsertionStrategyConfig

  private readonly platformAnchorSelector: string
  private readonly hostId: string
  private readonly renderCallback: (hostElement: HTMLElement) => Root
  private readonly debounceMs: number

  private reactRoot: Root | null = null
  private reactHostElement: HTMLElement | null = null
  private mutationObserverInstance: MutationObserver | null = null
  private debounceTimerId: number | null = null

  constructor(options: MountIntegrityGuardOptions) {
    this.platformAnchorSelector = options.platformAnchorSelector
    this.insertionStrategyConfig = options.insertionStrategyConfig
    this.renderCallback = options.render
    this.hostId = options.hostId ?? "minddock-react-host"
    this.debounceMs = options.debounceMs ?? 300
  }

  public initializeDomGuard(): void {
    if (this.mutationObserverInstance) {
      return
    }

    const startObserver = (): void => {
      if (!document.body) {
        return
      }

      this.mutationObserverInstance = new MutationObserver(() => {
        if (this.debounceTimerId !== null) {
          window.clearTimeout(this.debounceTimerId)
        }

        this.debounceTimerId = window.setTimeout(() => {
          this.debounceTimerId = null
          this.checkMountIntegrity()
        }, this.debounceMs)
      })

      this.mutationObserverInstance.observe(document.body, { childList: true, subtree: true })
    }

    if (document.body) {
      startObserver()
      return
    }

    window.addEventListener(
      "DOMContentLoaded",
      () => {
        startObserver()
      },
      { once: true }
    )
  }

  public checkMountIntegrity(): void {
    console.log("[MindDock Guard] Verificando integridade da montagem...")
    this.unmountOrphanRoots()

    const config = this.insertionStrategyConfig
    const targetAnchorElement = document.querySelector(this.platformAnchorSelector)
    if (!targetAnchorElement) {
      console.warn(
        "[MindDock Guard] Abortando: Ancora nao encontrada usando o seletor:",
        this.platformAnchorSelector
      )
      return
    }

    const insertionAnchorElement = this.resolveInsertionAnchor()
    if (!insertionAnchorElement) {
      console.warn(
        "[MindDock Guard] Abortando: Ancora nao encontrada usando o seletor:",
        config.anchorSelector
      )
      return
    }

    if (config.relativeSiblingSelector) {
      const siblingElement = insertionAnchorElement.querySelector(config.relativeSiblingSelector)
      if (!siblingElement) {
        console.warn(
          "[MindDock Guard] Abortando: Sibling nao encontrado usando o seletor:",
          config.relativeSiblingSelector
        )
        return
      }
    }

    const existingHostElement = document.getElementById(this.hostId)
    if (!existingHostElement) {
      console.log("[MindDock Guard] Iniciando injecao via metodo:", config.insertionMethod)
      this.mountReactApp()
      return
    }

    console.log("[MindDock Guard] Host ja existe, nenhuma acao necessaria.")
    this.reactHostElement = existingHostElement

    if (!this.reactRoot) {
      this.reactRoot = this.renderCallback(existingHostElement)
    }

    this.enforceInsertion(existingHostElement)
  }

  public unmountOrphanRoots(): void {
    if (!this.reactRoot || !this.reactHostElement) {
      return
    }

    if (!document.contains(this.reactHostElement)) {
      this.reactRoot.unmount()
      this.reactRoot = null
      this.reactHostElement = null
    }
  }

  public mountReactApp(): void {
    this.unmountOrphanRoots()

    const anchorElement = this.resolveInsertionAnchor()
    if (!anchorElement) {
      return
    }

    const hostElement = document.createElement("div")
    hostElement.id = this.hostId

    const inserted = this.insertHostAtAnchor(hostElement, anchorElement)
    if (!inserted) {
      return
    }

    this.reactHostElement = hostElement
    this.reactRoot = this.renderCallback(hostElement)
  }

  private enforceInsertion(hostElement: HTMLElement): void {
    const anchorElement = this.resolveInsertionAnchor()
    if (!anchorElement) {
      return
    }

    this.insertHostAtAnchor(hostElement, anchorElement)
  }

  private resolveInsertionAnchor(): HTMLElement | null {
    const anchorSelector = this.insertionStrategyConfig.anchorSelector
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(anchorSelector))
    if (candidates.length === 0) {
      return null
    }

    const relativeSiblingSelector = this.insertionStrategyConfig.relativeSiblingSelector
    if (!relativeSiblingSelector) {
      return candidates[0]
    }

    for (const candidate of candidates) {
      if (candidate.querySelector(relativeSiblingSelector)) {
        return candidate
      }
    }

    return candidates[0]
  }

  private insertHostAtAnchor(hostElement: HTMLElement, anchorElement: Element): boolean {
    const containerElement =
      this.insertionStrategyConfig.relativeSiblingSelector !== undefined
        ? (anchorElement as HTMLElement | null)
        : anchorElement.parentElement
    if (!containerElement) {
      return false
    }

    const referenceElement = this.resolveReferenceElement(containerElement, anchorElement)
    const insertionMethod = this.insertionStrategyConfig.insertionMethod

    if (insertionMethod === "PREPEND") {
      containerElement.insertBefore(hostElement, containerElement.firstChild)
      return true
    }

    if (insertionMethod === "APPEND") {
      containerElement.appendChild(hostElement)
      return true
    }

    if (!referenceElement) {
      return false
    }

    if (insertionMethod === "BEFORE") {
      containerElement.insertBefore(hostElement, referenceElement)
      return true
    }

    containerElement.insertBefore(hostElement, referenceElement.nextSibling)
    return true
  }

  private resolveReferenceElement(parentElement: HTMLElement, anchorElement: Element): Element | null {
    const relativeSiblingSelector = this.insertionStrategyConfig.relativeSiblingSelector
    if (relativeSiblingSelector) {
      const relativeSiblingElement = parentElement.querySelector(relativeSiblingSelector)
      if (relativeSiblingElement) {
        return relativeSiblingElement
      }
    }

    return relativeSiblingSelector ? null : anchorElement
  }

  public dispose(): void {
    if (this.debounceTimerId !== null) {
      window.clearTimeout(this.debounceTimerId)
      this.debounceTimerId = null
    }

    if (this.mutationObserverInstance) {
      this.mutationObserverInstance.disconnect()
      this.mutationObserverInstance = null
    }
  }
}

let activeGuard: MountIntegrityGuard | null = null

export function initializeDomGuard(options: MountIntegrityGuardOptions): MountIntegrityGuard {
  if (activeGuard) {
    activeGuard.dispose()
  }

  const guardInstance = new MountIntegrityGuard(options)
  activeGuard = guardInstance
  guardInstance.initializeDomGuard()
  return guardInstance
}

export function checkMountIntegrity(): void {
  activeGuard?.checkMountIntegrity()
}
