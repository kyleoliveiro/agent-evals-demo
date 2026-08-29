import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => ({
  test: {
    include: ['src/evals/**/*.eval.ts'],
    // Load .env into process.env for the eval process (Vite only exposes VITE_* by default).
    env: loadEnv(mode, process.cwd(), ''),
    testTimeout: 6 * 60 * 60_000, // per-run timeouts bound the real duration; see EVAL_RUN_TIMEOUT_MS
    hookTimeout: 60_000,
  },
}))
