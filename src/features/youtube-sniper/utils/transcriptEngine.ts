import { MESSAGE_ACTIONS } from "~/lib/contracts";

const IS_DEV = process.env.NODE_ENV === "development";
const MAX_BRIDGE_ATTEMPTS = 5;
const BRIDGE_RETRY_MS = 2000;
const TRANSCRIPT_TIMEOUT_MS = 30000;

type SniperBridgePayload = { videoId: string; baseUrl: string };

let sniperData: SniperBridgePayload | null = null;

window.addEventListener("message", (event) => {
  if (event.data?.source !== "yt-sniper-bridge") return;
  if (event.data?.type !== "SNIPER_DATA") return;

  const videoId = String(event.data?.payload?.videoId ?? "").trim();
  const baseUrl = String(event.data?.payload?.baseUrl ?? "").trim();
  if (!videoId || !baseUrl) return;

  sniperData = { videoId, baseUrl };
});

function requestSniperData(): Promise<SniperBridgePayload> {
  if (sniperData) {
    return Promise.resolve(sniperData);
  }

  return new Promise((resolve, reject) => {
    let attempts = 0;
    let settled = false;

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
    };

    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Bridge nao respondeu. Aguarde o video carregar e tente novamente."));
    };

    const succeed = (payload: SniperBridgePayload) => {
      if (settled) return;
      settled = true;
      cleanup();
      sniperData = payload;
      resolve(payload);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.data?.source !== "yt-sniper-bridge") return;
      if (event.data?.type !== "SNIPER_DATA") return;

      const videoId = String(event.data?.payload?.videoId ?? "").trim();
      const baseUrl = String(event.data?.payload?.baseUrl ?? "").trim();
      if (!videoId || !baseUrl) return;

      succeed({ videoId, baseUrl });
    };

    const attempt = () => {
      if (settled) return;
      attempts += 1;

      window.postMessage(
        {
          source: "yt-sniper-isolated",
          type: "REQUEST_SNIPER_DATA"
        },
        "*"
      );

      window.setTimeout(() => {
        if (settled) return;
        if (sniperData) {
          succeed(sniperData);
          return;
        }
        if (attempts >= MAX_BRIDGE_ATTEMPTS) {
          fail();
          return;
        }
        attempt();
      }, BRIDGE_RETRY_MS);
    };

    window.addEventListener("message", onMessage);
    attempt();
  });
}

async function getVideoContext(): Promise<{ videoId: string; baseUrl?: string }> {
  const urlMatch = location.href.match(/[?&]v=([^&]+)/);
  const videoIdFromUrl = String(urlMatch?.[1] ?? "").trim();

  let bridgePayload: SniperBridgePayload | null = null;
  try {
    bridgePayload = await requestSniperData();
  } catch {
    bridgePayload = sniperData;
  }

  const finalVideoId = videoIdFromUrl || String(bridgePayload?.videoId ?? "").trim();
  if (!finalVideoId) {
    throw new Error("VideoId nao encontrado na URL");
  }

  const finalBaseUrl = String(bridgePayload?.baseUrl ?? "").trim();
  return finalBaseUrl
    ? { videoId: finalVideoId, baseUrl: finalBaseUrl }
    : { videoId: finalVideoId };
}

export async function extractTranscriptSlice(startSec: number, endSec: number): Promise<string> {
  const safeStart = Math.min(startSec, endSec);
  const safeEnd = Math.max(startSec, endSec);
  const { videoId, baseUrl } = await getVideoContext();

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("Timeout ao buscar legenda. Tente novamente."));
    }, TRANSCRIPT_TIMEOUT_MS);

    chrome.runtime.sendMessage(
      {
        command: MESSAGE_ACTIONS.FETCH_SNIPER_TRANSCRIPT,
        payload: { videoId, baseUrl, startSec: safeStart, endSec: safeEnd }
      },
      (response) => {
        window.clearTimeout(timeout);

        if (chrome.runtime.lastError) {
          if (IS_DEV) {
            console.error("[YT-SNIPER][ENGINE] runtime error:", chrome.runtime.lastError.message);
          }
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response?.success) {
          if (IS_DEV) {
            console.error(
              "[YT-SNIPER][ENGINE] response error:",
              response?.error ?? "Falha ao buscar legenda."
            );
          }
          reject(new Error(response?.error ?? "Falha ao buscar legenda."));
          return;
        }

        const text = String(response?.payload?.text ?? response?.data?.text ?? "").trim();
        if (!text) {
          reject(new Error("Nenhum texto encontrado no intervalo selecionado"));
          return;
        }

        resolve(text);
      }
    );
  });
}

window.addEventListener("yt-navigate-finish", () => {
  sniperData = null;
});
