import { MESSAGE_ACTIONS } from "~/lib/contracts";
const MAX_BRIDGE_ATTEMPTS = 5;
const BRIDGE_RETRY_MS = 2000;
const TRANSCRIPT_TIMEOUT_MS = 45000;

type SniperBridgePayload = { videoId: string; baseUrl: string };

let sniperData: SniperBridgePayload | null = null;

function previewBaseUrl(rawBaseUrl: string): string {
  const normalized = String(rawBaseUrl ?? "").trim();
  if (!normalized) return "(empty)";
  if (normalized.length <= 140) return normalized;
  return `${normalized.slice(0, 120)}...[${normalized.length} chars]`;
}

function logSniperEngine(message: string, details?: Record<string, unknown>): void {
  if (details) {
    console.info(`[YT-SNIPER][ENGINE] ${message}`, details);
    return;
  }
  console.info(`[YT-SNIPER][ENGINE] ${message}`);
}

function isExtensionContextInvalidatedError(message: unknown): boolean {
  return /extension context invalidated/i.test(String(message ?? ""));
}

window.addEventListener("message", (event) => {
  if (event.data?.source !== "yt-sniper-bridge") return;
  if (event.data?.type !== "SNIPER_DATA") return;

  const videoId = String(event.data?.payload?.videoId ?? "").trim();
  const baseUrl = String(event.data?.payload?.baseUrl ?? "").trim();
  if (!videoId || !baseUrl) {
    logSniperEngine("Bridge event ignored: missing videoId or baseUrl.", {
      hasVideoId: Boolean(videoId),
      hasBaseUrl: Boolean(baseUrl)
    });
    return;
  }

  sniperData = { videoId, baseUrl };
  logSniperEngine("Bridge data updated from main world.", {
    videoId,
    baseUrlPreview: previewBaseUrl(baseUrl)
  });
});

function requestSniperData(): Promise<SniperBridgePayload> {
  if (sniperData) {
    logSniperEngine("Using cached bridge data.", {
      videoId: sniperData.videoId,
      baseUrlPreview: previewBaseUrl(sniperData.baseUrl)
    });
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
      logSniperEngine("Bridge request failed after max attempts.", { attempts: MAX_BRIDGE_ATTEMPTS });
      reject(new Error("Bridge nao respondeu. Aguarde o video carregar e tente novamente."));
    };

    const succeed = (payload: SniperBridgePayload) => {
      if (settled) return;
      settled = true;
      cleanup();
      sniperData = payload;
      logSniperEngine("Bridge request succeeded.", {
        attempts,
        videoId: payload.videoId,
        baseUrlPreview: previewBaseUrl(payload.baseUrl)
      });
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
      logSniperEngine("Requesting sniper data from main world.", { attempt: attempts });

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
    logSniperEngine("Bridge request threw error. Using last cached bridge data if available.");
  }

  const finalVideoId = videoIdFromUrl || String(bridgePayload?.videoId ?? "").trim();
  if (!finalVideoId) {
    logSniperEngine("Failed to resolve final videoId.", {
      videoIdFromUrl,
      hasBridgePayload: Boolean(bridgePayload)
    });
    throw new Error("VideoId nao encontrado na URL");
  }

  const finalBaseUrl = String(bridgePayload?.baseUrl ?? "").trim();
  logSniperEngine("Resolved video context.", {
    videoIdFromUrl,
    bridgeVideoId: bridgePayload?.videoId ?? "",
    finalVideoId,
    hasBaseUrl: Boolean(finalBaseUrl),
    baseUrlPreview: previewBaseUrl(finalBaseUrl)
  });
  return finalBaseUrl
    ? { videoId: finalVideoId, baseUrl: finalBaseUrl }
    : { videoId: finalVideoId };
}

export async function extractTranscriptSlice(startSec: number, endSec: number): Promise<string> {
  const safeStart = Math.min(startSec, endSec);
  const safeEnd = Math.max(startSec, endSec);
  const { videoId, baseUrl } = await getVideoContext();
  logSniperEngine("Starting transcript extraction request.", {
    requestedStartSec: startSec,
    requestedEndSec: endSec,
    safeStartSec: safeStart,
    safeEndSec: safeEnd,
    videoId,
    hasBaseUrl: Boolean(baseUrl),
    baseUrlPreview: previewBaseUrl(baseUrl ?? "")
  });

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      logSniperEngine("Transcript request timed out.", {
        timeoutMs: TRANSCRIPT_TIMEOUT_MS,
        videoId,
        safeStartSec: safeStart,
        safeEndSec: safeEnd
      });
      reject(new Error("Timeout ao buscar legenda. Tente novamente."));
    }, TRANSCRIPT_TIMEOUT_MS);

    try {
      chrome.runtime.sendMessage(
        {
          command: MESSAGE_ACTIONS.FETCH_SNIPER_TRANSCRIPT,
          payload: { videoId, baseUrl, startSec: safeStart, endSec: safeEnd }
        },
        (response) => {
          window.clearTimeout(timeout);

          if (chrome.runtime.lastError) {
            const runtimeErrorMessage = String(chrome.runtime.lastError.message ?? "").trim();
            logSniperEngine("Runtime error returned by chrome.runtime.sendMessage.", {
              message: runtimeErrorMessage
            });

            if (isExtensionContextInvalidatedError(runtimeErrorMessage)) {
              reject(new Error("Extension context invalidated. Reload the YouTube tab and try again."));
              return;
            }

            reject(new Error(runtimeErrorMessage || "Falha de runtime ao buscar legenda."));
            return;
          }

          if (!response?.success) {
            logSniperEngine("Background responded with failure.", {
              error: response?.error ?? "Falha ao buscar legenda."
            });
            reject(new Error(response?.error ?? "Falha ao buscar legenda."));
            return;
          }

          const text = String(response?.payload?.text ?? response?.data?.text ?? "").trim();
          if (!text) {
            logSniperEngine("Background success response came without transcript text.");
            reject(new Error("Nenhum texto encontrado no intervalo selecionado"));
            return;
          }

          logSniperEngine("Transcript extraction succeeded.", {
            textLength: text.length,
            wordCount: text.split(/\s+/u).filter(Boolean).length
          });
          resolve(text);
        }
      );
    } catch (error) {
      window.clearTimeout(timeout);
      const errorMessage = error instanceof Error ? error.message : String(error ?? "unknown");
      if (isExtensionContextInvalidatedError(errorMessage)) {
        reject(new Error("Extension context invalidated. Reload the YouTube tab and try again."));
        return;
      }
      reject(new Error(errorMessage || "Falha ao enviar requisicao de legenda."));
    }
  });
}

window.addEventListener("yt-navigate-finish", () => {
  sniperData = null;
});
