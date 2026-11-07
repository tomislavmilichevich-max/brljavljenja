import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'public/sw.js', 'scripts/*.cjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // P2-B: izmjene ISKLJUČIVO online kroz transakcije u repozitoriju. Ove funkcije stavljaju upis u skriveni
    // lokalni red kad nema veze (izmjereno u sdk-tests/offline), a keš smije biti samo memorijski.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/inventory/repository.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'firebase/firestore',
              importNames: [
                'setDoc',
                'updateDoc',
                'addDoc',
                'deleteDoc',
                'writeBatch',
                'persistentLocalCache',
                'persistentSingleTabManager',
                'persistentMultipleTabManager',
                'enableIndexedDbPersistence',
                'enableMultiTabIndexedDbPersistence',
                'enableNetwork',
                'disableNetwork',
              ],
              message:
                'Zabranjeno izvan src/inventory/repository.ts (P2-B): upisi samo kroz runTransaction (bez skrivenog offline reda), keš samo memorijski.',
            },
          ],
        },
      ],
    },
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
