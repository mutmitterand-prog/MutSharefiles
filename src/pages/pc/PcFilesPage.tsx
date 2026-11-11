import { useState } from 'react';
import { ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { usePolling } from '@/hooks/usePolling';
import { apiRequest, formatBytes, formatDate } from '@/services/api';
import type { FolderListing, Settings } from '@/types';

export default function PcFilesPage() {
  const settings = usePolling(() => apiRequest<Settings>('/api/local/settings'), 60000);
  const [rootId, setRootId] = useState<string | null>(null);
  const [path, setPath] = useState('');
  const activeRoot = rootId ?? settings.data?.sharedFolders[0]?.id ?? null;

  const listing = usePolling<FolderListing | null>(
    () => (activeRoot ? apiRequest<FolderListing>(`/api/local/files?root=${encodeURIComponent(activeRoot)}&path=${encodeURIComponent(path)}`) : Promise.resolve(null)),
    5000,
    [activeRoot, path],
  );

  const segments = path ? path.split('/') : [];

  return (
    <>
      <PageHeader title="Fichiers" subtitle="Explorez uniquement les dossiers que vous avez partagés." />
      <div className="grid gap-5 md:grid-cols-[220px_1fr]">
        <Card className="h-fit p-3">
          <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Dossiers partagés</p>
          <ul className="space-y-1">
            {settings.data?.sharedFolders.map((folder) => (
              <li key={folder.id}>
                <button
                  type="button"
                  onClick={() => {
                    setRootId(folder.id);
                    setPath('');
                  }}
                  className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition ${
                    activeRoot === folder.id
                      ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <Folder size={16} />
                  <span className="truncate">{folder.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="min-w-0">
          <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm text-slate-500">
            <button type="button" onClick={() => setPath('')} className="font-medium text-teal-600 hover:underline dark:text-teal-400">
              {listing.data?.root.label ?? 'Racine'}
            </button>
            {segments.map((segment, index) => (
              <span key={`${segment}-${index}`} className="flex items-center gap-1">
                <ChevronRight size={14} />
                <button
                  type="button"
                  onClick={() => setPath(segments.slice(0, index + 1).join('/'))}
                  className="hover:text-slate-800 hover:underline dark:hover:text-slate-200"
                >
                  {segment}
                </button>
              </span>
            ))}
          </nav>

          {listing.error && <p className="mb-3 text-sm text-rose-600 dark:text-rose-400">{listing.error.message}</p>}

          {listing.data && listing.data.entries.length > 0 ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {listing.data.entries.map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    disabled={entry.type === 'file'}
                    onClick={() => setPath(entry.path)}
                    className="flex w-full items-center gap-3 py-3 text-left transition enabled:hover:bg-slate-50 dark:enabled:hover:bg-slate-800/60"
                  >
                    {entry.type === 'folder' ? <FolderOpen size={18} className="text-teal-600" /> : <FileText size={18} className="text-slate-400" />}
                    <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
                    <span className="hidden text-xs text-slate-500 sm:block">{formatBytes(entry.size)}</span>
                    <span className="hidden text-xs text-slate-500 md:block">{formatDate(entry.modifiedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : listing.data ? (
            <EmptyState icon={<Folder size={22} />} title="Dossier vide" />
          ) : null}
          {listing.data?.truncated && <p className="mt-3 text-xs text-amber-600">Affichage limité aux premiers 2000 éléments.</p>}
        </Card>
      </div>
    </>
  );
}
