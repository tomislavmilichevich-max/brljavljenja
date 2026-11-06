import { defineConfig } from 'vitest/config';

// Testovi pravila rade u Node okruženju protiv Firestore emulatora
// (pokreće ih `npm run test:rules` preko `firebase emulators:exec`).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['rules-tests/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
