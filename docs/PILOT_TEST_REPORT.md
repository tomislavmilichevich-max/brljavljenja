# PILOT_TEST_REPORT — stanje nakon P0

Datum: 2026-11-06 · Okruženje: Claude Code cloud (Linux, Node 22.23.4, npm 10.9.9, Chromium/Playwright)

## P0 — provjere (stvarni rezultati)

| Provjera                                                                                       | Rezultat                                      |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `npm run typecheck`                                                                            | PASS                                          |
| `npm run lint`                                                                                 | PASS                                          |
| `npm run test` (Vitest)                                                                        | PASS — 4 datoteke, 14 testova                 |
| `npm run build`                                                                                | PASS (JS 221 kB / 69 kB gzip)                 |
| `npm run check:no-actions`                                                                     | PASS                                          |
| Chromium (headless), `vite preview`: SW se instalira i preuzima kontrolu                       | PASS                                          |
| Predmemorirano 8 datoteka ljuske; manifest se učitava                                          | PASS                                          |
| Offline ponovno otvaranje (`/` i duboka ruta `/neka/ruta`) prikazuje UI, bez konzolnih grešaka | PASS                                          |
| Instalacija PWA na stvarnom Androidu                                                           | **NIJE PROVJERENO** (potreban fizički uređaj) |
| Lighthouse/installability audit                                                                | **NIJE PROVEDENO**                            |

## Greške nađene i ispravljene tijekom P0

1. Oznake predloška SW-a zamijenjene u komentaru umjesto u kodu → generirani `sw.js` bi pao. Ispravljeno + regresijski test.
2. `Vary: Origin` + `crossorigin` modul → cache miss offline. Ispravljeno (`ignoreVary`), potvrđeno u pregledniku.

## Nije dio P0 (BLOCKED/NOT STARTED)

Auth, ACL i rules testovi (P1), inventar/pretraga (P2), red namjera/sukobi/idempotencija (P3), Drive (P4), deploy (P5).
Testovi s dva fizička uređaja i dva Google računa u svakom slučaju zahtijevaju vlasnika.
