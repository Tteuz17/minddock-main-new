const BASE64_CHUNK_SIZE = 0x8000

export function bytesToBase64(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    return ""
  }

  let binary = ""
  for (let index = 0; index < bytes.length; index += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(index, index + BASE64_CHUNK_SIZE)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

export function base64ToBytes(value: string): Uint8Array {
  const normalized = String(value ?? "").replace(/\s+/g, "")
  if (!normalized) {
    return new Uint8Array()
  }

  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}
