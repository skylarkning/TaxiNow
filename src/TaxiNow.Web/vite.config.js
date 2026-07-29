import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8780",
      "/hubs": {
        target: "http://127.0.0.1:8780",
        ws: true
      }
    }
  }
});
