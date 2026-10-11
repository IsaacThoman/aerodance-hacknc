import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: fileURLToPath(new URL("./client", import.meta.url)),
  plugins: [react()],
  // The retargeter lives in packages/character; keep one copy of each runtime.
  resolve: { dedupe: ["react", "react-dom", "three", "@react-three/fiber"] },
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    port: 5174,
    strictPort: true,
    // Allow the repository root so fonts resolve from the root node_modules.
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
    proxy: {
      "/socket.io": { target: "http://localhost:3000", ws: true },
    },
  },
});
