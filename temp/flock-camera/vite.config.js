import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./client', import.meta.url)),
  server: { host: '127.0.0.1', port: 5176, strictPort: true },
  build: { outDir: '../dist', emptyOutDir: true },
});
