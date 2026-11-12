import { useEffect, useState } from 'react';
import { ArrowLeftRight, FolderOpen, History, Home, Settings, Smartphone } from 'lucide-react';
import { AppShell, type NavItem } from '@/components/AppShell';
import { useTheme } from '@/hooks/useTheme';
import { apiRequest, deviceSession } from '@/services/api';
import PhonePairingPage from './PhonePairingPage';
import PhoneUnpairedPage from './PhoneUnpairedPage';
import PhoneHomePage from './PhoneHomePage';
import PhoneTransferPage from './PhoneTransferPage';
import PhoneFilesPage from './PhoneFilesPage';
import PhoneDevicePage from './PhoneDevicePage';
import PhoneHistoryPage from './PhoneHistoryPage';
import PhoneSettingsPage from './PhoneSettingsPage';

type PhonePage = 'home' | 'transfer' | 'files' | 'device' | 'history' | 'settings';

const NAV: NavItem<PhonePage>[] = [
  { id: 'home', label: 'Accueil', icon: Home },
  { id: 'transfer', label: 'Transfert', icon: ArrowLeftRight },
  { id: 'files', label: 'Fichiers', icon: FolderOpen },
  { id: 'device', label: 'Appareils', icon: Smartphone },
  { id: 'history', label: 'Historique', icon: History },
  { id: 'settings', label: 'Paramètres', icon: Settings },
];

type Session = { status: 'checking' } | { status: 'paired'; token: string; computerName: string } | { status: 'unpaired' };

export default function PhoneApp() {
  const { theme, toggleTheme } = useTheme();
  const [page, setPage] = useState<PhonePage>('home');
  const [session, setSession] = useState<Session>({ status: 'checking' });
  const [pairToken] = useState(() => new URLSearchParams(window.location.search).get('pair'));

  useEffect(() => {
    const token = deviceSession.getToken();
    if (!token) {
      setSession({ status: 'unpaired' });
      return;
    }
    apiRequest<{ computerName: string }>('/api/device/ping', { token })
      .then((data) => setSession({ status: 'paired', token, computerName: data.computerName }))
      .catch((error: { status?: number }) => {
        if (error.status === 401) deviceSession.clear();
        setSession({ status: 'unpaired' });
      });
  }, []);

  const disconnect = () => {
    deviceSession.clear();
    setSession({ status: 'unpaired' });
  };

  if (pairToken) {
    return (
      <PhonePairingPage
        pairToken={pairToken}
        onPaired={(token, computerName) => {
          window.history.replaceState(null, '', '/');
          setSession({ status: 'paired', token, computerName });
        }}
      />
    );
  }

  if (session.status === 'checking') {
    return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Vérification de la connexion...</div>;
  }

  if (session.status === 'unpaired') {
    return <PhoneUnpairedPage />;
  }

  return (
    <AppShell
      brandName="TRANSFERT"
      brandIcon={Smartphone}
      items={NAV}
      active={page}
      onSelect={setPage}
      theme={theme}
      onToggleTheme={toggleTheme}
    >
      {page === 'home' && <PhoneHomePage token={session.token} computerName={session.computerName} onNavigate={setPage} />}
      {page === 'transfer' && <PhoneTransferPage token={session.token} />}
      {page === 'files' && <PhoneFilesPage token={session.token} />}
      {page === 'device' && <PhoneDevicePage token={session.token} computerName={session.computerName} onDisconnect={disconnect} />}
      {page === 'history' && <PhoneHistoryPage token={session.token} />}
      {page === 'settings' && <PhoneSettingsPage computerName={session.computerName} theme={theme} onToggleTheme={toggleTheme} />}
    </AppShell>
  );
}
