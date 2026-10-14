import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run serve` in the repo root provides a demo /api/lookup endpoint on :4173.
const proxy = { '/api': 'http://localhost:4173' };

export default defineConfig({
  plugins: [react()],
  // Only needed because this example links the package via `file:../..`.
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { proxy },
  preview: { proxy },
  // barcode-detector loads its wasm itself; don't let Vite pre-bundle it.
  optimizeDeps: { exclude: ['barcode-detector'] },
});
