import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: fileURLToPath(new URL("./client", import.meta.url)),
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/socket.io": { target: "http://localhost:3000", ws: true },
    },
  },
});
