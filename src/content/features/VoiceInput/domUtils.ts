export function injectTextIntoReactTextarea(
  textareaElement: HTMLTextAreaElement,
  textToInject: string
): void {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value"
  )?.set

  nativeInputValueSetter?.call(textareaElement, textToInject)
  textareaElement.dispatchEvent(new Event("input", { bubbles: true }))
  textareaElement.dispatchEvent(new Event("change", { bubbles: true }))
}
