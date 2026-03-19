export const config = {
  matches: ['*://*.youtube.com/*'],
  world: 'MAIN',
  run_at: 'document_idle',
}

// Roda no Main World — acesso total ao window da página
// Captura videoId e baseUrl do player do YouTube

const TAG = '[YT-SNIPER][BRIDGE]';

function extractAndSend() {
  const videoId = new URLSearchParams(window.location.search).get('v');
  if (!videoId) {
    console.warn(`${TAG} videoId não encontrado na URL`);
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
        console.log(`${TAG} baseUrl capturado. lang=${track.languageCode} kind=${track.kind ?? 'manual'}`);
      }
    } catch (e) {
      console.warn(`${TAG} erro ao ler getPlayerResponse:`, e);
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
        console.log(`${TAG} baseUrl via ytInitialPlayerResponse. lang=${track.languageCode}`);
      }
    } catch (e) {
      console.warn(`${TAG} erro ao ler ytInitialPlayerResponse:`, e);
    }
  }

  if (!baseUrl) {
    console.warn(`${TAG} nenhum baseUrl disponível ainda`);
    return;
  }

  window.postMessage({
    source: 'yt-sniper-bridge',
    type: 'SNIPER_DATA',
    payload: { videoId, baseUrl },
  }, '*');

  console.log(`${TAG} SNIPER_DATA enviado para Isolated World. videoId=${videoId}`);
}

// Execução inicial
console.log(`${TAG} script carregado. readyState=${document.readyState}`);

if (document.readyState === 'complete') {
  extractAndSend();
} else {
  window.addEventListener('load', extractAndSend, { once: true });
}

// SPA: re-executa a cada navegação entre vídeos
window.addEventListener('yt-navigate-finish', () => {
  console.log(`${TAG} yt-navigate-finish — re-extraindo`);
  setTimeout(extractAndSend, 800);
  setTimeout(extractAndSend, 2000);
});

// Responde requisições sob demanda do Isolated World
window.addEventListener('message', (event) => {
  if (event.data?.source !== 'yt-sniper-isolated') return;
  if (event.data?.type !== 'REQUEST_SNIPER_DATA') return;
  console.log(`${TAG} requisição sob demanda recebida`);
  extractAndSend();
});
