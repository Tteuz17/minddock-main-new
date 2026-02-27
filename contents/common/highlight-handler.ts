let listenerAttached = false

interface HighlightIntentPayload {
  color?: string
  colorId?: string
}

interface HighlightIntentMessage {
  intent?: string
  payload?: HighlightIntentPayload
}

function applyHighlightSelection(color: string, colorId: string) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) {
    return
  }

  const range = selection.getRangeAt(0)
  if (range.collapsed) {
    return
  }

  const mark = document.createElement("mark")
  mark.dataset.minddockHighlight = colorId
  mark.style.backgroundColor = color
  mark.style.color = "inherit"
  mark.style.padding = "0 0.08em"
  mark.style.borderRadius = "0.12em"

  try {
    range.surroundContents(mark)
  } catch {
    const fragment = range.extractContents()
    mark.appendChild(fragment)
    range.insertNode(mark)
  }

  selection.removeAllRanges()
}

export function installHighlightMessageListener() {
  if (listenerAttached) {
    return
  }

  listenerAttached = true

  chrome.runtime.onMessage.addListener((message: HighlightIntentMessage) => {
    if (message?.intent !== "MINDDOCK_APPLY_HIGHLIGHT_SELECTION") {
      return
    }

    const color = String(message?.payload?.color ?? "#FDE68A").trim() || "#FDE68A"
    const colorId = String(message?.payload?.colorId ?? "amarelo").trim() || "amarelo"
    applyHighlightSelection(color, colorId)
  })
}
