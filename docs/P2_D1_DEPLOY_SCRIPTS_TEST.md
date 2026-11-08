# P2_D1_DEPLOY_SCRIPTS_TEST — provjera fail-closed zaštita deploy/rollback skripti

**Samo provjera naredbi iz `docs/P2_D1_DEPLOY_ROLLBACK.md` (§2a skripte) s LAŽNIM podacima.** Nije izvršen nikakav produkcijski deploy, bootstrap ni REST poziv prema stvarnom Firebaseu: `git` je stvarni nad privremenim lažnim repozitorijem u privremenom `HOME`; `npm`, `npx`, `gcloud` i `curl` su **stubovi** koji samo bilježe pozive i vraćaju zadane odgovore. Test izvlači skripte **izravno iz dokumenta** (isti tekst koji bi vlasnik zalijepio).

Kriterij: u svakom _negativnom_ slučaju skripta mora izaći s kodom ≠ 0 i stub „deploya" **nijednom** ne smije biti pozvan; u _pozitivnom_ točno jednom, tek nakon svih provjera; u slučajevima „završna provjera" deploy je pozvan, ali REST provjera nakon njega mora pasti i **ne smije pročitati staru `/tmp` datoteku** (prije testa su u `/tmp` postavljene stare VALJANE datoteke `rules-after.rules`, `rules-now.rules`, `rules-live.rules`; skripte koriste svježi `mktemp`).

**Rezultat: 61/61 PASS, 0 FAIL.**

**KORAK 4: deploy-rules.sh (obavezni uvjeti)**

| ID  | Scenarij (lažni podaci)                              | Ishod                                                   | Rezultat |
| --- | ---------------------------------------------------- | ------------------------------------------------------- | -------- |
| R0  | pozitivno: svi uvjeti ispunjeni                      | izlaz 0, deploy pozvan točno jednom, tek nakon provjera | PASS     |
| R1  | bez izričite potvrde (CONFIRM)                       | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R2  | pogrešan CONFIRM                                     | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R3  | nepostojeći direktorij repozitorija                  | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R3b | direktorij nije git repozitorij                      | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R4  | HEAD ≠ zabilježeni commit                            | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R4b | deploy-commit.txt nije hash                          | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R4c | nema deploy-commit.txt                               | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R5  | nečist git (izmijenjena praćena datoteka)            | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R5b | nečist git (nepraćena datoteka)                      | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R6  | pogrešan hash pravila (git čist, HEAD podudaran)     | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R7  | guard:rules pada (nevaljana pravila)                 | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R8  | nedostaje sigurnosna kopija                          | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R9  | neispravna kopija (kratka; hash se ne podudara)      | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R9b | kopija bez sadržaja pravila (hash valjan)            | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R9c | kopija izmijenjena nakon zapisa hasha (sha256sum -c) | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R10 | nije zabilježeno Hosting izdanje                     | izlaz 1, deploy NIJE pozvan                             | PASS     |

**KORAK 4: završna REST provjera NAKON deploya (u /tmp postoji STARA valjana datoteka; ne smije se čitati)**

| ID  | Scenarij (lažni podaci)                         | Ishod                               | Rezultat |
| --- | ----------------------------------------------- | ----------------------------------- | -------- |
| V1  | REST HTTP greška                                | izlaz 1: završna REST provjera pala | PASS     |
| V2  | REST vraća error objekt                         | izlaz 1: završna REST provjera pala | PASS     |
| V3  | nedostaje ruleset (null)                        | izlaz 1: završna REST provjera pala | PASS     |
| V4  | prazan sadržaj aktivnih pravila                 | izlaz 1: završna REST provjera pala | PASS     |
| V5  | ruleset bez sadržaja                            | izlaz 1: završna REST provjera pala | PASS     |
| V6  | ruleset vraća error objekt                      | izlaz 1: završna REST provjera pala | PASS     |
| V7  | aktivna pravila se razlikuju od firestore.rules | izlaz 1: završna REST provjera pala | PASS     |
| V8  | nema gcloud tokena                              | izlaz 1: završna REST provjera pala | PASS     |

**KORAK 6: deploy-hosting.sh**

| ID  | Scenarij (lažni podaci)                                         | Ishod                                                   | Rezultat |
| --- | --------------------------------------------------------------- | ------------------------------------------------------- | -------- |
| H0  | pozitivno                                                       | izlaz 0, deploy pozvan točno jednom, tek nakon provjera | PASS     |
| H1  | bez CONFIRM                                                     | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H2  | nepostojeći direktorij                                          | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H3  | HEAD ≠ zabilježeni commit                                       | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H4  | nečist git                                                      | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H5  | nema .env.production.local (nevaljana konfiguracija)            | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H6  | guard:env pada (nevaljana konfiguracija)                        | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H7  | pogrešan hash pravila                                           | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H8  | REST pravila nedostupna (pravila nisu potvrđena kao objavljena) | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H9  | aktivna pravila ≠ firestore.rules (REV-04 nije objavljen)       | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H10 | nema aktivnog rulesetta                                         | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H11 | nema sigurnosne kopije                                          | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H12 | sw.js sadrži API ključ (nakon deploya: izlaz != 0)              | izlaz 1: završna REST provjera pala                     | PASS     |

**KORAK 10b: rollback-rules.sh**

| ID  | Scenarij (lažni podaci)                                                  | Ishod                                                   | Rezultat |
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
| B9  | provjera nakon povrata: REST greška (stara /tmp datoteka ne smije proći) | izlaz 1: završna REST provjera pala                     | PASS     |
| B10 | provjera nakon povrata: aktivna pravila ≠ kopija                         | izlaz 1: završna REST provjera pala                     | PASS     |
| L0  | lockdown pozitivno                                                       | izlaz 0, deploy pozvan točno jednom, tek nakon provjera | PASS     |
| L1  | lockdown bez CONFIRM                                                     | izlaz 1, deploy NIJE pozvan                             | PASS     |
| L2  | lockdown s pogrešnom potvrdom (za povrat)                                | izlaz 1, deploy NIJE pozvan                             | PASS     |

**KORAK 3: backup-rules.sh (samo čita; kopija se ne smije stvoriti iz neispravnog odgovora)**

| ID  | Scenarij (lažni podaci)        | Ishod                         | Rezultat |
| --- | ------------------------------ | ----------------------------- | -------- |
| K0  | pozitivno                      | izlaz 0                       | PASS     |
| K1  | REST HTTP greška               | izlaz 1, kopija NIJE stvorena | PASS     |
| K2  | release vraća error objekt     | izlaz 1, kopija NIJE stvorena | PASS     |
| K3  | null ruleset                   | izlaz 1, kopija NIJE stvorena | PASS     |
| K4  | prazan sadržaj                 | izlaz 1, kopija NIJE stvorena | PASS     |
| K5  | sadržaj nedostaje              | izlaz 1, kopija NIJE stvorena | PASS     |
| K6  | ruleset vraća error objekt     | izlaz 1, kopija NIJE stvorena | PASS     |
| K7  | nema tokena                    | izlaz 1, kopija NIJE stvorena | PASS     |
| K8  | sadržaj nije Firestore pravila | izlaz 1, kopija NIJE stvorena | PASS     |

## Nalaz tijekom testiranja (ispravljeno prije predaje)

Prvi prolaz pozitivnih slučajeva pao je jer je `jq -r` na kraj sadržaja pravila dodavao dodatni prazni redak pa se aktivna pravila uspoređivala kao „različita". Ispravljeno na `jq -j` (sadržaj bez dodanog znaka novog retka) u `backup-rules.sh` i `lib.sh`; zatim 61/61.

## Napomena (P2-D2): zamijenjeno stvarnim skriptama

Ovi su testovi nastali nad skriptama koje su tada bile ugrađene u dokument (heredoc). U P2-D2 su skripte premještene u repozitorij (`scripts/ops/*.sh`) i **svi ovi slučajevi (i novi)** izvode se nad stvarnim datotekama naredbom `npm run test:ops`; vidi `docs/P2_D2_OPS_TEST_REPORT.md`. Ugrađeni harness je uklonjen (ovisio je o heredoc blokovima kojih više nema). Gornja tablica ostaje kao povijesni zapis P2-D1.
