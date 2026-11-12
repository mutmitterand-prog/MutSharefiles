import { deviceSession } from '@/services/api';
import PcApp from '@/pages/pc/PcApp';
import PhoneApp from '@/pages/phone/PhoneApp';

function isPhoneClient(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.has('pair') || deviceSession.getToken()) return true;
  return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
}

export default function App() {
  return isPhoneClient() ? <PhoneApp /> : <PcApp />;
}
