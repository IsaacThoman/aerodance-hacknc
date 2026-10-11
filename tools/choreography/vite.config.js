import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { poseAssetsPlugin } from '../../scripts/poseAssets.mjs';
export default defineConfig({
  root: fileURLToPath(new URL("./web", import.meta.url)),
  plugins: [react(), poseAssetsPlugin()],
  resolve: { dedupe: ["react", "react-dom", "three", "@react-three/fiber"] },
  build: { outDir: "../dist", emptyOutDir: true },
  server: { port: 5177, proxy: { "/api": "http://localhost:8082" } },
});
