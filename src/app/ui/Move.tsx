import { useState } from 'react';
import { normalize } from '../../search/normalize';
import type { Location } from '../../inventory/types';
import { useApp } from './ctx';
import { GLYPH, treeOrder } from './model';
import { Missing, ScreenHead, useMounted } from './parts';

interface Dest {
  loc: Location;
  problem: string | null;
}

/** Odredišta: odabir je IZVRŠNA radnja (bez trećeg potvrđivanja). Blokirana odredišta imaju vidljiv razlog. */
function Destinations({
  dests,
  disabled,
  onPick,
}: {
  dests: Dest[];
  disabled: boolean;
  onPick: (id: string) => void;
}) {
  const { model, recentDest } = useApp();
  const [filter, setFilter] = useState('');
  const q = normalize(filter);
  const byId = new Map(dests.map((d) => [d.loc.id, d]));
  const recent = recentDest
    .map((id) => byId.get(id))
    .filter((d): d is Dest => Boolean(d))
    .slice(0, 4);
  const shown = dests.filter((d) => !q || normalize(model.pathOf(d.loc.id)).includes(q));
  const btn = (d: Dest, prefix: string) => (
    <button
      key={`${prefix}${d.loc.id}`}
      type="button"
      className="quick-destination"
      data-testid={`${prefix}dest-${d.loc.id}`}
      disabled={disabled || d.problem !== null}
      aria-label={
        d.problem ? `${d.loc.name}: ${d.problem}` : `Premjesti u ${model.pathOf(d.loc.id)}`
      }
      onClick={() => onPick(d.loc.id)}
    >
      <span className="thumb small" aria-hidden="true">
        {GLYPH[d.loc.kind] ?? '📦'}
      </span>
      <span className="dest-text">
        {d.loc.name}
        <small>{d.problem ?? model.pathOf(d.loc.id)}</small>
      </span>
      <span aria-hidden="true">{d.problem ? '⊘' : '›'}</span>
    </button>
  );
  return (
    <>
      {recent.length > 0 && (
        <>
          <div className="section-head">
            <h2 className="h3">Brzi odabir</h2>
          </div>
          {recent.map((d) => btn(d, 'r-'))}
        </>
      )}
      <div className="section-head">
        <h2 className="h3">Sve lokacije</h2>
      </div>
      <label className="sr-only" htmlFor="destination-filter">
        Pretraži odredišta
      </label>
      <input
        id="destination-filter"
        className="dest-filter"
        type="search"
        placeholder="Pronađi ormar, kutiju ili policu…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="target-list" data-testid="destination-results">
        {shown.map((d) => btn(d, ''))}
        {shown.length === 0 && <div className="empty">Nema takve lokacije.</div>}
      </div>
    </>
  );
}

export function MoveItem({ id }: { id: string }) {
  const { model, inv, nav, writable, pushDest } = useApp();
  const [source, setSource] = useState<string | null>(null);
  const mounted = useMounted();
  const item = model.items.get(id);
  if (!item) return <Missing />;
  const ps = model.byItem.get(id) ?? [];
  const current = ps.length === 1 ? ps[0] : ps.find((p) => p.id === source);
  if (ps.length === 0) return <Missing />;

  if (!current)
    return (
      <>
        <ScreenHead title="Koji smještaj premještaš?" />
        <div className="card">
          <strong>{item.name}</strong>
          <div className="sub">{ps.length} fizička smještaja. Odaberi samo jedan.</div>
        </div>
        {ps.map((p) => (
          <button
            key={p.id}
            type="button"
            className="source-choice"
            data-testid={`source-${p.id}`}
            onClick={() => setSource(p.id)}
          >
            <span className="thumb small" aria-hidden="true">
              📦
            </span>
            <span className="copy">
              {model.pathOf(p.locationId)}
              <small>Ostali smještaji neće se mijenjati.</small>
            </span>
            <span aria-hidden="true">›</span>
          </button>
        ))}
      </>
    );

  const others = new Set(ps.filter((p) => p.id !== current.id).map((p) => p.locationId));
  const dests: Dest[] = treeOrder(model).map((loc) => ({
    loc,
    problem:
      loc.id === current.locationId
        ? 'Trenutačna lokacija'
        : item.kind === 'type' && others.has(loc.id)
          ? 'Isti predmet već postoji ovdje'
          : null,
  }));
  const pick = async (dest: string) => {
    if (!writable) return;
    const finish = () => {
      pushDest(dest);
      if (mounted.current) nav.go({ name: 'item', id }, { replace: true, keepStatus: true });
    };
    const res = await inv.run(
      'Premještanje smještaja',
      (r) => r.movePlacement(current.id, dest, current.version),
      {
        verify: {
          op: 'movePlacement',
          id: current.id,
          expectedVersion: current.version,
          newLocationId: dest,
        },
        onApplied: finish,
      },
    );
    if (res.ok) finish();
  };
  return (
    <>
      <ScreenHead title="Premjesti predmet" />
      <div className="card">
        <strong>{item.name}</strong>
        <div className="sub">Sada: {model.pathOf(current.locationId)}</div>
      </div>
      {ps.length > 1 && (
        <button type="button" className="link" onClick={() => setSource(null)}>
          ← Promijeni izvorni smještaj
        </button>
      )}
      <p className="tiny-heading">Odabir odredišta odmah pokreće spremanje</p>
      <Destinations dests={dests} disabled={!writable} onPick={pick} />
      <div className="notice">
        Izbor odredišta odmah pokreće <strong>online spremanje</strong>; nema dodatnog „Potvrdi”.
        Premještanje je dovršeno tek nakon potvrde poslužitelja.
      </div>
    </>
  );
}

export function MoveLocation({ id }: { id: string }) {
  const { model, inv, nav, writable, pushDest } = useApp();
  const mounted = useMounted();
  const loc = model.locs.get(id);
  if (!loc) return <Missing />;
  if (loc.kind === 'room' || loc.kind === 'house')
    return (
      <>
        <ScreenHead title="Premjesti cijelu lokaciju" />
        <div className="notice-select">Prostoriju nije moguće premještati.</div>
      </>
    );
  const dests: Dest[] = treeOrder(model).map((l) => ({
    loc: l,
    problem:
      l.id === id
        ? 'Ne možeš premjestiti u samu sebe'
        : model.isInside(l.id, id)
          ? 'Odredište je unutar premještane lokacije'
          : l.id === loc.parentId
            ? 'Već se nalazi ovdje'
            : null,
  }));
  const pick = async (dest: string) => {
    if (!writable) return;
    const finish = () => {
      pushDest(dest);
      if (mounted.current) nav.go({ name: 'location', id }, { replace: true, keepStatus: true });
    };
    const res = await inv.run(
      'Premještanje lokacije',
      (r) => r.moveLocation(id, dest, loc.version),
      {
        verify: { op: 'moveLocation', id, expectedVersion: loc.version, newParentId: dest },
        onApplied: finish,
      },
    );
    if (res.ok) finish();
  };
  return (
    <>
      <ScreenHead title="Premjesti cijelu lokaciju" />
      <div className="card">
        <strong>{loc.name}</strong>
        <p className="sub">Sada: {model.pathOf(id)}</p>
        <div className="muted-note">
          Premješta se cijela lokacija, uključujući podlokacije i {model.countTypes(id)} vrsta
          predmeta. Pojedinačni smještaji predmeta neće se prepisivati.
        </div>
      </div>
      <p className="tiny-heading">Odaberi novog roditelja</p>
      <Destinations dests={dests} disabled={!writable} onPick={pick} />
      <div className="notice">
        Ne možeš premjestiti lokaciju u samu sebe, njezina potomka ni na već postojeću nadređenu
        lokaciju. Poslužitelj je izvor istine; spremanje zahtijeva potvrdu poslužitelja.
      </div>
    </>
  );
}
