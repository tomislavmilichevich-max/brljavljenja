#!/bin/bash
# npm run ops:rollback-rules  — vraća TOČNO kopiju pravila iz ~/backup (CONFIRM=DA-VRATI-PRAVILA)
# npm run ops:lockdown-rules  — hitno deny-all; NE briše podatke, samo blokira klijente (CONFIRM=DA-ZAKLJUCAJ-PRAVILA)
# Argument: backup | lockdown. Ne vraća Firestore podatke ni Hosting.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
MODE="${1:-}"
case "$MODE" in
  backup) need_confirm DA-VRATI-PRAVILA ;;
  lockdown) need_confirm DA-ZAKLJUCAJ-PRAVILA ;;
  *) die "upotreba: rollback-rules.sh backup|lockdown" ;;
esac
[ -d "$REPO/.git" ] || die "$REPO nije Git repozitorij"
[ -x "$REPO/node_modules/.bin/firebase" ] || die "firebase-tools nije instaliran u $REPO (npm ci)"
preflight_project_config
guard_backup_outside_repo
WORK="$BK/rollback-$MODE"
rm -rf "${WORK:?}"; mkdir -p "$WORK"
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
