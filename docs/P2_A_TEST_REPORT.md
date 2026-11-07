# P2_A_TEST_REPORT — model Location + Item + Placement, pravila i testovi

Datum: 2026-11-07 · Grana: `p2a/data-model-rules` (razvijana na dokumentacijskoj grani PR #6; nakon njegova spajanja `main` je spojen u granu, diff prema `main` sadrži samo P2-A datoteke) · Okruženje: Claude Code cloud (Linux, Node 22.23.4, Java 21, firebase-tools 15.35.0, firebase 13.2.0)
Testirana pravila (revizija 3): `firestore.rules`, **sha256 `d73cb80ba712`**. Prethodne verzije: rev. 2 `c141f0dda1dd` (PR #8), rev. 1 `b998f2269754` (PR #7). Statusi: **PASS** · **PARTIAL** (djelomično, objašnjeno) · **FAIL** · **BLOCKED** · **NOT VERIFIED** · **NOT STARTED**.

**Ukupni status P2-A: ODOBRENO UZ UVJETE (odluke D1–D5 glavnog razvoja). Revizija 2 (ovaj PR) provodi korekcije; vidi §7.** Potpuna acikličnost nije zajamčena Rules-ima (D1) — ograničena serverska provjera + obvezni protokol i detekcija u P2-B. Ništa nije deployano; u produkcijsko `households/kuca1` ništa nije upisano.

## 1. Naredbe i stvarni izlazi

| Naredba                                                               | Rezultat                                                                   |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `npm run typecheck` / `npm run lint`                                  | PASS / PASS                                                                |
| `npm run test` (Vitest, jsdom)                                        | **PASS** — 8 datoteka, **83 testa** (P0/P1/P1.5 + prošireni `guard:rules`) |
| `npm run build`                                                       | PASS (JS 770.6 kB, gzip 235.3 kB — nepromijenjeno)                         |
| `npm run check:no-actions`                                            | PASS                                                                       |
| `npm run guard:rules`                                                 | PASS (`b998f2269754`)                                                      |
| `npm run test:rules` (Firestore emulator)                             | **PASS — 11 datoteka, 200 testova, 0 palih** (revizija 3)                  |
| `npm run test:e2e` (P1 regresija, Auth+Firestore emulatori, Chromium) | **PASS 14/14**                                                             |

Rules testovi po datoteci (revizija 3): `firestore.rules.test.ts` 36 · `p2/acl` 36 · `p2/concurrency` 13 · `p2/depth` 16 · `p2/fixture` 7 · `p2/hierarchy` 39 · `p2/offline` 3 · `p2/placements` 25 · `p2/platform-limits` 6 · `p2/revocation` 14 · `p2/tree-completeness` 5.
Stabilnost: `test:rules` pokrenut 3× zaredom (141/141 prije dodatka MD-08), `concurrency` 6× (13/13), `depth` 10× (4/4) — vidi §4 za nalaz o treperenju. Cijeli skup od 147 testova pokrenut završno jednom (147/147).

## 2. Prihvatna matrica (`docs/P2_ACCEPTANCE.md`)

### A. Model i integritet

| ID    | Status                                | Dokaz / napomena                                                                                                                                                                                                                           |
| ----- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MD-01 | PASS                                  | `hierarchy` + `fixture`: jedan root, svaki roditelj postoji, sve doseže root                                                                                                                                                               |
| MD-02 | PASS                                  | dvije „Ladica 1" (fixture) + stvaranje treće                                                                                                                                                                                               |
| MD-03 | PASS                                  | `garage-box` pod `living-tv` i natrag; samo `parentId`/`version`; svi smještaji bit-po-bit isti                                                                                                                                            |
| MD-04 | PASS                                  | klijent `cycle` + sirovi batch odbijen na serveru                                                                                                                                                                                          |
| MD-05 | **PASS (ograničeno, D1)**             | server odbija cikluse do udaljenosti 6; **7+ prolazi sirovim batchom** (dokazano, `KNOWN GAP` na 7, 10, 20); protokol u transakciji odbija na 7/10/20; oštećeno stablo se otkriva (`findTreeProblems`). Rules NE jamče potpunu acikličnost |
| MD-06 | PASS (uz D1)                          | `concurrency` + `depth`: prisilno preklapanje A→B / B→A, i na lancima dubine 24 (c10→e23 naspram e10→c23): točno jedan uspije, drugi `cycle`; stablo zdravo, `rev == 1`; sirovi batchevi: drugi pada na CAS-u                              |
| MD-07 | PASS (klijent)                        | protokol ne piše ništa; server ne zabranjuje no-op izmjenu                                                                                                                                                                                 |
| MD-08 | **ODGOĐENO (D2) — server zabranjuje** | `archived` na Location se ne može mijenjati (listovi, lokacije sa sadržajem, prostorije, root; samostalno i uz druge promjene); ništa se ne arhivira i ne briše                                                                            |
| MD-09 | PASS                                  | baterije: dva smještaja (fixture)                                                                                                                                                                                                          |
| MD-10 | PASS                                  | `unique` na dvije lokacije: klijent + server (ključ); **paralelno** novi `unique` predmet na dvije lokacije: točno jedan                                                                                                                   |
| MD-11 | PASS                                  | paralelno isti item/ista lokacija: točno jedan aktivan; sirovi slijepi batchevi: drugi DENIED                                                                                                                                              |
| MD-12 | PASS                                  | nepostojeći/arhivirani item ili lokacija, injekcija putanje                                                                                                                                                                                |
| MD-13 | PASS                                  | scenarij 4: samo `pl-battery-2`; `pl-battery-1` bit-po-bit isti                                                                                                                                                                            |
| MD-14 | PASS                                  | `createdAt/By`, `itemId`, `kind` nepromjenjivi; polje `id` odbijeno (ID je doc ID)                                                                                                                                                         |
| MD-15 | PASS                                  | premještaj roditelja + preimenovanje: putanja se izvodi, nijedan potomak nema pohranjen path                                                                                                                                               |
| MD-16 | PASS                                  | paralelno preimenovanje i premještaj istog zapisa: jedan uspije, drugi `changed-elsewhere`; ključevi konzistentni; zastarjeli sirovi upis DENIED                                                                                           |
| MD-17 | PASS                                  | različiti predmeti/smještaji/dodavanje u istu lokaciju paralelno: oba uspiju (nema brojača)                                                                                                                                                |
| MD-18 | **ODGOĐENO (D2) — server zabranjuje** | `archived` na Item se ne može mijenjati (unique i type, sa i bez smještaja)                                                                                                                                                                |

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

- **D1** (prihvaćeno uvjetno) ciklus dublje od 6 razina uz klijent koji zaobilazi protokol; P2-B mora imati potpunu provjeru lanca predaka u transakciji, detekciju oštećenog stabla i testove dubine 7/10/20 + istodobnih premještanja. Rules to ne jamče.
- **D2** zatvoren (revizija 2): arhiviranje Location i Item zabranjeno u pravilima; vraća se tek uz novu odluku.
- Limiti i ponašanje Rules **izmjereni u emulatoru; produkcija nije neovisno provjerena**. Dizajn drži ≤ 9 dokumenata radi rezerve.
- Svaki `get()` u pravilima se vjerojatno naplaćuje kao čitanje (Spark 50.000/dan); ≈ do 9 po premještaju lokacije — **NOT VERIFIED**.
- Elementi `aliases` nisu tip-provjereni na serveru.
- Pravila su prilagođena inventaru; **ne smiju se deployati prije P2-B klijenta** (deploy nije odobren i nije učinjen). `guard:rules` je proširen da P2 pravila propusti, ali `deploy:rules` ne smije biti pokrenut bez odobrenja.
- Produkcijski bootstrap `meta/tree` i `locations/root` u `kuca1` još ne postoji (P2-B).

## 6. Datoteke

`firestore.rules` (proširen), `rules-tests/p2/*` (helpers, ops = referentni protokol, 8 test datoteka), `rules-tests/firestore.rules.test.ts` (ACL-17 blok), `scripts/prod-guard.mjs`+`.test.ts`+`-cli.mjs` (guard:rules), `docs/P2_A_ADR.md`, ovaj izvještaj. Nema novih ovisnosti, nema `.github/workflows`, nema tajni, nema deploya, nema Blaze/Functions/Storage; GitHub Actions nisu pokretane.

## 7. Revizija 2 — korekcije prema odlukama glavnog razvoja (`p2a/review-fixes`)

| Zahtjev                                   | Provedba u pravilima                                                       | Dokaz (testovi)                                                                                                                                                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1 uvjetno; ne tvrditi potpunu garanciju  | komentari u pravilima/testovima/ADR-u ispravljeni; ograničena provjera ≤ 6 | `depth`: server hvata ≤ 6, `KNOWN GAP` 7/10/20, protokol 7/10/20 (ciklus odbijen + legitimno premještanje uspije), istodobna premještanja na dubokim lancima (3 testa), `findTreeProblems` (4 testa, uključujući 5000 čvorova) |
| D2 zabrana `archived` na Location i Item  | `n.archived == o.archived`                                                 | `hierarchy` (5 testova: listovi, sadržaj, prostorija, root, uz druge promjene, vraćanje admin-arhiviranog, obrambena provjera), `placements` (Item unique/type, vraćanje); mutacije M13, M14                                   |
| D5 opoziv ≠ konflikt                      | referentni protokol: `accessRevoked` (server) prije tumačenja konflikta    | `revocation` 14 testova: 7 operacija, opoziv ima prednost nad zastarjelom verzijom, obrisan membership, opoziv usred transakcije i usred utrke; aktivni član i dalje dobiva `changed-elsewhere`/`duplicate-placement`          |
| `Location.kind` nepromjenjiv              | `n.kind == o.kind`                                                         | `hierarchy` (7 kombinacija odbijeno, isti kind dopušten); mutacija M11                                                                                                                                                         |
| Samo root je `house`, root uvijek `house` | kreiranje po ID-u (`root` ⇒ house, ostali ⇒ ≠ house) + nepromjenjiv kind   | `hierarchy` (3 ne-root pokušaja, root s kindom room/box odbijen, root kao house prolazi); `fixture`; mutacije M15, M16                                                                                                         |
| Prostorije se ne premještaju (server)     | reparent traži `o.kind != 'room'`                                          | `hierarchy`: 3 prostorije sirovim batchom s ispravnim rev-om i bez ciklusa odbijene, `room-immovable` u protokolu, ne-prostorije se i dalje premještaju, prostorija se može preimenovati; mutacija M12                         |

Izlazi (revizija 2): `typecheck`/`lint` OK · Vitest 83/83 · build OK · `check:no-actions` OK · `guard:rules` OK (`c141f0dda1dd`) · `test:rules` **187/187**, ponovljeno 3× (isti rezultat) · `test:e2e` (P1) 14/14 · mutacije ACL-31 sada **16** (6 novih).
Testovi koje je trebalo prepisati jer je politika promijenjena (ne zato što su bili pogrešni): 5 starih testova arhiviranja (MD-08/MD-18) postali su negativni testovi D2; 4 ACL testa sada očekuju `access-revoked` umjesto sirovog `permission-denied` kad ih zove referentni protokol.

**Nove greške u vlastitim testovima, ispravljene:** barijera za dvoje u testu u kojem A baca `cycle` prije točke preklapanja (timeout, ne greška pravila).
**Otvoreno / pitanje glavnom razvoju:** handoff kaže "prostorije su djeca root-a", ali pravila to **ne** nameću pri kreiranju (kreiranje prostorije ispod ormara bilo bi moguće, a kasnije je nepomično). Nisam dodao to pravilo jer nije traženo; fixture ga zadovoljava. Treba li?
**Nije provjereno:** produkcijsko ponašanje pravila/limita, Android, naplata čitanja unutar pravila. Ništa nije deployano.

## 8. Revizija 3 — P2-LOC-ROOM-01 i potpunost snapshota (`p2a/room-parent-rule`)

| Zahtjev                                                  | Provedba                                                                                         | Dokaz                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `room` smije imati isključivo `parentId = root` (server) | `firestore.rules`: pri kreiranju `d.kind != 'room' \|\| d.parentId == 'root'`                    | 7 novih testova u `hierarchy`: pozitivno (pod root, A i B, sirovi upis i protokol); negativno (pod ormarom, policom, ladicom, kutijom, „other", drugom prostorijom, nepostojećim/nevaljanim roditeljem, bez roditelja, pod sobom); mutacija **M17** |
| Prostorija se ne premješta                               | već u rev. 2                                                                                     | ponovljeno za 3 odredišta                                                                                                                                                                                                                           |
| Ostali tipovi neograničeni novim pravilom                | bez promjene                                                                                     | pozitivni testovi (ormar/other pod root, polica/kutija/ladica/other ugniježđeno, ormar u prostoriji i u ormaru)                                                                                                                                     |
| P2-B poštuje isto pravilo                                | referentni protokol: `room-parent`; obveza 7 u ADR-u                                             | test „referentni protokol javlja room-parent prije pisanja"                                                                                                                                                                                         |
| Integritet stabla samo nad cjelovitim skupom             | `checkTreeIntegrity(locs, { complete })` — `incomplete` dok skup nije cjelovit; obveza 8 u ADR-u | `tree-completeness` 5 testova: djelomičan skup ⇒ `incomplete` (a da je provjera pokrenuta, bila bi lažna uzbuna `missing-parent`), prazan/jednočlani ⇒ `incomplete`, cjelovit zdrav ⇒ `ok`, cjelovit s ciklusom ⇒ `corrupt`                         |

Izlazi (revizija 3): `typecheck`/`lint` OK · Vitest 83/83 · build OK · `check:no-actions` OK · `guard:rules` OK (`d73cb80ba712`) · `test:rules` **200/200**, 3 pokretanja zaredom · `test:e2e` (P1) 14/14 · mutacije ACL-31: **17**. Svi prethodni testovi (D1–D5) prolaze nepromijenjeni; nijedan nije izmijenjen ni uklonjen.
**Napomena:** `complete` u `checkTreeIntegrity` je isključivo odgovornost pozivatelja (P2-B); kako P2-B definira "cjelovit" (npr. prvi server-potvrđeni snapshot bez `fromCache` i bez `hasPendingWrites`) još nije implementirano i nije testirano na pravom SDK listeneru.
**Nije provjereno:** produkcijsko ponašanje pravila, Android. Ništa nije deployano; P2-B nije započet.
