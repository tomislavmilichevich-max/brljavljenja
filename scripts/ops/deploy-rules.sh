#!/bin/bash
# npm run ops:deploy-rules — objava pravila REV-04. Jedini poziv deploya je zadnja naredba; do tada svaki uvjet mora proći.
# Zahtijeva: CONFIRM=DA-OBJAVI-PRAVILA (daje se TEK nakon izričitog vlasnikova odobrenja).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
need_confirm DA-OBJAVI-PRAVILA
preflight_repo           # direktorij, HEAD = zapisani commit, čist git, hash pravila, guard:rules
preflight_project_config # projekt u konfiguraciji = $P, guard:env
validate_backup          # valjana kopija prethodnih pravila (npm run backup)
validate_hosting_record  # zabilježeno Hosting izdanje
echo "Objavljujem pravila: commit $(git rev-parse --short HEAD), sha256 ${EXPECTED_RULES_SHA12}, projekt $P"
npm run deploy:rules
verify_live_rules "$REPO/firestore.rules"
echo "OK: pravila REV-04 objavljena i potvrđena na poslužitelju"
echo "    Sljedeće (tek uz vlasnikovo odobrenje): CONFIRM=DA-OBJAVI-HOSTING npm run ops:deploy-hosting"
