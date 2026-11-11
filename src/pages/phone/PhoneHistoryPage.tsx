import { History } from 'lucide-react';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { usePolling } from '@/hooks/usePolling';
import { apiRequest, formatBytes, formatDate } from '@/services/api';
import type { HistoryEntry } from '@/types';

interface Props {
  token: string;
}

const STATUS_LABEL: Record<HistoryEntry['status'], string> = {
  completed: 'Terminé',
  failed: 'Échec',
  cancelled: 'Annulé',
};

const STATUS_TONE: Record<HistoryEntry['status'], 'success' | 'error' | 'neutral'> = {
  completed: 'success',
  failed: 'error',
  cancelled: 'neutral',
};

export default function PhoneHistoryPage({ token }: Props) {
  const history = usePolling(() => apiRequest<{ items: HistoryEntry[] }>('/api/device/history', { token }), 5000, [token]);
  const items = history.data?.items ?? [];

  return (
    <>
      <PageHeader title="Historique" subtitle="Vos transferts récents avec l'ordinateur." />
      {items.length === 0 ? (
        <Card>
          <EmptyState icon={<History size={22} />} title="Aucun transfert" text="Les transferts terminés ou échoués apparaissent ici." />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{entry.fileName}</p>
                  <p className="text-xs text-slate-500">
                    {entry.direction === 'android_to_pc' ? 'Envoyé au PC' : 'Reçu du PC'} · {formatBytes(entry.size)} · {formatDate(entry.endedAt)}
                  </p>
                  {entry.error && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{entry.error}</p>}
                </div>
                <Badge tone={STATUS_TONE[entry.status]}>{STATUS_LABEL[entry.status]}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
