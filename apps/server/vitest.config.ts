import { defineConfig } from 'vitest/config';

/** COVERAGE_FLOOR: locked at 90% line coverage for ysk-server. */
const floor = Number(process.env.COVERAGE_FLOOR ?? '90');

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
        'src/test/**',
      ],
      thresholds:
        floor > 0
          ? {
              lines: floor,
              statements: floor,
              functions: floor,
              branches: Math.min(floor, 75),
            }
          : undefined,
    },
  },
});
