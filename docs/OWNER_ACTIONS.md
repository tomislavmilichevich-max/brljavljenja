# OWNER_ACTIONS — ručne radnje korisnika na Android tabletu

Ažurirano: 2026-11-06. Ne slati tokene, servisne račune, tajne ili stvarne fotografije u chat.

## Stanje repozitorija

- **Aktivno:** `tomislavmilichevich-max/home-inventory-pwa`, Private, `main`; P0 je prenesen.
- **Staro:** `tomislavmilichevich-max/brljavljenja`, još javno u trenutku provjere. Nakon kontrole da ništa ne nedostaje, korisnik može odlučiti želi li ga ukloniti ili staviti na Private. Nije dio aktivnog rada.
- P0 **ne zahtijeva PR**; već je na `main`. Ovaj dokumentacijski paket dolazi kao zaseban PR za pregled.
- Ne pokretati GitHub Actions dok je limit potrošen.

## P1: Firebase — koraci tek kada Claude zatraži

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
