#!/usr/bin/env node
// Upotreba: node scripts/prod-guard-cli.mjs <env|dist|rules>
// Ne objavljuje ništa. Samo provjerava i ispisuje što bi bilo objavljeno.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { loadEnv } from 'vite';
import { EXPECTED, checkDist, checkEnv, checkRules, manifestOf, rulesHash } from './prod-guard.mjs';

const mode = process.argv[2];
const fail = (problems) => {
  console.error('\nZAUSTAVLJENO — problemi:');
  for (const p of problems) console.error(' - ' + p);
  process.exit(1);
};

function readDist(dir = 'dist') {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const full = join(d, n);
      if (statSync(full).isDirectory()) walk(full);
      else
        out.push({ path: relative(dir, full).split(sep).join('/'), content: readFileSync(full) });
    }
  };
  walk(dir);
  return out;
}

if (mode === 'env') {
  const env = loadEnv('production', process.cwd(), 'VITE_');
  const problems = checkEnv(env);
  if (problems.length) fail(problems);
  console.log(
    `OK: konfiguracija za ${EXPECTED.projectId} (authDomain ${EXPECTED.authDomain}, household ${EXPECTED.householdId}), bez emulatora.`,
  );
} else if (mode === 'dist') {
  const files = readDist();
  const problems = checkDist(files);
  console.log(`Hosting će objaviti ISKLJUČIVO sadržaj mape dist (${files.length} datoteka):`);
  for (const m of manifestOf(files))
    console.log(`  ${m.sha256}  ${String(m.bytes).padStart(8)} B  ${m.path}`);
  if (problems.length) fail(problems);
  console.log('OK: dist prolazi provjere (nema emulatora, placeholdera ni nedopuštenih datoteka).');
} else if (mode === 'rules') {
  const text = readFileSync('firestore.rules', 'utf8');
  const problems = checkRules(text);
  if (problems.length) fail(problems);
  console.log(
    `OK: firestore.rules (sha256 ${rulesHash(text)}) bez "if true", svaki allow traži aktivnog člana, samo poznate putanje.`,
  );
} else {
  console.error('Upotreba: prod-guard-cli.mjs <env|dist|rules>');
  process.exit(2);
}
