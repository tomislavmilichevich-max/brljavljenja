# P2_D1_DEPLOY_ROLLBACK — postupak ručnog deploya iz Cloud Shella i povrata

**Status: PRIPREMLJENO, NIJE IZVRŠENO.** Ništa iz ovog dokumenta nije pokrenuto. Svaki korak 4, 6 i 7 izvodi se **tek nakon zasebnog izričitog odobrenja** vlasnika u chatu. Projekt: `home-inventory-pwa-218be` (Spark), kućanstvo `kuca1`. Budžet 0 €: ne klikati _Upgrade_/Blaze, ne dodavati karticu, ne uključivati Cloud Functions/Storage/App Hosting.

**Fail-closed:** svaka naredba koja mijenja produkciju (`deploy:rules`, `deploy:hosting`, `firebase deploy` za povrat pravila) pokreće se **isključivo iz skripti** u §2a. Skripta radi u vlastitom `bash` procesu sa `set -euo pipefail`, pa greška **ne zatvara** tvoj Cloud Shell; svaki obavezni uvjet je `die` (izlaz 1) **prije** naredbe za deploy. Nikad se ne koristi `|| echo "STANI"` nakon kojeg bi se nastavilo. Deploy naredba se nalazi tek na kraju skripte i pokreće se samo ako je prošao SVAKI uvjet i ako je zadana izričita potvrda (`CONFIRM=…`, daje se tek nakon vlasnikova odobrenja).

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

**0.4 Obavezni uvjeti naspram informativnih provjera**

| Vrsta                                            | Što                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Posljedica neuspjeha                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **OBAVEZNO (skripta provodi, deploy zabranjen)** | izričita potvrda `CONFIRM`; postojanje klona `~/home-inventory-pwa` i da je to korijen repozitorija; `HEAD` = zabilježeni commit (40-znamenkasti hash); `git status --porcelain` prazan (i nepraćene datoteke); `sha256` `firestore.rules` = `157feee0f7ca`; `guard:rules`; valjana sigurnosna kopija pravila (`sha256sum -c`, ≥ 100 B, sadrži `rules_version` i `service cloud.firestore`); zabilježeno Hosting izdanje; za Hosting još: `.env.production.local` + `guard:env` + **aktivna pravila na poslužitelju jednaka `firestore.rules`** (REST mora uspjeti) | skripta ispiše `ZAUSTAVLJENO: …` i **izađe s kodom 1 bez poziva deploya** |
| **INFORMATIVNO (samo ispis, ne zaustavlja)**     | ispisi u koracima 1 i 2 (`git log`, `node -v`, `projects:list`, `apps:list`), `ls -l ~/backup`, `head` kopije pravila, ručni pregledi u Console                                                                                                                                                                                                                                                                                                                                                                                                                     | čovjek ih pročita; ne zamjenjuju obavezne uvjete                          |

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

**Ovaj korak je informativan** (pregled i zapis commita); iste obavezne uvjete ponovno provode skripte u koracima 4 i 6. **Očekivano:** svi koraci OK; `guard:dist` ispisuje točan popis 9 datoteka (bez `.map`, bez `.env`, bez demo podataka). Ako ijedan korak javi problem — **STANI**.

## 2. Pregled ciljanog Firebase projekta

```bash
npx firebase login --no-localhost         # ako već nije
npx firebase projects:list                # mora sadržavati home-inventory-pwa-218be
npx firebase apps:list --project home-inventory-pwa-218be
npx firebase firestore:databases:list --project home-inventory-pwa-218be
```

Ručno u Console (CLI to ne pokazuje): plan je **Spark** (lijevo dolje); _Authentication → Settings → Authorized domains_ sadrži `home-inventory-pwa-218be.firebaseapp.com` i `.web.app`; Firestore je u _Production mode_. **Očekivano:** točno taj projekt, Spark. Bilo što drugo — STANI.

## 2a. Instalacija pomoćnih skripti (jednom, bez ikakvog učinka na produkciju)

Skripte samo stvaraju datoteke u `~/backup`; ništa se ne izvršava i ništa se ne objavljuje.

```bash
mkdir -p ~/backup
cat > ~/backup/lib.sh <<'EOF'
# Zajednička biblioteka (uključuje se s `source`; sama ništa ne objavljuje). Svaka skripta radi u VLASTITOM bash procesu.
set -euo pipefail
P=home-inventory-pwa-218be
REPO="$HOME/home-inventory-pwa"
BK="$HOME/backup"
EXPECTED_RULES_SHA12=157feee0f7ca
die() { echo "ZAUSTAVLJENO: $*" >&2; exit 1; }
need_confirm() { [ "${CONFIRM:-}" = "$1" ] || die "nema izričite potvrde (pokreni s CONFIRM=$1 TEK nakon vlasnikova odobrenja)"; }

# OBAVEZNI UVJETI repozitorija: svaki neuspjeh = izlaz 1 (deploy se ne pokreće)
preflight_repo() {
  [ -d "$REPO/.git" ] || die "ne postoji klon $REPO"
  cd "$REPO" || die "cd $REPO nije uspio"
  [ "$(git rev-parse --show-toplevel)" = "$(pwd -P)" ] || die "trenutni direktorij nije korijen repozitorija $REPO"
  local want have
  want=$(cat "$BK/deploy-commit.txt" 2>/dev/null) || die "nema $BK/deploy-commit.txt (korak 1)"
  [[ "$want" =~ ^[0-9a-f]{40}$ ]] || die "deploy-commit.txt ne sadrži valjan 40-znamenkasti hash"
  have=$(git rev-parse HEAD)
  [ "$have" = "$want" ] || die "HEAD ($have) se razlikuje od zabilježenog commita ($want)"
  [ -z "$(git status --porcelain --untracked-files=all)" ] || die "git status nije čist (nepraćene ili izmijenjene datoteke)"
  [ -f firestore.rules ] || die "nema firestore.rules"
  [ "$(sha256sum firestore.rules | cut -c1-12)" = "$EXPECTED_RULES_SHA12" ] || die "hash firestore.rules nije $EXPECTED_RULES_SHA12"
  npm run guard:rules >/dev/null || die "guard:rules je javio problem"
}

# OBAVEZNI UVJETI sigurnosne kopije (korak 3): bez valjane kopije nema objave ni povrata
validate_backup() {
  local f="$BK/rules-before-deploy.rules"
  [ -s "$f" ] || die "nema valjane sigurnosne kopije pravila ($f)"
  [ "$(wc -c < "$f")" -ge 100 ] || die "sigurnosna kopija je sumnjivo kratka"
  grep -q "rules_version" "$f" && grep -q "service cloud.firestore" "$f" || die "sigurnosna kopija ne izgleda kao Firestore pravila"
  [ -s "$BK/rules-before-deploy.sha256" ] || die "nema $BK/rules-before-deploy.sha256"
  (cd "$BK" && sha256sum -c rules-before-deploy.sha256 >/dev/null 2>&1) || die "sha256sum -c: kopija se razlikuje od zabilježenog hasha"
  [ -s "$BK/ruleset-name-before.txt" ] || die "nema ruleset-name-before.txt"
}
validate_hosting_record() {
  [ -s "$BK/hosting-live-before.json" ] || [ -s "$BK/hosting-live-before.txt" ] || die "nije zabilježeno trenutno Hosting izdanje (hosting-live-before.json/.txt)"
}

# Provjera aktivnih pravila na poslužitelju: SVEŽ privremeni file; svaki neuspjeh REST-a = izlaz 1 (nikad stara datoteka)
verify_live_rules() {
  local expected="$1" tmp token rel rs rsj
  [ -s "$expected" ] || die "očekivana pravila ($expected) ne postoje ili su prazna"
  tmp=$(mktemp) || die "mktemp"
  token=$(gcloud auth print-access-token) || { rm -f "$tmp"; die "gcloud nema pristupni token"; }
  [ -n "$token" ] || { rm -f "$tmp"; die "prazan token"; }
  local H=(-H "Authorization: Bearer $token" -H "x-goog-user-project: $P")
  rel=$(curl -sS -f "${H[@]}" "https://firebaserules.googleapis.com/v1/projects/$P/releases/cloud.firestore") || { rm -f "$tmp"; die "REST (release) nije uspio"; }
  echo "$rel" | jq -e 'has("error") | not' >/dev/null || { rm -f "$tmp"; die "REST (release) vratio error objekt"; }
  rs=$(echo "$rel" | jq -r '.rulesetName // empty')
  { [ -n "$rs" ] && [ "$rs" != "null" ]; } || { rm -f "$tmp"; die "nema aktivnog rulesetta"; }
  rsj=$(curl -sS -f "${H[@]}" "https://firebaserules.googleapis.com/v1/$rs") || { rm -f "$tmp"; die "REST (ruleset) nije uspio"; }
  echo "$rsj" | jq -e 'has("error") | not' >/dev/null || { rm -f "$tmp"; die "REST (ruleset) vratio error objekt"; }
  echo "$rsj" | jq -j '.source.files[0].content // empty' > "$tmp"
  [ -s "$tmp" ] || { rm -f "$tmp"; die "aktivna pravila su prazna ili null"; }
  if ! diff <(sed -e '$a\' "$expected") <(sed -e '$a\' "$tmp") >/dev/null; then rm -f "$tmp"; die "aktivna pravila na poslužitelju se RAZLIKUJU od $expected"; fi
  rm -f "$tmp"
  echo "OK: aktivna pravila ($rs) odgovaraju $expected"
}
EOF
cat > ~/backup/backup-rules.sh <<'EOF'
#!/bin/bash
# Korak 3: sigurnosna kopija aktualnih pravila + zapis Hosting izdanja. Samo ČITA iz produkcije (REST GET).
set -euo pipefail
OUT="$HOME/backup"; mkdir -p "$OUT"
source "$OUT/lib.sh"
RULES="$OUT/rules-before-deploy.rules"
[ ! -e "$RULES" ] || die "$RULES već postoji — ne prepisujem sigurnosnu kopiju (premjesti je ili preimenuj svjesno)"
command -v jq >/dev/null || die "jq nije dostupan — koristi ručnu kopiju iz Console (rezerva u dokumentu)"
TOKEN=$(gcloud auth print-access-token) || die "gcloud nema pristupni token"
[ -n "$TOKEN" ] || die "prazan token"
HDR=(-H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P")
REL=$(curl -sS -f "${HDR[@]}" "https://firebaserules.googleapis.com/v1/projects/$P/releases/cloud.firestore") || die "REST (release) vratio HTTP grešku"
echo "$REL" | jq -e 'has("error") | not' >/dev/null || die "REST (release) vratio error objekt"
RS=$(echo "$REL" | jq -r '.rulesetName // empty')
{ [ -n "$RS" ] && [ "$RS" != "null" ]; } || die "nema aktivnog rulesetta (rulesetName je prazan/null)"
RSJ=$(curl -sS -f "${HDR[@]}" "https://firebaserules.googleapis.com/v1/$RS") || die "REST (ruleset) vratio HTTP grešku"
echo "$RSJ" | jq -e 'has("error") | not' >/dev/null || die "REST (ruleset) vratio error objekt"
TMP=$(mktemp)
echo "$RSJ" | jq -j '.source.files[0].content // empty' > "$TMP"
[ -s "$TMP" ] || { rm -f "$TMP"; die "sadržaj pravila je prazan ili null"; }
[ "$(wc -c < "$TMP")" -ge 100 ] || { rm -f "$TMP"; die "sadržaj pravila je sumnjivo kratak (< 100 B)"; }
{ grep -q "rules_version" "$TMP" && grep -q "service cloud.firestore" "$TMP"; } || { rm -f "$TMP"; die "sadržaj ne izgleda kao Firestore pravila"; }
echo "$RS" > "$OUT/ruleset-name-before.txt"
mv "$TMP" "$RULES"
(cd "$OUT" && sha256sum rules-before-deploy.rules > rules-before-deploy.sha256)
cat "$OUT/rules-before-deploy.sha256"
echo "OK: sigurnosna kopija pravila -> $RULES ($(wc -c < "$RULES") B), ruleset: $RS"
# Hosting: ako ovaj dio padne, izlaz je 2 — izdanje se bilježi RUČNO iz Console; skriptu NE pokretati ponovno
hfail() { echo "UPOZORENJE: $1 — pravila su kopirana, ali Hosting izdanje zabilježi RUČNO iz Console (rezerva)" >&2; exit 2; }
HC=$(curl -sS -f "${HDR[@]}" "https://firebasehosting.googleapis.com/v1beta1/sites/$P/channels/live") || hfail "REST (hosting) vratio HTTP grešku"
echo "$HC" | jq -e 'has("error") | not' >/dev/null || hfail "REST (hosting) vratio error objekt"
echo "$HC" | jq -e '.release.version.name' >/dev/null || hfail "hosting kanal 'live' nema aktivno izdanje"
echo "$HC" > "$OUT/hosting-live-before.json"
echo "OK: Hosting live izdanje: $(echo "$HC" | jq -r '.release.version.name') (objavljeno $(echo "$HC" | jq -r '.release.releaseTime'))"
EOF
cat > ~/backup/deploy-rules.sh <<'EOF'
#!/bin/bash
# Korak 4: objava pravila REV-04. Jedini poziv deploya je zadnja naredba; do tada svaki uvjet mora proći.
set -euo pipefail
source "$HOME/backup/lib.sh"
need_confirm DA-OBJAVI-PRAVILA
preflight_repo          # direktorij, HEAD, git status, hash pravila, guard:rules
validate_backup         # valjana kopija prethodnih pravila (korak 3)
validate_hosting_record # zabilježeno Hosting izdanje
echo "Objavljujem pravila: commit $(git rev-parse --short HEAD), sha256 ${EXPECTED_RULES_SHA12}, projekt $P"
npm run deploy:rules
verify_live_rules "$REPO/firestore.rules"
echo "OK: pravila REV-04 objavljena i potvrđena na poslužitelju"
EOF
cat > ~/backup/deploy-hosting.sh <<'EOF'
#!/bin/bash
# Korak 6: objava aplikacije. ZABRANJENO dok REV-04 pravila nisu potvrđena kao aktivna na poslužitelju.
set -euo pipefail
source "$HOME/backup/lib.sh"
need_confirm DA-OBJAVI-HOSTING
preflight_repo
validate_backup
validate_hosting_record
[ -s "$REPO/.env.production.local" ] || die "nema $REPO/.env.production.local (konfiguracija)"
npm run guard:env >/dev/null || die "guard:env: konfiguracija nije valjana za $P"
verify_live_rules "$REPO/firestore.rules"   # pravila moraju biti objavljena PRIJE aplikacije; REST greška = zabrana
echo "Objavljujem aplikaciju: commit $(git rev-parse --short HEAD), projekt $P"
npm run deploy:hosting
curl -sSfI "https://$P.firebaseapp.com/" | head -1
SW=$(curl -sSf "https://$P.firebaseapp.com/sw.js") || die "sw.js nije dohvaćen"
if echo "$SW" | grep -q 'AIza'; then die "sw.js sadrži API ključ"; fi
echo "OK: Hosting objavljen (provjeri Release history u Console i zabilježi izdanje)"
EOF
cat > ~/backup/rollback-rules.sh <<'EOF'
#!/bin/bash
# Korak 10b: povrat pravila. Argument: backup (točna kopija iz koraka 3) ili lockdown (deny-all; NE briše podatke).
set -euo pipefail
source "$HOME/backup/lib.sh"
MODE="${1:-}"
case "$MODE" in
  backup) need_confirm DA-VRATI-PRAVILA ;;
  lockdown) need_confirm DA-ZAKLJUCAJ-PRAVILA ;;
  *) die "upotreba: rollback-rules.sh backup|lockdown" ;;
esac
[ -d "$REPO" ] || die "ne postoji $REPO"
[ -x "$REPO/node_modules/.bin/firebase" ] || die "firebase-tools nije instaliran u $REPO (npm ci)"
WORK="$BK/rollback-$MODE"
rm -rf "$WORK"; mkdir -p "$WORK"
if [ "$MODE" = backup ]; then
  validate_backup
  cp "$BK/rules-before-deploy.rules" "$WORK/firestore.rules"
  cmp -s "$BK/rules-before-deploy.rules" "$WORK/firestore.rules" || die "cmp: privremena kopija nije identična sigurnosnoj kopiji"
else
  cat > "$WORK/firestore.rules" <<'LOCK'
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
LOCK
  grep -q "allow read, write: if false;" "$WORK/firestore.rules" || die "lockdown sadržaj nije ispravan"
fi
echo '{ "firestore": { "rules": "firestore.rules" } }' > "$WORK/firebase.json"
jq -e '.firestore.rules == "firestore.rules"' "$WORK/firebase.json" >/dev/null || die "neispravna firebase.json"
[ -f "$WORK/firestore.rules" ] || die "nema $WORK/firestore.rules"
cd "$REPO"
npx firebase deploy --only firestore:rules --project "$P" --config "$WORK/firebase.json"
verify_live_rules "$WORK/firestore.rules"
echo "OK: pravila vraćena ($MODE) i potvrđena na poslužitelju. Podaci u Firestoreu NISU promijenjeni."
EOF
for f in lib backup-rules deploy-rules deploy-hosting rollback-rules; do bash -n ~/backup/$f.sh && echo "$f.sh: sintaksa OK"; done
```

## 3. Sigurnosna kopija aktualnih pravila i Hosting izdanja (prije ikakve objave)

Skripta `backup-rules.sh` samo **čita** iz produkcije (REST GET). Staje (`ZAUSTAVLJENO`, izlaz 1) na HTTP grešku, `error` objekt, `null`/prazan ruleset, prazan/prekratak sadržaj, sadržaj koji ne izgleda kao Firestore pravila, ili ako kopija već postoji (ne prepisuje se). Sadržaj se prvo piše u svježi privremeni file i u `~/backup` ide tek nakon što je validiran.

```bash
bash ~/backup/backup-rules.sh; echo "izlazni kod: $?"
ls -l ~/backup/; head -30 ~/backup/rules-before-deploy.rules      # informativno: P1 pravila (members/households)
```

**Očekivano:** `OK: sigurnosna kopija pravila …`, `OK: Hosting live izdanje: …`, izlazni kod `0`; datoteke `rules-before-deploy.rules`, `rules-before-deploy.sha256`, `ruleset-name-before.txt`, `hosting-live-before.json`. **Izlazni kod 1 = STANI** (nema kopije). Izlazni kod `2` = pravila kopirana, ali Hosting treba zabilježiti ručno (rezerva ispod); **skriptu ne pokretati ponovno** (ne prepisuje kopiju). Bez ovih datoteka skripte iz koraka 4 i 6 **odbijaju** raditi.

**Rezervno (ako skripta ne radi, npr. nema `jq`):** Console → _Firestore → Rules_ → označi sav tekst → `cat > ~/backup/rules-before-deploy.rules` (zalijepi, Ctrl-D); zatim `cd ~/backup && sha256sum rules-before-deploy.rules > rules-before-deploy.sha256`; `echo "<ime rulesetta ili ručna oznaka>" > ruleset-name-before.txt`; Hosting: Console → _Hosting → Release history_ → `echo "<ID/vrijeme trenutnog izdanja>" > ~/backup/hosting-live-before.txt`. Skripte i dalje provjeravaju veličinu i sadržaj kopije.

Dodatno (neobavezno) zapiši commit prethodne objave aplikacije ako je poznat: `echo <hash> > ~/backup/hosting-previous-commit.txt`.

## 4. Objavljivanje odobrenih Firestore Rules REV-04 — _tek uz odobrenje_

```bash
CONFIRM=DA-OBJAVI-PRAVILA bash ~/backup/deploy-rules.sh; echo "izlazni kod: $?"
```

Skripta **sama** prelazi u `~/home-inventory-pwa` i fizički ne pokreće `npm run deploy:rules` ako ijedan obavezni uvjet (§0.4) ne prođe: nema klona/neispravan direktorij, `HEAD` ≠ zabilježeni commit, nečist `git status`, hash `firestore.rules` ≠ `157feee0f7ca`, `guard:rules` pao, nevaljana sigurnosna kopija ili nezabilježeno Hosting izdanje, odsutna potvrda `CONFIRM`. Nakon deploya **sama** dohvaća aktivna pravila REST-om u svježi privremeni file i uspoređuje ih s `firestore.rules`; svaka greška REST-a ili razlika = izlaz 1 (nikad se ne čita stara datoteka).

**Očekivano:** `OK: aktivna pravila (…) odgovaraju …/firestore.rules` i `OK: pravila REV-04 objavljena i potvrđena`, izlaz `0`. Izlaz 1 **prije** deploya = ništa nije objavljeno; izlaz 1 **nakon** `npm run deploy:rules` = objava je možda prošla — pogledaj Console → _Firestore → Rules_ i javi ispis; ne nastavljaj na korak 6.
Dodatno informativno: Console → _Firestore → Rules_ prikazuje novo vrijeme objave i tekst s `placementKeys` i `meta`.

**Redoslijed je važan:** pravila idu **prije** aplikacije (nova aplikacija koristi `placementKeys`/`meta` koje stara pravila ne dopuštaju); skripta za Hosting to i provodi. Stara P1.5 aplikacija ne dodiruje inventar, pa objava pravila prije Hostinga ne šteti.

## 5. Ponovna provjera Auth/članstva neposredno prije Hostinga

Google Auth i dva aktivna člana su **preduvjet iz §0.2** (provjereni prije prve objave). Ovdje samo ponovno potvrdi da se od tada ništa nije promijenilo: dva `members` s `enabled:true`, Google = Enabled, još nema kolekcija inventara. Bilo što drugo — STANI.

## 6. Objavljivanje Hosting aplikacije — _tek uz odobrenje_

```bash
CONFIRM=DA-OBJAVI-HOSTING bash ~/backup/deploy-hosting.sh; echo "izlazni kod: $?"
```

Skripta provodi iste obavezne uvjete kao korak 4 te još: `.env.production.local` postoji, `guard:env` prolazi, i **aktivna pravila na poslužitelju moraju biti jednaka `firestore.rules`** (REST mora uspjeti; inače je Hosting zabranjen). Tek tada pokreće `npm run deploy:hosting` (koji sam radi `build:prod` s `guard:dist`). Poslije provjerava `HTTP 200` i da `sw.js` ne sadrži API ključ.

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

**10b. Pravila (izvršivo, fail-closed).** Skripta `rollback-rules.sh` koristi **točno** sigurnosnu kopiju iz koraka 3. Prije bilo kakvog deploya mora proći: postojanje i neprazan sadržaj kopije, `sha256sum -c` (kopija = zabilježeni hash), veličina ≥ 100 B, sadržaj s `rules_version` i `service cloud.firestore`, `ruleset-name-before.txt`, `cmp` privremene kopije s izvornom kopijom, valjanost privremene `firebase.json` (`jq`), instaliran `firebase-tools` u repozitoriju. **Bilo koji neuspjeh = `ZAUSTAVLJENO`, izlaz 1, deploy se ne pokreće.** CLI koristi `--config` (korijen projekta je direktorij te datoteke, `rules` je relativan prema njoj), pa se `firestore.rules` u repozitoriju NE dira.

```bash
CONFIRM=DA-VRATI-PRAVILA bash ~/backup/rollback-rules.sh backup; echo "izlazni kod: $?"
```

Nakon deploya skripta REST-om (svježi privremeni file, svaka greška = izlaz 1) provjerava da su aktivna pravila jednaka kopiji. Rezervno (ako skripta ne radi): Console → _Firestore → Rules_ → zalijepi `cat ~/backup/rules-before-deploy.rules` → _Publish_ — samo ako je kopija prethodno provjerena (`cd ~/backup && sha256sum -c rules-before-deploy.sha256`).

**Pažnja:** stara pravila **ne podržavaju** inventar (aplikacija REV-04 će prikazivati grešku/„samo pregled"); zato se pravila vraćaju zajedno s Hostingom iz 10a. Povrat pravila **ne mijenja podatke** (§9).

**Hitno zaključavanje (deny-all)** — sumnja na curenje; **ne briše podatke**, samo blokira nove klijentske pristupe (§9):

```bash
CONFIRM=DA-ZAKLJUCAJ-PRAVILA bash ~/backup/rollback-rules.sh lockdown; echo "izlazni kod: $?"
```

(Brže, ručno: Console → _Firestore → Rules_ → zalijepi deny-all iz `~/backup/rollback-lockdown/firestore.rules` ili sadržaj iz skripte → _Publish_.) Nakon zaključavanja aplikacija prestaje čitati i pisati; podaci ostaju netaknuti.

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
5. Nakon utvrđenog uzroka i ispravka: ponovno objavi pravila REV-04 skriptom iz koraka 4 (`deploy-rules.sh`) tek uz zasebno odobrenje.

Sve izmjene u produkciji tijekom incidenta radi isključivo vlasnik; Claude Code/glavni razvoj ne dobivaju pristup računu.
