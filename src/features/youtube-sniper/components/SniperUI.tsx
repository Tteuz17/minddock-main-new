import { useEffect, useState } from 'react';
import { MESSAGE_ACTIONS } from '~/lib/contracts';
import {
  buildNotebookAccountKey,
  buildScopedStorageKey,
  isConfirmedNotebookAccountKey,
  normalizeAccountEmail,
  normalizeAuthUser
} from '~/lib/notebook-account-scope';
import { extractTranscriptSlice } from '../utils/transcriptEngine';

const MAX_INTERVALO = 3600;
const SNIPER_BUTTON_ID = 'minddock-youtube-sniper-button';
const PANEL_WIDTH = 352;
const MINDDOCK_LOGO_SRC = new URL('../../../../public/images/logo/logotipo minddock.png', import.meta.url).href;
const SETTINGS_KEY = 'minddock_settings';
const DEFAULT_NOTEBOOK_KEY = 'nexus_default_notebook_id';
const LEGACY_DEFAULT_NOTEBOOK_KEY = 'minddock_default_notebook';
const AUTH_USER_KEY = 'nexus_auth_user';
const ACCOUNT_EMAIL_KEY = 'nexus_notebook_account_email';
const TOKEN_STORAGE_KEY = 'notebooklm_session';

function logSniperUi(message: string, details?: Record<string, unknown>): void {
  if (details) {
    console.info(`[YT-SNIPER][UI] ${message}`, details);
    return;
  }
  console.info(`[YT-SNIPER][UI] ${message}`);
}

type SniperUIProps = {
  onClose: () => void;
  getDefaultNotebookId: () => string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  return document.title.replace(/\s*-+\s*YouTube\s*$/i, '').trim() || 'YouTube';
}

async function hashContent(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sendRuntimeMessage<T = Record<string, unknown>>(
  command: string,
  payload: unknown,
  timeoutMs = 15000
): Promise<{ success: boolean; payload?: T; data?: T; error?: string }> {
  const runtimeApi = typeof chrome !== 'undefined' ? chrome.runtime : undefined;
  if (!runtimeApi?.sendMessage) return { success: false, error: 'CHROME_RUNTIME_UNAVAILABLE' };

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

function extractNotebookIdsFromPayload(payload: unknown): string[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item) =>
      item && typeof item === 'object'
        ? String((item as { id?: unknown }).id ?? '').trim()
        : ''
    )
    .filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeString(value: unknown): string {
  return String(value ?? '').trim();
}

async function resolveStrictDefaultNotebookSelection(): Promise<{
  checked: boolean;
  accountKey: string;
  defaultNotebookId: string;
  reason?: string;
}> {
  const storageApi = typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
  if (!storageApi?.get) {
    return {
      checked: false,
      accountKey: '',
      defaultNotebookId: '',
      reason: 'STORAGE_UNAVAILABLE'
    };
  }

  try {
    const snapshot = await storageApi.get([
      SETTINGS_KEY,
      AUTH_USER_KEY,
      ACCOUNT_EMAIL_KEY,
      TOKEN_STORAGE_KEY,
      DEFAULT_NOTEBOOK_KEY,
      LEGACY_DEFAULT_NOTEBOOK_KEY
    ]);

    const settings = isRecord(snapshot[SETTINGS_KEY]) ? snapshot[SETTINGS_KEY] : {};
    const session = isRecord(snapshot[TOKEN_STORAGE_KEY]) ? snapshot[TOKEN_STORAGE_KEY] : {};
    const accountEmail = normalizeAccountEmail(
      settings.notebookAccountEmail ?? snapshot[ACCOUNT_EMAIL_KEY] ?? session.accountEmail
    );
    const authUser = normalizeAuthUser(
      settings.authUser ?? settings.notebookAuthUser ?? snapshot[AUTH_USER_KEY] ?? session.authUser
    );
    const accountKey = buildNotebookAccountKey({ accountEmail, authUser });

    if (!isConfirmedNotebookAccountKey(accountKey)) {
      return {
        checked: true,
        accountKey,
        defaultNotebookId: '',
        reason: 'ACCOUNT_SCOPE_NOT_CONFIRMED'
      };
    }

    const defaultByAccount = isRecord(settings.defaultNotebookByAccount)
      ? (settings.defaultNotebookByAccount as Record<string, unknown>)
      : {};
    const fromScopedSettings = normalizeString(defaultByAccount[accountKey]);
    if (fromScopedSettings) {
      return { checked: true, accountKey, defaultNotebookId: fromScopedSettings };
    }

    const scopedDefaultKey = buildScopedStorageKey(DEFAULT_NOTEBOOK_KEY, accountKey);
    const scopedLegacyDefaultKey = buildScopedStorageKey(LEGACY_DEFAULT_NOTEBOOK_KEY, accountKey);
    const fromScopedCanonical = normalizeString(snapshot[scopedDefaultKey]);
    if (fromScopedCanonical) {
      return { checked: true, accountKey, defaultNotebookId: fromScopedCanonical };
    }
    const fromScopedLegacy = normalizeString(snapshot[scopedLegacyDefaultKey]);
    if (fromScopedLegacy) {
      return { checked: true, accountKey, defaultNotebookId: fromScopedLegacy };
    }

    return {
      checked: true,
      accountKey,
      defaultNotebookId: '',
      reason: 'NO_SCOPED_DEFAULT_NOTEBOOK'
    };
  } catch (error) {
    return {
      checked: false,
      accountKey: '',
      defaultNotebookId: '',
      reason: error instanceof Error ? error.message : String(error ?? 'UNKNOWN')
    };
  }
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
  const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : Number(video?.duration) || 0;
  const currentTime = Number.isFinite(rawCurrent) && rawCurrent > 0 ? rawCurrent : Number(video?.currentTime) || 0;
  return { duration: Math.floor(duration), currentTime: Math.floor(currentTime) };
}

// ─── Logo Mark ───────────────────────────────────────────────────────────────

function MindDockMark() {
  return (
    <img
      src={MINDDOCK_LOGO_SRC}
      alt="MindDock"
      width={20}
      height={20}
      style={{
        width: 20,
        height: 20,
        objectFit: 'contain',
        display: 'block',
      }}
    />
  );
}

// ─── Timeline Range Bar ───────────────────────────────────────────────────────

function TimelineBar({
  duration,
  startSec,
  endSec,
  currentTime,
}: {
  duration: number;
  startSec: number;
  endSec: number;
  currentTime: number;
}) {
  const d = Math.max(duration, 1);
  const startPct = (startSec / d) * 100;
  const widthPct = ((endSec - startSec) / d) * 100;
  const nowPct = (currentTime / d) * 100;

  return (
    <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-white/10">
      {/* Selected range */}
      <div
        className="absolute top-0 h-full rounded-full"
        style={{
          left: `${startPct}%`,
          width: `${Math.max(widthPct, 1)}%`,
          background: 'rgba(255,255,255,0.5)',
        }}
      />
      {/* Playhead */}
      <div
        className="absolute top-[-4px] h-[11px] w-[1.5px] rounded-full bg-white"
        style={{ left: `${nowPct}%`, transform: 'translateX(-50%)' }}
      />
    </div>
  );
}

// ─── Slider Control ───────────────────────────────────────────────────────────

function SliderControl({
  label,
  value,
  max,
  onChange,
  onSetNow,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
  onSetNow: () => void;
}) {
  return (
    <div className="flex-1 space-y-2">
      <div className="flex items-center justify-between">
        <span
          className="text-[9px] font-medium uppercase tracking-widest"
          style={{ color: 'rgba(255,255,255,0.3)' }}
        >
          {label}
        </span>
        <span className="font-mono text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.8)' }}>
          {formatTime(value)}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer"
        style={{ accentColor: 'rgba(255,255,255,0.7)', height: '3px' }}
      />
      <button
        type="button"
        onClick={onSetNow}
        className="flex w-full items-center justify-center gap-1 rounded-md border transition-all duration-150 cursor-pointer"
        style={{
          borderColor: 'rgba(255,255,255,0.08)',
          backgroundColor: 'transparent',
          padding: '5px 8px',
          color: 'rgba(255,255,255,0.4)',
          fontSize: '10px',
          fontWeight: 400,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.06)';
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.15)';
          (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.7)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.08)';
          (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.4)';
        }}
      >
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
          <circle cx="4.5" cy="4.5" r="3.5" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="4.5" cy="4.5" r="1.5" fill="currentColor" />
        </svg>
        Set to now
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function SniperUI({ onClose, getDefaultNotebookId }: SniperUIProps) {
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error' | 'warning'>('idle');
  const [message, setMessage] = useState('');
  const [extractedText, setExtractedText] = useState('');
  const [anchorPos, setAnchorPos] = useState<{ left: number; top: number } | null>(null);
  const [visible, setVisible] = useState(false);

  // Mount animation
  useEffect(() => {
    const t = window.setTimeout(() => setVisible(true), 20);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const { duration: dur, currentTime: cur } = readPlayerTimes();
    setDuration(dur);
    setCurrentTime(cur);
    setStartSec(Math.max(0, cur - 30));
    setEndSec(cur);

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
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, []);

  useEffect(() => {
    if (!message || status === 'loading') return;
    const timer = window.setTimeout(() => {
      setMessage('');
      setExtractedText('');
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [message, status]);

  const updateStartSec = (v: number) => {
    const clamped = Math.min(Math.max(v, 0), duration);
    setStartSec(clamped);
    setEndSec((prev) => Math.min(Math.max(prev, clamped), Math.min(duration, clamped + MAX_INTERVALO)));
  };

  const updateEndSec = (v: number) => {
    setEndSec(Math.min(Math.max(v, startSec), Math.min(duration, startSec + MAX_INTERVALO)));
  };

  async function handleExtract() {
    if (startSec >= endSec) {
      setStatus('error');
      setMessage('Start time must be before end time.');
      logSniperUi('Blocked: startSec must be lower than endSec.', { startSec, endSec });
      return;
    }

    const runtimeNotebookId = getDefaultNotebookId()?.trim();
    const strictDefaultValidation = await resolveStrictDefaultNotebookSelection();
    const notebookId = strictDefaultValidation.defaultNotebookId || runtimeNotebookId;
    logSniperUi('Extract clicked.', {
      startSec,
      endSec,
      duration,
      hasRuntimeNotebookId: Boolean(runtimeNotebookId),
      hasStrictScopedDefaultNotebookId: Boolean(strictDefaultValidation.defaultNotebookId),
      strictCheckChecked: strictDefaultValidation.checked,
      strictCheckReason: strictDefaultValidation.reason ?? '',
      accountKey: strictDefaultValidation.accountKey,
      currentUrl: window.location.href,
    });

    if (strictDefaultValidation.checked && !strictDefaultValidation.defaultNotebookId) {
      setStatus('warning');
      setMessage('Selecione um caderno no menu da extensao antes de extrair a legenda.');
      logSniperUi('Blocked: strict scoped default notebook is not configured.', {
        strictCheckReason: strictDefaultValidation.reason ?? '',
        accountKey: strictDefaultValidation.accountKey
      });
      return;
    }
    if (!notebookId) {
      setStatus('warning');
      setMessage('Selecione um caderno no menu da extensao antes de extrair a legenda.');
      logSniperUi('Blocked: no notebook id available after strict check fallback.');
      return;
    }

    const notebooksLookupResponse = await sendRuntimeMessage(
      MESSAGE_ACTIONS.CMD_GET_NOTEBOOKS,
      {},
      10000
    );
    if (notebooksLookupResponse.success) {
      const availableNotebookIds = extractNotebookIdsFromPayload(
        notebooksLookupResponse.payload ?? notebooksLookupResponse.data
      );
      if (availableNotebookIds.length > 0 && !availableNotebookIds.includes(notebookId)) {
        setStatus('error');
        setMessage('O caderno selecionado nao foi encontrado. Reabra o popup e selecione novamente.');
        logSniperUi('Blocked: selected default notebook is not available in current account scope.', {
          notebookId,
          availableCount: availableNotebookIds.length,
        });
        return;
      }
      if (availableNotebookIds.length === 0) {
        logSniperUi('Notebook lookup returned empty list in current page context; proceeding with selected notebook id.', {
          notebookId,
        });
      }
    } else {
      logSniperUi('Notebook lookup failed in current page context; proceeding with selected notebook id.', {
        notebookId,
        lookupError: notebooksLookupResponse.error ?? 'UNKNOWN',
      });
    }
    if (endSec - startSec > MAX_INTERVALO) {
      setStatus('error');
      setMessage('Max interval is 1 hour. Adjust the sliders.');
      logSniperUi('Blocked: interval exceeds max allowed.', {
        startSec,
        endSec,
        intervalSec: endSec - startSec,
        maxIntervalSec: MAX_INTERVALO,
      });
      return;
    }

    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      logSniperUi('Starting extract attempt.', {
        attempt,
        maxAttempts: MAX_ATTEMPTS,
        startSec,
        endSec,
      });
      setStatus('loading');
      setMessage(attempt === 1 ? 'Extracting transcript...' : `Retrying (${attempt}/${MAX_ATTEMPTS})...`);
      setExtractedText('');

      try {
        const text = await extractTranscriptSlice(startSec, endSec);
        logSniperUi('Transcript slice received.', {
          attempt,
          textLength: text.length,
          words: text.split(/\s+/u).filter(Boolean).length,
        });
        setExtractedText(text);
        setMessage('Saving to notebook...');

        const intervalLabel = `${formatTime(startSec)} → ${formatTime(endSec)}`;
        const sourceTitle = `${resolveYouTubeTitle()}\nURL: ${window.location.href}\nInterval: ${intervalLabel}`;
        const currentHash = await hashContent(text);
        logSniperUi('Sending transcript to notebook.', {
          attempt,
          notebookId,
          currentHash,
          intervalLabel,
        });
        const response = await sendRuntimeMessage('PROTOCOL_APPEND_SOURCE', {
          notebookId,
          sourceTitle,
          sourcePlatform: 'Youtube',
          sourceKind: 'chat',
          conversation: [{ role: 'assistant', content: text }],
          capturedFromUrl: window.location.href,
          isResync: false,
          currentHash,
        }, 20000);

        if (!response.success) {
          logSniperUi('Notebook save failed.', {
            attempt,
            error: response.error ?? 'Failed to save.',
          });
          throw new Error(response.error ?? 'Failed to save.');
        }

        setStatus('success');
        setMessage(`${text.split(' ').length} words extracted and saved.`);
        logSniperUi('Extract and save flow finished successfully.', {
          attempt,
          words: text.split(/\s+/u).filter(Boolean).length,
        });
        return;
      } catch (err: any) {
        logSniperUi('Extract attempt failed.', {
          attempt,
          maxAttempts: MAX_ATTEMPTS,
          error: err?.message ?? String(err ?? 'Unknown error'),
        });
        if (attempt === MAX_ATTEMPTS) {
          setStatus('error');
          const msg = err.message ?? '';
          if (
            msg.includes('Botão de transcrição') ||
            msg.includes('baseUrl') ||
            /no transcript available/i.test(msg)
          ) {
            setMessage('No transcript available for this video.');
          } else if (/extension context invalidated/i.test(msg)) {
            setMessage('A extensao foi atualizada. Recarregue a aba do YouTube e tente novamente.');
          } else if (/timeout/i.test(msg)) {
            setMessage('A extracao demorou demais. Tente novamente em alguns segundos.');
          } else if (msg.includes('intervalo')) {
            setMessage('No speech found in the selected range. Try a wider interval.');
          } else {
            setMessage('Could not extract transcript. Make sure captions are enabled.');
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  const intervalSecs = endSec - startSec;

  return (
    <div
      className="fixed z-[999999]"
      style={{
        width: PANEL_WIDTH,
        maxWidth: '92vw',
        ...(anchorPos
          ? { left: anchorPos.left, top: anchorPos.top, transform: 'translate(-50%, -100%)' }
          : { right: 20, bottom: 80 }),
        opacity: visible ? 1 : 0,
        transform: `${anchorPos ? 'translate(-50%, -100%)' : ''} translateY(${visible ? 0 : 8}px)`,
        transition: 'opacity 200ms ease, transform 200ms ease',
      }}
    >
      {/* Card */}
      <div
        style={{
          background: 'rgba(10, 10, 12, 0.97)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >

        <div style={{ padding: '14px 14px 14px' }}>

          {/* ── Header ── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MindDockMark />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.85)', letterSpacing: '-0.01em' }}>
                    Captura de precisão
                  </span>
                  {/* YouTube badge */}
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 4,
                    padding: '1px 5px',
                    fontSize: 9,
                    fontWeight: 500,
                    color: 'rgba(255,255,255,0.35)',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}>
                    <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#ff4444', display: 'inline-block', opacity: 0.8 }} />
                    YouTube
                  </span>
                </div>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 1, display: 'block' }}>
                  {formatTime(duration)} total · {formatTime(currentTime)} now
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                width: 28,
                height: 28,
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.05)',
                color: 'rgba(255,255,255,0.45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 150ms ease',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.12)';
                (e.currentTarget as HTMLButtonElement).style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)';
                (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.45)';
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* ── Timeline visualization ── */}
          <div style={{ marginBottom: 14 }}>
            <TimelineBar
              duration={duration}
              startSec={startSec}
              endSec={endSec}
              currentTime={currentTime}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>0:00</span>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>{formatTime(duration)}</span>
            </div>
          </div>

          {/* ── Sliders side-by-side ── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1px 1fr',
              gap: '0 12px',
              background: 'rgba(255,255,255,0.025)',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.06)',
              padding: '10px 12px',
              marginBottom: 10,
            }}
          >
            <SliderControl
              label="Start"
              value={startSec}
              max={duration}
              onChange={updateStartSec}
              onSetNow={() => updateStartSec(currentTime)}
            />
            {/* Divider */}
            <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 1 }} />
            <SliderControl
              label="End"
              value={endSec}
              max={duration}
              onChange={updateEndSec}
              onSetNow={() => updateEndSec(currentTime)}
            />
          </div>

          {/* ── Interval pill ── */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            marginBottom: 12,
            padding: '6px 12px',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.07)',
          }}>
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.55)', fontWeight: 400 }}>
              {formatTime(startSec)}
            </span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>→</span>
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.55)', fontWeight: 400 }}>
              {formatTime(endSec)}
            </span>
            <span style={{
              fontSize: 10,
              color: 'rgba(255,255,255,0.5)',
              fontWeight: 500,
              fontFamily: 'monospace',
              background: 'rgba(255,255,255,0.07)',
              borderRadius: 4,
              padding: '1px 6px',
            }}>
              {formatTime(intervalSecs)}
            </span>
          </div>

          {/* ── Extract button ── */}
          <button
            onClick={handleExtract}
            disabled={status === 'loading'}
            style={{
              width: '100%',
              padding: '10px 16px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.12)',
              background: status === 'loading'
                ? 'rgba(255,255,255,0.06)'
                : 'rgba(255,255,255,0.1)',
              color: status === 'loading' ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.85)',
              fontSize: 12,
              fontWeight: 500,
              cursor: status === 'loading' ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              transition: 'all 150ms ease',
              letterSpacing: '0em',
            }}
            onMouseEnter={(e) => {
              if (status !== 'loading') {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.15)';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.2)';
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.12)';
            }}
          >
            {status === 'loading' ? (
              <>
                <svg width="13" height="13" viewBox="0 0 14 14" style={{ animation: 'spin 0.8s linear infinite' }}>
                  <circle cx="7" cy="7" r="5.5" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" fill="none" />
                  <path d="M7 1.5A5.5 5.5 0 0112.5 7" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" fill="none" />
                </svg>
                {message || 'Extracting...'}
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                  <path d="M7 1L7 9M7 9L4 6M7 9L10 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M2 11H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Extract Caption
              </>
            )}
          </button>

          {/* ── Status message ── */}
          {message && status !== 'loading' && (
            <div style={{
              marginTop: 10,
              padding: '9px 12px',
              borderRadius: 10,
              fontSize: 11,
              lineHeight: 1.5,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              background: status === 'error'
                ? 'rgba(239,68,68,0.1)'
                : status === 'warning'
                ? 'rgba(250,204,21,0.12)'
                : 'rgba(34,197,94,0.1)',
              border: `1px solid ${
                status === 'error'
                  ? 'rgba(239,68,68,0.2)'
                  : status === 'warning'
                  ? 'rgba(250,204,21,0.35)'
                  : 'rgba(34,197,94,0.2)'
              }`,
              color: status === 'error' ? '#f87171' : status === 'warning' ? '#facc15' : '#4ade80',
            }}>
              {status === 'success' ? (
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
                  <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M4 6.5l2 2 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
                  <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M6.5 4v3M6.5 8.5v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              )}
              <span>{message}</span>
            </div>
          )}

          {/* ── Extracted preview ── */}
          {extractedText && status === 'success' && (
            <div style={{
              marginTop: 10,
              maxHeight: 80,
              overflowY: 'auto',
              padding: '8px 12px',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.07)',
              fontSize: 10,
              lineHeight: 1.6,
              color: 'rgba(255,255,255,0.45)',
            }}>
              {extractedText}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
