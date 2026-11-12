import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Loader2, Smartphone } from 'lucide-react';
import { Button, Card, ErrorBanner } from '@/components/ui';
import { apiRequest, deviceSession } from '@/services/api';
import type { DeviceInfo } from '@/types';

interface Props {
  pairToken: string;
  onPaired: (token: string, computerName: string) => void;
}

interface PairingStatus {
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  deviceToken?: string;
  device?: DeviceInfo;
}

const DEFAULT_NAME_KEY = 'transfert.deviceName';

export default function PhonePairingPage({ pairToken, onPaired }: Props) {
  const [computerName, setComputerName] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState(() => localStorage.getItem(DEFAULT_NAME_KEY) ?? 'Mon téléphone');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'waiting' | 'rejected' | 'expired' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    apiRequest<{ computerName: string }>('/api/info')
      .then((data) => setComputerName(data.computerName))
      .catch(() => setError('Impossible de joindre l\'ordinateur. Vérifiez que vous êtes sur le même Wi-Fi.'));
  }, []);

  useEffect(() => {
    if (!requestId) return;
    let active = true;
    const check = async () => {
      try {
        const status = await apiRequest<PairingStatus>(`/api/pairing/requests/${requestId}`);
        if (!active) return;
        if (status.status === 'accepted' && status.deviceToken && status.device) {
          deviceSession.save(status.deviceToken, status.device.name);
          localStorage.setItem(DEFAULT_NAME_KEY, status.device.name);
          onPaired(status.deviceToken, computerName ?? 'Ordinateur');
          return;
        }
        if (status.status === 'rejected') setState('rejected');
        else if (status.status === 'expired') setState('expired');
        else timer = window.setTimeout(check, 1500);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Connexion perdue.');
        setState('error');
      }
    };
    let timer = window.setTimeout(check, 1500);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [requestId, computerName, onPaired]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      const result = await apiRequest<{ id: string }>('/api/pairing/requests', {
        method: 'POST',
        body: { token: pairToken, deviceName: deviceName.trim() },
      });
      setRequestId(result.id);
      setState('waiting');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La demande a échoué.');
      setState('error');
    } finally {
      setSending(false);
    }
  };

  const inputClass =
    'w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-950';

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-5 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="rounded-2xl bg-teal-600 p-3 text-white">
            <Smartphone size={28} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Connexion au PC</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {computerName ? `Vous allez vous connecter à « ${computerName} ».` : 'Recherche de l\'ordinateur...'}
          </p>
        </div>

        <Card>
          {state === 'waiting' ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <Loader2 size={28} className="animate-spin text-teal-600 dark:text-teal-400" />
              <p className="font-medium">En attente de confirmation sur le PC</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">Acceptez la demande sur l'écran de l'ordinateur.</p>
            </div>
          ) : state === 'rejected' || state === 'expired' ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <p className="font-medium">{state === 'rejected' ? 'Demande refusée sur le PC.' : 'Le QR code a expiré.'}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">Renouvelez le QR code sur l'ordinateur puis scannez-le à nouveau.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <label className="block space-y-1.5 text-sm">
                <span className="text-slate-600 dark:text-slate-300">Nom de ce téléphone</span>
                <input className={inputClass} value={deviceName} maxLength={60} required onChange={(event) => setDeviceName(event.target.value)} />
              </label>
              <Button type="submit" className="w-full py-3" disabled={sending || !computerName}>
                {sending ? 'Envoi...' : 'Demander la connexion'}
              </Button>
            </form>
          )}
          <div className="mt-4">
            <ErrorBanner message={error} />
          </div>
        </Card>

        {state === 'waiting' && (
          <p className="flex items-center justify-center gap-2 text-xs text-slate-500">
            <CheckCircle2 size={14} /> Votre téléphone sera connecté dès l'acceptation.
          </p>
        )}
      </div>
    </div>
  );
}
