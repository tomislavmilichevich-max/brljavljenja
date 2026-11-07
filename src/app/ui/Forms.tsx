import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { newCreateAttempt } from '../../inventory/repository';
import { newId } from '../../inventory/validation';
import {
  CREATABLE_LOCATION_KINDS,
  ROOT_ID,
  type Item,
  type ItemKind,
  type LocationKind,
} from '../../inventory/types';
import { useApp } from './ctx';
import { GLYPH, kindText, KIND_LABEL, treeOrder } from './model';
import { Field, Missing, ScreenHead } from './parts';

const splitAliases = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

// ------------------------------------------------------------------ dodaj predmet (UX-033-01/02, REV-04)
export function ItemCreate({ locationId }: { locationId?: string }) {
  const { model, inv, nav, writable, readOnlyReason } = useApp();
  const suggested = locationId && model.locs.has(locationId) ? locationId : '';
  const [attempt] = useState(newCreateAttempt); // ID-evi pokušaja sačuvani PRIJE slanja (provjera ishoda)
  const [name, setName] = useState('');
  const [loc, setLoc] = useState(suggested);
  const [kind, setKind] = useState<ItemKind>('unique');
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [aliases, setAliases] = useState('');
  const [errors, setErrors] = useState<{ name?: string; loc?: string }>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const locRef = useRef<HTMLSelectElement>(null);

  const finish = useCallback(
    (itemId: string) => nav.go({ name: 'item', id: itemId }, { replace: true, keepStatus: true }),
    [nav],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!writable) return; // Enter u polju ne smije zaobići onemogućeni gumb
    const next: typeof errors = {};
    if (!name.trim()) next.name = 'Upiši naziv predmeta.';
    if (!loc) next.loc = 'Odaberi lokaciju. Predmet ne može nastati bez mjesta.';
    setErrors(next);
    if (next.name) return void nameRef.current?.focus();
    if (next.loc) return void locRef.current?.focus();
    const res = await inv.run(
      'Dodavanje predmeta',
      (r) =>
        r.createItemWithPlacement({
          name,
          kind,
          locationId: loc,
          category,
          note,
          aliases: splitAliases(aliases),
          attempt,
        }),
      { verify: { op: 'createItem', ...attempt }, onApplied: () => finish(attempt.itemId) },
    );
    if (res.ok) finish(res.value.itemId); // unos se briše TEK nakon potvrđenog uspjeha (odlazak na detalj)
  };

  return (
    <>
      <ScreenHead title="Dodaj predmet" />
      <form className="form" noValidate onSubmit={submit} aria-label="Novi predmet">
        <div className="card">
          <Field id="field-name" label="Naziv predmeta *" error={errors.name}>
            <input
              id="field-name"
              ref={nameRef}
              name="name"
              required
              maxLength={120}
              value={name}
              placeholder="npr. Aku bušilica"
              onChange={(e) => setName(e.target.value)}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? 'field-name-err' : undefined}
            />
          </Field>
          <div style={{ marginTop: 13 }}>
            <Field
              id="field-location"
              label="Lokacija *"
              error={errors.loc}
              hint={
                suggested
                  ? 'Predložena je lokacija iz koje dodaješ predmet; možeš je promijeniti.'
                  : 'Odaberi mjesto na kojem se stvar nalazi. Nema unaprijed odabrane lokacije.'
              }
            >
              <select
                id="field-location"
                ref={locRef}
                name="locationId"
                value={loc}
                onChange={(e) => setLoc(e.target.value)}
                aria-invalid={errors.loc ? true : undefined}
                aria-describedby={errors.loc ? 'field-location-err' : undefined}
              >
                <option value="" disabled>
                  Odaberi lokaciju…
                </option>
                {treeOrder(model).map((l) => (
                  <option key={l.id} value={l.id}>
                    {model.pathOf(l.id)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <fieldset className="kind-field">
            <legend>Vrsta predmeta</legend>
            {(
              [
                [
                  'unique',
                  'Jedinstveni predmet',
                  'Jedna konkretna stvar na jednom mjestu, npr. određena aku bušilica.',
                ],
                ['type', 'Vrsta predmeta', 'Takvu stvar imamo na više mjesta, npr. AA baterije.'],
              ] as const
            ).map(([v, title, desc]) => (
              <label key={v} className={`kind-choice ${kind === v ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="kind"
                  value={v}
                  checked={kind === v}
                  onChange={() => setKind(v)}
                />
                <span>
                  <strong>{title}</strong>
                  <small>{desc}</small>
                </span>
              </label>
            ))}
            <small className="hint">
              Predložena je opcija „Jedinstveni predmet”. Nakon dodavanja ovaj izbor nije moguće
              promijeniti.
            </small>
          </fieldset>
        </div>
        <div className="card">
          <Field id="field-category" label="Kategorija (neobavezno)">
            <input
              id="field-category"
              name="category"
              maxLength={60}
              value={category}
              placeholder="npr. Alat"
              onChange={(e) => setCategory(e.target.value)}
            />
          </Field>
          <div style={{ marginTop: 14 }}>
            <Field id="field-note" label="Bilješka (neobavezno)">
              <textarea
                id="field-note"
                name="note"
                maxLength={1000}
                value={note}
                placeholder="npr. rezervni nastavci"
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
          <div style={{ marginTop: 14 }}>
            <Field
              id="field-aliases"
              label="Sinonimi (neobavezno)"
              hint="Odvoji zarezom. Pomažu da predmet pronađeš drugim nazivom."
            >
              <input
                id="field-aliases"
                name="aliases"
                value={aliases}
                placeholder="npr. busilica, drill"
                onChange={(e) => setAliases(e.target.value)}
              />
            </Field>
          </div>
        </div>
        <div className="notice">
          Jednim pritiskom na „Dodaj predmet” stvara se predmet i njegov prvi smještaj. Spremanje
          zahtijeva potvrdu poslužitelja.
        </div>
        {readOnlyReason && <div className="muted-note">{readOnlyReason}</div>}
        <button type="submit" className="btn primary full" disabled={!writable}>
          {inv.busy ? 'Spremanje…' : 'Dodaj predmet'}
        </button>
      </form>
    </>
  );
}

// ------------------------------------------------------------------ uredi predmet (UX-032-01)
export function ItemEdit({ id }: { id: string }) {
  const { model, inv, nav, writable, readOnlyReason } = useApp();
  const live = model.items.get(id);
  const [base, setBase] = useState<Item | undefined>(live);
  const init = (i?: Item) => ({
    name: i?.name ?? '',
    category: i?.category ?? '',
    note: i?.note ?? '',
    aliases: (i?.aliases ?? []).join(', '),
  });
  const [draft, setDraft] = useState(() => init(live));
  const [nameErr, setNameErr] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const baseVals = useMemo(() => init(base), [base]);
  const dirty =
    draft.name.trim() !== baseVals.name.trim() ||
    draft.category.trim() !== baseVals.category.trim() ||
    draft.note.trim() !== baseVals.note.trim() ||
    splitAliases(draft.aliases).join('|') !== splitAliases(baseVals.aliases).join('|');

  const save = useCallback(async (): Promise<boolean> => {
    if (!base || !writable) return false;
    if (!draft.name.trim()) {
      setNameErr('Upiši naziv predmeta.');
      nameRef.current?.focus();
      return false;
    }
    setNameErr(null);
    const patch = {
      name: draft.name,
      category: draft.category.trim() || null,
      note: draft.note.trim() || null,
      aliases: splitAliases(draft.aliases),
    };
    const res = await inv.run('Spremanje predmeta', (r) => r.updateItem(id, patch, base.version), {
      verify: { op: 'updateItem', id, expectedVersion: base.version, patch },
    });
    return res.ok;
  }, [base, draft, id, inv, writable]);

  useEffect(() => {
    nav.setGuard(dirty ? { dirty: true, save } : null);
    return () => nav.setGuard(null);
  }, [dirty, save, nav]);

  if (!live || !base) return <Missing />;
  const changedElsewhere = live.version !== base.version;
  const ps = model.byItem.get(id) ?? [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!writable) return;
    if (!dirty) return nav.go({ name: 'item', id }, { replace: true });
    if (await save()) {
      nav.setGuard(null);
      nav.go({ name: 'item', id }, { replace: true, keepStatus: true });
    }
  };

  return (
    <>
      <ScreenHead title="Uredi predmet" />
      <form className="form" noValidate onSubmit={submit} aria-label="Uredi predmet">
        {changedElsewhere && (
          <div className="compare" role="alert" data-testid="compare">
            <strong>Zapis je u međuvremenu promijenjen na poslužitelju.</strong> Tvoj uneseni tekst
            je sačuvan. Usporedi s aktualnim stanjem, pa nastavi uređivanje nad aktualnom verzijom.
            <dl>
              <dt>Naziv na poslužitelju</dt>
              <dd>{live.name}</dd>
              <dt>Kategorija na poslužitelju</dt>
              <dd>{live.category ?? '—'}</dd>
              <dt>Bilješka na poslužitelju</dt>
              <dd>{live.note ?? '—'}</dd>
            </dl>
            <div className="actions">
              <button type="button" className="btn secondary" onClick={() => setBase(live)}>
                Nastavi nad aktualnom verzijom
              </button>
            </div>
          </div>
        )}
        <div className="card">
          <Field id="field-name" label="Naziv predmeta *" error={nameErr}>
            <input
              id="field-name"
              ref={nameRef}
              name="name"
              required
              maxLength={120}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              aria-invalid={nameErr ? true : undefined}
              aria-describedby={nameErr ? 'field-name-err' : undefined}
            />
          </Field>
          <div className="readonly-location">
            <strong>Vrsta: {kindText(live.kind)} · ne može se promijeniti</strong>
            <strong>Fizičke lokacije · samo pregled</strong>
            {ps.map((p) => (
              <span key={p.id} className="readonly-path">
                ⌖ {model.pathOf(p.locationId)}
              </span>
            ))}
            {ps.length > 0 && (
              <button
                type="button"
                className="btn secondary full"
                onClick={() => nav.go({ name: 'move-item', id })}
              >
                ⇄ Promijeni lokaciju preko Premjesti
              </button>
            )}
            <small className="hint">Ovaj obrazac nikada ne mijenja smještaje predmeta.</small>
          </div>
        </div>
        <div className="card">
          <Field id="field-category" label="Kategorija (neobavezno)">
            <input
              id="field-category"
              name="category"
              maxLength={60}
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            />
          </Field>
          <div style={{ marginTop: 14 }}>
            <Field id="field-note" label="Bilješka (neobavezno)">
              <textarea
                id="field-note"
                name="note"
                maxLength={1000}
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </Field>
          </div>
          <div style={{ marginTop: 14 }}>
            <Field
              id="field-aliases"
              label="Sinonimi (neobavezno)"
              hint="Odvoji zarezom. Pomažu da predmet pronađeš drugim nazivom."
            >
              <input
                id="field-aliases"
                name="aliases"
                value={draft.aliases}
                onChange={(e) => setDraft({ ...draft, aliases: e.target.value })}
              />
            </Field>
          </div>
        </div>
        <div className="notice">Lokacija se može promijeniti samo kroz Premjesti.</div>
        {readOnlyReason && <div className="muted-note">{readOnlyReason}</div>}
        <button type="submit" className="btn primary full" disabled={!writable}>
          {inv.busy ? 'Spremanje…' : 'Spremi promjene'}
        </button>
      </form>
    </>
  );
}

// ------------------------------------------------------------------ dodaj lokaciju (UX-033-03, P2-LOC-ROOM-01)
export function LocationCreate({ parentId }: { parentId?: string }) {
  const { model, inv, nav, writable, readOnlyReason } = useApp();
  const ctxParent = parentId && model.locs.has(parentId) ? parentId : ROOT_ID;
  const [newLocId] = useState(newId); // sačuvan ID pokušaja (idempotentni ponovni pokušaj, provjera ishoda)
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LocationKind | ''>('');
  const [parent, setParent] = useState(ctxParent);
  const [errors, setErrors] = useState<{ name?: string; kind?: string }>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const kindRef = useRef<HTMLSelectElement>(null);
  const roomAllowed = ctxParent === ROOT_ID;
  const effectiveParent = kind === 'room' ? ROOT_ID : parent;

  const finish = useCallback(
    (id: string) => nav.go({ name: 'location', id }, { replace: true, keepStatus: true }),
    [nav],
  );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!writable) return;
    const next: typeof errors = {};
    if (!name.trim()) next.name = 'Upiši naziv lokacije.';
    if (!kind) next.kind = 'Odaberi vrstu lokacije.';
    setErrors(next);
    if (next.name) return void nameRef.current?.focus();
    if (next.kind || !kind) return void kindRef.current?.focus();
    const res = await inv.run(
      'Dodavanje lokacije',
      (r) => r.createLocation({ name, parentId: effectiveParent, kind, id: newLocId }),
      { verify: { op: 'createLocation', id: newLocId }, onApplied: () => finish(newLocId) },
    );
    if (res.ok) finish(res.value.id);
  };
  return (
    <>
      <ScreenHead title="Dodaj lokaciju" />
      <form className="form" noValidate onSubmit={submit} aria-label="Nova lokacija">
        <div className="card">
          <Field id="loc-name" label="Naziv lokacije *" error={errors.name}>
            <input
              id="loc-name"
              ref={nameRef}
              name="name"
              required
              maxLength={120}
              value={name}
              placeholder="npr. Kutija za kablove"
              onChange={(e) => setName(e.target.value)}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? 'loc-name-err' : undefined}
            />
          </Field>
          <div style={{ marginTop: 14 }}>
            <Field
              id="loc-kind"
              label="Vrsta lokacije *"
              error={errors.kind}
              hint="Prostorija mora biti neposredno unutar kuće i kasnije se ne može premještati."
            >
              <select
                id="loc-kind"
                ref={kindRef}
                name="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as LocationKind)}
                aria-invalid={errors.kind ? true : undefined}
                aria-describedby={errors.kind ? 'loc-kind-err' : undefined}
              >
                <option value="" disabled>
                  Odaberi vrstu…
                </option>
                {CREATABLE_LOCATION_KINDS.map((k) => (
                  <option key={k} value={k} disabled={k === 'room' && !roomAllowed}>
                    {KIND_LABEL[k]}
                    {k === 'room' && !roomAllowed ? ' (dodaj iz Kuće)' : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ marginTop: 14 }}>
            <Field
              id="loc-parent"
              label="Unutar koje lokacije? *"
              hint={
                kind === 'room' ? 'Za prostoriju je nadređena lokacija uvijek Kuća.' : undefined
              }
            >
              <select
                id="loc-parent"
                name="parentId"
                value={effectiveParent}
                disabled={kind === 'room'}
                onChange={(e) => setParent(e.target.value)}
              >
                {treeOrder(model).map((l) => (
                  <option key={l.id} value={l.id}>
                    {model.pathOf(l.id)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
        {readOnlyReason && <div className="muted-note">{readOnlyReason}</div>}
        <button type="submit" className="btn primary full" disabled={!writable}>
          {inv.busy ? 'Spremanje…' : 'Spremi lokaciju'}
        </button>
      </form>
    </>
  );
}

export function LocationEdit({ id }: { id: string }) {
  const { model, inv, nav, writable, readOnlyReason } = useApp();
  const live = model.locs.get(id);
  const [base, setBase] = useState(live);
  const [name, setName] = useState(live?.name ?? '');
  const [err, setErr] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const dirty = (base?.name ?? '').trim() !== name.trim();

  const save = useCallback(async (): Promise<boolean> => {
    if (!base || !writable) return false;
    if (!name.trim()) {
      setErr('Upiši naziv lokacije.');
      nameRef.current?.focus();
      return false;
    }
    setErr(null);
    const res = await inv.run(
      'Spremanje naziva lokacije',
      (r) => r.renameLocation(id, name, base.version),
      { verify: { op: 'renameLocation', id, expectedVersion: base.version, name } },
    );
    return res.ok;
  }, [base, id, inv, name, writable]);

  useEffect(() => {
    nav.setGuard(dirty ? { dirty: true, save } : null);
    return () => nav.setGuard(null);
  }, [dirty, save, nav]);

  if (!live || !base) return <Missing />;
  const changedElsewhere = live.version !== base.version;
  const immovable = live.kind === 'room' || live.kind === 'house';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!writable) return;
    if (!dirty) return nav.go({ name: 'location', id }, { replace: true });
    if (await save()) {
      nav.setGuard(null);
      nav.go({ name: 'location', id }, { replace: true, keepStatus: true });
    }
  };
  return (
    <>
      <ScreenHead title="Uredi naziv lokacije" />
      <form className="form" noValidate onSubmit={submit} aria-label="Uredi lokaciju">
        {changedElsewhere && (
          <div className="compare" role="alert" data-testid="compare">
            <strong>Lokacija je u međuvremenu promijenjena na poslužitelju.</strong> Tvoj tekst je
            sačuvan.
            <dl>
              <dt>Naziv na poslužitelju</dt>
              <dd>{live.name}</dd>
            </dl>
            <div className="actions">
              <button type="button" className="btn secondary" onClick={() => setBase(live)}>
                Nastavi nad aktualnom verzijom
              </button>
            </div>
          </div>
        )}
        <div className="card">
          <Field id="loc-name" label="Naziv lokacije *" error={err}>
            <input
              id="loc-name"
              ref={nameRef}
              name="name"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={err ? true : undefined}
              aria-describedby={err ? 'loc-name-err' : undefined}
            />
          </Field>
          <div className="readonly-location">
            <strong>
              Vrsta: {KIND_LABEL[live.kind]} {GLYPH[live.kind]} · samo pregled
            </strong>
            <strong>Nadređena lokacija · samo pregled</strong>
            <span className="readonly-path">{model.pathOf(live.parentId)}</span>
            {immovable ? (
              <small className="hint">Prostorija se ne može premještati.</small>
            ) : (
              <button
                type="button"
                className="btn secondary full"
                onClick={() => nav.go({ name: 'move-location', id })}
              >
                ⇄ Premjesti lokaciju
              </button>
            )}
          </div>
        </div>
        {readOnlyReason && <div className="muted-note">{readOnlyReason}</div>}
        <button type="submit" className="btn primary full" disabled={!writable}>
          {inv.busy ? 'Spremanje…' : 'Spremi naziv'}
        </button>
      </form>
    </>
  );
}

// ------------------------------------------------------------------ drugi smještaj
export function AddPlacement({ id }: { id: string }) {
  const { model, inv, nav, writable, pushDest } = useApp();
  const item = model.items.get(id);
  if (!item) return <Missing />;
  const ps = model.byItem.get(id) ?? [];
  if (item.kind === 'unique' && ps.length > 0)
    return (
      <>
        <ScreenHead title="Dodaj smještaj" />
        <div className="notice-select">
          Jedinstveni predmet može imati samo jedno mjesto. Za promjenu koristi „Premjesti”.
        </div>
      </>
    );
  const occupied = new Set(ps.map((p) => p.locationId));
  const pick = async (locationId: string) => {
    if (!writable || occupied.has(locationId)) return;
    const res = await inv.run('Dodavanje smještaja', (r) => r.addPlacement(id, locationId), {
      verify: { op: 'addPlacement', itemId: id, locationId },
      onApplied: () => nav.go({ name: 'item', id }, { replace: true, keepStatus: true }),
    });
    if (res.ok) {
      pushDest(locationId);
      nav.go({ name: 'item', id }, { replace: true, keepStatus: true });
    }
  };
  return (
    <>
      <ScreenHead title={ps.length ? 'Dodaj drugi smještaj' : 'Dodaj smještaj'} />
      <div className="card">
        <strong>{item.name}</strong>
        <p className="sub">
          {ps.length
            ? 'Ovu vrstu predmeta možemo imati na više mjesta. Odaberi dodatnu lokaciju.'
            : 'Predmet nema evidentirano mjesto. Odaberi lokaciju na kojoj se nalazi.'}
        </p>
      </div>
      <div data-testid="placement-targets">
        {treeOrder(model).map((l) => {
          const dup = occupied.has(l.id);
          return (
            <button
              key={l.id}
              type="button"
              className="quick-destination"
              data-testid={`dest-${l.id}`}
              disabled={dup || !writable}
              onClick={() => pick(l.id)}
            >
              <span className="thumb small" aria-hidden="true">
                {GLYPH[l.kind] ?? '📦'}
              </span>
              <span className="dest-text">
                {l.name}
                <small>
                  {dup ? 'Već je evidentirano ovdje — duplikat nije dopušten' : model.pathOf(l.id)}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
