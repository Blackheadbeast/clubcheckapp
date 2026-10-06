import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname) } },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Tests share one local database; each creates its own tenant.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
