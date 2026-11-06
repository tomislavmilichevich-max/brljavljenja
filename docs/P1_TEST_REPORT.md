# P1_TEST_REPORT — Firebase prijava i Firestore ACL

Datum: 2026-11-06 · Grana: `p1/auth-household-rules` · Okruženje: Claude Code cloud (Linux, Node 22.23.4, Java 21.0.12, Chromium/Playwright)
Statusi: **PASS** = stvarno izvršeno s izlazom ispod · **NOT VERIFIED** = nije provjereno · **BLOCKED** = nemoguće u ovom okruženju.

## Sažetak

| Kriterij (P1_ACCEPTANCE gates)                                                       | Status                                                                     |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `npm run check` (typecheck, lint, 45 Vitest, build)                                  | **PASS**                                                                   |
| `npm run check:no-actions`                                                           | **PASS**                                                                   |
| Firestore Rules: 35 testova u emulatoru (svih ACL-01…ACL-20 + dodatni)               | **PASS**                                                                   |
| Testovi hvataju kvar (mutacije pravila)                                              | **PASS** (M1 5 pada, M2 6 padova)                                          |
| E2E s pravim SDK-om i emulatorima (Auth+Firestore): 11 koraka                        | **PASS 11/11**                                                             |
| P0 regresija: SW kontrolira, offline reload `/` i duboka ruta, bez konzolnih grešaka | **PASS**                                                                   |
| Pregled službene Firebase dokumentacije / Spark kvote                                | **NOT VERIFIED** — `firebase.google.com` nije u dopuštenim domenama sesije |
| Pravi Google popup/redirect (apis.google.com)                                        | **BLOCKED** u sandboxu; **NOT VERIFIED**                                   |
| Prijava na Androidu / instalirana PWA / dva fizička uređaja                          | **NOT VERIFIED**                                                           |
| Produkcijski projekt, deploy pravila                                                 | **NOT STARTED** (nije odobreno)                                            |

P1 status: **PARTIAL** — kod i automatski dokazi gotovi; ručni dio (stvarni Google login na objavljenoj domeni, dva Androida) čeka vlasnika i P5 hosting.

## Naredbe i izlazi

```
typecheck OK
lint OK
Test Files 6 passed (6) / Tests 45 passed (45)
build: dist/assets/index-C_ssTrnT.js 768.51 kB (gzip 234.78 kB)   ✓ built
OK: nema .github/workflows.
npm run test:rules   -> Test Files 1 passed (1) / Tests 35 passed (35) / Script exited successfully (code 0)
npm run test:e2e     -> E2E: 11/11 PASS
```

Početno stanje prije promjena (P0 na `main`): 14/14 Vitest, build PASS, no-actions PASS.

## Matrica ACL (emulator, stvarni `firestore.rules`)

ACL-01…ACL-20 svi PASS, uz dodatne: GET vlastitog membershipa onemogućenog člana (DENY), membership u tuđem household-u (DENY), batch brisanje članstva+household (DENY), CREATE novog household-a (DENY), collection-group upit na `members` (DENY), `enabled` kao string „true“ (DENY), membership bez `enabled` (DENY), opoziv brisanjem dokumenta (DENY), nepoznate putanje (DENY).
Testovi učitavaju `firestore.rules` izravno iz datoteke; UID-ovi su sintetski; projekt `demo-*`.

**Provjera da testovi nisu trivijalni** (privremena mutacija pravila, zatim vraćeno): (M1) ignoriranje `enabled` → 5 testova pada (ACL-04, ACL-19/20, dva „enabled“ rubna, onemogućeni membership); (M2) `allow get, write` na members → 6+ padova (ACL-08, 13, 14a/b/c, 15). Originalna pravila: 35/35.

## Aplikacijski testovi (APP-xx)

| ID                               | Rezultat          | Dokaz                                                                                    |
| -------------------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| APP-01 nema konfiguracije        | PASS              | Vitest (App.test)                                                                        |
| APP-02 nečlan                    | PASS              | Vitest + E2E-2/3 (stvarna pravila)                                                       |
| APP-03 član                      | PASS              | Vitest + E2E-4/5                                                                         |
| APP-04 odjava                    | PASS              | Vitest + E2E-6 (naziv nije u DOM-u)                                                      |
| APP-05 greška/offline            | PASS              | Vitest + E2E-9/10                                                                        |
| APP-06 kopiranje vlastitog UID-a | PASS              | Vitest; u Chromiumu je UID u polju, kopiranje s API-jem clipboard samo u Vitestu         |
| APP-07 PWA ljuska offline        | PASS              | `pwa-check` u Chromiumu (SW kontrolira, 8 datoteka u cacheu, offline `/` i `/neka/ruta`) |
| APP-08 konzola/build bez tokena  | PASS (ograničeno) | nema `pageerror` u E2E; pretraga `dist` za `AIza                                         | private_key | client_secret` = 0 |

E2E (E2E-1…11): prijava lažnim Google računom u **Auth emulator**, nečlan, ručno odobrenje (Admin zapis kao Console), reload, odjava, drugi račun na istom uređaju, opoziv `enabled:false`, offline provjera, povratak mreže.
**Ograničenje E2E-a:** koristi se emulatorska kuka (`__e2eSignInWithEmulatorAccount`, samo uz `DEV` + `VITE_USE_EMULATORS=true`), ne pravi Google popup. Kuke nema u produkcijskom bundleu (0 podudaranja).

## Greške nađene i ispravljene tijekom P1

1. **Offline `getDoc` iz keša** prikazao bi „Pristup odobren“ bez poslužitelja (i za opozvanog člana te drugi račun nakon odjave). E2E-9 je pao, ispravljeno u `getDocFromServer`, sada PASS.
2. **`await setPersistence` prije `signInWithPopup`** gubio je korisnikov dodir pa se popup ne bi otvarao; uklonjeno.
3. SW: dodan izuzetak za `/__/*` (Firebase Auth redirect/iframe putanje).

## Sigurnosni nalazi i rizici

- `npm audit`: 28 nalaza (23 umjerena, 5 visokih). Visoki: `@grpc/grpc-js` preko `firebase`/`@firebase/firestore` i `firebase-tools`. Pretraga produkcijskog bundlea za `grpc` = 0 (browser koristi WebChannel); ostaje u Node strani paketa i dev alatu. Rizik za PWA nizak, ali **nije riješen**; pratiti verzije Firebasea. `npm audit fix --force` nije pokretan (rušio bi verzije).
- Cache među računima na istom uređaju: za P1 nema podataka u cacheu koje UI čita, za P2 je obvezno rješenje (ARCHITECTURE).
- Bundle 235 kB gzip.
- Google popup u instaliranoj Android PWA može zakazati; fallback na redirect postoji, ali **nije testiran**. Preporuka: `authDomain` = domena aplikacije na Firebase Hostingu (ovisi o službenim smjernicama koje ovdje nisam mogao pročitati).
- `members.get` samo za vlastiti UID znači da onemogućeni član i nepostojeći član vide isto „Nemaš pristup“ (namjerno).

## Promijenjene datoteke (sažetak)

`firestore.rules`, `rules-tests/*`, `vitest.rules.config.ts`, `src/firebase/client.ts`, `src/auth/*`, `src/app/{App,screens}.tsx` + test, `src/pwa/sw.template.js`, `scripts/e2e-emulator.cjs`, `package.json`/lock (firebase 13.2.0; dev: firebase-tools 15.35.0, @firebase/rules-unit-testing 6.0.0), `.env.example`, `eslint.config.js`, docs.
Nema `.github/workflows`, nema tajni, nema deploya, nema Blaze/Functions/Storage.

## Ručno za vlasnika (NOT VERIFIED dok se ne obavi)

Vidi `docs/OWNER_ACTIONS.md` (koraci 1–11). Test: dva Google računa na dva Androida na objavljenoj domeni; instalirana PWA; opoziv člana.
