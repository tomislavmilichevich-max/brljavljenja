# P2 — matrica prihvatnih testova

Verzija P2-AT-01 · 2026-11-07. Svi testovi za sintetsko kućanstvo iz `docs/fixtures/P2_DEMO_HOUSE.json`, samo Firestore Emulator Suite / lokalni UI test.

## A. Model i integritet

| ID | Scenarij | Očekivano |
|---|---|---|
| MD-01 | Jedna root lokacija, 6+ prostorija i podlokacije različite dubine | Puna putanja izračunata, nijedan parent nije nedostupan |
| MD-02 | Dvije „Ladica 1” u različitim ormarima | Obje su dopuštene i prikazane s različitom putanjom |
| MD-03 | Premještanje kutije koja sadrži podlokacije | Promijeni se samo njezin parent, Item/Placement reference netaknute |
| MD-04 | Premještanje kutije u samu sebe | Blokirano |
| MD-05 | Premještanje kutije u vlastitog potomka | Blokirano |
| MD-06 | Istodobno A u B i B u A na različitim uređajima | Transakcija/lock sprječava ciklus |
| MD-07 | Premještanje u istog roditelja | Nema nepotrebnog upisa; razumljiva poruka |
| MD-08 | Brisanje/arhiviranje lokacije sa sadržajem ili potomkom | Blokada s objašnjenjem, ništa se ne briše |
| MD-09 | Jedan Item `type` na dvije lokacije | Dva odvojena Placementa, prikazana oba |
| MD-10 | Jedan Item `unique` na dvije lokacije | Odbijeno i na serveru, ne samo vizualno |
| MD-11 | Dva Placementa istog Item na istoj lokaciji u paralelnim transakcijama | Maksimalno jedan uspije |
| MD-12 | Pokušaj Placementa s nepostojećim itemId / locationId | Odbijen |
| MD-13 | Premjesti samo odabrani od dva Placementa | Drugi ostaje nepromijenjen |
| MD-14 | Odbij klijentsku izmjenu immutable ID-a, createdAt, createdBy | Odbijeno |
| MD-15 | Premjesti roditelja i odmah preimenuj nadređenu lokaciju | Ispravno se prikažu nove putanje |
| MD-16 | Dvije paralelne online promjene istog Placementa | Nema tihog prepisivanja; konflikt/ponovna provjera |
| MD-17 | Različiti Itemi mijenjaju se paralelno | Oba upisa uspiju bez nepotrebnih blokada |
| MD-18 | Arhiviranje Itema sa smještajima | Nema skrivenih aktivnih smještaja ili gubitka podataka |

## B. Security Rules — s pravim emulator pravilima

| ID | Scenarij | Očekivano |
|---|---|---|
| ACL-21 | A i B aktivni članovi: get/list locations/items/placements | ALLOW |
| ACL-22 | A i B aktivni članovi: dopušteni create/update/arhiviranje | ALLOW prema strogoj shemi |
| ACL-23 | Neprijavljen UID čita ili piše inventar | DENY |
| ACL-24 | Treći validni UID bez članstva čita/piše inventar | DENY |
| ACL-25 | `enabled:false` odbijen na get/list/create/update/delete | DENY |
| ACL-26 | Član drugog household-a pokušava čitati/kopirati tuđe dokumente | DENY |
| ACL-27 | A pokušava mijenjati `members/{uid}`, uloge ili household | DENY |
| ACL-28 | A pokušava pisati `appliedOps` ili nepoznatu putanju | DENY |
| ACL-29 | Upis dodatnih neodobrenih polja / pogrešnih tipova | DENY |
| ACL-30 | Pokušaj zaobilaženja `version` i owner polja | DENY |
| ACL-31 | Test kontra mutacije: namjerno otvoreni read/write | Sigurnosni test MORA pasti |
| ACL-32 | Testovi validiraju stvarni `firestore.rules` i više UID-a | PASS, bez produkcijskih podataka |

## C. Funkcionalni UX / pretraga

| ID | Scenarij | Očekivano |
|---|---|---|
| UX-01 | Početna odmah nudi „Što tražiš?” | Pretraga dominantna, bez ulaska u Lokacije |
| UX-02 | Naziv, alias, prefiks, podniz, metapodatak, fuzzy | Očekivano rangiranje i odvojeni „Približni rezultati” |
| UX-03 | `aku busilca`, `AKU BUSILCA`, `imbus` | Pronalazi očekivani Item |
| UX-04 | `durdevak`, `durdjevak`, `spajza`, `cekic` | Radi hrvatska normalizacija |
| UX-05 | `aku busilca random` | Ne daje lažan pozitivan pogodak |
| UX-06 | Item na dvije lokacije | Prikazuje obje pune putanje |
| UX-07 | Sadržaj lokacije | Razdvojeni izravni Itemi od podlokacija |
| UX-08 | Broj „X vrsta predmeta” u podstablu | Deduplikacija po itemId |
| UX-09 | Jedan smještaj: Premjesti → brza destinacija | Do 2 dodira, bez dodatnog potvrđivanja |
| UX-10 | Dva smještaja: odabir izvora prije destinacije | Ne pomiče se drugi |
| UX-11 | Edit jednog ili više smještaja | Lokacije read-only, bez promjene Placementa |
| UX-12 | UX-032-01: nespremljeni naziv pa odlazak iz Edit | Spremi/Odbaci/Ostani, bez tihog gubitka |
| UX-13 | Iz Edit bez promjena otvori Move | Bez nepotrebnog dijaloga |
| UX-14 | Offline pokušaj spremanja | Jasno odbijeno; nema skrivenog pending reda |
| UX-15 | Prijava drugog Google računa na istom uređaju | Nijedan prethodni Item/putanja ne procuri |
| UX-16 | Opoziv člana dok je UI otvoren | Uklonjen prikaz, uklonjene pretplate i lokalni podaci |
| UX-17 | Tipkovnica, TalkBack/fokus, dugo ime, 320–962 px | Bez preklapanja i horizontalnog overflowa |
| UX-18 | Popis/Skeniraj u P2 | Jasno označene buduće funkcije, bez lažnog rada gumba |

## D. Lokalni testovi i dokaz

- `npm run check`, `npm run check:no-actions`, svi P0/P1/P1.5 testovi moraju ostati PASS.
- Novi Rules testovi moraju koristiti stvarni emulator, stvarne rules i sintetske UID-ove.
- Chromium E2E uz dva emulatorska računa, offline i concurrency testovi. Brojeve testova prijaviti točno, bez izmišljanja.
- Demo seed unutar emulatora, ne u `households/kuca1`.
- Provjera da nema P2 fotografija, Cloud Functions, Firebase Storage, Blaze, GitHub Actions ili drugih plaćenih servisa.
- Svi novi dokumenti imaju status PASS/FAIL/BLOCKED/NOT VERIFIED, zapise naredbi i hash testiranih pravila.
- **Stvarni Android/2 stvarna uređaja**: nakon reviewa i owner odobrenog deploya, ne prije.

## E. Go / No-go

**P2-A** može prijeći u P2-B tek kad MD-05/06/10/11/12/16/17 i ACL-21–32 imaju dokazivu shemu i pravila (ili glavni razvoj izričito odluči o ograničenju). Ako ne: BLOCKED i tražiti odluku, bez prešutnog pojednostavljivanja.

**P2 final** nije završen dok su realni korisnički testovi neprovedeni, a funkcionalnosti nisu potvrđene na Androidima. Zadržati P3 kao odvojeni projektni zadatak.
