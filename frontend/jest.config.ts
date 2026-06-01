import type { Config } from 'jest';

export default {
  preset: 'jest-preset-angular',
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|js|html|svg)$': [
      'jest-preset-angular',
      { tsconfig: '<rootDir>/tsconfig.spec.json', stringifyContentPathRegex: '\\.html$' },
    ],
  },
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/../packages/shared-types/src/$1',
  },
} satisfies Config;
