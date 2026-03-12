interface DriveMultipartUploadResponse {
  id?: string
}

const AUTH_TOKEN_TIMEOUT_MS = 60_000
const DRIVE_UPLOAD_TIMEOUT_MS = 90_000

function createTimeoutError(scope: string, timeoutMs: number): Error {
  return new Error(`${scope} timed out after ${timeoutMs}ms.`)
}

function requestCloudDocsAccessToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    let isSettled = false
    const timeoutId = globalThis.setTimeout(() => {
      if (isSettled) {
        return
      }
      isSettled = true
      reject(createTimeoutError("Google OAuth token request", AUTH_TOKEN_TIMEOUT_MS))
    }, AUTH_TOKEN_TIMEOUT_MS)

    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (isSettled) {
        return
      }
      isSettled = true
      globalThis.clearTimeout(timeoutId)

      const runtimeError = chrome.runtime.lastError
      if (runtimeError) {
        reject(new Error(runtimeError.message || "Failed to authenticate with Google account."))
        return
      }

      const cloudDocsAccessToken = String(token ?? "").trim()
      if (!cloudDocsAccessToken) {
        reject(new Error("Google OAuth token was not returned."))
        return
      }

      resolve(cloudDocsAccessToken)
    })
  })
}

function normalizeCloudDocumentTitle(documentTitle: string): string {
  const normalizedTitle = String(documentTitle ?? "").trim()
  return normalizedTitle || "NotebookLM Chat Export"
}

export async function executeDriveMultipartUpload(
  htmlPayload: string,
  documentTitle: string
): Promise<string> {
  const normalizedHtmlPayload = String(htmlPayload ?? "").trim()
  if (!normalizedHtmlPayload) {
    throw new Error("Chat HTML payload is empty.")
  }

  const normalizedDocumentTitle = normalizeCloudDocumentTitle(documentTitle)
  const cloudDocsAccessToken = await requestCloudDocsAccessToken()

  const boundarySeparator = `-------DriveUploadBoundary${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
  const metadataPayload = JSON.stringify({
    name: normalizedDocumentTitle,
    mimeType: "application/vnd.google-apps.document"
  })

  const multipartRequestBody = [
    `--${boundarySeparator}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    metadataPayload,
    `--${boundarySeparator}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    normalizedHtmlPayload,
    `--${boundarySeparator}--`,
    ""
  ].join("\r\n")

  const uploadController = new AbortController()
  const uploadTimeoutId = globalThis.setTimeout(() => {
    uploadController.abort(createTimeoutError("Google Drive multipart upload", DRIVE_UPLOAD_TIMEOUT_MS))
  }, DRIVE_UPLOAD_TIMEOUT_MS)

  let uploadResponse: Response
  try {
    uploadResponse = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        signal: uploadController.signal,
        headers: {
          Authorization: `Bearer ${cloudDocsAccessToken}`,
          "Content-Type": `multipart/related; boundary=${boundarySeparator}`
        },
        body: multipartRequestBody
      }
    )
  } finally {
    globalThis.clearTimeout(uploadTimeoutId)
  }

  if (!uploadResponse.ok) {
    const responseText = await uploadResponse.text().catch(() => "")
    throw new Error(`Google Drive upload failed (${uploadResponse.status}): ${responseText || uploadResponse.statusText}`)
  }

  const file = (await uploadResponse.json()) as DriveMultipartUploadResponse
  const uploadedFileId = String(file.id ?? "").trim()
  if (!uploadedFileId) {
    throw new Error("Google Drive upload did not return a document id.")
  }

  return `https://docs.google.com/document/d/${uploadedFileId}/edit`
}
