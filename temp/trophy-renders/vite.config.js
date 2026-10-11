import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('./client', import.meta.url)),
  // The dance capture the Dancer figurine holds its pose from (like temp/thumbnails).
  publicDir: fileURLToPath(new URL('../frutiger-character/client/public', import.meta.url)),
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'],
    // server/trophyArt.js seeds its traits with node:crypto's sha256; this is the same hash
    // in plain JS, so the 3D trophy gets exactly the NFT's traits.
    alias: { 'node:crypto': fileURLToPath(new URL('./client/src/sha256.js', import.meta.url)) },
  },
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: {
    port: 5180,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
});
