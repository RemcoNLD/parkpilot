import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Lokaal: `npm run dev:worker` (poort 8787) en `npm run dev:web` naast elkaar.
    proxy: { '/api': 'http://localhost:8787' },
    fs: { allow: ['../..'] },
  },
  build: { target: 'es2022' },
});
