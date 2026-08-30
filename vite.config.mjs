import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 8080,
    strictPort: true
  },
  preview: {
    host: '0.0.0.0',
    port: 8080,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(projectRoot, 'index.html'),
        demo: resolve(projectRoot, 'demo.html')
      },
      output: {
        manualChunks: {
          phaser: ['phaser']
        }
      }
    }
  }
});
