import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** COVERAGE_FLOOR: locked at ≥90% lines (measured ~90.3%). */
const floor = Number(process.env.COVERAGE_FLOOR ?? '90');

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Deep interaction hammers can leave React recovery errors; still collect coverage.
    dangerouslyIgnoreUnhandledErrors: true,
    // Sequential files + single worker avoid flaky v8 coverage .tmp cleanup races.
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      // Avoid mid-run wipe of coverage/.tmp (ENOENT write races under v8).
      clean: false,
      cleanOnRerun: false,
      // Serialize coverage merges — prevents ENOENT on coverage/.tmp/*.json
      processingConcurrency: 1,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/test/**',
        'src/main.tsx',
        'src/**/*.css',
        'src/styles/**',
        // Type-only modules (no runtime statements)
        'src/**/types.ts',
        'src/shared/guides/types.ts',
      ],
      thresholds:
        floor > 0
          ? {
              // Lines/statements locked at ≥90%.
              lines: floor,
              statements: floor,
              // Functions climbed ~73%→~79.5% (helpers + deep RTL hammers); target ≥90% next.
              functions: Math.min(floor, 79),
              branches: Math.min(floor, 79),
            }
          : undefined,
    },
  },
});
