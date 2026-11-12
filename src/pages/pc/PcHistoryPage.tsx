import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { usePolling } from '@/hooks/usePolling';
import { apiRequest, formatBytes, formatDate, formatDuration } from '@/services/api';
import type { HistoryEntry, TransferDirection } from '@/types';

type Filter = 'all' | TransferDirection;

const STATUS_LABEL = { completed: 'Terminé', failed: 'Échec', cancelled: 'Annulé' } as const;
const STATUS_TONE = { completed: 'success', failed: 'error', cancelled: 'neutral' } as const;

export default function PcHistoryPage() {
  const history = usePolling(() => apiRequest<{ items: HistoryEntry[] }>('/api/local/history'), 5000);
  const [filter, setFilter] = useState<Filter>('all');
  const items = (history.data?.items ?? []).filter((entry) => filter === 'all' || entry.direction === filter);

  return (
    <>
      <PageHeader title="Historique" subtitle="Tous les transferts effectués avec vos téléphones." />
      <div className="mb-5 flex flex-wrap gap-2">
        {(['all', 'android_to_pc', 'pc_to_android'] as Filter[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              filter === value
                ? 'bg-teal-600 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {value === 'all' ? 'Tous' : value === 'android_to_pc' ? 'Reçus' : 'Envoyés'}
          </button>
        ))}
      </div>

      {items.length > 0 ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
              <tr>
                <th className="px-5 py-3 font-medium">Fichier</th>
                <th className="px-3 py-3 font-medium">Sens</th>
                <th className="px-3 py-3 font-medium">Taille</th>
                <th className="px-3 py-3 font-medium">Date</th>
                <th className="px-3 py-3 font-medium">Durée</th>
                <th className="px-5 py-3 font-medium">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.map((entry) => {
                const sentToPhone = entry.direction === 'pc_to_android';
                return (
                  <tr key={entry.id} className="transition hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="max-w-[260px] px-5 py-3">
                      <p className="truncate font-medium">{entry.fileName}</p>
                      <p className="text-xs text-slate-500">{entry.deviceName}</p>
                    </td>
                    <td className="px-3 py-3">
                      <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                        {sentToPhone ? <ArrowUpFromLine size={14} /> : <ArrowDownToLine size={14} />}
                        {sentToPhone ? 'Vers téléphone' : 'Du téléphone'}
                      </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">{formatBytes(entry.size)}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{formatDate(entry.endedAt)}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{formatDuration(entry.durationMs)}</td>
                    <td className="px-5 py-3">
                      <Badge tone={STATUS_TONE[entry.status]}>{STATUS_LABEL[entry.status]}</Badge>
                      {entry.error && <p className="mt-1 text-xs text-rose-500">{entry.error}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : (
        <EmptyState icon={<ArrowDownToLine size={22} />} title="Aucun transfert" text="Les transferts apparaîtront ici dès leur fin." />
      )}
    </>
  );
}
