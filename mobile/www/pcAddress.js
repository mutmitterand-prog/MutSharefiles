// Analyse des adresses de PC (QR code ou saisie manuelle). Aucune dépendance : testable avec Node.js.
(function (root) {

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
    if (url.protocol === 'http:' && !url.port) throw new Error('Ajoutez le port affiché dans TRANSFERT, ou scannez directement son QR code.');
    var port = url.port || ''; 
    var origin = url.protocol + '//' + url.hostname + (port ? ':' + port : '');
    var pair = url.searchParams.get('pair');
    // Adresses de secours du même PC (autres cartes réseau), placées dans le QR code : alt=ip1,ip2
    var alts = [];
    var altParam = url.searchParams.get('alt');
    if (altParam) {
      altParam.split(',').forEach(function (h) {
        h = h.trim();
        if (!h || !/^[A-Za-z0-9.\-]+$/.test(h) || !isPrivateHost(h)) return;
        var o = url.protocol + '//' + h + (port ? ':' + port : '');
        if (o !== origin && alts.indexOf(o) === -1 && alts.length < 4) alts.push(o);
      });
    }
    return { origin: origin, pair: pair, alts: alts, url: origin + '/' + (pair ? '?pair=' + encodeURIComponent(pair) : '') };
  }

  /** Le port exact est fourni par le QR code ; les adresses de secours ne changent que l'IP. */
  function candidateOrigins(origin, alts) { return [origin].concat(alts || []); }

  var api = { parseServerAddress: parseServerAddress, isPrivateHost: isPrivateHost, candidateOrigins: candidateOrigins };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PcAddress = api;
})(typeof window !== 'undefined' ? window : globalThis);
