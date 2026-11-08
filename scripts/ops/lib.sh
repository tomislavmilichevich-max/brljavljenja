# Zajednička biblioteka operativnih skripti (uključuje se s `source`; sama NIŠTA ne objavljuje ni ne mijenja).
# Svaka skripta radi u VLASTITOM bash procesu (npm run → bash scripts/ops/…), pa greška ne zatvara Cloud Shell.
# FAIL-CLOSED: svaki obavezni uvjet je die() = izlaz 1 PRIJE bilo koje naredbe koja mijenja produkciju.
set -euo pipefail

P=home-inventory-pwa-218be            # JEDINI dopušteni Firebase projekt
EXPECTED_RULES_SHA12=157feee0f7ca     # sha256 (prvih 12) odobrenih pravila REV-04
OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO="$(cd "$OPS_DIR/../.." && pwd -P)"
BK="$HOME/backup"                      # sigurnosne kopije ISKLJUČIVO izvan repozitorija

die() { echo "ZAUSTAVLJENO: $*" >&2; exit 1; }
need_confirm() { [ "${CONFIRM:-}" = "$1" ] || die "nema izričite potvrde (pokreni s CONFIRM=$1 TEK nakon vlasnikova odobrenja)"; }

# Sigurnosne kopije nikad ne smiju biti unutar repozitorija (ni slučajno završiti na GitHubu)
guard_backup_outside_repo() {
  mkdir -p "$BK" || die "ne mogu stvoriti $BK"
  chmod 700 "$BK" 2>/dev/null || true
  local bk_real
  bk_real="$(cd "$BK" && pwd -P)"
  case "$bk_real/" in "$REPO"/*) die "direktorij za sigurnosne kopije ($bk_real) je unutar repozitorija" ;; esac
}

# ---------- REST (samo GET; token se NIKAD ne ispisuje i ne ide u argumente naredbe) ----------
rest_get() {
  local token body
  token=$(gcloud auth print-access-token 2>/dev/null) || { echo "ZAUSTAVLJENO: gcloud nema pristupni token" >&2; return 1; }
  [ -n "$token" ] || { echo "ZAUSTAVLJENO: prazan pristupni token" >&2; return 1; }
  body=$(curl -sS -f -K - "$1" <<<"header = \"Authorization: Bearer $token\"
header = \"x-goog-user-project: $P\"") || { echo "ZAUSTAVLJENO: REST zahtjev nije uspio ($1)" >&2; return 1; }
  jq -e 'type == "object" and (has("error") | not)' >/dev/null <<<"$body" || { echo "ZAUSTAVLJENO: REST odgovor nije valjan JSON objekt ili sadrži error ($1)" >&2; return 1; }
  printf '%s' "$body"
}
# Ime aktivnog rulesetta; mora pripadati TOČNO projektu $P (pogrešan projekt/null/prazno = greška)
active_ruleset() {
  local rel rs
  rel=$(rest_get "https://firebaserules.googleapis.com/v1/projects/$P/releases/cloud.firestore") || return 1
  rs=$(jq -r '.rulesetName // empty' <<<"$rel")
  [[ "$rs" =~ ^projects/$P/rulesets/[A-Za-z0-9._-]+$ ]] || { echo "ZAUSTAVLJENO: rulesetName je prazan/null ili ne pripada projektu $P" >&2; return 1; }
  printf '%s' "$rs"
}
# Sadržaj rulesetta u zadani file (jq -j: bez dodanog znaka novog retka); prazno/null = greška
ruleset_to_file() {
  local body
  body=$(rest_get "https://firebaserules.googleapis.com/v1/$1") || return 1
  jq -j '.source.files[0].content // empty' <<<"$body" > "$2"
  [ -s "$2" ] || { echo "ZAUSTAVLJENO: sadržaj rulesetta je prazan ili null" >&2; return 1; }
}
# Trenutno aktivno Hosting izdanje; mora pripadati sitea $P
hosting_live() {
  local hc
  hc=$(rest_get "https://firebasehosting.googleapis.com/v1beta1/sites/$P/channels/live") || return 1
  jq -e --arg p "$P" '.release.version.name | type == "string" and test("(^|/)sites/" + $p + "/versions/[^/]+$")' >/dev/null <<<"$hc" || { echo "ZAUSTAVLJENO: Hosting 'live' nema aktivno izdanje za $P" >&2; return 1; }
  printf '%s' "$hc"
}

# ---------- OBAVEZNI UVJETI repozitorija: svaki neuspjeh = izlaz 1 (deploy se ne pokreće) ----------
preflight_repo() {
  [ -d "$REPO/.git" ] || die "$REPO nije Git repozitorij"
  cd "$REPO" || die "cd $REPO nije uspio"
  [ "$(git rev-parse --show-toplevel)" = "$(pwd -P)" ] || die "trenutni direktorij nije korijen repozitorija"
  guard_backup_outside_repo
  local want have
  want=$(cat "$BK/deploy-commit.txt" 2>/dev/null) || die "nema $BK/deploy-commit.txt (pokreni: npm run prep)"
  [[ "$want" =~ ^[0-9a-f]{40}$ ]] || die "deploy-commit.txt ne sadrži valjan 40-znamenkasti hash"
  have=$(git rev-parse HEAD)
  [ "$have" = "$want" ] || die "HEAD ($have) se razlikuje od zabilježenog commita ($want); pokreni npm run prep"
  [ -z "$(git status --porcelain --untracked-files=all)" ] || die "git status nije čist (nepraćene ili izmijenjene datoteke)"
  [ -f firestore.rules ] || die "nema firestore.rules"
  [ "$(sha256sum firestore.rules | cut -c1-12)" = "$EXPECTED_RULES_SHA12" ] || die "hash firestore.rules nije $EXPECTED_RULES_SHA12"
  npm run guard:rules >/dev/null || die "guard:rules je javio problem"
}
# Projekt u produkcijskoj konfiguraciji mora biti TOČNO $P (vrijednost se ispisuje samo ako je pogrešna; ključevi nikad)
preflight_project_config() {
  local f="$REPO/.env.production.local" proj
  [ -s "$f" ] || die "nema $f (konfiguracija)"
  proj=$(grep -E '^VITE_FIREBASE_PROJECT_ID=' "$f" | tail -1 | cut -d= -f2- | tr -d "\"' \r") || true
  [ "$proj" = "$P" ] || die "VITE_FIREBASE_PROJECT_ID u .env.production.local nije $P"
  npm run guard:env >/dev/null || die "guard:env: konfiguracija nije valjana za $P"
}

# ---------- OBAVEZNI UVJETI sigurnosne kopije (korak backup): bez valjane kopije nema objave ni povrata ----------
validate_backup() {
  local f="$BK/rules-before-deploy.rules"
  [ -s "$f" ] || die "nema valjane sigurnosne kopije pravila ($f); pokreni: npm run backup"
  [ "$(wc -c < "$f")" -ge 100 ] || die "sigurnosna kopija je sumnjivo kratka"
  { grep -q "rules_version" "$f" && grep -q "service cloud.firestore" "$f"; } || die "sigurnosna kopija ne izgleda kao Firestore pravila"
  [ -s "$BK/rules-before-deploy.sha256" ] || die "nema $BK/rules-before-deploy.sha256"
  (cd "$BK" && sha256sum -c rules-before-deploy.sha256 >/dev/null 2>&1) || die "sha256sum -c: kopija se razlikuje od zabilježenog hasha"
  [ -s "$BK/ruleset-name-before.txt" ] || die "nema ruleset-name-before.txt"
}
validate_hosting_record() {
  [ -s "$BK/hosting-live-before.json" ] || [ -s "$BK/hosting-live-before.txt" ] || die "nije zabilježeno trenutno Hosting izdanje (hosting-live-before.json/.txt)"
}

# Aktivna pravila na poslužitelju moraju biti JEDNAKA zadanoj datoteci; SVJEŽI privremeni file, svaki neuspjeh = izlaz 1
verify_live_rules() {
  local expected="$1" rs tmp
  [ -s "$expected" ] || die "očekivana pravila ($expected) ne postoje ili su prazna"
  rs=$(active_ruleset) || die "ne mogu utvrditi aktivna pravila"
  tmp=$(mktemp) || die "mktemp"
  if ! ruleset_to_file "$rs" "$tmp"; then rm -f "$tmp"; die "ne mogu dohvatiti sadržaj aktivnih pravila"; fi
  if ! diff <(sed -e '$a\' "$expected") <(sed -e '$a\' "$tmp") >/dev/null; then rm -f "$tmp"; die "aktivna pravila na poslužitelju se RAZLIKUJU od $expected"; fi
  rm -f "$tmp"
  echo "OK: aktivna pravila ($rs) odgovaraju $expected"
}
