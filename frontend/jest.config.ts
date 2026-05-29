import type { Config } from 'jest';

export default {
  preset: 'jest-preset-angular',
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|js|html|svg)$': [
      'jest-preset-angular',
      { tsconfig: '<rootDir>/tsconfig.spec.json' },
    ],
  },
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/../packages/shared-types/src/$1',
    // Prevents Jest from trying to execute external Angular template/style files as JS modules.
    // jest-preset-angular inlines templateUrl at compile time; this mock handles any runtime require fallback.
    '\\.html$': '<rootDir>/html-template-mock.js',
  },
} satisfies Config;
