export const config = {
  matches: ['*://*.youtube.com/*'],
  world: 'MAIN',
  run_at: 'document_idle',
}

// Runs in the YouTube main world to capture videoId and fresh caption baseUrl.

function previewBaseUrl(rawBaseUrl: string): string {
  const normalized = String(rawBaseUrl ?? '').trim()
  if (!normalized) return '(empty)'
  if (normalized.length <= 140) return normalized
  return `${normalized.slice(0, 120)}...[${normalized.length} chars]`
}

function logBridge(message: string, details?: Record<string, unknown>) {
  if (details) {
    console.info(`[YT-SNIPER][BRIDGE] ${message}`, details)
    return
  }
  console.info(`[YT-SNIPER][BRIDGE] ${message}`)
}

function extractAndSend() {
  const videoId = new URLSearchParams(window.location.search).get('v')
  if (!videoId) {
    logBridge('Skip extract: URL has no videoId query param.', { href: window.location.href })
    return
  }

  logBridge('Starting extractAndSend.', { videoId })

  const playerEl = document.querySelector('#movie_player') as any
  let baseUrl = ''

  if (typeof playerEl?.getPlayerResponse === 'function') {
    try {
      const playerResponse = playerEl.getPlayerResponse()
      const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
      const pickedTrack = tracks.find((track: any) => track.kind === 'asr') ?? tracks[0]
      logBridge('Caption tracks from player response.', {
        count: tracks.length,
        pickedKind: String(pickedTrack?.kind ?? ''),
        pickedLanguage: String(pickedTrack?.languageCode ?? ''),
        hasPickedBaseUrl: Boolean(pickedTrack?.baseUrl),
      })
      if (pickedTrack?.baseUrl) {
        baseUrl = String(pickedTrack.baseUrl)
      }
    } catch (error) {
      logBridge('Error while reading player response captions.', {
        error: error instanceof Error ? error.message : String(error ?? 'unknown'),
      })
    }
  } else {
    logBridge('movie_player.getPlayerResponse is unavailable.')
  }

  if (!baseUrl) {
    try {
      const playerResponse = (window as any).ytInitialPlayerResponse
      const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
      const pickedTrack = tracks.find((track: any) => track.kind === 'asr') ?? tracks[0]
      logBridge('Caption tracks from ytInitialPlayerResponse fallback.', {
        count: tracks.length,
        pickedKind: String(pickedTrack?.kind ?? ''),
        pickedLanguage: String(pickedTrack?.languageCode ?? ''),
        hasPickedBaseUrl: Boolean(pickedTrack?.baseUrl),
      })
      if (pickedTrack?.baseUrl) {
        baseUrl = String(pickedTrack.baseUrl)
      }
    } catch (error) {
      logBridge('Error while reading ytInitialPlayerResponse captions.', {
        error: error instanceof Error ? error.message : String(error ?? 'unknown'),
      })
    }
  }

  if (!baseUrl) {
    logBridge('No caption baseUrl found in player response or fallback.', { videoId })
    return
  }

  window.postMessage(
    {
      source: 'yt-sniper-bridge',
      type: 'SNIPER_DATA',
      payload: { videoId, baseUrl },
    },
    '*',
  )
  logBridge('SNIPER_DATA posted to isolated world.', {
    videoId,
    baseUrlPreview: previewBaseUrl(baseUrl),
  })
}

if (document.readyState === 'complete') {
  logBridge('Document already complete; running initial extractAndSend.')
  extractAndSend()
} else {
  logBridge('Waiting for window.load to run initial extractAndSend.')
  window.addEventListener('load', extractAndSend, { once: true })
}

window.addEventListener('yt-navigate-finish', () => {
  logBridge('yt-navigate-finish received; scheduling bridge refreshes.')
  setTimeout(extractAndSend, 800)
  setTimeout(extractAndSend, 2000)
})

window.addEventListener('message', (event) => {
  if (event.data?.source !== 'yt-sniper-isolated') return
  if (event.data?.type !== 'REQUEST_SNIPER_DATA') return
  logBridge('REQUEST_SNIPER_DATA received from isolated world.')
  extractAndSend()
})
