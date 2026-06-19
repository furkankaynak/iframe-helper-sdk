import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'coverage/**',
      'dist/**',
      'node_modules/**',
      'documentation/.docusaurus/**',
      'documentation/build/**',
      'documentation/node_modules/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  eslintConfigPrettier,
);
