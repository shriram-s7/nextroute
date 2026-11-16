import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  base: './',
  worker: { format: 'es' },
  // MapLibre v6 locates its worker relative to its own module file; pre-bundling breaks that in dev.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: { port: 5173, strictPort: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
