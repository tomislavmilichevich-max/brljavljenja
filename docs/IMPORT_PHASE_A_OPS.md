# Faza A — dizajn apply/restore alata i operativna procedura (A5, A7, A8)

Status: **dizajn + emulator-testirana offline logika. `apply` NIJE autoriziran; nijedan produkcijski pristup nije izveden.**
Kod: `src/import/*` (čista logika, Node 22 ga izvršava izravno), CLI: `scripts/import/dry-run.ts`, emulator testovi: `sdk-tests/import.test.ts`.

## 1. Slojevi podataka (A1)

`source_candidate` (lokalni plan JSON) → `candidate_decision` (vlasnikove odluke, lokalni JSON) → `planned_write` (izlaz `reconcile`). Statusi: `CREATE, MATCH, REVIEW, HOLD, SKIP, BLOCKED`. Plan, odluke, snapshot i izvještaji s nazivima žive **izvan repozitorija**; CLI odbija putanje unutar repozitorija.

Zadane politike (A0, nisu pristanak na apply): nijedna stavka nije `CREATE` bez izričitog `INCLUDE` **i** izričite `kind`; prijedlog vrste (`kindSuggestion`) je samo informativan; `REVIEW`/osjetljivo/zbirne lokacije/HOLD sobe/`SUMMARY` nikad ne ulaze automatski; predugi nazivi se ne režu (`> 120` = REVIEW/HOLD dok vlasnik ne potvrdi naziv); ponovljeni nazivi se ne spajaju (samo oznaka `DUPLICATE_NAME_GROUP`); količine/kategorije ostaju `null`.

## 2. Apply engine — dizajn i brave (A5)

Piše **isključivo kroz repozitorij aplikacije kao član** (Rules ostaju na snazi; nikad Admin SDK/IAM). Deterministički ID-evi (`imp1-<planId>`, `imp1-it-<n>`, `imp1-pl-<n>`) + idempotentni `createLocation`/`createItemWithPlacement` → ponovni run ne duplicira.

`apply` se ne pokreće dok **svi** uvjeti nisu ispunjeni (`gateProblems`, svi razlozi se prijavljuju):

1. **Fizička brava:** `PRODUCTION_APPLY_ENABLED = false` u `src/import/lock.ts`; za projekt bez prefiksa `demo-` apply vraća `PRODUCTION_APPLY_LOCKED`. Otključavanje = izmjena te datoteke u zasebnom, odobrenom PR-u (faza B).
2. Izričit `CONFIRM`.
3. Svježi snapshot: hash ponovno izračunat neposredno prije mora biti jednak hashu iz odobrenja (`SNAPSHOT_STALE`).
4. Potpisano odobrenje (HMAC-SHA256, ključ vlasnika lokalno): veže projekt, kućanstvo, hash manifesta, hash usklađenog plana, hash snapshota i točan Firebase UID.
5. Točan Firebase UID prijavljenog člana (ne e-mail).
6. Plan je „READY” (ima snapshot, potvrđene vrste, nema BLOCKED, ima upisa).

Tijek: koraci po redu (roditelj prije djeteta); checkpoint nakon svakog koraka; `outcome-unknown` → `verify` (server-potvrđeno čitanje po ID-u); samo `applied` nastavlja, sve ostalo **STOP** bez automatskog ponavljanja; svaka druga greška = STOP; `maxWrites` omogućuje stupnjevani apply. Koraci koje je engine zatekao već postojeće (`existed`) bilježe se i nikad nisu na popisu povrata.

## 3. Neprivilegirana prijava u Nodeu — tehnički zaključak

**Zaključak: nije dokazano i ne smije se pretpostavljati; za produkciju BLOCKED.**

- `gcloud auth print-access-token` daje Google **OAuth access token** s Google Cloud opsezima. To **nije** Firebase Auth ID token i Firebase Auth ga ne prihvaća kao dokaz identiteta korisnika aplikacije bez zasebne razmjene.
- `GoogleAuthProvider.credential(...)` + `signInWithCredential` u Nodeu tehnički postoji, ali Firebase Auth poslužitelj prihvaća Google token samo ako je izdan za OAuth klijent koji projekt prihvaća; token `gcloud` klijenta vjerojatno tome ne odgovara. To **nije provjereno** (ispit bi doticao produkcijski Auth, što nije odobreno).
- `signInWithPopup`/`signInWithRedirect` ne postoje u Nodeu (traže preglednik).
- Custom token traži Admin SDK/IAM (zabranjeno za apply). Device-flow zahtijeva novi OAuth klijent (ručni zahvat u konzoli koji traži zasebno odobrenje).
- Firestore REST s Google OAuth/IAM je **privilegiran** put (zaobilazi Rules): koristi se samo za read-only snapshot i **nije dokaz** da korisnička pravila dopuštaju upis.

**Preporuka:** opcija B — privremeni zaštićeni ekran u postojećoj aplikaciji (prava Google prijava kao član, isti repozitorij i Rules); logika iz `src/import/*` je pisana da se može ponovno upotrijebiti u pregledniku. Zahtijeva zasebno odobrenje Hostinga i novi PR. Ne stvaraju se novi produkcijski Auth korisnici radi proba.

## 4. Snapshot (A4)

`src/import/snapshot.ts`: samo GET, URL je ograničen na `projects/<projekt>/databases/(default)/documents/households/<kućanstvo>/…`, strani dokumenti/projekti/kolekcije se odbijaju, token ide samo u zaglavlje. Pokrivenost: samo mock testovi. **Nije pokretan na produkciji.** Snapshot se sprema privremeno lokalno izvan repozitorija (chmod 600).

## 5. Povrat — dizajn (A7)

`planRestore` je **planer, ne brisač**. Strogi allowlist ID-eva iz checkpointa (nikad prefiks `imp1-`); za svaki zapis provjerava: postoji, verzija 1, autor = UID uvoza, nije arhiviran; nijedan naknadni placement ne referencira uvezeni predmet/lokaciju, nema naknadne djece lokacije. **Bilo koje odstupanje = `STOP`** i ručna procjena, bez ijednog prijedloga brisanja. Pri `PROPOSE` redoslijed je smještaji → predmeti → lokacije (djeca prije roditelja). Rules zabranjuju klijentsko brisanje (potvrđeno emulator testom), pa je stvarno brisanje zasebna **privilegirana operacija koja nije unaprijed odobrena** i traži sigurnosnu kopiju; siguran automatski povrat se ne obećava.

## 6. Operativna procedura (A8) — apply NIJE autoriziran ovom fazom

1. **Priprema (lokalno):** plan + odluke izvan repozitorija; `node scripts/import/dry-run.ts --plan … --decisions …` → izvještaj (exit 2 = NOT READY).
2. **Snapshot (traži izričito odobrenje vlasnika):** read-only, privremena datoteka izvan repozitorija; dry-run s `--snapshot`.
3. **Ručna revizija vlasnika:** izvještaj (CREATE/MATCH/REVIEW/HOLD/SKIP/BLOCKED, točni upisi, nesigurnosti, procjena kvote, hashevi); odluke za REVIEW/osjetljivo/zbirne/predugačke; potvrda vrsta.
4. **Approval (vlasnik):** potpis odobrenja nad hashevima i UID-om.
5. **Apply (faza B, zasebno odobrenje + otključavanje brave + put B):** stupnjevano (`maxWrites`), checkpoint, STOP pri nejasnoći.
6. **Verify:** novi snapshot + `reconcile` mora dati 0 planiranih upisa i sve `ALREADY_APPLIED`; vlasnik pregledava u aplikaciji.
7. **Povrat (samo po odvojenoj odluci):** `planRestore` → vlasnik odlučuje; privilegirano brisanje je zasebna radnja.

## 7. Blokade prije bilo kakve produkcije

1. Nema dokaza o valjanom Node/aplikacijskom putu prijave za točan UID (BLOCKED; preporuka B + odobrenje Hostinga).
2. Produkcijski snapshot nije uzet (traži izričito odobrenje); stanje žive baze i Dnevnog boravka nije uspoređeno.
3. `kind` nije potvrđena ni za jednu stavku; 128 `REVIEW`, 19 osjetljivih, 3 zbirne lokacije, `cand-0183`/`cand-0272` čekaju odluku vlasnika.
4. Brava `PRODUCTION_APPLY_ENABLED=false`; apply nije autoriziran.
5. Kvote čitanja nisu izmjerene (samo procjena); provjeriti Usage.
6. Privilegirani povrat nije odobren ni testiran na produkciji.
