import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
  coverageDirectory: './coverage',
  coverageReporters: ['text', 'json-summary'],
  coverageThreshold: {
    global: {},
    './src/modules/auth/auth.service.ts': { branches: 70 },
    './src/modules/cart/cart.service.ts': { branches: 70 },
    './src/modules/orders/orders.service.ts': { branches: 70 },
    './src/modules/payments/payments.service.ts': { branches: 70 },
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/../packages/shared-types/src/$1',
    '^uuid$': '<rootDir>/src/__mocks__/uuid.js',
  },
};

export default config;
