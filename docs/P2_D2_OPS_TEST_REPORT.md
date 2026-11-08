# P2_D2_OPS_TEST_REPORT — testovi operativnih skripti `scripts/ops`

Datum: 2026-11-08 · Naredba: `npm run test:ops` (`scripts/ops/test-ops.sh`) · Datoteke pod testom: **stvarne skripte iz repozitorija** (`lib.sh`, `prepare.sh`, `backup-rules.sh`, `deploy-rules.sh`, `deploy-hosting.sh`, `rollback-rules.sh`).

**Ništa nije izvršeno u produkciji.** `git` je stvaran (privremeni „origin" i klon u privremenom `HOME`); `npm`, `npx`, `gcloud` i `curl` su **stubovi** koji samo bilježe pozive i vraćaju zadane odgovore. Stvarni `~/backup`, stvarni repozitorij i Firebase nisu dotaknuti. Bez deploya, bootstrapa, promjene članstva ili podataka.

**Rezultat: 118/118 PASS, 0 FAIL.**

Kriteriji: _negativni_ slučaj = izlaz ≠ 0 i stub „deploya" nijednom pozvan; _pozitivni_ = izlaz 0 i deploy pozvan točno jednom, tek nakon svih provjera; _provjera nakon deploya_ = REST provjera mora pasti (u `/tmp` su prije testa postavljene STARE valjane datoteke koje se ne smiju pročitati); `prep`/`backup` = nikad ne smiju pozvati deploy, a **postojeća sigurnosna kopija mora ostati bajt-po-bajt netaknuta** (usporedba sažetka cijelog `~/backup` prije/poslije). U svim slučajevima: token (`SECRETTOKEN123`) i ključ (`AIzaSECRETKEY`) ne smiju se pojaviti u ispisu ni u argumentima naredbi; token mora proći kroz stdin (`curl -K -`).

Posebno traženo:

- **`npm run backup` ne može pokrenuti deploy:** statički (`S-nodeploy`: `lib.sh`, `prepare.sh`, `backup-rules.sh` ne sadrže `firebase deploy`, `deploy:`, `firestore:rules`, `--only`), konfiguracijski (`S-npm`: `prep`/`backup` u `package.json` ne spominju deploy) i dinamički (K0–K16: brojač poziva stuba deploya = 0).
- **Pogrešan projekt zaustavlja:** K4 (ruleset iz drugog projekta), K11 (Hosting izdanje drugog sitea), P7/R7b/H6b/B8b (`VITE_FIREBASE_PROJECT_ID` ≠ `home-inventory-pwa-218be`), V3b/H10b (ruleset drugog projekta pri provjeri).
- **Pogrešan REST odgovor zaustavlja:** K1–K3b, K5–K9, K12, V1–V8, H8–H10b, B9–B10 (HTTP greška, `error` objekt, odgovor koji nije JSON objekt, `null` ruleset, prazan/odsutan sadržaj, razlika, nema tokena).
- **Postojeća sigurnosna kopija ostaje netaknuta:** K13–K15 (odbijeno, sažetak `~/backup` identičan prije/poslije; pojedinačne datoteke kopije; ponovno pokretanje odmah nakon uspješnog).

**0. Statika: struktura, imena, jamstva**

| ID          | Scenarij                | Ishod                                 | Rezultat |
| ----------- | ----------------------- | ------------------------------------- | -------- |
| S-syntax    | lib.sh                  | bash -n                               | PASS     |
| S-syntax    | prepare.sh              | bash -n                               | PASS     |
| S-syntax    | backup-rules.sh         | bash -n                               | PASS     |
| S-syntax    | deploy-rules.sh         | bash -n                               | PASS     |
| S-syntax    | deploy-hosting.sh       | bash -n                               | PASS     |
| S-syntax    | rollback-rules.sh       | bash -n                               | PASS     |
| S-syntax    | test-ops.sh             | bash -n                               | PASS     |
| S-strict    | lib.sh                  | set -euo pipefail                     | PASS     |
| S-strict    | prepare.sh              | set -euo pipefail                     | PASS     |
| S-strict    | backup-rules.sh         | set -euo pipefail                     | PASS     |
| S-strict    | deploy-rules.sh         | set -euo pipefail                     | PASS     |
| S-strict    | deploy-hosting.sh       | set -euo pipefail                     | PASS     |
| S-strict    | rollback-rules.sh       | set -euo pipefail                     | PASS     |
| S-nodeploy  | lib.sh                  | nema nijedne naredbe/oznake za objavu | PASS     |
| S-nodeploy  | prepare.sh              | nema nijedne naredbe/oznake za objavu | PASS     |
| S-nodeploy  | backup-rules.sh         | nema nijedne naredbe/oznake za objavu | PASS     |
| S-npm       | prep                    | bash scripts/ops/prepare.sh           | PASS     |
| S-npm       | backup                  | bash scripts/ops/backup-rules.sh      | PASS     |
| S-npm       | ops:deploy-rules        | ok                                    | PASS     |
| S-npm       | ops:deploy-hosting      | ok                                    | PASS     |
| S-npm       | ops:rollback-rules      | ok                                    | PASS     |
| S-npm       | ops:lockdown-rules      | ok                                    | PASS     |
| S-npm       | prep/backup bez deploya | ok                                    | PASS     |
| S-gitignore | backup/                 | ignorirano                            | PASS     |

**1. npm run prep (prepare.sh): lokalno, bez produkcije**

| ID  | Scenarij                                               | Ishod                       | Rezultat |
| --- | ------------------------------------------------------ | --------------------------- | -------- |
| P0  | pozitivno: main = origin/main, čisto, hash i config OK | izlaz 0, deploy nije pozvan | PASS     |
| P0b | commit zapisan u ~/backup/deploy-commit.txt            | ok                          | PASS     |
| P0c | prep ne zove REST/gcloud/firebase                      | samo npm provjere           | PASS     |
| P1  | nije na grani main                                     | izlaz 1, deploy nije pozvan | PASS     |
| P2  | HEAD ≠ origin/main (lokalni commit)                    | izlaz 1, deploy nije pozvan | PASS     |
| P3  | nečist git (nepraćena datoteka)                        | izlaz 1, deploy nije pozvan | PASS     |
| P3b | nečist git (izmijenjena)                               | izlaz 1, deploy nije pozvan | PASS     |
| P4  | pogrešan hash pravila (čisto, = origin)                | izlaz 1, deploy nije pozvan | PASS     |
| P5  | guard:rules pada                                       | izlaz 1, deploy nije pozvan | PASS     |
| P6  | guard:env pada                                         | izlaz 1, deploy nije pozvan | PASS     |
| P6b | check:no-actions pada                                  | izlaz 1, deploy nije pozvan | PASS     |
| P7  | pogrešan Firebase projekt u konfiguraciji              | izlaz 1, deploy nije pozvan | PASS     |
| P7b | nema .env.production.local                             | izlaz 1, deploy nije pozvan | PASS     |
| P8  | git fetch ne uspijeva                                  | izlaz 1, deploy nije pozvan | PASS     |
| P9  | nema firebase-tools                                    | izlaz 1, deploy nije pozvan | PASS     |
| P10 | ~/backup bi bio unutar repozitorija                    | izlaz 1, deploy nije pozvan | PASS     |

**2. npm run backup (backup-rules.sh): samo čitanje, ne prepisuje, zaustavlja se na pogrešnom projektu/REST odgovoru**

| ID  | Scenarij                                                             | Ishod                                     | Rezultat |
| --- | -------------------------------------------------------------------- | ----------------------------------------- | -------- |
| K0  | pozitivno (stara P1 pravila u produkciji)                            | izlaz 0, sve datoteke u ~/backup          | PASS     |
| K0a | token ide kroz stdin (curl -K -), NIKAD u argumente naredbe ni ispis | ok                                        | PASS     |
| K0b | kopija NIJE u repozitoriju                                           | git status čist, ~/backup izvan klona     | PASS     |
| K1  | REST HTTP greška                                                     | izlaz 1, NIJEDNA kopija nije stvorena     | PASS     |
| K2  | release vraća error objekt                                           | izlaz 1, NIJEDNA kopija nije stvorena     | PASS     |
| K3  | null ruleset                                                         | izlaz 1, NIJEDNA kopija nije stvorena     | PASS     |
| K3b | odgovor nije JSON objekt                                             | izlaz 1, NIJEDNA kopija nije stvorena     | PASS     |
| K4  | POGREŠAN PROJEKT u imenu rulesetta                                   | izlaz 1, NIJEDNA kopija nije stvorena     | PASS     |
| K5  | prazan sadržaj pravila                                               | izlaz 1, NIJEDNA kopija nije stvorena     | PASS     |
| K6  | ruleset bez sadržaja                                                 | izlaz 1, NIJEDNA kopija nije stvorena     | PASS     |
| K7  | ruleset vraća error objekt                                           | izlaz 1, NIJEDNA kopija nije stvorena     | PASS     |
| K8  | sadržaj nije Firestore pravila                                       | izlaz 1, NIJEDNA kopija nije stvorena     | PASS     |
| K9  | nema gcloud tokena                                                   | izlaz 1, NIJEDNA kopija nije stvorena     | PASS     |
| K10 | Hosting REST greška (kopija pravila ostaje)                          | izlaz 2: kopija pravila OK, Hosting ručno | PASS     |
| K11 | Hosting izdanje drugog sitea (pogrešan projekt)                      | izlaz 2: kopija pravila OK, Hosting ručno | PASS     |
| K12 | Hosting live bez izdanja                                             | izlaz 2: kopija pravila OK, Hosting ručno | PASS     |
| K13 | postojeća kopija: odbijeno, ~/backup netaknut                        | izlaz 1, snapshot isti                    | PASS     |
| K14 | postojeći rules-before-deploy.sha256: odbijeno, ~/backup netaknut    | izlaz 1                                   | PASS     |
| K14 | postojeći ruleset-name-before.txt: odbijeno, ~/backup netaknut       | izlaz 1                                   | PASS     |
| K14 | postojeći hosting-live-before.json: ne prepisuje (izlaz 2)           | hosting zapis ostaje                      | PASS     |
| K15 | drugo pokretanje odmah nakon uspješnog: odbijeno, kopija netaknuta   | izlaz 1                                   | PASS     |
| K16 | ~/backup unutar repozitorija                                         | izlaz 1, deploy nije pozvan               | PASS     |

**3. ops:deploy-rules (korak 4): obavezni uvjeti**

| ID  | Scenarij                                              | Ishod                                                   | Rezultat |
| --- | ----------------------------------------------------- | ------------------------------------------------------- | -------- |
| R0  | pozitivno                                             | izlaz 0, deploy pozvan točno jednom, tek nakon provjera | PASS     |
| R1  | bez CONFIRM                                           | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R2  | pogrešan CONFIRM                                      | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R3  | skripta nije u Git repozitoriju (pogrešan direktorij) | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R4  | HEAD ≠ zabilježeni commit                             | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R4b | deploy-commit.txt nije hash                           | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R4c | nema deploy-commit.txt                                | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R5  | nečist git (izmijenjena)                              | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R5b | nečist git (nepraćena)                                | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R6  | pogrešan hash pravila (git čist, HEAD podudaran)      | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R7  | guard:rules pada                                      | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R7b | POGREŠAN projekt u konfiguraciji                      | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R8  | nedostaje sigurnosna kopija                           | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R9  | neispravna kopija (kratka)                            | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R9b | kopija bez sadržaja pravila (hash valjan)             | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R9c | kopija izmijenjena nakon hasha                        | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R10 | nije zabilježeno Hosting izdanje                      | izlaz 1, deploy NIJE pozvan                             | PASS     |

**3b. završna REST provjera NAKON deploya (u /tmp postoje STARE valjane datoteke; ne smiju se čitati)**

| ID  | Scenarij                          | Ishod                                | Rezultat |
| --- | --------------------------------- | ------------------------------------ | -------- |
| V1  | REST HTTP greška                  | izlaz 1: provjera nakon deploya pala | PASS     |
| V2  | release error objekt              | izlaz 1: provjera nakon deploya pala | PASS     |
| V3  | nedostaje ruleset (null)          | izlaz 1: provjera nakon deploya pala | PASS     |
| V3b | ruleset iz POGREŠNOG projekta     | izlaz 1: provjera nakon deploya pala | PASS     |
| V4  | prazan sadržaj aktivnih pravila   | izlaz 1: provjera nakon deploya pala | PASS     |
| V5  | ruleset bez sadržaja              | izlaz 1: provjera nakon deploya pala | PASS     |
| V6  | ruleset error objekt              | izlaz 1: provjera nakon deploya pala | PASS     |
| V7  | aktivna pravila ≠ firestore.rules | izlaz 1: provjera nakon deploya pala | PASS     |
| V8  | nema gcloud tokena                | izlaz 1: provjera nakon deploya pala | PASS     |

**4. ops:deploy-hosting (korak 6)**

| ID   | Scenarij                                                                | Ishod                                                   | Rezultat |
| ---- | ----------------------------------------------------------------------- | ------------------------------------------------------- | -------- |
| H0   | pozitivno                                                               | izlaz 0, deploy pozvan točno jednom, tek nakon provjera | PASS     |
| H1   | bez CONFIRM                                                             | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H2   | pogrešan direktorij (nije Git)                                          | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H3   | HEAD ≠ zabilježeni commit                                               | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H4   | nečist git                                                              | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H5   | nema .env.production.local                                              | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H6   | guard:env pada                                                          | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H6b  | POGREŠAN projekt u konfiguraciji                                        | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H7   | pogrešan hash pravila                                                   | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H8   | REST pravila nedostupna                                                 | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H9   | aktivna pravila ≠ firestore.rules (REV-04 nije objavljen; još stara P1) | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H10  | nema aktivnog rulesetta                                                 | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H10b | ruleset iz pogrešnog projekta                                           | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H11  | nema sigurnosne kopije                                                  | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H12  | sw.js sadrži API ključ (nakon deploya: izlaz != 0)                      | izlaz 1: provjera nakon deploya pala                    | PASS     |

**5. rollback (ops:rollback-rules / ops:lockdown-rules)**

| ID  | Scenarij                                                                 | Ishod                                                   | Rezultat |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------- | -------- |
| B0  | pozitivno (backup)                                                       | izlaz 0, deploy pozvan točno jednom, tek nakon provjera | PASS     |
| B1  | bez CONFIRM                                                              | izlaz 1, deploy NIJE pozvan                             | PASS     |
| B2  | nepoznat način rada                                                      | izlaz 1, deploy NIJE pozvan                             | PASS     |
| B3  | nedostajuća kopija                                                       | izlaz 1, deploy NIJE pozvan                             | PASS     |
| B4  | neuspjeli sha256sum -c                                                   | izlaz 1, deploy NIJE pozvan                             | PASS     |
| B5  | neispravan sadržaj (prekratak)                                           | izlaz 1, deploy NIJE pozvan                             | PASS     |
| B6  | neispravan sadržaj (nema rules_version)                                  | izlaz 1, deploy NIJE pozvan                             | PASS     |
| B7  | nema datoteke s hashom                                                   | izlaz 1, deploy NIJE pozvan                             | PASS     |
| B8  | nema firebase-tools                                                      | izlaz 1, deploy NIJE pozvan                             | PASS     |
| B8b | POGREŠAN projekt u konfiguraciji                                         | izlaz 1, deploy NIJE pozvan                             | PASS     |
| B9  | provjera nakon povrata: REST greška (stara /tmp datoteka ne smije proći) | izlaz 1: provjera nakon deploya pala                    | PASS     |
| B10 | provjera nakon povrata: aktivna pravila ≠ kopija                         | izlaz 1: provjera nakon deploya pala                    | PASS     |
| L0  | lockdown pozitivno                                                       | izlaz 0, deploy pozvan točno jednom, tek nakon provjera | PASS     |
| L1  | lockdown bez CONFIRM                                                     | izlaz 1, deploy NIJE pozvan                             | PASS     |
| L2  | lockdown s pogrešnom potvrdom (za povrat)                                | izlaz 1, deploy NIJE pozvan                             | PASS     |

## Mutacijska provjera testova

Namjerno uklonjena zaštita „HEAD = zabilježeni commit" i provjera imena rulesetta/projekta u privremenoj kopiji skripti: test je **pao u 5 slučajeva** (R4, H3, K4, V3b, H10b) — testovi stvarno otkrivaju uklanjanje zaštita.

## Nalazi tijekom razvoja (ispravljeno)

1. Stub `curl` čekao je stdin kad ga skripta zove bez `-K -` (zastoj testa), ispravljeno u stubu.
2. Test je pogrešno tretirao token u stdin zapisniku kao curenje; ispravljeno: token **smije** proći samo stdinom, nikad argumentima/ispisom (i to se sada izričito provjerava, K0a).

## Ograničenja

Testovi ne dokazuju ponašanje stvarnih `gcloud`/REST/`firebase deploy` u Cloud Shellu (**NOT VERIFIED**; prvi stvarni poziv je `npm run backup`, samo čitanje, uz vlasnika).
