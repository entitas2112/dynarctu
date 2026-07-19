import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    // In local dev, proxy /api/* to `vercel dev` (or your own dev server)
    // running on port 3000, so `npm run dev` (Vite on 5173) behaves like
    // production where the frontend and API share one origin.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
