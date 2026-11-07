# P2_C_TEST_REPORT — završno Organized Cozy sučelje i lokalna pretraga

Datum: 2026-11-07 · Grana: `p2c/organized-cozy-ui` (iz `main` nakon PR #12) · Izvor dizajna: UI/UX paket **v0.3.3.1 P2 FINAL** (odobrio glavni razvoj) · Okruženje: Claude Code cloud (Linux, Node 22, Java 21, firebase 13.2.0, firebase-tools 15.35.0, Chromium/Playwright predinstalirani).
Statusi: **PASS** · **FAIL** · **BLOCKED** · **NOT VERIFIED** · **NOT STARTED**.

**Status P2-C: IMPLEMENTIRANO I PROVJERENO U EMULATORIMA I CHROMIUMU; Android, TalkBack, pravi Google login i produkcija NOT VERIFIED.**
Sigurnosna pravila (`firestore.rules`, sha256 `157feee0f7ca`), `package.json` i `package-lock.json` **nisu mijenjani** (nema novih ovisnosti, 0 € troška). Ništa nije objavljeno (bez deploya, bez Actions, bez Blaze, bez upisa u `kuca1`).

## 1. Što je implementirano (prema nalogu)

| Točka naloga                                                     | Realizacija                                                                                                                                                                                                                                                                                              | Dokaz                                                  |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1. Vizualna integracija                                          | `InventoryPanel` **uklonjen**; `src/app/ui/*` (Početna / Lokacije / Dodaj / Popis (onemogućen, „uskoro") / Više), CSS tokeni iz prototipa (`src/app/app.css`). Prototipni `index.html`, demo baza, `simulatedWrite`, demo auth i demo gumbi **nisu kopirani**.                                           | §6 (bundle guard), screenshotovi §9                    |
| 2. Stvarna funkcionalnost                                        | Sve kroz postojeći `InventoryRepository`: dodaj/uredi lokaciju, `createItemWithPlacement`, uredi predmet, drugi smještaj, premjesti smještaj, premjesti kutiju/policu, sadržaj lokacija, izvedene putanje, više smještaja istog predmeta.                                                                | React testovi, E2E INV-3…INV-8                         |
| 3. Pretraga                                                      | `src/search/*`: normalizacija (`đ`/`dj`, dijakritici), sinonimi (`Item.aliases` + 3 ugrađene skupine), prefiks/djelomično, tipfeleri (Damerau–Levenshtein, prag po duljini riječi), višerječni upiti s pokrivanjem **posebnih** riječi, rangiranje, sve putanje predmeta. Lokalno nad učitanim podacima. | 17 jediničnih testova, 3 React testa, E2E INV-S1…S5    |
| 4. Sigurnost i životni ciklus                                    | Nepromijenjeno: Google Auth + članstvo, izolirana podatkovna sesija, server-confirmed gate, `offline` odbijanje, transakcije, D1–D5, P2-LOC-ROOM-01, uklanjanje sadržaja pri odjavi/opozivu.                                                                                                             | regresija §5, `scripts/policy.test.ts`                 |
| 5. Stanja i greške                                               | Spremanje, Spremljeno, Nije spremljeno, Offline/samo pregled, Konflikt, Ishod nepoznat, Opozvan pristup, Učitavanje, Oštećeno stablo, `inconsistent`, nepripremljeno kućanstvo, prazna kuća.                                                                                                             | §9 (screenshotovi)                                     |
| 6. Nespremljene izmjene (UX-032-01)                              | Dijalog sa 3 izbora na stvarnim React obrascima: kartice, Natrag, Android Back (`popstate`), Uredi→Premjesti. Server odbije ⇒ ostajemo na obrascu, tekst sačuvan.                                                                                                                                        | 12 React testova, E2E INV-U1…U4                        |
| 7. Testiranje                                                    | §5                                                                                                                                                                                                                                                                                                       | §5                                                     |
| `outcome-unknown` za `createItemWithPlacement` (posebna analiza) | §3 — **izmjena ugovora repozitorija**, dokumentirana i pokrivena testovima.                                                                                                                                                                                                                              | 8 SDK testova (pravi SDK + TCP proxy), 8 React testova |

## 2. Arhitektura sučelja

- `src/app/App.tsx` (shell + sesija), `src/app/screens.tsx` (prijava / nema pristupa / greška, isti tekstovi i `role`ovi kao u P1).
- `src/app/ui/InventoryApp.tsx` — vrata stanja (`loading`, `error`, `inconsistent`, `tree-corrupt`, `stale`, `ready`), zaglavlje, donja navigacija, ekran „Više" (račun, odjava, provjera pristupa, veza). Račun/odjava dostupni i dok inventar još nije potvrđen.
- `src/app/ui/{Browse,Forms,Move,parts}.tsx` — ekrani, obrasci, odredišta, trake statusa, dijalog.
- `src/app/ui/nav.ts` — navigacija u memoriji + zaštita nespremljenih izmjena + Android Back (jedan „sentinel" zapis povijesti; **ništa privatno u URL-u ni u povijesti**).
- `src/app/ui/model.ts` — izvedene putanje i brojači (deduplicirano po `Item.id`, uključuje podstablo) **uvijek iz `parentId`**.
- `src/search/{normalize,synonyms,search}.ts` — lokalna pretraga; indeks se gradi iz server-potvrđenih podataka (`useMemo`), nema mrežnih upita po znaku.
- `src/inventory/useInventory.ts` — `run(label, fn, {verify, onApplied})`, `checkUnknown()`, `clearStatus()`; stanje `unknown` odvojeno od `error`.

## 3. `outcome-unknown` pri stvaranju predmeta — analiza i odluka

**Problem.** U P2-B su ID-evi (`itemId`, `placementId`) nastajali _unutar_ `createItemWithPlacement`. Kad veza padne nakon što je transakcija stigla do commita, repozitorij baca `outcome-unknown` **bez ID-eva**, pa korisnički sloj ne može ni provjeriti ni sigurno ponoviti. Provjera po _nazivu_ je nepouzdana (dva predmeta mogu imati isti naziv; predmet iste osobe na drugom uređaju) i zabranjena nalogom.

**Rješenje (izmjena ugovora, testovi napisani prije UI-ja).**

1. `newCreateAttempt()` — UI sprema `{itemId, placementId}` **prije** slanja (stanje obrasca). `createItemWithPlacement({… attempt})` koristi baš te ID-eve. Bez `attempt` ponašanje je kao u P2-B.
2. **Idempotentni ponovni pokušaj**: transakcija prije pisanja čita `items/{itemId}` i `placements/{placementId}`. Ako već postoje i povezani su (`placement.itemId === itemId`, ista vrsta) ⇒ **ne piše se ništa**, rezultat `alreadyExisted: true`. ID zauzet _drugim_ zapisom ⇒ odbijeno, ništa se ne prepisuje. Ponovljeni (čak i dvostruki) pokušaj stoga **ne može stvoriti duplikat**.
3. `repo.verify(spec)` — samo čitanje, **server-potvrđeno** (`getDocFromServer`), po identitetu/verziji, nikad po nazivu. Rezultat: `applied` / `not-applied` / `changed-elsewhere` / `unknown` (server nedostupan). Specifikacije: `createItem`, `createLocation`, `addPlacement` (ključ `placementKeys`), `updateItem`, `renameLocation`, `moveLocation`, `movePlacement` (verzija `expected+1` **i** vrijednost jednaka namjeravanoj).
4. UI: nerazriješen ishod blokira sve nove upise dok korisnik ne pritisne **„Provjeri stanje"**; nikad automatsko ponavljanje. `applied` ⇒ kao uspjeh (otvara predmet, „Spremljeno · potvrđeno online"); `not-applied` ⇒ „NIJE pronađena na poslužitelju", unos sačuvan, izričit ponovni pokušaj s **istim ID-evima**; `unknown` ⇒ ostaje neodređeno; `changed-elsewhere` ⇒ poruka o konfliktu.
5. `createLocation` prima neobavezni `id` (isti mehanizam); `addPlacement` se provjerava preko determinističkog ključa.

**Rezidualni rizik (dokumentiran, ne skriven).** „Odsutno" je dokaz _u trenutku čitanja_. Ako bi se zakašnjeli commit iz prekinute veze ipak primijenio nakon provjere, ponovni pokušaj **s istim ID-evima** i dalje je siguran (idempotentan). ID-evi pokušaja žive dok je obrazac montiran: ako korisnik napusti obrazac, vidi nerazriješeno upozorenje, a provjera kaže „nije pronađeno", novi unos dobiva nove ID-eve — u tom (teorijskom) slučaju zakašnjeli original mogao bi stvoriti duplikat koji korisnik vidi u pretrazi. Mogući daljnji korak (P2-D/P3, odluka glavnog razvoja): trajno držati ID-eve nerazriješenog pokušaja u memoriji aplikacije do razrješenja.

## 4. Pretraga — primjeri iz naloga (stvarni rezultati)

| Upit                                | Rezultat                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `aku busilca` (tipfeler)            | „Aku bušilica" u zasebnoj skupini **Približni rezultati** (oznaka „približno"), nije u glavnim rezultatima  |
| `aku busilica`                      | glavni rezultat, prvi                                                                                       |
| `durdjevak`, `đurđevak`, `DURDEVAK` | „Đurđevak ukras" (normalizacija + sinonim iz podataka)                                                      |
| `spajza`                            | lokacija „Špajza" prva među mjestima; predmeti u njoj (Mljevena paprika, Sol, Riža…) preko izvedene putanje |
| `AA baterije`                       | točan naziv (rang `name`) prvi; u rezultatu **sve putanje** predmeta s više smještaja                       |
| `aku busilca random` (negativno)    | **nijedan predmet** (svaka riječ upita mora pokriti posebnu riječ izvora; „random" ne pokriva ništa)        |
| `odvijac` / `sarafciger`            | „Križni odvijač" (alias iz podataka + ugrađena skupina)                                                     |
| `ladica 1`                          | obje različite „Ladica 1" (različita mjesta)                                                                |

Rangiranje: `name` < `alias` < `prefix` < `partial` < `synonym` < `metadata` < `approx`; unutar ranga po ocjeni pa po nazivu (hr). Toleranca tipfelera: riječi < 4 znaka 0, 4–6 znakova 1, ≥ 7 znakova 2. Indeks 5000 predmeta pretražen < 1,5 s (test); stvarno vrijeme izvedbe nije mjereno na Androidu (**NOT VERIFIED**).

## 5. Rezultati (stvarno izvršeno)

| Provjera                                                                                                                               | Rezultat                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `typecheck`, `lint`, `prettier --check` (`src scripts sdk-tests eslint.config.js`), `check:no-actions`, `guard:rules` (`157feee0f7ca`) | PASS                                                                                                                                                   |
| `build`                                                                                                                                | PASS — JS 857 kB / **255 kB gzip** (P2-B: 246 kB); CSS 22,8 kB / 5,9 kB gzip                                                                           |
| **Vitest (jsdom + Node)**                                                                                                              | **180/180**, 13 datoteka (P2-B: 146): `InventoryApp` 53 · `App` 27 · `session` 18 · `search` 17 · `prod-guard` 17 · `gate` 14 · `policy` 6 · ostalo 28 |
| `test:rules` (pravila nepromijenjena)                                                                                                  | **220/220**, 12 datoteka                                                                                                                               |
| **`test:sdk`** (pravi SDK + produkcijski moduli + Auth/Firestore emulatori)                                                            | **82/82** (P2-B: 74): `repository` 51 · `watch` 11 · `isolation` 8 · **`verify` 8 (novo)** · `offline` 4                                               |
| `test:e2e` (P1 regresija, Chromium)                                                                                                    | **14/14**                                                                                                                                              |
| **`test:e2e:inventory` (Chromium, dva korisnika, 5 širina)**                                                                           | **38/38** (P2-B: 20)                                                                                                                                   |
| `build:prod` + `guard:dist` (sintetska konfiguracija `home-inventory-pwa-218be`/`kuca1`, **ništa objavljeno**)                         | PASS — 9 datoteka; bez emulatora, bez demo podataka (vidi §6)                                                                                          |
| P0/P1.5 PWA offline ljuska (Chromium, `vite preview`, `setOffline(true)` + reload)                                                     | PASS                                                                                                                                                   |
| Širine **320, 390, 430, 768, 962 px** (Početna, Lokacije, Dodaj, Više + pretraga)                                                      | PASS: bez vodoravnog pomaka, donja navigacija cijelom širinom, ciljevi dodira ≥ 40 px (INV-R1)                                                         |
| Android uređaj, TalkBack, soft tipkovnica, pravi Google popup/redirect, instalirana PWA                                                | **NOT VERIFIED**                                                                                                                                       |
| Produkcijski Firebase (kvote, Rules limiti, `kuca1`), deploy pravila REV-04                                                            | **NOT STARTED / NOT VERIFIED** (nije objavljeno)                                                                                                       |
| Automatizirani a11y audit (axe/Lighthouse), kontrasti palete                                                                           | **NOT VERIFIED** (nije izvršeno)                                                                                                                       |

Ponovljeno bez novih ovisnosti i bez GitHub Actions. Sve ručno pokretano u ovom okruženju.

### Pokrivenost zahtjeva (UX → test)

| Zahtjev v0.3.3.1                                                  | Testovi                                                                                                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UX-033-01 globalno dodavanje bez lokacije; iz lokacije predloženo | React „globalno dodavanje…", „iz lokacije…"; E2E INV-5, INV-5b, INV-5d                                                                                  |
| UX-033-02 zadana vrsta „Jedinstveni predmet", vidljiv izbor       | React; E2E INV-5a                                                                                                                                       |
| UX-033-03 vrsta lokacije, soba samo pod Kućom, nema premještanja  | React (3); E2E INV-3, INV-4, INV-4b                                                                                                                     |
| UX-033-04 statusi (spremanje/spremljeno/greška/offline/konflikt…) | React (`Spremljeno` tek nakon potvrde; 5 vrsta neuspjeha čuva unos); E2E INV-10, INV-10b, INV-11, INV-C1/C2                                             |
| UX-033-05 / REV-04 atomarno stvaranje                             | React (jedan poziv, `addPlacement` se ne zove); SDK `verify`; E2E INV-5c                                                                                |
| UX-033-06 učitavanje, integritet, opoziv                          | React (vrata, unmount, revoked); E2E INV-12…INV-16                                                                                                      |
| UX-032-01 nespremljene izmjene                                    | React (9): Ostani / Odbaci / Spremi pa nastavi / odbijeno spremanje / Uredi→Premjesti / kartice / `popstate` / konflikt / inert pozadina; E2E INV-U1…U4 |
| Nema pretplate/upita po znaku                                     | React „port.open i repozitorij se NE zovu pri tipkanju"                                                                                                 |

## 6. Demo podaci i demo kontrole nisu u produkcijskom bundleu

- `scripts/prod-guard.mjs` → `DEMO_MARKERS` (17 nizova: `simulatedWrite`, `__demoSeq`, `fixtureOnly`, `P2_DEMO_HOUSE`, `demo-house`, `testScenarios`, `Demo i statusi`, `set-outcome`, imena iz fixturea…): `guard:dist` odbija build koji ih sadrži (jedan jedinični test prolazi svih 17 markera; plus provjera na stvarnom `dist`).
- `scripts/policy.test.ts`: izvorni kod aplikacije ne uvozi `docs/fixtures` niti sadrži simulirane upise; `src/app` i `src/search` ne uvoze `firebase/firestore` (UI zove samo `InventoryRepository`).
- Ručna provjera `dist/assets/*.js`: 0 pojavljivanja `Garaža`, `Špajza`, `Kuhinja`, `Regal`, `DEMO`, `simulat`, `fixture`. (Jedini `demo` je interni niz Firebase SDK-a; `kuca1` dolazi iz produkcijske konfiguracije.)
- Screenshot harness (`scripts/shots/*`) je razvojni alat izvan produkcijskog builda (`vite build` ima samo `index.html`); koristi lažni port i sintetski fixture.

## 7. Odstupanja od v0.3.3.1

| #   | Odstupanje                                                                                                                                                                          | Razlog                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | Neobavezno polje **„Sinonimi"** u obrascima Dodaj/Uredi predmet (zarez-odvojeno).                                                                                                   | Nalog traži sinonime u pretrazi; `Item.aliases` već postoji u modelu/pravilima. Prototip nije imao polje.  |
| 2   | Tri **ugrađene skupine sinonima** (šarafciger/odvijač, kabel/kabl, daljinski/daljinac).                                                                                             | Nalog traži sinonime; skupina je namjerno mala i označena kao „sinonim" u rezultatu.                       |
| 3   | Predmet **bez smještaja** ima akciju „Dodaj smještaj" (prototip: samo napomena).                                                                                                    | Kontrolirani oporavak prema obvezi iz PR #11/SECURITY (neprilagođeni klijent može stvoriti takav predmet). |
| 4   | **Usporedba pri konfliktu**: kartica „Zapis je promijenjen na poslužitelju" + „Nastavi nad aktualnom verzijom" (nacrt ostaje).                                                      | Točka 4 `OPEN_POINTS` (integracijski zahtjev P2-C); bez automatskog prepisivanja.                          |
| 5   | Traka statusa ima **„Zatvori poruku"**; nepoznat ishod ima „Provjeri stanje".                                                                                                       | Povezuje UX-033-04 sa stvarnim `verify`.                                                                   |
| 6   | Zaglavlje prikazuje **naziv kućanstva i vrijeme potvrde pristupa** (prototip: demo tekst). Ikona zupčanika vodi na „Više".                                                          | Zadržava P1 jamstva (nepotvrđeni pristup mora biti vidljiv).                                               |
| 7   | **Više** sadrži račun, provjeru pristupa, odjavu, stanje veze i brojače; sve demo kontrole uklonjene. Račun/odjava dostupni i u stanjima učitavanja/greške.                         | Nalog: bez demo kontrola; korisnik se uvijek mora moći odjaviti.                                           |
| 8   | Ikone predmeta **generičke po vrsti** (prototip: emoji po demo ID-u).                                                                                                               | Demo ID-evi ne smiju u produkciju.                                                                         |
| 9   | Kartica **Dodaj** onemogućena i kad nema veze/potvrđenog prikaza (prototip: samo kad nema roota). Back s kartice vodi na Početnu.                                                   | Konzistentno s „samo pregled"; Android Back.                                                               |
| 10  | Stanje „Opozvan pristup" koristi karticu prijave s naslovom **„Članstvo je opozvano"**; opoziv otkriven revalidacijom pristupa i dalje daje „Nemaš pristup" (postojeći P1 testovi). | Bez promjene P1 ponašanja; opoziv iz podatkovnog sloja razlikovan (`denied.revoked`).                      |
| 11  | Fontovi: **sistemski stog** (Manrope/Inter se ne učitavaju).                                                                                                                        | Nema vanjskih zahtjeva ni datoteka; kao u prototipu.                                                       |
| 12  | UX-032-01 ugrađen u obrasce **Uredi predmet** i **Uredi lokaciju** (ne u obrasce za dodavanje).                                                                                     | Handoff definira zaštitu za Edit stanje.                                                                   |
| 13  | Dijalog zatvara pozadinu (`inert`), a pri promjeni zaslona fokus ide na glavni sadržaj.                                                                                             | Pristupačnost (TalkBack nije verificiran).                                                                 |

`CLAUDE.md` je pod vlasnikovom kontrolom i nije mijenjan (njegov odjeljak „Trenutačno" još navodi P1).

## 8. Preostala ograničenja prije P2-D

1. **Android/TalkBack/soft tipkovnica/rukavice/font scale** i pravi Google login nisu provjereni (Chromium emulacija nije prihvat). Obavezan vlasnikov test u P2-D.
2. **Pravila REV-04 (`157feee0f7ca`) nisu objavljena**; moraju se objaviti prije ili zajedno s aplikacijom (vlasnikova odluka). Rules i dalje ne mogu zahtijevati da predmet ima smještaj (prihvaćeno, PR #11).
3. **Nepoznat ishod:** ID-evi pokušaja žive dok je obrazac montiran (§3, rezidualni rizik). `verify` za izmjene vraća `changed-elsewhere` ako netko drugi odmah nakon naše promjene opet izmijeni zapis (ishod ostaje nedokaziv; korisnik vidi aktualno stanje).
4. **Paleta i fontovi** su još „kandidat"; kontrasti nisu mjereni alatom; nije rađen axe/Lighthouse audit.
5. **Pretraga:** ugrađeni sinonimi minimalni; nema morfologije (npr. padeži) osim tolerancije tipfelera; indeks se gradi iznova pri svakoj promjeni podataka (O(n), mjereno samo sintetski do 5000 predmeta); liste nisu virtualizirane.
6. **Nema arhiviranja** predmeta/lokacija u UI-ju (`OPEN_POINTS` t. 11) niti brisanja; sve su odluke izvan opsega P2.
7. **Usporedba pri konfliktu** pokriva naziv/kategoriju/bilješku (bez spajanja polje-po-polje).
8. **Android Back:** koristi jedan zapis povijesti („sentinel"); s Početne Natrag napušta aplikaciju. Ponašanje u instaliranoj PWA na stvarnom Androidu **NOT VERIFIED**.
9. Jedan JS paket 857 kB (255 kB gzip), bez dijeljenja koda.
10. Oštećeno stablo i `inconsistent`: popravak i dalje ručno u Firebase Console pod nadzorom vlasnika.

## 9. Screenshotovi (`docs/screenshots/p2c/`)

Producijski React (Vite + prave komponente), Chromium 390×780 @2×, 320 / 962 px gdje je naznačeno; podaci su sintetski E2E (`E2E kuća`) ili demo fixture (harness, oznaka `DEMO (samo screenshot)`). Slike su sažete (128 boja) radi veličine repozitorija.

| Datoteka                                                                      | Stanje                                                       |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `00_prijava_offline_390`                                                      | PWA ljuska bez veze (prijava)                                |
| `01_pocetna_390`, `19_pocetna_tablet_962`                                     | Početna + pretraga (tablet 962)                              |
| `22_pretraga_320`, `22b_pretraga_priblizno_390`                               | pretraga 320 px; približni rezultati                         |
| `02_…`, `03_…`, `04_dodaj_iz_garaze_390`                                      | Dodaj globalno (bez lokacije), vrsta, iz lokacije            |
| `05_…`, `06_nova_prostorija_390`                                              | Nova lokacija, odabir vrste; prostorija (roditelj zaključan) |
| `07_predmet_dva_smjestaja_390`, `08_uredi_readonly_390`                       | Dva smještaja; Uredi (lokacije samo za čitanje)              |
| `09_premjesti_kutiju_390`, `21_premjestanje_390`, `20_dodavanje_tablet_962`   | Premještanje kutije/predmeta; dodavanje na tabletu           |
| `10_nespremljene_izmjene_390`, `…_dijalog_390`                                | UX-032-01                                                    |
| `11_konflikt_390`, `11c_konflikt_greska_390`                                  | Konflikt (usporedba); odbijeno spremanje                     |
| `11_nepoznat_ishod_390`, `11b_…_provjera_bez_veze_390`                        | Ishod nepoznat; provjera bez veze                            |
| `12_atomsko_dodavanje_spremanje_390`                                          | „Spremanje…" jedne atomarne operacije                        |
| `13_samo_pregled_bez_veze_390`, `13b_stale_…_390`                             | Offline / samo pregled                                       |
| `14_ucitavanje_390`, `15_osteceno_stablo_390`, `23_nedosljedno_kucanstvo_390` | Učitavanje; oštećeno stablo; `inconsistent`                  |
| `16_opozvan_pristup_390`                                                      | Opozvano članstvo                                            |
| `17_prazna_kuca_390`, `18_nepripremljeno_kucanstvo_390`                       | Prazna kuća; priprema kućanstva                              |

## 10. Kako ponoviti

```bash
npm run check && npm run check:no-actions
npm run test:rules && npm run test:sdk
npm run test:e2e && E2E_SHOTS=docs/screenshots/p2c npm run test:e2e:inventory
E2E_SHOTS=docs/screenshots/p2c node scripts/shots/capture.cjs   # screenshotovi stanja (lažni port)
```
