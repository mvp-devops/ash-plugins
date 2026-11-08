// @ts-check
import tseslint from 'typescript-eslint';

/**
 * ESLint flat config for the SDD workflow plugin.
 * Strict TypeScript rules; the generated Client module (client.js) is
 * linted with relaxed rules because it must stay plain browser JS in the
 * DSH module-loader format.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.js'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['client.js'],
    extends: [...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
);
