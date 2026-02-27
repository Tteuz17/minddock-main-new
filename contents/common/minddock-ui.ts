export type MindDockButtonState = "idle" | "loading" | "success" | "error"

export interface MindDockButtonController {
  element: HTMLButtonElement
  setState: (state: MindDockButtonState, customLabel?: string) => void
}

interface CreateButtonOptions {
  idleLabel?: string
}

interface ToastOptions {
  message: string
  variant?: "info" | "success" | "error"
  timeoutMs?: number
}

const STYLE_TAG_ID = "minddock-common-ui-styles"

function ensureStyles() {
  if (document.getElementById(STYLE_TAG_ID)) {
    return
  }

  const styleTag = document.createElement("style")
  styleTag.id = STYLE_TAG_ID
  styleTag.textContent = `
    .minddock-capture-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 500;
      color: #a1a1aa;
      background: transparent;
      border: 1px solid rgba(255,255,255,0.12);
      cursor: pointer;
      font-family: Inter, sans-serif;
      transition: all 0.2s ease;
    }
    .minddock-capture-btn:hover {
      color: #facc15;
      border-color: rgba(250,204,21,0.35);
      background: rgba(250,204,21,0.08);
    }
    .minddock-capture-btn[data-state="loading"] {
      color: #e5e7eb;
      border-color: rgba(229,231,235,0.35);
      background: rgba(229,231,235,0.08);
    }
    .minddock-capture-btn[data-state="success"] {
      color: #22c55e;
      border-color: rgba(34,197,94,0.45);
      background: rgba(34,197,94,0.12);
    }
    .minddock-capture-btn[data-state="error"] {
      color: #ef4444;
      border-color: rgba(239,68,68,0.45);
      background: rgba(239,68,68,0.12);
    }
    .minddock-toast {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      max-width: 340px;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.16);
      color: #f3f4f6;
      background: rgba(10,10,10,0.92);
      backdrop-filter: blur(12px);
      font-family: Inter, sans-serif;
      font-size: 12px;
      line-height: 1.4;
      box-shadow: 0 8px 30px rgba(0,0,0,0.45);
      animation: minddock-toast-in 160ms ease;
    }
    .minddock-toast[data-variant="success"] {
      border-color: rgba(34,197,94,0.4);
    }
    .minddock-toast[data-variant="error"] {
      border-color: rgba(239,68,68,0.4);
    }
    @keyframes minddock-toast-in {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `

  document.head.appendChild(styleTag)
}

export function createMindDockButton(options: CreateButtonOptions = {}): MindDockButtonController {
  ensureStyles()

  const idleLabel = options.idleLabel?.trim() || "MindDock"
  const button = document.createElement("button")
  button.type = "button"
  button.className = "minddock-capture-btn"
  button.dataset.state = "idle"
  button.textContent = `📌 ${idleLabel}`

  const setState = (state: MindDockButtonState, customLabel?: string) => {
    button.dataset.state = state
    if (customLabel?.trim()) {
      button.textContent = customLabel
      return
    }

    switch (state) {
      case "idle":
        button.textContent = `📌 ${idleLabel}`
        return
      case "loading":
        button.textContent = "Enviando..."
        return
      case "success":
        button.textContent = "✓ Enviado!"
        return
      case "error":
        button.textContent = "Erro"
        return
    }
  }

  return { element: button, setState }
}

export function showMindDockToast(options: ToastOptions): void {
  ensureStyles()

  const text = String(options.message ?? "").trim()
  if (!text) {
    return
  }

  const toast = document.createElement("div")
  toast.className = "minddock-toast"
  toast.dataset.variant = options.variant ?? "info"
  toast.textContent = text

  document.body.appendChild(toast)

  const timeoutMs = Math.max(1200, options.timeoutMs ?? 2200)
  window.setTimeout(() => {
    toast.remove()
  }, timeoutMs)
}
