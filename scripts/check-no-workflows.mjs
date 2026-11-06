#!/usr/bin/env node
// Jamči projektno pravilo: nema GitHub Actions workflowa (0 EUR / limit minuta potrošen).
import { existsSync, readdirSync } from 'node:fs';

const dir = '.github/workflows';
if (existsSync(dir) && readdirSync(dir).length > 0) {
  console.error(`GREŠKA: ${dir} ne smije postojati u ovom projektu (vidi CLAUDE.md).`);
  process.exit(1);
}
console.log('OK: nema .github/workflows.');
