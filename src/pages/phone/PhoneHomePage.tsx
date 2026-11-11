import { ArrowRight, ArrowLeftRight, FolderOpen, Monitor } from 'lucide-react';
import { Badge, Button, Card, EmptyState, PageHeader } from '@/components/ui';
import { usePolling } from '@/hooks/usePolling';
import { apiRequest, formatBytes, formatDate } from '@/services/api';
import type { HistoryEntry } from '@/types';

interface Props {
  token: string;
  computerName: string;
  onNavigate: (page: 'transfer' | 'files') => void;
}

export default function PhoneHomePage({ token, computerName, onNavigate }: Props) {
  const history = usePolling(() => apiRequest<{ items: HistoryEntry[] }>('/api/device/history', { token }), 5000, [token]);
  const items = history.data?.items ?? [];

  return (
    <>
      <PageHeader title="Accueil" subtitle="Votre téléphone est connecté." />
      <div className="space-y-5">
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-teal-50 p-2.5 text-teal-600 dark:bg-teal-500/10 dark:text-teal-300">
              <Monitor size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-500 dark:text-slate-400">Ordinateur connecté</p>
              <p className="truncate font-semibold">{computerName}</p>
            </div>
            <Badge tone="success">Connecté</Badge>
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onNavigate('transfer')}
            className="flex flex-col items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition active:scale-[0.98] dark:border-slate-800 dark:bg-slate-900"
          >
            <ArrowLeftRight size={22} className="text-teal-600 dark:text-teal-400" />
            <span className="font-medium">Transférer</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('files')}
            className="flex flex-col items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition active:scale-[0.98] dark:border-slate-800 dark:bg-slate-900"
          >
            <FolderOpen size={22} className="text-teal-600 dark:text-teal-400" />
            <span className="font-medium">Parcourir le PC</span>
          </button>
        </div>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Derniers transferts</h2>
            <ArrowRight size={16} className="text-slate-400" />
          </div>
          {items.length === 0 ? (
            <EmptyState icon={<ArrowLeftRight size={20} />} title="Aucun transfert" text="Vos envois et réceptions apparaîtront ici." />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.slice(0, 5).map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span className="truncate font-medium">{entry.fileName}</span>
                  <span className="shrink-0 text-xs text-slate-500">{formatBytes(entry.size)} · {formatDate(entry.endedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Button variant="ghost" className="w-full" onClick={() => history.refresh()}>Actualiser</Button>
      </div>
    </>
  );
}
