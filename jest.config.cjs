/** @type {import('ts-jest').JestConfigWithTsJest} */

module.exports = {
  // [...]
  preset: 'ts-jest/presets/default-esm', // or other ESM presets
  testEnvironment: 'node',
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.[tj]sx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          module: 'esnext',
          target: 'es2022'
        }
      },
    ],
  },
  transformIgnorePatterns: [`./node_modules/(?!'ora')`],
}
