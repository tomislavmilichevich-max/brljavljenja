# OWNER_ACTIONS — ručne radnje korisnika na Android tabletu

Ažurirano: 2026-11-06. Ne slati tokene, servisne račune, tajne ili stvarne fotografije u chat.

## Stanje repozitorija

- **Aktivno:** `tomislavmilichevich-max/home-inventory-pwa`, Private, `main`; P0 je prenesen.
- **Staro:** `tomislavmilichevich-max/brljavljenja`, još javno u trenutku provjere. Nakon kontrole da ništa ne nedostaje, korisnik može odlučiti želi li ga ukloniti ili staviti na Private. Nije dio aktivnog rada.
- P0 **ne zahtijeva PR**; već je na `main`. Ovaj dokumentacijski paket dolazi kao zaseban PR za pregled.
- Ne pokretati GitHub Actions dok je limit potrošen.

## P1: precizni koraci za Android tablet (Chrome, stranica „Desktop site“ za Firebase Console)

Redom; ništa od ovoga ne zahtijeva karticu. **Ne slati UID-ove ni konfiguraciju u chat osim ako Claude izričito zatraži.**

1. **Projekt:** console.firebase.google.com → _Add project_ → naziv po želji → _Google Analytics: isključi_ → Create. Plan mora ostati **Spark** (ne kliknuti _Upgrade_).
2. **Prijava:** _Build → Authentication → Get started → Sign-in method → Google → Enable_ → odaberi support e-mail → Save.
3. **Firestore:** _Build → Firestore Database → Create database_ → **Standard edition**, lokacija po izboru (ne mijenja se kasnije) → **Production mode** → Create. Ne dirati _Rules_ (deploy radimo tek uz odobrenje).
4. **Web aplikacija:** _Project settings (zupčanik) → General → Your apps → Web (</>)_ → nadimak → **bez** „Firebase Hosting“ kvačice → Register. Kopiraj 6 vrijednosti `firebaseConfig`.
5. **Konfiguracija u okruženje (ne u GitHub):** u Claude Code cloud okruženju postavi varijable okruženja `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` i `VITE_HOUSEHOLD_ID` (npr. `kuca1`). Vrijednosti nisu tajne, ali ih se ne commita.
6. **Autorizirane domene:** _Authentication → Settings → Authorized domains_ — dodaj domenu na kojoj će PWA biti objavljena (`<projekt>.web.app` i `<projekt>.firebaseapp.com` su obično već unutra). Bez toga Google prijava na toj domeni ne radi.
7. **Prva prijava:** oba korisnika otvore objavljenu aplikaciju i prijave se (vidjet će „Nemaš pristup“ i svoj UID). _Napomena:_ stvarnu prijavu moguće je isprobati tek na objavljenoj domeni (P5 deploy uz tvoje odobrenje); lokalno u cloud okruženju to nije moguće.
8. **UID-ovi:** _Authentication → Users → stupac User UID_ (ili kopiraj gumbom „Kopiraj UID“ u aplikaciji).
9. **Kućanstvo (Console zapis zaobilazi pravila — samo ti):** _Firestore Database → Data → Start collection_ → Collection ID `households` → Document ID = tvoj `VITE_HOUSEHOLD_ID` → polja: `name` (string), `schemaVersion` (number) `1` → Save.
10. **Članovi:** otvori taj dokument → _Add collection_ → ID `members` → Document ID = **UID prvog korisnika** → polja: `uid` (string, isti UID), `role` (string) `member`, `enabled` (**boolean**) `true` → Save. Ponovi za drugog korisnika. Polje `enabled` mora biti boolean, ne string „true“.
    11a. Ako korisnik vidi „Tvoje članstvo postoji, ali dokument kućanstva nije postavljen“, nedostaje dokument `households/{id}` (korak 9) — pristup NIJE odobren dok se ne stvori.
11. **Provjera:** korisnik na „Nemaš pristup“ pritisne _Provjeri ponovno_ → treba vidjeti „Pristup odobren“ i naziv kućanstva. **Opoziv:** promijeni `enabled` na `false` ili obriši člana. Otvorena aplikacija to primijeti pri povratku u prvi plan, kad se veza vrati, najkasnije nakon ≈10 min, ili pritiskom na „Provjeri pristup“; zatim prikazuje „Nemaš pristup“.
12. Pravila: **ne deployati** sam. Kad odobriš, deploy radi samo `firestore.rules` (Spark, bez Blaze).

Starije općenite korake zadržavamo ispod za referencu.

## Stari opći koraci (referenca)

1. Otvori https://console.firebase.google.com/ i izradi projekt s **Spark** (besplatnim) planom, **bez kartice / povezivanja billing računa**. Google Analytics nije potreban.
2. Dodaj Web App u Project Settings. Postavi Google Authentication provider u Authentication → Sign-in method.
3. U Firestore Database stvori **jednu** standardnu bazu u production mode. Nema otvorenih pravila; izvorna P0 pravila ostaju deny-all do pregledanih i testiranih P1 pravila. Lokaciju baze odaberi pažljivo, ne treba je kasnije mijenjati.
4. Kopiraj javnu Firebase web konfiguraciju u lokalno/privatno `.env.local`, ne u GitHub. Konfiguracija sama nije tajna; prava daju Security Rules.
5. Za pilot odredi identifikator jednog kućanstva (`householdId`). Isti se koristi u aplikaciji i putanjama dokumenata.
6. Nakon prve uspješne Google prijave oba korisnika, njihove Firebase Auth UID-ove pronađi u Authentication → Users. **Nemoj ih slati u chat** ako nije potrebno.
7. Samo vlasnik kroz Firebase Console kreira `households/{householdId}` i dva `households/{householdId}/members/{uid}` dokumenta s `enabled: true` i `role: "member"` prema provjerenoj P1 uputi. Ne postoji javni poziv ili klijentska opcija „sam se pridruži“.
8. Prije bilo kakvog stvarnog deploya provjeri sigurnosna pravila i provedi emulator testove. Za P1 nije odobren produkcijski deploy bez posebnog odobrenja.

**Bitan test autentikacije:** pokušati Google login na oba Androida, uključujući instaliranu PWA kad bude dostupna, i provjeriti povratak iz Google prijave. Za besplatnu Firebase Hosting `firebaseapp.com` domenu preferirati identičan origin aplikacije i `authDomain`, ili slijediti službene redirect smjernice.

## P1: što korisnik ne treba raditi

- Ne unositi podatke inventara niti stvarne fotografije.
- Ne uključivati Cloud Functions, Cloud Storage for Firebase, App Hosting, plaćene API-je ili billing.
- Ne kreirati GitHub Actions workflow.
- Ne dijeliti osobne OAuth tokene ni servisne ključeve s Claudeom / ChatGPT-om.
- Ne ručno mijenjati Firestore pravila u produkciji mimo reviewa.

## P4: Google Drive (kasnije, ne u P1)

1. U istom Google Cloud projektu omogućiti Google Drive API; prvo verificirati kvote i OAuth uvjete.
2. Koristiti najmanji potreban scope (plan: `drive.file`). Ne koristiti zajednički `appDataFolder` kao običnu mapu.
3. Privatna pohrana fotografija + dijeljenje za oba računa mora biti provjereno; to nije automatsko.
4. OAuth testing status i trajanje tokena testirati. Ne činiti datoteke javnima.

## P5: objava (kasnije)

Samo uz odobrenje vlasnika: izravni Firebase Hosting deploy s potrebnim, testiranim Firestore pravilima. Nema GitHub Actions ni Blaze plana.

Službene reference: https://firebase.google.com/pricing · https://firebase.google.com/docs/auth/web/redirect-best-practices
