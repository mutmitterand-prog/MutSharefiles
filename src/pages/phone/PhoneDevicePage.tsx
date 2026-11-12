import { useState } from 'react';
import { Smartphone, Unplug } from 'lucide-react';
import { Button, Card, Modal, PageHeader } from '@/components/ui';
import { apiRequest, deviceSession } from '@/services/api';

interface Props {
  token: string;
  computerName: string;
  onDisconnect: () => void;
}

export default function PhoneDevicePage({ token, computerName, onDisconnect }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disconnect = async () => {
    setError(null);
    try {
      await apiRequest('/api/device/disconnect', { method: 'POST', token });
      deviceSession.clear();
      onDisconnect();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La déconnexion a échoué.');
    }
  };

  return (
    <>
      <PageHeader title="Appareils" subtitle="Ce téléphone et son lien avec l'ordinateur." />
      <div className="space-y-5">
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-teal-50 p-2.5 text-teal-600 dark:bg-teal-500/10 dark:text-teal-300">
              <Smartphone size={20} />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-slate-500 dark:text-slate-400">Cet appareil</p>
              <p className="truncate font-semibold">{deviceSession.getDeviceName() ?? 'Téléphone'}</p>
              <p className="truncate text-xs text-slate-500">Connecté à {computerName}</p>
            </div>
          </div>
        </Card>
        <Card>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            Après déconnexion, il faudra scanner à nouveau le QR code du PC pour reprendre les transferts.
          </p>
          {error && <p role="alert" className="mb-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          <Button variant="danger" className="w-full" onClick={() => setConfirming(true)}>
            <Unplug size={16} /> Se déconnecter du PC
          </Button>
        </Card>
      </div>

      {confirming && (
        <Modal title="Se déconnecter ?" onClose={() => setConfirming(false)}>
          <p className="mb-5 text-sm text-slate-600 dark:text-slate-300">Ce téléphone ne pourra plus accéder au PC jusqu'à un nouveau jumelage.</p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setConfirming(false)}>Annuler</Button>
            <Button variant="danger" onClick={disconnect}>Se déconnecter</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
