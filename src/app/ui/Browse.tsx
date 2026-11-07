import { useMemo } from 'react';
import { search } from '../../search/search';
import { ROOT_ID, type Item, type Location } from '../../inventory/types';
import { useApp } from './ctx';
import { GLYPH, itemGlyph, kindText, KIND_LABEL } from './model';
import { Missing, ScreenHead } from './parts';

export function ItemRow({ item, tag }: { item: Item; tag?: string }) {
  const { model, nav, pushRecent } = useApp();
  const ps = model.byItem.get(item.id) ?? [];
  return (
    <>
      <button
        type="button"
        className="listrow"
        data-testid={`item-${item.id}`}
        onClick={() => {
          pushRecent(item.id);
          nav.go({ name: 'item', id: item.id });
        }}
      >
        <span className="thumb small" aria-hidden="true">
          {itemGlyph(item)}
        </span>
        <span className="rowtxt">
          <strong>
            {item.name}
            {tag && <span className="matchtag">{tag}</span>}
          </strong>
          <small>
            {ps.length === 0
              ? 'Bez smještaja'
              : ps.length === 1
                ? model.pathOf(ps[0]!.locationId)
                : `${ps.length} smještaja`}
          </small>
        </span>
        <span className="chev" aria-hidden="true">
          ›
        </span>
      </button>
      {ps.length > 1 && (
        <div className="multi-paths">
          <div className="item-paths">
            {ps.map((p) => (
              <div key={p.id} className="path-line" data-testid="item-path">
                <span aria-hidden="true">⌖</span>
                <span>{model.pathOf(p.locationId)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export function LocRow({ loc }: { loc: Location }) {
  const { model, nav } = useApp();
  return (
    <button
      type="button"
      className="roomcard"
      data-testid={`loc-${loc.id}`}
      onClick={() => nav.go({ name: 'location', id: loc.id })}
    >
      <span className="thumb" aria-hidden="true">
        {GLYPH[loc.kind] ?? '📦'}
      </span>
      <span className="rowtxt">
        <strong>{loc.name}</strong>
        <small>{model.countTypes(loc.id)} vrsta predmeta · uključuje podlokacije</small>
      </span>
      <span className="chev" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

const TYPE_TAG: Record<string, string> = {
  alias: 'sinonim',
  synonym: 'sinonim',
  metadata: 'u putanji/opisu',
};

export function Home() {
  const { index, model, query, setQuery, recents, nav, writable } = useApp();
  const q = query.trim();
  const result = useMemo(() => (q ? search(index, q) : null), [index, q]);
  const recentItems = recents
    .map((id) => model.items.get(id))
    .filter((i): i is Item => Boolean(i))
    .slice(0, 3);
  const total = result ? result.exact.length + result.approx.length : 0;
  return (
    <>
      <section className="hero">
        <div className="hero-line">
          <div>
            <div className="eyebrow">Sve na svom mjestu</div>
            <h1>Što tražiš?</h1>
          </div>
          <div className="hero-art" aria-hidden="true">
            🪴🏡
          </div>
        </div>
        <label className="sr-only" htmlFor="search-input">
          Pretraži predmet ili lokaciju
        </label>
        <div className="searchbar">
          <span aria-hidden="true">⌕</span>
          <input
            id="search-input"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Upiši predmet ili lokaciju…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </section>

      {result && (
        <section id="search-results" aria-live="polite" data-testid="search-results">
          <div className="section-head">
            <h2 className="h3">Rezultati pretrage</h2>
            <small>
              {total} predmeta · {result.places.length} lokacija
            </small>
          </div>
          {result.exact.map((h) => {
            const it = model.items.get(h.itemId);
            return it ? <ItemRow key={h.itemId} item={it} tag={TYPE_TAG[h.type]} /> : null;
          })}
          {result.places.map((h) => {
            const l = model.locs.get(h.locationId);
            return l ? <LocRow key={h.locationId} loc={l} /> : null;
          })}
          {result.approx.length > 0 && (
            <>
              <div className="search-help">
                Pronađeni su i približni nazivi. Provjeri odgovaraju li traženom predmetu.
              </div>
              <div className="section-head">
                <h2 className="h3">Približni rezultati</h2>
              </div>
              {result.approx.map((h) => {
                const it = model.items.get(h.itemId);
                return it ? <ItemRow key={h.itemId} item={it} tag="približno" /> : null;
              })}
            </>
          )}
          {total + result.places.length === 0 && (
            <div className="empty" data-testid="no-results">
              <b>Nema rezultata</b>Pokušaj drugim nazivom ili kraćim izrazom.
            </div>
          )}
        </section>
      )}

      {!result && (
        <>
          <div className="section-head">
            <h2 className="h3">Brze radnje</h2>
          </div>
          <div className="quickgrid">
            <button
              type="button"
              className="quick"
              onClick={() => nav.goTab({ name: 'locations' })}
            >
              <span aria-hidden="true">⌂</span>
              <strong>Lokacije</strong>
            </button>
            <button
              type="button"
              className="quick"
              disabled={!writable}
              onClick={() => nav.go({ name: 'add-item' })}
            >
              <span aria-hidden="true">＋</span>
              <strong>Dodaj predmet</strong>
            </button>
            <button
              type="button"
              className="quick future"
              disabled
              aria-label="Popis kupnje, u pripremi"
            >
              <span aria-hidden="true">🛒</span>
              <strong>
                Popis kupnje<em>U pripremi</em>
              </strong>
            </button>
            <button
              type="button"
              className="quick future"
              disabled
              aria-label="Skeniranje, u pripremi"
            >
              <span aria-hidden="true">▣</span>
              <strong>
                Skeniraj<em>U pripremi</em>
              </strong>
            </button>
          </div>
          <div className="section-head">
            <h2 className="h3">Nedavno pregledano</h2>
          </div>
          {recentItems.length ? (
            recentItems.map((i) => <ItemRow key={i.id} item={i} />)
          ) : (
            <div className="empty">
              <b>Još nema pregledanih predmeta</b>
              {model.items.size
                ? 'Pretraži ili otvori lokaciju pa će se ovdje pojaviti nedavno pregledano.'
                : 'Počni dodavanjem prve lokacije, pa zatim predmeta.'}
            </div>
          )}
        </>
      )}
    </>
  );
}

export function Locations() {
  const { model, nav, writable } = useApp();
  const rooms = model.children(ROOT_ID);
  return (
    <>
      <ScreenHead title="Lokacije" />
      <p className="sub">
        Prostorije i njihovi ormari, police i kutije. Brojevi pokazuju različite vrste predmeta,
        uključujući sadržaj podlokacija.
      </p>
      {rooms.length ? (
        <div className="rooms-grid" data-testid="loc-list">
          {rooms.map((r) => (
            <LocRow key={r.id} loc={r} />
          ))}
        </div>
      ) : (
        <div className="empty" data-testid="empty-house">
          <div className="emoji" aria-hidden="true">
            🏡
          </div>
          <b>Još nema prostorija</b>Dodaj prvu prostoriju pa kasnije ormare, police i kutije. Ništa
          nije unaprijed izmišljeno.
        </div>
      )}
      <div className="section-head">
        <h2 className="h3">Uredi strukturu</h2>
      </div>
      <button
        type="button"
        className="btn primary"
        disabled={!writable}
        onClick={() => nav.go({ name: 'add-location', parentId: ROOT_ID })}
      >
        {rooms.length ? '＋ Dodaj lokaciju' : '＋ Dodaj prvu prostoriju'}
      </button>
    </>
  );
}

export function LocationDetail({ id }: { id: string }) {
  const { model, nav, writable } = useApp();
  const loc = model.locs.get(id);
  if (!loc) return <Missing />;
  const kids = model.children(id);
  const direct = model.byLoc.get(id) ?? [];
  const directItems = [...new Set(direct.map((p) => p.itemId))]
    .map((iid) => model.items.get(iid))
    .filter((i): i is Item => Boolean(i))
    .sort((a, b) => a.name.localeCompare(b.name, 'hr'));
  const movable = loc.kind !== 'house' && loc.kind !== 'room';
  return (
    <>
      <ScreenHead title="Sadržaj lokacije" />
      <div className="crumb">{model.pathOf(id)}</div>
      <div className="locationhero">
        <div className="scene" aria-hidden="true">
          {GLYPH[loc.kind] ?? '📦'}
        </div>
        <div>
          <small>{KIND_LABEL[loc.kind].toUpperCase()}</small>
          <h2>{loc.name}</h2>
          <span className="chip">{model.countTypes(id)} vrsta predmeta</span>
        </div>
      </div>
      <div className="buttonrow" style={{ margin: '14px 0' }}>
        <button
          type="button"
          className="btn primary"
          disabled={!writable}
          onClick={() => nav.go({ name: 'add-item', locationId: id })}
        >
          ＋ Dodaj predmet ovdje
        </button>
        {movable && (
          <button
            type="button"
            className="btn secondary"
            disabled={!writable}
            onClick={() => nav.go({ name: 'move-location', id })}
          >
            ⇄ Premjesti cijelu lokaciju
          </button>
        )}
        <button
          type="button"
          className="btn secondary"
          disabled={!writable}
          onClick={() => nav.go({ name: 'edit-location', id })}
        >
          Uredi naziv
        </button>
      </div>
      <div className="muted-note">
        Broj je dedupliciran po vrsti predmeta i uključuje podlokacije. Izravni predmeti prikazani
        su zasebno.
      </div>
      {kids.length > 0 && (
        <>
          <div className="section-head">
            <h2 className="h3">Podlokacije</h2>
            <small>{kids.length}</small>
          </div>
          {kids.map((k) => (
            <LocRow key={k.id} loc={k} />
          ))}
        </>
      )}
      <div className="section-head">
        <h2 className="h3">Predmeti izravno ovdje</h2>
        <small>{directItems.length} vrsta</small>
      </div>
      {directItems.length ? (
        directItems.map((i) => <ItemRow key={i.id} item={i} />)
      ) : (
        <div className="empty">
          <b>Nema izravnih predmeta</b>Možda su u nekoj od podlokacija.
        </div>
      )}
      <div className="section-head">
        <h2 className="h3">Upravljanje lokacijom</h2>
      </div>
      <div className="buttonrow">
        <button
          type="button"
          className="btn secondary"
          disabled={!writable}
          onClick={() => nav.go({ name: 'add-location', parentId: id })}
        >
          ＋ Dodaj podlokaciju
        </button>
        <span className="hint">Brisanje i arhiviranje lokacija nije dostupno u P2.</span>
      </div>
    </>
  );
}

export function ItemDetail({ id }: { id: string }) {
  const { model, nav, writable } = useApp();
  const item = model.items.get(id);
  if (!item) return <Missing />;
  const ps = model.byItem.get(id) ?? [];
  return (
    <>
      <ScreenHead title="Detalji predmeta" />
      <div className="item-detail-layout">
        <div>
          <div className="itemhero">
            <span className="huge" aria-hidden="true">
              {itemGlyph(item)}
            </span>
            <span className="photo-pill">Bez fotografije</span>
          </div>
          <h2 className="detailname" data-testid="item-name">
            {item.name}
          </h2>
          <div className="pillrow">
            <span className="chip">{kindText(item.kind)}</span>
            <span className="chip blue">{item.category ?? 'Bez kategorije'}</span>
          </div>
          <div className="section-head">
            <h2 className="h3">Gdje se nalazi?</h2>
            <small>{ps.length} smještaja</small>
          </div>
          {ps.length ? (
            ps.map((p) => (
              <button
                key={p.id}
                type="button"
                className="placement"
                data-testid={`pl-${p.id}`}
                onClick={() => nav.go({ name: 'location', id: p.locationId })}
              >
                <span aria-hidden="true">⌖</span>
                <span className="flex1" data-testid="pl-path">
                  {model.pathOf(p.locationId)}
                </span>
                <span aria-hidden="true">›</span>
              </button>
            ))
          ) : (
            <div className="notice" data-testid="no-placement">
              Predmet trenutačno nema evidentirano mjesto. Dodaj smještaj da ga ponovno možeš
              pronaći.
            </div>
          )}
        </div>
        <div>
          <div className="card">
            <div className="keyvalue">
              <span>Kategorija</span>
              <strong>{item.category ?? 'Bez kategorije'}</strong>
            </div>
            <div className="keyvalue">
              <span>Bilješka</span>
              <strong>{item.note ?? 'Nema bilješke'}</strong>
            </div>
            {item.aliases.length > 0 && (
              <div className="keyvalue">
                <span>Sinonimi</span>
                <strong>{item.aliases.join(', ')}</strong>
              </div>
            )}
          </div>
          <div className="buttonrow" style={{ marginTop: 14 }}>
            {ps.length > 0 && (
              <button
                type="button"
                className="btn primary"
                disabled={!writable}
                onClick={() => nav.go({ name: 'move-item', id })}
              >
                ⇄ Premjesti
              </button>
            )}
            <button
              type="button"
              className="btn secondary"
              disabled={!writable}
              onClick={() => nav.go({ name: 'edit-item', id })}
            >
              Uredi
            </button>
          </div>
          {(item.kind === 'type' || ps.length === 0) && (
            <button
              type="button"
              className="btn secondary"
              style={{ marginTop: 10 }}
              disabled={!writable}
              onClick={() => nav.go({ name: 'add-placement', id })}
            >
              {ps.length === 0 ? '＋ Dodaj smještaj' : '＋ Dodaj drugi smještaj'}
            </button>
          )}
          {item.kind === 'unique' && ps.length > 0 && (
            <div className="muted-note" style={{ marginTop: 10 }}>
              Jedinstveni predmet ima samo jedan smještaj. Ako se preseli, koristi „Premjesti”.
            </div>
          )}
          <div className="soft-banner">
            Fotografije, skeniranje i količine nisu dio ove verzije.
          </div>
        </div>
      </div>
    </>
  );
}
