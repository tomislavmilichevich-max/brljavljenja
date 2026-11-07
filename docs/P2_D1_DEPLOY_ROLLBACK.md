# P2_D1_DEPLOY_ROLLBACK — postupak ručnog deploya iz Cloud Shella i povrata

**Status: PRIPREMLJENO, NIJE IZVRŠENO.** Ništa iz ovog dokumenta nije pokrenuto. Svaki korak 4, 6 i 7 izvodi se **tek nakon zasebnog izričitog odobrenja** vlasnika u chatu. Projekt: `home-inventory-pwa-218be` (Spark), kućanstvo `kuca1`. Budžet 0 €: ne klikati _Upgrade_/Blaze, ne dodavati karticu, ne uključivati Cloud Functions/Storage/App Hosting.

Svaka naredba ima fiksni projekt i `--only`; nema generičkog `firebase deploy`. Sve se izvodi u Cloud Shellu (<https://shell.cloud.google.com>) računom vlasnika projekta. Vrijednosti u `<…>` zamijeniti; **nikad** ne lijepiti ključeve ni UID-ove u chat.

## 0. Preduvjeti (prije PRVE objave; sve mora biti ispunjeno)

**0.1 Repozitorij i konfiguracija**

- PR P2-D1 (i ovaj dokumentacijski popravak) su spojeni u `main`, a vlasnik je izričito odobrio objavu.
- U Cloud Shellu postoji klon `~/home-inventory-pwa` i datoteka `~/home-inventory-pwa/.env.production.local` (iz P1.5; opis u `docs/OWNER_ACTIONS.md` §A.7). Datoteka ne smije biti u `git status`.

**0.2 Google Auth i dva aktivna člana (Console, samo čitanje; bez ovoga se NE objavljuje ništa)**

1. _Authentication → Sign-in method_: **Google = Enabled**. _Settings → Authorized domains_: `home-inventory-pwa-218be.firebaseapp.com` i `home-inventory-pwa-218be.web.app`.
2. _Authentication → Users_: oba testna Google računa postoje (UID-ovi se ne šalju u chat).
3. _Firestore → Data → `households/kuca1`_: polja `name` (string) i `schemaVersion` (number 1).
4. _`households/kuca1/members/{UID-A}` i `{UID-B}`_: `uid` (string, jednak ID-u dokumenta), `role` = `member`, `enabled` = `true` (boolean). **Točno dva aktivna člana**, nitko drugi.
5. Nema kolekcija `locations`, `items`, `placements`, `placementKeys`, `meta` (ili su prazne). Ako postoje podaci iz ranijih pokušaja — **STANI** i javi vlasniku (aplikacija bi pokazala „nedosljedno"/stare podatke).

**0.3 Razumijevanje rizika:** Hosting/Rules rollback **ne vraća podatke u Firestoreu** (vidi §9). Sadržaj koji se unosi tijekom pilota mora biti zamjenjiv.

## 1. Provjera aktualne grane i konfiguracije

```bash
cd ~/home-inventory-pwa
git fetch origin && git checkout main && git pull --ff-only
mkdir -p ~/backup
git rev-parse HEAD | tee ~/backup/deploy-commit.txt   # ZAPIŠI hash: to je verzija koja se objavljuje (koraci 4 i 6 ga provjeravaju)
git log -1 --format='%H %s'
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

## 3. Sigurnosna kopija aktualnih pravila i Hosting izdanja (prije ikakve objave)

Skripta **staje** (izlazni kod ≠ 0) ako REST odgovor sadrži grešku, ako nema aktivnog rulesetta (`null`), ako je sadržaj prazan ili ne izgleda kao Firestore pravila, ili ako sigurnosna kopija već postoji (ne prepisuje se). Pokreće se kao zasebna skripta (`bash`), pa `exit` ne zatvara Cloud Shell.

```bash
mkdir -p ~/backup && cat > ~/backup/backup-rules.sh <<'EOF'
#!/bin/bash
set -u
P=home-inventory-pwa-218be
OUT="$HOME/backup"
RULES="$OUT/rules-before-deploy.rules"
fail() { echo "ZAUSTAVLJENO: $1" >&2; exit 1; }
[ -e "$RULES" ] && fail "$RULES već postoji — ne prepisujem sigurnosnu kopiju (premjesti je ili preimenuj svjesno)"
command -v jq >/dev/null || fail "jq nije dostupan — koristi ručnu kopiju iz Console (vidi dolje)"
TOKEN=$(gcloud auth print-access-token) || fail "gcloud nema pristupni token"
[ -n "$TOKEN" ] || fail "prazan token"
HDR=(-H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P")

REL=$(curl -sS -f "${HDR[@]}" "https://firebaserules.googleapis.com/v1/projects/$P/releases/cloud.firestore") || fail "REST (release) vratio HTTP grešku"
echo "$REL" | jq -e 'has("error") | not' >/dev/null || fail "REST (release) vratio error objekt: $(echo "$REL" | jq -c .error)"
RS=$(echo "$REL" | jq -r '.rulesetName // empty')
[ -n "$RS" ] && [ "$RS" != "null" ] || fail "nema aktivnog rulesetta (rulesetName je prazan/null)"
echo "$RS" > "$OUT/ruleset-name-before.txt"

RSJ=$(curl -sS -f "${HDR[@]}" "https://firebaserules.googleapis.com/v1/$RS") || fail "REST (ruleset) vratio HTTP grešku"
echo "$RSJ" | jq -e 'has("error") | not' >/dev/null || fail "REST (ruleset) vratio error objekt: $(echo "$RSJ" | jq -c .error)"
echo "$RSJ" | jq -r '.source.files[0].content // empty' > "$RULES.tmp"
[ -s "$RULES.tmp" ] || { rm -f "$RULES.tmp"; fail "sadržaj pravila je prazan ili null"; }
[ "$(wc -c < "$RULES.tmp")" -ge 100 ] || { rm -f "$RULES.tmp"; fail "sadržaj pravila je sumnjivo kratak (< 100 B)"; }
grep -q "rules_version" "$RULES.tmp" && grep -q "service cloud.firestore" "$RULES.tmp" || { rm -f "$RULES.tmp"; fail "sadržaj ne izgleda kao Firestore pravila"; }
mv "$RULES.tmp" "$RULES"
sha256sum "$RULES" | tee "$OUT/rules-before-deploy.sha256"
echo "OK: sigurnosna kopija pravila -> $RULES  ($(wc -c < "$RULES") B), ruleset: $RS"

# Hosting: zabilježi trenutno aktivno izdanje (cilj povrata). Kopija pravila je već valjana; ako ovaj dio padne,
# izlazni kod je 2 i Hosting izdanje se bilježi RUČNO iz Console (rezerva ispod) — skripta se NE pokreće ponovno.
hfail() { echo "UPOZORENJE: $1 — pravila su sigurnosno kopirana, ali Hosting izdanje zabilježi RUČNO iz Console (vidi rezervu)" >&2; exit 2; }
HC=$(curl -sS -f "${HDR[@]}" "https://firebasehosting.googleapis.com/v1beta1/sites/$P/channels/live") || hfail "REST (hosting) vratio HTTP grešku"
echo "$HC" | jq -e 'has("error") | not' >/dev/null || hfail "REST (hosting) vratio error objekt"
echo "$HC" | jq -e '.release.version.name' >/dev/null || hfail "hosting kanal 'live' nema aktivno izdanje"
echo "$HC" > "$OUT/hosting-live-before.json"
echo "OK: Hosting live izdanje: $(echo "$HC" | jq -r '.release.version.name') (objavljeno $(echo "$HC" | jq -r '.release.releaseTime'))"
EOF
bash ~/backup/backup-rules.sh        # MORA završiti s dvije "OK:" linije; inače STANI
echo "izlazni kod: $?"
ls -l ~/backup/; head -30 ~/backup/rules-before-deploy.rules      # vizualno: P1 pravila (members/households)
```

**Očekivano:** `OK: sigurnosna kopija pravila …`, `OK: Hosting live izdanje: …`, izlazni kod `0` (izlazni kod `2` = pravila kopirana, ali Hosting treba zabilježiti ručno prema rezervi; **ne pokretati skriptu ponovno**, ona ne prepisuje postojeću kopiju), datoteke `rules-before-deploy.rules`, `rules-before-deploy.sha256`, `ruleset-name-before.txt`, `hosting-live-before.json`. **Bilo koji `ZAUSTAVLJENO:` = STANI; ne ide se na korak 4.**

**Rezervno (ako skripta ne radi, npr. nema `jq`):** Console → _Firestore → Rules_ → označi sav tekst → zalijepi u `~/backup/rules-before-deploy.rules` (`cat > ~/backup/rules-before-deploy.rules` pa zalijepi, Ctrl-D) i provjeri `wc -c` (> 100) i `grep -c "service cloud.firestore"` (= 1); Hosting: Console → _Hosting → Release history_ → zapiši ID/vrijeme trenutnog izdanja u `~/backup/hosting-live-before.txt`. **Bez valjane kopije pravila i zabilježenog Hosting izdanja ne ide se dalje.**

Dodatno zapiši (za povrat Hostinga) commit prethodne objave aplikacije ako je poznat (P1.5 bilješke vlasnika), npr. `echo <hash> > ~/backup/hosting-previous-commit.txt`.

## 4. Objavljivanje odobrenih Firestore Rules REV-04 — _tek uz odobrenje_

```bash
cd ~/home-inventory-pwa                                   # IZRIČITI povratak u repozitorij (prethodni koraci su radili u ~/backup)
pwd                                                       # mora ispisati …/home-inventory-pwa
[ "$(git rev-parse HEAD)" = "$(cat ~/backup/deploy-commit.txt)" ] || echo "STANI: HEAD se razlikuje od zabilježenog commita"
git status --short                                        # mora biti prazno
sha256sum firestore.rules | cut -c1-12                    # 157feee0f7ca
npm run deploy:rules      # guard:rules → firebase deploy --only firestore:rules --project home-inventory-pwa-218be
```

Provjera (nova pravila su objavljena, pregledom a ne pretpostavkom): Console → _Firestore → Rules_ prikazuje novo vrijeme objave i tekst koji sadrži `placementKeys` i `meta`. Neobavezno iz Cloud Shella (isti REST kao u koraku 3, bez prepisivanja kopije):

```bash
P=home-inventory-pwa-218be; TOKEN=$(gcloud auth print-access-token); H=(-H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P")
RS=$(curl -sS -f "${H[@]}" "https://firebaserules.googleapis.com/v1/projects/$P/releases/cloud.firestore" | jq -r '.rulesetName // empty')
[ -n "$RS" ] && curl -sS -f "${H[@]}" "https://firebaserules.googleapis.com/v1/$RS" | jq -r '.source.files[0].content // empty' > /tmp/rules-after.rules
diff <(sed -e '$a\' firestore.rules) <(sed -e '$a\' /tmp/rules-after.rules) && echo "OK: objavljena pravila = firestore.rules"
```

**Redoslijed je važan:** pravila idu **prije** aplikacije (nova aplikacija koristi `placementKeys`/`meta` koje stara pravila ne dopuštaju). Stara P1.5 aplikacija ne dodiruje inventar, pa objava pravila prije Hostinga ne šteti.

## 5. Ponovna provjera Auth/članstva neposredno prije Hostinga

Google Auth i dva aktivna člana su **preduvjet iz §0.2** (provjereni prije prve objave). Ovdje samo ponovno potvrdi da se od tada ništa nije promijenilo: dva `members` s `enabled:true`, Google = Enabled, još nema kolekcija inventara. Bilo što drugo — STANI.

## 6. Objavljivanje Hosting aplikacije — _tek uz odobrenje_

```bash
cd ~/home-inventory-pwa                                   # IZRIČITI povratak u repozitorij (ne u ~/backup)
pwd                                                       # …/home-inventory-pwa
[ "$(git rev-parse HEAD)" = "$(cat ~/backup/deploy-commit.txt)" ] || echo "STANI: HEAD se razlikuje od zabilježenog commita"
git status --short                                        # prazno
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
| Podaci u Firestoreu (bootstrap, testni predmeti/lokacije/smještaji, izmjene) | **NE automatski**  | Spark plan nema sigurnosnih kopija ni vraćanja na točku u vremenu (zahtijevaju Blaze, a on je zabranjen); rollback koda/pravila **ne mijenja** zapise. Jedino ručno brisanje/ispravak u Console (10c) |
| Posljedice zakašnjelog upisa (duplikat nakon odustajanja)                    | **NE automatski**  | ručno brisanje duplikata u Console ili u aplikaciji (P2 nema brisanje; vidi ograničenja)                                                                                                             |
| Service worker/ljuska na uređajima                                           | Djelomično         | nova ljuska se povlači pri sljedećem otvaranju (`sw.js` je `no-cache`); inače očisti podatke web-mjesta                                                                                              |

**Izričito:** (1) **Hosting rollback i Rules rollback NE vraćaju Firestore podatke** — mijenjaju samo kod koji se poslužuje i pravila koja se primjenjuju; svi dokumenti (`locations`, `items`, `placements`, `placementKeys`, `meta`) ostaju točno onakvi kakvi jesu. (2) **Hitno zaključavanje pravila (deny-all) ne briše nikakve podatke:** samo blokira nove čitanja i pisanja **klijenata** (aplikacije). Vlasnik i dalje vidi i uređuje podatke u Firebase Console (Console zaobilazi pravila). Već otvorene kartice mogu još kratko prikazivati podatke koje su prije učitale u memoriju, ali ne mogu ni čitati novo ni pisati; zatvaranjem aplikacije sve nestaje. (3) Povrat podataka je isključivo ručan (10c).

Posljedica: **prije koraka 7 (bootstrap) i svakog unosa podataka u `kuca1` treba biti jasno da se podaci ne mogu automatski vratiti.** Zato je bootstrap izričita, jednokratna radnja koja stvara samo dva dokumenta, a testni unosi se rade s unaprijed dogovorenim, zamjenjivim sadržajem (ne stvarnim popisom kuće) dok se P2-D2 ne ocijeni.

## 10. Povratak na prethodnu verziju

Odluka o povratu: vlasnik, uz glavni razvoj. Kriteriji: Google prijava ne radi, oštećenje/nedosljednost podataka, korisnik vidi tuđe/stare podatke, ne može se spremati zbog pravila, ili neprihvatljiv problem na Androidu.

**10a. Hosting (aplikacija).** Preferirano: Console → _Hosting → Release history_ → uz izdanje iz koraka 3 → _Rollback_ (trenutno, bez builda). Alternativa iz Cloud Shella (ako je prethodni commit zabilježen u `~/backup/hosting-previous-commit.txt`): `cd ~/home-inventory-pwa && git checkout $(cat ~/backup/hosting-previous-commit.txt) && npm ci && npm run deploy:hosting`, a zatim `git checkout main`. Povrat Hostinga **ne vraća podatke** (§9). Nakon povrata na uređajima: zatvori i ponovno otvori PWA (service worker se osvježava; `sw.js` je `no-cache`); ako ostane stara ljuska — Chrome → Postavke web-mjesta → Očisti podatke samo za ovu domenu (aplikacija nema trajnih privatnih podataka).

**10b. Pravila (izvršivo iz Cloud Shella, koristi točno sigurnosnu kopiju iz koraka 3).** Firebase CLI traži `firebase.json`; zato se pravi **zasebna privremena konfiguracija** i referencira s `--config` (CLI ju koristi kao korijen projekta, `rules` je relativan prema njoj, pa se NE dira `firestore.rules` u repozitoriju):

```bash
# 1) provjeri da je kopija valjana i nepromijenjena
cd ~/backup
[ -s rules-before-deploy.rules ] && [ "$(wc -c < rules-before-deploy.rules)" -ge 100 ] || echo "STANI: kopija nije valjana"
sha256sum -c rules-before-deploy.sha256              # mora ispisati: rules-before-deploy.rules: OK
grep -q "service cloud.firestore" rules-before-deploy.rules && echo "OK: izgleda kao Firestore pravila"

# 2) privremena konfiguracija s ISTOM kopijom
rm -rf ~/backup/rollback-rules && mkdir -p ~/backup/rollback-rules
cp ~/backup/rules-before-deploy.rules ~/backup/rollback-rules/firestore.rules
cat > ~/backup/rollback-rules/firebase.json <<'EOF'
{ "firestore": { "rules": "firestore.rules" } }
EOF
cmp ~/backup/rules-before-deploy.rules ~/backup/rollback-rules/firestore.rules && echo "OK: konfiguracija koristi točno sigurnosnu kopiju"

# 3) objava — IZ repozitorija (da npx pronađe lokalni firebase-tools); fiksni projekt, samo pravila
cd ~/home-inventory-pwa && pwd
npx firebase deploy --only firestore:rules --project home-inventory-pwa-218be --config ~/backup/rollback-rules/firebase.json

# 4) provjera: aktivna pravila == kopija
P=home-inventory-pwa-218be; TOKEN=$(gcloud auth print-access-token); H=(-H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P")
RS=$(curl -sS -f "${H[@]}" "https://firebaserules.googleapis.com/v1/projects/$P/releases/cloud.firestore" | jq -r '.rulesetName // empty')
curl -sS -f "${H[@]}" "https://firebaserules.googleapis.com/v1/$RS" | jq -r '.source.files[0].content // empty' > /tmp/rules-now.rules
diff <(sed -e '$a\' ~/backup/rules-before-deploy.rules) <(sed -e '$a\' /tmp/rules-now.rules) && echo "OK: pravila vraćena na sigurnosnu kopiju"
```

Rezervno: Console → _Firestore → Rules_ → obriši sadržaj, zalijepi `cat ~/backup/rules-before-deploy.rules` → _Publish_. Ako `cmp`/`sha256sum -c` padne — **STANI** (kopija nije ona iz koraka 3).

**Pažnja:** stara pravila **ne podržavaju** inventar (aplikacija REV-04 će prikazivati grešku/„samo pregled"); zato se pravila vraćaju zajedno s Hostingom iz 10a. Povrat pravila **ne mijenja podatke** (§9).

**Hitno zaključavanje (deny-all)** — sumnja na curenje; **ne briše podatke**, samo blokira klijente (§9). Isti postupak, drugi sadržaj:

```bash
rm -rf ~/backup/lockdown && mkdir -p ~/backup/lockdown
cat > ~/backup/lockdown/firestore.rules <<'EOF'
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
EOF
echo '{ "firestore": { "rules": "firestore.rules" } }' > ~/backup/lockdown/firebase.json
cd ~/home-inventory-pwa && pwd
npx firebase deploy --only firestore:rules --project home-inventory-pwa-218be --config ~/backup/lockdown/firebase.json
```

(Brže: Console → _Firestore → Rules_ → zalijepi sadržaj iz `~/backup/lockdown/firestore.rules` → _Publish_.) Nakon zaključavanja aplikacija prestaje čitati i pisati; podaci ostaju netaknuti.

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
5. Nakon utvrđenog uzroka i ispravka: ponovno objavi pravila REV-04 (korak 4; `cd ~/home-inventory-pwa` prije `npm run deploy:rules`) tek uz odobrenje.

Sve izmjene u produkciji tijekom incidenta radi isključivo vlasnik; Claude Code/glavni razvoj ne dobivaju pristup računu.
