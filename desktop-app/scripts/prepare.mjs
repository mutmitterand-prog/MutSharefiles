// Prépare le contenu de l'application Windows : copie le serveur et l'interface web construite,
// et recopie les dépendances du serveur dans le package.json de l'application.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const root = path.resolve(appDir, '..');

const webDist = path.join(root, 'dist');
if (!fs.existsSync(path.join(webDist, 'index.html'))) {
  console.error("L'interface web n'est pas construite : lancez d'abord « npm run build » à la racine du projet.");
  process.exit(1);
}

fs.rmSync(path.join(appDir, 'server'), { recursive: true, force: true });
fs.rmSync(path.join(appDir, 'dist'), { recursive: true, force: true });
fs.mkdirSync(path.join(appDir, 'server'), { recursive: true });
fs.cpSync(path.join(root, 'desktop-server', 'src'), path.join(appDir, 'server', 'src'), { recursive: true });
fs.cpSync(webDist, path.join(appDir, 'dist'), { recursive: true });

const serverPkg = JSON.parse(fs.readFileSync(path.join(root, 'desktop-server', 'package.json'), 'utf8'));
// Le dossier server/ garde « type: module » pour que Node charge les fichiers .js en ES modules.
fs.writeFileSync(path.join(appDir, 'server', 'package.json'), JSON.stringify({ type: 'module' }, null, 2));

const appPkgPath = path.join(appDir, 'package.json');
const appPkg = JSON.parse(fs.readFileSync(appPkgPath, 'utf8'));
appPkg.dependencies = { ...serverPkg.dependencies };
if (process.env.APP_VERSION) appPkg.version = process.env.APP_VERSION;
fs.writeFileSync(appPkgPath, JSON.stringify(appPkg, null, 2));
console.log('Charge utile prête. Dépendances :', Object.keys(appPkg.dependencies).join(', '), '· version', appPkg.version);
