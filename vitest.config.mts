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
    // Files run one at a time. Two of them start a real OpenCode server on the
    // same port, and one of them puts a fake `opencode` on PATH; parallel files
    // made both of those depend on which test happened to run first.
    fileParallelism: false,
    globals: false
  }
})
