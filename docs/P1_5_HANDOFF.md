# Kućni inventar — P1.5: Firebase Hosting + stvarni Android/Google Auth pilot

Datum: 2026-11-06. Status: **specifikacija za kontrolirani P1.5 pilot**, ne potvrda deploya. Aktivni repo: `tomislavmilichevich-max/home-inventory-pwa` (Private), `main`.

## Polazno, potvrđeno od vlasnika

- Projekt u Firebase Console: **naziv** home-inventory-pwa, **Project ID** `home-inventory-pwa-218be`.
- Plan: **Spark**, bez billing računa, bez Blaze.
- Firebase web aplikacija registrirana; Google Authentication provider **Enabled**.
- Cloud Firestore **Standard**, baza `(default)` stvorena u Production mode.
- Početna produkcijska pravila još su **deny-all** (`allow read, write: if false`).
- Ručno unesen demo dokument `households/kuca1`, polja `name` string i `schemaVersion` number = 1 **prema korisnikovu izvještaju**; provjeriti u Console bez kopiranja privatnih podataka u GitHub.
- Dva `members/{uid}` dokumenta još nisu kreirana; UID-ove ćemo dobiti tek nakon stvarnog logina.
- P1 kod i testovi spojeni su u `main` nakon prihvaćenog PR #2. P0 i P1 simulirane provjere prošle su u Claude Code izvještajima; stvarni Google/Android nije provjeren.
- UI/UX Organized Cozy i demo ZIP **nisu zadatak P1.5**.

## Cilj P1.5

Minimalni stvarni pilot dokazuje: (1) Firebase Hosting radi na `https://home-inventory-pwa-218be.firebaseapp.com`; (2) autentikacija radi za stvarni Google račun Android Chrome/PWA; (3) dva člana mogu dohvatiti samo dozvoljeni `households/kuca1`; (4) treći ili neodobren korisnik ne vidi privatne podatke; (5) opoziv članstva se propagira nakon revalidacije; (6) 0 € novih troškova; (7) P0 offline app-shell i dalje radi.

**Web adresa je ciljana URL putanja, ne tvrditi da postoji prije uspješnog deploya.** Adresa `*.firebaseapp.com` je preferirana zbog Firebase Auth redirect postupka. Ako Cloud Console pokaže drugačiju domenu ili authDomain, prije deploya provjeriti službenu dokumentaciju, ne improvizirati.

## Stroge granice

1. Samo postojeći Firebase **Spark** projekt `home-inventory-pwa-218be`. Bez Blaze, billing, Cloud Functions, Firebase Storage, App Hosting, Gemini, Analytics integracije ili plaćenih resursa.
2. Nema GitHub Actions (potrošen limit), nema automatskih CI deploya niti service-account tokena u repozitoriju. Nema upisa pravih Google UID-ova ili privatnih podataka u repo.
3. Ne izmišljati provjere iz produkcije niti testove s dva fizička Androida. Označiti `NOT VERIFIED` dok ih vlasnik stvarno ne obavi.
4. Firebase web konfiguracija nije tajna; **ali** `.env.local`, OAuth tokeni, servisni računi, refresh tokeni i pristupni podaci ne idu u git niti chat. Web API key je prirodno dio klijentskog bundlea, a stvarna zaštita je u Firestore Security Rules.
5. **Ne koristiti** generički `firebase deploy`. Uvijek eksplicitni `--project home-inventory-pwa-218be` i `--only`.
6. Nema inventara, lokacija, fotografija, Drivea, NFC/QR/barkoda, shopping liste, ni promjene konačnog dizajna.

## P1.5.1 — Readiness, bez deploya

- Povuci ažurni `main`, izradi zasebnu granu za eventualne male P1.5 korekcije; ne mijenjaj P2.
- Pregledaj `firebase.json` (hosting public `dist`, SPA rewrite, pravilno izuzimanje `/__/auth/*` u service workeru) i `firestore.rules`.
- Potvrdi P1 rules testove, e2e emulator i P0 app-shell; `npm run check`, `npm run check:no-actions`, `npm run test:rules`, `npm run test:e2e`.
- Stvarna Firebase konfiguracija iz Firebase Console (`Project settings > General > Your apps`) u privatne varijable/`.env.local`, bez commita:
  - `VITE_FIREBASE_API_KEY`
  - `VITE_FIREBASE_AUTH_DOMAIN=home-inventory-pwa-218be.firebaseapp.com` ako Console potvrdi
  - `VITE_FIREBASE_PROJECT_ID=home-inventory-pwa-218be`
  - `VITE_FIREBASE_MESSAGING_SENDER_ID`
  - `VITE_FIREBASE_APP_ID`
  - `VITE_HOUSEHOLD_ID=kuca1`
  - `VITE_FIREBASE_STORAGE_BUCKET` neobavezan i ne znači koristiti Cloud Storage.
  - `measurementId` ne koristi se; bez Analytics paketa.
- `VITE_USE_EMULATORS` **nije uključeno** za produkcijski build. Provjeri da dev-only emulator kuka i localhost URL-ovi nisu aktivni u produkciji.
- Prije deploya pripremi pregled diff-a, projekte/domena/status plana i plan vraćanja. Hosting je javno dohvatljiv, ali Firestore mora biti privatan po Rules. Nema pravih predmeta ni fotografija.

## P1.5.2 — Minimalni, odobreni deploy

Kad vlasnik odobri konkretni deploy i Claude Code cloud okruženje ima ovlašten Firebase CLI pristup (autorizacija preko legitimnog Firebase login mehanizma, bez slanja tokena u chat ili repo), objavi odvojeno:

```bash
npx firebase deploy --only firestore:rules --project home-inventory-pwa-218be
npm run build
npx firebase deploy --only hosting --project home-inventory-pwa-218be
```

**Prvo pravila, zatim Hosting.** Prije svake naredbe potvrdi ciljani Project ID. Prvi deploy pravila zamjenjuje postojeći produkcijski deny-all samo testiranim P1 pravilima; čitanje `households/kuca1` dopušteno je samo aktivnom ručno unesenom članu, nijedan write nije dopušten.

Ako login/CLI deployment nije dostupan u Claude Code cloud načinu, **ne zaobilaziti** ga tokenom u chat, GitHub Actionsom, servisnim ključem ili plaćenom uslugom. Pripremi dokumentirane ručne korake i označi `BLOCKED` do legitimne autorizacije.

## P1.5.3 — Korisničko testiranje nakon deploya

1. Vlasnik otvori objavljenu `https://home-inventory-pwa-218be.firebaseapp.com` u Android Chromeu; neka potvrdi da se prikazuje privremeni ekran prijave.
2. Prijava Google računom A: očekivano `Nemaš pristup`; u **Authentication > Users** vidi se Firebase UID. Ako UI pokaže UID, može ga kopirati lokalno. Bez slanja u chat.
3. Vlasnik u Firestore Console pod `households/kuca1` dodaje `members/{uidA}` s `uid` (string), `role` (string `member`), `enabled` (**boolean** `true`). Korisnik A pritisne `Provjeri ponovno`; očekuje se `Pristup odobren`.
4. Isto s računom B na drugom Androidu: prije odobrenja `Nemaš pristup`, nakon dodavanja UID-a u `members` — odobreno.
5. Negativni test: treći Google račun (ako je dostupan) može se prijaviti, ali nikad ne vidi kućanstvo; ako treći račun nije dostupan, označiti test NOT VERIFIED i potvrditi Rules emulator test.
6. Opoziv: vlasnik postavi `members/{uidB}.enabled = false`; potvrditi da B nakon manualnog `Provjeri pristup` / povratka u aplikaciju dobiva `Nemaš pristup`, dok A zadržava pristup; potom ponovno uključiti B.
7. Instalacija na Android Home screen i eventualni redirect/popup fallback, prijava i odjava na oba Androida; posebno testirati povratak iz Google consent prozora.
8. Prekinuti vezu: app shell se može otvoriti, ali pristup bez svježe server provjere ne smije biti lažno prikazan kao trenutno potvrđen. Ovo **nije** test offline pretrage (P2/P3).
9. Na kraju u Firebase Console provjeriti i dalje Spark plan i Usage. Zapisati stvarni datum, domena, testirana verzija/brojevi, rezultate i probleme.

## Go/no-go za P2

- Testiran realni Google login barem za A i B, potvrda membershipa i odbijanja neovlaštenog UID-a.
- Produkcijska Firestore pravila točno odgovaraju testiranom P1 `firestore.rules`; nema javnih upisa.
- PWA radi na Android Chromeu i može se instalirati.
- 0 € i Spark ostaju.
- `docs/P1_5_TEST_REPORT.md` razlikuje testove iz emulatora od stvarno odrađenih fizičkih testova.
- **P2 ne počinje automatski**; glavni razvoj pregleda dokaze.

## Službene reference

- https://firebase.google.com/docs/hosting/quickstart
- https://firebase.google.com/docs/rules/manage-deploy
- https://firebase.google.com/docs/auth/web/redirect-best-practices
- https://firebase.google.com/pricing
