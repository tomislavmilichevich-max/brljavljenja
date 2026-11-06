import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { serviceWorkerPlugin } from './vite-plugins/service-worker.ts';

// Hosting je na korijenu domene (Firebase Hosting), pa je base '/'.
export default defineConfig({
  plugins: [react(), serviceWorkerPlugin()],
  build: { sourcemap: false },
});
