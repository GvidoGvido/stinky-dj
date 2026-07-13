import path from 'node:path';
import { defineConfig } from 'vite';

/** Plain Vite dev server for local browser testing (no Reddit / no deploy). */
export default defineConfig({
  root: path.resolve(__dirname, 'src/client'),
  server: {
    port: 5174,
    strictPort: true,
    open: '/game.html',
    proxy: {
      '/api': 'http://localhost:8788',
    },
  },
  resolve: {
    alias: {
      '@devvit/web/client': path.resolve(__dirname, 'tools/devvit-client-stub.ts'),
    },
  },
});
