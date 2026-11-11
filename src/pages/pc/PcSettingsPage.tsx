import { useEffect, useState, type FormEvent } from 'react';
import { FolderPlus, Moon, Power, Sun, Trash2 } from 'lucide-react';
import { Button, Card, ErrorBanner, Modal, PageHeader } from '@/components/ui';
import { usePolling } from '@/hooks/usePolling';
import { apiRequest } from '@/services/api';
import type { Settings } from '@/types';

interface Props {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export default function PcSettingsPage({ theme, onToggleTheme }: Props) {
  const settings = usePolling(() => apiRequest<Settings>('/api/local/settings'), 60000);
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    if (settings.data) setName(settings.data.computerName);
  }, [settings.data]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    setSaved(false);
    try {
      await action();
      setSaved(true);
      settings.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.');
    }
  };

  const saveName = (event: FormEvent) => {
    event.preventDefault();
    run(() => apiRequest('/api/local/settings/computer-name', { method: 'PUT', body: { computerName: name } }));
  };

  const addFolder = (event: FormEvent) => {
    event.preventDefault();
    run(async () => {
      await apiRequest('/api/local/settings/shared-folders', { method: 'POST', body: { label, path: folderPath } });
      setLabel('');
      setFolderPath('');
    });
  };

  const removeFolder = (id: string) =>
    run(() => apiRequest(`/api/local/settings/shared-folders/${id}`, { method: 'DELETE' }));

  const stopServer = async () => {
    await apiRequest('/api/local/shutdown', { method: 'POST' }).catch(() => undefined);
    setConfirmStop(false);
    setStopped(true);
  };

  const inputClass =
    'w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-950';

  return (
    <>
      <PageHeader title="Paramètres" subtitle="Nom de l'ordinateur, dossiers partagés et serveur." />
      <div className="space-y-5">
        <ErrorBanner message={error} />
        {saved && <p className="text-sm text-emerald-600 dark:text-emerald-400">Modifications enregistrées.</p>}

        <Card>
          <h2 className="mb-4 font-semibold">Ordinateur et serveur</h2>
          <form onSubmit={saveName} className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="space-y-1.5 text-sm">
              <span className="text-slate-600 dark:text-slate-300">Nom de l'ordinateur</span>
              <input className={inputClass} value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
            </label>
            <Button type="submit">Enregistrer</Button>
          </form>
          <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Port du serveur</dt>
              <dd className="mt-1 font-mono font-medium">{settings.data?.port ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Démarrage</dt>
              <dd className="mt-1 text-slate-600 dark:text-slate-300">Lancez scripts/start-windows.bat</dd>
            </div>
          </dl>
          <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-200 pt-5 dark:border-slate-800">
            <Button variant="danger" onClick={() => setConfirmStop(true)} disabled={stopped}>
              <Power size={16} /> Arrêter le serveur
            </Button>
            {stopped && <p className="self-center text-sm text-slate-500">Le serveur est arrêté. Relancez-le avec start-windows.bat.</p>}
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold">Dossiers partagés</h2>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            Seuls ces dossiers sont accessibles depuis le téléphone. Le reste du disque n'est jamais exposé.
          </p>
          <ul className="mb-5 divide-y divide-slate-100 dark:divide-slate-800">
            {settings.data?.sharedFolders.map((folder) => (
              <li key={folder.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{folder.label}</p>
                  <p className="truncate font-mono text-xs text-slate-500">{folder.path}</p>
                </div>
                <Button variant="ghost" onClick={() => removeFolder(folder.id)} disabled={settings.data?.sharedFolders.length === 1} className="px-2 py-2 text-rose-600 dark:text-rose-400" aria-label="Retirer ce dossier">
                  <Trash2 size={16} />
                </Button>
              </li>
            ))}
          </ul>
          <form onSubmit={addFolder} className="grid gap-3 sm:grid-cols-[180px_1fr_auto] sm:items-end">
            <label className="space-y-1.5 text-sm">
              <span className="text-slate-600 dark:text-slate-300">Nom affiché</span>
              <input className={inputClass} value={label} maxLength={60} onChange={(event) => setLabel(event.target.value)} />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="text-slate-600 dark:text-slate-300">Chemin complet du dossier</span>
              <input className={inputClass} value={folderPath} placeholder="C:\Users\Nom\Documents\Partage" onChange={(event) => setFolderPath(event.target.value)} required />
            </label>
            <Button type="submit" variant="secondary"><FolderPlus size={16} /> Ajouter</Button>
          </form>
        </Card>

        <Card>
          <h2 className="mb-4 font-semibold">Affichage</h2>
          <Button variant="secondary" onClick={onToggleTheme}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            {theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
          </Button>
        </Card>
      </div>

      {confirmStop && (
        <Modal title="Arrêter le serveur ?" onClose={() => setConfirmStop(false)}>
          <p className="mb-5 text-sm text-slate-600 dark:text-slate-300">
            Les téléphones ne pourront plus se connecter ni transférer de fichiers tant que le serveur est arrêté.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setConfirmStop(false)}>Annuler</Button>
            <Button variant="danger" onClick={stopServer}>Arrêter</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
