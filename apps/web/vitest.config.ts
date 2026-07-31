import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** COVERAGE_FLOOR: 0 until web package is locked at 90%. */
const floor = Number(process.env.COVERAGE_FLOOR ?? '0');

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
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
              lines: floor,
              functions: floor,
              statements: floor,
              branches: Math.min(floor, 75),
            }
          : undefined,
    },
  },
});
