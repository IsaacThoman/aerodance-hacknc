import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('./client', import.meta.url)),
  plugins: [react()],
  // The stages and dancers come from temp/frutiger-character; keep one copy of each runtime.
  resolve: { dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'] },
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5178,
    strictPort: true,
    // Allow the repository root so the shared stages, fonts and node_modules resolve.
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
});
