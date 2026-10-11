import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('./client', import.meta.url)),
  plugins: [react()],
  // The stages, dancers and wordmark come from elsewhere in the repo; keep one copy of each runtime.
  resolve: { dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'] },
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: {
    port: 5179,
    strictPort: true,
    // Allow the repository root so the shared stages, fonts and node_modules resolve.
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
});
