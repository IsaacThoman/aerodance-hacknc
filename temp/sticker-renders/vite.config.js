import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('./client', import.meta.url)),
  publicDir: false,
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'] },
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: { port: 5181, strictPort: true },
});
