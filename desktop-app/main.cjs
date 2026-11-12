// Application Windows TRANSFERT : lance le serveur local avec le Node.js intégré à Electron,
// affiche l'interface dans une fenêtre et ajoute une icône dans la zone de notification.
const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

// Port préféré : 8787. S'il est occupé par une autre application, le serveur en choisit un autre
// tout seul et l'écrit dans server.port ; `port` est alors mis à jour (voir startServer).
const DEFAULT_PORT = Number(process.env.TRANSFERT_PORT) || 8787;
let port = DEFAULT_PORT;
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
  for (const candidate of new Set([readPortFile(), DEFAULT_PORT].filter(Boolean))) {
    if (await isTransfert(candidate)) {
      port = candidate;
      return true;
    }
  }
  return false;
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
      // TRANSFERT_PORT n'est transmis que s'il a été imposé : sinon le serveur prend le premier port libre.
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
          ? `Le serveur n'a pas pu démarrer. Le port ${DEFAULT_PORT} est imposé par TRANSFERT_PORT mais déjà utilisé par une autre application : supprimez cette variable pour qu'un port libre soit choisi automatiquement. Détails : logs\\server.log.`
          : `Le serveur s'est arrêté de façon inattendue (code ${code}).`,
      );
    }
  });
  const ready = await waitForServer();
  updateTrayMenu();
  return ready;
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

function updateTrayMenu() {
  if (!tray) return;
  const running = Boolean(serverProcess);
  tray.setToolTip(running ? 'TRANSFERT : serveur actif' : 'TRANSFERT : serveur arrêté');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Ouvrir TRANSFERT', click: showWindow },
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
      { type: 'separator' },
      { label: 'Quitter', click: () => app.quit() },
    ]),
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(async () => {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 32, height: 32 }));
    tray.on('click', showWindow);
    updateTrayMenu();
    const ready = await startServer();
    if (!ready && !serverProcess) {
      // Déjà signalé par la boîte de dialogue d'erreur de l'arrêt du serveur.
    } else if (!ready) {
      dialog.showErrorBox('TRANSFERT', "Le serveur ne répond pas. Consultez le fichier logs\\server.log dans le dossier de données de l'application.");
    }
    showWindow();
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
