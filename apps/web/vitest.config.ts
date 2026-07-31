import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** COVERAGE_FLOOR: locked at 85% while climbing to 90% (currently ~85.9% lines). */
const floor = Number(process.env.COVERAGE_FLOOR ?? '85');

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
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
              // Lines/statements locked; functions lag (many event handlers only hit via deep RTL).
              lines: floor,
              statements: floor,
              functions: Math.min(floor, 60),
              branches: Math.min(floor, 75),
            }
          : undefined,
    },
  },
});
