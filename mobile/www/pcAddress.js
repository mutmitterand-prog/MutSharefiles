// Analyse des adresses de PC (QR code ou saisie manuelle). Aucune dépendance : testable avec Node.js.
(function (root) {
  var DEFAULT_PORT = '8787';

  function isPrivateHost(hostname) {
    var host = hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local')) return true;
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (m) {
      var a = Number(m[1]);
      var b = Number(m[2]);
      return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
    }
    // Nom d'ordinateur sans point (ex. DESKTOP-ABC) : réseau local.
    return host.indexOf('.') === -1 && host.indexOf(':') === -1;
  }

  /** Retourne { origin, pair, url } ou lève une Error au message lisible. */
  function parseServerAddress(text) {
    var value = String(text == null ? '' : text).trim();
    if (!value) throw new Error("Saisissez l'adresse affichée sur le PC.");
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = 'http://' + value;
    var url;
    try {
      url = new URL(value);
    } catch (e) {
      throw new Error('Adresse invalide.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Adresse invalide.');
    if (!isPrivateHost(url.hostname)) {
      throw new Error("Cette adresse n'est pas celle d'un ordinateur de votre réseau local.");
    }
    var port = url.port || (url.protocol === 'http:' ? DEFAULT_PORT : '');
    var origin = url.protocol + '//' + url.hostname + (port ? ':' + port : '');
    var pair = url.searchParams.get('pair');
    return { origin: origin, pair: pair, url: origin + '/' + (pair ? '?pair=' + encodeURIComponent(pair) : '') };
  }

  /**
   * Adresses à essayer pour un PC : si l'adresse utilise le port par défaut, TRANSFERT a pu prendre
   * un port voisin (8788, 8789...) parce qu'une autre application occupe déjà 8787.
   */
  function candidateOrigins(origin) {
    var m = /^(https?:\/\/[^/:]+):(\d+)$/.exec(origin);
    if (!m || m[2] !== DEFAULT_PORT) return [origin];
    var list = [origin];
    for (var i = 1; i <= 20; i++) list.push(m[1] + ':' + (Number(DEFAULT_PORT) + i));
    return list;
  }

  var api = { parseServerAddress: parseServerAddress, isPrivateHost: isPrivateHost, candidateOrigins: candidateOrigins };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PcAddress = api;
})(typeof window !== 'undefined' ? window : globalThis);
