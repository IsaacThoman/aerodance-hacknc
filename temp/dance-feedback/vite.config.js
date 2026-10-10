import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('./client', import.meta.url)),
  plugins: [react()],
  // The dancers come from temp/frutiger-character; keep one copy of each runtime.
  resolve: { dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'] },
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5176,
    strictPort: true,
    // Allow the repository root so shared code and node_modules resolve.
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
});
