// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * ESLint flat config. Non-type-checked rule set on purpose: it's fast, runs the
 * same in CI as locally, and doesn't flood on intentional test doubles. Prettier
 * runs through eslint so a single `npm run lint` gates both style and quality.
 */
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', 'prisma/migrations'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      // Underscore-prefixed identifiers are intentionally unused.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // We use `as never`/`as unknown as X` deliberately in tests for mocks.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
