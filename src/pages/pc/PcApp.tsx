import { useState } from 'react';
import { ArrowLeftRight, Cpu, FolderOpen, History, Home, Settings, Smartphone } from 'lucide-react';
import { AppShell, type NavItem } from '@/components/AppShell';
import { Button, Modal } from '@/components/ui';
import { usePolling } from '@/hooks/usePolling';
import { useTheme } from '@/hooks/useTheme';
import { apiRequest } from '@/services/api';
import type { PairingRequest } from '@/types';
import PcHomePage from './PcHomePage';
import PcTransferPage from './PcTransferPage';
import PcFilesPage from './PcFilesPage';
import PcDevicesPage from './PcDevicesPage';
import PcHistoryPage from './PcHistoryPage';
import PcSettingsPage from './PcSettingsPage';

type PcPage = 'home' | 'transfer' | 'files' | 'devices' | 'history' | 'settings';

const NAV: NavItem<PcPage>[] = [
  { id: 'home', label: 'Accueil', icon: Home },
  { id: 'transfer', label: 'Transfert', icon: ArrowLeftRight },
  { id: 'files', label: 'Fichiers', icon: FolderOpen },
  { id: 'devices', label: 'Appareils', icon: Smartphone },
  { id: 'history', label: 'Historique', icon: History },
  { id: 'settings', label: 'Paramètres', icon: Settings },
];

export default function PcApp() {
  const [page, setPage] = useState<PcPage>('home');
  const { theme, toggleTheme } = useTheme();
  const requests = usePolling(() => apiRequest<{ items: PairingRequest[] }>('/api/local/pairing/requests'), 2000);
  const [handled, setHandled] = useState<string[]>([]);
  const incoming = requests.data?.items.find((item) => !handled.includes(item.id));

  const decide = async (id: string, accept: boolean) => {
    setHandled((current) => [...current, id]);
    await apiRequest(`/api/local/pairing/requests/${id}/decision`, { method: 'POST', body: { accept } }).catch(() => undefined);
    requests.refresh();
  };

  return (
    <>
      <AppShell
        brandName="TRANSFERT"
        brandIcon={Cpu}
        items={NAV}
        active={page}
        onSelect={setPage}
        theme={theme}
        onToggleTheme={toggleTheme}
      >
        {page === 'home' && <PcHomePage onNavigate={() => setPage('history')} />}
        {page === 'transfer' && <PcTransferPage />}
        {page === 'files' && <PcFilesPage />}
        {page === 'devices' && <PcDevicesPage />}
        {page === 'history' && <PcHistoryPage />}
        {page === 'settings' && <PcSettingsPage theme={theme} onToggleTheme={toggleTheme} />}
      </AppShell>

      {incoming && (
        <Modal title="Demande de jumelage">
          <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">
            Le téléphone <span className="font-semibold text-slate-900 dark:text-white">« {incoming.deviceName} »</span> demande à se connecter à ce PC.
          </p>
          <p className="mb-5 font-mono text-xs text-slate-500">Adresse : {incoming.ip}</p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => decide(incoming.id, false)}>Refuser</Button>
            <Button onClick={() => decide(incoming.id, true)}>Autoriser</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
