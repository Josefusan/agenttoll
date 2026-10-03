import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Each file boots its own workerd + mock servers; run files one at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 600_000,
  },
});
