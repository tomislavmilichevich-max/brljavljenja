#!/bin/bash
# npm run backup — SAMO ČITANJE iz produkcije (REST GET) + lokalna sigurnosna kopija u ~/backup (izvan repozitorija).
# Ne sadrži nikakvu naredbu za objavu. Ne prepisuje postojeću kopiju. Ne ispisuje token ni UID-ove.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
guard_backup_outside_repo
RULES="$BK/rules-before-deploy.rules"
[ ! -e "$RULES" ] || die "$RULES već postoji — ne prepisujem sigurnosnu kopiju (premjesti je ili preimenuj svjesno)"
[ ! -e "$BK/rules-before-deploy.sha256" ] || die "postoji $BK/rules-before-deploy.sha256 — ne prepisujem (premjesti je svjesno)"
[ ! -e "$BK/ruleset-name-before.txt" ] || die "postoji $BK/ruleset-name-before.txt — ne prepisujem (premjesti ga svjesno)"
command -v jq >/dev/null || die "jq nije dostupan — koristi ručnu kopiju iz Console (rezerva u dokumentu)"
command -v gcloud >/dev/null || die "gcloud nije dostupan"

RS=$(active_ruleset) || die "ne mogu utvrditi aktivna pravila projekta $P"
TMP=$(mktemp) || die "mktemp"
if ! ruleset_to_file "$RS" "$TMP"; then rm -f "$TMP"; die "ne mogu dohvatiti sadržaj pravila"; fi
[ "$(wc -c < "$TMP")" -ge 100 ] || { rm -f "$TMP"; die "sadržaj pravila je sumnjivo kratak (< 100 B)"; }
{ grep -q "rules_version" "$TMP" && grep -q "service cloud.firestore" "$TMP"; } || { rm -f "$TMP"; die "sadržaj ne izgleda kao Firestore pravila"; }
INFO="aktivna pravila NE sadrže 'placementKeys' (stara P1 pravila — očekivano prije objave REV-04)"
grep -q "placementKeys" "$TMP" && INFO="aktivna pravila već sadrže 'placementKeys' (REV-04 ili novija pravila)"
printf '%s\n' "$RS" > "$BK/ruleset-name-before.txt"
mv "$TMP" "$RULES"
chmod 600 "$RULES" "$BK/ruleset-name-before.txt" 2>/dev/null || true
(cd "$BK" && sha256sum rules-before-deploy.rules > rules-before-deploy.sha256)
echo "OK: sigurnosna kopija pravila -> $RULES ($(wc -c < "$RULES") B, sha256 $(cut -c1-12 "$BK/rules-before-deploy.sha256"))"
echo "    $INFO"

# Hosting: ako ovaj dio padne, izlaz je 2 — izdanje se bilježi RUČNO iz Console; skriptu NE pokretati ponovno
hfail() { echo "UPOZORENJE: $1 — pravila su kopirana, ali Hosting izdanje zabilježi RUČNO (vidi dokument, 'rezerva')" >&2; exit 2; }
if [ -e "$BK/hosting-live-before.json" ]; then hfail "postoji $BK/hosting-live-before.json (ne prepisujem)"; fi
HC=$(hosting_live) || hfail "REST (hosting) nije dao valjano izdanje"
printf '%s\n' "$HC" > "$BK/hosting-live-before.json"
chmod 600 "$BK/hosting-live-before.json" 2>/dev/null || true
echo "OK: Hosting live izdanje: $(jq -r '.release.version.name' <<<"$HC") (objavljeno $(jq -r '.release.releaseTime' <<<"$HC"))"
echo "    Sljedeće (tek uz vlasnikovo odobrenje): CONFIRM=DA-OBJAVI-PRAVILA npm run ops:deploy-rules"
