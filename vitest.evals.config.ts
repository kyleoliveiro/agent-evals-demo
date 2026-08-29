import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/evals/**/*.eval.ts'],
    testTimeout: 1_800_000,
    hookTimeout: 60_000,
  },
})
