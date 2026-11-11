import { ApiError } from '../security/ApiError.js';
import { authenticateDevice } from '../services/deviceService.js';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export const LOCAL_ACTOR = Object.freeze({ id: 'local', name: 'Ce PC', kind: 'local' });

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function hostnameOf(hostHeader) {
  const value = String(hostHeader ?? '').toLowerCase();
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1);
  return value.split(':')[0];
}

/**
 * Routes réservées au PC. Trois contrôles :
 *  1. la connexion vient bien de la boucle locale ;
 *  2. l'en-tête Host désigne localhost (empêche le « DNS rebinding » depuis un site web malveillant) ;
 *  3. si le navigateur envoie un en-tête Origin, il doit aussi désigner localhost (empêche qu'un autre site
 *     déclenche, par exemple, l'arrêt du serveur ou l'acceptation d'un jumelage).
 */
export function requireLocal(req, res, next) {
  if (!LOOPBACK_ADDRESSES.has(req.socket.remoteAddress)) {
    next(new ApiError(403, 'LOCAL_ONLY', 'Cette action est réservée à l\'ordinateur.'));
    return;
  }
  if (!LOCAL_HOSTNAMES.has(hostnameOf(req.headers.host))) {
    next(new ApiError(403, 'BAD_HOST', 'Adresse d\'accès non autorisée pour cette action. Utilisez http://localhost.'));
    return;
  }
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let originHost = '';
    try {
      originHost = new URL(origin).hostname;
    } catch {
      originHost = '';
    }
    const normalized = originHost === '::1' ? '[::1]' : originHost;
    if (!LOCAL_HOSTNAMES.has(normalized)) {
      next(new ApiError(403, 'BAD_ORIGIN', 'Origine de la requête non autorisée.'));
      return;
    }
  }
  req.actor = LOCAL_ACTOR;
  next();
}

export async function requireDevice(req, res, next) {
  try {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    const device = await authenticateDevice(token);
    if (!device) {
      next(new ApiError(401, 'UNAUTHORIZED', 'Cet appareil n\'est plus autorisé. Associez-le de nouveau avec le QR code.'));
      return;
    }
    req.actor = { id: device.id, name: device.name, kind: 'device', ip: device.ip };
    next();
  } catch (error) {
    next(error);
  }
}
