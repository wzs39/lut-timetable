import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['e2e/**/*.e2e.test.ts', 'e2e/**/*.e2e.test.tsx'],
  },
})
