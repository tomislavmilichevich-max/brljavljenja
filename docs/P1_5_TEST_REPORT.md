# P1_5_TEST_REPORT — priprema za Firebase Hosting + Android pilot

Datum: 2026-11-06 · Grana: `p1-5/firebase-hosting-readiness` (iz `main` @ 95f2e0d) · Okruženje: Claude Code cloud (Linux, Node 22.23.4, Java 21, firebase-tools 15.35.0, Chromium/Playwright)
Statusi: **PASS** = izvršeno s izlazom ispod · **BLOCKED** = nemoguće bez radnje vlasnika · **NOT STARTED** · **NOT VERIFIED** = nije provjereno.

**Ukupni status P1.5: PRIPREMLJENO, OBJAVA BLOCKED.** Ništa nije objavljeno. Stvarni Google login i Android testovi nisu provedeni.

## Sažetak

| Stavka                                                                                                                                                                             | Status                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Baseline na `main` prije izmjena: `check` (67 Vitest, build), `check:no-actions`, `test:rules` 36/36, `test:e2e` 14/14                                                             | **PASS**                                                                                                                 |
| Nakon izmjena: 82 Vitest (8 datoteka), build, lint, typecheck, `check:no-actions`, rules 36/36, E2E 14/14                                                                          | **PASS**                                                                                                                 |
| `guard:rules` (bez `if true`, bez klijentskog write-a, bez wildcarda) na stvarnom `firestore.rules`                                                                                | **PASS**                                                                                                                 |
| `guard:env`/`guard:dist` odbijaju: emulatore, krivi projekt/authDomain/household, placeholder ključ, nedopuštene datoteke, razvojne tragove u bundleu                              | **PASS** (unit testovi + ručno)                                                                                          |
| Probni produkcijski build sa sintetskim vrijednostima: bez emulatorske kuke, bez `127.0.0.1:9099`, 9 datoteka                                                                      | **PASS**                                                                                                                 |
| `firebase.json` u Hosting emulatoru: SPA rewrite, `no-cache` za `/`, `sw.js`, manifest; `immutable` za `assets/*`; SW kontrolira; offline ljuska prikazuje prijavu; bez JS grešaka | **PASS**                                                                                                                 |
| Firebase CLI autorizacija u cloud okruženju (`firebase login:list`)                                                                                                                | **BLOCKED** — „No authorized accounts“; legitimni owner tok dokumentiran (Cloud Shell, `docs/OWNER_ACTIONS.md` P1.5 A–C) |
| Deploy produkcijskih pravila                                                                                                                                                       | **NOT STARTED** (traži odobrenje + autorizaciju)                                                                         |
| Deploy Hostinga                                                                                                                                                                    | **NOT STARTED** (isto)                                                                                                   |
| Dohvat `https://home-inventory-pwa-218be.firebaseapp.com`                                                                                                                          | **NOT VERIFIED** — još ne postoji (`curl` → nema odgovora, očekivano prije deploya)                                      |
| Stanje projekta u Console (Spark, Google provider, `(default)` baza, deny-all pravila, `households/kuca1`)                                                                         | **NOT VERIFIED** — nemam pristup Console; oslanjam se na vlasnikov izvještaj                                             |
| Stvarni Google login, A/B članstvo, treći račun, opoziv, PWA instalacija, offline ljuska, povratak iz Google prozora na Androidu                                                   | **NOT VERIFIED** (traži objavu i vlasnika)                                                                               |
| Spark/Usage provjera u Console                                                                                                                                                     | **NOT VERIFIED**                                                                                                         |

## Što je izmijenjeno (bez P2)

- `scripts/prod-guard.mjs`, `scripts/prod-guard-cli.mjs`, `scripts/prod-guard.test.ts`: zaštitne provjere (čiste funkcije, 15 testova).
- `package.json`: `guard:env|dist|rules`, `build:prod`, `deploy:rules`, `deploy:hosting` — fiksni `--project home-inventory-pwa-218be`, uvijek `--only`. Nema generičkog `firebase deploy`.
- `firebase.json`: dodano pravilo `no-cache` za `/` (korijen nije bio pokriven pravilom za `/index.html`).
- `docs/OWNER_ACTIONS.md` (P1.5 A–C), `README.md`, ovaj izvještaj. `CLAUDE.md` nisam mijenjao (vlasnikov dokument).
- Nema novih ovisnosti, nema `.github/workflows`, nema tajni; `.env.production.local` je pokriven `.gitignore` obrascem `.env.*`.

## Nalazi

1. **Cache korijena:** bez `no-cache` za `/` Hosting bi mogao posluživati `index.html` do sat vremena predmemoriran i pokazivati na zamijenjene hashirane datoteke. Ispravljeno i provjereno u emulatoru. _Ostaje:_ duboke rute (npr. `/neka/ruta`) idu kroz SPA rewrite bez `no-cache`; aplikacija ih ne koristi, a SW poslužuje navigaciju mrežom prije predmemorije. Ponašanje pravog Hostinga za rewrite zaglavlja nisam mogao provjeriti (samo emulator).
2. **Auth redirect putanje:** SW izuzima `/__/*` (dodano u P1); na pravom Hostingu `/__/auth/*` poslužuje Firebase prije rewritea. **NOT VERIFIED** dok se ne objavi.
3. **Autorizirane domene i `authDomain`:** `guard:env` traži točno `home-inventory-pwa-218be.firebaseapp.com`. Ako Console pokaže drugu domenu, treba stati i provjeriti službenu dokumentaciju (nisam je mogao dohvatiti u sandboxu).
4. **Otvoreno iz P1:** 4 high produkcijska `npm audit` nalaza (`@grpc/grpc-js` lanac, nije u bundleu) i dalje otvoreno; nije mijenjano.
5. **Bundle** ≈ 235 kB gzip, nepromijenjen.

## Što će TOČNO biti objavljeno (nakon odobrenja)

**Pravila** (`firestore.rules`, sha256 `2114b62a3179`): zamjenjuju trenutni deny-all. Jedina promjena učinka: aktivni član (dokument `households/kuca1/members/{njegov uid}` s `enabled: true` kao boolean) smije _get_ `households/kuca1` i svoj `members/{uid}`. Nema `list`, nema nijednog klijentskog write-a, sve ostalo odbijeno. Dok `members` ne postoje, nitko ne dobiva pristup.
**Hosting** (samo mapa `dist`, 9 datoteka): `index.html`, `sw.js`, `manifest.webmanifest`, `assets/index-<hash>.js` + `.css`, `icons/` (3 PNG + SVG). Točni hashevi i veličine ispisuju se naredbom `npm run build:prod` u trenutku objave (ovise o pravim vrijednostima konfiguracije; probni build imao je 9 datoteka, JS 770.9 kB). Ne objavljuje se `.env*`, izvorni kod, `firebase.json` ni `node_modules`.
**Utjecaj na dostupnost:** stranica je javno dohvatljiva (HTML/JS/CSS), ali ne sadrži ni podatke ni tajne; Firestore ostaje privatan po pravilima. Web API ključ je javan po dizajnu.
**Povrat:** Hosting _Rollback_ u Console; pravila vratiti na `allow read, write: if false;`.

## Preostalo prije P2 (go/no-go)

Stvarni login A i B, potvrda članstva i odbijanje trećeg UID-a, opoziv, instalacija PWA, Spark ostaje — sve **NOT VERIFIED** do vlasnikovih testova (`docs/OWNER_ACTIONS.md` C).
