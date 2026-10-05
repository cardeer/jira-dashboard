import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Static (GitHub Pages) build: relative asset paths so it works under /<repo>/.
  base: process.env.VITE_STATIC ? './' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
});
