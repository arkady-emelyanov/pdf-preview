import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') }
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environmentMatchGlobs: [
      ['tests/store.test.ts', 'happy-dom'],
      ['tests/**/*.test.tsx', 'happy-dom']
    ],
    testTimeout: 15000
  }
})
