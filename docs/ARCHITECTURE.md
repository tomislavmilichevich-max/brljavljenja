# Kućni inventar — arhitektura i granice faza

Status: **P0 implementiran, P1 još nije implementiran.** Dokument je specifikacija, a ne dokaz da mogućnosti rade. Ažurirano: 2026-11-06.

## Identitet projekta

- Aktivni repozitorij: `tomislavmilichevich-max/home-inventory-pwa` (**Private**), zadana grana `main`.
- Raniji `brljavljenja` ostaje stari, javni repozitorij; **ne koristiti za daljnji razvoj**.
- Softver, hosting, baza, API i korištenje: **0 € novih troškova**. Nekoliko eura za fizičke NFC/QR naljepnice dopušteno je kasnije.
- Dva Android korisnika, zajedničko kućanstvo; prvo PWA, bez zahtjeva za nativnom APK aplikacijom.
- ChatGPT je funkcionalni arhitekt/revizor; zaseban ChatGPT razgovor radi UI/UX; Claude Code implementira; korisnik prihvaća promjene.

## Glavna svrha i pravila

**Pronaći gdje se nalazi predmet** važnije je od praćenja količine. Lokalna pretraga predmeta i lokacija mora biti primarna radnja.

- Obavezni podaci novog predmeta: samo **naziv i lokacija**.
- Lokacije čine stablo proizvoljne dubine: kuća → prostorija → ormar → polica → kutija.
- Ista vrsta predmeta može postojati na više lokacija; više predmeta može biti u jednoj lokaciji.
- Premještanje fizičke kutije/lokacije sa svim podlokacijama ne zahtijeva pojedinačno premještanje sadržaja.
- Količine su neobavezne i sekundarne. Oznaka „Pri kraju“ i popis kupnje dolaze u v0.3.
- NFC/QR/barkod skeniranje dolazi u v0.2.

## Model podataka — obavezna strukturna odluka

Predviđena putanja u Cloud Firestoreu (točna polja osim navedenih finalizirati prije P2):

```text
households/{householdId}
  members/{firebaseUid}            # kontrola pristupa; konzola, ne klijent
  locations/{locationId}          # parentId, naziv, opcionalna fotografija
  items/{itemId}                  # što je to: naziv, sinonimi, opis itd.
  placements/{placementId}        # itemId + locationId (+ opcionalna količina)
  appliedOps/{operationId}        # plan P3: idempotencija namjera
```

**Nemoj koristiti `items.currentLocationId` kao jedinu vezu za smještaj.** `Item` je identitet vrste/konkretnog predmeta, a `Placement` fizički smještaj. Primjer: AA baterije imaju jedan Item i dva Placement zapisa (ladica dnevnog boravka i garaža). Kasnije razlikovati jedinstven fizički primjerak od vrste predmeta i definirati nedopuštene duplikate.

`Location.parentId` identificira nadređenu lokaciju, nije tekstualna putanja. Promjena naziva roditelja ili premještanje kutije mijenja izračunatu putanju, bez prepisivanja svih predmeta. Ciklusi u stablu moraju biti spriječeni prije P2 implementacije. Detaljna validacija referenci i brisanja ostaje predmet P2 specifikacije.

## Sinkronizacija i sigurnost podataka — plan P3

- Firestore je autoritativni zajednički zapis. Na uređajima se podaci predmemoriraju.
- Korisnik vidi lokalnu promjenu odmah, ali status mora razlikovati **lokalno spremljeno**, **čeka prijenos**, **sinkronizirano**, **sukob**, **greška**.
- Za premještanje koje zahtijeva provjeru sukoba koristi se lokalni red namjera (npr. IndexedDB), `operationId`, `baseVersion` i online uvjetna transakcija.
- `appliedOps/{operationId}` i promjena izvornog zapisa moraju se potvrditi atomarno da ponovljeno slanje ne promijeni stanje dvaput.
- **Firestore transakcije ne rade offline.** Offline promjena stoga nije potvrđena na serveru i ne smije se prikazivati kao sinkronizirana. Izvorni SDK model „last write wins“ nije dovoljan za lokacije.
- Kad dvije osobe mijenjaju *različita* polja / smještaje, ne smije se nepotrebno blokirati. Istodobne promjene iste fizičke lokacije koje se ne mogu spojiti zahtijevaju eksplicitno rješenje.
- Ne gubiti nesinkronizirane promjene pri zatvaranju PWA ili promjeni korisnika.

## P0 — stvarno stanje (implementirano)

- Vite, React, TypeScript strict, Vitest, PWA manifest i service worker za offline **ljusku aplikacije**.
- Firebase konfiguracijski predlošci, `firestore.rules` = deny-all, bez Firebase SDK-a i stvarnih podataka.
- Prema `docs/PILOT_TEST_REPORT.md`: 14/14 Vitest, build/typecheck/lint PASS, Chromium offline app-shell PASS.
- **Nije provjereno**: instalacija na stvarnom Androidu, auth, dva korisnika, Firestore offline inventar, Drive, stvarni deploy.

## Faze i razgraničenja

| Faza | Opseg | Status |
|---|---|---|
| P0 | PWA kostur i alatni lanac | Implementirano; dokumentacijske korekcije u ovom PR-u |
| P1 | Firebase Google prijava, jedno kućanstvo, ACL, testovi pravila | **Sljedeće, nije započeto** |
| P2 | Lokacije, Item + Placement, demo inventar, lokalna pretraga | Nije započeto |
| P3 | Siguran red offline namjera, konflikti, idempotencija | Nije započeto |
| P4 | Privatne fotografije kroz Google Drive, pristup dva računa | Nije započeto |
| P5 | Odobreni Firebase Hosting deploy, fizički Android/PWA pilot | Nije započeto |

Vizualni sustav i navigacija odobreni su u `docs/UI_UX_DECISIONS_V0.1.md`. Vizualno odobrenje **ne odobrava** dodatne funkcionalnosti u P1.

## Tehnički rizici za kasnije faze

- Google prijava u Android PWA: popup/redirect ne pretpostavljati bez provjere; službene smjernice za redirect i domena.
- Lokalno predmemoriranje i prijava na isti telefon s drugim računom: ne smije procuriti privatni inventar drugom korisniku.
- Google Drive `drive.file` ne daje automatski drugom Google računu pristup datoteci; prava i dijeljenje dokazati u P4.
- 0 € Spark: pratiti kvote; ne koristiti Blaze, Cloud Functions, Firebase Storage, Firebase App Hosting ni plaćene backup funkcije.

Službene reference: https://firebase.google.com/docs/firestore/manage-data/enable-offline · https://firebase.google.com/docs/firestore/manage-data/transactions · https://firebase.google.com/pricing
