import { createSHA256 } from 'hash-wasm';
import { ApiError, apiRequest } from './api';

interface Ticket {
  url: string;
  fileName: string;
  size: number;
  sha256: string;
}

interface WritableFile {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

interface SaveFileHandle {
  createWritable(): Promise<WritableFile>;
}

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: { suggestedName: string }) => Promise<SaveFileHandle>;
};

export interface DownloadControl {
  paused: boolean;
  cancelled: boolean;
  abort: AbortController;
}

export type DownloadResult = 'completed' | 'cancelled' | 'native';

export function createDownloadControl(): DownloadControl {
  return { paused: false, cancelled: false, abort: new AbortController() };
}

const MAX_RETRIES = 6;
// Sans sélecteur de fichier (Chrome Android), le fichier est assemblé en mémoire : limité à 256 Mo.
// Au-delà, le téléchargement est confié au gestionnaire du navigateur (écriture directe sur le disque).
const MEMORY_DOWNLOAD_LIMIT = 256 * 1024 * 1024;

// Application Android (WebView) : les téléchargements passent par le gestionnaire d'Android.
const IS_ANDROID_WEBVIEW = typeof navigator !== 'undefined' && /; wv\)/.test(navigator.userAgent);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestTicket(source: Record<string, string>, token: string): Promise<Ticket> {
  return apiRequest<Ticket>('/api/device/downloads', { method: 'POST', body: source, token });
}

function startNativeDownload(ticket: Ticket): void {
  const link = document.createElement('a');
  link.href = ticket.url;
  link.download = ticket.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Télécharge un fichier du PC sans le charger entièrement en mémoire lorsque le navigateur le permet,
 * avec reprise automatique (requêtes Range) après une coupure, pause, annulation, vitesse lissée et
 * vérification SHA-256 avant l'enregistrement définitif.
 */
export async function downloadToDevice(
  source: Record<string, string>,
  token: string,
  onProgress: (received: number, total: number, speedBytesPerSec: number) => void,
  control: DownloadControl = createDownloadControl(),
): Promise<DownloadResult> {
  let ticket = await requestTicket(source, token);
  const expected = { size: ticket.size, sha256: ticket.sha256 };

  const picker = (window as SavePickerWindow).showSaveFilePicker;
  let writable: WritableFile | null = null;
  const parts: Uint8Array[] = [];
  if (typeof picker === 'function') {
    const handle = await picker.call(window, { suggestedName: ticket.fileName });
    writable = await handle.createWritable();
  } else if (IS_ANDROID_WEBVIEW || ticket.size > MEMORY_DOWNLOAD_LIMIT) {
    startNativeDownload(ticket);
    return 'native';
  }

  const hasher = await createSHA256();
  hasher.init();
  let received = 0;
  let retries = 0;
  let smoothedSpeed = 0;
  let lastTick = performance.now();
  let lastBytes = 0;

  const discard = async () => {
    await writable?.abort?.().catch(() => undefined);
    parts.length = 0;
  };

  try {
    while (received < expected.size) {
      if (control.cancelled) {
        await discard();
        return 'cancelled';
      }
      if (control.paused) {
        onProgress(received, expected.size, 0);
        await wait(250);
        continue;
      }

      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      try {
        const response = await fetch(ticket.url, {
          headers: received > 0 ? { Range: `bytes=${received}-` } : {},
          signal: control.abort.signal,
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          if (response.status === 404 && data.error === 'DOWNLOAD_EXPIRED') {
            // Le lien dure 10 minutes : on en demande un nouveau et on reprend à la même position.
            const fresh = await requestTicket(source, token);
            if (fresh.size !== expected.size || fresh.sha256 !== expected.sha256) {
              throw new ApiError(409, 'FILE_CHANGED', 'Le fichier a été modifié sur le PC pendant le téléchargement.');
            }
            ticket = fresh;
            continue;
          }
          throw new ApiError(response.status, data.error ?? 'ERROR', data.message ?? 'Le téléchargement a été refusé par le PC.');
        }
        if (!response.body) throw new ApiError(0, 'NO_STREAM', 'Ce navigateur ne permet pas le téléchargement progressif.');
        if (received > 0 && response.status !== 206) {
          throw new ApiError(0, 'RANGE_IGNORED', 'Le PC n’a pas accepté la reprise du téléchargement. Relancez-le depuis le début.');
        }

        reader = response.body.getReader();
        for (;;) {
          if (control.cancelled || control.paused) {
            await reader.cancel().catch(() => undefined);
            break;
          }
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > expected.size) throw new ApiError(0, 'TOO_LARGE', 'Le fichier reçu dépasse la taille annoncée.');
          hasher.update(value);
          if (writable) await writable.write(value);
          else parts.push(value);
          retries = 0;

          const now = performance.now();
          if (now - lastTick >= 500) {
            const instant = ((received - lastBytes) / (now - lastTick)) * 1000;
            smoothedSpeed = smoothedSpeed === 0 ? instant : smoothedSpeed * 0.7 + instant * 0.3;
            lastTick = now;
            lastBytes = received;
          }
          onProgress(received, expected.size, smoothedSpeed);
        }
      } catch (error) {
        await reader?.cancel().catch(() => undefined);
        if (control.cancelled) continue;
        if (error instanceof ApiError) throw error;
        // Coupure réseau : on reprend à la position déjà reçue, jusqu'à MAX_RETRIES fois de suite.
        retries += 1;
        smoothedSpeed = 0;
        if (retries > MAX_RETRIES) {
          throw new Error('Connexion perdue pendant le téléchargement. Relancez-le : la progression sera perdue.');
        }
        await wait(Math.min(1000 * 2 ** retries, 8000));
      }
    }

    if (received !== expected.size) throw new Error('Le fichier reçu est incomplet. Relancez le téléchargement.');
    if (hasher.digest('hex') !== expected.sha256) {
      throw new Error('La vérification SHA-256 a échoué. Le fichier n’a pas été enregistré.');
    }

    if (writable) {
      await writable.close();
      return 'completed';
    }
    const blob = new Blob(parts as BlobPart[]);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = ticket.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    parts.length = 0;
    return 'completed';
  } catch (error) {
    await discard();
    throw error;
  }
}
