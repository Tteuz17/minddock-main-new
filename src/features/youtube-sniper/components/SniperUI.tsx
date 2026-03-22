import { useEffect, useState } from 'react';
import { extractTranscriptSlice } from '../utils/transcriptEngine';

const MAX_INTERVALO = 3600; // 1 hora
const SNIPER_BUTTON_ID = 'minddock-youtube-sniper-button';
const PANEL_WIDTH = 340;

type SniperUIProps = {
  onClose: () => void;
  defaultNotebookId: string;
};

function resolveYouTubeTitle(): string {
  const selectors = [
    'ytd-watch-metadata h1 yt-formatted-string',
    'h1.title yt-formatted-string',
    'h1.title',
  ];
  for (const selector of selectors) {
    const el = document.querySelector(selector) as HTMLElement | null;
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  const fallback = document.title.replace(/\s*-+\s*YouTube\s*$/i, '').trim();
  return fallback || 'YouTube';
}

async function hashContent(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sendRuntimeMessage<T = Record<string, unknown>>(
  command: string,
  payload: unknown,
  timeoutMs = 15000
): Promise<{ success: boolean; payload?: T; data?: T; error?: string }> {
  const runtimeApi = typeof chrome !== 'undefined' ? chrome.runtime : undefined;
  if (!runtimeApi?.sendMessage) {
    return { success: false, error: 'CHROME_RUNTIME_UNAVAILABLE' };
  }

  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ success: false, error: `REQUEST_TIMEOUT_${timeoutMs}MS` });
    }, Math.max(500, timeoutMs));

    runtimeApi.sendMessage({ command, payload }, (response) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response ?? { success: false, error: 'EMPTY_RESPONSE' });
    });
  });
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function readPlayerTimes(): { duration: number; currentTime: number } {
  const player = document.querySelector('#movie_player') as any;
  const rawDuration = Number(player?.getDuration?.());
  const rawCurrent = Number(player?.getCurrentTime?.());

  const video = document.querySelector('video') as HTMLVideoElement | null;
  const videoDuration = Number(video?.duration);
  const videoCurrent = Number(video?.currentTime);

  const duration = Number.isFinite(rawDuration) && rawDuration > 0
    ? rawDuration
    : Number.isFinite(videoDuration)
    ? videoDuration
    : 0;

  const currentTime = Number.isFinite(rawCurrent) && rawCurrent > 0
    ? rawCurrent
    : Number.isFinite(videoCurrent)
    ? videoCurrent
    : 0;

  return {
    duration: Math.floor(duration),
    currentTime: Math.floor(currentTime),
  };
}

export function SniperUI({ onClose, defaultNotebookId }: SniperUIProps) {
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [extractedText, setExtractedText] = useState('');
  const [anchorPos, setAnchorPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    // Inicializa com valores atuais
    const { duration: dur, currentTime: cur } = readPlayerTimes();
    setDuration(dur);
    setCurrentTime(cur);
    setStartSec(Math.max(0, cur - 30));
    setEndSec(cur);

    // Atualiza a cada segundo
    const interval = setInterval(() => {
      const snapshot = readPlayerTimes();
      setDuration(snapshot.duration);
      setCurrentTime(snapshot.currentTime);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const updatePosition = () => {
      const button = document.getElementById(SNIPER_BUTTON_ID);
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const margin = 12;
      const half = PANEL_WIDTH / 2;
      const minX = margin + half;
      const maxX = window.innerWidth - margin - half;
      const left = Math.min(Math.max(centerX, minX), maxX);
      const top = rect.top - 8;
      setAnchorPos({ left, top });
    };

    updatePosition();
    const handleScroll = () => updatePosition();
    const handleResize = () => updatePosition();
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    if (!message || status === 'loading') return;
    const timer = window.setTimeout(() => {
      setMessage('');
      setExtractedText('');
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [message, status]);

  const updateStartSec = (nextValue: number) => {
    const clampedStart = Math.min(Math.max(nextValue, 0), duration);
    const maxEnd = Math.min(duration, clampedStart + MAX_INTERVALO);
    setStartSec(clampedStart);
    setEndSec((prev) => {
      const nextEnd = Math.min(Math.max(prev, clampedStart), maxEnd);
      return nextEnd;
    });
  };

  const updateEndSec = (nextValue: number) => {
    const maxEnd = Math.min(duration, startSec + MAX_INTERVALO);
    const clamped = Math.min(Math.max(nextValue, startSec), maxEnd);
    setEndSec(clamped);
  };
  async function handleExtract() {
    if (startSec >= endSec) {
      setStatus('error');
      setMessage('O tempo de início deve ser menor que o tempo de fim');
      return;
    }

    const notebookId = defaultNotebookId?.trim();
    if (!notebookId) {
      setStatus('error');
      setMessage('Selecione um caderno padrão no popup antes de extrair.');
      return;
    }

    // Limite de 1 hora
    if (endSec - startSec > MAX_INTERVALO) {
      setStatus('error');
      setMessage('Intervalo máximo é de 1:00:00. Ajuste os sliders.');
      return;
    }

    const MAX_TENTATIVAS = 3;
    const DELAY_ENTRE_TENTATIVAS = 3000;

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      setStatus('loading');
      setMessage(tentativa === 1
        ? 'Extraindo legenda...'
        : `Tentativa ${tentativa} de ${MAX_TENTATIVAS}...`
      );
      setExtractedText('');

      try {
        const text = await extractTranscriptSlice(startSec, endSec);
        setExtractedText(text);
        setMessage('Salvando no caderno padrão...');

        const intervalLabel = `${formatTime(startSec)} → ${formatTime(endSec)}`;
        const sourceTitle = `${resolveYouTubeTitle()}\nURL: ${window.location.href}\nIntervalo: ${intervalLabel}`;
        const payloadText = text;
        const currentHash = await hashContent(payloadText);
        const response = await sendRuntimeMessage('PROTOCOL_APPEND_SOURCE', {
          notebookId,
          sourceTitle,
          sourcePlatform: 'Youtube',
          sourceKind: 'chat',
          conversation: [{ role: 'assistant', content: payloadText }],
          capturedFromUrl: window.location.href,
          isResync: false,
          currentHash,
        }, 20000);

        if (!response.success) {
          throw new Error(response.error ?? 'Falha ao salvar no caderno.');
        }

        setStatus('success');
        setMessage(`${text.split(' ').length} palavras extraídas e salvas no caderno`);
        return; // Sucesso — para aqui
      } catch (err: any) {
        if (tentativa === MAX_TENTATIVAS) {
          // Esgotou todas as tentativas
          setStatus('error');
          const msg = err.message ?? '';
          if (msg.includes('Botão de transcrição não encontrado') || msg.includes('baseUrl')) {
            setMessage('Este vídeo não possui transcrição disponível. Pode ser conteúdo exclusivo para membros ou legenda desativada pelo criador.');
          } else if (msg.includes('intervalo')) {
            setMessage('Nenhuma fala encontrada no intervalo selecionado. Tente ampliar o intervalo.');
          } else {
            setMessage('Não foi possível extrair a legenda. Verifique se o vídeo possui transcrição ativada.');
          }
          return;
        }

        // Aguarda antes da próxima tentativa
        // Mantém mensagem atual sem exibir aviso de tentativa
        await new Promise((r) => setTimeout(r, DELAY_ENTRE_TENTATIVAS));
      }
    }
  }

  const statusTone =
    status === 'error'
      ? 'border-red-500/20 bg-red-500/10 text-red-300'
      : status === 'success'
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
      : 'border-white/10 bg-white/5 text-zinc-300';

  return (
    <div
      className="fixed z-[999999] w-[340px] max-w-[92vw] text-white"
      style={
        anchorPos
          ? { left: anchorPos.left, top: anchorPos.top, transform: 'translate(-50%, -100%)' }
          : { right: 20, bottom: 80 }
      }
    >
      <div className="rounded-[14px] border border-white/10 bg-[#0b0b0b] p-3 shadow-[0_12px_30px_rgba(0,0,0,0.6)]">
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-white">MindDock Sniper</span>
                <span className="rounded-md bg-action/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-action">
                  YouTube
                </span>
              </div>
              <span className="mt-0.5 block text-[11px] text-zinc-400">
                Duração: {formatTime(duration)} · Agora: {formatTime(currentTime)}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-400 transition hover:bg-white/10 hover:text-white">
              ×
            </button>
          </div>

          {/* Slider INÍCIO */}
          <div className="rounded-[12px] border border-white/10 bg-[#111] p-2.5">
            <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              <span>Início</span>
              <span className="text-action">{formatTime(startSec)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={duration}
              value={startSec}
              onChange={e => updateStartSec(Number(e.target.value))}
              className="mt-2 w-full"
              style={{ accentColor: '#facc15' }}
            />
            <button
              type="button"
              onClick={() => updateStartSec(currentTime)}
              className="mt-2 inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-zinc-300 transition hover:bg-white/10">
              Usar tempo atual
            </button>
          </div>

          {/* Slider FIM */}
          <div className="rounded-[12px] border border-white/10 bg-[#111] p-2.5">
            <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              <span>Fim</span>
              <span className="text-action">{formatTime(endSec)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={duration}
              value={endSec}
              onChange={e => updateEndSec(Number(e.target.value))}
              className="mt-2 w-full"
              style={{ accentColor: '#facc15' }}
            />
            <button
              type="button"
              onClick={() => updateEndSec(currentTime)}
              className="mt-2 inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-zinc-300 transition hover:bg-white/10">
              Usar tempo atual
            </button>
          </div>

          {/* Intervalo selecionado */}
          <div className="text-center text-[11px] text-zinc-400">
            Intervalo: {formatTime(startSec)} → {formatTime(endSec)} ({formatTime(endSec - startSec)})
          </div>

          {/* Botão extrair */}
          <button
            onClick={handleExtract}
            disabled={status === 'loading'}
            className={`btn-primary w-full ${status === 'loading' ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            {status === 'loading' ? 'Extraindo...' : 'Extrair legenda'}
          </button>

          {/* Mensagem de status */}
          {message && (
            <div className={`rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${statusTone}`}>
              {message}
            </div>
          )}

          {/* Texto extraído */}
          {extractedText && (
            <div className="rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-[11px] leading-relaxed text-zinc-200 max-h-32 overflow-y-auto scrollbar-thin">
              {extractedText}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
