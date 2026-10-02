import { defineConfig } from 'vitest/config';

// Runs only the exporter, which writes the TypeScript core's outputs for
// reference.py to check. Kept apart from the unit tests in tests/.
export default defineConfig({
  test: {
    include: ['validation/**/*.test.ts'],
  },
});
