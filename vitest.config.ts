import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'scripts/**/*.test.mjs'],
          exclude: ['**/*.int.test.ts'],
        },
      },
      {
        // Real PostgreSQL (tests/support/postgres.mjs): BAR_TEST_DATABASE_URL or embedded binaries.
        extends: true,
        test: {
          name: 'integration',
          include: ['apps/*/src/**/*.int.test.ts'],
          globalSetup: ['tests/support/vitest-postgres.mjs'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
