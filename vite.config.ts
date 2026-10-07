import { defineConfig } from 'vite';

export default defineConfig({
  root: 'demo',
  publicDir: false,
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: { host: '127.0.0.1', port: 5173 },
});
