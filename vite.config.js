import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile();

const serverPort = process.env.PORT || 3000;

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${serverPort}`,
      '/socket.io': { target: `http://localhost:${serverPort}`, ws: true },
    },
  },
});
