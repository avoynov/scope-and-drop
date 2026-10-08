import { defineConfig } from 'vite';

export default defineConfig({
  root: 'demo',
  // Relative asset URLs, so the built demo works from any path (GitHub Pages serves it under /scope-and-drop/demo/).
  base: './',
  publicDir: false,
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: { host: '127.0.0.1', port: 5173 },
});
