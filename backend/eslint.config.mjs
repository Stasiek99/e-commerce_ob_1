// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettierConfig from 'eslint-config-prettier';

/**
 * ESLint 9 flat config for the NestJS backend.
 *
 * Deliberately non-type-checked (`tseslint.configs.recommended`, not
 * `recommendedTypeChecked`): the type-aware rules need a full program per lint
 * run, which on this codebase costs more than the whole test suite, and their
 * headline rules (no-unsafe-*) fire constantly on Prisma's generated types and on
 * `$queryRaw` result casts. Correctness here is already gated by `tsc --noEmit`
 * in CI; this config is for the things the compiler does not catch.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'prisma/migrations/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      sourceType: 'module',
      parserOptions: { ecmaVersion: 'latest' },
    },
    rules: {
      // NestJS DI resolves constructor parameter types from emitted metadata, and
      // decorators legitimately produce "unused" imports the base rule flags.
      '@typescript-eslint/no-extraneous-class': 'off',
      // Leading underscore is the codebase's existing convention for an argument
      // kept for signature compatibility (e.g. `_channel` in the Redis handler).
      // ignoreRestSiblings covers the field-omission idiom used to strip secrets
      // before serialization: `const { passwordHash, ...profile } = user`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
      // `import x = require('y')` is not a style choice here: connect-pg-simple
      // and friends are CJS modules with no default export, and this tsconfig
      // does not enable esModuleInterop. allowAsImport permits that form while
      // still rejecting bare `require()` calls in module scope.
      '@typescript-eslint/no-require-imports': ['error', { allowAsImport: true }],
      // `any` is load-bearing at the Prisma/AdminJS/Stripe boundaries where the
      // upstream types are either generated or wrong. Warn so it stays visible
      // without failing the build on pre-existing usage.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Empty catch blocks are an intentional pattern here: every Redis call is
      // wrapped in one so a cache outage degrades to a DB hit instead of a 500.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Tests reach into private members and stub half-shaped objects on purpose.
    files: ['**/__tests__/**/*.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // instrument.spec.ts re-`require()`s the module under test after
      // jest.resetModules() to observe its side effects on a fresh load — an
      // ESM import would be hoisted and defeat the point.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
