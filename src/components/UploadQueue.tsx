import { CheckCircle2, Copy, Pause, Play, RefreshCcw, Trash2, XCircle } from 'lucide-react';
import { Badge, Button, Card, ProgressBar } from '@/components/ui';
import { formatBytes, formatEta, formatSpeed } from '@/services/api';
import type { QueueItem } from '@/hooks/useUploadQueue';

interface Props {
  items: QueueItem[];
  onPause: (key: string) => void;
  onResume: (key: string) => void;
  onRetry?: (key: string) => void;
  onCancel: (key: string) => void;
  onReplace: (key: string) => void;
  onKeepBoth: (key: string) => void;
  onClear: () => void;
}

const LABELS: Record<QueueItem['status'], string> = {
  waiting: 'En attente',
  preparing: 'Préparation (empreinte SHA-256)',
  uploading: 'Envoi en cours',
  paused: 'En pause',
  completed: 'Terminé et vérifié',
  failed: 'Échec',
  cancelled: 'Annulé',
  duplicate: 'Doublon détecté',
};

export function UploadQueue({ items, onPause, onResume, onRetry, onCancel, onReplace, onKeepBoth, onClear }: Props) {
  if (items.length === 0) return null;
  const finishedCount = items.filter((item) => ['completed', 'failed', 'cancelled'].includes(item.status)).length;
  const totalBytes = items.reduce((sum, item) => sum + item.file.size, 0);
  const sentBytes = items.reduce((sum, item) => sum + (item.status === 'completed' ? item.file.size : item.sent), 0);
  const globalProgress = totalBytes > 0 ? (sentBytes / totalBytes) * 100 : (finishedCount / items.length) * 100;

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Transferts en cours</h2>
        {finishedCount > 0 && (
          <Button variant="ghost" onClick={onClear} className="px-2 py-1 text-xs">
            Effacer les terminés
          </Button>
        )}
      </div>
      <div className="mb-4 space-y-2">
        <div className="flex justify-between text-xs text-slate-500"><span>Progression globale</span><span>{Math.round(globalProgress)} % · {items.filter((item) => item.status === 'completed').length}/{items.length} fichiers terminés</span></div>
        <ProgressBar value={globalProgress} />
      </div>
      <ul className="space-y-4">
        {items.map((item) => {
          const percent = item.file.size ? (item.sent / item.file.size) * 100 : 0;
          const remaining = item.file.size - item.sent;
          const tone = item.status === 'completed' ? 'success' : item.status === 'failed' ? 'error' : 'primary';
          const active = item.status === 'uploading' || item.status === 'paused';
          return (
            <li key={item.key} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.resultName ?? item.file.name}</p>
                  {(item.file as File & { webkitRelativePath?: string }).webkitRelativePath && <p className="truncate text-xs text-slate-500">{(item.file as File & { webkitRelativePath?: string }).webkitRelativePath}</p>}
                  <p className="text-xs text-slate-500">{formatBytes(item.file.size)}</p>
                </div>
                <Badge tone={item.status === 'completed' ? 'success' : item.status === 'failed' || item.status === 'duplicate' ? 'error' : item.status === 'paused' ? 'warning' : 'info'}>
                  {LABELS[item.status]}
                </Badge>
              </div>

              {(active || item.status === 'completed' || item.status === 'preparing') && (
                <div className="mt-3 space-y-2">
                  <ProgressBar value={percent} tone={tone} />
                  <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>{percent.toFixed(0)} %</span>
                    {item.status === 'uploading' && <span>{formatSpeed(item.speed)}</span>}
                    {item.status === 'uploading' && formatEta(remaining, item.speed) && (
                      <span>Environ {formatEta(remaining, item.speed)}</span>
                    )}
                    <span>Reste {formatBytes(Math.max(0, remaining))}</span>
                  </div>
                </div>
              )}

              {item.status === 'duplicate' && (
                <div className="mt-3 space-y-3">
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    Voulez-vous remplacer le fichier existant ? Le fichier reçu prendra sa place.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="danger" onClick={() => onReplace(item.key)} className="py-2 text-xs">
                      <RefreshCcw size={14} /> Remplacer
                    </Button>
                    <Button variant="secondary" onClick={() => onKeepBoth(item.key)} className="py-2 text-xs">
                      <Copy size={14} /> Garder les deux
                    </Button>
                    <Button variant="ghost" onClick={() => onCancel(item.key)} className="py-2 text-xs">
                      Ignorer
                    </Button>
                  </div>
                </div>
              )}

              {item.error && item.status !== 'duplicate' && (
                <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{item.error}</p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {item.status === 'uploading' && (
                  <Button variant="secondary" onClick={() => onPause(item.key)} className="py-1.5 text-xs">
                    <Pause size={14} /> Pause
                  </Button>
                )}
                {item.status === 'paused' && (
                  <Button variant="secondary" onClick={() => onResume(item.key)} className="py-1.5 text-xs">
                    <Play size={14} /> Reprendre
                  </Button>
                )}
                {(active || item.status === 'waiting' || item.status === 'preparing') && (
                  <Button variant="ghost" onClick={() => onCancel(item.key)} className="py-1.5 text-xs">
                    <XCircle size={14} /> Annuler
                  </Button>
                )}
                {item.status === 'failed' && onRetry && (
                  <Button variant="secondary" onClick={() => onRetry(item.key)} className="py-1.5 text-xs">
                    <RefreshCcw size={14} /> Reprendre
                  </Button>
                )}
                {item.status === 'completed' && (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 size={14} /> Intégrité SHA-256 vérifiée
                  </span>
                )}
                {item.status === 'cancelled' && (
                  <span className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Trash2 size={14} /> Transfert annulé
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
