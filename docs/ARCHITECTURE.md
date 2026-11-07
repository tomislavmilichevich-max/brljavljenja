# Kućni inventar — arhitektura i granice faza

Status: **P0 implementiran; P1 implementiran u PR-u i provjeren lokalno (emulatori), čeka odobrenje.** Dokument je specifikacija, a ne dokaz da mogućnosti rade. Ažurirano: 2026-11-06.

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
- Kad dvije osobe mijenjaju _različita_ polja / smještaje, ne smije se nepotrebno blokirati. Istodobne promjene iste fizičke lokacije koje se ne mogu spojiti zahtijevaju eksplicitno rješenje.
- Ne gubiti nesinkronizirane promjene pri zatvaranju PWA ili promjeni korisnika.

## P0 — stvarno stanje (implementirano)

- Vite, React, TypeScript strict, Vitest, PWA manifest i service worker za offline **ljusku aplikacije**.
- Firebase konfiguracijski predlošci, `firestore.rules` = deny-all, bez Firebase SDK-a i stvarnih podataka.
- Prema `docs/PILOT_TEST_REPORT.md`: 14/14 Vitest, build/typecheck/lint PASS, Chromium offline app-shell PASS.
- **Nije provjereno**: instalacija na stvarnom Androidu, auth, dva korisnika, Firestore offline inventar, Drive, stvarni deploy.

## P1 — stvarno stanje (implementirano u grani `p1/auth-household-rules`)

- `src/firebase/client.ts`: inicijalizacija iz `VITE_*`, Google prijava (popup, uz fallback na redirect samo za `popup-blocked`/`operation-not-supported`), odjava, provjera pristupa.
- `src/auth/session.ts`: čisti reducer stanja (inicijalizacija → prijava → provjera pristupa → odobren | nema pristupa | greška). Prijava sama nikad ne vodi u „odobren“.
- Provjera pristupa = `getDocFromServer(households/{h})`; odluku donose isključivo Security Rules (`permission-denied` → „Nemaš pristup“).
- **Memorijski cache, bez IndexedDB persistencea** u P1 (nakon odjave/reloada na uređaju nema privatnog sadržaja). Persistence se uvodi tek s P2/P3 uz test prelaska računa.
- Ekrani su privremeni i neutralni (`src/app/screens.tsx`), bez Organized Cozy dizajna.

### Pristup tijekom sesije (P1-REV-01/02)

- `evaluateAccess` (`src/auth/access.ts`): `exists()==false` za `households/{h}` **nije** odobren pristup (`household-missing`) — Rules aktivnom članu dopuštaju `get` nepostojećeg dokumenta jer subkolekcija `members` može postojati bez roditelja.
- **Revalidacija otvorene sesije** (`src/auth/useSession.ts`), bez pollinga: (1) povratak aplikacije u prvi plan (`visibilitychange`, najviše jednom u 15 s), (2) oporavak mreže (`online`, odmah), (3) vrlo rijedak timer od 10 min **samo dok je aplikacija vidljiva** (≤ 6 čitanja/h po aktivnom uređaju; Spark 50.000 čitanja/dan prema vlasnikovoj provjeri), (4) ručni gumb „Provjeri pristup“.
- **Ponašanje:** odbijanje s poslužitelja (`permission-denied`) → odmah „Nemaš pristup“ i uklanjanje podataka kućanstva s ekrana. Poslužitelj nedostupan (offline) → prikaz **ostaje**, ali je jasno označen kao nepotvrđen („zadnji put potvrđen u HH:MM… prikaz može biti zastario“) i **ne** piše „potvrđen sa servera“. Povratak mreže odmah ponavlja provjeru.
- **Poznato ograničenje:** nema push opoziva. Aplikacija koja je neprekidno vidljiva i online uočit će opoziv najkasnije nakon 10 min (ili ranije pri povratku u prvi plan / ručnom provjerom). Realtime listener nije korišten jer Rules ne jamče ponovnu provjeru `get()` uvjeta za otvorene listenere.

### Nalazi P1 koje P2/P3 moraju poštovati

1. **`getDoc` offline vraća predmemorirani dokument** (i nakon odjave u istoj stranici). Za provjeru članstva zato `getDocFromServer`. Za P2 čitanja inventara: prije prikaza podataka drugog korisnika na istom uređaju Firestore instancu treba prekinuti (`terminate`) i ponovno inicijalizirati, ili ne dijeliti cache među računima — **to P1 nije rješavao**.
2. **`await` prije `signInWithPopup` ruši popup** (gubi korisnikov dodir; Chrome/Android blokira). Ne dodavati async posao prije tog poziva.
3. **Gate za P2/P3 (nalaz glavnog razvoja, NIJE implementirano):** `getDocFromServer` je ispravan fail-closed potez za _mrežno potvrđenu autorizaciju_ u P1, ali **ne smije postati trajni preduvjet za lokalnu offline pretragu** prethodno sinkroniziranog inventara. Prije P2 treba definirati razdvajanje: (a) mrežno potvrđena autorizacija (server, Security Rules) i (b) ograničen offline pristup lokalnim podacima na prethodno odobrenom, pouzdanom Androidu, uz **izolaciju/čišćenje lokalnog keša pri odjavi i promjeni računa** (Security Rules štite server, a lokalna predmemorija traži zasebnu zaštitu). Online provjera članstva ne smije trajno onemogućiti offline pretragu; opoziv se primjenjuje kad se provjera uspješno obavi, a lokalni podaci se tada brišu.
4. Bundle je narastao na ≈235 kB gzip (Firebase auth+firestore). Za P2+ razmotriti code-splitting.

## P2-A — model i pravila (u emulatoru; D1–D5 odlučeni, revizija 2)

Shema, invarijante, odgovori na pitanja iz P2 handoffa i alternative: `docs/P2_A_ADR.md`. Dokazi: `docs/P2_A_TEST_REPORT.md`. Uvedene su dvije pomoćne kolekcije (`meta/tree` za serijalizaciju strukture, `placementKeys` za jedinstvenost) uz nepromijenjene stabilne ID-ove Placementa. Rules NE jamče potpunu acikličnost stabla: P2-B mora imati potpunu provjeru lanca predaka u transakciji i detekciju oštećenog stabla nakon učitavanja (D1). Arhiviranje Location/Item je odgođeno i zabranjeno u pravilima (D2). Sve izmjene u P2-B moraju ići isključivo kroz `runTransaction` (setDoc/updateDoc/writeBatch ulaze u skriveni offline red — izmjereno).

## P2-B — online inventar (implementirano u emulatorima)

Podatkovni sloj (`src/inventory/*`), izolirane podatkovne sesije (`src/firebase/dataSession.ts`) i minimalno sučelje. Detalji i dokazi: `docs/P2_B_TEST_REPORT.md`.

- Svaka prijavljena sesija otvara **zasebnu Firebase app instancu** (samo memorijski keš, Auth bez perzistencije); odjava, promjena računa i opoziv uništavaju je (listeneri + keš). Primarna instanca nema Firestore.
- Sve izmjene su `runTransaction`; bez veze odbijene (`offline`), pad veze oko commita daje `outcome-unknown`. Nema skrivenog reda ni automatskog slanja.
- Podaci se otkrivaju i integritet stabla provjerava tek nad cjelovitim, server-potvrđenim skupom svih triju kolekcija.

## Faze i razgraničenja

| Faza | Opseg                                                          | Status                                                                                      |
| ---- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| P0   | PWA kostur i alatni lanac                                      | Implementirano; dokumentacijske korekcije u ovom PR-u                                       |
| P1   | Firebase Google prijava, jedno kućanstvo, ACL, testovi pravila | **Implementirano u PR-u; emulator testovi PASS; Android/stvarni Google login NOT VERIFIED** |
| P2   | Lokacije, Item + Placement, demo inventar, lokalna pretraga    | Nije započeto                                                                               |
| P3   | Siguran red offline namjera, konflikti, idempotencija          | Nije započeto                                                                               |
| P4   | Privatne fotografije kroz Google Drive, pristup dva računa     | Nije započeto                                                                               |
| P5   | Odobreni Firebase Hosting deploy, fizički Android/PWA pilot    | Nije započeto                                                                               |

Vizualni sustav i navigacija odobreni su u `docs/UI_UX_DECISIONS_V0.1.md`. Vizualno odobrenje **ne odobrava** dodatne funkcionalnosti u P1.

## Tehnički rizici za kasnije faze

- Google prijava u Android PWA: popup/redirect ne pretpostavljati bez provjere; službene smjernice za redirect i domena.
- Lokalno predmemoriranje i prijava na isti telefon s drugim računom: ne smije procuriti privatni inventar drugom korisniku.
- Google Drive `drive.file` ne daje automatski drugom Google računu pristup datoteci; prava i dijeljenje dokazati u P4.
- 0 € Spark: pratiti kvote; ne koristiti Blaze, Cloud Functions, Firebase Storage, Firebase App Hosting ni plaćene backup funkcije.

Službene reference: https://firebase.google.com/docs/firestore/manage-data/enable-offline · https://firebase.google.com/docs/firestore/manage-data/transactions · https://firebase.google.com/pricing
