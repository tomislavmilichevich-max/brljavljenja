# Handoff za Claude Code — P1: Firebase prijava i sigurnost

Verzija: **P1-HO-01**, 2026-11-06. Status: **SPREMNO ZA IMPLEMENTACIJU NAKON ODOBRENJA PR-a**.
Aktivni repozitorij: `tomislavmilichevich-max/home-inventory-pwa` (Private), baza: `main`.
Prvo pročitati: `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/OWNER_ACTIONS.md`, `docs/UI_UX_DECISIONS_V0.1.md`, `docs/P1_ACCEPTANCE.md`.

## P1 cilj (ograničeni tehnički pilot)

Dokazati da PWA može koristiti **Firebase Authentication s Google prijavom**, da pristup **jednom kućanstvu** imaju isključivo **dva ručno odobrena UID-a**, te da Firestore Security Rules odbijaju sve ostale — bez javnog pristupa i bez bilo kakvog plaćenog resursa.

**P1 ne implementira pravi inventar, pretragu, premještanje, offline red konflikata, Drive, NFC, barcode, shopping listu, niti konačan Organized Cozy dizajn.** To su P2–P5 / UI/UX faze.

## Tvrda pravila

- Isključivo Firebase **Spark**, bez kartice/Blaze, Cloud Functions, Firebase Storage, App Hosting, plaćenih proizvoda ili dodatnog backenda.
- Nema GitHub Actions; lokalno/Claude Code testiranje.
- Sva Firestore pravila **deny by default**. Nema širokih `allow read, write: if true`.
- Samo Firebase Auth UID + dokument članstva daje autorizaciju. Frontend e-mail, korisnički podatak ili poznat `householdId` **nisu sigurnosna kontrola**.
- Membership dokumente dodaje samo vlasnik kroz Firebase Console. Klijent ih ne kreira, ne mijenja i ne briše.
- Rad na zasebnoj grani iz `main`, nakon dokumentacijskog PR-a. P1 ne smije mijenjati vizualni dizajn niti prelaziti u P2.
- Nema stvarnih fotografija, privatnih ključeva, tokena ili stvarnih inventarnih podataka u repozitoriju.

## P1 obvezni isporučivi dijelovi

### P1.1 — Preduvjeti, plan i validacija okruženja

- Pregledati aktualne Firebase službene dokumente: Spark kvote, Auth Google provider, redirect best practices, Firestore rules i emulator.
- Potvrditi kompatibilan Firebase JS SDK, Node i Java za Firestore emulator.
- Definirati **jedan** Firebase projekt i jednu besplatnu Firestore bazu. Ako projekt ne postoji, kod pripremiti s `.env.example` i `OWNER_ACTIONS.md`, ne izmišljati konfiguraciju.
- Izvršiti lint, typecheck i testove postojećeg P0 prije promjena. Evidentirati početno stanje.
- Ne kreirati/objavljivati produkcijski projekt ili pravila bez korisnikova izričitog odobrenja.

### P1.2 — Autentikacija i minimalni ekran

- Instalirati/pinati Firebase JS SDK uz zaključani `package-lock.json`; postojeći P0 stack zadržati.
- Inicijalizacija iz `VITE_*` konfiguracije, s jasnom porukom kada konfiguracija nedostaje.
- Minimalna stanja sučelja: **prijava**, **provjera pristupa**, **odobren pristup kućanstvu**, **nemaš pristup**, **greška/mreža**, **odjava**.
- Sigurno razlikovati uspješno Google sign-in od odobrenog člana kućanstva.
- Privremeni neutralni UI; bez konačnih inventarnih zaslona.
- Na „Nemaš pristup“ omogućiti korisniku da kopira **vlastiti Firebase UID** za ručni bootstrap (UID nije tajna), uz kratku uputu; ne prikazivati članove ili privatne podatke.
- Odjava mora skloniti privatne podatke sa zaslona i prekinuti pristup za aktivnu sesiju.
- Google sign-in u Android PWA: ne pretpostaviti da će `signInWithPopup` ili `signInWithRedirect` raditi na svakom originu. Na Firebase Hosting `*.firebaseapp.com` domeni slijediti službene smjernice; za `*.web.app`/druge domene razmotriti `authDomain` i autorizirane redirect URL-ove. Stvarni Android test ostaje posebna prihvatna provjera i može zahtijevati kasniji P5 deploy.

### P1.3 — Firestore ACL (bez funkcionalnih inventarnih upisa)

```text
households/{h}
households/{h}/members/{uid}
```

- Aktivni član = prijavljen korisnik za kojeg postoji `members/{request.auth.uid}` s `enabled == true`.
- Samo aktivni član smije **get** dokument `households/{h}`. `list` kućanstava i klijentski write su zabranjeni.
- Svaki aktivni član smije **get samo vlastiti** `members/{uid}`; `list` članova, čitanje tuđih membership dokumenata i **svi write** zabranjeni.
- Neodobreni ili `enabled:false` račun ne može dohvatiti sadržaj kućanstva.
- `locations`, `items`, `placements`, `appliedOps` i ostale putanje ostaju **deny all** u P1. P2 uvodi validiranu upisnu politiku nakon usuglašavanja sheme.
- Pravila mora nametati Firestore backend, ne samo React komponente.
- Koristiti službeni API `get()/exists()` unutar Rules s ispravnim punim putanjama. Izbjegavati neograničene kolekcijske upite (Rules nisu filter).

### P1.4 — Bootstrap i rukovanje dvama korisnicima

- Nema self-signup u kućanstvo; bilo koji Google račun može se autentificirati, ali pristup nema dok ga vlasnik **ručno** ne uključi u Firestore membership.
- Vlasnik kreira household i dva membership dokumenta u Firebase Console prema detaljnom vodiču (bez slanja UID-ova u chat).
- UI mora konzistentno prikazivati neodobreni status prije i nakon ručnog odobrenja. Ponovnim dohvatom/obnavljanjem statusa korisnik dobiva pristup.
- Osnovne promjene članstva (ukidanje `enabled`) moraju se pouzdano odraziti pri sljedećoj provjeri; u P1 testirati reauth i onemogućavanje pristupa kroz Rules.

### P1.5 — Testiranje i evidencija

- Koristiti Firebase Emulator Suite + `@firebase/rules-unit-testing`, s eksplicitnim učitavanjem `firestore.rules`.
- Najmanje svi testovi iz `docs/P1_ACCEPTANCE.md`; izolirani testni projekt i sintetski UID-ovi, bez stvarnih podataka.
- Emulator testove i postojeći `npm run check`, `npm run check:no-actions` provesti u Claude Code okruženju.
- Ako Java ili emulator nisu dostupni: dokumentirati **BLOCKED**, ponuditi minimalne korake za nastavak. **Ne** označiti P1 PASS niti deployati pravila.
- Test Android prijave i instalirane PWA prijaviti kao **NOT VERIFIED** dok korisnik stvarno ne provede provjeru.
- Provjeriti da nema novih workflowa, tajni, otvorenih Firestore prava, nepotrebnih ovisnosti i plaćenih servisa.
- Dodati `docs/P1_TEST_REPORT.md`: ostvareno, naredbe i izlazi, pozitivni/negativni testovi, nedostaci, preduvjeti za vlasnika.

## Posebne opasnosti

1. **Session ≠ članstvo.** Google login nije dozvola za kućanstvo.
2. **Security Rules nisu query filter.** Ne čitati kolekciju kućanstava i očekivati filtriranje po članstvu.
3. **Promjena računâ / keš.** Nikada ne pokazivati prethodne privatne podatke nakon odjave ili prijave trećeg korisnika.
4. **Redirect PWA.** Dokumentirati točnu domenu i rezultat stvarnog testa, ne samo uspješan test u desktop Chromiumu.
5. **Offline konflikt** (P3). Ne implementirati naivni autosync „last write wins“ kao konačno rješenje za lokacije.
6. **GitHub Actions** ostaju isključene čak i ako je novi repozitorij privatan.

## Završetak P1

- Grana/PR s implementacijom i svim dokazima.
- Nema automatskog mergea u `main` bez vlasnikova odobrenja.
- P1 = **dovršeno u kodu** samo ako autentikacija, autorizacija, sve Rules testove i lokalna provjera prođu.
- Test s dvama fizičkim Androidima/produkcijskim projektom = zaseban dio, status **NOT VERIFIED** dok se stvarno ne izvrši.
- Ako potrebne provjere nisu prošle, status **PARTIAL / BLOCKED**, s konkretnim popisom prepreka.
- Zaustaviti se nakon P1, bez P2.

Službeni izvori:
- https://firebase.google.com/docs/auth/web/google-signin
- https://firebase.google.com/docs/auth/web/redirect-best-practices
- https://firebase.google.com/docs/firestore/security/rules-conditions
- https://firebase.google.com/docs/firestore/security/test-rules-emulator
- https://firebase.google.com/docs/firestore/quotas
- https://firebase.google.com/docs/firestore/manage-data/transactions
