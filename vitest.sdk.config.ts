import { defineConfig } from 'vitest/config';

// Testovi nad PRAVIM Firebase SDK-om i produkcijskim modulima (src/inventory, src/firebase/dataSession) protiv
// Auth + Firestore emulatora (`npm run test:sdk`). Datoteke se izvode redom: dijele jedan emulator i projekt.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['sdk-tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
