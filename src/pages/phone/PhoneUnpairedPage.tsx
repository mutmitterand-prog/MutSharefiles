import { useRef, useState, type ChangeEvent } from 'react';
import { Camera, Wifi } from 'lucide-react';
import { Button, Card, ErrorBanner } from '@/components/ui';
import { parsePairingUrl, readPairingUrlFromImage } from '@/services/qrScan';

export default function PhoneUnpairedPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setScanning(true);
    setError(null);
    try {
      const raw = await readPairingUrlFromImage(file);
      window.location.assign(parsePairingUrl(raw).toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lecture du QR code impossible.');
      setScanning(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-5 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="rounded-2xl bg-teal-600 p-3 text-white">
            <Wifi size={28} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Téléphone non connecté</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Affichez le QR code sur votre ordinateur, puis scannez-le pour vous connecter.
          </p>
        </div>

        <Card>
          <div className="flex flex-col gap-4">
            <Button
              className="w-full py-3"
              disabled={scanning}
              onClick={() => inputRef.current?.click()}
            >
              <Camera size={18} /> {scanning ? 'Lecture du QR code...' : 'Scanner le QR code'}
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFile}
            />
            <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-500 dark:text-slate-400">
              <li>Touchez « Scanner le QR code » puis prenez le QR code en photo.</li>
              <li>Ou utilisez directement l'appareil photo du téléphone : le lien s'ouvre tout seul.</li>
            </ol>
            <ErrorBanner message={error} />
          </div>
        </Card>
      </div>
    </div>
  );
}
