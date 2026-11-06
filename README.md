# Kućni inventar PWA — tehnički razvoj

Privatna PWA za **dva Android korisnika**. Glavni cilj: **brzo pronaći gdje se predmet nalazi u kući**.

**Repozitorij:** `tomislavmilichevich-max/home-inventory-pwa` (Private), `main`.
**Trošak softvera i korištenja:** 0 €. Samo Firebase Spark. GitHub Actions nisu uključene.

## Status

- **P0 implementiran:** Vite/React/TypeScript kostur, manifest, offline PWA ljuska, konfiguracijski predlošci, deny-all Firestore Rules.
- **P1 spreman kao specifikacija, ali nije implementiran:** Google prijava + sigurnosna pravila za dva ovlaštena korisnika.
- P2 inventar/pretraga, P3 offline konflikt, P4 Drive i P5 stvarni Android pilot **nisu implementirani**.
- Izvještaj o testovima P0: `docs/PILOT_TEST_REPORT.md`; 14/14 Vitest prema izvještaju Claude Codea, offline Chromium app shell PASS. Fizički Android test **nije proveden**.

## Dokumenti za početak P1

1. `CLAUDE.md` — obavezne granice projekta.
2. `docs/ARCHITECTURE.md` — poslovna pravila, Item + Placement, faze.
3. `docs/SECURITY.md` — sigurnosni model.
4. `docs/OWNER_ACTIONS.md` — što vlasnik mora napraviti na Android tabletu.
5. `docs/UI_UX_DECISIONS_V0.1.md` — odobren Organized Cozy vizualni smjer, bez proširenja P1.
6. `docs/P1_HANDOFF.md` — implementacijska specifikacija P1.
7. `docs/P1_ACCEPTANCE.md` — prihvatni testovi P1.
8. `docs/CLAUDE_CODE_P1_PROMPT.md` — početni prompt.

## Stack i pokretanje P0

Vite 8.3.6 · React 19.3.1 · TypeScript 6.0.3 · Vitest 5.1.0 · ESLint 10.14 + typescript-eslint 8.72 · Prettier 3.9 · Node ≥20.19.

```bash
npm ci
npm run dev
npm run check
npm run check:no-actions
npm run build && npm run preview
```

Firebase SDK **još nije** instaliran u P0. `.env.example` daje predložak javne konfiguracije; privatni `.env.local` nije za GitHub.

Service worker u P0 predmemorira **samo ljusku aplikacije**, ne privatne podatke. Testovi offline prijave, inventara i Google Drivea tek dolaze.

## Zabranjena automatska objava

Ne deployati Firebase Hosting/Firestore pravila i ne pokretati GitHub Actions bez zasebnog odobrenja vlasnika. Nikad Blaze, Cloud Functions, Firebase Storage ili App Hosting.

Za ručne korake i dostupne opcije vidi `docs/OWNER_ACTIONS.md`.

## Poznate P0 napomene

- Stvarni Android PWA install i Google auth nisu provjereni.
- Prema izvještaju P0: jedan umjereni `minimatch` ReDoS nalaz u development-only lint alatima; ne ulazi u produkcijski bundle. Pratiti nakon promjena ovisnosti.
