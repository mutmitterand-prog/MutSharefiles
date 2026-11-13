// Application Windows TRANSFERT : lance le serveur local avec le Node.js intégré à Electron,
// affiche l'interface dans une fenêtre et ajoute une icône dans la zone de notification.
const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell } = require('electron');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

// Le serveur choisit lui-même un port TCP libre et l'annonce dans server.port.
let port = 0;
const urlLocal = () => `http://localhost:${port}`;
const dataDir = () => path.join(app.getPath('userData'), 'data');
const portFile = () => path.join(dataDir(), 'server.port');
const ICON = path.join(__dirname, 'build', 'icon.png');

let serverProcess = null;
let serverStopping = false;
let mainWindow = null;
let tray = null;
let quitting = false;

function request(method, urlPath, timeoutMs = 1500, targetPort = port) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: targetPort, path: urlPath, method, timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { if (body.length < 4096) body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.end();
  });
}

// Vérifie qu'il s'agit bien d'un serveur TRANSFERT : une autre application peut répondre sur le même port.
async function isTransfert(targetPort) {
  const { status, body } = await request('GET', '/api/info', 1500, targetPort);
  if (status !== 200) return false;
  try {
    return JSON.parse(body).appName === 'TRANSFERT';
  } catch {
    return false;
  }
}

function readPortFile() {
  try {
    const value = Number(fs.readFileSync(portFile(), 'utf8').trim());
    return Number.isInteger(value) && value > 0 && value < 65536 ? value : null;
  } catch {
    return null;
  }
}

// Cherche un serveur TRANSFERT déjà actif (autre instance ou terminal) et mémorise son port.
async function adoptRunningServer() {
  const candidates = [...new Set([readPortFile(), ...Array.from({ length: 13 }, (_, i) => 8787 + i)].filter(Boolean))];
  const answers = await Promise.all(candidates.map(async (candidate) => ((await isTransfert(candidate)) ? candidate : null)));
  const found = answers.find(Boolean);
  if (!found) return false;
  port = found;
  return true;
}

// Attend que le serveur lancé par nous annonce son port, puis qu'il réponde.
async function waitForServer(maxMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const announced = readPortFile();
    if (announced && (await isTransfert(announced))) {
      port = announced;
      return true;
    }
    if (!serverProcess) return false;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function startServer() {
  if (serverProcess) return true;
  if (await adoptRunningServer()) return true; // un serveur TRANSFERT tourne déjà (autre instance ou terminal)
  fs.rmSync(portFile(), { force: true }); // port périmé d'un ancien lancement
  const entry = path.join(__dirname, 'server', 'src', 'server.js');
  serverStopping = false;
  serverProcess = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      // Utilise le Node.js intégré à Electron : aucune installation de Node.js n'est nécessaire.
      ELECTRON_RUN_AS_NODE: '1',
      TRANSFERT_DATA_DIR: dataDir(),
      // Ne transmet la surcharge que si l'administrateur l'a explicitement définie.
      ...(process.env.TRANSFERT_PORT ? { TRANSFERT_PORT: process.env.TRANSFERT_PORT } : {}),
    },
    windowsHide: true,
    stdio: 'ignore',
  });
  serverProcess.on('exit', (code) => {
    const crashed = !serverStopping && !quitting;
    serverProcess = null;
    updateTrayMenu();
    if (crashed) {
      dialog.showErrorBox(
        'TRANSFERT',
        code === 1
          ? `Le serveur n'a pas pu démarrer sur le port demandé explicitement. Supprimez TRANSFERT_PORT pour utiliser la sélection automatique. Détails : logs\\server.log.`
          : `Le serveur s'est arrêté de façon inattendue (code ${code}).`,
      );
    }
  });
  const ready = await waitForServer();
  updateTrayMenu();
  // La fenêtre peut afficher « Connexion perdue » d'un ancien serveur : on la recharge sur le serveur actif.
  if (ready && mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(urlLocal());
  return ready;
}

// Garantit qu'un serveur TRANSFERT répond ; le relance sinon (processus arrêté à la main, planté ou figé).
async function ensureServer() {
  if (port && (await isTransfert(port))) return true;
  if (serverProcess) await stopServer();
  return startServer();
}

async function stopServer() {
  if (!serverProcess) return;
  serverStopping = true;
  const child = serverProcess;
  const done = new Promise((resolve) => child.once('exit', resolve));
  // On ne contacte que notre propre serveur (port annoncé), jamais l'autre application.
  if (await isTransfert(port)) await request('POST', '/api/local/shutdown');
  const timer = setTimeout(() => child.kill(), 4000);
  await done;
  clearTimeout(timer);
}

// ---- Pare-feu Windows ---------------------------------------------------------------------
// Sans règle d'entrée, Windows bloque silencieusement le téléphone (la fenêtre d'alerte ne s'affiche pas toujours
// pour un processus caché). On ajoute donc une règle PAR PROGRAMME (réseaux privés et domaine) : elle couvre
// tous les ports utilisés par TRANSFERT, même si le port change.
const FIREWALL_RULE = 'TRANSFERT - Reseau prive';
const firewallMarker = () => path.join(dataDir(), 'firewall.json');

function runTool(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: options.timeout || 15000, env: { ...process.env, ...(options.env || {}) } }, (error, stdout) => {
      resolve({ ok: !error, stdout: String(stdout || '') });
    });
  });
}

async function firewallRuleOk() {
  if (process.platform !== 'win32') return true;
  const shown = await runTool('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${FIREWALL_RULE}`]);
  if (!shown.ok) return false;
  try {
    return JSON.parse(fs.readFileSync(firewallMarker(), 'utf8')).exe === process.execPath;
  } catch {
    return false;
  }
}

async function installFirewallRule() {
  const exe = process.execPath;
  const bat = path.join(app.getPath('temp'), 'transfert-pare-feu.bat');
  fs.writeFileSync(
    bat,
    [
      '@echo off',
      `netsh advfirewall firewall delete rule name="${FIREWALL_RULE}" >nul 2>nul`,
      `netsh advfirewall firewall add rule name="${FIREWALL_RULE}" dir=in action=allow program="${exe}" protocol=TCP profile=private,domain enable=yes`,
      'exit /b %errorlevel%',
      '',
    ].join('\r\n'),
  );
  // Une seule demande d'autorisation administrateur (UAC).
  const script = '$p = Start-Process -FilePath $env:TRANSFERT_FW_BAT -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode';
  const result = await runTool('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    timeout: 120000,
    env: { TRANSFERT_FW_BAT: bat },
  });
  fs.rmSync(bat, { force: true });
  if (!result.ok) return false;
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(firewallMarker(), JSON.stringify({ exe, at: new Date().toISOString() }));
  return firewallRuleOk();
}

// force = true : demandé depuis le menu de l'icône (affiche toujours le résultat).
async function ensureFirewall(force) {
  if (process.platform !== 'win32') return;
  if (!force && (await firewallRuleOk())) return;
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const choice = await dialog.showMessageBox(parent, {
    type: 'question',
    buttons: ['Autoriser', 'Plus tard'],
    defaultId: 0,
    cancelId: 1,
    title: 'TRANSFERT',
    message: 'Autoriser TRANSFERT dans le pare-feu Windows ?',
    detail: "Sans cette autorisation, le téléphone ne peut pas joindre le PC sur le Wi-Fi (« PC introuvable »). Windows va demander la confirmation d'un administrateur. L'accès est limité aux réseaux privés.",
  });
  if (choice.response !== 0) return;
  const ok = await installFirewallRule();
  await dialog.showMessageBox(parent, {
    type: ok ? 'info' : 'warning',
    title: 'TRANSFERT',
    message: ok ? 'Pare-feu Windows configuré.' : "L'autorisation n'a pas été appliquée.",
    detail: ok
      ? 'Le téléphone peut maintenant se connecter. Si le QR code ne fonctionne toujours pas, vérifiez que le Wi-Fi est bien « Privé » dans Windows.'
      : "Réessayez depuis l'icône TRANSFERT > « Autoriser dans le pare-feu Windows », et acceptez la fenêtre d'administrateur.",
  });
}

function showWindow() {
  if (!mainWindow) {
    mainWindow = new BrowserWindow({
      width: 1100,
      height: 760,
      minWidth: 420,
      minHeight: 600,
      title: 'TRANSFERT',
      icon: ICON,
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    mainWindow.setMenu(null);
    // Les liens externes s'ouvrent dans le navigateur, jamais dans l'application.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(urlLocal())) {
        event.preventDefault();
        shell.openExternal(url);
      }
    });
    mainWindow.on('close', (event) => {
      if (!quitting) {
        event.preventDefault();
        mainWindow.hide(); // la fenêtre se ferme, le serveur reste actif dans la zone de notification
      }
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    mainWindow.loadURL(urlLocal());
  }
  mainWindow.show();
  mainWindow.focus();
}

// Ouvre la fenêtre en s'assurant que le serveur tourne (clic sur l'icône, nouveau lancement de l'exe).
async function openApp() {
  const wasRunning = Boolean(port) && (await isTransfert(port));
  if (!wasRunning) await ensureServer();
  showWindow();
}

function updateTrayMenu() {
  if (!tray) return;
  const running = Boolean(serverProcess);
  tray.setToolTip(running ? 'TRANSFERT : serveur actif' : 'TRANSFERT : serveur arrêté');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Ouvrir TRANSFERT', click: openApp },
      { label: 'Autoriser dans le pare-feu Windows', click: () => ensureFirewall(true), visible: process.platform === 'win32' },
      { type: 'separator' },
      { label: running ? 'Serveur actif' : 'Serveur arrêté', enabled: false },
      {
        label: running ? 'Arrêter le serveur' : 'Démarrer le serveur',
        click: async () => {
          if (serverProcess) await stopServer();
          else await startServer();
          updateTrayMenu();
        },
      },
      {
        label: 'Redémarrer le serveur',
        click: async () => {
          if (serverProcess) await stopServer();
          await startServer();
          updateTrayMenu();
        },
      },
      { type: 'separator' },
      { label: 'Quitter', click: () => app.quit() },
    ]),
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', openApp);

  app.whenReady().then(async () => {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 32, height: 32 }));
    tray.on('click', openApp);
    updateTrayMenu();
    const ready = await startServer();
    if (!ready && !serverProcess) {
      // Déjà signalé par la boîte de dialogue d'erreur de l'arrêt du serveur.
    } else if (!ready) {
      dialog.showErrorBox('TRANSFERT', "Le serveur ne répond pas. Consultez le fichier logs\\server.log dans le dossier de données de l'application.");
    }
    showWindow();
    ensureFirewall(false).catch(() => {});
  });

  app.on('window-all-closed', () => { /* reste actif dans la zone de notification */ });

  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    if (serverProcess) {
      event.preventDefault();
      stopServer().finally(() => app.quit());
    }
  });
}
