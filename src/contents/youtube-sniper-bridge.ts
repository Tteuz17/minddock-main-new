export const config = {
  matches: ['*://*.youtube.com/*'],
  world: 'MAIN',
  run_at: 'document_idle',
}

// Roda no Main World — acesso total ao window da página
// Captura videoId e baseUrl do player do YouTube

function extractAndSend() {
  const videoId = new URLSearchParams(window.location.search).get('v');
  if (!videoId) {
    return;
  }

  // Tenta pegar o baseUrl fresco do player
  const playerEl = document.querySelector('#movie_player') as any;
  let baseUrl = '';

  if (typeof playerEl?.getPlayerResponse === 'function') {
    try {
      const pr = playerEl.getPlayerResponse();
      const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      const track = tracks.find((t: any) => t.kind === 'asr') ?? tracks[0];
      if (track?.baseUrl) {
        baseUrl = track.baseUrl;
      }
    } catch (e) {
    }
  }

  // Fallback: ytInitialPlayerResponse
  if (!baseUrl) {
    try {
      const pr = (window as any).ytInitialPlayerResponse;
      const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      const track = tracks.find((t: any) => t.kind === 'asr') ?? tracks[0];
      if (track?.baseUrl) {
        baseUrl = track.baseUrl;
      }
    } catch (e) {
    }
  }

  if (!baseUrl) {
    return;
  }

  window.postMessage({
    source: 'yt-sniper-bridge',
    type: 'SNIPER_DATA',
    payload: { videoId, baseUrl },
  }, '*');

}

// Execução inicial
if (document.readyState === 'complete') {
  extractAndSend();
} else {
  window.addEventListener('load', extractAndSend, { once: true });
}

// SPA: re-executa a cada navegação entre vídeos
window.addEventListener('yt-navigate-finish', () => {
  setTimeout(extractAndSend, 800);
  setTimeout(extractAndSend, 2000);
});

// Responde requisições sob demanda do Isolated World
window.addEventListener('message', (event) => {
  if (event.data?.source !== 'yt-sniper-isolated') return;
  if (event.data?.type !== 'REQUEST_SNIPER_DATA') return;
  extractAndSend();
});
