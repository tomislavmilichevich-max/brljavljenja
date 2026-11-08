#!/bin/bash
# npm run prep — LOKALNE predprovjere i zapis trenutačnog commita u ~/backup/deploy-commit.txt.
# NE dira Firebase produkciju (nema REST poziva, nema deploya). Jedina mrežna radnja: `git fetch origin main` (GitHub, samo čitanje).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
[ -d "$REPO/.git" ] || die "$REPO nije Git repozitorij"
cd "$REPO" || die "cd $REPO nije uspio"
[ "$(git rev-parse --show-toplevel)" = "$(pwd -P)" ] || die "trenutni direktorij nije korijen repozitorija"
guard_backup_outside_repo

[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || die "nisi na grani main (git checkout main && git pull --ff-only)"
git fetch -q origin main || die "git fetch origin main nije uspio (provjeri prijavu: gh auth status)"
HEAD_SHA=$(git rev-parse HEAD)
[ "$HEAD_SHA" = "$(git rev-parse origin/main)" ] || die "HEAD nije jednak origin/main (git pull --ff-only)"
[ -z "$(git status --porcelain --untracked-files=all)" ] || die "git status nije čist (nepraćene ili izmijenjene datoteke)"
[ -f firestore.rules ] || die "nema firestore.rules"
[ "$(sha256sum firestore.rules | cut -c1-12)" = "$EXPECTED_RULES_SHA12" ] || die "hash firestore.rules nije $EXPECTED_RULES_SHA12"
command -v jq >/dev/null || die "jq nije dostupan"
command -v gcloud >/dev/null || die "gcloud nije dostupan"
[ -x node_modules/.bin/firebase ] || die "firebase-tools nije instaliran (npm ci)"
npm run check:no-actions >/dev/null || die "check:no-actions"
npm run guard:rules >/dev/null || die "guard:rules"
preflight_project_config

OLD=$(cat "$BK/deploy-commit.txt" 2>/dev/null || true)
printf '%s\n' "$HEAD_SHA" > "$BK/deploy-commit.txt"
if [ -n "$OLD" ] && [ "$OLD" != "$HEAD_SHA" ]; then echo "NAPOMENA: zabilježeni commit promijenjen: ${OLD:0:7} → ${HEAD_SHA:0:7}"; fi
echo "OK: priprema završena (ništa nije objavljeno)."
echo "    projekt: $P · commit: ${HEAD_SHA:0:12} · hash pravila: $EXPECTED_RULES_SHA12 · zapis: $BK/deploy-commit.txt"
echo "    Sljedeće: npm run backup"
