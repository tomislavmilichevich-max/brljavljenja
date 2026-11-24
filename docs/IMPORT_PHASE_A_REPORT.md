# Faza A (offline) — izvještaj, 2026-11-24

Grana `import/phase-a-offline`. **Nijedan produkcijski pristup nije izveden** (nema snapshota, prijave, upisa, Admin SDK-a, deploya, bootstrapa ni promjene Rules/Hostinga/članstva). **`apply` nije autoriziran** i fizički je zaključan (`src/import/lock.ts`). Svi testovi koriste isključivo sintetičke podatke.

## Što je napravljeno

| Korak                                                                                                                                                                              | Stanje                                               | Gdje                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------- |
| A1 manifest parser/validator, deterministički ID-evi, slojevi `source_candidate`/`candidate_decision`/`planned_write`, statusi CREATE/MATCH/REVIEW/HOLD/SKIP/BLOCKED               | gotovo                                               | `src/import/{types,names,canonical,manifest}.ts`                    |
| A2 čisti `reconcile(manifest, snapshot)` (roditeljski ID + normalizirani naziv + vrsta; nikad prepisivanje; HOLD soba netaknuta)                                                   | gotovo                                               | `src/import/reconcile.ts`                                           |
| A3 dry-run izvještaj (točni upisi, nesigurnosti, postojeći ID-evi, procjena kvote, hash manifesta/snapshota/plana, `NOT READY FOR APPLY`) + CLI koji odbija putanje u repozitoriju | gotovo                                               | `src/import/report.ts`, `scripts/import/dry-run.ts`                 |
| A4 read-only snapshot + mock testovi                                                                                                                                               | gotovo (kod + mock); **nije pokretan na produkciji** | `src/import/snapshot.ts`                                            |
| A5 apply engine + brave (CONFIRM, svježi snapshot hash, potpis odobrenja, točan UID, fizička brava)                                                                                | gotovo (dizajn + emulator); produkcija zaključana    | `src/import/{apply,approval,lock}.ts`, `docs/IMPORT_PHASE_A_OPS.md` |
| A6 emulator: konkurentnost, nepoznat ishod, prekid, ponavljanje, nepotpun povrat                                                                                                   | gotovo                                               | `sdk-tests/import.test.ts`                                          |
| A7 planer povrata (allowlist + checkpoint + provjere, STOP)                                                                                                                        | gotovo kao **planer**; brisanja nema                 | `src/import/restore.ts`                                             |
| A8 operativna procedura                                                                                                                                                            | gotovo (dokument)                                    | `docs/IMPORT_PHASE_A_OPS.md` §6                                     |
| A9 PR + izvještaj                                                                                                                                                                  | ovaj dokument; PR nije mergean                       |                                                                     |

Ispravci A0 u `docs/IMPORT_PHASE_A_PLAN.md` primijenjeni (granica `> 120`, kvote bez fiksnih čitanja, rollback po allowlistu, Node prijava BLOCKED).

## Rezultati testova (stvarno pokrenuti)

| Provjera                                                                        | Rezultat                                                       |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `npm run check` (tsc, eslint, prettier, vitest, build)                          | **PASS** — 17 datoteka, 255 testova                            |
| `npm run check:no-actions`                                                      | **PASS**                                                       |
| `npm run test:sdk` (emulator Auth+Firestore, cijeli skup uključujući uvoz)      | **PASS** — 6 datoteka, 105 testova                             |
| `sdk-tests/import.test.ts` ponovljen 3× zaredom (stabilnost konkurentnog testa) | **PASS** 13/13 svaki put                                       |
| `npm run test:rules`                                                            | **PASS** — 12 datoteka, 220 testova                            |
| Novi lokalni testovi uvoza (`src/import/*.test.ts`, `scripts/import/*.test.ts`) | **PASS** — 60 testova                                          |
| `npm run test:ops`                                                              | NOT VERIFIED (ovdje nije pokrenut; faza ne dira `scripts/ops`) |
| Produkcijski snapshot / prijava / apply / povrat                                | **NOT VERIFIED — nije dopušteno ovom fazom**                   |
| Fizičko Android testiranje                                                      | NOT VERIFIED                                                   |

## Sažetak reconciliation rezultata na sintetičkom datasetu

Skup istog oblika kao stvarni paket (7 soba, 161 lokacija, 393 kandidata: 224 CANDIDATE / 128 REVIEW / 38 HOLD / 3 SUMMARY; 19 osjetljivih, 19 skupina istog naziva, 3 zbirne lokacije, 2 predugačka naziva), prazan snapshot, odluke samo za CANDIDATE bez osjetljivih:

- Lokacije: CREATE 137 · REVIEW 3 (zbirne) · HOLD 21 (soba 7) · MATCH/SKIP/BLOCKED 0.
- Stavke: CREATE 204 · REVIEW 148 (128 + 19 osjetljivih + 1 predugačak) · HOLD 38 · SKIP 3 (SUMMARY) · BLOCKED 0.
- Planirani upisi: 749 (137 + 204×3) ≈ 3,7 % dnevne Spark kvote upisa; tx-čitanja repozitorija 886 (Rules `get()/getAfter()` **nisu mjereni**).
- Potencijal REVIEW stavki (nije pripremljeno): 148 stavki ≈ 444 upisa.
- Bez odluka: 0 CREATE stavki, `NOT READY FOR APPLY` (`NO_SNAPSHOT`, `NO_CONFIRMED_KINDS`).
- Soba 7 (Dnevni boravak): 0 upisa — provjereno testom (nijedan planirani upis ne dotiče njene ID-eve).

## Pokrivenost rubnih slučajeva

120/121 znak (121 se ne skraćuje); nedostaje `kind`; REVIEW; HOLD; SUMMARY (SKIP i uz INCLUDE); osjetljivo (bez/uz INCLUDE); isti naziv na dvije lokacije (dva zasebna predmeta); roditeljstvo; root/room pravilo; dva stvarna ID-a za isti naziv (`AMBIGUOUS_MATCH`); isti naziv na drugoj lokaciji (`SAME_NAME_ELSEWHERE` → REVIEW); isti naziv druga vrsta (`KIND_MISMATCH`); sudar planiranog ID-a (`ID_COLLISION` → BLOCKED); rerun identičnog manifesta (isti hash i plan); već primijenjen uvoz (0 upisa, `ALREADY_APPLIED`); promjena snapshot hasha; pogrešan projekt/kućanstvo (manifest i snapshot); nepoznata odluka; zbirna lokacija; apply: pogrešan CONFIRM/UID/potpis/ključ/hash/stari snapshot/produkcijski projekt; emulator: potpun apply, idempotentan rerun, onemogućen član (Rules), klijentsko brisanje odbijeno, prekid procesa, `outcome-unknown` (applied i not-applied), dva člana istodobno; povrat: nepromijenjeno (PROPOSE), promijenjena verzija/autor, nestao zapis, naknadni smještaj, naknadno dijete, `existed` korak, strani `imp1-` zapis se ne dira.

## Tehnički zaključak: neprivilegirana Node prijava

**Nije dokazano; za produkciju BLOCKED.** `gcloud` OAuth access token nije Firebase Auth ID token, `signInWithPopup/Redirect` ne postoje u Nodeu, custom token traži Admin/IAM. Preporuka: opcija B (zaštićen ekran u aplikaciji, zasebno odobrenje Hostinga). Detalji: `docs/IMPORT_PHASE_A_OPS.md` §3.

## Blokade prije bilo kakve produkcije

1. Put prijave za točan UID nije dokazan (BLOCKED; B + odobrenje Hostinga).
2. Produkcijski snapshot nije uzet (zahtijeva izričito odobrenje); stanje žive baze nepoznato.
3. `kind` nije potvrđena ni za jednu stvarnu stavku; 128 REVIEW, 19 osjetljivih, 3 zbirne lokacije, `cand-0183` i `cand-0272` čekaju vlasnikovu odluku.
4. Brava `PRODUCTION_APPLY_ENABLED=false`; apply nije autoriziran.
5. Kvote čitanja nisu izmjerene; provjeriti Usage prije apply.
6. Privilegirani povrat nije odobren; planer je samo prijedlog.

## Što NIJE gotovo

Stvarni dry-run nad vlasnikovim JSON paketom (potrebne su odluke i, za pun izvještaj, snapshot); produkcijski snapshot; UI put B; mjerenje čitanja/Usage; privilegirani alat za brisanje; apply i verify na produkciji; `npm run test:ops` u ovoj iteraciji.
