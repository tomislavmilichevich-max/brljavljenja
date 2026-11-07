// RAZVOJNI alat (nije dio produkcijskog builda: `vite build` ima samo index.html kao ulaz).
// Renderira PRAVE produkcijske React komponente (InventoryApp) s lažnim portom i sintetskim fixtureom iz docs/fixtures
// radi screenshotova stanja koja se teško izazivaju (učitavanje, oštećeno stablo, nedosljedno, nepoznat ishod…).
import { createRoot } from 'react-dom/client';
import '../../src/app/app.css';
import fixture from '../../docs/fixtures/P2_DEMO_HOUSE.json';
import { DomainError } from '../../src/inventory/errors';
import type { InventoryState } from '../../src/inventory/gate';
import type { InventoryPort } from '../../src/inventory/port';
import type { InventoryRepository } from '../../src/inventory/repository';
import type { InventoryData, Item, Location, Placement } from '../../src/inventory/types';
import { InventoryApp } from '../../src/app/ui/InventoryApp';

const audit = { version: 1, archived: false };
const data: InventoryData = {
  locations: fixture.locations.map((l) => ({ ...l, ...audit })) as Location[],
  items: fixture.items.map((i) => ({
    id: i.id,
    name: i.name,
    kind: i.kind,
    aliases: i.aliases ?? [],
    category: i.category ?? null,
    note: i.note ?? null,
    ...audit,
  })) as Item[],
  placements: fixture.placements.map((p) => ({
    id: p.id,
    itemId: p.itemId,
    locationId: p.locationId,
    ...audit,
  })) as Placement[],
};

const q = new URLSearchParams(location.search);
const scenario = q.get('s') ?? 'ready';
const never = () => new Promise<never>(() => undefined);

const repo: InventoryRepository = {
  bootstrap: async () => ({ created: [] }),
  createLocation: async ({ id }) => ({ id: id ?? 'x' }),
  renameLocation: async () => {},
  moveLocation: async () => {},
  createItemWithPlacement: async ({ attempt }) => {
    if (scenario === 'saving') return never();
    if (scenario === 'unknown') throw new DomainError('outcome-unknown');
    return { itemId: attempt?.itemId ?? 'x', placementId: attempt?.placementId ?? 'y' };
  },
  updateItem: async () => {
    if (scenario === 'conflict') throw new DomainError('changed-elsewhere');
    if (scenario === 'failure') throw new DomainError('unknown');
  },
  addPlacement: async () => ({ id: 'x' }),
  movePlacement: async () => {},
  archivePlacement: async () => {},
  verify: async () => 'unknown',
};

const stateFor = (): InventoryState | null => {
  switch (scenario) {
    case 'loading':
      return null;
    case 'corrupt':
      return { status: 'tree-corrupt', problems: [{ type: 'cycle', ids: ['a', 'b'] }] };
    case 'inconsistent':
      return { status: 'inconsistent', items: 12, placements: 14 };
    case 'stale':
      return { status: 'stale', data };
    case 'empty-root':
      return {
        status: 'ready',
        needsBootstrap: false,
        data: { locations: [data.locations[0]!], items: [], placements: [] },
      };
    default:
      return { status: 'ready', needsBootstrap: false, data };
  }
};

const port: InventoryPort = {
  open: async () => ({
    uid: 'demo',
    repo,
    watch: (cb) => {
      const s = stateFor();
      if (s) setTimeout(() => cb(s), 0);
      return () => undefined;
    },
    dispose: async () => {},
  }),
};

createRoot(document.getElementById('root')!).render(
  <div className="shell">
    <div className="app-wrap">
      <InventoryApp
        port={port}
        onRevoked={() => undefined}
        online={scenario !== 'offline'}
        account={{
          householdName: 'DEMO (samo screenshot)',
          displayName: 'Demo',
          verifiedAt: Date.now(),
          stale: false,
          onRecheck: () => undefined,
          onSignOut: () => undefined,
          signOutFailed: false,
        }}
      />
    </div>
  </div>,
);
