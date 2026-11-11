import { useRef, useState } from 'react';
import { Download, FileUp, Pause, Play, Upload, XCircle } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader, ProgressBar, ErrorBanner } from '@/components/ui';
import { UploadQueue } from '@/components/UploadQueue';
import { usePolling } from '@/hooks/usePolling';
import { useUploadQueue } from '@/hooks/useUploadQueue';
import { apiRequest, formatBytes, formatDate, formatEta, formatSpeed } from '@/services/api';
import { createDownloadControl, downloadToDevice, type DownloadControl } from '@/services/download';
import type { OutboxItem, SharedFolder } from '@/types';

type Tab = 'send' | 'receive';

interface Props {
  token: string;
}

export default function PhoneTransferPage({ token }: Props) {
  const [tab, setTab] = useState<Tab>('send');
  return (
    <>
      <PageHeader title="Transfert" subtitle="Envoyez vers le PC ou récupérez les fichiers mis à disposition." />
      <div className="mb-6 grid grid-cols-2 gap-3">
        <TabButton active={tab === 'send'} onClick={() => setTab('send')} label="Envoyer au PC" />
        <TabButton active={tab === 'receive'} onClick={() => setTab('receive')} label="Recevoir du PC" />
      </div>
      {tab === 'send' ? <SendToPc token={token} /> : <ReceiveFromPc token={token} />}
    </>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-4 py-3.5 text-sm font-medium transition ${
        active
          ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300'
          : 'border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
      }`}
    >
      {label}
    </button>
  );
}

function SendToPc({ token }: Props) {
  const roots = usePolling(() => apiRequest<{ items: SharedFolder[] }>('/api/device/roots', { token }), 60000, [token]);
  const rootId = roots.data?.items[0]?.id;
  const queue = useUploadQueue({
    basePath: '/api/device/uploads',
    token,
    meta: { rootId, folder: '' },
  });

  return (
    <div className="space-y-5">
      <Card>
        <label className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 px-5 py-10 text-center transition active:bg-teal-50 dark:border-slate-700 dark:active:bg-teal-500/5">
          <FileUp size={36} className="text-teal-600 dark:text-teal-400" />
          <span className="font-medium">Choisir des fichiers</span>
          <span className="text-sm text-slate-500 dark:text-slate-400">Ils seront enregistrés dans le dossier partagé du PC.</span>
          <input
            type="file"
            multiple
            className="sr-only"
            disabled={!rootId}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length > 0) queue.enqueue(files);
              event.target.value = '';
            }}
          />
        </label>
        {roots.data && !rootId && (
          <div className="mt-4"><ErrorBanner message="Aucun dossier partagé n'est configuré sur le PC." /></div>
        )}
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
    </div>
  );
}

function ReceiveFromPc({ token }: Props) {
  const outbox = usePolling(() => apiRequest<{ items: OutboxItem[] }>('/api/device/outbox', { token }), 5000, [token]);
  const [progress, setProgress] = useState<{ id: string; received: number; total: number; speed: number; paused: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const controlRef = useRef<DownloadControl | null>(null);

  const receive = async (item: OutboxItem) => {
    setError(null);
    setNotice(null);
    const control = createDownloadControl();
    controlRef.current = control;
    setProgress({ id: item.id, received: 0, total: item.size, speed: 0, paused: false });
    try {
      const result = await downloadToDevice(
        { source: 'outbox', id: item.id },
        token,
        (received, total, speed) => setProgress({ id: item.id, received, total, speed, paused: control.paused }),
        control,
      );
      if (result === 'native') {
        setNotice('Fichier volumineux : le téléchargement est confié au navigateur (voir la barre de notifications).');
      } else if (result === 'cancelled') {
        setNotice('Téléchargement annulé.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Le téléchargement a échoué.');
    } finally {
      controlRef.current = null;
      setProgress(null);
    }
  };

  const togglePause = () => {
    const control = controlRef.current;
    if (!control) return;
    control.paused = !control.paused;
    setProgress((current) => (current ? { ...current, paused: control.paused, speed: 0 } : current));
  };

  const cancelDownload = () => {
    const control = controlRef.current;
    if (!control) return;
    control.cancelled = true;
    control.abort.abort();
  };

  return (
    <Card>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Fichiers que le PC a mis à disposition. Chaque fichier est vérifié avant d'être enregistré sur le téléphone.
      </p>
      <div className="mb-4"><ErrorBanner message={error} /></div>
      {notice && <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">{notice}</p>}
      {outbox.data && outbox.data.items.length > 0 ? (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {outbox.data.items.map((item) => (
            <li key={item.id} className="space-y-2 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.name}</p>
                  <p className="text-xs text-slate-500">{formatBytes(item.size)} · {formatDate(item.createdAt)}</p>
                </div>
                <Button variant="secondary" onClick={() => receive(item)} disabled={progress !== null} className="shrink-0 px-3">
                  <Download size={16} /> Recevoir
                </Button>
              </div>
              {progress?.id === item.id && (
                <div className="space-y-2">
                  <ProgressBar value={progress.total > 0 ? (progress.received / progress.total) * 100 : 0} />
                  <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>{progress.total > 0 ? ((progress.received / progress.total) * 100).toFixed(0) : 0} %</span>
                    <span>{progress.paused ? 'En pause' : formatSpeed(progress.speed)}</span>
                    {!progress.paused && formatEta(progress.total - progress.received, progress.speed) && (
                      <span>Environ {formatEta(progress.total - progress.received, progress.speed)}</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={togglePause} className="py-1.5 text-xs">
                      {progress.paused ? <Play size={14} /> : <Pause size={14} />} {progress.paused ? 'Reprendre' : 'Pause'}
                    </Button>
                    <Button variant="ghost" onClick={cancelDownload} className="py-1.5 text-xs">
                      <XCircle size={14} /> Annuler
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Upload size={22} />} title="Rien à recevoir" text="Le PC n'a mis aucun fichier à disposition pour le moment." />
      )}
    </Card>
  );
}
