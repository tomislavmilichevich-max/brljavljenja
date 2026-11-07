# P2_D1_TEST_REPORT — predprodukcijska verifikacija (P2-D1)

Datum: 2026-11-07 · Grana: `p2d1/preprod-verification` (iz `main` nakon PR #14) · Okruženje: Claude Code cloud (Linux, Node 22, Java 21, firebase 13.2.0, firebase-tools 15.35.0, Chromium/Playwright predinstalirani).
Statusi: **PASS** · **FAIL** · **BLOCKED** · **NOT VERIFIED** · **INVALID**.

**Preporuka: CONDITIONAL GO za kontrolirani Android pilot (P2-D2)** — uvjeti u §7. Zeleni emulatori i Chromium **ne** dokazuju rad na stvarnom Androidu; P2-D2 se ne smatra spremnim samo na temelju ovog izvještaja.

Nije izvršeno ništa u produkciji: bez deploya, bez bootstrapa, bez upisa u `kuca1`, bez promjene pravila, bez GitHub Actions, bez novih ovisnosti.

## 1. Završna regresija (valjani, serijski prolaz)

Jedna skripta izvodi korake **jedan za drugim** (nikad paralelno; emulatori/portovi/testni podaci se ne dijele između procesa), nad konačnim kodom grane (commit `f8db6eb` + ovaj izvještaj i screenshotovi).

| Provjera                                                                                                                                      | Rezultat                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Prettier (`src scripts sdk-tests eslint.config.js`)                                                                                           | PASS                                                                                             |
| Typecheck (`tsc -b`), Lint (`eslint .`)                                                                                                       | PASS / PASS                                                                                      |
| **Vitest** (jsdom+Node)                                                                                                                       | **195/195**, 13 datoteka — izvršeno **5 uzastopnih puta, 5×195/195 (bez nestabilnosti)**         |
| **Firestore Rules** (`test:rules`)                                                                                                            | **220/220**, 12 datoteka                                                                         |
| **SDK + emulator** (`test:sdk`)                                                                                                               | **92/92**, 5 datoteka (`repository` 51 · `verify` 18 · `watch` 11 · `isolation` 8 · `offline` 4) |
| **P1 E2E** (`test:e2e`, Chromium)                                                                                                             | **14/14**                                                                                        |
| **Inventory E2E** (`test:e2e:inventory`, Chromium, dva korisnika, 5 širina)                                                                   | **38/38**                                                                                        |
| `check:no-actions`, `guard:rules` (sha256 `157feee0f7ca`)                                                                                     | PASS / PASS                                                                                      |
| Produkcijski build `build:prod` + **`guard:dist`** (sintetska konfiguracija `home-inventory-pwa-218be`/`kuca1`, ništa objavljeno)             | PASS — 9 datoteka; JS 861 kB / **259 kB gzip**, CSS 23,7 kB / 6,1 kB gzip                        |
| Demo podaci u bundleu (ručni `grep` u `dist/assets/*.js`: `Garaža`, `Špajza`, `Kuhinja`, `Regal`, `DEMO`, `simulat`, `fixture`, `Aku svrdla`) | **0 pojavljivanja** svake (uz 17 markera `guard:dist`)                                           |
| **PWA offline app-shell** (`vite preview`, Chromium `setOffline` + reload)                                                                    | PASS                                                                                             |
| A11y/mobilni skript (`scripts/a11y-check.cjs`)                                                                                                | **43/43** (vidi §2)                                                                              |

### INVALID: prvi regresijski prolaz

Prvi prolaz je pokrenut **greškom dvaput istodobno** (dva pozadinska posla su dijelila Firestore/Auth emulatore i portove). Njegovi SDK/E2E izlazi bili su prazni/nepouzdani; **proglašen INVALID i nije uračunat ni u jedan broj gore.** Uzrok je bio moj postupak (preklapanje procesa), ne regresija koda. Drugi pokušaj (`run2`) je također **prekinut ručno** prije kraja jer sam usred izvođenja otkrio dodatne probleme s kontrastom i izmijenio kod; ni on nije uračunat. Brojke iznad dolaze isključivo iz jednog neprekinutog serijskog prolaza nad konačnim kodom.

### Nestabilnosti

- Tijekom P2-C/REV nađena je i ispravljena utrka (`statusRef`, klik odmah nakon prikaza bannera ignoriran); u završnom prolazu **0 nestabilnih testova u 5 izvođenja**.
- Nijedan test nije pao u valjanom prolazu; nije bilo ponovnog pokretanja radi „zelenila".

## 2. Pristupačnost (Chromium emulacija; **nije** provjera na fizičkom Androidu)

Izvor: `scripts/a11y-check.cjs` nad **pravim produkcijskim komponentama** (lažni port + sintetski fixture), alat axe-core 4.10.2 (besplatan, instaliran izvan repozitorija, **nije ovisnost projekta**).

### A. Automatizirane axe provjere (zasebno)

| Stavka                               | Vrijednost                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Izvršenih axe prolaza                | **21** (15 zaslona/stanja uz prirodnu pozadinu + 6 uz „plošnu" pozadinu, vidi dolje); skup pravila: wcag2a, wcag2aa, wcag21a, wcag21aa, best-practice                                                                                                                                                  |
| Zasloni/stanja                       | Početna, pretraga (približni, više putanja), Lokacije, Sadržaj lokacije, Dodaj predmet (+ greške validacije), Više, Detalj, Premjesti, Uredi, dijalog nespremljenih izmjena, traka greške (konflikt), traka nepoznatog ishoda, potvrda odustajanja                                                     |
| **Nalazi prije ispravaka**           | prvi prolaz (12 prolaza): **2 prolaza pala**, oba isti čvor `.kind-choice.selected small` — `color-contrast`, ozbiljnost _serious_. Prolaz uz plošnu pozadinu otkrio je još **1 čvor** (`.locationhero small`, `color-contrast`, _serious_). Ukupno **3 pojavljivanja / 2 elementa**, jedna kategorija |
| **Nalazi nakon ispravaka**           | **0 kršenja** u svih 21 prolaza (zbroj prošlih pravila 630)                                                                                                                                                                                                                                            |
| Kategorije/ozbiljnost                | isključivo `color-contrast` / _serious_; nijedan _critical_, nijedan strukturni (nazivi, ARIA, naslovi, jezik)                                                                                                                                                                                         |
| **Ograničenje alata ("incomplete")** | na zaslonima s gradijentom pozadine axe **ne može odlučiti** kontrast (10–20 čvorova po zaslonu, `color-contrast`). Zato: (a) ponovljeni prolazi s plošnom, najtamnijom pozadinom, i (b) ručno izmjerena paleta u dijelu B                                                                             |
| Preostala kršenja                    | **nema**                                                                                                                                                                                                                                                                                               |

### B. Ručne / skriptirane provjere (22 provjere, **nisu** axe testovi)

Ukupno 43/43 = **21 axe + 22 skriptiranih/ručno definiranih provjera**. Ovih 22 su zasebne od axe-a:

| Područje                                     | Provjera (broj)                                                                                                                                        | Rezultat |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Modal nespremljenih izmjena (5)              | fokus ulazi u dijalog; 8× Tab ne izlazi (pozadina `inert`); `aria-modal` + `aria-labelledby`; Escape = „Ostani ovdje" uz sačuvan tekst; fokus se vraća | PASS     |
| Tipkovnica (3)                               | Tab dosiže pretragu, zupčanik i kartice; svaka fokusirana kontrola ima vidljiv indikator; Enter na rezultatu otvara detalj                             | PASS     |
| Nazivi (1)                                   | svaka vidljiva kontrola ima pristupačni naziv                                                                                                          | PASS     |
| Poruke o pogreškama (2)                      | polje: `aria-invalid`, `aria-describedby`, `role=alert`, fokus na prvo neispravno polje; traka statusa: `role=alert`                                   | PASS     |
| Reflow (1)                                   | 320/390/430/768/962 px + zoom 200 % (195 i 160 CSS px): bez vodoravnog pomaka i odsječenog teksta, donja navigacija vidljiva                           | PASS     |
| Povećanje teksta (2)                         | emulacija ×1,3 i ×2 (izračunati `font-size` svakog elementa, **nije** pravi Android font scale): bez pomaka/odsječenja, navigacija vidljiva            | PASS     |
| Kontrast kontrola (2)                        | granica polja ≥ 3:1 (mjereno 3,71); fokus ≥ 3:1 na kartici i pozadini (12,6/13,5 u skriptiranom mjerenju)                                              | PASS     |
| Soft tipkovnica, emulacija visine 330 px (2) | fokusirano polje nije ispod donje navigacije; gumb „Dodaj predmet" dohvatljiv pomicanjem                                                               | PASS     |
| Dijalog 320×520 (1)                          | cijeli unutar zaslona                                                                                                                                  | PASS     |
| Zatvaranje aplikacije (1)                    | osvježavanje tijekom nepoznatog ishoda: nema registra ni privatnog unosa (ograničenje)                                                                 | PASS     |
| Odustani (2)                                 | fokus na „Vrati se"; Escape zatvara bez odustajanja                                                                                                    | PASS     |

**Ispravljeno (a11y):** (1) sekundarni tekst `--muted` #687469→#566257; (2) „eyebrow" 3,87→4,78, „crumb" 3,70→4,93, podredak zaglavlja 4,09→5,08, podnaslov hero lokacije →5,71 (**ova četiri su otkrivena ručnim mjerenjem/plošnim prolazom, axe ih zbog gradijenta nije mogao odlučiti**); (3) granica polja ~1,4:1→3,71:1; (4) indikator fokusa 2,3:1→5,2:1 (#78afc6→#1f6f94); (5) reflow: zaglavlje, donja navigacija (`minmax(0,1fr)`), hero-ilustracija i kartice se prelamaju na uskim širinama (195 px) i pri povećanom tekstu; (6) dijalog je `inert` za pozadinu, fokus ide na glavni sadržaj pri promjeni zaslona. Dvije prve „pad" stavke u skriptu bile su **greške samog testa** (skriveni `sr-only` label računat kao odsječen; emulacija fonta udvostručavala nasljeđivanje) i ispravljene su u alatu, ne u aplikaciji.

### Izmjereni kontrasti (WCAG 2.1 AA) — metoda

Relativna luminancija prema WCAG formuli, omjer (L1+0,05)/(L2+0,05) na **najnepovoljnijoj** pozadini (za gradijente: krajnje točke). Tekst ≥ 4,5:1, nesadržajne komponente/fokus ≥ 3:1. Mjereni skup su tokeni boja iz `src/app/app.css` koji nose tekst ili granice kontrola.

| Komponenta                                 | Boja      | Pozadina                                    | Min. omjer | Prag  | Rezultat |
| ------------------------------------------ | --------- | ------------------------------------------- | ---------- | ----- | -------- |
| Tekst (ink)                                | `#243225` | #ffffff / #faf7ef                           | **12.59**  | 4.5:1 | PASS     |
| Sekundarni tekst (`--muted`, bilo #687469) | `#566257` | kartica, stranica, odabrana vrsta, surface2 | **5.70**   | 4.5:1 | PASS     |
| Primarni gumb: bijeli tekst                | `#ffffff` | #4d814a                                     | **4.61**   | 4.5:1 | PASS     |
| Zeleni tekst (greenDark)                   | `#315d31` | bijela / greenSoft                          | **6.60**   | 4.5:1 | PASS     |
| Oznaka „eyebrow” (bilo #75845d)            | `#5a6a42` | krajevi gradijenta hero (#fff3de…#f1e7d2)   | **4.78**   | 4.5:1 | PASS     |
| Putanja „crumb” (bilo #7d826f)             | `#5f6552` | stranica / gradijent                        | **4.93**   | 4.5:1 | PASS     |
| Podredak zaglavlja (bilo #847761)          | `#6b5f4b` | stranica / gradijent                        | **5.08**   | 4.5:1 | PASS     |
| Podnaslov hero lokacije (bilo #718068)     | `#4f5d49` | gradijent #f1e7d2…#fff8ea                   | **5.71**   | 4.5:1 | PASS     |
| Traka greške/konflikta                     | `#914b34` | #fff0e9                                     | **5.80**   | 4.5:1 | PASS     |
| Traka nepoznatog ishoda                    | `#805625` | #f8edda                                     | **5.53**   | 4.5:1 | PASS     |
| Traka spremanja                            | `#285873` | #eaf3f8                                     | **6.83**   | 4.5:1 | PASS     |
| Traka spremljeno                           | `#245b2b` | #e8f3e2                                     | **7.04**   | 4.5:1 | PASS     |
| Koraljni gumb (Odustani ipak, Odjava)      | `#a54c35` | #faeee7                                     | **5.01**   | 4.5:1 | PASS     |
| Donja navigacija (neaktivna)               | `#6a736a` | #fffcf7                                     | **4.80**   | 4.5:1 | PASS     |
| Oznake (chip plavi / koralj)               | `#3a728c` | #eaf3f8                                     | **4.71**   | 4.5:1 | PASS     |
| Granica polja (bilo #dfdfd4, ~1,4:1)       | `#7f877b` | #ffffff                                     | **3.71**   | 3:1   | PASS     |
| Indikator fokusa (bilo #78afc6)            | `#1f6f94` | stranica / kartica                          | **5.22**   | 3:1   | PASS     |
| Primarni gumb naspram stranice             | `#4d814a` | #faf7ef                                     | **4.31**   | 3:1   | PASS     |

**Zaključak:** za **izmjereni skup** paleta zadovoljava WCAG 2.1 AA (tekst i nesadržajne komponente). **Nije izmjereno** (navodim izričito): placeholder tekst, tekst preko ilustracija/emojija, izvorni prikaz `<select>`/izbornika i izvorni gumb za brisanje u `type=search`, onemogućene kontrole (izuzete iz AA), te boje u stvarnim uvjetima (sunčeva svjetlost, smanjena svjetlina, tamni način). Boja nigdje nije jedini nositelj značenja (statusi imaju tekst i ikonu), ali to nije posebno mjereno alatom.

### Ostaje NOT VERIFIED

TalkBack/čitač zaslona, fizički Android (stvarna soft tipkovnica, pravi font scale i veličina prikaza, rukavice), visoki kontrast/tamni način, Lighthouse a11y audit.

## 3. „Odustani od pokušaja"

Potvrđeno (React testovi + Chromium skript + screenshot `docs/screenshots/p2d1/11e_odustani_upozorenje_390.png`):

- Odustajanje je **dvostepeno**: prvi dodir samo otvara potvrdu (gumb „Odustani od pokušaja" nestaje s tog mjesta pa dvostruki dodir ne pogađa potvrdu).
- Tekst: „_Prethodna promjena **možda ipak stigne na poslužitelj**: provjera nije dokazala da nikad neće stići. Ako odustaneš pa isti unos upišeš ponovno, može nastati **duplikat**. Prije ponovnog unosa provjeri pretragu. Odustajanje je tvoja **svjesna odluka** i ne može se poništiti._"
- Fokus je na sigurnoj radnji **„Vrati se"** (ne na „Odustani ipak"); Escape = „Vrati se".
- **Android Back** (`popstate`), prelazak na drugu karticu, „Vrati se" i zatvaranje **ne odustaju**: pokušaj ostaje u registru, „Ponovi isti pokušaj" ostaje dostupan. Samo izričit „Odustani ipak" briše pokušaj.
- Novi regresijski testovi: 6 (`P2-D1: "Odustani od pokušaja" se ne može potvrditi slučajno`) + proširen test odustajanja; Chromium skript: fokus i Escape.

## 4. Sigurnost i podaci — dokaz i praznine

| Zahtjev                                                | Dokaz (izvršeno u §1)                                                                                        | Napomena                                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Dva korisnika istodobno                                | SDK `repository` (prisilno preklapanje), `verify` (REV-02: A/B, barijera, prekid veze), E2E INV-9, INV-C1/C2 | PASS                                                                                                                         |
| Odjava i promjena računa                               | E2E INV-14/15/16, P1 E2E-6/7, `App` testovi, SDK `isolation`                                                 | PASS                                                                                                                         |
| Opoziv članstva                                        | E2E INV-12, P1 E2E-8/12, SDK `isolation`/`watch`                                                             | PASS                                                                                                                         |
| Izolacija memorijskog keša                             | SDK `isolation` (8), E2E INV-13 (IndexedDB: nema Firestore keša, auth samo `[DEFAULT]`), `policy.test`       | PASS                                                                                                                         |
| Offline: nema skrivenog reda                           | SDK `offline` (4), E2E INV-10/10b/11, `policy.test`                                                          | PASS                                                                                                                         |
| Nepoznat ishod, provjera, ponovni pokušaj, odustajanje | SDK `verify` (18), 15 React testova (REV-01 + odustajanje)                                                   | pravi SDK + TCP proxy; **ne** na pravom pregledniku (WebChannel prekid u točno pravom trenutku nije izvediv deterministički) |
| Nerazriješeni pokušaj nakon navigacije                 | React testovi (kartice, Back, povratak, promjena lokacije)                                                   | PASS                                                                                                                         |
| Potpuno zatvaranje tijekom nepoznatog ishoda           | Chromium skript (reload u stanju nepoznatog ishoda: registar i unos nestaju), React unmount                  | **prihvaćeno ograničenje** (§6), PASS kao potvrda ponašanja                                                                  |

## 5. Sažetak ispravljenih problema (P2-D1)

Kontrast teksta (5 tokena) i kontrola (granica polja, fokus); reflow zaglavlja/navigacije/hero/kartica na 195 px i pri povećanom tekstu; potvrda s izričitim upozorenjem pri odustajanju (fokus na sigurnu radnju, Escape); pristupni alat `scripts/a11y-check.cjs`; dokumentacija deploya/povrata i Android checklista. Greške **mog procesa** (preklapajući prolaz, prekinut prolaz) navedene u §1.

## 6. Otvoreni i prihvaćeni rizici

| #   | Rizik                                                                                                                                                                              | Status                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| R1  | Registar nerazriješenog pokušaja je samo u memoriji: zatvaranje/osvježavanje briše ID-eve; zakašnjeli original može stvoriti duplikat pri ručnom ponovnom unosu (P2 nema brisanja) | **Prihvaćen** (odluka glavnog razvoja); upozorenja u UI-ju; trajni registar kandidat za P3 |
| R2  | Rules ne mogu zahtijevati da predmet ima smještaj (neprilagođeni klijent)                                                                                                          | **Prihvaćen** (PR #11); obveza u produkcijskom repozitoriju                                |
| R3  | Podaci u Firestoreu se ne mogu automatski vratiti (Spark: nema backupa/PITR)                                                                                                       | **Prihvaćen**, dokumentirano (`P2_D1_DEPLOY_ROLLBACK.md` §9)                               |
| R4  | Nema arhiviranja/brisanja predmeta i lokacija u UI-ju                                                                                                                              | Otvoreno (izvan opsega P2)                                                                 |
| R5  | Paleta/fontovi „kandidat"; sistemski stog fontova; kontrast mjeren samo za navedene tokene                                                                                         | Otvoreno                                                                                   |
| R6  | Jedan JS paket 861 kB (259 kB gzip); liste nisu virtualizirane; pretraga mjerena samo sintetski do 5000 predmeta                                                                   | Prihvaćeno za pilot                                                                        |
| R7  | Android Back koristi jedan „sentinel" zapis povijesti; ponašanje u instaliranoj PWA nepoznato                                                                                      | Čeka P2-D2                                                                                 |
| R8  | `verify` izmjena može dati `changed-elsewhere` ako netko drugi odmah nakon nas izmijeni zapis                                                                                      | Prihvaćeno                                                                                 |
| R9  | Pravila REV-04 još nisu objavljena u produkciji                                                                                                                                    | Uvjet D2 (§7)                                                                              |

## 7. Blokirajući uvjeti prije P2-D2 i preporuka

**Tehnički blokeri u kodu: nema poznatih.** Uvjeti (svi proceduralni, izvan Claude Codea):

1. **Izričito vlasnikovo odobrenje** korake 4, 6 i 7 iz `P2_D1_DEPLOY_ROLLBACK.md` (pravila → Hosting → bootstrap) — pojedinačno.
2. **Sigurnosna kopija** aktualnih pravila i zabilježeno trenutno Hosting izdanje (korak 3) **prije** objave.
3. **Pravila REV-04 objavljena prije aplikacije** (stara pravila ne podržavaju inventar).
4. Potvrđeno (Console, korak 5): Google = Enabled, autorizirane domene, točno dva `members` s `enabled:true`, `households/kuca1` s poljima; **nema** zaostalih kolekcija inventara.
5. Ispravna `.env.production.local` u Cloud Shellu (projekt `home-inventory-pwa-218be`, `kuca1`); `build:prod` bez „ZAUSTAVLJENO".
6. Dogovoren **zamjenjivi testni sadržaj** (podaci se ne mogu automatski vratiti, R3) i dva uređaja s Chromeom; spremnost za TalkBack/font test.
7. Pravila i aplikacija se vraćaju prema §10 ako ijedna _blokirajuća_ stavka checkliste padne.

**Preporuka: CONDITIONAL GO.** Kod, testovi i a11y-alat spremni su za kontrolirani pilot na dva uređaja uz gornje uvjete. **NO-GO** postaje ako uvjeti 2–4 nisu ispunjeni. Preporučeni redoslijed: (1) pregled i spajanje ovog PR-a (vlasnik); (2) vlasnik prolazi korake 1–3 iz deploy dokumenta i javlja ispis; (3) zasebno odobrenje i objava pravila (4); (4) provjera 5; (5) zasebno odobrenje i Hosting (6); (6) bootstrap (7); (7) Android checklista; (8) izvještaj pilota → odluka o P2-D2/P3.

## 8. NOT VERIFIED (ukupno)

Fizički Android, TalkBack, pravi font scale i veličina prikaza, soft tipkovnica na uređaju, instalirana PWA s početnog zaslona, pravi Google login/redirect na uređaju (P1.5 je prethodno testiran ručno, ali ne s ovim sučeljem), dva stvarna uređaja istodobno, produkcijski Firebase (kvote, Rules limiti, `kuca1`), nepoznat ishod na **pravom pregledniku** s pravim WebChannelom, visoki kontrast/tamni način, Lighthouse, mjerenje placeholdera/native kontrola, performanse na stvarnom uređaju.

## 9. Provjera prije PR-a

| Provjera                            | Rezultat                                                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Demo podaci u produkcijskom bundleu | 0 (grep + `guard:dist`)                                                                                                                         |
| Nove ovisnosti / plaćeni servisi    | nema (`package.json`, `package-lock.json` nepromijenjeni; axe izvan repozitorija)                                                               |
| `firestore.rules`                   | nepromijenjen (sha256 `157feee0f7ca`; `git diff` prazan)                                                                                        |
| `.github/workflows`                 | ne postoji (`check:no-actions`)                                                                                                                 |
| Promjene u stvarnom `kuca1`         | nema (ništa deployano ni upisano)                                                                                                               |
| Opseg PR-a                          | samo P2-D1: `src/app/{app.css,ui/parts.tsx,InventoryApp.test.tsx}`, `scripts/{a11y-check.cjs,shots/*}`, `docs/P2_D1_*`, `docs/screenshots/p2d1` |

## 10. Dokumenti i screenshotovi

`docs/P2_D1_DEPLOY_ROLLBACK.md`, `docs/P2_D1_ANDROID_PILOT_CHECKLIST.md`, `docs/screenshots/p2d1/` (uključujući `11d`/`11e` — nije pronađeno / upozorenje pri odustajanju, i `00` — PWA offline).

Ponavljanje: `npm run check && npm run check:no-actions && npm run test:rules && npm run test:sdk && npm run test:e2e && npm run test:e2e:inventory`; a11y: `npm i --no-save axe-core && node scripts/a11y-check.cjs`.
