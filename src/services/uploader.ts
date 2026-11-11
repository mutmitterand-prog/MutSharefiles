import { createSHA256 } from 'hash-wasm';
import { ApiError, apiRequest } from './api';
import { ChunkSizer, getChunkPreferenceMb, getServerLimits } from './transferSettings';

// Taille de lecture pour le calcul de l'empreinte (indépendante de la taille des blocs réseau).
export const CHUNK_SIZE = 4 * 1024 * 1024;
const MAX_RETRIES = 6;

export interface UploadControl {
  paused: boolean;
  cancelled: boolean;
  abort: AbortController;
}

export interface UploadProgress {
  sent: number;
  speedBytesPerSec: number;
}

export interface UploadOptions {
  basePath: string;
  token?: string | null;
  meta: { rootId?: string; folder?: string; policy?: 'ask' | 'rename' | 'overwrite' };
  control: UploadControl;
  onPreparing: () => void;
  onProgress: (progress: UploadProgress) => void;
  onResumed: () => void;
}

export function createControl(): UploadControl {
  return { paused: false, cancelled: false, abort: new AbortController() };
}

export async function hashFileSha256(file: File): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();
  for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
    const buffer = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
    hasher.update(new Uint8Array(buffer));
  }
  return hasher.digest('hex');
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitWhilePaused(control: UploadControl) {
  while (control.paused && !control.cancelled) {
    await wait(250);
  }
}

export async function uploadFile(file: File, options: UploadOptions): Promise<{ fileName: string } | 'cancelled'> {
  const { control, basePath, token } = options;
  options.onPreparing();
  const sha256 = await hashFileSha256(file);
  if (control.cancelled) return 'cancelled';

  const session = await apiRequest<{ id: string; offset: number }>(basePath, {
    method: 'POST',
    token,
    body: { name: file.name, size: file.size, sha256, ...options.meta },
    signal: control.abort.signal,
  });
  const uploadPath = `${basePath}/${session.id}`;
  let offset = session.offset;
  const sizer = new ChunkSizer(await getServerLimits(), getChunkPreferenceMb());
  let smoothedSpeed = 0;
  let retries = 0;

  while (offset < file.size) {
    if (control.cancelled) {
      await apiRequest(uploadPath, { method: 'DELETE', token }).catch(() => undefined);
      return 'cancelled';
    }
    if (control.paused) {
      options.onResumed();
      await waitWhilePaused(control);
      continue;
    }
    const end = Math.min(offset + sizer.next(), file.size);
    const chunkStarted = performance.now();
    try {
      const response = await fetch(`${uploadPath}/chunk?offset=${offset}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/octet-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: file.slice(offset, end),
        signal: control.abort.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409 && typeof data.offset === 'number') {
          offset = data.offset;
          continue;
        }
        throw new ApiError(response.status, data.error ?? 'ERROR', data.message ?? 'Échec de l\'envoi du bloc.');
      }
      const chunkMs = performance.now() - chunkStarted;
      const sentBytes = (data.offset as number) - offset;
      offset = data.offset as number;
      retries = 0;
      sizer.record(chunkMs);
      // Vitesse lissée : moyenne mobile pour éviter un affichage qui saute à chaque bloc.
      const instant = sentBytes / Math.max(chunkMs / 1000, 0.001);
      smoothedSpeed = smoothedSpeed === 0 ? instant : smoothedSpeed * 0.7 + instant * 0.3;
      options.onProgress({ sent: offset, speedBytesPerSec: smoothedSpeed });
    } catch (error) {
      if (control.cancelled) continue;
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (error instanceof ApiError && error.code !== 'NETWORK') throw error;
      retries += 1;
      sizer.record(0, true);
      if (retries > MAX_RETRIES) {
        throw new ApiError(0, 'NETWORK', 'Connexion perdue pendant le transfert. Le transfert pourra reprendre plus tard.');
      }
      await wait(Math.min(1000 * 2 ** retries, 8000));
      const status = await apiRequest<{ offset: number }>(uploadPath, { token }).catch(() => null);
      if (status) offset = status.offset;
    }
  }

  const result = await apiRequest<{ fileName: string }>(`${uploadPath}/complete`, { method: 'POST', token });
  return { fileName: result.fileName };
}
