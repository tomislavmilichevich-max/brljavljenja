# Claude Code — P1.5: stvarni Firebase + Android pilot

Kreni od najnovije grane `main` privatnog repozitorija `tomislavmilichevich-max/home-inventory-pwa`.

**Polazno:** Firebase projekt `home-inventory-pwa-218be` (Spark) i web aplikacija stvoreni su u Console, Google provider je Enabled, Firestore Standard `(default)` radi i trenutačna pravila su deny-all. Vlasnik je kroz Console dodao `households/kuca1` (polja `name`, `schemaVersion=1`). Nema članova dok oba korisnika prvi put ne naprave Google prijavu. P1 PR #2 je spojen u `main`.

**Tvoj zadatak P1.5:** pripremi i, uz konkretno vlasnikovo odobrenje, kontrolirano objavi SAMO minimalni P1 pilot na Firebase Hosting i testirana P1 Firestore pravila radi stvarne Google prijave na Androidima.

Obavezno pročitaj `CLAUDE.md`, `docs/P1_5_HANDOFF.md`, `docs/SECURITY.md`, `docs/OWNER_ACTIONS.md`, `docs/P1_TEST_REPORT.md`.

1. Provjeri stanje repozitorija, pravila, verziju Firebase SDK/CLI i Spark uvjete. Pokreni `npm run check`, `npm run check:no-actions`, `npm run test:rules`, `npm run test:e2e`; iznesi stvarne rezultate.
2. Od vlasnika zatraži javnu Firebase web konfiguraciju **samo ako je nužno** za build i pomozi je postaviti u privatno lokalno/cloud okruženje. Ne stavljaj je u Git, ne zahtijevaj OAuth refresh tokene ili service-account JSON u chat. Obavezno `VITE_HOUSEHOLD_ID=kuca1` i točan projekt `home-inventory-pwa-218be`.
3. Za prvu objavu ciljaj `https://home-inventory-pwa-218be.firebaseapp.com` (još ne tvrdi da je URL aktivan), uz `authDomain=home-inventory-pwa-218be.firebaseapp.com` ako odgovara Console. Provjeri autorizirane domene i eventualne auth redirect zahtjeve na službenim uputama.
4. Potvrdi u produkcijskom buildu da nema emulator kuke, nema aktivnog `VITE_USE_EMULATORS`, nema stvarnih osobnih podataka, nema inventara ni fotografija, i da Firebase Hostingu služi isključivo `dist`.
5. **Prije prvog stvarnog deploya prikaži vlasniku target, točno koje se datoteke/pravila objavljuju, trenutno stanje pravila i učinak na dostupnost; zatraži eksplicitno odobrenje deploya.**
6. Uz odobrenje koristi samo selektivne naredbe za `--project home-inventory-pwa-218be`: prvo `npx firebase deploy --only firestore:rules --project home-inventory-pwa-218be`, zatim nakon `npm run build` `npx firebase deploy --only hosting --project home-inventory-pwa-218be`. Nema generičkog `firebase deploy`.
7. Ako Claude Code cloud ne može autentificirano objaviti, dokumentiraj legitiman owner flow; nema GitHub Actions, nema plaćenih servisa, nema kopiranja tokena u chat.
8. Nakon objave pošalji vlasniku URL i kratak vodič na hrvatskom za dva Androida: login A/B, dohvat UID-ova u Firebase Authentication > Users, ručno dodavanje `members/{uid}` ispod `households/kuca1`, provjera „Nemaš pristup“ → „Pristup odobren“, opoziv `enabled=false` i test PWA instalacije.
9. Napravi `docs/P1_5_TEST_REPORT.md` s testovima PASS/FAIL/NOT VERIFIED/BLOCKED; test na stvarnim Androidima nije PASS dok vlasnik ne potvrdi. Ako imaš izmjene koda/dokumenata, zasebna grana i PR; nemoj automatski mergeati.
10. Zaustavi se nakon P1.5; ne implementiraj P2, UI/UX Organized Cozy, Drive, NFC/QR ili shopping listu.

**0 € novih troškova je tvrdo ograničenje: isključivo Spark, bez povezivanja billing računa.**
