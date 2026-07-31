import { defineConfig } from 'vitest/config';

/**
 * Coverage thresholds: 90% lines/functions/statements.
 * Pure type-only DTO modules are excluded (no runtime statements) — listed in
 * docs/testing/coverage-exceptions.md.
 */
const floor = Number(process.env.COVERAGE_FLOOR ?? '90');

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // Pure type/interface modules (compile to empty / re-export only)
        'src/ai.ts',
        'src/cdn.ts',
        'src/databases.ts',
        'src/dto.ts',
        'src/email-domain.ts',
        'src/files.ts',
        'src/fleet.ts',
        'src/ftp.ts',
        'src/metrics.ts',
        'src/network.ts',
        'src/software.ts',
        'src/ssl.ts',
        'src/system.ts',
        'src/updates.ts',
        // Browser re-export barrel (covered via Node entry + browser import smoke)
        'src/browser.ts',
        'src/index.ts',
        'src/i18n/index.ts',
      ],
      thresholds: {
        lines: floor,
        functions: floor,
        statements: floor,
        branches: Math.min(floor, 75),
      },
    },
  },
});
