// @vitest-environment node
// CLI dry-run: izvršava se kao Node proces nad sintetičkim datotekama izvan repozitorija.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const plan = {
  metadata: { firebase_project: 'home-inventory-pwa-218be', household_id: 'kuca1' },
  locations: [
    { plan_location_id: 'l1', parent_plan_id: 'root', name: 'Soba', kind: 'room' },
    { plan_location_id: 'l2', parent_plan_id: 'l1', name: 'Ormar', kind: 'cabinet' },
  ],
  candidates: [
    {
      candidate_id: 'cand-0001',
      source_id: 's1',
      proposed_location_id: 'l2',
      proposed_item_name: 'Sintetika',
      review_status: 'CANDIDATE',
    },
  ],
};
const run = (args: string[]) =>
  spawnSync('node', ['scripts/import/dry-run.ts', ...args], { encoding: 'utf8' });

describe('dry-run CLI', () => {
  it('bez snapshota: izlaz 2, NOT READY, konzola bez naziva', () => {
    const d = mkdtempSync(join(tmpdir(), 'imp-'));
    writeFileSync(join(d, 'p.json'), JSON.stringify(plan));
    const r = run(['--plan', join(d, 'p.json')]);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('NOT READY FOR APPLY');
    expect(r.stdout).not.toContain('Sintetika');
  });
  it('--names piše naziv samo u izlaznu datoteku izvan repozitorija', () => {
    const d = mkdtempSync(join(tmpdir(), 'imp-'));
    writeFileSync(join(d, 'p.json'), JSON.stringify(plan));
    run(['--plan', join(d, 'p.json'), '--names', '--json', join(d, 'o.json')]);
    expect(readFileSync(join(d, 'o.json'), 'utf8')).toContain('Sintetika');
    expect(run(['--plan', join(d, 'p.json'), '--names']).status).toBe(1);
  });
  it('odbija ulaz i izlaz unutar repozitorija', () => {
    const d = mkdtempSync(join(tmpdir(), 'imp-'));
    writeFileSync(join(d, 'p.json'), JSON.stringify(plan));
    expect(run(['--plan', 'package.json']).status).toBe(1);
    expect(run(['--plan', join(d, 'p.json'), '--out', 'izvj.md']).status).toBe(1);
  });
  it('nema pristupa mreži ni Firebaseu (izvor ne uvozi firebase/fetch)', () => {
    const src = execFileSync(
      'cat',
      [
        'scripts/import/dry-run.ts',
        'src/import/manifest.ts',
        'src/import/reconcile.ts',
        'src/import/report.ts',
      ],
      { encoding: 'utf8' },
    );
    expect(src).not.toMatch(/from 'firebase|fetch\(|https?:\/\//);
  });
});
