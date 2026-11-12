import { apiRequest } from './api';

const CHUNK_PREF_KEY = 'transfert.chunkMb';

export const MIN_CHUNK_BYTES = 256 * 1024;
const FALLBACK_LIMITS = { maxChunkBytes: 16 * 1024 * 1024, defaultChunkBytes: 4 * 1024 * 1024 };

export interface ServerLimits {
  maxChunkBytes: number;
  defaultChunkBytes: number;
}

let cachedLimits: ServerLimits | null = null;

/** Tailles de bloc acceptées par le PC (réglables côté PC avec TRANSFERT_MAX_CHUNK_MB). */
export async function getServerLimits(): Promise<ServerLimits> {
  if (cachedLimits) return cachedLimits;
  try {
    const info = await apiRequest<Partial<ServerLimits>>('/api/info');
    const max = Number(info.maxChunkBytes);
    const base = Number(info.defaultChunkBytes);
    cachedLimits = {
      maxChunkBytes: Number.isFinite(max) && max >= MIN_CHUNK_BYTES ? max : FALLBACK_LIMITS.maxChunkBytes,
      defaultChunkBytes: Number.isFinite(base) && base >= MIN_CHUNK_BYTES ? base : FALLBACK_LIMITS.defaultChunkBytes,
    };
  } catch {
    return FALLBACK_LIMITS;
  }
  return cachedLimits;
}

/** Préférence de l'utilisateur en Mo ; `null` = automatique (adaptée à la vitesse du réseau). */
export function getChunkPreferenceMb(): number | null {
  try {
    const value = Number(localStorage.getItem(CHUNK_PREF_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function setChunkPreferenceMb(value: number | null): void {
  try {
    if (value === null) localStorage.removeItem(CHUNK_PREF_KEY);
    else localStorage.setItem(CHUNK_PREF_KEY, String(value));
  } catch {
    // Stockage indisponible : la préférence ne sera pas conservée.
  }
}

/**
 * Détermine la taille de chaque bloc. En mode automatique, elle double quand un bloc part en moins
 * d'une seconde et diminue de moitié quand il dépasse 5 secondes (Wi-Fi faible ou saturé).
 */
export class ChunkSizer {
  private size: number;
  private readonly fixed: boolean;

  constructor(private readonly limits: ServerLimits, preferenceMb: number | null) {
    this.fixed = preferenceMb !== null;
    const wanted = preferenceMb !== null ? preferenceMb * 1024 * 1024 : Math.min(limits.defaultChunkBytes, 2 * 1024 * 1024);
    this.size = this.clamp(wanted);
  }

  private clamp(value: number): number {
    return Math.max(MIN_CHUNK_BYTES, Math.min(Math.floor(value), this.limits.maxChunkBytes));
  }

  next(): number {
    return this.size;
  }

  record(durationMs: number, failed = false): void {
    if (this.fixed) return;
    if (failed || durationMs > 5000) this.size = this.clamp(this.size / 2);
    else if (durationMs < 1000) this.size = this.clamp(this.size * 2);
  }
}
