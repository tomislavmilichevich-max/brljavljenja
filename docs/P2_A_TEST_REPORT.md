# P2_A_TEST_REPORT — model Location + Item + Placement, pravila i testovi

Datum: 2026-11-07 · Grana: `p2a/data-model-rules` (iz `docs/p2-inventory-handoff-2026-11-07`, tj. PR #6) · Okruženje: Claude Code cloud (Linux, Node 22.23.4, Java 21, firebase-tools 15.35.0, firebase 13.2.0)
Testirana pravila: `firestore.rules`, **sha256 `b998f2269754`**, 216 linija. Statusi: **PASS** · **PARTIAL** (djelomično, objašnjeno) · **FAIL** · **BLOCKED** · **NOT VERIFIED** · **NOT STARTED**.

**Ukupni status P2-A: PARTIAL — pravila i dokazi su gotovi; jedna stroga invarijanta (potpuna acikličnost bez ograničenja dubine) NIJE izvediva samo s Rules i čeka odluku glavnog razvoja (D1 u `docs/P2_A_ADR.md`).** Ništa nije deployano. U produkcijsko `households/kuca1` ništa nije upisano. Demo kuća koristi se isključivo u izoliranim emulatorima (`demo-…` projekti).

## 1. Naredbe i stvarni izlazi

| Naredba                                                               | Rezultat                                                                   |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `npm run typecheck` / `npm run lint`                                  | PASS / PASS                                                                |
| `npm run test` (Vitest, jsdom)                                        | **PASS** — 8 datoteka, **83 testa** (P0/P1/P1.5 + prošireni `guard:rules`) |
| `npm run build`                                                       | PASS (JS 770.6 kB, gzip 235.3 kB — nepromijenjeno)                         |
| `npm run check:no-actions`                                            | PASS                                                                       |
| `npm run guard:rules`                                                 | PASS (`b998f2269754`)                                                      |
| `npm run test:rules` (Firestore emulator)                             | **PASS — 9 datoteka, 147 testova, 0 palih**                                |
| `npm run test:e2e` (P1 regresija, Auth+Firestore emulatori, Chromium) | **PASS 14/14**                                                             |

Rules testovi po datoteci: `firestore.rules.test.ts` 36 (P1, jedan blok prilagođen) · `p2/acl` 29 · `p2/concurrency` 13 · `p2/depth` 4 · `p2/fixture` 6 · `p2/hierarchy` 24 · `p2/offline` 3 · `p2/placements` 26 · `p2/platform-limits` 6.
Stabilnost: `test:rules` pokrenut 3× zaredom (141/141 prije dodatka MD-08), `concurrency` 6× (13/13), `depth` 10× (4/4) — vidi §4 za nalaz o treperenju. Cijeli skup od 147 testova pokrenut završno jednom (147/147).

## 2. Prihvatna matrica (`docs/P2_ACCEPTANCE.md`)

### A. Model i integritet

| ID    | Status         | Dokaz / napomena                                                                                                                                                                          |
| ----- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MD-01 | PASS           | `hierarchy` + `fixture`: jedan root, svaki roditelj postoji, sve doseže root                                                                                                              |
| MD-02 | PASS           | dvije „Ladica 1" (fixture) + stvaranje treće                                                                                                                                              |
| MD-03 | PASS           | `garage-box` pod `living-tv` i natrag; samo `parentId`/`version`; svi smještaji bit-po-bit isti                                                                                           |
| MD-04 | PASS           | klijent `cycle` + sirovi batch odbijen na serveru                                                                                                                                         |
| MD-05 | **PARTIAL**    | server odbija cikluse do **udaljenosti 6**; **7+ prolazi sirovim batchom** (`KNOWN GAP`, dokazano) — zaštita dalje je samo protokol. **Odluka D1**                                        |
| MD-06 | PASS (uz D1)   | `concurrency`: prisilno preklapanje A→B / B→A: točno jedan uspije, drugi `cycle`; stablo acikličko, `rev == 1` (6 pokretanja, pobjednik se mijenja); sirovi batchevi: drugi pada na CAS-u |
| MD-07 | PASS (klijent) | protokol ne piše ništa; server ne zabranjuje no-op izmjenu                                                                                                                                |
| MD-08 | **PARTIAL**    | server NE može provjeriti „ima li potomaka/smještaja" (testirano kao znano ograničenje); blokira stvaranje u arhiviranoj lokaciji i vraćanje pod arhiviranim roditeljem. **Odluka D2**    |
| MD-09 | PASS           | baterije: dva smještaja (fixture)                                                                                                                                                         |
| MD-10 | PASS           | `unique` na dvije lokacije: klijent + server (ključ); **paralelno** novi `unique` predmet na dvije lokacije: točno jedan                                                                  |
| MD-11 | PASS           | paralelno isti item/ista lokacija: točno jedan aktivan; sirovi slijepi batchevi: drugi DENIED                                                                                             |
| MD-12 | PASS           | nepostojeći/arhivirani item ili lokacija, injekcija putanje                                                                                                                               |
| MD-13 | PASS           | scenarij 4: samo `pl-battery-2`; `pl-battery-1` bit-po-bit isti                                                                                                                           |
| MD-14 | PASS           | `createdAt/By`, `itemId`, `kind` nepromjenjivi; polje `id` odbijeno (ID je doc ID)                                                                                                        |
| MD-15 | PASS           | premještaj roditelja + preimenovanje: putanja se izvodi, nijedan potomak nema pohranjen path                                                                                              |
| MD-16 | PASS           | paralelno preimenovanje i premještaj istog zapisa: jedan uspije, drugi `changed-elsewhere`; ključevi konzistentni; zastarjeli sirovi upis DENIED                                          |
| MD-17 | PASS           | različiti predmeti/smještaji/dodavanje u istu lokaciju paralelno: oba uspiju (nema brojača)                                                                                               |
| MD-18 | **PARTIAL**    | `unique` predmet sa smještajem: server blokira; `type` predmet: **ne** (znano ograničenje). **Odluka D2**                                                                                 |

### B. Security Rules

| ID               | Status | Dokaz                                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACL-21           | PASS   | A i B: get/list locations/items/placements, get meta i ključeva (list ključeva namjerno DENY)                                                                                                                                                                                                                                                                     |
| ACL-22           | PASS   | A i B kroz referentni protokol: create/rename/move/archive                                                                                                                                                                                                                                                                                                        |
| ACL-23           | PASS   | neprijavljen: sve DENY                                                                                                                                                                                                                                                                                                                                            |
| ACL-24 / 25 / 26 | PASS   | treći UID, `enabled:false`, član drugog kućanstva: get/list/create/update/delete DENY; opoziv tijekom rada odmah DENY, B i dalje ALLOW                                                                                                                                                                                                                            |
| ACL-27           | PASS   | members/role/enabled/household nepromjenjivi s klijenta                                                                                                                                                                                                                                                                                                           |
| ACL-28           | PASS   | `appliedOps`, nepoznate putanje i podkolekcije DENY; `meta/*` osim `tree` DENY (**nalaz:** ranije je `get` na bilo koji `meta/*` bio dopušten — zatvoreno)                                                                                                                                                                                                        |
| ACL-29 / 30      | PASS   | 12 vrsta nevaljanog create-a, zaobilaženje `version/updatedBy/createdBy/kind/vremena`, atomarni batch                                                                                                                                                                                                                                                             |
| ACL-31           | PASS   | **10 automatiziranih mutacija pravila** (otvoren read, ignoriran `enabled`, create za svakog prijavljenog, bez version+1, bez CAS-a, bez provjere ciklusa, prepisivi ključevi, smještaj bez ključa, otvoren `appliedOps`, pisivi `members`): za svaku sa slomljenim pravilom proba USPIJEVA (= sigurnosni test bi pao); kontrola: originalna pravila sve odbijaju |
| ACL-32           | PASS   | stvarni `firestore.rules`, sintetski UID-ovi, `demo-*` projekti; test provjerava da P2 datoteke ne spominju `kuca1`/produkcijski projekt                                                                                                                                                                                                                          |

### C. UX / pretraga: **NOT STARTED** (P2-B/C). D. Android/dva uređaja: **NOT VERIFIED** (nije dio P2-A).

### E. Go/no-go za P2-B

MD-06/10/11/12/16/17 i ACL-21–32 imaju dokaz. **MD-05 i MD-06 imaju dokazani propust na dubini ≥ 7 (D1)** → po tvom kriteriju P2-A **ne prelazi** u P2-B bez izričite odluke glavnog razvoja. Nisam ublažavao pravilo.

## 3. Što je provjereno izvan matrice

| Pitanje                                                                   | Rezultat                                                                                        |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Najgori legitimni slučaj stane u limit (premještaj ispod čvora dubine 14) | PASS (`depth`, 10/10 pokretanja)                                                                |
| Q4: transakcija bez veze                                                  | PASS — odbija se odmah (`unavailable`, 26 ms); običan `setDoc` ostaje _pending_ u lokalnom redu |
| Q4 nalaz: `disableNetwork()` NE blokira transakcije                       | zabilježeno (`offline` test)                                                                    |
| Q5: keš po instanci                                                       | PASS — ista instanca poslužuje dokument iz keša nakon „odjave", nova instanca nema ništa        |
| `terminate` / `deleteApp` pri odjavi                                      | **NOT VERIFIED** (testni wrapper nema `terminate`)                                              |
| Demo seed samo u emulatoru                                                | PASS (`demo-home-inventory-p2-…`, `demo-house`); fixture: 22/29/32, bez duplikata, `unique` ≤ 1 |

## 4. Nalazi i greške pronađene tijekom rada (uključujući vlastite)

1. **Treperenje na granici limita (najvažnije).** Prva verzija obilaska predaka koristila je točno 10 različitih dokumenata. Isto pravilo i isti test prošli su u jednom pokretanju emulatora i pali u drugom (3 od 6 procesa: svih 6 legitimnih upisa odbijeno, „Service call error. Function: [get]… meta/tree"). Mjerenje po duljini lanca: T=8 (10 dok.): 3 od 6 pokrenutih procesa emulatora odbilo je svih 6 pokušaja; T=7, 6, 5, 4: 24 procesa, svih 144 pokušaja uspjelo. **Posljedica:** obilazak smanjen na 6 dokumenata (udaljenost 6) i to je sada granica D1. Nisam "riješio" ponavljanjem testova.
2. **Pravilo je dopuštalo `get` na bilo koji dokument pod `meta/`** — otkriveno testom ACL-28, zatvoreno na `docId == 'tree'`.
3. **Gubitnik utrke dobiva `permission-denied`**, ne ponovni pokušaj (emulator ne simulira ABORTED/retry kao produkcija; sigurnost vrijedi u oba slučaja jer je CAS u pravilima). Referentni protokol zato ponovno čita stanje i javlja pravi razlog (D5).
4. Greške u mojim testovima (ispravljene, ne pravila): ID-ovi `tape`/`glue` već postoje u fixtureu; `withSecurityRulesDisabled` ne vraća vrijednost; ID s `/` Firestore sam odbija; tvrdnja da čitanje nepostojećeg dokumenta u vlastitom kućanstvu mora biti DENY bila je pogrešna.
5. P1 test ACL-17 namjerno izmijenjen (P2 otvara čitanje `locations/items/placements`).

## 5. Rizici i ograničenja (preostalo)

- **D1** ciklus dublje od 6 razina uz klijent koji zaobilazi protokol (aplikacija s ispravnim protokolom ga ne stvara; detektivna provjera stabla u P2-B preporučena).
- **D2** arhiviranje lokacije/tip-predmeta sa sadržajem samo na klijentu.
- Limiti i ponašanje Rules **izmjereni u emulatoru; produkcija nije neovisno provjerena**. Dizajn drži ≤ 9 dokumenata radi rezerve.
- Svaki `get()` u pravilima se vjerojatno naplaćuje kao čitanje (Spark 50.000/dan); ≈ do 9 po premještaju lokacije — **NOT VERIFIED**.
- Elementi `aliases` nisu tip-provjereni na serveru.
- Pravila su prilagođena inventaru; **ne smiju se deployati prije P2-B klijenta** (deploy nije odobren i nije učinjen). `guard:rules` je proširen da P2 pravila propusti, ali `deploy:rules` ne smije biti pokrenut bez odobrenja.
- Produkcijski bootstrap `meta/tree` i `locations/root` u `kuca1` još ne postoji (P2-B).

## 6. Datoteke

`firestore.rules` (proširen), `rules-tests/p2/*` (helpers, ops = referentni protokol, 8 test datoteka), `rules-tests/firestore.rules.test.ts` (ACL-17 blok), `scripts/prod-guard.mjs`+`.test.ts`+`-cli.mjs` (guard:rules), `docs/P2_A_ADR.md`, ovaj izvještaj. Nema novih ovisnosti, nema `.github/workflows`, nema tajni, nema deploya, nema Blaze/Functions/Storage; GitHub Actions nisu pokretane.
