# P2_B_TEST_REPORT — online inventar (podatkovni sloj, listeneri, izolacija sesija)

Datum: 2026-11-07 · Grana: `p2b/online-inventory` (iz `main` nakon PR #9) · Okruženje: Claude Code cloud (Linux, Node 22.23.4, Java 21, firebase 13.2.0, firebase-tools 15.35.0, Chromium/Playwright)
Statusi: **PASS** · **FAIL** · **BLOCKED** · **NOT VERIFIED** · **NOT STARTED**.

**Status P2-B: IMPLEMENTIRANO I PROVJERENO U EMULATORIMA; Android, pravi Google login i produkcija NOT VERIFIED.** Pravila (`firestore.rules`, sha256 `d73cb80ba712`) **nisu mijenjana** i nisu deployana. Ništa nije objavljeno; u produkcijsko `households/kuca1` ništa nije upisano; demo kuća koristi se samo u `demo-…` emulatorima.

## 1. Što je implementirano

| Dio                                                                                                                                                     | Datoteke                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Domena, greške, validacija (iste granice kao Rules)                                                                                                     | `src/inventory/{types,errors,validation,messages}.ts`          |
| Podatkovni sloj: **sve izmjene isključivo kroz `runTransaction`** (bootstrap, lokacije, predmeti, smještaji, premještaj cijele lokacije)                | `src/inventory/repository.ts`                                  |
| Listeneri + "vrata" za server-potvrđeni cjeloviti skup + provjera integriteta stabla                                                                    | `src/inventory/{watch,gate,tree}.ts`                           |
| **Izolirana podatkovna sesija po prijavljenom korisniku** (zasebna Firebase app, samo memorijski keš, Auth bez perzistencije, `dispose()` uništava sve) | `src/firebase/dataSession.ts`, `src/inventory/port.ts`         |
| Životni ciklus vezan uz React (odjava/promjena računa/opoziv ⇒ odjava listenera + uništenje sesije)                                                     | `src/inventory/useInventory.ts`, `src/app/App.tsx` (`key=uid`) |
| Minimalno sučelje za provjeru sloja (nije dizajn; Organized Cozy = P2-C)                                                                                | `src/app/InventoryPanel.tsx`                                   |
| Tehnička provedba "samo online transakcije / samo memorijski keš"                                                                                       | ESLint `no-restricted-imports`, `scripts/policy.test.ts`       |

Promjene u P1 kodu (potrebne za izolaciju): primarna Firebase instanca **više nema Firestore** (nema keša koji bi preživio odjavu); provjera pristupa ide kroz kratkotrajnu izoliranu sesiju i `getDocFromServer`.

## 2. Rezultati (stvarno izvršeno)

| Provjera                                                                                                                         | Rezultat                                                              |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `typecheck`, `lint`, `prettier --check` (moje datoteke), `check:no-actions`, `guard:rules`                                       | PASS                                                                  |
| `build`                                                                                                                          | PASS — JS 809 kB / **246 kB gzip** (bilo 235 kB)                      |
| Vitest (jsdom + Node)                                                                                                            | **114/114**, 11 datoteka                                              |
| `test:rules` (pravila, P1+P2-A, nepromijenjena)                                                                                  | **200/200**, 11 datoteka                                              |
| **`test:sdk` (novo; pravi SDK + produkcijski moduli + Auth/Firestore emulatori)**                                                | **64/64** — `repository` 46 · `isolation` 8 · `watch` 7 · `offline` 3 |
| `test:e2e` (P1 regresija, Chromium)                                                                                              | 14/14                                                                 |
| **`test:e2e:inventory` (novo; Chromium, dva korisnika)**                                                                         | **17/17**                                                             |
| P0 PWA offline ljuska (Chromium, `vite preview`)                                                                                 | PASS                                                                  |
| Produkcijski `build:prod` + `guard:dist` (sintetska konfiguracija): bez emulatorske kuke, bez `127.0.0.1:9099`, bez trajnog keša | PASS                                                                  |
| Android, pravi Google popup/redirect, instalirana PWA, dva fizička uređaja                                                       | **NOT VERIFIED**                                                      |
| Produkcijski Firebase (kvote, Rules limiti, `kuca1`)                                                                             | **NOT VERIFIED**                                                      |

## 3. Obveze iz P2-A ADR-a (D1, D5, P2-LOC-ROOM-01, potpunost snapshota)

| Obveza                                                | Dokaz                                                                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Premještaj: puni lanac predaka u transakciji + CAS | `repository.test` dubina **7 / 10 / 20**: ciklus odbijen prije pisanja, legitimno premještaj ispod čvora te dubine uspijeva, `rev` točan                      |
| 2. Detekcija oštećenog stabla nakon učitavanja        | `watch.test`: ciklus u cjelovitom server-potvrđenom skupu ⇒ `tree-corrupt` **bez ikakvih podataka u stanju**; popravak ⇒ `ready`                              |
| 3. Istodobna premještanja dvaju korisnika             | `repository.test`: c10→e23 naspram e10→c23 (zajedno ciklus): točno jedno uspije, drugo `cycle`, stablo zdravo, `rev == 1`; nepovezana: oba uspiju, `rev == 2` |
| 4. Opoziv ≠ konflikt                                  | 8 operacija ⇒ `access-revoked`; opoziv usred transakcije i prednost pred zastarjelom verzijom; aktivni član i dalje dobiva `changed-elsewhere`                |
| 5. Samo `runTransaction`                              | `offline.test` (nema skrivenog reda), lint pravilo (probni zabranjeni uvoz pada), `policy.test`                                                               |
| 6. Ne tvrditi da Rules jamče acikličnost              | komentari/dokumenti nepromijenjeni iz P2-A                                                                                                                    |
| 7. P2-LOC-ROOM-01                                     | `repository.test` (`room-parent`, `room-immovable`, ništa se ne zapisuje), UI: roditelj zaključan na root, prostorija nema "Premjesti" (Vitest + E2E INV-3/4) |
| 8. Integritet tek nad cjelovitim skupom               | vidi §4                                                                                                                                                       |

## 4. Stvarno ponašanje Firestore SDK-a — metadata signali i integritet stabla

Izmjereno pravim SDK-om (v13, Node/gRPC u `watch.test`; Chromium/WebChannel u E2E):

- **Svježa sesija:** jedan snapshot `locations` s `fromCache:false, hasPendingWrites:false`, 22 dokumenta.
- **Djelomičan keš — opasnost je stvarna:** nakon što keš sadrži samo jednu lokaciju, SDK **prvo isporuči snapshot iz keša** `{fromCache:true, size:1}`, pa zatim `{fromCache:false, size:22}`. Naivna provjera nad prvim skupom dala bi lažni `missing-parent`.
- **Vrata** (`gate.ts`) otkrivaju podatke i pokreću `findTreeProblems` **tek kad su sve tri kolekcije server-potvrđene**. Test: u cijelom nizu stanja nema `tree-corrupt` ni djelomičnog `ready`; završno stanje `ready` s 22 lokacije.
- **Transakcije ne stvaraju lokalne nepotvrđene upise:** `hasPendingWrites` je ostao `false` kroz sve operacije repozitorija.
- **Gubitak veze nakon cjelovitog skupa:** stanje `stale` (zadnji **potvrđeni** podaci; nove promjene iz keša se ne otkrivaju; izmjene onemogućene); povratkom veze `ready` s novim podacima. Chromium: banner "veza prekinuta" i onemogućeni gumbi pojavili su se nakon `setOffline(true)`. _Sirovi niz metadata događaja u pregledniku nije snimljen_ (samo ponašanje sučelja).
- Čisti test vrata (`gate`) i `checkTreeIntegrity({complete})` iz P2-A pokriveni su i jedinično.

## 5. Izolacija korisničkih računa i keša

| Provjera                                                                                                                                                                                                                       | Rezultat                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Svaka sesija = zasebna Firebase app (različita imena, različita od primarne)                                                                                                                                                   | PASS                                                                                                                                                                                                                          |
| Keš sesije čitljiv; nakon `dispose()` instanca uništena (`getDocFromCache` baca); **nova sesija istog korisnika počinje s praznim kešom**                                                                                      | PASS                                                                                                                                                                                                                          |
| Promjena računa na **istom primarnom Authu** (A ⇒ odjava ⇒ nečlan C): stara sesija mrtva, C-ova sesija prazna, listener ⇒ `revoked`, **nijedno `ready/stale`**, `getDocFromCache` ne vraća ništa, operacije ⇒ `access-revoked` | PASS                                                                                                                                                                                                                          |
| Listeneri: nakon `unsubscribe` **nula** daljnjih povratnih poziva; nakon samog `dispose()` novi podaci se ne isporučuju                                                                                                        | PASS                                                                                                                                                                                                                          |
| Chromium: nakon odjave nijedan podatak inventara u DOM-u, panel uklonjen; **drugi račun na istom uređaju** vidi samo "Nemaš pristup"                                                                                           | PASS (INV-14/16)                                                                                                                                                                                                              |
| Chromium **IndexedDB**: samo `firebase-heartbeat-database` i `firebaseLocalStorageDb`; **nema Firestore baze**; jedini auth ključ je za `[DEFAULT]`, **nijedan za podatkovne sesije (`data-*`)**; nakon odjave 0 ključeva      | PASS (INV-13/15)                                                                                                                                                                                                              |
| Zadržavanje korisnika nakon odjave u primarnom Authu                                                                                                                                                                           | **Nalaz:** sekundarni Auth drži vlastitu kopiju korisnika dok se sesija ne uništi ⇒ aplikacija **mora** uništiti sesiju pri odjavi (radi: panel se unmounta). Zaobilazno ponovno korištenje stare sesije nije moguće iz UI-ja |

## 6. Online-only: odbijanje upisa bez veze (stvarni prekid mreže)

TCP proxy ispred emulatora; `down()` uništava sve veze i odbija nove.

| Provjera                                                                                                                                                               | Rezultat         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Svih **9** operacija (create/rename/move lokacije, create/update predmeta, add/move/archive smještaja, bootstrap) bez veze ⇒ `offline` (grupa završila za **≈10,4 s**) | PASS             |
| Nakon povratka veze + 4 s čekanja: **ništa** od pokušanih upisa nije na poslužitelju (nema skrivenog reda, nema automatskog slanja); verzije nepromijenjene            | PASS             |
| Izričiti ponovni pokušaj korisnika uspijeva                                                                                                                            | PASS             |
| Bez mreže se ne tvrdi da je pristup opozvan (`isAccessRevoked` ⇒ false)                                                                                                | PASS             |
| Chromium: stale banner, gumbi onemogućeni, **Enter u polju ne šalje**, nema statusa "Spremanje"/"spremljeno"; po povratku veze ništa tipkano offline nije poslano      | PASS (INV-10/11) |
| Mreža pada **točno između čitanja i commita** ⇒ `outcome-unknown` (ne "nije spremljeno"); na poslužitelj ništa ne stiže                                                | PASS             |
| Poruka "spremljeno na serveru" prikazuje se tek nakon razriješenog `runTransaction`                                                                                    | PASS (Vitest)    |

**Greške pronađene i ispravljene tijekom rada (pokazuju što testovi hvataju):**

1. Enter u polju obrasca zaobilazio je onemogućeni gumb ⇒ obrazac sada provjerava `writable`.
2. Nakon prekida veze ostajala je stara poruka "spremljeno na serveru" ⇒ skrivena dok je prikaz nepotvrđen.
3. Poruka "NIJE spremljena" bila bi **lažna** kad veza padne dok se commit potvrđuje ⇒ novo `outcome-unknown`; pisaće transakcije bez čitanja (`createItem`) sada uvijek čitaju prije commita.
4. Test-hook nije bio pozvan u svim operacijama (preklapanje se nije stvarno izazivalo) ⇒ dodan u sve.
5. Stanje "Spremanje…" ostajalo je nakon `access-revoked` ⇒ resetira se.
6. **Zaostali dev poslužitelj** iz prethodnog E2E-a davao je lažnu regresiju P1 E2E-a (krivi projekt) ⇒ skripte sada ubijaju cijelu grupu procesa i odbijaju start ako je port zauzet.

## 7. Poznata ograničenja i rizici

1. **Ništa od ovoga nije provjereno na Androidu ni uz pravi Google login** (emulatorski račun preko dev kuke). Produkcijsko ponašanje Rules limita i kvota nije neovisno provjereno.
2. **Opoziv se vidi odmah samo ako poslužitelj ponovno evaluira listener** (izmjereno: nakon promjene podataka listener prijavi `revoked`, i u Node-u i u Chromiumu). Bez promjene podataka oslanja se na P1 revalidaciju (povratak u prvi plan, mreža, 10-min timer, ručno). _Ponašanje bez ikakve promjene podataka nije posebno mjereno._
3. **Svako otvaranje sesije ponovno čita sve tri kolekcije** (samo memorijski keš ⇒ nema ponovnog korištenja). Na Sparku (50.000 čitanja/dan prema glavnom razvoju) to je zanemarivo za desetke dokumenata, ali raste s veličinom inventara: pri ≈500 dokumenata i 20 otvaranja dnevno ≈10.000 čitanja. Rules `get()` pozivi se također mogu naplaćivati kao čitanja — **NOT VERIFIED**. Odluka o trajnom kešu je P3.
4. **Nema straničenja:** listeneri učitavaju cijele kolekcije.
5. **`createItem` + `addPlacement` su dvije transakcije** (Rules provjeravaju `get(item)` u pre-stanju pa atomarno stvaranje nije moguće bez promjene pravila); ako druga padne, predmet postoji bez smještaja i UI to izričito kaže.
6. **`outcome-unknown`**: korisnik mora ručno provjeriti prikaz; nema automatskog ponavljanja (namjerno).
7. Dubina: server hvata cikluse samo do udaljenosti 6 (D1); iznad toga čuva protokol + detekcija. Tijekom `tree-corrupt` aplikacija ne prikazuje i ne mijenja ništa; ispravak radi vlasnik u Console.
8. Zadržana odluka D2: nema arhiviranja/brisanja lokacija i predmeta; nema pretrage ni UI-ja prema dizajnu (P2-C).
9. `testHooks` postoji u produkcijskom repozitoriju kao neaktivna točka proširenja (u produkciji se ne postavlja).
10. Bootstrap u produkcijskom `kuca1` zahtijeva **izričit klik** "Pripremi kućanstvo" (stvara samo `meta/tree` i root "Kuća"); ne stvara nikakve demo podatke. Nije izvršen.
11. `npm audit`: nema novih ovisnosti; stanje iz P1 nepromijenjeno (4 high produkcijska preko `@grpc/grpc-js`, nije u bundleu).
12. Pravila se ne smiju deployati ni aplikacija objavljivati bez zasebnog odobrenja.
