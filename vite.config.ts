import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: 'demo',
  // Relative asset URLs, so the built demo works from any path (GitHub Pages serves it under /scope-and-drop/demo/).
  base: './',
  publicDir: false,
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    // Every page under demo/ ships: the mansion viewer at /demo/, the scope lab at /demo/reticle/ and the party lab at /demo/party/.
    rollupOptions: { input: { main: page('demo/index.html'), reticle: page('demo/reticle/index.html'), party: page('demo/party/index.html') } },
  },
  server: { host: '127.0.0.1', port: 5173 },
});
