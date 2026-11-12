import { useState } from 'react';
import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react';
import { Button, Card, EmptyState, ErrorBanner, PageHeader } from '@/components/ui';
import { usePolling } from '@/hooks/usePolling';
import { apiRequest, formatBytes } from '@/services/api';
import { downloadToDevice } from '@/services/download';
import type { FolderEntry, FolderListing, SharedFolder } from '@/types';

interface Props {
  token: string;
}

interface Location {
  rootId: string;
  rootLabel: string;
  path: string;
}

export default function PhoneFilesPage({ token }: Props) {
  const [location, setLocation] = useState<Location | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const roots = usePolling(() => apiRequest<{ items: SharedFolder[] }>('/api/device/roots', { token }), 60000, [token]);
  const listing = usePolling(
    async (): Promise<FolderListing | null> =>
      location
        ? apiRequest<FolderListing>(
            `/api/device/files?root=${encodeURIComponent(location.rootId)}&path=${encodeURIComponent(location.path)}`,
            { token },
          )
        : null,
    60000,
    [token, location?.rootId, location?.path],
  );

  const open = (entry: FolderEntry) => {
    if (!location) return;
    setLocation({ ...location, path: entry.path });
  };

  const goUp = () => {
    if (!location) return;
    const parts = location.path.split('/').filter(Boolean);
    parts.pop();
    setLocation({ ...location, path: parts.join('/') });
  };

  const receive = async (entry: FolderEntry) => {
    if (!location) return;
    setError(null);
    setBusy(true);
    try {
      await downloadToDevice({ source: 'folder', root: location.rootId, path: entry.path }, token, () => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Le téléchargement a échoué.');
    } finally {
      setBusy(false);
    }
  };

  const rootList = roots.data?.items ?? [];

  return (
    <>
      <PageHeader title="Fichiers" subtitle="Parcourez les dossiers partagés du PC et récupérez un fichier." />
      <div className="space-y-4">
        <ErrorBanner message={error} />
        {!location ? (
          <Card>
            <h2 className="mb-3 font-semibold">Dossiers partagés</h2>
            {rootList.length === 0 ? (
              <EmptyState icon={<Folder size={22} />} title="Aucun dossier partagé" />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {rootList.map((root) => (
                  <li key={root.id}>
                    <button
                      type="button"
                      onClick={() => setLocation({ rootId: root.id, rootLabel: root.label, path: '' })}
                      className="flex w-full items-center justify-between gap-3 py-3.5 text-left"
                    >
                      <span className="flex items-center gap-3 font-medium">
                        <FolderOpen size={20} className="text-teal-600 dark:text-teal-400" /> {root.label}
                      </span>
                      <ChevronRight size={18} className="text-slate-400" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : (
          <Card>
            <div className="mb-3 flex items-center justify-between gap-3">
              <button type="button" onClick={() => setLocation(null)} className="text-sm text-teal-600 dark:text-teal-400">
                Dossiers partagés
              </button>
              <span className="truncate text-sm text-slate-500">
                {location.rootLabel}{location.path ? ` / ${location.path}` : ''}
              </span>
            </div>
            {location.path && (
              <Button variant="ghost" onClick={goUp} className="mb-2 px-2">Dossier parent</Button>
            )}
            {listing.error && <ErrorBanner message={listing.error.message} />}
            {listing.data && listing.data.entries.length === 0 && (
              <EmptyState icon={<Folder size={22} />} title="Dossier vide" />
            )}
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {listing.data?.entries.map((entry) => (
                <li key={entry.path} className="flex items-center justify-between gap-3 py-3">
                  {entry.type === 'folder' ? (
                    <button type="button" onClick={() => open(entry)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <Folder size={20} className="shrink-0 text-amber-500" />
                      <span className="truncate font-medium">{entry.name}</span>
                    </button>
                  ) : (
                    <>
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <File size={20} className="shrink-0 text-slate-400" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{entry.name}</p>
                          <p className="text-xs text-slate-500">{formatBytes(entry.size)}</p>
                        </div>
                      </div>
                      <Button variant="secondary" onClick={() => receive(entry)} disabled={busy} className="shrink-0 px-3">
                        Télécharger
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            {listing.data?.truncated && (
              <p className="mt-3 text-xs text-slate-500">La liste est limitée aux 2000 premiers éléments.</p>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
