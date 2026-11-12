import { useMemo, useState } from 'react';
import { ChevronRight, Copy, FileText, Folder, FolderOpen, FolderPlus, Pencil, Search, Trash2, Eye, ArrowUpDown, MoveRight } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader } from '@/components/ui';
import { usePolling } from '@/hooks/usePolling';
import { apiRequest, formatBytes, formatDate } from '@/services/api';
import type { FolderEntry, FolderListing, Overview, Settings } from '@/types';

type SortMode = 'name' | 'size' | 'date';
export default function PcFilesPage() {
  const settings = usePolling(() => apiRequest<Settings>('/api/local/settings'), 60000);
  const overview = usePolling(() => apiRequest<Overview>('/api/local/overview'), 30000);
  const [rootId, setRootId] = useState<string | null>(null);
  const [path, setPath] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('name');
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState('');
  const activeRoot = rootId ?? settings.data?.sharedFolders[0]?.id ?? null;
  const listing = usePolling<FolderListing | null>(
    () => (activeRoot ? apiRequest<FolderListing>(`/api/local/files?root=${encodeURIComponent(activeRoot)}&path=${encodeURIComponent(path)}`) : Promise.resolve(null)),
    10000,
    [activeRoot, path, refreshKey],
  );
  const results = usePolling<{ items: FolderEntry[]; truncated: boolean } | null>(
    () => activeRoot && search.trim().length >= 2
      ? apiRequest<{ items: FolderEntry[]; truncated: boolean }>(`/api/local/files/search?root=${encodeURIComponent(activeRoot)}&q=${encodeURIComponent(search.trim())}`)
      : Promise.resolve(null),
    15000,
    [activeRoot, search],
  );
  const entries = useMemo(() => {
    const source = search.trim().length >= 2 ? (results.data?.items ?? []) : (listing.data?.entries ?? []);
    return [...source].sort((a, b) => {
      if (a.type !== b.type && !search.trim()) return a.type === 'folder' ? -1 : 1;
      if (sort === 'size') return (b.size ?? -1) - (a.size ?? -1);
      if (sort === 'date') return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
      return a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' });
    });
  }, [listing.data, results.data, search, sort]);
  const segments = path ? path.split('/') : [];
  const activeDisk = overview.data?.disks.find((disk) => disk.id === activeRoot);

  const operate = async (operation: string, payload: Record<string, unknown> = {}) => {
    if (!activeRoot) return;
    setNotice('');
    try {
      await apiRequest('/api/local/files/operations', { method: 'POST', body: { rootId: activeRoot, operation, path, ...payload } });
      setRefreshKey((value) => value + 1);
      setNotice('Opération effectuée.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Opération impossible.');
    }
  };
  const createFolder = () => { const name = window.prompt('Nom du nouveau dossier'); if (name?.trim()) void operate('mkdir', { name: name.trim() }); };
  const entryActions = (entry: FolderEntry) => {
    const parent = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
    const source = search.trim().length >= 2 ? entry.path : entry.path;
    return <div className="flex items-center gap-1">
      {entry.type === 'file' && <button title="Prévisualiser" onClick={() => window.open(`/api/local/files/preview?root=${encodeURIComponent(activeRoot ?? '')}&path=${encodeURIComponent(source)}`, '_blank', 'noopener')} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><Eye size={16} /></button>}
      <button title="Renommer" onClick={() => { const name = window.prompt('Nouveau nom', entry.name); if (name?.trim()) void operate('rename', { path: source, name: name.trim() }); }} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><Pencil size={16} /></button>
      <button title="Copier vers un dossier" onClick={() => { const destination = window.prompt('Chemin du dossier de destination, relatif à la racine', parent); if (destination !== null) void operate('copy', { path: source, destination }); }} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><Copy size={16} /></button>
      <button title="Déplacer vers un dossier" onClick={() => { const destination = window.prompt('Chemin du dossier de destination, relatif à la racine', parent); if (destination !== null) void operate('move', { path: source, destination }); }} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><MoveRight size={16} /></button>
      <button title="Supprimer" onClick={() => { if (window.confirm(`Supprimer définitivement « ${entry.name} »${entry.type === 'folder' ? ' et tout son contenu' : ''} ?`)) void operate('delete', { path: source }); }} className="rounded-lg p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"><Trash2 size={16} /></button>
    </div>;
  };

  return <>
    <PageHeader title="Gestion des fichiers" subtitle="Explorez, recherchez, prévisualisez et gérez les fichiers de vos dossiers partagés."
      actions={<Button onClick={createFolder}><FolderPlus size={16} /> Nouveau dossier</Button>} />
    <div className="grid gap-5 md:grid-cols-[220px_1fr]">
      <Card className="h-fit p-3">
        <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Dossiers partagés</p>
        <ul className="space-y-1">{settings.data?.sharedFolders.map((folder) => <li key={folder.id}>
          <button type="button" onClick={() => { setRootId(folder.id); setPath(''); setSearch(''); }} className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm ${activeRoot === folder.id ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
            <Folder size={16} /><span className="truncate">{folder.label}</span>
          </button>
        </li>)}</ul>
        {listing.data && <p className="mt-4 px-2 text-xs text-slate-500">{listing.data.entries.length} élément(s) dans ce dossier</p>}
      </Card>
      <Card className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex min-w-[180px] flex-1 items-center gap-2 rounded-xl border border-slate-200 px-3 dark:border-slate-700"><Search size={16} className="text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher (2 caractères minimum)" className="w-full bg-transparent py-2 text-sm outline-none" /></div>
          <label className="flex items-center gap-2 text-xs text-slate-500"><ArrowUpDown size={14} /> Trier
            <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} className="rounded-lg border border-slate-200 bg-transparent px-2 py-2 text-sm dark:border-slate-700"><option value="name">Nom</option><option value="size">Taille</option><option value="date">Date</option></select>
          </label>
        </div>
        {activeDisk && <div className="mb-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">Espace disponible : <strong>{formatBytes(activeDisk.free)}</strong>{activeDisk.total ? ` sur ${formatBytes(activeDisk.total)}` : ''}</div>}
        {!search.trim() && <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm text-slate-500">
          <button type="button" onClick={() => setPath('')} className="font-medium text-teal-600 hover:underline dark:text-teal-400">{listing.data?.root.label ?? 'Racine'}</button>
          {segments.map((segment, index) => <span key={`${segment}-${index}`} className="flex items-center gap-1"><ChevronRight size={14} /><button type="button" onClick={() => setPath(segments.slice(0, index + 1).join('/'))} className="hover:underline">{segment}</button></span>)}
        </nav>}
        {notice && <p className="mb-3 text-sm text-teal-700 dark:text-teal-300">{notice}</p>}
        {(listing.error || results.error) && <p className="mb-3 text-sm text-rose-600">{(listing.error || results.error)?.message}</p>}
        {entries.length ? <ul className="divide-y divide-slate-100 dark:divide-slate-800">{entries.map((entry) => <li key={entry.path} className="flex items-center gap-2 py-2">
          <button type="button" disabled={entry.type === 'file' || Boolean(search.trim())} onClick={() => setPath(entry.path)} className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left disabled:cursor-default">
            {entry.type === 'folder' ? <FolderOpen size={18} className="shrink-0 text-teal-600" /> : <FileText size={18} className="shrink-0 text-slate-400" />}
            <span className="min-w-0 flex-1 truncate font-medium">{entry.name}{search.trim() && <span className="ml-2 text-xs font-normal text-slate-400">{entry.path}</span>}</span>
            <span className="hidden text-xs text-slate-500 sm:block">{formatBytes(entry.size)}</span>
            <span className="hidden text-xs text-slate-500 md:block">{formatDate(entry.modifiedAt)}</span>
          </button>
          {entryActions(entry)}
        </li>)}</ul> : (search.trim().length >= 2 || listing.data) ? <EmptyState icon={<Folder size={22} />} title="Aucun élément" text="Ce dossier ou cette recherche ne contient aucun résultat." /> : null}
        {listing.data?.truncated || results.data?.truncated ? <p className="mt-3 text-xs text-amber-600">Affichage limité aux 500/2000 premiers éléments.</p> : null}
        {listing.data?.entries.some((entry) => entry.type === 'file') && <p className="mt-4 text-xs text-slate-500">Images, PDF, audio et vidéos compatibles : utilisez l'icône d'aperçu. Les formats non pris en charge peuvent être téléchargés via le navigateur.</p>}
      </Card>
    </div>
  </>;
}
