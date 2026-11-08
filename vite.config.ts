/// <reference types="vitest" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Absolute file-system path. A root-relative '/src/...' string works for Rollup but NOT for
// esbuild dependency pre-bundling in dev, which resolves it against the drive root (E:\src\...).
const html2canvasStub = fileURLToPath(new URL('./src/print/stubs/html2canvas.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // jsPDF only needs html2canvas for doc.html(), which this app never uses
      { find: /^html2canvas$/, replacement: html2canvasStub },
    ],
  },
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 60000 },
});
