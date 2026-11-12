import { useState } from 'react';
import { Smartphone, Unplug } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Modal, PageHeader } from '@/components/ui';
import { usePolling } from '@/hooks/usePolling';
import { apiRequest, formatDate } from '@/services/api';
import type { Device } from '@/types';

export default function PcDevicesPage() {
  const devices = usePolling(() => apiRequest<{ items: Device[] }>('/api/local/devices'), 5000);
  const [target, setTarget] = useState<Device | null>(null);
  const [error, setError] = useState<string | null>(null);

  const revoke = async () => {
    if (!target) return;
    try {
      await apiRequest(`/api/local/devices/${target.id}`, { method: 'DELETE' });
      setTarget(null);
      devices.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de révoquer cet appareil.');
    }
  };

  return (
    <>
      <PageHeader title="Appareils connectés" subtitle="Seuls les appareils que vous avez autorisés peuvent accéder au serveur." />
      {devices.data && devices.data.items.length > 0 ? (
        <Card className="p-0">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {devices.data.items.map((device) => (
              <li key={device.id} className="flex items-center gap-4 px-5 py-4">
                <div className="rounded-xl bg-teal-50 p-2.5 text-teal-600 dark:bg-teal-500/10 dark:text-teal-300">
                  <Smartphone size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{device.name}</p>
                  <p className="text-xs text-slate-500">
                    {device.ip} · associé le {formatDate(device.createdAt)} · vu le {formatDate(device.lastSeen)}
                  </p>
                </div>
                <Badge tone="success">Autorisé</Badge>
                <Button variant="ghost" onClick={() => setTarget(device)} className="px-2 py-2 text-rose-600 dark:text-rose-400">
                  <Unplug size={16} /> <span className="hidden sm:inline">Révoquer</span>
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <EmptyState icon={<Smartphone size={22} />} title="Aucun appareil associé" text="Scannez le QR code depuis la page Accueil pour connecter un téléphone." />
      )}

      {target && (
        <Modal title="Révoquer cet appareil ?" onClose={() => setTarget(null)}>
          <p className="mb-5 text-sm text-slate-600 dark:text-slate-300">
            « {target.name} » ne pourra plus envoyer ni recevoir de fichiers tant qu'il n'est pas associé de nouveau avec un QR code.
          </p>
          {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setTarget(null)}>Annuler</Button>
            <Button variant="danger" onClick={revoke}>Révoquer</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
