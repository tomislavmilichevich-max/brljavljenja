# CLAUDE CODE — P2 START / P2-A SAMO MODEL I SIGURNOST

Radiš na privatnom repozitoriju `tomislavmilichevich-max/home-inventory-pwa`. ChatGPT vodi funkcionalnu arhitekturu i reviziju, zasebni ChatGPT razgovor daje UI/UX dizajn, ti si programer, a vlasnik odobrava faze.

**P0, P1 i stvarni P1.5 Android/Spark pilot su završeni.** Projekt: `home-inventory-pwa-218be`, `households/kuca1` je stvarno kućanstvo, bez demo inventara. **NE diraj stvarne podatke**.

## 1. Prije rada pročitaj

- `CLAUDE.md`
- `docs/P2_HANDOFF.md`
- `docs/P2_ACCEPTANCE.md`
- `docs/fixtures/P2_DEMO_HOUSE.json`
- `docs/SECURITY.md`
- `docs/ARCHITECTURE.md`
- `docs/UI_UX_DECISIONS_V0.1.md`

Revidirani dizajn: `docs/UI_UX_REVIEW_V0.3.2.md` u zasebnom draft PR #3. **Originalni HTML prototip v0.3.2 još nije u GitHubu**; ako nije dostavljen u tvoju sesiju, navedi da ga za P2-C trebamo priložiti, nemoj sam izmišljati konačni izgled.

## 2. Trenutno implementiraj SAMO P2-A

**P2-A = model + pravila + sigurnosni i konkurencijski testovi.** Ne implementiraj još zaslone, stvarni inventar, pretragu, seed produkcije, deploy ni P2-B/C/D.

- Pregledaj trenutni `main`, pokreni postojeće testove (uključujući Auth/Rules/E2E), bilježi izlaze.
- Provjeri je li `docs/P2_HANDOFF.md` tehnički dosljedan sa stvarnim P1 kodom i besplatnim Firestore Standardom. Smiješ predložiti izvedbenu shemu i obrazložiti odstupanja; nemoj prešutno mijenjati poslovna pravila.
- Predloži strukturu `Location`, `Item`, `Placement` za dva korisnika, više smještaja, verzioniranje i zaštitu roditeljskih hijerarhija.
- Dokaži kroz Firestore Emulator Suite:
  1. članske kontrole čitanja/pisanja za A/B, nečlan/treći/opozvani UID;
  2. jedinstvenost (itemId, locationId) i najviše jedan aktivan Placement jedinstvenog Itema u utrci;
  3. server-side odbijanje nepostojećih referenci i nedopuštenih polja;
  4. roditeljski stablo i sprječavanje ciklusa, uključujući dvije konkurentne operacije na različitim lokacijama;
  5. transakcijsku provjeru verzije protiv izgubljenog online upisa;
  6. očuvanje nepromijenjenih drugih Placementa;
  7. P1: membership ostaje isključivo read-only, `appliedOps` i dalje deny-all.
- Ako Firestore Rules ne mogu garantirati neku od strogih invarijanti bez server funkcija, dokumentiraj **točan dokaz / reproducibilan failing test i 2–3 izvedive alternative**. Tada **STOP** i traži odluku glavnog razvoja; ne ublažavaj pravilo sam.
- Nema trajne Firestore IndexedDB persistence u P2-A; ne uvodi offline autoqueue.
- Sintetski seed **samo** u emulator `demo-home-inventory-p2` i household `demo-house`. **NE u produkcijsko `households/kuca1`** i ne u pravi Firebase projekt.
- Postojeći P1.5 deploy na proizvodnom projektu ostaje netaknut. Nema prijavljivanja putem pravih korisničkih tokena u testovima.

## 3. Izričita ograničenja

- Trošak 0 €; Firebase **Spark**. Bez Blaze, naplate, Cloud Functions, Firebase Storage, App Hosting, plaćenih API-ja ili dodatnog hostinga.
- **GitHub Actions ostaju isključene.** Testiranje isključivo u Claude Code okruženju s emulatorima.
- Nikad ne spremati OAuth tokene, .env datoteke, servisne ključeve, stvarne fotografije ni privatni inventar u Git.
- Ne prepisivati/P2 seedati produkcijske dokumente.
- Ne implementirati P3 offline sync i Undo, P4 Drive, v0.2 NFC/QR/barcode, v0.3 količine i shopping listu.
- Ne dodavati finalni Organized Cozy dizajn dok glavna razrada odobri P2-C i originalni prototip ne bude dostupan.

## 4. Isporuka P2-A

1. Kratak ADR s točnom shemom, izvorima istine, server-side invarijantama, granicama Firestore Rules i odgovorima na 6 otvorenih pitanja iz P2 handoffa.
2. Implementirana pravila i emulator testovi ili, ako je obavezan zahtjev neprovediv, dokumentiran blocker s alternativama. Ako je Rules implementacija spremna, **ne deployaj je**.
3. Točni testni izlazi `npm run check`, `npm run check:no-actions`, rules i relevantni multi-user E2E, bez izmišljanja.
4. `docs/P2_A_TEST_REPORT.md` s PASS/FAIL/BLOCKED/NOT VERIFIED te konkretnim sigurnosnim rizicima.
5. Zasebna grana i PR na `main`, **bez mergea i bez deploya**; vlasnik i glavni razvoj odlučuju o prihvatu.

**Zaustavi se nakon P2-A.** P2-B (funkcionalni online inventar) počinje tek nakon pregledanih sigurnosnih dokaza.
