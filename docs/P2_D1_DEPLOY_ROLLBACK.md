# P2_D1_DEPLOY_ROLLBACK — postupak ručnog deploya iz Cloud Shella i povrata

**Status: PRIPREMLJENO, NIJE IZVRŠENO.** Ništa iz ovog dokumenta nije pokrenuto. Svaki korak 4, 6 i 7 izvodi se **tek nakon zasebnog izričitog odobrenja** vlasnika u chatu. Projekt: `home-inventory-pwa-218be` (Spark), kućanstvo `kuca1`. Budžet 0 €: ne klikati _Upgrade_/Blaze, ne dodavati karticu, ne uključivati Cloud Functions/Storage/App Hosting.

Svaka naredba ima fiksni projekt i `--only`; nema generičkog `firebase deploy`. Sve se izvodi u Cloud Shellu (<https://shell.cloud.google.com>) računom vlasnika projekta. Vrijednosti u `<…>` zamijeniti; **nikad** ne lijepiti ključeve ni UID-ove u chat.

## 0. Preduvjeti (jednom)

- PR P2-D1 je spojen u `main` (vlasnikova odluka) i glavni razvoj je odobrio objavu.
- U Cloud Shellu postoji klon `home-inventory-pwa` i datoteka `.env.production.local` (iz P1.5; opis u `docs/OWNER_ACTIONS.md` §A.7). Ako nema, napraviti prema tom opisu. Datoteka ne smije biti u `git status`.

## 1. Provjera aktualne grane i konfiguracije

```bash
cd ~/home-inventory-pwa
git fetch origin && git checkout main && git pull --ff-only
git log -1 --format='%H %s'          # ZAPIŠI hash: to je verzija koja se objavljuje
git status --short                   # mora biti prazno (osim ignoriranih datoteka)
node -v                              # >= 20.19 (inače: nvm install 22 && nvm use 22)
npm ci
npm run check:no-actions             # OK: nema .github/workflows
npm run guard:rules                  # OK ... (sha256 157feee0f7ca)
sha256sum firestore.rules | cut -c1-12   # mora ispisati 157feee0f7ca
npm run build:prod                   # guard:env → build → guard:dist; ZAUSTAVLJENO = prekini i javi ispis
```

**Očekivano:** svi koraci OK; `guard:dist` ispisuje točan popis 9 datoteka (bez `.map`, bez `.env`, bez demo podataka). Ako ijedan korak javi problem — **STANI**.

## 2. Pregled ciljanog Firebase projekta

```bash
npx firebase login --no-localhost         # ako već nije
npx firebase projects:list                # mora sadržavati home-inventory-pwa-218be
npx firebase apps:list --project home-inventory-pwa-218be
npx firebase firestore:databases:list --project home-inventory-pwa-218be
```

Ručno u Console (CLI to ne pokazuje): plan je **Spark** (lijevo dolje); _Authentication → Settings → Authorized domains_ sadrži `home-inventory-pwa-218be.firebaseapp.com` i `.web.app`; Firestore je u _Production mode_. **Očekivano:** točno taj projekt, Spark. Bilo što drugo — STANI.

## 3. Sigurnosna kopija aktualnih pravila (prije ikakve objave)

```bash
mkdir -p ~/backup && cd ~/backup
TOKEN=$(gcloud auth print-access-token)
P=home-inventory-pwa-218be
RS=$(curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P" \
  "https://firebaserules.googleapis.com/v1/projects/$P/releases/cloud.firestore" | jq -r .rulesetName)
echo "$RS"                                                         # zapiši (npr. projects/…/rulesets/…)
curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P" \
  "https://firebaserules.googleapis.com/v1/$RS" | jq -r '.source.files[0].content' > rules-before-$(date +%Y%m%d-%H%M).rules
ls -l rules-before-*.rules && sha256sum rules-before-*.rules | cut -c1-12
head -20 rules-before-*.rules                                       # vizualno: P1 pravila (members/households)
```

**Očekivano:** neprazna datoteka s aktualnim pravilima i zapisano ime rulesetu (`$RS`). **Rezervno:** Console → _Firestore → Rules_ → označi i kopiraj sav tekst u lokalnu bilješku. Bez kopije se ne ide dalje. (Ako `jq` ili REST ne rade, koristi Console kopiju.)

Dodatno: snimi Hosting stanje — Console → _Hosting → Release history_: zapiši vrijeme/ID **trenutnog** izdanja (to je cilj povrata).

## 4. Objavljivanje odobrenih Firestore Rules REV-04 — _tek uz odobrenje_

```bash
npm run deploy:rules      # guard:rules → firebase deploy --only firestore:rules --project home-inventory-pwa-218be
```

Provjera: Console → _Firestore → Rules_ prikazuje vrijeme objave i tekst koji sadrži `placementKeys`, `meta`; `curl` ponavljanje iz koraka 3 daje novu datoteku čiji je `sha256sum | cut -c1-12` = `157feee0f7ca` (isti hash kao `firestore.rules` u repozitoriju; razmaci/završni redak mogu dati drugi hash — tada usporedi `diff firestore.rules <(…)`).

**Redoslijed je važan:** pravila idu **prije** aplikacije (nova aplikacija koristi `placementKeys`/`meta` koje stara pravila ne dopuštaju). Stara P1.5 aplikacija ne dodiruje inventar, pa objava pravila prije Hostinga ne šteti.

## 5. Provjera odobrenog Google Auth i članstva (Console, bez izmjena)

1. _Authentication → Sign-in method_: **Google = Enabled**; _Settings → Authorized domains_: `…firebaseapp.com` i `…web.app`.
2. _Authentication → Users_: oba testna Google računa postoje (UID-ovi se ne šalju u chat).
3. _Firestore → Data → `households/kuca1`_: polja `name` (string), `schemaVersion` (number 1).
4. _`households/kuca1/members/{UID-A}` i `{UID-B}`_: `uid` (string, = ID dokumenta), `role` = `member`, `enabled` = `true` (boolean).
5. **Nema** drugih članova, a **nema** kolekcija `locations`, `items`, `placements`, `placementKeys`, `meta` (ili su prazne). Ako postoje podaci iz ranijih pokušaja — STANI (aplikacija bi pokazala „nedosljedno"/stare podatke); javi vlasniku.

**Očekivano:** sve točno. Treći račun nije član.

## 6. Objavljivanje Hosting aplikacije — _tek uz odobrenje_

```bash
npm run deploy:hosting    # build:prod (sve provjere) → firebase deploy --only hosting --project home-inventory-pwa-218be
curl -sI https://home-inventory-pwa-218be.firebaseapp.com/ | head -5     # HTTP/2 200
curl -s  https://home-inventory-pwa-218be.firebaseapp.com/sw.js | head -c 200   # ne smije sadržavati API ključ
```

Provjera da u objavljenom paketu nema demo podataka (prije objave, nakon `build:prod`, ili na živoj adresi):

```bash
for w in 'Garaža' 'Špajza' 'Kuhinja' 'Regal' 'DEMO' 'simulat' 'fixture'; do printf "%s: " "$w"; grep -o "$w" dist/assets/*.js | wc -l; done   # sve mora biti 0
```

(`guard:dist` već odbija 17 demo markera; ovo je dodatna ručna provjera.) Console → _Hosting → Release history_: zapiši novo izdanje (vrijeme, commit koji si zapisao u koraku 1).

## 7. Kontrolirani početni bootstrap kućanstva (bez demo podataka) — _tek uz odobrenje_

1. Na **uređaju A** otvori aplikaciju, prijavi se. Očekuješ zaslon **„Počinjemo od prazne kuće"** s gumbom **Pripremi kućanstvo** (vidi se samo kad su sve tri kolekcije potvrđeno prazne).
2. Pritisni **Pripremi kućanstvo** jednom. Očekuješ „Spremljeno · potvrđeno online" i prazan prikaz Lokacija („Još nema prostorija").
3. Console provjera: nastali su **samo** `households/kuca1/locations/root` (naziv „Kuća", `kind: house`, `parentId: null`) i `households/kuca1/meta/tree` (`rev: 0`). **Ništa drugo.** Demo fixture (`docs/fixtures/P2_DEMO_HOUSE.json`) **nikad** se ne uvozi u `kuca1`.
4. Uređaj B: nakon prijave vidi praznu kuću (bez zaslona za pripremu).

## 8. Test na dva stvarna Android uređaja

Slijedi `docs/P2_D1_ANDROID_PILOT_CHECKLIST.md` (svaka stavka ima očekivani rezultat i PASS/FAIL). Rezultate upiši u izvještaj; blokirajuća FAIL stavka = zaustavi test i razmotri povrat (korak 10).

## 9. Što se može, a što se NE može automatski vratiti

| Što                                                                          | Vraća se?          | Kako / zašto                                                                                                                                                                                         |
| ---------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kod aplikacije (Hosting)                                                     | **Da**, u trenutku | Console → Hosting → Release history → Rollback na izdanje zabilježeno u koraku 3 (ili ponovna objava prethodnog commita)                                                                             |
| Firestore Rules                                                              | **Da**             | ponovna objava kopije iz koraka 3 (ili deny-all za hitno zaključavanje); trenutak od objave do povrata aplikacija radi s pravilima koja je tada imala                                                |
| Podaci u Firestoreu (bootstrap, testni predmeti/lokacije/smještaji, izmjene) | **NE automatski**  | Spark plan nema sigurnosnih kopija ni vraćanja na točku u vremenu (zahtijevaju Blaze, a on je zabranjen); rollback koda/pravila **ne mijenja** zapise. Jedino ručno brisanje/ispravak u Console (9c) |
| Posljedice zakašnjelog upisa (duplikat nakon odustajanja)                    | **NE automatski**  | ručno brisanje duplikata u Console ili u aplikaciji (P2 nema brisanje; vidi ograničenja)                                                                                                             |
| Service worker/ljuska na uređajima                                           | Djelomično         | nova ljuska se povlači pri sljedećem otvaranju (`sw.js` je `no-cache`); inače očisti podatke web-mjesta                                                                                              |

Posljedica: **prije koraka 7 (bootstrap) i svakog unosa podataka u `kuca1` treba biti jasno da se podaci ne mogu automatski vratiti.** Zato je bootstrap izričita, jednokratna radnja koja stvara samo dva dokumenta, a testni unosi se rade s unaprijed dogovorenim, zamjenjivim sadržajem (ne stvarnim popisom kuće) dok se P2-D2 ne ocijeni.

## 10. Povratak na prethodnu verziju

Odluka o povratu: vlasnik, uz glavni razvoj. Kriteriji: Google prijava ne radi, oštećenje/nedosljednost podataka, korisnik vidi tuđe/stare podatke, ne može se spremati zbog pravila, ili neprihvatljiv problem na Androidu.

**10a. Hosting (aplikacija).** Preferirano: Console → _Hosting → Release history_ → uz izdanje iz koraka 3 → _Rollback_ (trenutno, bez builda). Alternativa iz Cloud Shella: `git checkout <prethodni-commit> && npm ci && npm run deploy:hosting`. Nakon povrata na uređajima: zatvori i ponovno otvori PWA (service worker se osvježava; `sw.js` je `no-cache`); ako ostane stara ljuska — Chrome → Postavke web-mjesta → Očisti podatke samo za ovu domenu (aplikacija nema trajnih privatnih podataka).

**10b. Pravila.** Vrati sadržaj kopije iz koraka 3: u privremenu mapu stavi kopiju kao `firestore.rules` i pokreni
`npx firebase deploy --only firestore:rules --project home-inventory-pwa-218be`
(ne radi to u glavnom klonu — tamo ostaje `firestore.rules` REV-04), ili Console → _Firestore → Rules_ → zalijepi kopiju → _Publish_.
**Pažnja:** stara pravila **ne podržavaju** inventar (REV-04 aplikacija će prikazivati grešku/„samo pregled"); zato se pravila vraćaju zajedno s Hostingom iz 9a. **Hitno zaključavanje** (sumnja na curenje): Console → Rules → `rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }` → Publish (aplikacija prestaje raditi, podaci su sigurni).

**10c. Podaci.** Bootstrap i testni unosi su jedini zapisi inventara. Povrat podataka na „prazno": Console → `households/kuca1` → obriši dokumente u `placements`, `placementKeys`, `items`, `locations` (uključujući `root`) i `meta/tree` (brisanje kolekcije u Console briše sve njezine dokumente). **Ne brisati** `households/kuca1` ni `members`. Zatim ponovi korak 7 po potrebi. Brisanje radi isključivo vlasnik, nakon što potvrdi da se u kolekcijama ne nalazi ništa što treba zadržati.

**10d. Nakon povrata:** zapiši uzrok, vrijeme, što je vraćeno; ne ponavljaj objavu bez zasebnog odobrenja.

## 11. Postupak u slučaju neuspjelog bootstrapa ili sigurnosnog problema

**Neuspjeli ili nejasni bootstrap** (greška pri „Pripremi kućanstvo", ili Console pokazuje nešto osim `locations/root` + `meta/tree{rev:0}`):

1. **Ne pokušavaj ponovno nasumično.** Zabilježi što aplikacija piše (zaslon, poruka) i vrijeme.
2. Console → `households/kuca1`: što točno postoji? Ako postoji samo jedan od dokumenata (npr. `meta/tree` bez `locations/root`): ponovni pritisak na „Pripremi kućanstvo" je siguran (operacija je idempotentna — stvara samo ono što nedostaje). Ako aplikacija pokazuje „Podaci su nedosljedni" ili „Struktura lokacija nije ispravna": **ne mijenjaj iz aplikacije**; vlasnik ručno ispravlja u Console (obriši dokumente u `locations`/`meta` koje je stvorio bootstrap, ostavi `members` i `households/kuca1`), pa ponovi korak 7.
3. Ako se ne uspije u 2 pokušaja: povrat (korak 10) i prijava glavnom razvoju s zapisom iz točke 1.

**Sigurnosni problem** (korisnik vidi tuđe/stare podatke, nečlan vidi podatke, članstvo opozvano a podaci se i dalje prikazuju, sumnja na otvorena pravila):

1. **Odmah zaključaj:** Console → Rules → deny-all (naredba u 10b) → Publish. Time aplikacija prestaje čitati/pisati; podaci su zaštićeni.
2. Ne briši podatke prije nego što se utvrdi uzrok. Zabilježi: uređaj, račun (bez UID-a u chat), korake, vrijeme, snimku zaslona bez privatnog sadržaja.
3. Provjeri članove: Console → `members` (tko je `enabled:true`), Authentication → Users.
4. Hosting po potrebi na prethodno izdanje (10a). Nema nove objave bez zasebnog odobrenja i pregleda glavnog razvoja.
5. Nakon utvrđenog uzroka i ispravka: ponovno objavi pravila REV-04 (korak 4) tek uz odobrenje.

Sve izmjene u produkciji tijekom incidenta radi isključivo vlasnik; Claude Code/glavni razvoj ne dobivaju pristup računu.
