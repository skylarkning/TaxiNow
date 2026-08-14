import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

const mapLibreAssets = new Map([
  [
    "/assets/maplibre-gl-worker.mjs",
    new URL(
      "./node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
      import.meta.url
    )
  ],
  [
    "/assets/maplibre-gl-shared.mjs",
    new URL(
      "./node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs",
      import.meta.url
    )
  ]
]);

function mapLibreWorkerAssets() {
  return {
    name: "taxinow-maplibre-worker-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const asset = mapLibreAssets.get(request.url?.split("?")[0] ?? "");
        if (!asset) {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/javascript; charset=utf-8");
        response.end(readFileSync(asset));
      });
    },
    generateBundle() {
      for (const [path, source] of mapLibreAssets) {
        this.emitFile({
          type: "asset",
          fileName: path.slice(1),
          source: readFileSync(source)
        });
      }
    }
  };
}

export default defineConfig({
  base: "/",
  plugins: [mapLibreWorkerAssets()],
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
