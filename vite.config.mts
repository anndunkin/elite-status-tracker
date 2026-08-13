import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['better-sqlite3', 'electron'],
    },
  },
  optimizeDeps: {
    exclude: ['better-sqlite3'],
  },
  test: {
    globals: true,
    dir: './tests',
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    alias: [
      { find: 'electron', replacement: path.resolve(import.meta.dirname, 'tests/__mocks__/electron.ts') },
    ],
  },
})
