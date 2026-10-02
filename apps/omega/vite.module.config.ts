import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Builds the Video workspace as a standalone, self-contained package that the
// hub downloads and installs separately (see scripts/package-modules.mjs).
export default defineConfig({
  root: path.resolve(__dirname, 'src/modules/video'),
  plugins: [react()],
  base: './',
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, 'dist-modules/video'),
    emptyOutDir: true,
    target: 'chrome140',
  },
});
