import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'public/sw.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    files: [
      'vite.config.ts',
      'vitest.config.ts',
      'vite-plugins/**/*.ts',
      'scripts/**/*.{mjs,ts}',
      'eslint.config.js',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // Service worker izvor (predložak) radi u ServiceWorkerGlobalScope.
    files: ['src/pwa/sw.template.js'],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        __PRECACHE_URLS__: 'readonly',
        __BUILD_ID__: 'readonly',
      },
    },
  },
);
