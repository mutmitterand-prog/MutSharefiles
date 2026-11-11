// Application Windows TRANSFERT : lance le serveur local avec le Node.js intégré à Electron,
// affiche l'interface dans une fenêtre et ajoute une icône dans la zone de notification.
const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const PORT = Number(process.env.TRANSFERT_PORT) || 8787;
const URL_LOCAL = `http://localhost:${PORT}`;
const ICON = path.join(__dirname, 'build', 'icon.png');

let serverProcess = null;
let serverStopping = false;
let mainWindow = null;
let tray = null;
let quitting = false;

function request(method, urlPath, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('timeout', () => { req.destroy(); resolve(0); });
    req.on('error', () => resolve(0));
    req.end();
  });
}

const serverIsUp = async () => (await request('GET', '/api/info')) === 200;

async function waitForServer(maxMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await serverIsUp()) return true;
    if (!serverProcess) return false;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function startServer() {
  if (serverProcess) return true;
  if (await serverIsUp()) return true; // un serveur TRANSFERT tourne déjà (autre instance ou terminal)
  const entry = path.join(__dirname, 'server', 'src', 'server.js');
  serverStopping = false;
  serverProcess = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      // Utilise le Node.js intégré à Electron : aucune installation de Node.js n'est nécessaire.
      ELECTRON_RUN_AS_NODE: '1',
      TRANSFERT_DATA_DIR: path.join(app.getPath('userData'), 'data'),
      TRANSFERT_PORT: String(PORT),
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
          ? `Le serveur n'a pas pu démarrer. Le port ${PORT} est peut-être déjà utilisé par une autre application.`
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
  await request('POST', '/api/local/shutdown');
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
      if (!url.startsWith(URL_LOCAL)) {
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
    mainWindow.loadURL(URL_LOCAL);
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
    if (!ready) {
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
