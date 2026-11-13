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

  function lanPlugin() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Lan;
  }
  function failure(reason, detail) {
    var e = new Error(reason);
    e.reason = reason;
    e.detail = detail || '';
    return e;
  }

  // Sonde native Android (hors WebView : pas de blocage « contenu mixte »/CORS) ; repli sur fetch dans un navigateur.
  async function fetchInfo(origin) {
    var lan = lanPlugin();
    if (lan && lan.probe) {
      var r = await lan.probe({ url: origin + '/api/info', timeoutMs: 5000 });
      if (!r.ok) throw failure(r.reason || 'error', r.message);
      if (r.status !== 200) throw failure('other', 'HTTP ' + r.status);
      var info;
      try { info = JSON.parse(r.body); } catch (e) { throw failure('other', 'réponse illisible'); }
      if (!info || info.appName !== 'TRANSFERT') throw failure('other', 'autre service');
      return info;
    }
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 5000);
    try {
      var response = await fetch(origin + '/api/info', { signal: controller.signal });
      if (!response.ok) throw failure('other', 'HTTP ' + response.status);
      var data = await response.json();
      if (!data || data.appName !== 'TRANSFERT') throw failure('other', 'autre service');
      return data;
    } catch (e) {
      if (e && e.reason) throw e;
      throw failure(e && e.name === 'AbortError' ? 'timeout' : 'error', e && e.message);
    } finally {
      clearTimeout(timer);
    }
  }

  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  // Essaie chaque adresse (IP principale puis adresses de secours du QR code), deux fois : le Wi-Fi peut être en veille.
  async function findPc(origin, alts) {
    var origins = window.PcAddress.candidateOrigins(origin, alts);
    var reasons = {};
    for (var round = 0; round < 2; round++) {
      for (var i = 0; i < origins.length; i++) {
        try {
          var info = await fetchInfo(origins[i]);
          return { origin: origins[i], info: info };
        } catch (e) {
          reasons[origins[i]] = e && e.reason ? e.reason : 'error';
        }
      }
      if (round === 0) await sleep(700);
    }
    return { failed: reasons };
  }

  function explain(origin, reasons, fromSavedList) {
    var list = Object.keys(reasons).map(function (k) { return reasons[k]; });
    var has = function (r) { return list.indexOf(r) !== -1; };
    var tried = Object.keys(reasons).join(', ');
    if (fromSavedList) {
      return 'Cette adresse enregistrée ne répond plus (' + origin + '). Le port ou l\u2019adresse du PC a probablement changé. Scannez le QR code ACTUEL affiché sur le PC, ou supprimez cette entrée avec ✕.';
    }
    if (has('refused')) {
      return 'Le PC est joignable mais TRANSFERT n\u2019écoute pas sur ' + origin + '. Le port a changé depuis ce QR code : relancez TRANSFERT et scannez le QR code ACTUEL.';
    }
    if (has('other')) {
      return 'Une autre application répond à cette adresse (' + origin + '), pas TRANSFERT. Scannez le QR code ACTUEL du PC.';
    }
    if (has('unreachable')) {
      return 'Le téléphone ne trouve aucun chemin vers le PC (' + tried + '). Vérifiez que le téléphone et le PC sont sur le MÊME Wi-Fi (pas le réseau invité, pas les données mobiles).';
    }
    return 'PC introuvable (' + tried + '), délai dépassé. Cause la plus fréquente : le pare-feu Windows bloque la connexion. Sur le PC, relancez TRANSFERT et acceptez la fenêtre « Autoriser dans le pare-feu » (menu de l\u2019icône TRANSFERT), ou lancez scripts\\autoriser-pare-feu-windows.bat. Sinon, la box isole peut-être les appareils Wi-Fi (isolation client).';
  }

  async function openPc(origin, pair, fromSavedList, alts) {
    say('Connexion au PC…', true);
    var found = await findPc(origin, alts);
    if (!found.origin) {
      say(explain(origin, found.failed, fromSavedList));
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
            openPc(target.origin, target.pair, false, target.alts);
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
      openPc(target.origin, target.pair, false, target.alts);
    } catch (e) {
      say(e.message);
    }
  });

  // ---- USB OTG : deux modes natifs (Capacitor).
  //  - « direct » : pilotes intégrés NTFS / exFAT / FAT32 (lecture), indépendants du montage Android ;
  //  - « saf »    : sélecteur Android (Storage Access Framework), écriture possible si Android a monté le volume.
  var usbMode = null;
  var usbTreeUri = null;
  var usbCurrentUri = null;
  var usbStack = [];
  var progressTimer = null;
  function usbPlugin() { return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.UsbStorage; }
  function directPlugin() { return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.UsbDirect; }
  function activePlugin() { return usbMode === 'direct' ? directPlugin() : usbPlugin(); }
  function usbStatus(message) { $('usb-status').textContent = message; }
  function formatBytes(bytes) {
    if (!bytes) return 'Taille inconnue';
    var units = ['o', 'Ko', 'Mo', 'Go', 'To'], i = 0, n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return n.toFixed(i ? 1 : 0) + ' ' + units[i];
  }

  function stopProgress() { if (progressTimer) { clearInterval(progressTimer); progressTimer = null; } }
  function watchProgress(name) {
    stopProgress();
    progressTimer = setInterval(async function () {
      try {
        var p = await directPlugin().progress();
        if (!p.copying) return;
        var pct = p.total ? ' (' + Math.floor(p.done * 100 / p.total) + ' %)' : '';
        usbStatus('Copie de ' + name + ' : ' + formatBytes(p.done) + ' / ' + formatBytes(p.total) + pct);
      } catch (e) { /* ignoré */ }
    }, 600);
  }

  function renderUsb(items) {
    var ul = $('usb-list'); ul.textContent = '';
    items.forEach(function (item) {
      var li = document.createElement('li');
      var info = document.createElement('div'); info.className = 'name';
      var title = document.createElement('b'); title.textContent = (item.directory ? '📁 ' : '📄 ') + item.name;
      var sub = document.createElement('small'); sub.textContent = item.directory ? 'Dossier' : formatBytes(item.size || 0);
      info.appendChild(title); info.appendChild(sub); li.appendChild(info);
      var action = document.createElement('button');
      action.textContent = item.directory ? 'Ouvrir' : 'Copier vers téléphone';
      action.addEventListener('click', async function () {
        var plugin = activePlugin(); if (!plugin) return;
        try {
          if (item.directory) {
            usbStack.push(usbCurrentUri); usbCurrentUri = item.uri;
            await refreshUsb();
          } else {
            usbStatus('Copie en cours : ' + item.name);
            var result;
            if (usbMode === 'direct') {
              watchProgress(item.name);
              try { result = await plugin.copyToDownloads({ token: item.uri, name: item.name }); } finally { stopProgress(); }
            } else {
              result = await plugin.copyToDownloads({ uri: item.uri, name: item.name });
            }
            usbStatus('Copie terminée : ' + (result.name || item.name) + ' — dossier Téléchargements/TRANSFERT-USB.');
          }
        } catch (e) { usbStatus('Erreur : ' + (e.message || e)); }
      });
      li.appendChild(action); ul.appendChild(li);
    });
    if (!items.length) { var empty = document.createElement('li'); empty.textContent = 'Ce dossier est vide.'; ul.appendChild(empty); }
  }

  async function refreshUsb() {
    var plugin = activePlugin();
    if (!plugin) { usbStatus('La lecture USB nécessite l’application Android installée (APK), pas le navigateur web.'); return; }
    try {
      var current = usbCurrentUri || usbTreeUri;
      var result = await (usbMode === 'direct' ? plugin.list({ token: current }) : plugin.list({ uri: current }));
      renderUsb(result.items || []);
      $('usb-actions').hidden = false;
      $('usb-to-phone').hidden = usbMode === 'direct';
      usbStatus((result.name || 'Support USB') + ' — ' + (result.items || []).length + ' élément(s)' + (usbMode === 'direct' ? ' (lecture directe, copie vers le téléphone).' : '.'));
    } catch (e) { usbStatus('Impossible de lire ce dossier : ' + (e.message || e)); }
  }

  function renderVolumes(volumes) {
    var ul = $('usb-volumes'); ul.textContent = '';
    volumes.forEach(function (v) {
      var li = document.createElement('li');
      var info = document.createElement('div'); info.className = 'name';
      var title = document.createElement('b'); title.textContent = v.title;
      info.appendChild(title); li.appendChild(info);
      var open = document.createElement('button'); open.textContent = 'Ouvrir';
      open.addEventListener('click', function () { selectVolume(v.index); });
      li.appendChild(open); ul.appendChild(li);
    });
  }

  async function selectVolume(index) {
    usbTreeUri = 'v' + index; usbCurrentUri = usbTreeUri; usbStack = [];
    $('usb-volumes').textContent = '';
    await refreshUsb();
  }

  $('usb-direct').addEventListener('click', async function () {
    var plugin = directPlugin();
    if (!plugin) { usbStatus('Fonction disponible uniquement dans l’APK Android avec OTG.'); return; }
    $('usb-actions').hidden = true; $('usb-volumes').textContent = '';
    try {
      usbStatus('Recherche du support USB…');
      var scan = await plugin.scan();
      if (!scan.devices || !scan.devices.length) {
        var other = scan.others && scan.others.length ? ' Périphérique(s) USB vu(s) mais non reconnu(s) comme stockage : ' + scan.others.join(', ') + '.' : '';
        usbStatus('Aucun support USB détecté.' + other + ' Vérifiez l’adaptateur OTG et le câble de données. Un disque dur a souvent besoin d’une alimentation propre (boîtier alimenté ou hub USB alimenté) : le téléphone ne fournit pas assez de courant. Essayez un autre port ou câble, puis réessayez.');
        return;
      }
      var dev = scan.devices[0];
      usbStatus('Support « ' + dev.name + ' » détecté.' + (dev.permission ? ' Accès déjà autorisé par Android. Initialisation (jusqu’à 40 s pour un disque dur)…' : ' Acceptez la demande d’accès d’Android…'));
      var poll = setInterval(async function () {
        try { var st = await plugin.status(); if (st && st.phase) usbStatus('Support « ' + dev.name + ' » : ' + st.phase); } catch (e) { /* ignoré */ }
      }, 700);
      var opened;
      try { opened = await plugin.open({ id: dev.id }); } finally { clearInterval(poll); }
      usbMode = 'direct';
      if (!opened.volumes || !opened.volumes.length) {
        usbStatus('Support détecté (' + formatBytes(opened.capacity || 0) + ') mais aucun volume lisible. ' + (opened.notes || []).join(' '));
        return;
      }
      if (opened.volumes.length === 1) await selectVolume(opened.volumes[0].index);
      else { usbStatus('Plusieurs volumes trouvés : choisissez-en un.'); renderVolumes(opened.volumes); }
    } catch (e) { usbStatus('Erreur : ' + (e.message || e)); }
  });

  $('usb-connect').addEventListener('click', async function () {
    var plugin = usbPlugin();
    if (!plugin) { usbStatus('Fonction disponible uniquement dans l’APK Android avec OTG.'); return; }
    try {
      usbStatus('Sélectionnez la clé USB ou le dossier du disque dans le sélecteur Android…');
      var result = await plugin.pickUsb();
      usbMode = 'saf';
      usbTreeUri = result.uri; usbCurrentUri = result.uri; usbStack = [];
      $('usb-volumes').textContent = '';
      await refreshUsb();
    } catch (e) { usbStatus('Sélection annulée ou impossible : ' + (e.message || e) + ' — si votre disque n’apparaît pas dans le sélecteur, utilisez « Détecter le support ».'); }
  });
  $('usb-up').addEventListener('click', async function () {
    if (usbStack.length) { usbCurrentUri = usbStack.pop(); await refreshUsb(); }
    else { usbCurrentUri = usbTreeUri; await refreshUsb(); }
  });
  $('usb-to-phone').addEventListener('click', async function () {
    var plugin = usbPlugin(); if (!plugin || !usbTreeUri || usbMode !== 'saf') return;
    try {
      usbStatus('Choisissez un fichier sur le téléphone…');
      var result = await plugin.copyFromPhone({ treeUri: usbTreeUri });
      usbStatus('Copie terminée sur le support USB : ' + result.name);
      await refreshUsb();
    } catch (e) { usbStatus('Copie non effectuée : ' + (e.message || e)); }
  });

  renderList();
})();
