#!/bin/bash
# npm run test:ops — negativni/pozitivni testovi STVARNIH skripti iz scripts/ops s LAŽNIM podacima.
# Git je stvaran (privremeni "origin" + klon u privremenom HOME-u); npm/npx/gcloud/curl su STUBOVI koji samo bilježe pozive.
# Ništa ne dira stvarni Firebase, stvarni ~/backup ni stvarni repozitorij. Ni u jednom slučaju se ne poziva stvarni deploy.
set -u
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
ROOT=$(mktemp -d)
STUB="${ROOT:?}/stub"; mkdir -p "$STUB"
PASS=0; FAILN=0
PROJ=home-inventory-pwa-218be

cat > "$STUB/npm" <<'E'
#!/bin/bash
echo "npm $*" >> "$CALLLOG"
case "$*" in
 "run guard:rules") [ "${STUB_GUARD_FAIL:-0}" = 1 ] && { echo guard-fail >&2; exit 1; } ;;
 "run guard:env") [ "${STUB_ENV_FAIL:-0}" = 1 ] && exit 1 ;;
 "run check:no-actions") [ "${STUB_ACTIONS_FAIL:-0}" = 1 ] && exit 1 ;;
 "run deploy:"*) echo "DEPLOY-CALLED $*" >> "$CALLLOG";;
esac
exit 0
E
cat > "$STUB/npx" <<'E'
#!/bin/bash
echo "npx $*" >> "$CALLLOG"
case "$*" in *"firebase deploy"*) echo "DEPLOY-CALLED $*" >> "$CALLLOG";; esac
exit 0
E
cat > "$STUB/gcloud" <<'E'
#!/bin/bash
echo "gcloud $*" >> "$CALLLOG"
[ "${STUB_NOTOKEN:-0}" = 1 ] && exit 1
echo SECRETTOKEN123
E
cat > "$STUB/curl" <<'E'
#!/bin/bash
url="${@: -1}"
echo "curl $*" >> "$CALLLOG"
case " $* " in *" -K - "*) cat >> "$STDINLOG";; esac
[ "${STUB_CURL_FAIL:-0}" = 1 ] && exit 22
P=home-inventory-pwa-218be
case "$url" in
 *releases/cloud.firestore) case "${STUB_REL:-ok}" in err) echo '{"error":{"code":403}}';; null) echo '{"name":"x"}';; otherproj) echo '{"rulesetName":"projects/other-project/rulesets/abc"}';; html) echo '<html>x</html>';; *) echo "{\"rulesetName\":\"projects/$P/rulesets/abc\"}";; esac;;
 *rulesets/abc) case "${STUB_RS:-same}" in empty) echo '{"source":{"files":[{"content":""}]}}';; none) echo '{"source":{}}';; err) echo '{"error":{"code":500}}';; diff) python3 -c "import json;print(json.dumps({'source':{'files':[{'content':'rules_version = 2;\n// OLD\n'+'x'*200}]}}))";; p1) python3 -c "import json;print(json.dumps({'source':{'files':[{'content':\"rules_version = '2';\nservice cloud.firestore {\n match /databases/{database}/documents {\n match /households/{h} { allow read: if true; }\n }\n}\n// pad pad pad pad pad pad\n\"}]}}))";; same) python3 -c "import json,os;print(json.dumps({'source':{'files':[{'content':open(os.environ['LIVE_SRC']).read()}]}}))";; esac;;
 *channels/live) case "${STUB_HOST:-ok}" in err) echo '{"error":{}}';; other) echo '{"release":{"version":{"name":"sites/other-site/versions/v1"},"releaseTime":"2026-01-01"}}';; none) echo '{"name":"live"}';; *) echo "{\"release\":{\"version\":{\"name\":\"sites/$P/versions/v1\"},\"releaseTime\":\"2026-01-01\"}}";; esac;;
 *firebaseapp.com/sw.js) if [ "${STUB_SW_KEY:-0}" = 1 ]; then echo "AIzaSyFAKE"; else echo "// sw"; fi;;
 *firebaseapp.com/) echo "HTTP/2 200";;
esac
E
chmod +x "$STUB"/*

newenv() {
  rm -rf "${ROOT:?}/home"
  export HOME="${ROOT:?}/home"; mkdir -p "$HOME"
  git init -q --bare -b main "$HOME/origin.git"
  git clone -q "$HOME/origin.git" "$HOME/home-inventory-pwa" 2>/dev/null
  cd "$HOME/home-inventory-pwa" || exit 9
  git config user.email t@t; git config user.name t; git checkout -q -b main 2>/dev/null || true
  cp "$SRC/firestore.rules" firestore.rules
  mkdir -p scripts; cp -r "$SRC/scripts/ops" scripts/ops
  printf '.env*\nnode_modules/\n' > .gitignore
  printf 'VITE_FIREBASE_API_KEY=AIzaSECRETKEY\nVITE_FIREBASE_PROJECT_ID=%s\n' "$PROJ" > .env.production.local
  mkdir -p node_modules/.bin; printf '#!/bin/bash\n' > node_modules/.bin/firebase; chmod +x node_modules/.bin/firebase
  git add -A; git commit -qm init; git push -q -u origin main 2>/dev/null
  mkdir -p "$HOME/backup"
  git rev-parse HEAD > "$HOME/backup/deploy-commit.txt"
  cp "$SRC/firestore.rules" "$HOME/backup/rules-before-deploy.rules"
  (cd "$HOME/backup" && sha256sum rules-before-deploy.rules > rules-before-deploy.sha256)
  echo "projects/$PROJ/rulesets/old" > "$HOME/backup/ruleset-name-before.txt"
  echo '{"release":{}}' > "$HOME/backup/hosting-live-before.json"
  export CALLLOG="$ROOT/calls.log" STDINLOG="$ROOT/stdin.log"; : > "$CALLLOG"; : > "$STDINLOG"
  export LIVE_SRC="$SRC/firestore.rules" PATH="$STUB:$PATH"
  unset STUB_GUARD_FAIL STUB_ENV_FAIL STUB_ACTIONS_FAIL STUB_NOTOKEN STUB_CURL_FAIL STUB_REL STUB_RS STUB_HOST STUB_SW_KEY CONFIRM
}
emptybackup() { rm -f "$HOME/backup/rules-before-deploy.rules" "$HOME/backup/rules-before-deploy.sha256" "$HOME/backup/ruleset-name-before.txt" "$HOME/backup/hosting-live-before.json"; }
snap() { (cd "$HOME/backup" && find . -type f -exec sha256sum {} + | sort | sha256sum | cut -c1-16); }
ok_()  { echo "PASS  $1  ($2)"; PASS=$((PASS+1)); }
bad_() { echo "FAIL  $1  ($2)"; FAILN=$((FAILN+1)); [ -n "${3:-}" ] && echo "$3" | tail -4; }

# t <naziv> block|ok|blockafter <naredba…>
t() {
  local name="$1" want="$2"; shift 2
  local out rc n
  out=$("$@" 2>&1); rc=$?
  n=$(grep -c DEPLOY-CALLED "$CALLLOG")
  if grep -q "SECRETTOKEN123\|AIzaSECRETKEY" <<<"$out"; then bad_ "$name" "token/ključ u ISPISU" ; return; fi
  if grep -q "SECRETTOKEN123\|AIzaSECRETKEY" "$CALLLOG"; then bad_ "$name" "token/ključ u ARGUMENTIMA naredbi"; return; fi
  case "$want" in
   block) [ $rc -ne 0 ] && [ "$n" = 0 ] && ok_ "$name" "izlaz $rc, deploy NIJE pozvan :: $(grep -m1 ZAUSTAVLJENO <<<"$out" | cut -c1-100)" || bad_ "$name" "izlaz $rc, deploy pozivi=$n" "$out";;
   ok) [ $rc -eq 0 ] && [ "$n" = 1 ] && ok_ "$name" "izlaz 0, deploy pozvan točno jednom, tek nakon provjera" || bad_ "$name" "izlaz $rc, deploy pozivi=$n" "$out";;
   blockafter) [ $rc -ne 0 ] && [ "$n" = 1 ] && ok_ "$name" "izlaz $rc: provjera nakon deploya pala :: $(grep -m1 ZAUSTAVLJENO <<<"$out" | cut -c1-90)" || bad_ "$name" "izlaz $rc, deploy pozivi=$n" "$out";;
  esac
}
# readonly <naziv> <očekivani izlaz> <naredba…> : prep/backup NIKAD ne smiju pozvati deploy
ro() {
  local name="$1" wantrc="$2"; shift 2
  local out rc n
  out=$("$@" 2>&1); rc=$?
  n=$(grep -c DEPLOY-CALLED "$CALLLOG"); local nd; nd=$(grep -c "firebase deploy\|deploy:" "$CALLLOG")
  if [ "$n" != 0 ] || [ "$nd" != 0 ]; then bad_ "$name" "POZVAN DEPLOY"; return; fi
  if grep -q "SECRETTOKEN123\|AIzaSECRETKEY" <<<"$out" "$CALLLOG"; then bad_ "$name" "token/ključ procurio"; return; fi
  if [ "$wantrc" = fail ]; then [ $rc -ne 0 ] && ok_ "$name" "izlaz $rc, deploy nije pozvan :: $(grep -m1 'ZAUSTAVLJENO\|UPOZORENJE' <<<"$out" | cut -c1-100)" || bad_ "$name" "izlaz 0 a očekivan neuspjeh" "$out"
  else [ $rc -eq "$wantrc" ] && ok_ "$name" "izlaz $rc, deploy nije pozvan" || bad_ "$name" "izlaz $rc, očekivano $wantrc" "$out"; fi
}
S() { echo "$HOME/home-inventory-pwa/scripts/ops/$1"; }
chg() { (cd "$HOME/home-inventory-pwa" && "$@"); }

echo "### 0. Statika: struktura, imena, jamstva"
for f in lib prepare backup-rules deploy-rules deploy-hosting rollback-rules test-ops; do [ -f "$SRC/scripts/ops/$f.sh" ] && bash -n "$SRC/scripts/ops/$f.sh" && ok_ "S-syntax $f.sh" "bash -n" || bad_ "S-syntax $f.sh" "nedostaje/sintaksa"; done
for f in lib prepare backup-rules deploy-rules deploy-hosting rollback-rules; do grep -q '^set -euo pipefail' "$SRC/scripts/ops/$f.sh" && ok_ "S-strict $f.sh" "set -euo pipefail" || bad_ "S-strict $f.sh" "nema strogog načina"; done
for f in lib prepare backup-rules; do ! grep -Eq 'firebase deploy|deploy:|firestore:rules|--only' "$SRC/scripts/ops/$f.sh" && ok_ "S-nodeploy $f.sh" "nema nijedne naredbe/oznake za objavu" || bad_ "S-nodeploy $f.sh" "sadrži deploy"; done
j() { python3 -c "import json;print(json.load(open('$SRC/package.json'))['scripts'].get('$1',''))"; }
[ "$(j prep)" = "bash scripts/ops/prepare.sh" ] && ok_ "S-npm prep" "$(j prep)" || bad_ "S-npm prep" "$(j prep)"
[ "$(j backup)" = "bash scripts/ops/backup-rules.sh" ] && ok_ "S-npm backup" "$(j backup)" || bad_ "S-npm backup" "$(j backup)"
[ "$(j ops:deploy-rules)" = "bash scripts/ops/deploy-rules.sh" ] && ok_ "S-npm ops:deploy-rules" "ok" || bad_ "S-npm ops:deploy-rules" "$(j ops:deploy-rules)"
[ "$(j ops:deploy-hosting)" = "bash scripts/ops/deploy-hosting.sh" ] && ok_ "S-npm ops:deploy-hosting" "ok" || bad_ "S-npm ops:deploy-hosting" "$(j ops:deploy-hosting)"
[ "$(j ops:rollback-rules)" = "bash scripts/ops/rollback-rules.sh backup" ] && ok_ "S-npm ops:rollback-rules" "ok" || bad_ "S-npm ops:rollback-rules" "$(j ops:rollback-rules)"
[ "$(j ops:lockdown-rules)" = "bash scripts/ops/rollback-rules.sh lockdown" ] && ok_ "S-npm ops:lockdown-rules" "ok" || bad_ "S-npm ops:lockdown-rules" "$(j ops:lockdown-rules)"
case "$(j prep)$(j backup)" in *deploy*) bad_ "S-npm bez deploya" "prep/backup spominju deploy";; *) ok_ "S-npm prep/backup bez deploya" "ok";; esac
git -C "$SRC" check-ignore -q backup/x 2>/dev/null && ok_ "S-gitignore backup/" "ignorirano" || bad_ "S-gitignore backup/" "backup/ nije u .gitignore"

echo "### 1. npm run prep (prepare.sh): lokalno, bez produkcije"
newenv; ro "P0 pozitivno: main = origin/main, čisto, hash i config OK" 0 bash "$(S prepare.sh)"
grep -q "$(git -C "$HOME/home-inventory-pwa" rev-parse HEAD)" "$HOME/backup/deploy-commit.txt" && ok_ "P0b commit zapisan u ~/backup/deploy-commit.txt" "ok" || bad_ "P0b" "commit nije zapisan"
! grep -q "curl\|gcloud\|firebase" "$CALLLOG" && ok_ "P0c prep ne zove REST/gcloud/firebase" "samo npm provjere" || bad_ "P0c" "prep je zvao mrežu/produkciju"
newenv; chg git checkout -q -b feature; ro "P1 nije na grani main" fail bash "$(S prepare.sh)"
newenv; chg bash -c 'echo x > a && git add a && git commit -qm second'; ro "P2 HEAD ≠ origin/main (lokalni commit)" fail bash "$(S prepare.sh)"
newenv; echo y > "$HOME/home-inventory-pwa/untracked.txt"; ro "P3 nečist git (nepraćena datoteka)" fail bash "$(S prepare.sh)"
newenv; echo "# x" >> "$HOME/home-inventory-pwa/firestore.rules"; ro "P3b nečist git (izmijenjena)" fail bash "$(S prepare.sh)"
newenv; chg bash -c 'echo "// izmjena" >> firestore.rules && git commit -qam c && git push -q origin main'; ro "P4 pogrešan hash pravila (čisto, = origin)" fail bash "$(S prepare.sh)"
newenv; ro "P5 guard:rules pada" fail env STUB_GUARD_FAIL=1 bash "$(S prepare.sh)"
newenv; ro "P6 guard:env pada" fail env STUB_ENV_FAIL=1 bash "$(S prepare.sh)"
newenv; ro "P6b check:no-actions pada" fail env STUB_ACTIONS_FAIL=1 bash "$(S prepare.sh)"
newenv; sed -i 's/^VITE_FIREBASE_PROJECT_ID=.*/VITE_FIREBASE_PROJECT_ID=drugi-projekt/' "$HOME/home-inventory-pwa/.env.production.local"; ro "P7 pogrešan Firebase projekt u konfiguraciji" fail bash "$(S prepare.sh)"
newenv; rm "$HOME/home-inventory-pwa/.env.production.local"; ro "P7b nema .env.production.local" fail bash "$(S prepare.sh)"
newenv; rm -rf "$HOME/origin.git"; ro "P8 git fetch ne uspijeva" fail bash "$(S prepare.sh)"
newenv; rm "$HOME/home-inventory-pwa/node_modules/.bin/firebase"; ro "P9 nema firebase-tools" fail bash "$(S prepare.sh)"
newenv; ro "P10 ~/backup bi bio unutar repozitorija" fail env HOME="$HOME/home-inventory-pwa" bash "$(S prepare.sh)"

echo "### 2. npm run backup (backup-rules.sh): samo čitanje, ne prepisuje, zaustavlja se na pogrešnom projektu/REST odgovoru"
bk() { local name="$1" mode="$2"; shift 2; newenv; emptybackup; local out rc; out=$("$@" 2>&1); rc=$?
  local nd; nd=$(grep -c "DEPLOY-CALLED\|firebase deploy\|deploy:" "$CALLLOG")
  if [ "$nd" != 0 ]; then bad_ "$name" "POZVAN DEPLOY"; return; fi
  if grep -q "SECRETTOKEN123\|AIzaSECRETKEY" <<<"$out" "$CALLLOG"; then bad_ "$name" "token procurio u ispis/argumente"; return; fi
  case "$mode" in
   fail) [ $rc -ne 0 ] && [ ! -e "$HOME/backup/rules-before-deploy.rules" ] && [ ! -e "$HOME/backup/ruleset-name-before.txt" ] && ok_ "$name" "izlaz $rc, NIJEDNA kopija nije stvorena :: $(grep -m1 ZAUSTAVLJENO <<<"$out" | cut -c1-80)" || bad_ "$name" "rc=$rc" "$out";;
   hostfail) [ $rc -eq 2 ] && [ -s "$HOME/backup/rules-before-deploy.rules" ] && [ ! -e "$HOME/backup/hosting-live-before.json" ] && ok_ "$name" "izlaz 2: kopija pravila OK, Hosting ručno" || bad_ "$name" "rc=$rc" "$out";;
   ok) [ $rc -eq 0 ] && [ -s "$HOME/backup/rules-before-deploy.rules" ] && [ -s "$HOME/backup/rules-before-deploy.sha256" ] && [ -s "$HOME/backup/hosting-live-before.json" ] && ok_ "$name" "izlaz 0, sve datoteke u ~/backup" || bad_ "$name" "rc=$rc" "$out";;
  esac; }
BR() { bash "$(S backup-rules.sh)"; }
bk "K0 pozitivno (stara P1 pravila u produkciji)" ok env STUB_RS=p1 bash "$(S backup-rules.sh)"
newenv; emptybackup; bash "$(S backup-rules.sh)" >/dev/null 2>&1 || true
grep -q SECRETTOKEN123 "$STDINLOG" && ! grep -q SECRETTOKEN123 "$CALLLOG" && ok_ "K0a token ide kroz stdin (curl -K -), NIKAD u argumente naredbe ni ispis" "ok" || bad_ "K0a" "token nije prošao stdinom ili je u argumentima"
git -C "$HOME/home-inventory-pwa" status --porcelain --untracked-files=all | grep -q . && bad_ "K0b kopija NIJE u repozitoriju" "git status nije čist" || ok_ "K0b kopija NIJE u repozitoriju" "git status čist, ~/backup izvan klona"
bk "K1 REST HTTP greška" fail env STUB_CURL_FAIL=1 bash "$(S backup-rules.sh)"
bk "K2 release vraća error objekt" fail env STUB_REL=err bash "$(S backup-rules.sh)"
bk "K3 null ruleset" fail env STUB_REL=null bash "$(S backup-rules.sh)"
bk "K3b odgovor nije JSON objekt" fail env STUB_REL=html bash "$(S backup-rules.sh)"
bk "K4 POGREŠAN PROJEKT u imenu rulesetta" fail env STUB_REL=otherproj bash "$(S backup-rules.sh)"
bk "K5 prazan sadržaj pravila" fail env STUB_RS=empty bash "$(S backup-rules.sh)"
bk "K6 ruleset bez sadržaja" fail env STUB_RS=none bash "$(S backup-rules.sh)"
bk "K7 ruleset vraća error objekt" fail env STUB_RS=err bash "$(S backup-rules.sh)"
bk "K8 sadržaj nije Firestore pravila" fail env STUB_RS=diff bash "$(S backup-rules.sh)"
bk "K9 nema gcloud tokena" fail env STUB_NOTOKEN=1 bash "$(S backup-rules.sh)"
bk "K10 Hosting REST greška (kopija pravila ostaje)" hostfail env STUB_HOST=err bash "$(S backup-rules.sh)"
bk "K11 Hosting izdanje drugog sitea (pogrešan projekt)" hostfail env STUB_HOST=other bash "$(S backup-rules.sh)"
bk "K12 Hosting live bez izdanja" hostfail env STUB_HOST=none bash "$(S backup-rules.sh)"
# postojeća kopija ostaje NETAKNUTA
newenv; before=$(snap); out=$(bash "$(S backup-rules.sh)" 2>&1); rc=$?; after=$(snap)
[ $rc -ne 0 ] && [ "$before" = "$after" ] && ok_ "K13 postojeća kopija: odbijeno, ~/backup netaknut" "izlaz $rc, snapshot isti" || bad_ "K13" "rc=$rc before=$before after=$after" "$out"
for f in rules-before-deploy.sha256 ruleset-name-before.txt hosting-live-before.json; do
  newenv; rm -f "$HOME/backup/rules-before-deploy.rules"; [ "$f" = hosting-live-before.json ] && rm -f "$HOME/backup/rules-before-deploy.sha256" "$HOME/backup/ruleset-name-before.txt"
  b=$(snap); out=$(bash "$(S backup-rules.sh)" 2>&1); rc=$?; a=$(snap)
  if [ "$f" = hosting-live-before.json ]; then [ $rc -eq 2 ] && ok_ "K14 postojeći $f: ne prepisuje (izlaz 2)" "hosting zapis ostaje" || bad_ "K14 $f" "rc=$rc" "$out"
  else [ $rc -ne 0 ] && [ "$b" = "$a" ] && ok_ "K14 postojeći $f: odbijeno, ~/backup netaknut" "izlaz $rc" || bad_ "K14 $f" "rc=$rc" "$out"; fi
done
newenv; emptybackup; out=$(bash "$(S backup-rules.sh)" 2>&1); first=$(snap); out2=$(bash "$(S backup-rules.sh)" 2>&1); rc2=$?; second=$(snap)
[ $rc2 -ne 0 ] && [ "$first" = "$second" ] && ok_ "K15 drugo pokretanje odmah nakon uspješnog: odbijeno, kopija netaknuta" "izlaz $rc2" || bad_ "K15" "rc=$rc2" "$out2"
newenv; emptybackup; ro "K16 ~/backup unutar repozitorija" fail env HOME="$HOME/home-inventory-pwa" bash "$(S backup-rules.sh)"

echo "### 3. ops:deploy-rules (korak 4): obavezni uvjeti"
DR() { bash "$(S deploy-rules.sh)"; }
newenv; t "R0 pozitivno" ok env CONFIRM=DA-OBJAVI-PRAVILA bash "$(S deploy-rules.sh)"
newenv; t "R1 bez CONFIRM" block bash "$(S deploy-rules.sh)"
newenv; t "R2 pogrešan CONFIRM" block env CONFIRM=DA bash "$(S deploy-rules.sh)"
newenv; mkdir -p "$HOME/loose" && cp -r "$HOME/home-inventory-pwa/scripts" "$HOME/loose/scripts"; t "R3 skripta nije u Git repozitoriju (pogrešan direktorij)" block env CONFIRM=DA-OBJAVI-PRAVILA bash "$HOME/loose/scripts/ops/deploy-rules.sh"
newenv; chg bash -c 'echo x > a.txt && git add a.txt && git commit -qm second'; t "R4 HEAD ≠ zabilježeni commit" block env CONFIRM=DA-OBJAVI-PRAVILA bash "$(S deploy-rules.sh)"
newenv; echo notahash > "$HOME/backup/deploy-commit.txt"; t "R4b deploy-commit.txt nije hash" block env CONFIRM=DA-OBJAVI-PRAVILA bash "$(S deploy-rules.sh)"
newenv; rm "$HOME/backup/deploy-commit.txt"; t "R4c nema deploy-commit.txt" block env CONFIRM=DA-OBJAVI-PRAVILA bash "$(S deploy-rules.sh)"
newenv; echo "# x" >> "$HOME/home-inventory-pwa/firestore.rules"; t "R5 nečist git (izmijenjena)" block env CONFIRM=DA-OBJAVI-PRAVILA bash "$(S deploy-rules.sh)"
newenv; echo y > "$HOME/home-inventory-pwa/untracked.txt"; t "R5b nečist git (nepraćena)" block env CONFIRM=DA-OBJAVI-PRAVILA bash "$(S deploy-rules.sh)"
newenv; chg bash -c 'echo "// izmjena" >> firestore.rules && git commit -qam change'; chg git rev-parse HEAD > "$HOME/backup/deploy-commit.txt"; t "R6 pogrešan hash pravila (git čist, HEAD podudaran)" block env CONFIRM=DA-OBJAVI-PRAVILA bash "$(S deploy-rules.sh)"
newenv; t "R7 guard:rules pada" block env CONFIRM=DA-OBJAVI-PRAVILA STUB_GUARD_FAIL=1 bash "$(S deploy-rules.sh)"
newenv; sed -i 's/^VITE_FIREBASE_PROJECT_ID=.*/VITE_FIREBASE_PROJECT_ID=drugi-projekt/' "$HOME/home-inventory-pwa/.env.production.local"; t "R7b POGREŠAN projekt u konfiguraciji" block env CONFIRM=DA-OBJAVI-PRAVILA bash "$(S deploy-rules.sh)"
newenv; rm "$HOME/backup/rules-before-deploy.rules"; t "R8 nedostaje sigurnosna kopija" block env CONFIRM=DA-OBJAVI-PRAVILA bash "$(S deploy-rules.sh)"
newenv; echo "kratko" > "$HOME/backup/rules-before-deploy.rules"; t "R9 neispravna kopija (kratka)" block env CONFIRM=DA-OBJAVI-PRAVILA bash "$(S deploy-rules.sh)"
newenv; (head -c 300 /dev/zero | tr '\0' 'x'; echo) > "$HOME/backup/rules-before-deploy.rules"; (cd "$HOME/backup" && sha256sum rules-before-deploy.rules > rules-before-deploy.sha256); t "R9b kopija bez sadržaja pravila (hash valjan)" block env CONFIRM=DA-OBJAVI-PRAVILA bash "$(S deploy-rules.sh)"
newenv; echo "# izmjena" >> "$HOME/backup/rules-before-deploy.rules"; t "R9c kopija izmijenjena nakon hasha" block env CONFIRM=DA-OBJAVI-PRAVILA bash "$(S deploy-rules.sh)"
newenv; rm "$HOME/backup/hosting-live-before.json"; t "R10 nije zabilježeno Hosting izdanje" block env CONFIRM=DA-OBJAVI-PRAVILA bash "$(S deploy-rules.sh)"
echo "### 3b. završna REST provjera NAKON deploya (u /tmp postoje STARE valjane datoteke; ne smiju se čitati)"
for f in /tmp/rules-after.rules /tmp/rules-now.rules /tmp/rules-live.rules; do cp "$SRC/firestore.rules" "$f"; done
newenv; t "V1 REST HTTP greška" blockafter env CONFIRM=DA-OBJAVI-PRAVILA STUB_CURL_FAIL=1 bash "$(S deploy-rules.sh)"
newenv; t "V2 release error objekt" blockafter env CONFIRM=DA-OBJAVI-PRAVILA STUB_REL=err bash "$(S deploy-rules.sh)"
newenv; t "V3 nedostaje ruleset (null)" blockafter env CONFIRM=DA-OBJAVI-PRAVILA STUB_REL=null bash "$(S deploy-rules.sh)"
newenv; t "V3b ruleset iz POGREŠNOG projekta" blockafter env CONFIRM=DA-OBJAVI-PRAVILA STUB_REL=otherproj bash "$(S deploy-rules.sh)"
newenv; t "V4 prazan sadržaj aktivnih pravila" blockafter env CONFIRM=DA-OBJAVI-PRAVILA STUB_RS=empty bash "$(S deploy-rules.sh)"
newenv; t "V5 ruleset bez sadržaja" blockafter env CONFIRM=DA-OBJAVI-PRAVILA STUB_RS=none bash "$(S deploy-rules.sh)"
newenv; t "V6 ruleset error objekt" blockafter env CONFIRM=DA-OBJAVI-PRAVILA STUB_RS=err bash "$(S deploy-rules.sh)"
newenv; t "V7 aktivna pravila ≠ firestore.rules" blockafter env CONFIRM=DA-OBJAVI-PRAVILA STUB_RS=diff bash "$(S deploy-rules.sh)"
newenv; t "V8 nema gcloud tokena" blockafter env CONFIRM=DA-OBJAVI-PRAVILA STUB_NOTOKEN=1 bash "$(S deploy-rules.sh)"
rm -f /tmp/rules-after.rules /tmp/rules-now.rules /tmp/rules-live.rules

echo "### 4. ops:deploy-hosting (korak 6)"
newenv; t "H0 pozitivno" ok env CONFIRM=DA-OBJAVI-HOSTING bash "$(S deploy-hosting.sh)"
newenv; t "H1 bez CONFIRM" block bash "$(S deploy-hosting.sh)"
newenv; mkdir -p "$HOME/loose" && cp -r "$HOME/home-inventory-pwa/scripts" "$HOME/loose/scripts"; t "H2 pogrešan direktorij (nije Git)" block env CONFIRM=DA-OBJAVI-HOSTING bash "$HOME/loose/scripts/ops/deploy-hosting.sh"
newenv; chg bash -c 'echo x > a && git add a && git commit -qm s'; t "H3 HEAD ≠ zabilježeni commit" block env CONFIRM=DA-OBJAVI-HOSTING bash "$(S deploy-hosting.sh)"
newenv; echo y > "$HOME/home-inventory-pwa/untracked.txt"; t "H4 nečist git" block env CONFIRM=DA-OBJAVI-HOSTING bash "$(S deploy-hosting.sh)"
newenv; rm "$HOME/home-inventory-pwa/.env.production.local"; t "H5 nema .env.production.local" block env CONFIRM=DA-OBJAVI-HOSTING bash "$(S deploy-hosting.sh)"
newenv; t "H6 guard:env pada" block env CONFIRM=DA-OBJAVI-HOSTING STUB_ENV_FAIL=1 bash "$(S deploy-hosting.sh)"
newenv; sed -i 's/^VITE_FIREBASE_PROJECT_ID=.*/VITE_FIREBASE_PROJECT_ID=drugi-projekt/' "$HOME/home-inventory-pwa/.env.production.local"; t "H6b POGREŠAN projekt u konfiguraciji" block env CONFIRM=DA-OBJAVI-HOSTING bash "$(S deploy-hosting.sh)"
newenv; chg bash -c 'echo "// c" >> firestore.rules && git commit -qam c'; chg git rev-parse HEAD > "$HOME/backup/deploy-commit.txt"; t "H7 pogrešan hash pravila" block env CONFIRM=DA-OBJAVI-HOSTING bash "$(S deploy-hosting.sh)"
newenv; t "H8 REST pravila nedostupna" block env CONFIRM=DA-OBJAVI-HOSTING STUB_CURL_FAIL=1 bash "$(S deploy-hosting.sh)"
newenv; t "H9 aktivna pravila ≠ firestore.rules (REV-04 nije objavljen; još stara P1)" block env CONFIRM=DA-OBJAVI-HOSTING STUB_RS=p1 bash "$(S deploy-hosting.sh)"
newenv; t "H10 nema aktivnog rulesetta" block env CONFIRM=DA-OBJAVI-HOSTING STUB_REL=null bash "$(S deploy-hosting.sh)"
newenv; t "H10b ruleset iz pogrešnog projekta" block env CONFIRM=DA-OBJAVI-HOSTING STUB_REL=otherproj bash "$(S deploy-hosting.sh)"
newenv; rm "$HOME/backup/rules-before-deploy.rules"; t "H11 nema sigurnosne kopije" block env CONFIRM=DA-OBJAVI-HOSTING bash "$(S deploy-hosting.sh)"
newenv; t "H12 sw.js sadrži API ključ (nakon deploya: izlaz != 0)" blockafter env CONFIRM=DA-OBJAVI-HOSTING STUB_SW_KEY=1 bash "$(S deploy-hosting.sh)"

echo "### 5. rollback (ops:rollback-rules / ops:lockdown-rules)"
RB() { bash "$(S rollback-rules.sh)" "$@"; }
newenv; t "B0 pozitivno (backup)" ok env CONFIRM=DA-VRATI-PRAVILA bash "$(S rollback-rules.sh)" backup
newenv; t "B1 bez CONFIRM" block bash "$(S rollback-rules.sh)" backup
newenv; t "B2 nepoznat način rada" block env CONFIRM=DA-VRATI-PRAVILA bash "$(S rollback-rules.sh)" nesto
newenv; rm "$HOME/backup/rules-before-deploy.rules"; t "B3 nedostajuća kopija" block env CONFIRM=DA-VRATI-PRAVILA bash "$(S rollback-rules.sh)" backup
newenv; echo "# izmjena" >> "$HOME/backup/rules-before-deploy.rules"; t "B4 neuspjeli sha256sum -c" block env CONFIRM=DA-VRATI-PRAVILA bash "$(S rollback-rules.sh)" backup
newenv; echo "x" > "$HOME/backup/rules-before-deploy.rules"; (cd "$HOME/backup" && sha256sum rules-before-deploy.rules > rules-before-deploy.sha256); t "B5 neispravan sadržaj (prekratak)" block env CONFIRM=DA-VRATI-PRAVILA bash "$(S rollback-rules.sh)" backup
newenv; (head -c 300 /dev/zero | tr '\0' 'q'; echo) > "$HOME/backup/rules-before-deploy.rules"; (cd "$HOME/backup" && sha256sum rules-before-deploy.rules > rules-before-deploy.sha256); t "B6 neispravan sadržaj (nema rules_version)" block env CONFIRM=DA-VRATI-PRAVILA bash "$(S rollback-rules.sh)" backup
newenv; rm "$HOME/backup/rules-before-deploy.sha256"; t "B7 nema datoteke s hashom" block env CONFIRM=DA-VRATI-PRAVILA bash "$(S rollback-rules.sh)" backup
newenv; rm -f "$HOME/home-inventory-pwa/node_modules/.bin/firebase"; t "B8 nema firebase-tools" block env CONFIRM=DA-VRATI-PRAVILA bash "$(S rollback-rules.sh)" backup
newenv; sed -i 's/^VITE_FIREBASE_PROJECT_ID=.*/VITE_FIREBASE_PROJECT_ID=drugi-projekt/' "$HOME/home-inventory-pwa/.env.production.local"; t "B8b POGREŠAN projekt u konfiguraciji" block env CONFIRM=DA-VRATI-PRAVILA bash "$(S rollback-rules.sh)" backup
for f in /tmp/rules-after.rules /tmp/rules-now.rules /tmp/rules-live.rules; do cp "$SRC/firestore.rules" "$f"; done
newenv; t "B9 provjera nakon povrata: REST greška (stara /tmp datoteka ne smije proći)" blockafter env CONFIRM=DA-VRATI-PRAVILA STUB_CURL_FAIL=1 bash "$(S rollback-rules.sh)" backup
newenv; t "B10 provjera nakon povrata: aktivna pravila ≠ kopija" blockafter env CONFIRM=DA-VRATI-PRAVILA STUB_RS=diff bash "$(S rollback-rules.sh)" backup
rm -f /tmp/rules-after.rules /tmp/rules-now.rules /tmp/rules-live.rules
newenv; t "L0 lockdown pozitivno" ok env CONFIRM=DA-ZAKLJUCAJ-PRAVILA LIVE_SRC="$ROOT/home/backup/rollback-lockdown/firestore.rules" bash "$(S rollback-rules.sh)" lockdown
newenv; t "L1 lockdown bez CONFIRM" block bash "$(S rollback-rules.sh)" lockdown
newenv; t "L2 lockdown s pogrešnom potvrdom (za povrat)" block env CONFIRM=DA-VRATI-PRAVILA bash "$(S rollback-rules.sh)" lockdown

echo
echo "UKUPNO: PASS=$PASS FAIL=$FAILN"
echo "Stvarni deploy nije pozvan ni u jednom slučaju (npm/npx su stubovi; DEPLOY-CALLED je samo brojač poziva stuba)."
rm -rf "${ROOT:?}"
[ "$FAILN" = 0 ]
