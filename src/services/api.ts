const TOKEN_KEY = 'transfert.deviceToken';
const DEVICE_NAME_KEY = 'transfert.deviceName';

export class ApiError extends Error {
  status: number;
  code: string;
  extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const deviceSession = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  getDeviceName: () => localStorage.getItem(DEVICE_NAME_KEY),
  save(token: string, deviceName: string) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(DEVICE_NAME_KEY, deviceName);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(DEVICE_NAME_KEY);
  },
};

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK', 'Connexion perdue avec le PC. Vérifiez que vous êtes sur le même Wi-Fi.');
  }

  const data = await readBody(response);
  if (!response.ok) {
    const message =
      typeof data?.message === 'string'
        ? data.message
        : 'Le serveur TRANSFERT ne répond pas. Vérifiez qu’il est démarré sur l’ordinateur.';
    const code = typeof data?.error === 'string' ? data.error : 'ERROR';
    throw new ApiError(response.status, code, message, data ?? {});
  }
  return data as T;
}

async function readBody(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '-';
  if (bytes < 1024) return `${bytes} o`;
  const units = ['Ko', 'Mo', 'Go', 'To'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024 * 1024) return `${Math.round(bytesPerSec / 1024)} Ko/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} Mo/s`;
}

/** Temps restant estimé, lisible (« 2 min 05 s »). Vide si la vitesse est inconnue. */
export function formatEta(remainingBytes: number, bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0 || remainingBytes <= 0) return '';
  const seconds = Math.ceil(remainingBytes / bytesPerSec);
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
  return `${Math.floor(seconds / 3600)} h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')} min`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}
