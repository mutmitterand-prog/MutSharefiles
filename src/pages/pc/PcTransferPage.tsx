import { useState, type ReactNode } from 'react';
import { Download, FileUp, Trash2, Upload } from 'lucide-react';
import { Badge, Button, Card, EmptyState, PageHeader } from '@/components/ui';
import { UploadQueue } from '@/components/UploadQueue';
import { useUploadQueue } from '@/hooks/useUploadQueue';
import { usePolling } from '@/hooks/usePolling';
import { apiRequest, formatBytes, formatDate } from '@/services/api';
import type { HistoryEntry, OutboxItem } from '@/types';

type Tab = 'send' | 'receive';

export default function PcTransferPage() {
  const [tab, setTab] = useState<Tab>('send');
  return (
    <>
      <PageHeader title="Transfert" subtitle="Échangez des fichiers avec votre téléphone Android." />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:max-w-md">
        <TabButton active={tab === 'send'} onClick={() => setTab('send')} icon={<Upload size={18} />} label="Envoyer vers téléphone" />
        <TabButton active={tab === 'receive'} onClick={() => setTab('receive')} icon={<Download size={18} />} label="Recevoir depuis téléphone" />
      </div>
      {tab === 'send' ? <SendToPhone /> : <ReceiveFromPhone />}
    </>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition ${
        active
          ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function SendToPhone() {
  const outbox = usePolling(() => apiRequest<{ items: OutboxItem[] }>('/api/local/outbox'), 4000);
  const queue = useUploadQueue({ basePath: '/api/local/uploads', meta: {}, onCompleted: () => outbox.refresh() });

  const removeItem = async (id: string) => {
    if (!window.confirm('Retirer ce fichier de la liste d\'envoi ? Le fichier original sur le PC n\'est pas supprimé.')) return;
    await apiRequest(`/api/local/outbox/${id}`, { method: 'DELETE' });
    outbox.refresh();
  };

  return (
    <div className="space-y-5">
      <Card>
        <label className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 px-6 py-10 text-center transition hover:border-teal-500 hover:bg-teal-50/50 dark:border-slate-700 dark:hover:bg-teal-500/5">
          <FileUp size={32} className="text-teal-600 dark:text-teal-400" />
          <span className="font-medium">Choisissez un ou plusieurs fichiers</span>
          <span className="text-sm text-slate-500">Ils seront disponibles dans l'application du téléphone. Le fichier original reste sur le PC.</span>
          <input
            type="file"
            multiple
            className="sr-only"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length > 0) queue.enqueue(files);
              event.target.value = '';
            }}
          />
        </label>
      </Card>

      <UploadQueue
        items={queue.items}
        onPause={queue.pause}
        onResume={queue.resume}
        onRetry={queue.retry}
        onCancel={queue.cancel}
        onReplace={(key) => queue.resolveDuplicate(key, 'overwrite')}
        onKeepBoth={(key) => queue.resolveDuplicate(key, 'rename')}
        onClear={queue.clearFinished}
      />

      <Card>
        <h2 className="mb-4 font-semibold">Fichiers disponibles pour le téléphone</h2>
        {outbox.data && outbox.data.items.length > 0 ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {outbox.data.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.name}</p>
                  <p className="text-xs text-slate-500">{formatBytes(item.size)} · ajouté le {formatDate(item.createdAt)}</p>
                </div>
                <Button variant="ghost" onClick={() => removeItem(item.id)} className="px-2 py-2 text-rose-600 dark:text-rose-400" aria-label="Retirer de la liste">
                  <Trash2 size={16} />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<Upload size={22} />} title="Aucun fichier en attente" text="Les fichiers ajoutés ici apparaissent sur le téléphone dès la fin de l'envoi." />
        )}
      </Card>
    </div>
  );
}

function ReceiveFromPhone() {
  const history = usePolling(() => apiRequest<{ items: HistoryEntry[] }>('/api/local/history'), 4000);
  const received = history.data?.items.filter((entry) => entry.direction === 'android_to_pc') ?? [];

  return (
    <Card>
      <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">
        Depuis le téléphone, choisissez « Envoyer au PC ». Les fichiers arrivent dans le dossier partagé choisi (voir la page Fichiers).
        Chaque réception est vérifiée par empreinte SHA-256 avant d'être enregistrée.
      </p>
      {received.length > 0 ? (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {received.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{entry.fileName}</p>
                <p className="text-xs text-slate-500">{entry.deviceName} · {formatBytes(entry.size)} · {formatDate(entry.endedAt)}</p>
              </div>
              <Badge tone={entry.status === 'completed' ? 'success' : entry.status === 'failed' ? 'error' : 'neutral'}>
                {entry.status === 'completed' ? 'Reçu' : entry.status === 'failed' ? 'Échec' : 'Annulé'}
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Download size={22} />} title="Aucune réception pour le moment" />
      )}
    </Card>
  );
}
