import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths, so the static build works from any host or subpath.
  base: './',
  plugins: [react()],
});
