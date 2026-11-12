import { ArrowRight, Cpu, HardDrive, RefreshCw, Smartphone, Wifi } from 'lucide-react';
import { Badge, Button, Card, ErrorBanner, PageHeader, ProgressBar } from '@/components/ui';
import { apiRequest, formatBytes, formatDate } from '@/services/api';
import { usePolling } from '@/hooks/usePolling';
import type { HistoryEntry, Overview } from '@/types';

interface Props {
  onNavigate: (page: 'history') => void;
}

export default function PcHomePage({ onNavigate }: Props) {
  const overview = usePolling(() => apiRequest<Overview>('/api/local/overview'), 5000);
  const history = usePolling(
    () => apiRequest<{ items: HistoryEntry[] }>('/api/local/history'),
    5000,
  );

  const renew = async () => {
    await apiRequest('/api/local/pairing/renew', { method: 'POST' });
    overview.refresh();
  };

  const data = overview.data;
  if (!data) {
    if (!overview.error) {
      return <p className="text-sm text-slate-500">Chargement...</p>;
    }
    return (
      <div className="space-y-4">
        <PageHeader title="Accueil" />
        <ErrorBanner message={overview.error.message} />
        <Button variant="secondary" onClick={overview.refresh}>
          <RefreshCw size={16} /> Réessayer
        </Button>
      </div>
    );
  }

  const primaryIp = data.pairing?.ip ?? data.ips[0] ?? 'Aucune adresse détectée';

  return (
    <>
      <PageHeader title="Accueil" subtitle={`Bienvenue sur ${data.computerName}`} />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
            <div className="space-y-5">
              <div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Connexion du téléphone</p>
                <h2 className="mt-1 text-lg font-semibold">Scannez ce QR code avec l'appareil photo</h2>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Le téléphone doit être sur le même Wi-Fi. Le code expire après 5 minutes.
                </p>
              </div>
              <dl className="flex flex-wrap gap-x-8 gap-y-4 text-sm">
                <div className="min-w-0">
                  <dt className="text-slate-500 dark:text-slate-400">Adresse IP locale</dt>
                  <dd className="mt-1 break-all font-mono font-medium">{primaryIp}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-slate-500 dark:text-slate-400">Port du serveur</dt>
                  <dd className="mt-1 font-mono font-medium">{data.port}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-slate-500 dark:text-slate-400">Serveur</dt>
                  <dd className="mt-1"><Badge tone="success">En marche</Badge></dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-slate-500 dark:text-slate-400">Appareils associés</dt>
                  <dd className="mt-1 font-medium">{data.devicesCount}</dd>
                </div>
              </dl>
              <Button variant="secondary" onClick={renew}>
                <RefreshCw size={16} /> Renouveler le QR code
              </Button>
            </div>
            <div className="mx-auto flex w-56 flex-col items-center gap-3">
              {data.pairing ? (
                <img
                  src={data.pairing.qrDataUrl}
                  alt="QR code de connexion"
                  className="h-56 w-56 rounded-xl bg-white p-2 shadow-inner"
                />
              ) : (
                <div className="flex h-56 w-56 items-center justify-center rounded-xl border border-dashed border-slate-300 text-center text-sm text-slate-500 dark:border-slate-700">
                  QR code expiré. Cliquez sur « Renouveler ».
                </div>
              )}
              {data.pairing && (
                <p className="text-xs text-slate-500">Valide jusqu'à {formatDate(data.pairing.expiresAt)}</p>
              )}
            </div>
          </div>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-teal-50 p-2.5 text-teal-600 dark:bg-teal-500/10 dark:text-teal-300">
                <Cpu size={20} />
              </div>
              <div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Ordinateur</p>
                <p className="font-semibold">{data.computerName}</p>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
              <Wifi size={16} /> {data.ips.length} adresse(s) réseau
            </div>
            <div className="mt-2 flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
              <Smartphone size={16} /> {data.devicesCount} appareil(s) connecté(s)
            </div>
          </Card>

          <Card>
            <p className="mb-3 flex items-center gap-2 text-sm font-medium"><HardDrive size={16} /> Espace disque</p>
            <div className="space-y-4">
              {data.disks.map((disk) => {
                const used = disk.total && disk.free !== null ? ((disk.total - disk.free) / disk.total) * 100 : 0;
                return (
                  <div key={disk.id}>
                    <div className="mb-1.5 flex justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span className="truncate pr-2">{disk.label}</span>
                      <span>{formatBytes(disk.free)} libres</span>
                    </div>
                    <ProgressBar value={used} />
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>

      <Card className="mt-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Derniers transferts</h2>
          <button type="button" onClick={() => onNavigate('history')} className="flex items-center gap-1 text-sm text-teal-600 hover:underline dark:text-teal-400">
            Voir l'historique <ArrowRight size={14} />
          </button>
        </div>
        {history.data && history.data.items.length > 0 ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {history.data.items.slice(0, 5).map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <span className="truncate font-medium">{entry.fileName}</span>
                <span className="shrink-0 text-slate-500">{formatBytes(entry.size)} · {formatDate(entry.endedAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">Aucun transfert pour le moment.</p>
        )}
      </Card>
    </>
  );
}
