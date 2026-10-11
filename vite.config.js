import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { discoverSongs, songCatalogMiddleware } from './server/songCatalog.js';

if (existsSync('.env')) process.loadEnvFile();

const serverPort = process.env.PORT || 3000;

export default defineConfig({
  root: 'client',
  plugins: [react(), {
    name: 'song-discovery',
    configureServer(server) {
      server.middlewares.use('/songs/manifest.json', songCatalogMiddleware(fileURLToPath(new URL('./client/public/songs/', import.meta.url))));
    },
    async writeBundle(options) {
      const catalog = await discoverSongs(fileURLToPath(new URL('./client/public/songs/', import.meta.url)));
      await writeFile(`${options.dir}/songs/manifest.json`, JSON.stringify(catalog, null, 2) + '\n');
    },
  }],
  // The menu dancers import code from temp/frutiger-character; keep one copy of each runtime.
  resolve: { dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'] },
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
