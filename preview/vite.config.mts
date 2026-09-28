import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({
  root: path.resolve(import.meta.dirname),
  base: './', plugins: [react()],
  build: { outDir: '../preview-dist', emptyOutDir: true },
});
