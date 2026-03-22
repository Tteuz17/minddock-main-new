import { MESSAGE_ACTIONS } from "~/lib/contracts";

const IS_DEV = process.env.NODE_ENV === "development";

// Dados capturados pela bridge
let sniperData: { videoId: string; baseUrl: string } | null = null;

// Escuta os dados da bridge (Main World → Isolated World)
window.addEventListener('message', (event) => {
  if (event.data?.source !== 'yt-sniper-bridge') return;
  if (event.data?.type !== 'SNIPER_DATA') return;

  const { videoId, baseUrl } = event.data.payload;
  if (!videoId || !baseUrl) return;

  sniperData = { videoId, baseUrl };
});

// Solicita os dados sob demanda se ainda não chegaram
function requestSniperData(): Promise<{ videoId: string; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    if (sniperData) {
      resolve(sniperData);
      return;
    }

    let tentativas = 0;
    const MAX_TENTATIVAS = 5; // tenta 5 vezes
    const INTERVALO = 2000; // a cada 2s

    function tentar() {
      tentativas++;

      window.postMessage(
        {
          source: 'yt-sniper-isolated',
          type: 'REQUEST_SNIPER_DATA',
        },
        '*'
      );

      setTimeout(() => {
        if (sniperData) {
          resolve(sniperData);
          return;
        }
        if (tentativas < MAX_TENTATIVAS) {
          tentar(); // tenta de novo
        } else {
          window.removeEventListener('message', handler);
          reject(new Error('Bridge não respondeu. Aguarde o vídeo carregar e tente novamente.'));
        }
      }, INTERVALO);
    }

    // Listener permanente durante as tentativas
    const handler = (event: MessageEvent) => {
      if (event.data?.source !== 'yt-sniper-bridge') return;
      if (event.data?.type !== 'SNIPER_DATA') return;

      const { videoId, baseUrl } = event.data.payload;
      if (!videoId || !baseUrl) return;

      window.removeEventListener('message', handler);
      sniperData = { videoId, baseUrl };
      resolve(sniperData);
    };
    window.addEventListener('message', handler);

    tentar();
  });
}

// Função principal — chamada pela UI
export async function extractTranscriptSlice(
  startSec: number,
  endSec: number
): Promise<string> {
  const safeStart = Math.min(startSec, endSec);
  const safeEnd = Math.max(startSec, endSec);

  // Pega só o videoId — baseUrl não é mais necessário
  const videoId = await getVideoId();

  // Envia para o background fazer o fetch com cookies
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout ao buscar legenda. Tente novamente.'));
    }, 30000);

    chrome.runtime.sendMessage(
      {
        command: MESSAGE_ACTIONS.FETCH_SNIPER_TRANSCRIPT,
        payload: { videoId, startSec: safeStart, endSec: safeEnd },
      },
      (response) => {
        clearTimeout(timeout);

        if (chrome.runtime.lastError) {
          if (IS_DEV) {
            console.error('[YT-SNIPER][ENGINE] runtime error:', chrome.runtime.lastError.message);
          }
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response?.success) {
          if (IS_DEV) {
            console.error('[YT-SNIPER][ENGINE] response error:', response?.error ?? 'Falha ao buscar legenda.');
          }
          reject(new Error(response?.error ?? 'Falha ao buscar legenda.'));
          return;
        }

        const text = response?.payload?.text ?? response?.data?.text;

        if (!text) {
          reject(new Error('Nenhum texto encontrado no intervalo selecionado'));
          return;
        }

        resolve(text);
      }
    );
  });
}

// Pega o videoId direto da URL — sem depender da bridge
function getVideoId(): Promise<string> {
  return new Promise((resolve, reject) => {
    // Tenta da URL primeiro
    const urlMatch = location.href.match(/[?&]v=([^&]+)/);
    if (urlMatch?.[1]) {
      resolve(urlMatch[1]);
      return;
    }
    // Fallback: usa o que a bridge já capturou
    if (sniperData?.videoId) {
      resolve(sniperData.videoId);
      return;
    }
    reject(new Error('VideoId não encontrado na URL'));
  });
}

// Limpa os dados ao trocar de vídeo
window.addEventListener('yt-navigate-finish', () => {
  sniperData = null;
  // sem logs aqui
});
