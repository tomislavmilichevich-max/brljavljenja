// A3: lokalni dry-run (bez mreže, bez Firebasea). Pokretanje: node scripts/import/dry-run.ts --plan P.json [--decisions D.json]
//   [--snapshot S.json] [--out izvjestaj.md] [--json izvjestaj.json] [--names]
// Ulazi/izlazi MORAJU biti izvan repozitorija (stvarni podaci nikad u Git). Ovaj alat NE ima apply.
import { readFileSync, realpathSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from '../../src/import/manifest.ts';
import { reconcile } from '../../src/import/reconcile.ts';
import { buildReport, renderMarkdown } from '../../src/import/report.ts';

const REPO = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const args = process.argv.slice(2);
const opt = (n: string): string | undefined => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const die = (m: string): never => {
  console.error('ZAUSTAVLJENO: ' + m);
  process.exit(1);
};
function outside(p: string, mustExist: boolean): string {
  const abs = resolve(p);
  const real = mustExist
    ? realpathSync(abs)
    : resolve(realpathSync(dirname(abs)), abs.slice(abs.lastIndexOf('/') + 1));
  if (real === REPO || real.startsWith(REPO + '/'))
    die(`putanja je unutar repozitorija (nije dopušteno): ${p}`);
  return real;
}
const planP = opt('plan');
if (!planP) die('nedostaje --plan');
if (!existsSync(planP!)) die('plan ne postoji');
const read = (p: string) => JSON.parse(readFileSync(outside(p, true), 'utf8'));
const plan = read(planP!);
const decisions = opt('decisions') ? read(opt('decisions')!) : null;
const snapshot = opt('snapshot') ? read(opt('snapshot')!) : null;
const names = args.includes('--names');
if (names && !opt('out') && !opt('json'))
  die('--names zahtijeva --out/--json izvan repozitorija (imena se ne ispisuju u konzolu)');

const manifest = await reconcile(buildManifest(plan, decisions), snapshot);
const report = await buildReport(manifest, { includeNames: names });
if (opt('json'))
  writeFileSync(outside(opt('json')!, false), JSON.stringify(report, null, 2), { mode: 0o600 });
const md = renderMarkdown(report);
if (opt('out')) writeFileSync(outside(opt('out')!, false), md, { mode: 0o600 });
else console.log(md); // konzola: samo brojke (bez naziva)
process.exitCode = report.readiness.ready ? 0 : 2; // 2 = NOT READY FOR APPLY (izvještaj je i dalje valjan)
