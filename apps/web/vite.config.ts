import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  /**
   * Prefer package.json "browser" / "import" conditions so ysk-server-shared
   * resolves to dist/browser.js (no node:fs / async_hooks).
   */
  resolve: {
    conditions: ['browser', 'import', 'module', 'default'],
  },
  // @novnc/novnc 1.7 uses top-level await — need modern target
  // Vite 8 uses Oxc/Rolldown; `build.target` is enough (do not set `esbuild`).
  build: {
    target: 'es2022',
    // Self-hosted webtorrent.min.js lands under assets/ (no CDN)
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    // Re-bundle workspace shared when its dist changes
    exclude: [],
  },
  server: {
    // 4-digit; avoid common Vite 5173 / other tools
    port: 9173,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:9287',
      '/health': 'http://127.0.0.1:9287',
    },
    fs: {
      // allow reading monorepo packages
      allow: ['..', '../..'],
    },
  },
});
