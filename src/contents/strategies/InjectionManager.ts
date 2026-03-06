import type { ContentStrategy } from "./types"

interface InjectionManagerOptions {
  hostId: string
  mountId: string
  styleId: string
  shadowCssText: string
  resolveStrategy: (url: string) => ContentStrategy
}

export class InjectionManager {
  private readonly options: InjectionManagerOptions
  private reinjectObserver: MutationObserver | null = null
  private lastHost: HTMLElement | null = null

  constructor(options: InjectionManagerOptions) {
    this.options = options
  }

  ensureMountPoint(url: string): HTMLElement {
    const strategy = this.options.resolveStrategy(url)
    const fallbackContainer = strategy.getRootContainer() ?? document.body ?? document.documentElement

    let host = document.getElementById(this.options.hostId) as HTMLElement | null
    if (!host) {
      host = document.createElement("div")
      host.id = this.options.hostId
    }

    const mountedByStrategy = strategy.mountHost?.(host) ?? false
    if (!mountedByStrategy) {
      if (host.parentElement !== fallbackContainer) {
        fallbackContainer.appendChild(host)
      }
    }

    const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: "open" })

    if (!shadowRoot.getElementById(this.options.styleId)) {
      const styleTag = document.createElement("style")
      styleTag.id = this.options.styleId
      styleTag.textContent = this.options.shadowCssText
      shadowRoot.appendChild(styleTag)
    }

    let mountPoint = shadowRoot.getElementById(this.options.mountId) as HTMLElement | null
    if (!mountPoint) {
      mountPoint = document.createElement("div")
      mountPoint.id = this.options.mountId
      shadowRoot.appendChild(mountPoint)
    }

    this.lastHost = host
    return mountPoint
  }

  getHost(): HTMLElement | null {
    return this.lastHost
  }

  startAutoReinject(onHostMissing: () => void): void {
    if (this.reinjectObserver) {
      return
    }

    this.reinjectObserver = new MutationObserver(() => {
      const host = document.getElementById(this.options.hostId)
      if (host) {
        return
      }

      onHostMissing()
    })

    this.reinjectObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    })
  }

  stopAutoReinject(): void {
    this.reinjectObserver?.disconnect()
    this.reinjectObserver = null
  }
}
