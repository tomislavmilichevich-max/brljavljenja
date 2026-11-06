# CLAUDE.md — trajne granice projekta (Kućni inventar PWA)

Ovo su stalna pravila. Ne mijenjaju se bez izričite odluke vlasnika projekta.

## Uloge

- **Claude Code** = implementator. **ChatGPT** = funkcionalna arhitektura i prihvatni kriteriji. UI/UX = zasebni razgovor.
- Ne mijenjati poslovna pravila ni donositi trajne dizajnerske odluke samostalno. Tehničke kontradikcije: dokumentirati i predložiti rješenje.

## Tvrda ograničenja

1. **0 EUR novih troškova** (softver, hosting, baza, API, korištenje). Samo Firebase **Spark**; bez kartice, **bez Blaze**.
   Zabranjeno: Cloud Functions, App Hosting, Cloud Storage for Firebase, plaćeni API-ji, bilo što s billing računom.
2. **Zabranjeni GitHub Actions**: ne stvarati ni pokretati `.github/workflows/*` (minute potrošene). `npm run check:no-actions` to provjerava. Testovi se izvršavaju lokalno u Claude Code okruženju.
3. **Nikad u repozitorij**: OAuth tokeni, client secret, servisni računi, privatni ključevi, stvarne fotografije kuće, privatni podaci. `.env*` je u `.gitignore` (osim `.env.example`).
4. Firestore Rules: deny by default. **Nikad** `allow read, write: if true`, ni privremeno.
5. Ne simulirati rezultate testova. Ne tvrditi da je real-world test na dva Androida obavljen ako nije. Razdvajati implementirano od planiranog.
6. Nema NFC/QR/EAN, shopping liste, statistike, AI, inventure, vlastitog backend poslužitelja u v0.0.1.
7. Izbjegavati nepotrebne ovisnosti; nikad plaćene.

## Rad

- Faze P0–P5 (vidi `docs/ARCHITECTURE.md`); svaka faza = zasebna grana/commit(i), diff + stvarni test output + otvorena pitanja. **Ne započinjati sljedeću fazu bez naloga.**
- Provjera prije commita: `npm run check` (typecheck + lint + test + build) i `npm run check:no-actions`.
- Stack: Vite + React + TypeScript (strict). Hosting na korijenu domene (`base: '/'`).
- TypeScript je namjerno `~6.0` jer `typescript-eslint` ne podržava TS 7 (peer `<6.1.0`).
