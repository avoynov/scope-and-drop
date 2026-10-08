import { defineConfig } from 'vite';

/** Bundles the published viewer (three.js + generator + renderer) into one ES module. */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist-artifact',
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    lib: { entry: 'artifact/app.ts', formats: ['es'], fileName: () => 'app.js' },
  },
});
