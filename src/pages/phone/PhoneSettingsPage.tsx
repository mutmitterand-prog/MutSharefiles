import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { getChunkPreferenceMb, setChunkPreferenceMb } from '@/services/transferSettings';
import { Button, Card, PageHeader } from '@/components/ui';

interface Props {
  computerName: string;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

const IS_ANDROID_APP = /; wv\)/.test(navigator.userAgent);

export default function PhoneSettingsPage({ computerName, theme, onToggleTheme }: Props) {
  const [chunkMb, setChunkMb] = useState<string>(() => String(getChunkPreferenceMb() ?? 'auto'));
  return (
    <>
      <PageHeader title="Paramètres" subtitle="Affichage et informations de connexion." />
      <div className="space-y-5">
        <Card>
          <h2 className="mb-4 font-semibold">Affichage</h2>
          <Button variant="secondary" className="w-full" onClick={onToggleTheme}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            {theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
          </Button>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Taille des blocs d'envoi</h2>
          <p className="mb-3 text-xs text-slate-500">
            « Automatique » s'adapte à la vitesse du Wi-Fi. Choisissez une valeur fixe si le réseau est instable.
          </p>
          <select
            value={chunkMb}
            onChange={(event) => {
              setChunkMb(event.target.value);
              setChunkPreferenceMb(event.target.value === 'auto' ? null : Number(event.target.value));
            }}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="auto">Automatique (recommandé)</option>
            {[1, 2, 4, 8, 16].map((mb) => (
              <option key={mb} value={mb}>{mb} Mo</option>
            ))}
          </select>
        </Card>
        {IS_ANDROID_APP && (
          <Card>
            <h2 className="mb-2 font-semibold">Changer d'ordinateur</h2>
            <p className="mb-3 text-xs text-slate-500">Retourne à l'écran de l'application pour scanner un autre QR code.</p>
            <Button variant="secondary" className="w-full" onClick={() => { window.location.href = 'https://localhost/'; }}>
              Choisir un autre PC
            </Button>
          </Card>
        )}
        <Card>
          <h2 className="mb-2 font-semibold">Ordinateur</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">{computerName}</p>
          <p className="mt-3 text-xs text-slate-500">
            Les transferts passent uniquement par votre réseau Wi-Fi local. Aucun fichier n'est envoyé sur Internet.
          </p>
        </Card>
      </div>
    </>
  );
}
