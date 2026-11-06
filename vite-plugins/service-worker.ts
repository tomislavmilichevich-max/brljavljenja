import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

const TEMPLATE_PATH = 'src/pwa/sw.template.js';
const EXCLUDED = new Set(['sw.js']);

/** Čista funkcija (testirana): umetne popis URL-ova i ID builda u predložak. */
export function renderServiceWorker(template: string, urls: string[], buildId: string): string {
  for (const token of ['__PRECACHE_URLS__', '__BUILD_ID__']) {
    const count = template.split(token).length - 1;
    if (count !== 1) {
      throw new Error(
        `Predložak service workera mora sadržavati ${token} točno jednom (nađeno: ${count}).`,
      );
    }
  }
  // Funkcije kao zamjena: izbjegava tumačenje posebnih sekvenci ($&, $1) u umetnutom tekstu.
  return template
    .replace('__PRECACHE_URLS__', () => JSON.stringify(urls))
    .replace('__BUILD_ID__', () => JSON.stringify(buildId));
}

/** Rekurzivno popisuje datoteke u dist mapi kao URL putanje (s '/' prefiksom). */
export function listPrecacheUrls(distDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const rel = relative(distDir, full).split(sep).join('/');
        if (!EXCLUDED.has(rel)) out.push('/' + rel);
      }
    }
  };
  walk(distDir);
  return out;
}

export function computeBuildId(distDir: string, urls: string[]): string {
  const hash = createHash('sha256');
  for (const u of urls) {
    hash.update(u);
    hash.update(readFileSync(join(distDir, u)));
  }
  return hash.digest('hex').slice(0, 12);
}

/** Nakon builda generira dist/sw.js s popisom svih izlaznih datoteka (bez vanjskog paketa). */
export function serviceWorkerPlugin(): Plugin {
  let outDir = 'dist';
  let root = process.cwd();
  return {
    name: 'home-inventory-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
      root = config.root;
    },
    closeBundle() {
      const dist = join(root, outDir);
      const urls = listPrecacheUrls(dist);
      const template = readFileSync(join(root, TEMPLATE_PATH), 'utf8');
      const sw = renderServiceWorker(template, urls, computeBuildId(dist, urls));
      writeFileSync(join(dist, 'sw.js'), sw);
    },
  };
}
