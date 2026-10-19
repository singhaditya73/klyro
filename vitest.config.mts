import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(import.meta.dirname, 'src/shared') }
  },
  test: {
    environment: 'node',
    // DOM tests opt in per file with `@vitest-environment jsdom`.
    include: ['src/**/*.test.{ts,tsx}'],
    globals: false
  }
})
