import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || "8765"}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api/events": { target: api.replace("http", "ws"), ws: true },
      "/api": { target: api, changeOrigin: false },
    },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 6000 },
});
