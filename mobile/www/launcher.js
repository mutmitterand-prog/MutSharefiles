(function () {
  'use strict';
  var STORAGE_KEY = 'transfert.pcs';
  var $ = function (id) { return document.getElementById(id); };
  var messageEl = $('message');
  var scanning = false;
  var stream = null;

  function say(text, info) {
    messageEl.textContent = text || '';
    messageEl.className = info ? 'info' : '';
  }

  function loadPcs() {
    try {
      var list = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }
  function savePcs(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (e) { /* stockage indisponible */ }
  }
  function remember(origin, name) {
    var list = loadPcs().filter(function (pc) { return pc.origin !== origin; });
    list.unshift({ origin: origin, name: name || origin, lastUsed: Date.now() });
    savePcs(list.slice(0, 10));
  }

  function renderList() {
    var list = loadPcs();
    $('saved').hidden = list.length === 0;
    var ul = $('pc-list');
    ul.textContent = '';
    list.forEach(function (pc) {
      var li = document.createElement('li');
      var info = document.createElement('div');
      info.className = 'name';
      var title = document.createElement('b');
      title.textContent = pc.name;
      var sub = document.createElement('small');
      sub.textContent = pc.origin;
      info.appendChild(title);
      info.appendChild(sub);
      var open = document.createElement('button');
      open.textContent = 'Ouvrir';
      open.addEventListener('click', function () { openPc(pc.origin, null, true); });
      var remove = document.createElement('button');
      remove.textContent = '✕';
      remove.className = 'remove';
      remove.setAttribute('aria-label', 'Oublier ' + pc.name);
      remove.addEventListener('click', function () {
        savePcs(loadPcs().filter(function (item) { return item.origin !== pc.origin; }));
        renderList();
      });
      li.appendChild(info);
      li.appendChild(open);
      li.appendChild(remove);
      ul.appendChild(li);
    });
  }

  async function fetchInfo(origin) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 4000);
    try {
      var response = await fetch(origin + '/api/info', { signal: controller.signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var info = await response.json();
      if (!info || info.appName !== 'TRANSFERT') throw new Error('autre service');
      return info;
    } finally {
      clearTimeout(timer);
    }
  }

  // L'adresse complète contient le port attribué au démarrage ; aucune recherche de ports voisins.
  async function findPc(origin) {
    var origins = window.PcAddress.candidateOrigins(origin);
    for (var i = 0; i < origins.length; i++) {
      try {
        var info = await fetchInfo(origins[i]);
        return { origin: origins[i], info: info };
      } catch (e) {
        // essai suivant
      }
    }
    return null;
  }

  async function openPc(origin, pair, fromSavedList) {
    say('Connexion au PC…', true);
    var found = await findPc(origin);
    if (!found) {
      say(fromSavedList
        ? 'Cette ancienne adresse enregistrée ne répond plus (' + origin + '). Le port du serveur a probablement changé. Retournez sur le PC, ouvrez TRANSFERT et scannez le QR code ACTUEL. Vous pouvez aussi supprimer cette ancienne entrée avec ✕.'
        : 'PC introuvable (' + origin + '). Vérifiez que TRANSFERT est lancé, puis scannez le QR code ACTUEL affiché sur le PC. Si nécessaire, autorisez le port actuel dans le pare-feu Windows avec scripts\\autoriser-pare-feu-windows.bat.');
      return;
    }
    origin = found.origin;
    remember(origin, found.info.computerName);
    window.location.href = origin + '/' + (pair ? '?pair=' + encodeURIComponent(pair) : '');
  }

  function stopScan() {
    scanning = false;
    if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
    stream = null;
    $('scanner').hidden = true;
    $('home').hidden = false;
  }

  async function startScan() {
    say('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      say("La caméra n'est pas disponible. Saisissez l'adresse à la main.");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch (e) {
      say("Accès à la caméra refusé. Autorisez la caméra pour TRANSFERT dans les réglages d'Android, ou saisissez l'adresse à la main.");
      return;
    }
    var video = $('video');
    var canvas = $('canvas');
    var context = canvas.getContext('2d', { willReadFrequently: true });
    video.srcObject = stream;
    await video.play();
    $('home').hidden = true;
    $('scanner').hidden = false;
    scanning = true;

    var tick = function () {
      if (!scanning) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        var image = context.getImageData(0, 0, canvas.width, canvas.height);
        var code = window.jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
        if (code && code.data) {
          try {
            var target = window.PcAddress.parseServerAddress(code.data);
            stopScan();
            openPc(target.origin, target.pair);
            return;
          } catch (e) {
            stopScan();
            say(e.message);
            return;
          }
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  $('scan').addEventListener('click', startScan);
  $('scan-cancel').addEventListener('click', stopScan);
  $('manual').addEventListener('submit', function (event) {
    event.preventDefault();
    try {
      var target = window.PcAddress.parseServerAddress($('manual-url').value);
      openPc(target.origin, target.pair);
    } catch (e) {
      say(e.message);
    }
  });

  renderList();
})();
