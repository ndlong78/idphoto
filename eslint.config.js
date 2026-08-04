import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // Errors
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',

      // Warnings — style
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-var': 'warn',
      'prefer-const': 'warn',
    },
  },
  {
    // Unit, E2E and local test-server files can use Node globals freely.
    files: ['tests/**/*.js', 'e2e/**/*.js', 'scripts/**/*.mjs', 'playwright.config.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
