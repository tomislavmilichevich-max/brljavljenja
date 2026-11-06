# P1_TEST_REPORT — Firebase prijava i Firestore ACL (rev. 2: korekcije P1-REV-01/02)

Datum: 2026-11-06 · Grana: `p1/auth-household-rules` · Okruženje: Claude Code cloud (Linux, Node 22.23.4, Java 21.0.12, Chromium/Playwright)
Statusi: **PASS** = stvarno izvršeno s izlazom ispod · **NOT VERIFIED** = nije provjereno · **BLOCKED** = nemoguće u ovom okruženju.

## Sažetak

| Kriterij (P1_ACCEPTANCE gates)                                                       | Status                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run check` (typecheck, lint, 67 Vitest, build)                                  | **PASS**                                                                                                                                                                                                                                                                                               |
| `npm run check:no-actions`                                                           | **PASS**                                                                                                                                                                                                                                                                                               |
| Firestore Rules: 36 testova u emulatoru (svih ACL-01…ACL-20 + dodatni)               | **PASS**                                                                                                                                                                                                                                                                                               |
| Testovi hvataju kvar (mutacije pravila i klijenta)                                   | **PASS** (M1 5, M2 6, M3 1, M4 4 pada)                                                                                                                                                                                                                                                                 |
| E2E s pravim SDK-om i emulatorima (Auth+Firestore): 14 koraka                        | **PASS 14/14**                                                                                                                                                                                                                                                                                         |
| P0 regresija: SW kontrolira, offline reload `/` i duboka ruta, bez konzolnih grešaka | **PASS**                                                                                                                                                                                                                                                                                               |
| Pregled službene Firebase dokumentacije / Spark kvote                                | **NOT VERIFIED u sandboxu** (`firebase.google.com` nije dopuštena domena). Glavni razvoj je kvote provjerio izvan sandboxa (Firestore Standard Free: 1 GiB, 50.000 čitanja, 20.000 upisa i 20.000 brisanja dnevno, jedna besplatna baza) — preuzeto iz njegova komentara na PR #2, ne iz moje provjere |
| Pravi Google popup/redirect (apis.google.com)                                        | **BLOCKED** u sandboxu; **NOT VERIFIED**                                                                                                                                                                                                                                                               |
| Prijava na Androidu / instalirana PWA / dva fizička uređaja                          | **NOT VERIFIED**                                                                                                                                                                                                                                                                                       |
| Produkcijski projekt, deploy pravila                                                 | **NOT STARTED** (nije odobreno)                                                                                                                                                                                                                                                                        |

P1 status: **PARTIAL** — kod i automatski dokazi gotovi; ručni dio (stvarni Google login na objavljenoj domeni, dva Androida) čeka vlasnika i P5 hosting.

## Korekcije nakon pregleda glavnog razvoja (komentar na PR #2)

| ID         | Zahtjev                                                                                         | Rješenje                                                                                                                                                                                                                                       | Dokaz                                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| P1-REV-01  | `checkAccess()` ne smije vratiti `member` ako household dokument ne postoji                     | Odluka izdvojena u `evaluateAccess` (`src/auth/access.ts`): `exists()==false` → `error/household-missing`, UI poruka bez „Pristup odobren“                                                                                                     | Unit regresija (`access.test.ts`), App test, test pravila (član dobiva `exists()==false`), **E2E-13** s pravim SDK-om |
| P1-REV-02  | Opoziv tijekom otvorene sesije ne smije trajno ostati na „Pristup odobren“, bez skupog pollinga | Revalidacija u `useSession`: povratak u prvi plan (prag 15 s), `online` (odmah), timer 10 min samo dok je vidljivo, ručni gumb. `permission-denied` → „Nemaš pristup“; offline → ostaje, ali označeno **nepotvrđeno** (vrijeme zadnje potvrde) | 12 App testova + 6 reducer testova; **E2E-11** (offline, nepotvrđeno) i **E2E-12** (opoziv bez reloada)               |
| P2/P3 gate | Online provjera ne smije trajno onemogućiti lokalnu offline pretragu                            | Samo zabilježeno u `docs/ARCHITECTURE.md` i `SECURITY.md`; **nije implementirano**                                                                                                                                                             | —                                                                                                                     |

Poznato ograničenje: nema push opoziva; neprekidno vidljiva online aplikacija uočit će opoziv najkasnije nakon ≈10 min (ili pri povratku u prvi plan/ručno). Realtime listener nije korišten (Rules ne jamče ponovnu provjeru `get()` uvjeta za otvorene listenere).
Napomena o timeru: 10-min timer je moja procjena kako ispuniti „ne smije trajno ostati“ bez pollinga; konstante `REVALIDATE_*` u `useSession.ts` lako je promijeniti ili timer ukloniti ako ga glavni razvoj ne želi (≤ 6 čitanja/h po aktivnom uređaju).

## Naredbe i izlazi (rev. 2)

```
typecheck OK
lint OK
Test Files 7 passed (7) / Tests 67 passed (67)
build: dist/assets/index-Bum7dsTk.js 770.60 kB (gzip 235.31 kB)   ✓ built
OK: nema .github/workflows.
npm run test:rules -> Test Files 1 passed (1) / Tests 36 passed (36) / Script exited successfully (code 0)
npm run test:e2e   -> E2E: 14/14 PASS (E2E-1…14, detalji ispod)
P0 regresija (Chromium, vite preview): SW kontrolira, 8 datoteka u cacheu, offline `/` i `/neka/ruta` prikazuju UI, errors: []
```

Početno stanje prije P1 (P0 na `main`): 14/14 Vitest, build PASS, no-actions PASS.
Mutacije (privremeno, vraćeno): M3 `evaluateAccess` ignorira `exists` → 1 pad (regresija REV-01); M4 revalidacija ignorira opoziv → 4 pada. Nakon vraćanja 67/67.

## Matrica ACL (emulator, stvarni `firestore.rules`)

ACL-01…ACL-20 svi PASS (36 testova), uz dodatne (uključujući nepostojeći household kod postojećeg članstva — `exists()==false`): GET vlastitog membershipa onemogućenog člana (DENY), membership u tuđem household-u (DENY), batch brisanje članstva+household (DENY), CREATE novog household-a (DENY), collection-group upit na `members` (DENY), `enabled` kao string „true“ (DENY), membership bez `enabled` (DENY), opoziv brisanjem dokumenta (DENY), nepoznate putanje (DENY).
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

E2E (E2E-1…14): prijava lažnim Google računom u **Auth emulator**, nečlan, ručno odobrenje (Admin zapis kao Console), reload, odjava, drugi račun na istom uređaju, opoziv `enabled:false`, offline provjera, povratak mreže, offline revalidacija (nepotvrđeno), opoziv tijekom otvorene sesije bez reloada, članstvo bez household dokumenta.
**Ograničenje E2E-a:** koristi se emulatorska kuka (`__e2eSignInWithEmulatorAccount`, samo uz `DEV` + `VITE_USE_EMULATORS=true`), ne pravi Google popup. Kuke nema u produkcijskom bundleu (0 podudaranja).

## Greške nađene i ispravljene tijekom P1 (uključujući korekcije pregleda)

1. **Offline `getDoc` iz keša** prikazao bi „Pristup odobren“ bez poslužitelja (i za opozvanog člana te drugi račun nakon odjave). E2E-9 je pao, ispravljeno u `getDocFromServer`, sada PASS.
2. **`await setPersistence` prije `signInWithPopup`** gubio je korisnikov dodir pa se popup ne bi otvarao; uklonjeno.
3. SW: dodan izuzetak za `/__/*` (Firebase Auth redirect/iframe putanje).
4. **P1-REV-01:** nepostojeći household davao je „Pristup odobren“ — ispravljeno + regresija.
5. **P1-REV-02:** opozvani član ostajao je na „Pristup odobren“ do reloada — ispravljeno revalidacijom + testovi.

## Sigurnosni nalazi i rizici

- **`npm audit` odvojeno (verzije na ovoj grani):**
  - **Produkcijske ovisnosti (`npm audit --omit=dev`): 4 high, 0 moderate/low/critical.** Sva četiri su isti lanac: `firebase` → `@firebase/firestore`(+`-compat`) → `@grpc/grpc-js@1.9.16` (zahvaćeno `<1.13.6`: GHSA-m9gg-hp2v-232j „getAuthContext vraća neovlaštene certifikate“, high; GHSA-f596-whhp-79r4 poruke grešaka, low). `@firebase/firestore` fiksira `@grpc/grpc-js ~1.9`, pa ažuriranje traži novu verziju Firebasea. Predloženi „fix“ alata je `firebase@9.14.0` (major **downgrade**) — **nije primijenjen**. Procjena: gRPC se koristi u Node ulazu paketa, a ne u browseru; produkcijski bundle ne sadrži `@grpc/grpc-js` (`grep` = 0; riječ `grpcFlowControlWindow` je samo naziv Firestore opcije). Rizik za PWA nizak, ali **nalaz je otvoren**; pratiti nove verzije Firebasea.
  - **Samo razvojne ovisnosti (24 paketa, 23 moderate + 1 high):** `firebase-tools` lanac (`@opentelemetry/core`, `glob`, `minimatch`, `uuid`…; ReDoS/ograničenja u alatima), `@firebase/rules-unit-testing` → `firebase` (isti `grpc-js` lanac, high) i ranije poznati `minimatch` u lintu. Ne ulaze u build; pokreću se samo lokalno. `npm audit fix` (bez force) ne rješava ništa; `--force` nije pokretan.
  - Ukupno: 28 (23 moderate, 5 high) = 4 produkcijska high + 24 samo-dev (23 moderate + 1 high).
- Cache među računima na istom uređaju: za P1 nema podataka u cacheu koje UI čita, za P2 je obvezno rješenje (ARCHITECTURE).
- Bundle 235 kB gzip.
- Google popup u instaliranoj Android PWA može zakazati; fallback na redirect postoji, ali **nije testiran**. Preporuka: `authDomain` = domena aplikacije na Firebase Hostingu (ovisi o službenim smjernicama koje ovdje nisam mogao pročitati).
- `members.get` samo za vlastiti UID znači da onemogućeni član i nepostojeći član vide isto „Nemaš pristup“ (namjerno).

## Promijenjene datoteke (sažetak)

`firestore.rules`, `rules-tests/*`, `vitest.rules.config.ts`, `src/firebase/client.ts`, `src/auth/*` (+`access.ts`, reducer, hook), `src/app/{App,screens}.tsx` + testovi, `src/pwa/sw.template.js`, `scripts/e2e-emulator.cjs`, `package.json`/lock (firebase 13.2.0; dev: firebase-tools 15.35.0, @firebase/rules-unit-testing 6.0.0), `.env.example`, `eslint.config.js`, docs.
Nema `.github/workflows`, nema tajni, nema deploya, nema Blaze/Functions/Storage.

## Ručno za vlasnika (NOT VERIFIED dok se ne obavi)

Vidi `docs/OWNER_ACTIONS.md` (koraci 1–11). Test: dva Google računa na dva Androida na objavljenoj domeni; instalirana PWA; opoziv člana.
