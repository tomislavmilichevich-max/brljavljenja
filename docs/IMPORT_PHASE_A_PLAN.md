# IMPORT_PHASE_A_PLAN — plan faze A kontroliranog početnog uvoza (kućni PDF popis)

Datum: 2026-11-24 · Status: **SAMO PLAN. NO WRITES PERFORMED.** Ništa nije pokrenuto prema Firebase produkciji; nema upisa, deploya, promjene Rules/Auth/Hostinga. Ulaz: cjeloviti paket (MD handoff, JSON plan, CSV, xlsx, PDF). Stvarni podaci (nazivi stvari, snapshot, logovi) **ne ulaze u repozitorij** (CLAUDE.md, ograničenje 4); ovaj dokument ne sadrži nazive stavki.

## 1. Što je analizirano (ponovljeno nad cjelovitim paketom)
Paket: `CLAUDE_CODE_Kucni_inventar_Import_V1.md` (identičan ranije primljenom), `Kucni_inventar_Import_Plan_V1.json` (autoritativan), `…Lokacije/Stavke/Izvorni_redci_V1.csv` (UTF-8 s BOM-om, **separator `;`**), `…xlsx`, izvorni PDF (8 str.). Metadata plana: `live_state_snapshot = NOT_OBTAINED`, `production_write_authorization = NOT_GRANTED`.

**Provjere plana (lokalno, bez mreže i bez produkcije):**

| Provjera | Rezultat |
| --- | --- |
| JSON ↔ CSV ↔ XLSX | brojevi (161 / 118 / 393) i skupovi ID-eva jednaki; nazivi i statusi kandidata jednaki |
| **Doslovnost izvora** | **118/118** `source_text_verbatim` pronađeno doslovno u tekstu PDF-a (`pdftotext`, normalizacija razmaka) |
| Struktura lokacija | ID-ovi jedinstveni; svi roditelji postoje; `room` samo pod root; putanje konzistentne s roditeljima; nema duplikata (roditelj, naziv); nazivi ≤ 120 i bez razmaka na rubovima; maks. dubina 4; kinds ∈ {room, shelf, cabinet, drawer, box, other} |
| Kandidati | svaki ima postojeću lokaciju i izvorni redak; svaki izvorni redak ima ≥ 1 kandidata (prosj. 3,3, maks. 13); nema duplikata (putanja, naziv); `quantity`, `item_kind`, `item_category`, `firestore_*` svi `null` |
| **Nalaz: predugi nazivi** | `cand-0183` (128 znakova, REVIEW) i `cand-0272` (152, HOLD) prelaze limit Rules od 120 — moraju se skratiti ili prebaciti u bilješku |
| Lokacije koje traže odluku | 3 (`needs_review`): „Sve police iznad", „srednja i donja ladica", „2. i 3. polica" — zbirni opisi, **ne razdvajati automatski** |
| Zbirni kandidati | 3 `SUMMARY_DO_NOT_IMPORT` (Soba za hobi: tri kutije, sunčane naočale, božićni pokloni; sadržaj tih kutija opisan je zasebno → bez dvostrukog unosa) |

**Brojevi po prostoriji (kandidati) i lokacije za kreiranje**

| Prostorija | CANDIDATE | REVIEW | HOLD | SUMMARY | Lokacija za kreirati |
| --- | --- | --- | --- | --- | --- |
| Špajza | 54 | 39 | – | – | 27 |
| Kuhinja | 55 | 35 | – | – | 32 |
| Hodnik | 31 | 23 | – | – | 26 |
| Dnevni boravak (već unesen) | – | – | 38 | – | 0 (21 `RECONCILE_EXISTING`) |
| WC / Kupaonica | 43 | 9 | – | – | 22 |
| Soba za hobi | 26 | 11 | – | 3 | 15 |
| Spavaća soba | 15 | 11 | – | – | 18 |
| **Ukupno** | **224** | **128** | **38** | **3** | **140** (6 soba + 134 podlokacije: 43 polica, 32 ormara, 30 ostalo, 18 ladica, 11 kutija) |

`REVIEW`: 122 × „skupina / pojedinačni predmet / već evidentirano?", 6 × potencijalno osjetljiva kategorija. Ponovljeni nazivi: **40 kandidata u 19 grupa** (flag, ne deduplicirati). Osjetljivih kandidata ukupno 19 (10 Dnevni boravak, 6 Spavaća soba, 2 Hodnik, 1 Kuhinja).

**Kod `main`** (`ede881f`): `repository.ts`, `validation.ts`, `types.ts`, `firestore.rules`, `scripts/ops`, auth/session, `docs/P2_A_ADR.md` (kontrola u §2).

## 2. Kompatibilnost plana s aplikacijom

| Tema                                        | Stanje u kodu / Rules                                                                                                    | Posljedica za importer                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Pisanje                                     | Rules traže aktivnog **člana**, `createdBy == request.auth.uid`, `createdAt/updatedAt == request.time`, verzija 1        | Pisati smije samo prijavljeni član kroz klijentski SDK; Admin/IAM upis zaobilazi Rules i audit (odbačeno, vidi §3) |
| ID-evi                                      | `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 64                                                                                         | Deterministički ID-evi iz plana (npr. `imp1-loc-0007`, `imp1-it-0123`) → idempotentnost + jednostavan povrat       |
| `createLocation({name,parentId,kind,id})`   | prima unaprijed zadan `id`; idempotentan ponovni poziv (`alreadyExisted`); room samo pod root                            | koristi se izravno; redoslijed roditelj → dijete                                                                   |
| `createItemWithPlacement({…,kind,attempt})` | **`kind` obavezan** (`unique`/`type`); atomarno Item+Placement+ključ; idempotentno uz `attempt` (`itemId`,`placementId`) | plan nema `kind` → **vlasnikova odluka**; `attempt` ID-evi iz plana                                                |
| Količine                                    | ne postoje u P2 modelu                                                                                                   | `quantity=null` ostaje; ne izmišljati                                                                              |
| Brisanje                                    | Rules **ne dopuštaju** brisanje lokacija/predmeta/smještaja (samo ključa)                                                | povrat uvoza = privilegirani alat (§7), ne klijent                                                                 |
| Spark kvote                                 | 20k upisa i 50k čitanja/dan                                                                                              | samo `CANDIDATE`: 140 + 224×3 = **812 upisa**; uz sve `REVIEW`: 140 + 352×3 = **1 196 upisa**; ≈ 4–8k čitanja (uklj. Rules `get`) → < 10 % dnevnih kvota                                  |

## 3. Arhitektura: odluka o izvedbi (za vlasnika)

| Opcija                               | Opis                                                                                                                                                                                                              | Prednosti                                                                               | Rizici                                                                                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A (preporuka): Node CLI kao član** | `scripts/import/*.mjs` u Cloud Shellu; prijava kao stvarni član (Google access token iz `gcloud` → Firebase Auth `signInWithCredential`), upis isključivo kroz **postojeće repozitorijske transakcije** pod Rules | svaka operacija validirana Rules; nema novog Hostinga; audit točan (`createdBy` = član) | **nepotvrđeno** da `gcloud` token prolazi Firebase Auth (spike u fazi A, uz zasebno odobrenje jer dotiče produkcijski Auth, bez upisa); manifest treba prenijeti u Cloud Shell |
| B: ekran „Uvoz" u aplikaciji         | odabir datoteke na mobitelu, isti repozitorij                                                                                                                                                                     | nema prijenosa u Cloud Shell, ista sesija/član                                          | nova funkcija u bundleu (jednokratna) + **Hosting deploy** (izvan ove akcije); veći opseg UI testova                                                                           |
| C: Admin SDK / IAM REST upis         | zaobilazi Rules                                                                                                                                                                                                   | najbrže                                                                                 | **odbačeno** (handoff §Obvezna analiza): bez Rules validacije, nova ovisnost/arhitektura, rizik krivog audita                                                                  |

Snapshot (read-only): REST GET s vlasnikovim `gcloud` tokenom (isto kao `npm run backup`), ne zahtijeva Admin SDK. Snapshot se sprema isključivo u `~/backup` (chmod 600, izvan repozitorija), s kontrolnim hashom; nikad u Git ni u javne logove.

## 4. Redoslijed provedbe faze A (nakon odobrenja plana)

| Korak | Isporuka                                                                                                                                                                                                                                                                                                                                                                                                     | Dotiče produkciju?                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| A0    | Vlasnik odlučuje otvorena pitanja (§8) i arhitekturu (§3)                                                                                                                                                                                                                                                                                                                                                    | ne                                  |
| A1    | **Manifest + validator** (čisti TypeScript, bez mreže): učitava plan izvan repozitorija, mapira u manifest (`locations`, `items`, plan-ID → stabilni Firestore ID), validira invarijante (§1), odbija ≥ 120 znakova, `SUMMARY` uvijek SKIP, `REVIEW`/`HOLD` bez odluke SKIP                                                                                                                                  | ne                                  |
| A2    | **Reconcile** (čista funkcija): plan × snapshot → po lokaciji `USE_EXISTING/CREATE/REVIEW/SKIP` (provjera roditelja i vrste), po kandidatu `MATCH_EXISTING_ITEM/CREATE_ITEM_WITH_PLACEMENT/ADD_PLACEMENT/REVIEW/SKIP`; **Dnevni boravak početno SKIP/HOLD**                                                                                                                                                  | ne                                  |
| A3    | **Dry-run izvještaj**: po prostoriji create/match/skip/review, točne putanje, dvosmislenosti, ponovljeni nazivi (bez globalne dedupe), broj Firestore operacija i kvota, **finalni manifest + SHA-256** za potpis vlasnika; lokalni izlaz izvan repozitorija                                                                                                                                                 | ne                                  |
| A4    | **Read-only snapshot alat** (`npm run import:snapshot`, REST GET, `set -euo pipefail` stil kao `scripts/ops`) + testovi s lažnim odgovorima (HTTP greška, error objekt, pogrešan projekt/kućanstvo → stop)                                                                                                                                                                                                   | čita (samo uz odobrenje pokretanja) |
| A5    | **Apply engine** (neizvršen u produkciji): redoslijed lokacije pa stavke; jedna transakcija po zapisu (postojeće operacije); **checkpoint datoteka** (plan-ID → stvarni ID, ishod) uz `fsync`; pri `outcome-unknown` nikad novi ID — `verify()` pa isti pokušaj; fail-closed ako `hash(manifest)`/snapshot/commit/projekt/`CONFIRM` ne odgovaraju; **bez** brisanja, premještanja, arhiviranja, prepisivanja | ne (emulator)                       |
| A6    | **Emulator testovi** (§6)                                                                                                                                                                                                                                                                                                                                                                                    | ne                                  |
| A7    | **Backup/restore inventarnih podataka** zasebno od Rules backupa: izvoz = snapshot (A4); restore = **alat za povrat uvoza** koji briše isključivo dokumente s prefiksom `imp1-` navedene u checkpointu/manifestu, privilegirano (IAM) i uz `CONFIRM`; testiran u emulatoru **prije** live upisa                                                                                                              | ne (emulator)                       |
| A8    | Dokument postupka `dry-run` → potpis → `apply` → validacija → (po potrebi) povrat, s nacrtom naredbe `CONFIRM=… npm run import:apply` koja bez tokena i potpisanog hasha **ne radi**                                                                                                                                                                                                                         | ne                                  |
| A9    | PR + testni izvještaj + otvorene odluke; **stop**                                                                                                                                                                                                                                                                                                                                                            | ne                                  |

Faza B (apply) tek uz **novo izričito odobrenje** nakon što vlasnik pregleda sažetak i točan broj zapisa; bez Hosting/Rules deploya i bootstrapa.

## 5. Pravila mapiranja (predložena; vlasnik odobrava)

- Lokacije: `room` izravno pod Kućom; ostale vrste iz plana; nepoznata vrsta → `other`; postojeća lokacija se prepoznaje po (roditelj, naziv) **i** vrsti — neslaganje = `REVIEW`, nikad prepis.
- Stavka = jedan `Item` + jedan `Placement` po kandidatu (nema globalne deduplikacije po nazivu; ponovljeni nazivi (40 kandidata u 19 grupa) ostaju zasebni predmeti dok vlasnik izričito ne spoji u vrstu s više smještaja).
- `SUMMARY_DO_NOT_IMPORT` (3): strogo preskočeno. Zbirni redci (npr. „2. i 3. polica") **ostaju jedna lokacija**; kutije i njihov sadržaj ne dvostruko.
- Privatne/osjetljive stavke (19: dokumenti, lijekovi, računi): samo naziv i položaj, uz vlasnikovu potvrdu po kategoriji; sadržaj dokumenata se ne evidentira.
- `quantity`, kategorija: ostaju prazni. `note`: samo izvor („PDF 24.11.2026") ako vlasnik želi.

## 6. Plan testova (emulator + jedinični; bez produkcije)

Prazna špajza; postojeća lokacija (isti/različit roditelj i vrsta); dva ista naziva na različitim policama (dva predmeta); `unique`/`type`; duplicate placement key; postojeći Dnevni boravak (HOLD i usporedba); **ponovljeni isti manifest** (nula novih zapisa); **prekid usred uvoza** (resume iz checkpointa bez duplikata); **izmijenjeno stanje nakon dry-runa** (hash ne odgovara → stop); revizijski konflikt/`changed-elsewhere`; djelomično primijenjen uvoz; naziv > 120; sirovi `outcome-unknown` (SDK proxy); pogrešan projekt/kućanstvo; nema `CONFIRM`; curenje tokena/nazivā u logu (negativni test).

## 7. Sigurnost, backup i povrat

- **Fail-closed uvjeti prije `apply`:** projekt `home-inventory-pwa-218be`, kućanstvo `kuca1`, commit = zabilježeni, čist git, `hash(manifest)` = potpisani, svježi snapshot = snapshot iz dry-runa (inače ponovno planiranje), izvođač je aktivni član, `CONFIRM`.
- **Idempotentnost:** deterministički ID-evi + `attempt` → ponovno pokretanje je sigurno; ishod se prije ponavljanja provjerava na poslužitelju; nikad novi ID nakon timeouta.
- **Povrat:** uvoz samo dodaje; klijent ne može brisati (Rules). Povrat = privilegirani alat s popisom iz checkpointa, briše samo `imp1-*` dokumente (lokacije, predmete, smještaje, ključeve), nikad postojeće. Dok nije testiran u emulatoru, `apply` se ne odobrava.
- Podaci i logovi: `~/backup`/`~/import` (izvan Gita, `chmod 600`); logovi bez tokena/UID-ova, a nazivi samo u lokalnim datotekama.

## 8. Otvorena pitanja za vlasnika (minimalne odluke za masovni uvoz)

1. **Vrsta predmeta (`unique`/`type`)** — jedno pravilo za sve (npr. sve `type`, jer može imati više smještaja) ili po kategoriji? Bez odluke se ne uvozi ništa.
2. **`REVIEW` (128):** uvoziti skupno kako piše u PDF-u (jedan zapis za skupinu), razdvojiti, ili izostaviti dok ne pregledate sheet „Za provjeru"?
3. **Dnevni boravak:** ostaje HOLD; želite li da dry-run napravi samo usporedbu s onim što ste ručno unijeli (bez ikakvog upisa)?
4. **Ponovljeni nazivi (40 kandidata, 19 grupa):** zasebni predmeti (preporuka) ili spojiti u isti predmet s više mjesta?
5. **Privatne stavke (19):** uvesti samo nazive/položaje ili izostaviti?
6. **Arhitektura §3** (A = CLI kao član, B = ekran u aplikaciji) i **izvođač**: koji račun/član izvodi uvoz; može li se prenijeti manifest u Cloud Shell (upload) ili preferirate B?
7. Dva predugačka naziva (128 i 152 znaka): skratiti uz bilješku?

## 9. Rizici

| Rizik                                                     | Težina             | Mitigacija                                                                               |
| --------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| `gcloud` token ne prolazi Firebase Auth (opcija A)        | visoka (blokira A) | spike prije svega; rezerva B; nikad C                                                    |
| Krivi/duplicirani zapisi (nije moguće klijentski brisati) | visoka             | `REVIEW` ne ulazi; potpisani manifest; dry-run; privilegirani povrat po `imp1-` prefiksu |
| Promjena baze između dry-runa i apply                     | srednja            | snapshot hash, fail-closed                                                               |
| Prekid usred uvoza / timeout                              | srednja            | checkpoint, deterministički ID-evi, `verify()`                                           |
| Osjetljivi podaci u logovima/Gitu                         | visoka             | sve izvan repozitorija; test curenja; PR bez podataka                                    |
| Spark kvote                                               | niska              | ≈ 5–8 % dnevnih; transakcije sekvencijalno s pauzom                                      |
| Pogrešna interpretacija PDF redaka (zbirni opisi, kutije) | srednja            | status/REVIEW, bez automatskog razdvajanja, ručna odluka                                 |
| Mobilni Cloud Shell (unos/prijenos)                       | srednja            | kratke `npm` naredbe kao u `scripts/ops`; manifest preko uploada ili opcija B            |

## 10. Što se NE radi

Nema produkcijskih upisa, snapshota ni prijave dok vlasnik zasebno ne odobri; nema Admin SDK upisa; nema promjene Rules/Auth/članstva/Hostinga; nema bootstrapa/deploya; nema automatskog brisanja, premještanja, arhiviranja ni prepisivanja; stvarni podaci ne idu u repozitorij.
