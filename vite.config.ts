import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const page = (file: string) => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
  // Relative asset paths, so the static build works from any host or subpath.
  base: './',
  plugins: [react()],
  build: {
    // Two pages: the explorer, and /validation. Plain HTML entries need no
    // router, so either works from any static host.
    rollupOptions: {
      input: { explorer: page('index.html'), validation: page('validation.html') },
    },
  },
});
