/** Initial, deliberately bounded mutation scope: identity grants' authorization boundary. */
export default {
  mutate: ['src/auth/identityScope.ts'],
  // Copy only inputs needed by this campaign, never .tasra credentials or evidence.
  ignorePatterns: ['**', '!src/**/*.ts', '!src/**/*.json', '!test/specs/security.properties.test.ts',
    '!vitest.security.config.ts', '!package.json', '!tsconfig.json'],
  testRunner: 'vitest',
  vitest: {configFile: 'vitest.security.config.ts'},
  coverageAnalysis: 'perTest',
  concurrency: 2,
  timeoutMS: 10_000,
  timeoutFactor: 2,
  reporters: ['clear-text', 'json', 'html'],
  jsonReporter: {fileName: '.verification/mutation/report.json'},
  htmlReporter: {fileName: '.verification/mutation/index.html'},
  // Initial observed score: 91.18%. Five equivalent/redundant survivors and one
  // unreachable defense remain visible. Timeouts count in Stryker's score but are
  // reported separately from assertion kills. Never lower the floor to hide a defect.
  thresholds: {high: 95, low: 90, break: 90},
  tempDirName: '.verification/mutation/tmp',
  cleanTempDir: true,
}
