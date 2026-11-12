/**
 * Limiteur de tentatives en mémoire : `max` échecs par `windowMs` et par clé
 * (adresse IP), puis blocage pendant `blockMs`.
 */
export function createFailureLimiter({ max, windowMs, blockMs, now = () => Date.now() }) {
  const entries = new Map();

  function prune(time) {
    for (const [key, entry] of entries) {
      if (entry.blockedUntil <= time && entry.windowStart + windowMs <= time) entries.delete(key);
    }
  }

  return {
    /** Retourne le nombre de millisecondes restantes si la clé est bloquée, sinon 0. */
    blockedFor(key) {
      const entry = entries.get(key);
      const time = now();
      return entry && entry.blockedUntil > time ? entry.blockedUntil - time : 0;
    },
    recordFailure(key) {
      const time = now();
      prune(time);
      let entry = entries.get(key);
      if (!entry || entry.windowStart + windowMs <= time) {
        entry = { count: 0, windowStart: time, blockedUntil: 0 };
        entries.set(key, entry);
      }
      entry.count += 1;
      if (entry.count >= max) entry.blockedUntil = time + blockMs;
    },
    reset(key) {
      entries.delete(key);
    },
    get size() {
      return entries.size;
    },
  };
}
