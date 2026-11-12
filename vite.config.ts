import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    host: '0.0.0.0',
    // En développement, définissez VITE_API_PROXY_TARGET avec l'adresse réelle du serveur.
    // Aucun port n'est imposé par le code de l'application.
    ...(process.env.VITE_API_PROXY_TARGET
      ? { proxy: { '/api': process.env.VITE_API_PROXY_TARGET } }
      : {}),
  },
});
