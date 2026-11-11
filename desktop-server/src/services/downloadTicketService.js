import { DOWNLOAD_TICKET_TTL_MS } from '../config.js';
import { ApiError } from '../security/ApiError.js';
import { generateToken } from '../security/tokens.js';

const tickets = new Map();

function pruneExpired() {
  const now = Date.now();
  for (const [token, ticket] of tickets) {
    if (ticket.expiresAt <= now) tickets.delete(token);
  }
}

export function createDownloadTicket(payload) {
  pruneExpired();
  const token = generateToken(24);
  const expiresAt = Date.now() + DOWNLOAD_TICKET_TTL_MS;
  tickets.set(token, { ...payload, expiresAt, recorded: false });
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

export function getDownloadTicket(token) {
  const ticket = tickets.get(token);
  if (!ticket || ticket.expiresAt <= Date.now()) {
    tickets.delete(token);
    throw new ApiError(404, 'DOWNLOAD_EXPIRED', 'Ce lien de téléchargement a expiré. Relancez le téléchargement.');
  }
  return ticket;
}
