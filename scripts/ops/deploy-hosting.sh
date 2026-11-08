#!/bin/bash
# npm run ops:deploy-hosting — objava aplikacije. ZABRANJENO dok REV-04 pravila nisu potvrđena kao aktivna na poslužitelju.
# Zahtijeva: CONFIRM=DA-OBJAVI-HOSTING (daje se TEK nakon izričitog vlasnikova odobrenja).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
need_confirm DA-OBJAVI-HOSTING
preflight_repo
preflight_project_config
validate_backup
validate_hosting_record
verify_live_rules "$REPO/firestore.rules"   # pravila moraju biti objavljena PRIJE aplikacije; REST greška = zabrana
echo "Objavljujem aplikaciju: commit $(git rev-parse --short HEAD), projekt $P"
npm run deploy:hosting
curl -sSfI "https://$P.firebaseapp.com/" | head -1
SW=$(curl -sSf "https://$P.firebaseapp.com/sw.js") || die "sw.js nije dohvaćen"
if grep -q 'AIza' <<<"$SW"; then die "sw.js sadrži API ključ"; fi
echo "OK: Hosting objavljen (Console → Hosting → Release history: zabilježi novo izdanje)"
