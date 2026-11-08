# P2_D1_DEPLOY_ROLLBACK — postupak ručnog deploya iz Cloud Shella i povrata (P2-D2: skripte u `scripts/ops`)

**Status: PRIPREMLJENO, NIJE IZVRŠENO.** Ništa iz ovog dokumenta nije pokrenuto. Svaki korak 4, 6 i 7 izvodi se **tek nakon zasebnog izričitog odobrenja** vlasnika u chatu. Projekt: `home-inventory-pwa-218be` (Spark), kućanstvo `kuca1`. Budžet 0 €: ne klikati _Upgrade_/Blaze, ne dodavati karticu, ne uključivati Cloud Functions/Storage/App Hosting.

**Fail-closed:** svaka naredba koja mijenja produkciju (`deploy:rules`, `deploy:hosting`, `firebase deploy` za povrat pravila) pokreće se **isključivo iz skripti u repozitoriju** (`scripts/ops/*.sh`, pozivaju se kratkim `npm run …` naredbama; vidi §2a). Skripta radi u vlastitom `bash` procesu sa `set -euo pipefail`, pa greška **ne zatvara** tvoj Cloud Shell; svaki obavezni uvjet je `die` (izlaz 1) **prije** naredbe za deploy. Nikad se ne koristi `|| echo "STANI"` nakon kojeg bi se nastavilo. Deploy naredba se nalazi tek na kraju skripte i pokreće se samo ako je prošao SVAKI uvjet i ako je zadana izričita potvrda (`CONFIRM=…`, daje se tek nakon vlasnikova odobrenja).

Svaka naredba ima fiksni projekt i `--only`; nema generičkog `firebase deploy`. Sve se izvodi u Cloud Shellu (<https://shell.cloud.google.com>) računom vlasnika projekta. Vrijednosti u `<…>` zamijeniti; **nikad** ne lijepiti ključeve ni UID-ove u chat.

## Mobilni Cloud Shell — doslovni kratki redoslijed naredbi

Sve su naredbe kratke (nema lijepljenja skripti). Ništa od ovoga ne mijenja produkciju **do** koraka s `CONFIRM=`; te korake pokreći **tek nakon izričitog vlasnikova odobrenja u chatu** i svaki zasebno.

**A. Priprema i sigurnosna kopija (samo čitanje; smije odmah)**

```bash
cd ~/home-inventory-pwa
git pull --ff-only
npm ci
npm run prep
npm run backup
```

Javi ispis zadnja dva koraka (bez ključeva). `npm run prep` provjerava lokalno (grana `main` = `origin/main`, čist git, hash pravila `157feee0f7ca`, `guard:rules`, `guard:env`, projekt) i zapisuje commit u `~/backup/deploy-commit.txt`; `npm run backup` samo čita aktivna pravila i Hosting izdanje i sprema kopiju u `~/backup` (izvan repozitorija; postojeću kopiju ne prepisuje).

**B. Objava pravila — tek uz odobrenje**

```bash
cd ~/home-inventory-pwa
CONFIRM=DA-OBJAVI-PRAVILA npm run ops:deploy-rules
```

**C. Objava aplikacije — tek uz zasebno odobrenje (i tek kad je B uspio)**

```bash
cd ~/home-inventory-pwa
CONFIRM=DA-OBJAVI-HOSTING npm run ops:deploy-hosting
```

**D. Povrat / hitno zaključavanje — samo na vlasnikovu odluku**

```bash
cd ~/home-inventory-pwa
CONFIRM=DA-VRATI-PRAVILA npm run ops:rollback-rules
CONFIRM=DA-ZAKLJUCAJ-PRAVILA npm run ops:lockdown-rules
```

(drugi redak je za hitno zaključavanje i NE briše podatke; prvi vraća točno kopiju pravila iz koraka A). Svaka naredba završava s `OK: …` ili `ZAUSTAVLJENO: …` (izlaz 1; tada se ništa nije objavilo). Bez `CONFIRM=` skripta odbija raditi. **Ne pokreći `npm run deploy:rules` ni `npm run deploy:hosting` izravno** (zaobilaze zaštite); koristi samo `ops:…` naredbe.

## 0. Preduvjeti (prije PRVE objave; sve mora biti ispunjeno)

**0.1 Repozitorij i konfiguracija**

- PR-ovi P2-D1 i P2-D2 (skripte `scripts/ops`) su spojeni u `main`, a vlasnik je izričito odobrio objavu.
- U Cloud Shellu postoji klon `~/home-inventory-pwa` i datoteka `~/home-inventory-pwa/.env.production.local` (iz P1.5; opis u `docs/OWNER_ACTIONS.md` §A.7). Datoteka ne smije biti u `git status`.

**0.2 Google Auth i dva aktivna člana (Console, samo čitanje; bez ovoga se NE objavljuje ništa)**

1. _Authentication → Sign-in method_: **Google = Enabled**. _Settings → Authorized domains_: `home-inventory-pwa-218be.firebaseapp.com` i `home-inventory-pwa-218be.web.app`.
2. _Authentication → Users_: oba testna Google računa postoje (UID-ovi se ne šalju u chat).
3. _Firestore → Data → `households/kuca1`_: polja `name` (string) i `schemaVersion` (number 1).
4. _`households/kuca1/members/{UID-A}` i `{UID-B}`_: `uid` (string, jednak ID-u dokumenta), `role` = `member`, `enabled` = `true` (boolean). **Točno dva aktivna člana**, nitko drugi.
5. Nema kolekcija `locations`, `items`, `placements`, `placementKeys`, `meta` (ili su prazne). Ako postoje podaci iz ranijih pokušaja — **STANI** i javi vlasniku (aplikacija bi pokazala „nedosljedno"/stare podatke).

**0.3 Razumijevanje rizika:** Hosting/Rules rollback **ne vraća podatke u Firestoreu** (vidi §9). Sadržaj koji se unosi tijekom pilota mora biti zamjenjiv.

**0.4 Obavezni uvjeti naspram informativnih provjera**

| Vrsta                                            | Što                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Posljedica neuspjeha                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **OBAVEZNO (skripta provodi, deploy zabranjen)** | izričita potvrda `CONFIRM`; skripta se nalazi u korijenu Git repozitorija; `HEAD` = zabilježeni commit (40-znamenkasti hash); `git status --porcelain` prazan (i nepraćene datoteke); `sha256` `firestore.rules` = `157feee0f7ca`; `guard:rules`; valjana sigurnosna kopija pravila (`sha256sum -c`, ≥ 100 B, sadrži `rules_version` i `service cloud.firestore`); zabilježeno Hosting izdanje; za Hosting još: `.env.production.local` + `guard:env` + **aktivna pravila na poslužitelju jednaka `firestore.rules`** (REST mora uspjeti) | skripta ispiše `ZAUSTAVLJENO: …` i **izađe s kodom 1 bez poziva deploya** |
| **INFORMATIVNO (samo ispis, ne zaustavlja)**     | ispisi u koracima 1 i 2 (`git log`, `node -v`, `projects:list`, `apps:list`), `ls -l ~/backup`, `head` kopije pravila, ručni pregledi u Console                                                                                                                                                                                                                                                                                                                                                                                           | čovjek ih pročita; ne zamjenjuju obavezne uvjete                          |

## 1. Provjera aktualne grane i konfiguracije

```bash
cd ~/home-inventory-pwa
git pull --ff-only
npm ci
npm run prep
```

`npm run prep` (skripta `scripts/ops/prepare.sh`) **ne mijenja produkciju** (jedina mrežna radnja je `git fetch origin main`). Obavezni uvjeti (izlaz 1 = STANI): grana `main` i `HEAD` = `origin/main`; čist `git status` (uklj. nepraćene datoteke); `sha256(firestore.rules)` = `157feee0f7ca`; `check:no-actions`; `guard:rules`; `.env.production.local` postoji, projekt u njemu je točno `home-inventory-pwa-218be`, `guard:env`; instaliran `firebase-tools`, `jq`, `gcloud`. Zapisuje `HEAD` u `~/backup/deploy-commit.txt` (nakon svakog `git pull` ponovno pokreni `npm run prep`). Za puni probni build (informativno): `npm run build:prod`.

## 2. Pregled ciljanog Firebase projekta

```bash
npx firebase login --no-localhost         # ako već nije
npx firebase projects:list                # mora sadržavati home-inventory-pwa-218be
npx firebase apps:list --project home-inventory-pwa-218be
npx firebase firestore:databases:list --project home-inventory-pwa-218be
```

Ručno u Console (CLI to ne pokazuje): plan je **Spark** (lijevo dolje); _Authentication → Settings → Authorized domains_ sadrži `home-inventory-pwa-218be.firebaseapp.com` i `.web.app`; Firestore je u _Production mode_. **Očekivano:** točno taj projekt, Spark. Bilo što drugo — STANI.

## 2a. Skripte u repozitoriju (verzionirane; ništa se ne lijepi ručno)

| npm naredba                  | Datoteka                                 | Mijenja produkciju?                  | Potvrda                        |
| ---------------------------- | ---------------------------------------- | ------------------------------------ | ------------------------------ |
| `npm run prep`               | `scripts/ops/prepare.sh`                 | **Ne**                               | —                              |
| `npm run backup`             | `scripts/ops/backup-rules.sh`            | **Ne** (samo REST GET)               | —                              |
| `npm run ops:deploy-rules`   | `scripts/ops/deploy-rules.sh`            | **Da** — objava pravila              | `CONFIRM=DA-OBJAVI-PRAVILA`    |
| `npm run ops:deploy-hosting` | `scripts/ops/deploy-hosting.sh`          | **Da** — objava aplikacije           | `CONFIRM=DA-OBJAVI-HOSTING`    |
| `npm run ops:rollback-rules` | `scripts/ops/rollback-rules.sh backup`   | **Da** — povrat pravila na kopiju    | `CONFIRM=DA-VRATI-PRAVILA`     |
| `npm run ops:lockdown-rules` | `scripts/ops/rollback-rules.sh lockdown` | **Da** — deny-all (ne briše podatke) | `CONFIRM=DA-ZAKLJUCAJ-PRAVILA` |
| `npm run test:ops`           | `scripts/ops/test-ops.sh`                | Ne (lažni podaci, stubovi)           | —                              |

Zajedničke zaštite su u `scripts/ops/lib.sh`. Sve skripte rade u vlastitom `bash` procesu sa `set -euo pipefail` (greška ne zatvara Cloud Shell). `prep` i `backup` **ne sadrže nijednu naredbu za objavu** (provjerava `test:ops`). Sigurnosne kopije idu isključivo u `~/backup` (skripte odbijaju raditi ako bi `~/backup` bio unutar repozitorija; `.gitignore` dodatno blokira imena kopija). Token se ne ispisuje i ne prosljeđuje u argumentima naredbi (ide kroz stdin `curl -K -`); UID-ovi se nigdje ne ispisuju. Izvorni kod skripti je pregledljiv u repozitoriju; test: `npm run test:ops` (118 provjera, vidi `docs/P2_D2_OPS_TEST_REPORT.md`).

## 3. Sigurnosna kopija aktualnih pravila i Hosting izdanja (prije ikakve objave)

Naredba `npm run backup` (skripta `scripts/ops/backup-rules.sh`) samo **čita** iz produkcije (REST GET). Staje (`ZAUSTAVLJENO`, izlaz 1) na HTTP grešku, **pogrešan projekt** (ime rulesetta ili Hosting izdanja ne pripada `home-inventory-pwa-218be`), `error` objekt, `null`/prazan ruleset, prazan/prekratak sadržaj, sadržaj koji ne izgleda kao Firestore pravila, ili ako bilo koja datoteka kopije već postoji (ništa se ne prepisuje; postojeća kopija ostaje netaknuta). Sadržaj se prvo piše u svježi privremeni file i u `~/backup` ide tek nakon što je validiran.

```bash
cd ~/home-inventory-pwa
npm run backup
```

**Očekivano:** `OK: sigurnosna kopija pravila …`, `OK: Hosting live izdanje: …`, izlaz `0`; datoteke `rules-before-deploy.rules`, `rules-before-deploy.sha256`, `ruleset-name-before.txt`, `hosting-live-before.json`. **Izlaz 1 (`ZAUSTAVLJENO`) = STANI** (nema kopije). Izlazni kod `2` = pravila kopirana, ali Hosting treba zabilježiti ručno (rezerva ispod); **ne pokretati ponovno** (ne prepisuje kopiju). Bez ovih datoteka naredbe iz koraka 4 i 6 **odbijaju** raditi.

**Rezervno (ako skripta ne radi, npr. nema `jq`):** Console → _Firestore → Rules_ → označi sav tekst → `cat > ~/backup/rules-before-deploy.rules` (zalijepi, Ctrl-D); zatim `cd ~/backup && sha256sum rules-before-deploy.rules > rules-before-deploy.sha256`; `echo "<ime rulesetta ili ručna oznaka>" > ruleset-name-before.txt`; Hosting: Console → _Hosting → Release history_ → `echo "<ID/vrijeme trenutnog izdanja>" > ~/backup/hosting-live-before.txt`. Skripte i dalje provjeravaju veličinu i sadržaj kopije.

Dodatno (neobavezno) zapiši commit prethodne objave aplikacije ako je poznat: `echo <hash> > ~/backup/hosting-previous-commit.txt`.

## 4. Objavljivanje odobrenih Firestore Rules REV-04 — _tek uz odobrenje_

```bash
cd ~/home-inventory-pwa
CONFIRM=DA-OBJAVI-PRAVILA npm run ops:deploy-rules
```

Skripta radi iz korijena repozitorija u kojem se nalazi i fizički ne pokreće `npm run deploy:rules` ako ijedan obavezni uvjet (§0.4) ne prođe: skripta nije u korijenu Git repozitorija, **pogrešan projekt u konfiguraciji**, `HEAD` ≠ zabilježeni commit, nečist `git status`, hash `firestore.rules` ≠ `157feee0f7ca`, `guard:rules` pao, nevaljana sigurnosna kopija ili nezabilježeno Hosting izdanje, odsutna potvrda `CONFIRM`. Nakon deploya **sama** dohvaća aktivna pravila REST-om u svježi privremeni file i uspoređuje ih s `firestore.rules`; svaka greška REST-a ili razlika = izlaz 1 (nikad se ne čita stara datoteka).

**Očekivano:** `OK: aktivna pravila (…) odgovaraju …/firestore.rules` i `OK: pravila REV-04 objavljena i potvrđena`, izlaz `0`. Izlaz 1 **prije** deploya = ništa nije objavljeno; izlaz 1 **nakon** `npm run deploy:rules` = objava je možda prošla — pogledaj Console → _Firestore → Rules_ i javi ispis; ne nastavljaj na korak 6.
Dodatno informativno: Console → _Firestore → Rules_ prikazuje novo vrijeme objave i tekst s `placementKeys` i `meta`.

**Redoslijed je važan:** pravila idu **prije** aplikacije (nova aplikacija koristi `placementKeys`/`meta` koje stara pravila ne dopuštaju); skripta za Hosting to i provodi. Stara P1.5 aplikacija ne dodiruje inventar, pa objava pravila prije Hostinga ne šteti.

## 5. Ponovna provjera Auth/članstva neposredno prije Hostinga

Google Auth i dva aktivna člana su **preduvjet iz §0.2** (provjereni prije prve objave). Ovdje samo ponovno potvrdi da se od tada ništa nije promijenilo: dva `members` s `enabled:true`, Google = Enabled, još nema kolekcija inventara. Bilo što drugo — STANI.

## 6. Objavljivanje Hosting aplikacije — _tek uz odobrenje_

```bash
cd ~/home-inventory-pwa
CONFIRM=DA-OBJAVI-HOSTING npm run ops:deploy-hosting
```

Skripta provodi iste obavezne uvjete kao korak 4 te još: `.env.production.local` postoji, projekt u njemu je točno `home-inventory-pwa-218be`, `guard:env` prolazi, i **aktivna pravila na poslužitelju moraju biti jednaka `firestore.rules`** (REST mora uspjeti; inače je Hosting zabranjen). Tek tada pokreće `npm run deploy:hosting` (koji sam radi `build:prod` s `guard:dist`). Poslije provjerava `HTTP 200` i da `sw.js` ne sadrži API ključ.

**Informativno (ručno, ne zaustavlja):** u Console → _Hosting → Release history_ zabilježi novo izdanje; i ručna provjera da u paketu nema demo podataka:

```bash
cd ~/home-inventory-pwa && for w in 'Garaža' 'Špajza' 'Kuhinja' 'Regal' 'DEMO' 'simulat' 'fixture'; do printf "%s: " "$w"; grep -o "$w" dist/assets/*.js | wc -l; done   # sve 0
```

(`guard:dist` već odbija 17 demo markera i ZAUSTAVLJA deploy; ovo je samo dodatni ispis.)

## 7. Kontrolirani početni bootstrap kućanstva (bez demo podataka) — _tek uz odobrenje_

1. Na **uređaju A** otvori aplikaciju, prijavi se. Očekuješ zaslon **„Počinjemo od prazne kuće"** s gumbom **Pripremi kućanstvo** (vidi se samo kad su sve tri kolekcije potvrđeno prazne).
2. Pritisni **Pripremi kućanstvo** jednom. Očekuješ „Spremljeno · potvrđeno online" i prazan prikaz Lokacija („Još nema prostorija").
3. Console provjera: nastali su **samo** `households/kuca1/locations/root` (naziv „Kuća", `kind: house`, `parentId: null`) i `households/kuca1/meta/tree` (`rev: 0`). **Ništa drugo.** Demo fixture (`docs/fixtures/P2_DEMO_HOUSE.json`) **nikad** se ne uvozi u `kuca1`.
4. Uređaj B: nakon prijave vidi praznu kuću (bez zaslona za pripremu).

## 8. Test na dva stvarna Android uređaja

Slijedi `docs/P2_D1_ANDROID_PILOT_CHECKLIST.md` (svaka stavka ima očekivani rezultat i PASS/FAIL). Rezultate upiši u izvještaj; blokirajuća FAIL stavka = zaustavi test i razmotri povrat (korak 10).

## 9. Što se može, a što se NE može automatski vratiti

| Što                                                                          | Vraća se?          | Kako / zašto                                                                                                                                                                                          |
| ---------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kod aplikacije (Hosting)                                                     | **Da**, u trenutku | Console → Hosting → Release history → Rollback na izdanje zabilježeno u koraku 3 (ili ponovna objava prethodnog commita)                                                                              |
| Firestore Rules                                                              | **Da**             | ponovna objava kopije iz koraka 3 (ili deny-all za hitno zaključavanje); trenutak od objave do povrata aplikacija radi s pravilima koja je tada imala                                                 |
| Podaci u Firestoreu (bootstrap, testni predmeti/lokacije/smještaji, izmjene) | **NE automatski**  | Spark plan nema sigurnosnih kopija ni vraćanja na točku u vremenu (zahtijevaju Blaze, a on je zabranjen); rollback koda/pravila **ne mijenja** zapise. Jedino ručno brisanje/ispravak u Console (10c) |
| Posljedice zakašnjelog upisa (duplikat nakon odustajanja)                    | **NE automatski**  | ručno brisanje duplikata u Console ili u aplikaciji (P2 nema brisanje; vidi ograničenja)                                                                                                              |
| Service worker/ljuska na uređajima                                           | Djelomično         | nova ljuska se povlači pri sljedećem otvaranju (`sw.js` je `no-cache`); inače očisti podatke web-mjesta                                                                                               |

**Izričito:** (1) **Hosting rollback i Rules rollback NE vraćaju Firestore podatke** — mijenjaju samo kod koji se poslužuje i pravila koja se primjenjuju; svi dokumenti (`locations`, `items`, `placements`, `placementKeys`, `meta`) ostaju točno onakvi kakvi jesu. (2) **Hitno zaključavanje pravila (deny-all) ne briše nikakve podatke:** samo blokira nove čitanja i pisanja **klijenata** (aplikacije). Vlasnik i dalje vidi i uređuje podatke u Firebase Console (Console zaobilazi pravila). Već otvorene kartice mogu još kratko prikazivati podatke koje su prije učitale u memoriju, ali ne mogu ni čitati novo ni pisati; zatvaranjem aplikacije sve nestaje. (3) Povrat podataka je isključivo ručan (10c).

Posljedica: **prije koraka 7 (bootstrap) i svakog unosa podataka u `kuca1` treba biti jasno da se podaci ne mogu automatski vratiti.** Zato je bootstrap izričita, jednokratna radnja koja stvara samo dva dokumenta, a testni unosi se rade s unaprijed dogovorenim, zamjenjivim sadržajem (ne stvarnim popisom kuće) dok se P2-D2 ne ocijeni.

## 10. Povratak na prethodnu verziju

Odluka o povratu: vlasnik, uz glavni razvoj. Kriteriji: Google prijava ne radi, oštećenje/nedosljednost podataka, korisnik vidi tuđe/stare podatke, ne može se spremati zbog pravila, ili neprihvatljiv problem na Androidu.

**10a. Hosting (aplikacija).** Preferirano: Console → _Hosting → Release history_ → uz izdanje iz koraka 3 → _Rollback_ (trenutno, bez builda). Jedini podržani put je Console Rollback. Ako nije dostupan, **ne improviziraj deploy naredbe** u Cloud Shellu — javi glavnom razvoju (ponovna objava starog commita ide kroz iste skripte i zasebno odobrenje). Povrat Hostinga **ne vraća podatke** (§9). Nakon povrata na uređajima: zatvori i ponovno otvori PWA (service worker se osvježava; `sw.js` je `no-cache`); ako ostane stara ljuska — Chrome → Postavke web-mjesta → Očisti podatke samo za ovu domenu (aplikacija nema trajnih privatnih podataka).

**10b. Pravila (izvršivo, fail-closed).** Naredba `npm run ops:rollback-rules` (`scripts/ops/rollback-rules.sh backup`) koristi **točno** sigurnosnu kopiju iz koraka 3. Prije bilo kakvog deploya mora proći: postojanje i neprazan sadržaj kopije, `sha256sum -c` (kopija = zabilježeni hash), veličina ≥ 100 B, sadržaj s `rules_version` i `service cloud.firestore`, `ruleset-name-before.txt`, `cmp` privremene kopije s izvornom kopijom, valjanost privremene `firebase.json` (`jq`), instaliran `firebase-tools` u repozitoriju. **Bilo koji neuspjeh = `ZAUSTAVLJENO`, izlaz 1, deploy se ne pokreće.** CLI koristi `--config` (korijen projekta je direktorij te datoteke, `rules` je relativan prema njoj), pa se `firestore.rules` u repozitoriju NE dira.

```bash
cd ~/home-inventory-pwa
CONFIRM=DA-VRATI-PRAVILA npm run ops:rollback-rules
```

Nakon deploya skripta REST-om (svježi privremeni file, svaka greška = izlaz 1) provjerava da su aktivna pravila jednaka kopiji. Rezervno (ako skripta ne radi): Console → _Firestore → Rules_ → zalijepi `cat ~/backup/rules-before-deploy.rules` → _Publish_ — samo ako je kopija prethodno provjerena (`cd ~/backup && sha256sum -c rules-before-deploy.sha256`).

**Pažnja:** stara pravila **ne podržavaju** inventar (aplikacija REV-04 će prikazivati grešku/„samo pregled"); zato se pravila vraćaju zajedno s Hostingom iz 10a. Povrat pravila **ne mijenja podatke** (§9).

**Hitno zaključavanje (deny-all)** — sumnja na curenje; **ne briše podatke**, samo blokira nove klijentske pristupe (§9):

```bash
cd ~/home-inventory-pwa
CONFIRM=DA-ZAKLJUCAJ-PRAVILA npm run ops:lockdown-rules
```

(Rezerva ako `npm` ne radi — Console → _Firestore → Rules_ → zamijeni sadržaj ovim → _Publish_:)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Nakon zaključavanja aplikacija prestaje čitati i pisati; podaci ostaju netaknuti.

**10c. Podaci.** Bootstrap i testni unosi su jedini zapisi inventara. Povrat podataka na „prazno": Console → `households/kuca1` → obriši dokumente u `placements`, `placementKeys`, `items`, `locations` (uključujući `root`) i `meta/tree` (brisanje kolekcije u Console briše sve njezine dokumente). **Ne brisati** `households/kuca1` ni `members`. Zatim ponovi korak 7 po potrebi. Brisanje radi isključivo vlasnik, nakon što potvrdi da se u kolekcijama ne nalazi ništa što treba zadržati.

**10d. Nakon povrata:** zapiši uzrok, vrijeme, što je vraćeno; ne ponavljaj objavu bez zasebnog odobrenja.

## 11. Postupak u slučaju neuspjelog bootstrapa ili sigurnosnog problema

**Neuspjeli ili nejasni bootstrap** (greška pri „Pripremi kućanstvo", ili Console pokazuje nešto osim `locations/root` + `meta/tree{rev:0}`):

1. **Ne pokušavaj ponovno nasumično.** Zabilježi što aplikacija piše (zaslon, poruka) i vrijeme.
2. Console → `households/kuca1`: što točno postoji? Ako postoji samo jedan od dokumenata (npr. `meta/tree` bez `locations/root`): ponovni pritisak na „Pripremi kućanstvo" je siguran (operacija je idempotentna — stvara samo ono što nedostaje). Ako aplikacija pokazuje „Podaci su nedosljedni" ili „Struktura lokacija nije ispravna": **ne mijenjaj iz aplikacije**; vlasnik ručno ispravlja u Console (obriši dokumente u `locations`/`meta` koje je stvorio bootstrap, ostavi `members` i `households/kuca1`), pa ponovi korak 7.
3. Ako se ne uspije u 2 pokušaja: povrat (korak 10) i prijava glavnom razvoju s zapisom iz točke 1.

**Sigurnosni problem** (korisnik vidi tuđe/stare podatke, nečlan vidi podatke, članstvo opozvano a podaci se i dalje prikazuju, sumnja na otvorena pravila):

1. **Odmah zaključaj:** deny-all prema 10b (Console → Rules → Publish, ili CLI). Time se **blokiraju novi pristupi klijenata; podaci se NE brišu** i vlasnik ih i dalje vidi u Console.
2. Ne briši podatke prije nego što se utvrdi uzrok. Zabilježi: uređaj, račun (bez UID-a u chat), korake, vrijeme, snimku zaslona bez privatnog sadržaja.
3. Provjeri članove: Console → `members` (tko je `enabled:true`), Authentication → Users.
4. Hosting po potrebi na prethodno izdanje (10a). Nema nove objave bez zasebnog odobrenja i pregleda glavnog razvoja.
5. Nakon utvrđenog uzroka i ispravka: ponovno objavi pravila REV-04 naredbom iz koraka 4 (`npm run ops:deploy-rules`) tek uz zasebno odobrenje.

Sve izmjene u produkciji tijekom incidenta radi isključivo vlasnik; Claude Code/glavni razvoj ne dobivaju pristup računu.
