import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/specs/security.properties.test.ts'],
    allowOnly: false,
    passWithNoTests: false,
    isolate: true,
    testTimeout: 15_000,
  },
})
