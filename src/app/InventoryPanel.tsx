import { useMemo, useState, type FormEvent } from 'react';
import type { InventoryState } from '../inventory/gate';
import type { InventoryPort } from '../inventory/port';
import { buildPath, isSameOrDescendant } from '../inventory/tree';
import {
  CREATABLE_LOCATION_KINDS,
  ROOT_ID,
  type InventoryData,
  type Item,
  type ItemKind,
  type Location,
  type LocationKind,
  type Placement,
} from '../inventory/types';
import { useInventory, type UseInventory } from '../inventory/useInventory';

/**
 * PRIVREMENO minimalno sučelje za provjeru podatkovnog sloja P2-B (nije dizajn; Organized Cozy dolazi u P2-C).
 * Sve izmjene su ONLINE transakcije: poruka "spremljeno" pojavljuje se tek nakon potvrde poslužitelja.
 */

const KIND_LABEL: Record<LocationKind, string> = {
  house: 'Kuća',
  room: 'Prostorija',
  cabinet: 'Ormar',
  shelf: 'Polica',
  box: 'Kutija',
  drawer: 'Ladica',
  other: 'Ostalo',
};

interface Ctx {
  data: InventoryData;
  locs: Map<string, Location>;
  writable: boolean;
  run: UseInventory['run'];
}

export function InventoryPanel({
  port,
  onRevoked,
}: {
  port: InventoryPort;
  onRevoked: () => void;
}) {
  const inv = useInventory(port, onRevoked);
  const state: InventoryState = inv.inventory;

  return (
    <section aria-labelledby="inv-h" data-testid="inventory">
      <h2 id="inv-h">Inventar (provjera podatkovnog sloja)</h2>
      <StatusLine inv={inv} hideSaved={state.status === 'stale'} />
      {inv.openError && <p role="alert">{inv.openError}</p>}
      {(inv.opening || (state.status === 'loading' && !inv.openError)) && (
        <p role="status" data-testid="inv-loading">
          Učitavanje inventara…
        </p>
      )}
      {state.status === 'error' && (
        <p role="alert" data-testid="inv-error">
          {state.kind === 'offline'
            ? 'Čeka se veza. Inventar nije potvrđen i ne prikazuje se.'
            : 'Inventar nije moguće učitati.'}
        </p>
      )}
      {state.status === 'inconsistent' && (
        <p role="alert" data-testid="inv-inconsistent">
          Podaci su nedosljedni: nema nijedne lokacije, a postoje predmeti ({state.items}) ili
          smještaji ({state.placements}). Ništa se ne prikazuje i ne mijenja, a priprema kućanstva
          je isključena. Obavijesti vlasnika — ovo nije prazno kućanstvo.
        </p>
      )}
      {state.status === 'tree-corrupt' && (
        <p role="alert" data-testid="inv-corrupt">
          Stablo lokacija je oštećeno ({state.problems.length} problema: ciklus, nedostajući
          roditelj ili krivi korijen). Podaci se ne prikazuju i ne mijenjaju dok vlasnik ne popravi
          stanje.
        </p>
      )}
      {(state.status === 'ready' || state.status === 'stale') && (
        <Loaded
          inv={inv}
          data={state.data}
          stale={state.status === 'stale'}
          needsBootstrap={state.status === 'ready' && state.needsBootstrap}
        />
      )}
    </section>
  );
}

function StatusLine({ inv, hideSaved }: { inv: UseInventory; hideSaved: boolean }) {
  const s = inv.status;
  // Dok je prikaz nepotvrđen (veza pala), stara poruka "spremljeno" bi zbunjivala — skrivena je.
  if (s.kind === 'saving')
    return (
      <p role="status" data-testid="inv-status">
        Spremanje… ({s.label})
      </p>
    );
  if (s.kind === 'saved' && !hideSaved)
    return (
      <p role="status" data-testid="inv-status">
        {s.label}: spremljeno na serveru u {new Date(s.at).toLocaleTimeString('hr-HR')}.
      </p>
    );
  if (s.kind === 'error')
    return (
      <p role="alert" data-testid="inv-status">
        {s.message}
      </p>
    );
  return null;
}

function Loaded({
  inv,
  data,
  stale,
  needsBootstrap,
}: {
  inv: UseInventory;
  data: InventoryData;
  stale: boolean;
  needsBootstrap: boolean;
}) {
  const locs = useMemo(
    () => new Map(data.locations.filter((l) => !l.archived).map((l) => [l.id, l])),
    [data.locations],
  );
  const writable = !stale && !inv.busy;
  const ctx: Ctx = { data, locs, writable, run: inv.run };

  return (
    <>
      {stale && (
        <p role="alert" data-testid="inv-stale">
          Veza je prekinuta. Prikazano je zadnje potvrđeno stanje, izmjene su onemogućene dok se
          veza ne vrati.
        </p>
      )}
      {needsBootstrap && (
        <p>
          Kućanstvo još nema lokacija.{' '}
          <button
            type="button"
            disabled={!writable}
            onClick={() => inv.run('Priprema kućanstva', (r) => r.bootstrap())}
          >
            Pripremi kućanstvo
          </button>
        </p>
      )}
      <LocationsSection ctx={ctx} />
      <ItemsSection ctx={ctx} />
      <details>
        <summary>Održavanje</summary>
        <button
          type="button"
          disabled={!writable}
          onClick={() => inv.run('Priprema kućanstva', (r) => r.bootstrap())}
        >
          Pripremi kućanstvo (idempotentno)
        </button>
      </details>
    </>
  );
}

// ------------------------------------------------------------------ lokacije
function orderedTree(locs: Map<string, Location>): { loc: Location; depth: number }[] {
  const children = new Map<string, Location[]>();
  for (const l of locs.values()) {
    const p = l.parentId ?? '';
    (children.get(p) ?? children.set(p, []).get(p)!).push(l);
  }
  for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'hr'));
  const out: { loc: Location; depth: number }[] = [];
  const stack: { loc: Location; depth: number }[] = (children.get('') ?? [])
    .map((l) => ({ loc: l, depth: 0 }))
    .reverse();
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur.loc.id)) continue; // obrana (stablo je već provjereno)
    seen.add(cur.loc.id);
    out.push(cur);
    for (const c of [...(children.get(cur.loc.id) ?? [])].reverse())
      stack.push({ loc: c, depth: cur.depth + 1 });
  }
  return out;
}

const pathLabel = (locs: Map<string, Location>, id: string) => buildPath(locs, id).join(' › ');

function LocationsSection({ ctx }: { ctx: Ctx }) {
  const rows = useMemo(() => orderedTree(ctx.locs), [ctx.locs]);
  return (
    <section aria-labelledby="loc-h">
      <h3 id="loc-h">Lokacije ({ctx.locs.size})</h3>
      <NewLocationForm ctx={ctx} />
      <ul data-testid="loc-list" style={{ listStyle: 'none', paddingLeft: 0 }}>
        {rows.map(({ loc, depth }) => (
          <li
            key={loc.id}
            data-testid={`loc-${loc.id}`}
            style={{ marginLeft: Math.min(depth, 12) * 16 }}
          >
            <strong>{loc.name}</strong>{' '}
            <small>
              ({KIND_LABEL[loc.kind] ?? loc.kind}, v{loc.version})
            </small>
            {loc.id !== ROOT_ID && <LocationEdit ctx={ctx} loc={loc} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function NewLocationForm({ ctx }: { ctx: Ctx }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LocationKind>('cabinet');
  const [parent, setParent] = useState(ROOT_ID);
  const isRoom = kind === 'room';
  const effectiveParent = isRoom ? ROOT_ID : parent; // P2-LOC-ROOM-01
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ctx.writable) return; // Enter u polju ne smije zaobići onemogućeni gumb (stale/spremanje u tijeku)
    const res = await ctx.run('Nova lokacija', (r) =>
      r.createLocation({ name, parentId: effectiveParent, kind }),
    );
    if (res.ok) setName(''); // unos se briše TEK nakon potvrđenog uspjeha
  };
  return (
    <form onSubmit={submit} aria-label="Nova lokacija">
      <input
        aria-label="Naziv lokacije"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
      />{' '}
      <select
        aria-label="Vrsta lokacije"
        value={kind}
        onChange={(e) => setKind(e.target.value as LocationKind)}
      >
        {CREATABLE_LOCATION_KINDS.map((k) => (
          <option key={k} value={k}>
            {KIND_LABEL[k]}
          </option>
        ))}
      </select>{' '}
      <select
        aria-label="Nadređena lokacija"
        value={effectiveParent}
        disabled={isRoom}
        onChange={(e) => setParent(e.target.value)}
      >
        {[...ctx.locs.values()].map((l) => (
          <option key={l.id} value={l.id}>
            {pathLabel(ctx.locs, l.id)}
          </option>
        ))}
      </select>{' '}
      <button type="submit" disabled={!ctx.writable}>
        Dodaj lokaciju
      </button>
      {isRoom && <small> Prostorija je uvijek izravno u kući.</small>}
    </form>
  );
}

function LocationEdit({ ctx, loc }: { ctx: Ctx; loc: Location }) {
  const [name, setName] = useState(loc.name);
  const [target, setTarget] = useState('');
  const movable = loc.kind !== 'room'; // P2-LOC-ROOM-01: prostorije se ne premještaju
  const options = [...ctx.locs.values()].filter(
    (l) => l.id !== loc.parentId && !isSameOrDescendant(ctx.locs, loc.id, l.id),
  );
  return (
    <details>
      <summary>Uredi</summary>
      <p>
        <input
          aria-label={`Novi naziv za ${loc.name}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
        />{' '}
        <button
          type="button"
          disabled={!ctx.writable}
          onClick={() =>
            ctx.run('Preimenovanje lokacije', (r) => r.renameLocation(loc.id, name, loc.version))
          }
        >
          Preimenuj
        </button>
      </p>
      {movable ? (
        <p>
          <select
            aria-label={`Premjesti ${loc.name} pod`}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">— odaberi —</option>
            {options.map((l) => (
              <option key={l.id} value={l.id}>
                {pathLabel(ctx.locs, l.id)}
              </option>
            ))}
          </select>{' '}
          <button
            type="button"
            disabled={!ctx.writable || !target}
            onClick={() =>
              ctx.run('Premještanje lokacije', (r) => r.moveLocation(loc.id, target, loc.version))
            }
          >
            Premjesti cijelu lokaciju
          </button>
        </p>
      ) : (
        <p>
          <small>Prostorije se ne premještaju.</small>
        </p>
      )}
    </details>
  );
}

// ------------------------------------------------------------------ predmeti
function ItemsSection({ ctx }: { ctx: Ctx }) {
  const items = useMemo(
    () =>
      ctx.data.items.filter((i) => !i.archived).sort((a, b) => a.name.localeCompare(b.name, 'hr')),
    [ctx.data.items],
  );
  const byItem = useMemo(() => {
    const m = new Map<string, Placement[]>();
    for (const p of ctx.data.placements)
      if (!p.archived && ctx.locs.has(p.locationId))
        (m.get(p.itemId) ?? m.set(p.itemId, []).get(p.itemId)!).push(p);
    return m;
  }, [ctx.data.placements, ctx.locs]);
  return (
    <section aria-labelledby="item-h">
      <h3 id="item-h">Predmeti ({items.length})</h3>
      <NewItemForm ctx={ctx} />
      <ul data-testid="item-list">
        {items.map((it) => (
          <ItemRow key={it.id} ctx={ctx} item={it} placements={byItem.get(it.id) ?? []} />
        ))}
      </ul>
    </section>
  );
}

function NewItemForm({ ctx }: { ctx: Ctx }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ItemKind>('type');
  const [loc, setLoc] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ctx.writable) return; // Enter u polju ne smije zaobići onemogućeni gumb (stale/spremanje u tijeku)
    // P2 handoff: naziv i početna lokacija su OBAVEZNI. Provjera i u obrascu (ne samo `required`), prije ikakvog poziva.
    if (!name.trim()) return setFormError('Naziv predmeta je obavezan.');
    if (!loc) return setFormError('Odaberi početnu lokaciju — predmet ne može nastati bez nje.');
    setFormError(null);
    // ATOMARNO (jedna transakcija): predmet + prvi smještaj + ključ. Nema "predmeta bez smještaja" nakon greške.
    const res = await ctx.run('Novi predmet', (r) =>
      r.createItemWithPlacement({ name, kind, locationId: loc }),
    );
    if (res.ok) setName(''); // neuspjeh (offline, neispravan unos, sukob...) NE smije obrisati korisnikov unos
  };
  return (
    <form onSubmit={submit} aria-label="Novi predmet" noValidate>
      <input
        aria-label="Naziv predmeta"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
        required
      />{' '}
      <select
        aria-label="Vrsta predmeta"
        value={kind}
        onChange={(e) => setKind(e.target.value as ItemKind)}
      >
        <option value="type">Vrsta (više lokacija)</option>
        <option value="unique">Jedinstveni (jedna lokacija)</option>
      </select>{' '}
      <select
        aria-label="Početna lokacija"
        value={loc}
        onChange={(e) => setLoc(e.target.value)}
        required
      >
        <option value="">— odaberi lokaciju (obavezno) —</option>
        {[...ctx.locs.values()].map((l) => (
          <option key={l.id} value={l.id}>
            {pathLabel(ctx.locs, l.id)}
          </option>
        ))}
      </select>{' '}
      <button type="submit" disabled={!ctx.writable || !name.trim() || !loc}>
        Dodaj predmet
      </button>
      {!loc && <small data-testid="item-loc-hint"> Početna lokacija je obavezna.</small>}
      {formError && (
        <p role="alert" data-testid="item-form-error">
          {formError}
        </p>
      )}
    </form>
  );
}

function ItemRow({ ctx, item, placements }: { ctx: Ctx; item: Item; placements: Placement[] }) {
  const [name, setName] = useState(item.name);
  const [addTo, setAddTo] = useState('');
  const occupied = new Set(placements.map((p) => p.locationId));
  const canAdd = item.kind === 'type' || placements.length === 0;
  const addOptions = [...ctx.locs.values()].filter((l) => !occupied.has(l.id));
  return (
    <li data-testid={`item-${item.id}`}>
      <strong>{item.name}</strong>{' '}
      <small>
        ({item.kind === 'unique' ? 'jedinstveni' : 'vrsta'}, v{item.version})
      </small>
      {placements.length === 0 && <em> — bez smještaja</em>}
      <ul>
        {placements.map((p) => (
          <PlacementRow key={p.id} ctx={ctx} item={item} placement={p} occupied={occupied} />
        ))}
      </ul>
      <details>
        <summary>Uredi / dodaj smještaj</summary>
        <p>
          <input
            aria-label={`Novi naziv za ${item.name}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
          />{' '}
          <button
            type="button"
            disabled={!ctx.writable}
            onClick={() =>
              ctx.run('Preimenovanje predmeta', (r) =>
                r.updateItem(item.id, { name }, item.version),
              )
            }
          >
            Preimenuj
          </button>
        </p>
        {canAdd ? (
          <p>
            <select
              aria-label={`Dodaj smještaj za ${item.name}`}
              value={addTo}
              onChange={(e) => setAddTo(e.target.value)}
            >
              <option value="">— odaberi lokaciju —</option>
              {addOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {pathLabel(ctx.locs, l.id)}
                </option>
              ))}
            </select>{' '}
            <button
              type="button"
              disabled={!ctx.writable || !addTo}
              onClick={() => ctx.run('Novi smještaj', (r) => r.addPlacement(item.id, addTo))}
            >
              Dodaj smještaj
            </button>
          </p>
        ) : (
          <p>
            <small>Jedinstveni predmet je već smješten — premjesti ga umjesto dodavanja.</small>
          </p>
        )}
      </details>
    </li>
  );
}

function PlacementRow({
  ctx,
  item,
  placement,
  occupied,
}: {
  ctx: Ctx;
  item: Item;
  placement: Placement;
  occupied: Set<string>;
}) {
  const [dest, setDest] = useState('');
  const options = [...ctx.locs.values()].filter(
    (l) => l.id !== placement.locationId && (item.kind === 'unique' || !occupied.has(l.id)),
  );
  return (
    <li data-testid={`pl-${placement.id}`}>
      <span data-testid="pl-path">{pathLabel(ctx.locs, placement.locationId)}</span>{' '}
      <select
        aria-label={`Premjesti smještaj ${item.name} (${pathLabel(ctx.locs, placement.locationId)})`}
        value={dest}
        onChange={(e) => setDest(e.target.value)}
      >
        <option value="">— odaberi —</option>
        {options.map((l) => (
          <option key={l.id} value={l.id}>
            {pathLabel(ctx.locs, l.id)}
          </option>
        ))}
      </select>{' '}
      <button
        type="button"
        disabled={!ctx.writable || !dest}
        onClick={() =>
          ctx.run('Premještanje smještaja', (r) =>
            r.movePlacement(placement.id, dest, placement.version),
          )
        }
      >
        Premjesti
      </button>{' '}
      <button
        type="button"
        disabled={!ctx.writable}
        onClick={() =>
          ctx.run('Uklanjanje smještaja', (r) =>
            r.archivePlacement(placement.id, placement.version),
          )
        }
      >
        Ukloni smještaj
      </button>
    </li>
  );
}
