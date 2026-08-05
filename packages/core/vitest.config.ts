import { defineConfig } from 'vitest/config';

/** COVERAGE_FLOOR: package locked at ≥90% lines (override with COVERAGE_FLOOR=0 for baseline). */
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
        // barrels / pure types (no runtime statements — listed in coverage-exceptions)
        'src/**/index.ts',
        'src/**/types.ts',
        'src/net/network-types.ts',
        'src/test/**',
      ],
      thresholds:
        floor > 0
          ? {
              lines: floor,
              functions: floor,
              statements: floor,
              // Branch floor capped below line floor (v8 branch density ~79–80%).
              // Lines/statements/functions lock at COVERAGE_FLOOR (90). P0 Cov = lines ≥90.
              branches: Math.min(floor, 79),
            }
          : undefined,
    },
  },
});
