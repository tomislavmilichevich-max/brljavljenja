import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { InventoryPort } from '../../inventory/port';
import { buildSearchIndex } from '../../search/search';
import { useInventory, type UseInventory } from '../../inventory/useInventory';
import type { InventoryData } from '../../inventory/types';
import { Home, ItemDetail, LocationDetail, Locations } from './Browse';
import { AppContext, useApp, type AppCtx } from './ctx';
import { AddPlacement, ItemCreate, ItemEdit, LocationCreate, LocationEdit } from './Forms';
import { buildModel } from './model';
import { MoveItem, MoveLocation } from './Move';
import { tabOf, useNavigator, type Route, type Tab } from './nav';
import { ScreenHead, StatusBanner, UnsavedDialog } from './parts';

export interface Account {
  householdName: string | null;
  displayName: string | null;
  verifiedAt: number;
  stale: boolean;
  onRecheck: () => void;
  onSignOut: () => void;
  signOutFailed: boolean;
}

const formatTime = (ms: number) =>
  new Date(ms).toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' });

function Brand({ sub, onMore }: { sub: ReactNode; onMore?: () => void }) {
  return (
    <header className="top">
      <div className="brand">
        <span className="brandmark" aria-hidden="true">
          🏠
        </span>
        <span>
          Kućni inventar
          <small className="small-status">{sub}</small>
        </span>
      </div>
      {onMore && (
        <button type="button" className="avatar-button" aria-label="Otvori Više" onClick={onMore}>
          ⚙
        </button>
      )}
    </header>
  );
}

function GateScreen(props: {
  icon: string;
  title: string;
  children: ReactNode;
  testId: string;
  alert?: boolean;
}) {
  return (
    <section
      className="authscreen"
      data-testid={props.testId}
      role={props.alert ? 'alert' : 'status'}
    >
      <div className="authicon" aria-hidden="true">
        {props.icon}
      </div>
      <h1>{props.title}</h1>
      {props.children}
    </section>
  );
}

/**
 * Završni Organized Cozy prikaz inventara (P2-C). Sve izmjene idu ISKLJUČIVO kroz InventoryRepository (online
 * transakcije); privatni sadržaj postoji samo dok je server-potvrđena sesija aktivna (unmount = brisanje).
 */
export function InventoryApp({
  port,
  onRevoked,
  account,
  online,
}: {
  port: InventoryPort;
  onRevoked: () => void;
  account: Account;
  online: boolean;
}) {
  const inv = useInventory(port, onRevoked);
  const s = inv.inventory;
  const stateLine = (text: string) => <span data-testid="phase">{text}</span>;

  let body: ReactNode;
  let phase = 'Pristup ili podaci nisu potvrđeni';
  if (inv.openError) {
    body = (
      <GateScreen icon="⚠" title="Inventar nije dostupan" testId="inv-open-error" alert>
        <p>{inv.openError}</p>
      </GateScreen>
    );
  } else if (inv.opening || s.status === 'loading') {
    phase = 'Učitavanje…';
    body = (
      <GateScreen icon="⌛" title="Učitavanje inventara" testId="inv-loading">
        <p className="sub">Čekamo da lokacije, predmeti i smještaji budu potvrđeni sa servera.</p>
        <div className="notice">
          Ne zaključujemo da je struktura oštećena prije učitavanja i provjere sve tri kolekcije.
        </div>
      </GateScreen>
    );
  } else if (s.status === 'error') {
    body = (
      <GateScreen icon="⌛" title="Podaci nisu potvrđeni" testId="inv-error" alert>
        <p className="sub" data-testid="inv-error-text">
          {s.kind === 'offline'
            ? 'Čeka se veza. Inventar nije potvrđen i ne prikazuje se.'
            : 'Inventar nije moguće učitati.'}
        </p>
      </GateScreen>
    );
  } else if (s.status === 'inconsistent') {
    body = (
      <GateScreen icon="⚠" title="Podaci su nedosljedni" testId="inv-inconsistent" alert>
        <p className="sub">
          Nema nijedne lokacije, a postoje predmeti ({s.items}) ili smještaji ({s.placements}).
          Ništa se ne prikazuje i ne mijenja, a priprema kućanstva je isključena.
        </p>
        <div className="notice">
          Obavijesti vlasnika — ovo nije prazno kućanstvo. Ispravak se radi pod nadzorom vlasnika.
        </div>
      </GateScreen>
    );
  } else if (s.status === 'tree-corrupt') {
    body = (
      <GateScreen icon="⚠" title="Struktura lokacija nije ispravna" testId="inv-corrupt" alert>
        <p className="sub">
          Premještanje i prikaz privatnog inventara zaustavljeni su radi sigurnosti podataka (
          {s.problems.length} problema: ciklus, nedostajući roditelj ili krivi korijen).
        </p>
        <div className="notice">
          Popravak nije moguć iz aplikacije: radi se pod nadzorom vlasnika u Firebase Console.
        </div>
      </GateScreen>
    );
  } else if (s.status === 'revoked') {
    body = null; // roditelj je već obaviješten (onRevoked) i uklanja prikaz
  } else {
    phase =
      s.status === 'stale' || !online
        ? 'Veza prekinuta · samo pregled'
        : 'Podaci potvrđeni na serveru';
    body = (
      <Loaded
        key="loaded"
        inv={inv}
        data={s.data}
        stale={s.status === 'stale'}
        needsBootstrap={s.status === 'ready' && s.needsBootstrap}
        account={account}
        online={online}
        phaseLine={stateLine(phase)}
      />
    );
    return body;
  }

  return (
    <>
      <Brand sub={<HeaderLine account={account} phase={stateLine(phase)} />} />
      <StaleAccount account={account} />
      <main id="app" className="appview" tabIndex={-1}>
        {body}
        <AccountCard account={account} />
      </main>
    </>
  );
}

function HeaderLine({ account, phase }: { account: Account; phase: ReactNode }) {
  return (
    <>
      <span data-testid="household-name">{account.householdName ?? '(kućanstvo bez naziva)'}</span>{' '}
      · {phase}
      <br />
      {!account.stale && (
        <span data-testid="verified-at">
          Pristup potvrđen sa servera u {formatTime(account.verifiedAt)}.
        </span>
      )}
    </>
  );
}

function StaleAccount({ account }: { account: Account }) {
  if (!account.stale) return null;
  return (
    <div className="inline-status conflict stale-top" role="alert" data-testid="stale-warning">
      Pristup zadnji put potvrđen u {formatTime(account.verifiedAt)}. Trenutno ga nije moguće
      potvrditi (nema veze s poslužiteljem) pa prikaz može biti zastario. Provjera se ponavlja kad
      se veza vrati.
    </div>
  );
}

function Loaded(props: {
  inv: UseInventory;
  data: InventoryData;
  stale: boolean;
  needsBootstrap: boolean;
  account: Account;
  online: boolean;
  phaseLine: ReactNode;
}) {
  const { inv, data, stale, needsBootstrap, account, online } = props;
  const model = useMemo(() => buildModel(data), [data]);
  const index = useMemo(() => buildSearchIndex(data), [data]);
  const nav = useNavigator((keepStatus) => {
    if (!keepStatus) inv.clearStatus();
  });
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<string[]>([]);
  const [recentDest, setRecentDest] = useState<string[]>([]);

  const unresolved =
    inv.status.kind === 'unknown' && inv.status.resolution !== 'not-applied' ? true : false;
  let readOnlyReason: string | null = null;
  if (stale) readOnlyReason = 'Veza je prekinuta: moguć je samo pregled. Promjene su onemogućene.';
  else if (!online) readOnlyReason = 'Nema interneta: moguć je samo pregled.';
  else if (unresolved) readOnlyReason = 'Najprije provjeri stanje prethodne promjene.';
  const writable = !readOnlyReason && !inv.busy;

  const ctx: AppCtx = {
    data,
    model,
    index,
    inv,
    nav,
    writable,
    readOnlyReason,
    query,
    setQuery,
    recents,
    pushRecent: (id) => setRecents((r) => [id, ...r.filter((x) => x !== id)].slice(0, 5)),
    recentDest,
    pushDest: (id) => setRecentDest((r) => [id, ...r.filter((x) => x !== id)].slice(0, 5)),
  };

  const route = nav.route;
  const tab = tabOf(route);
  // pristupačnost: pri promjeni zaslona fokus ide na glavni sadržaj (čitač zaslona najavljuje novi zaslon)
  useEffect(() => {
    if (nav.depth > 1) document.getElementById('app')?.focus({ preventScroll: true });
  }, [route, nav.depth]);
  let screen: ReactNode;
  if (route.name === 'more') screen = <More account={account} ctxStale={stale} online={online} />;
  else if (needsBootstrap) screen = <Bootstrap />;
  else screen = <RouteView route={route} />;

  const tabs: { id: Tab; icon: string; label: string; route: Route }[] = [
    { id: 'home', icon: '⌂', label: 'Početna', route: { name: 'home' } },
    { id: 'locations', icon: '▤', label: 'Lokacije', route: { name: 'locations' } },
    { id: 'add', icon: '＋', label: 'Dodaj', route: { name: 'add-item' } },
    { id: 'more', icon: '☰', label: 'Više', route: { name: 'more' } },
  ];

  return (
    <AppContext.Provider value={ctx}>
      <div inert={nav.pending ? true : undefined}>
        <Brand
          sub={<HeaderLine account={account} phase={props.phaseLine} />}
          onMore={() => nav.goTab({ name: 'more' })}
        />
        <StaleAccount account={account} />
        <main id="app" className="appview" tabIndex={-1}>
          {stale && (
            <div className="inline-status conflict" role="status" data-testid="inv-stale">
              Veza je prekinuta. Prikazujemo samo posljednje potvrđene podatke iz ove sesije.
              Promjene nisu dostupne.
            </div>
          )}
          {!stale && !online && (
            <div className="inline-status conflict" role="status" data-testid="inv-offline">
              Nema interneta. Moguć je samo pregled; spremanje nije moguće i ne stavlja se u red za
              kasnije.
            </div>
          )}
          <StatusBanner
            status={inv.status}
            hideSaved={stale}
            onCheck={() => void inv.checkUnknown()}
            onClose={inv.clearStatus}
          />
          {screen}
        </main>
        <nav className="bottomnav" aria-label="Glavna navigacija" data-testid="bottom-nav">
          <div className="navinner">
            {tabs.slice(0, 3).map((t) => (
              <NavButton
                key={t.id}
                t={t}
                active={tab === t.id}
                disabled={t.id === 'add' && (needsBootstrap || !writable)}
                nav={nav}
              />
            ))}
            <button
              type="button"
              className="navbtn"
              disabled
              aria-label="Popis kupnje, u pripremi"
              title="U pripremi"
            >
              <span className="navicon" aria-hidden="true">
                🛒
              </span>
              <span>Popis · uskoro</span>
            </button>
            <NavButton t={tabs[3]!} active={tab === 'more'} disabled={false} nav={nav} />
          </div>
        </nav>
      </div>
      {nav.pending && <UnsavedDialog saving={nav.saving} onChoose={(w) => void nav.choose(w)} />}
    </AppContext.Provider>
  );
}

function NavButton({
  t,
  active,
  disabled,
  nav,
}: {
  t: { id: Tab; icon: string; label: string; route: Route };
  active: boolean;
  disabled: boolean;
  nav: ReturnType<typeof useNavigator>;
}) {
  return (
    <button
      type="button"
      className={`navbtn ${active ? 'active' : ''} ${t.id === 'add' ? 'add' : ''}`}
      aria-current={active ? 'page' : undefined}
      aria-label={t.id === 'add' ? 'Dodaj predmet' : undefined}
      disabled={disabled}
      title={disabled && t.id === 'add' ? 'Najprije pripremi kućanstvo' : undefined}
      data-testid={`tab-${t.id}`}
      onClick={() => (t.id === 'add' ? nav.go(t.route) : nav.goTab(t.route))}
    >
      <span className="navicon" aria-hidden="true">
        {t.icon}
      </span>
      <span>{t.label}</span>
    </button>
  );
}

function RouteView({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <Home />;
    case 'locations':
      return <Locations />;
    case 'location':
      return <LocationDetail key={route.id} id={route.id} />;
    case 'item':
      return <ItemDetail key={route.id} id={route.id} />;
    case 'add-item':
      return <ItemCreate locationId={route.locationId} />;
    case 'edit-item':
      return <ItemEdit key={route.id} id={route.id} />;
    case 'move-item':
      return <MoveItem key={route.id} id={route.id} />;
    case 'add-location':
      return <LocationCreate parentId={route.parentId} />;
    case 'edit-location':
      return <LocationEdit key={route.id} id={route.id} />;
    case 'move-location':
      return <MoveLocation key={route.id} id={route.id} />;
    case 'add-placement':
      return <AddPlacement key={route.id} id={route.id} />;
    case 'more':
      return null;
  }
}

function Bootstrap() {
  const { inv, writable } = useApp();
  return (
    <>
      <section className="authscreen" data-testid="bootstrap">
        <div className="authicon" aria-hidden="true">
          🏡
        </div>
        <h1>Počinjemo od prazne kuće</h1>
        <p className="sub">
          Kućanstvo još nije pripremljeno. Izričito potvrdi početak; stvorit ćemo samo početnu
          lokaciju „Kuća”, bez izmišljenih prostorija i predmeta.
        </p>
        <button
          type="button"
          className="btn primary"
          disabled={!writable}
          onClick={() => void inv.run('Priprema kućanstva', (r) => r.bootstrap())}
        >
          Pripremi kućanstvo
        </button>
      </section>
    </>
  );
}
function More({
  account,
  ctxStale,
  online,
}: {
  account: Account;
  ctxStale: boolean;
  online: boolean;
}) {
  const { model, data } = useApp();
  return (
    <>
      <ScreenHead title="Više" />
      <AccountCard account={account} />
      <div className="card">
        <h2 className="h3">Veza i podaci</h2>
        <p className="account-line">
          Veza: {online ? 'dostupna' : 'nema interneta'} · Prikaz:{' '}
          {ctxStale ? 'zadnje potvrđeno stanje (samo pregled)' : 'potvrđeno na serveru'}
        </p>
        <p className="account-line">
          {model.locs.size} lokacija · {model.items.size} predmeta ·{' '}
          {data.placements.filter((p) => !p.archived).length} smještaja
        </p>
        <div className="muted-note">
          Inventar se čuva samo u memoriji dok je potvrđena sesija aktivna. Promjene se spremaju
          isključivo online; nema offline reda ni automatskog naknadnog slanja.
        </div>
      </div>
      <div className="card">
        <h2 className="h3">Uskoro</h2>
        <p className="sub">Popis kupnje, skeniranje i fotografije nisu dio ove verzije.</p>
      </div>
    </>
  );
}

/** Račun, provjera pristupa i odjava — dostupni i dok inventar nije potvrđen (učitavanje, greška, oštećeno stablo). */
function AccountCard({ account }: { account: Account }) {
  return (
    <div className="card" data-testid="account-card">
      <h2 className="h3">Račun i pristup</h2>
      {account.displayName && <p className="account-line">Prijavljen/a: {account.displayName}</p>}
      <p className="account-line">
        Kućanstvo: {account.householdName ?? '(dokument kućanstva nema naziv)'}
      </p>
      <p className="account-line">
        {account.stale
          ? `Pristup zadnji put potvrđen u ${formatTime(account.verifiedAt)}; trenutno ga nije moguće potvrditi.`
          : `Pristup potvrđen sa servera u ${formatTime(account.verifiedAt)}.`}
      </p>
      {account.signOutFailed && <p role="alert">Odjava nije uspjela. Pokušaj ponovno.</p>}
      <div className="buttonrow">
        <button type="button" className="btn secondary" onClick={account.onRecheck}>
          Provjeri pristup
        </button>
        <button type="button" className="btn coralbtn" onClick={account.onSignOut}>
          Odjava
        </button>
      </div>
    </div>
  );
}
