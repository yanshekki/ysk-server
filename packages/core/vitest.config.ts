import { defineConfig } from 'vitest/config';

/** COVERAGE_FLOOR: set 0 during baseline; raise to 90 when package is locked. */
const floor = Number(process.env.COVERAGE_FLOOR ?? '0');

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        'src/**/types.ts',
        'src/test/**',
      ],
      thresholds:
        floor > 0
          ? {
              lines: floor,
              functions: floor,
              statements: floor,
              branches: Math.min(floor, 75),
            }
          : undefined,
    },
  },
});
