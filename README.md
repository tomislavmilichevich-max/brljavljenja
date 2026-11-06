# Kućni inventar PWA — tehnički pilot v0.0.1

Privatna PWA za dva Android korisnika: **brzo pronaći gdje se predmet nalazi**.
Trenutno stanje: **faza P0 (infrastruktura)**. Funkcionalnosti inventara, prijava i sinkronizacija
**nisu implementirani** (P1+). Vidi `docs/PILOT_TEST_REPORT.md` za stvarno provjereno.

> Trošak: **0 EUR**. Samo Firebase Spark. Bez GitHub Actions. Vidi `CLAUDE.md`.

## Stack (stvarno instalirane verzije)

Vite 8.3.6 · React 19.3.1 · TypeScript 6.0.3 · Vitest 5.1.0 · ESLint 10.14 + typescript-eslint 8.72 · Prettier 3.9 · Node ≥ 20.19 (testirano na 22).
Firebase SDK **još nije instaliran** (dolazi s P1). Service worker i manifest su ručno napisani (bez `vite-plugin-pwa`) da se izbjegne ovisnost.

## Pokretanje

```bash
npm install
npm run dev            # razvojni poslužitelj (service worker je ISKLJUČEN u devu)
npm run check          # typecheck + lint + test + build
npm run build && npm run preview   # produkcijski build; tu se testira PWA/offline
```

Skripte: `typecheck`, `lint`, `format`, `format:check`, `test`, `test:watch`, `check:no-actions`.

## Konfiguracija

Kopiraj `.env.example` u `.env.local` i popuni vrijednostima iz Firebase Console (vidi `docs/OWNER_ACTIONS.md`).
Firebase web konfiguracija nije tajna, ali se `.env*` ne commita; sigurnost daju Security Rules (P1).
Bez konfiguracije aplikacija se normalno pokreće i prikazuje „nije postavljena“.

## Struktura

```
src/app/        privremeni neutralni prikaz (nije dizajn)
src/config/     čitanje/validacija javne Firebase konfiguracije
src/pwa/        registracija SW-a + predložak service workera (sw.template.js)
vite-plugins/   generira dist/sw.js s popisom datoteka i ID-jem builda
public/         manifest.webmanifest, ikone (PRIVREMENE)
firebase.json, firestore.rules (deny all), firestore.indexes.json, .firebaserc.example
docs/           ARCHITECTURE, SECURITY, OWNER_ACTIONS, PILOT_TEST_REPORT
```

## PWA / offline (P0)

`dist/sw.js` predmemorira statičku ljusku (HTML/JS/CSS/ikone/manifest) i vraća `index.html` za navigaciju bez mreže.
Zahtjevi prema drugim domenama (Firestore, Google) i ne-GET zahtjevi **prolaze mrežom** — service worker ih ne dira.
Nova verzija se preuzima u pozadini; aktivira se kad aplikacija pošalje `SKIP_WAITING` (UI za to dolazi kasnije).
Ikone su privremene (generirane iz `public/icons/icon.svg`).

## Deploy (samo Spark) — još se NE radi

Nakon P1–P4 i izričitog odobrenja vlasnika:

```bash
npm run build
npx firebase-tools deploy --only hosting,firestore:rules   # firebase-tools nije u ovisnostima; koristi se ad hoc
```

Nikad `--only functions`, nikad nadogradnja na Blaze. Detalji i ručni koraci: `docs/OWNER_ACTIONS.md`.

## Poznata ograničenja

- Instalabilnost na stvarnom Androidu (Chrome „Dodaj na početni zaslon“) nije provjerena u P0.
- `npm audit`: 1 umjerena ranjivost (minimatch, ReDoS) tranzitivno u lint alatima (dev-only, ne ulazi u build).
