# P2_D1_DEPLOY_SCRIPTS_TEST — provjera fail-closed zaštita deploy/rollback skripti

**Samo provjera naredbi iz `docs/P2_D1_DEPLOY_ROLLBACK.md` (§2a skripte) s LAŽNIM podacima.** Nije izvršen nikakav produkcijski deploy, bootstrap ni REST poziv prema stvarnom Firebaseu: `git` je stvarni nad privremenim lažnim repozitorijem u privremenom `HOME`; `npm`, `npx`, `gcloud` i `curl` su **stubovi** koji samo bilježe pozive i vraćaju zadane odgovore. Test izvlači skripte **izravno iz dokumenta** (isti tekst koji bi vlasnik zalijepio).

Kriterij: u svakom _negativnom_ slučaju skripta mora izaći s kodom ≠ 0 i stub „deploya" **nijednom** ne smije biti pozvan; u _pozitivnom_ točno jednom, tek nakon svih provjera; u slučajevima „završna provjera" deploy je pozvan, ali REST provjera nakon njega mora pasti i **ne smije pročitati staru `/tmp` datoteku** (prije testa su u `/tmp` postavljene stare VALJANE datoteke `rules-after.rules`, `rules-now.rules`, `rules-live.rules`; skripte koriste svježi `mktemp`).

**Rezultat: 61/61 PASS, 0 FAIL.**

**KORAK 4: deploy-rules.sh (obavezni uvjeti)**

| ID  | Scenarij (lažni podaci)                              | Ishod                                                   | Rezultat |
| --- | ---------------------------------------------------- | ------------------------------------------------------- | -------- |
| R0  | pozitivno: svi uvjeti ispunjeni                      | izlaz 0, deploy pozvan točno jednom, tek nakon provjera | PASS     |
| R1  | bez izričite potvrde (CONFIRM)                       | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R2  | pogrešan CONFIRM                                     | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R3  | nepostojeći direktorij repozitorija                  | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R3b | direktorij nije git repozitorij                      | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R4  | HEAD ≠ zabilježeni commit                            | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R4b | deploy-commit.txt nije hash                          | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R4c | nema deploy-commit.txt                               | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R5  | nečist git (izmijenjena praćena datoteka)            | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R5b | nečist git (nepraćena datoteka)                      | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R6  | pogrešan hash pravila (git čist, HEAD podudaran)     | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R7  | guard:rules pada (nevaljana pravila)                 | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R8  | nedostaje sigurnosna kopija                          | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R9  | neispravna kopija (kratka; hash se ne podudara)      | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R9b | kopija bez sadržaja pravila (hash valjan)            | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R9c | kopija izmijenjena nakon zapisa hasha (sha256sum -c) | izlaz 1, deploy NIJE pozvan                             | PASS     |
| R10 | nije zabilježeno Hosting izdanje                     | izlaz 1, deploy NIJE pozvan                             | PASS     |

**KORAK 4: završna REST provjera NAKON deploya (u /tmp postoji STARA valjana datoteka; ne smije se čitati)**

| ID  | Scenarij (lažni podaci)                         | Ishod                               | Rezultat |
| --- | ----------------------------------------------- | ----------------------------------- | -------- |
| V1  | REST HTTP greška                                | izlaz 1: završna REST provjera pala | PASS     |
| V2  | REST vraća error objekt                         | izlaz 1: završna REST provjera pala | PASS     |
| V3  | nedostaje ruleset (null)                        | izlaz 1: završna REST provjera pala | PASS     |
| V4  | prazan sadržaj aktivnih pravila                 | izlaz 1: završna REST provjera pala | PASS     |
| V5  | ruleset bez sadržaja                            | izlaz 1: završna REST provjera pala | PASS     |
| V6  | ruleset vraća error objekt                      | izlaz 1: završna REST provjera pala | PASS     |
| V7  | aktivna pravila se razlikuju od firestore.rules | izlaz 1: završna REST provjera pala | PASS     |
| V8  | nema gcloud tokena                              | izlaz 1: završna REST provjera pala | PASS     |

**KORAK 6: deploy-hosting.sh**

| ID  | Scenarij (lažni podaci)                                         | Ishod                                                   | Rezultat |
| --- | --------------------------------------------------------------- | ------------------------------------------------------- | -------- |
| H0  | pozitivno                                                       | izlaz 0, deploy pozvan točno jednom, tek nakon provjera | PASS     |
| H1  | bez CONFIRM                                                     | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H2  | nepostojeći direktorij                                          | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H3  | HEAD ≠ zabilježeni commit                                       | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H4  | nečist git                                                      | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H5  | nema .env.production.local (nevaljana konfiguracija)            | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H6  | guard:env pada (nevaljana konfiguracija)                        | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H7  | pogrešan hash pravila                                           | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H8  | REST pravila nedostupna (pravila nisu potvrđena kao objavljena) | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H9  | aktivna pravila ≠ firestore.rules (REV-04 nije objavljen)       | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H10 | nema aktivnog rulesetta                                         | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H11 | nema sigurnosne kopije                                          | izlaz 1, deploy NIJE pozvan                             | PASS     |
| H12 | sw.js sadrži API ključ (nakon deploya: izlaz != 0)              | izlaz 1: završna REST provjera pala                     | PASS     |

**KORAK 10b: rollback-rules.sh**

| ID  | Scenarij (lažni podaci)                                                  | Ishod                                                   | Rezultat |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------- | -------- |
| B0  | pozitivno (backup)                                                       | izlaz 0, deploy pozvan točno jednom, tek nakon provjera | PASS     |
| B1  | bez CONFIRM                                                              | izlaz 1, deploy NIJE pozvan                             | PASS     |
| B2  | nepoznat način rada                                                      | izlaz 1, deploy NIJE pozvan                             | PASS     |
| B3  | nedostajuća kopija                                                       | izlaz 1, deploy NIJE pozvan                             | PASS     |
| B4  | neuspjeli sha256sum -c                                                   | izlaz 1, deploy NIJE pozvan                             | PASS     |
| B5  | neispravan sadržaj (prekratak)                                           | izlaz 1, deploy NIJE pozvan                             | PASS     |
| B6  | neispravan sadržaj (nema rules_version)                                  | izlaz 1, deploy NIJE pozvan                             | PASS     |
| B7  | nema datoteke s hashom                                                   | izlaz 1, deploy NIJE pozvan                             | PASS     |
| B8  | nema firebase-tools                                                      | izlaz 1, deploy NIJE pozvan                             | PASS     |
| B9  | provjera nakon povrata: REST greška (stara /tmp datoteka ne smije proći) | izlaz 1: završna REST provjera pala                     | PASS     |
| B10 | provjera nakon povrata: aktivna pravila ≠ kopija                         | izlaz 1: završna REST provjera pala                     | PASS     |
| L0  | lockdown pozitivno                                                       | izlaz 0, deploy pozvan točno jednom, tek nakon provjera | PASS     |
| L1  | lockdown bez CONFIRM                                                     | izlaz 1, deploy NIJE pozvan                             | PASS     |
| L2  | lockdown s pogrešnom potvrdom (za povrat)                                | izlaz 1, deploy NIJE pozvan                             | PASS     |

**KORAK 3: backup-rules.sh (samo čita; kopija se ne smije stvoriti iz neispravnog odgovora)**

| ID  | Scenarij (lažni podaci)        | Ishod                         | Rezultat |
| --- | ------------------------------ | ----------------------------- | -------- |
| K0  | pozitivno                      | izlaz 0                       | PASS     |
| K1  | REST HTTP greška               | izlaz 1, kopija NIJE stvorena | PASS     |
| K2  | release vraća error objekt     | izlaz 1, kopija NIJE stvorena | PASS     |
| K3  | null ruleset                   | izlaz 1, kopija NIJE stvorena | PASS     |
| K4  | prazan sadržaj                 | izlaz 1, kopija NIJE stvorena | PASS     |
| K5  | sadržaj nedostaje              | izlaz 1, kopija NIJE stvorena | PASS     |
| K6  | ruleset vraća error objekt     | izlaz 1, kopija NIJE stvorena | PASS     |
| K7  | nema tokena                    | izlaz 1, kopija NIJE stvorena | PASS     |
| K8  | sadržaj nije Firestore pravila | izlaz 1, kopija NIJE stvorena | PASS     |

## Nalaz tijekom testiranja (ispravljeno prije predaje)

Prvi prolaz pozitivnih slučajeva pao je jer je `jq -r` na kraj sadržaja pravila dodavao dodatni prazni redak pa se aktivna pravila uspoređivala kao „različita". Ispravljeno na `jq -j` (sadržaj bez dodanog znaka novog retka) u `backup-rules.sh` i `lib.sh`; zatim 61/61.

## Ponavljanje

Spremiti dolje navedenu skriptu kao `harness.sh` i iz korijena klona pokrenuti `bash harness.sh` (zadani `DOC`/`REALRULES` su `docs/P2_D1_DEPLOY_ROLLBACK.md` i `firestore.rules` u trenutnom direktoriju). Ne dira mrežu ni produkciju.

````bash
#!/bin/bash
# Negativni/pozitivni testovi zaštita iz docs/P2_D1_DEPLOY_ROLLBACK.md s LAŽNIM podacima.
# Git je stvarni (nad lažnim repozitorijem u privremenom HOME-u); npm/npx/gcloud/curl su STUBOVI koji samo bilježe pozive.
# Ni u jednom slučaju se ne poziva stvarni deploy.
DOC="${DOC:-$PWD/docs/P2_D1_DEPLOY_ROLLBACK.md}"   # pokreni iz korijena klona (ili postavi DOC=...)
REALRULES="${REALRULES:-$PWD/firestore.rules}"
ROOT=$(mktemp -d)
STUB="${ROOT:?}/stub"; mkdir -p "$STUB"
PASS=0; FAILN=0
python3 - "$DOC" "$ROOT/install.sh" <<'PY'
import re,sys
s=open(sys.argv[1]).read()
i=s.index("## 2a."); j=s.index("## 3.")
f=chr(96)*3  # tri obrnuta jednostruka navodnika (ne pisati doslovno unutar Markdown bloka)
m=re.search(f+r"bash\n(.*?)"+f,s[i:j],re.S)
open(sys.argv[2],'w').write(m.group(1))
PY
cat > "$STUB/npm" <<'E'
#!/bin/bash
echo "npm $*" >> "$CALLLOG"
case "$*" in
 "run guard:rules") [ "${STUB_GUARD_FAIL:-0}" = 1 ] && { echo guard-fail >&2; exit 1; } ;;
 "run guard:env") [ "${STUB_ENV_FAIL:-0}" = 1 ] && exit 1 ;;
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
[ "${STUB_NOTOKEN:-0}" = 1 ] && exit 1
echo faketoken
E
cat > "$STUB/curl" <<'E'
#!/bin/bash
url="${@: -1}"
echo "curl $url" >> "$CALLLOG"
[ "${STUB_CURL_FAIL:-0}" = 1 ] && exit 22
case "$url" in
 *releases/cloud.firestore) case "${STUB_REL:-ok}" in err) echo '{"error":{"code":403}}';; null) echo '{"name":"x"}';; *) echo '{"rulesetName":"projects/p/rulesets/abc"}';; esac;;
 *rulesets/abc) case "${STUB_RS:-same}" in empty) echo '{"source":{"files":[{"content":""}]}}';; none) echo '{"source":{}}';; err) echo '{"error":{"code":500}}';; diff) python3 -c "import json;print(json.dumps({'source':{'files':[{'content':'rules_version = 2;\n// OLD\n'+'x'*200}]}}))";; same) python3 -c "import json,os;print(json.dumps({'source':{'files':[{'content':open(os.environ['LIVE_SRC']).read()}]}}))";; esac;;
 *channels/live) echo '{"release":{"version":{"name":"sites/p/versions/v1"},"releaseTime":"2026-01-01"}}';;
 *firebaseapp.com/sw.js) if [ "${STUB_SW_KEY:-0}" = 1 ]; then echo "AIzaSyFAKE"; else echo "// sw"; fi;;
 *firebaseapp.com/) echo "HTTP/2 200";;
esac
E
chmod +x "$STUB"/*

newenv() {
  rm -rf "${ROOT:?}/home"
  export HOME="${ROOT:?}/home"; mkdir -p "$HOME/backup"
  bash "$ROOT/install.sh" >/dev/null 2>&1 || { echo "INSTALL FAIL"; exit 9; }
  git init -q "$HOME/home-inventory-pwa"; cd "$HOME/home-inventory-pwa" || exit 9
  git config user.email t@t; git config user.name t
  cp "$REALRULES" firestore.rules; printf '.env*\n' > .gitignore; echo VITE=1 > .env.production.local
  mkdir -p node_modules/.bin; printf '#!/bin/bash\n' > node_modules/.bin/firebase; chmod +x node_modules/.bin/firebase
  printf 'node_modules/\n' >> .gitignore
  git add -A; git commit -qm init; git rev-parse HEAD > "$HOME/backup/deploy-commit.txt"
  cp "$REALRULES" "$HOME/backup/rules-before-deploy.rules"
  (cd "$HOME/backup" && sha256sum rules-before-deploy.rules > rules-before-deploy.sha256)
  echo projects/p/rulesets/old > "$HOME/backup/ruleset-name-before.txt"
  echo '{"release":{}}' > "$HOME/backup/hosting-live-before.json"
  export CALLLOG="$ROOT/calls.log"; : > "$CALLLOG"
  export LIVE_SRC="$REALRULES" PATH="$STUB:$PATH"
  unset STUB_GUARD_FAIL STUB_ENV_FAIL STUB_NOTOKEN STUB_CURL_FAIL STUB_REL STUB_RS STUB_SW_KEY CONFIRM
}
t() {
  local name="$1" want="$2"; shift 2
  local out rc n
  out=$("$@" 2>&1); rc=$?
  n=$(grep -c DEPLOY-CALLED "$CALLLOG")
  if [ "$want" = block ]; then
    if [ $rc -ne 0 ] && [ "$n" = 0 ]; then echo "PASS  $name  (izlaz $rc, deploy NIJE pozvan) :: $(echo "$out" | grep -m1 ZAUSTAVLJENO | cut -c1-105)"; PASS=$((PASS+1)); else echo "FAIL  $name  (izlaz $rc, deploy pozivi=$n)"; echo "$out" | tail -3; FAILN=$((FAILN+1)); fi
  elif [ "$want" = ok ]; then
    if [ $rc -eq 0 ] && [ "$n" = 1 ]; then echo "PASS  $name  (izlaz 0, deploy pozvan točno jednom, tek nakon provjera)"; PASS=$((PASS+1)); else echo "FAIL  $name  (izlaz $rc, deploy pozivi=$n)"; echo "$out" | tail -5; FAILN=$((FAILN+1)); fi
  else
    if [ $rc -ne 0 ] && [ "$n" = 1 ]; then echo "PASS  $name  (izlaz $rc: završna REST provjera pala) :: $(echo "$out" | grep -m1 ZAUSTAVLJENO | cut -c1-95)"; PASS=$((PASS+1)); else echo "FAIL  $name  (izlaz $rc, deploy pozivi=$n)"; echo "$out" | tail -4; FAILN=$((FAILN+1)); fi
  fi
}
B="$ROOT/home/backup"
DR="bash $B/deploy-rules.sh"; DH="bash $B/deploy-hosting.sh"; RB="bash $B/rollback-rules.sh"; BR="bash $B/backup-rules.sh"
chg() { (cd "$HOME/home-inventory-pwa" && "$@"); }

echo "### KORAK 4: deploy-rules.sh (obavezni uvjeti)"
newenv; t "R0 pozitivno: svi uvjeti ispunjeni" ok env CONFIRM=DA-OBJAVI-PRAVILA $DR
newenv; t "R1 bez izričite potvrde (CONFIRM)" block $DR
newenv; t "R2 pogrešan CONFIRM" block env CONFIRM=DA $DR
newenv; rm -rf "${HOME:?}/home-inventory-pwa"; t "R3 nepostojeći direktorij repozitorija" block env CONFIRM=DA-OBJAVI-PRAVILA $DR
newenv; rm -rf "${HOME:?}/home-inventory-pwa/.git"; t "R3b direktorij nije git repozitorij" block env CONFIRM=DA-OBJAVI-PRAVILA $DR
newenv; chg bash -c 'echo x > a.txt && git add a.txt && git commit -qm second'; t "R4 HEAD ≠ zabilježeni commit" block env CONFIRM=DA-OBJAVI-PRAVILA $DR
newenv; echo notahash > "$HOME/backup/deploy-commit.txt"; t "R4b deploy-commit.txt nije hash" block env CONFIRM=DA-OBJAVI-PRAVILA $DR
newenv; rm "$HOME/backup/deploy-commit.txt"; t "R4c nema deploy-commit.txt" block env CONFIRM=DA-OBJAVI-PRAVILA $DR
newenv; echo "# x" >> "$HOME/home-inventory-pwa/firestore.rules"; t "R5 nečist git (izmijenjena praćena datoteka)" block env CONFIRM=DA-OBJAVI-PRAVILA $DR
newenv; echo y > "$HOME/home-inventory-pwa/untracked.txt"; t "R5b nečist git (nepraćena datoteka)" block env CONFIRM=DA-OBJAVI-PRAVILA $DR
newenv; chg bash -c 'echo "// izmjena" >> firestore.rules && git commit -qam change'; chg git rev-parse HEAD > "$HOME/backup/deploy-commit.txt"; t "R6 pogrešan hash pravila (git čist, HEAD podudaran)" block env CONFIRM=DA-OBJAVI-PRAVILA $DR
newenv; t "R7 guard:rules pada (nevaljana pravila)" block env CONFIRM=DA-OBJAVI-PRAVILA STUB_GUARD_FAIL=1 $DR
newenv; rm "$HOME/backup/rules-before-deploy.rules"; t "R8 nedostaje sigurnosna kopija" block env CONFIRM=DA-OBJAVI-PRAVILA $DR
newenv; echo "kratko" > "$HOME/backup/rules-before-deploy.rules"; t "R9 neispravna kopija (kratka; hash se ne podudara)" block env CONFIRM=DA-OBJAVI-PRAVILA $DR
newenv; (head -c 300 /dev/zero | tr '\0' 'x'; echo) > "$HOME/backup/rules-before-deploy.rules"; (cd "$HOME/backup" && sha256sum rules-before-deploy.rules > rules-before-deploy.sha256); t "R9b kopija bez sadržaja pravila (hash valjan)" block env CONFIRM=DA-OBJAVI-PRAVILA $DR
newenv; echo "# izmjena" >> "$HOME/backup/rules-before-deploy.rules"; t "R9c kopija izmijenjena nakon zapisa hasha (sha256sum -c)" block env CONFIRM=DA-OBJAVI-PRAVILA $DR
newenv; rm "$HOME/backup/hosting-live-before.json"; t "R10 nije zabilježeno Hosting izdanje" block env CONFIRM=DA-OBJAVI-PRAVILA $DR

echo "### KORAK 4: završna REST provjera NAKON deploya (u /tmp postoji STARA valjana datoteka; ne smije se čitati)"
for f in /tmp/rules-after.rules /tmp/rules-now.rules /tmp/rules-live.rules; do cp "$REALRULES" "$f"; done
newenv; t "V1 REST HTTP greška" blockafter env CONFIRM=DA-OBJAVI-PRAVILA STUB_CURL_FAIL=1 $DR
newenv; t "V2 REST vraća error objekt" blockafter env CONFIRM=DA-OBJAVI-PRAVILA STUB_REL=err $DR
newenv; t "V3 nedostaje ruleset (null)" blockafter env CONFIRM=DA-OBJAVI-PRAVILA STUB_REL=null $DR
newenv; t "V4 prazan sadržaj aktivnih pravila" blockafter env CONFIRM=DA-OBJAVI-PRAVILA STUB_RS=empty $DR
newenv; t "V5 ruleset bez sadržaja" blockafter env CONFIRM=DA-OBJAVI-PRAVILA STUB_RS=none $DR
newenv; t "V6 ruleset vraća error objekt" blockafter env CONFIRM=DA-OBJAVI-PRAVILA STUB_RS=err $DR
newenv; t "V7 aktivna pravila se razlikuju od firestore.rules" blockafter env CONFIRM=DA-OBJAVI-PRAVILA STUB_RS=diff $DR
newenv; t "V8 nema gcloud tokena" blockafter env CONFIRM=DA-OBJAVI-PRAVILA STUB_NOTOKEN=1 $DR
rm -f /tmp/rules-after.rules /tmp/rules-now.rules /tmp/rules-live.rules

echo "### KORAK 6: deploy-hosting.sh"
newenv; t "H0 pozitivno" ok env CONFIRM=DA-OBJAVI-HOSTING $DH
newenv; t "H1 bez CONFIRM" block $DH
newenv; rm -rf "${HOME:?}/home-inventory-pwa"; t "H2 nepostojeći direktorij" block env CONFIRM=DA-OBJAVI-HOSTING $DH
newenv; chg bash -c 'echo x > a && git add a && git commit -qm s'; t "H3 HEAD ≠ zabilježeni commit" block env CONFIRM=DA-OBJAVI-HOSTING $DH
newenv; echo y > "$HOME/home-inventory-pwa/untracked.txt"; t "H4 nečist git" block env CONFIRM=DA-OBJAVI-HOSTING $DH
newenv; rm "$HOME/home-inventory-pwa/.env.production.local"; t "H5 nema .env.production.local (nevaljana konfiguracija)" block env CONFIRM=DA-OBJAVI-HOSTING $DH
newenv; t "H6 guard:env pada (nevaljana konfiguracija)" block env CONFIRM=DA-OBJAVI-HOSTING STUB_ENV_FAIL=1 $DH
newenv; chg bash -c 'echo "// c" >> firestore.rules && git commit -qam c'; chg git rev-parse HEAD > "$HOME/backup/deploy-commit.txt"; t "H7 pogrešan hash pravila" block env CONFIRM=DA-OBJAVI-HOSTING $DH
newenv; t "H8 REST pravila nedostupna (pravila nisu potvrđena kao objavljena)" block env CONFIRM=DA-OBJAVI-HOSTING STUB_CURL_FAIL=1 $DH
newenv; t "H9 aktivna pravila ≠ firestore.rules (REV-04 nije objavljen)" block env CONFIRM=DA-OBJAVI-HOSTING STUB_RS=diff $DH
newenv; t "H10 nema aktivnog rulesetta" block env CONFIRM=DA-OBJAVI-HOSTING STUB_REL=null $DH
newenv; rm "$HOME/backup/rules-before-deploy.rules"; t "H11 nema sigurnosne kopije" block env CONFIRM=DA-OBJAVI-HOSTING $DH
newenv; t "H12 sw.js sadrži API ključ (nakon deploya: izlaz != 0)" blockafter env CONFIRM=DA-OBJAVI-HOSTING STUB_SW_KEY=1 $DH

echo "### KORAK 10b: rollback-rules.sh"
newenv; t "B0 pozitivno (backup)" ok env CONFIRM=DA-VRATI-PRAVILA $RB backup
newenv; t "B1 bez CONFIRM" block $RB backup
newenv; t "B2 nepoznat način rada" block env CONFIRM=DA-VRATI-PRAVILA $RB nesto
newenv; rm "$HOME/backup/rules-before-deploy.rules"; t "B3 nedostajuća kopija" block env CONFIRM=DA-VRATI-PRAVILA $RB backup
newenv; echo "# izmjena" >> "$HOME/backup/rules-before-deploy.rules"; t "B4 neuspjeli sha256sum -c" block env CONFIRM=DA-VRATI-PRAVILA $RB backup
newenv; echo "x" > "$HOME/backup/rules-before-deploy.rules"; (cd "$HOME/backup" && sha256sum rules-before-deploy.rules > rules-before-deploy.sha256); t "B5 neispravan sadržaj (prekratak)" block env CONFIRM=DA-VRATI-PRAVILA $RB backup
newenv; (head -c 300 /dev/zero | tr '\0' 'q'; echo) > "$HOME/backup/rules-before-deploy.rules"; (cd "$HOME/backup" && sha256sum rules-before-deploy.rules > rules-before-deploy.sha256); t "B6 neispravan sadržaj (nema rules_version)" block env CONFIRM=DA-VRATI-PRAVILA $RB backup
newenv; rm "$HOME/backup/rules-before-deploy.sha256"; t "B7 nema datoteke s hashom" block env CONFIRM=DA-VRATI-PRAVILA $RB backup
newenv; rm -f "${HOME:?}/home-inventory-pwa/node_modules/.bin/firebase"; t "B8 nema firebase-tools" block env CONFIRM=DA-VRATI-PRAVILA $RB backup
for f in /tmp/rules-after.rules /tmp/rules-now.rules /tmp/rules-live.rules; do cp "$REALRULES" "$f"; done
newenv; t "B9 provjera nakon povrata: REST greška (stara /tmp datoteka ne smije proći)" blockafter env CONFIRM=DA-VRATI-PRAVILA STUB_CURL_FAIL=1 $RB backup
newenv; t "B10 provjera nakon povrata: aktivna pravila ≠ kopija" blockafter env CONFIRM=DA-VRATI-PRAVILA STUB_RS=diff $RB backup
rm -f /tmp/rules-after.rules /tmp/rules-now.rules /tmp/rules-live.rules
newenv; t "L0 lockdown pozitivno" ok env CONFIRM=DA-ZAKLJUCAJ-PRAVILA LIVE_SRC="$ROOT/home/backup/rollback-lockdown/firestore.rules" $RB lockdown
newenv; t "L1 lockdown bez CONFIRM" block $RB lockdown
newenv; t "L2 lockdown s pogrešnom potvrdom (za povrat)" block env CONFIRM=DA-VRATI-PRAVILA $RB lockdown

echo "### KORAK 3: backup-rules.sh (samo čita; kopija se ne smije stvoriti iz neispravnog odgovora)"
bk() {
  local name="$1" mode="$2"; shift 2
  newenv; rm -f "$HOME/backup/rules-before-deploy.rules" "$HOME/backup/rules-before-deploy.sha256" "$HOME/backup/ruleset-name-before.txt" "$HOME/backup/hosting-live-before.json"
  local out rc; out=$("$@" 2>&1); rc=$?
  if [ "$mode" = fail ]; then
    if [ $rc -ne 0 ] && [ ! -e "$HOME/backup/rules-before-deploy.rules" ]; then echo "PASS  $name  (izlaz $rc, kopija NIJE stvorena)"; PASS=$((PASS+1)); else echo "FAIL  $name rc=$rc"; FAILN=$((FAILN+1)); fi
  elif [ "$mode" = hostfail ]; then
    if [ $rc -eq 2 ] && [ -s "$HOME/backup/rules-before-deploy.rules" ]; then echo "PASS  $name  (izlaz 2: kopija pravila OK, Hosting ručno)"; PASS=$((PASS+1)); else echo "FAIL  $name rc=$rc"; FAILN=$((FAILN+1)); fi
  else
    if [ $rc -eq 0 ] && [ -s "$HOME/backup/rules-before-deploy.rules" ] && [ -s "$HOME/backup/rules-before-deploy.sha256" ]; then echo "PASS  $name  (izlaz 0)"; PASS=$((PASS+1)); else echo "FAIL  $name rc=$rc $out"; FAILN=$((FAILN+1)); fi
  fi
}
bk "K0 pozitivno" ok env $BR
bk "K1 REST HTTP greška" fail env STUB_CURL_FAIL=1 $BR
bk "K2 release vraća error objekt" fail env STUB_REL=err $BR
bk "K3 null ruleset" fail env STUB_REL=null $BR
bk "K4 prazan sadržaj" fail env STUB_RS=empty $BR
bk "K5 sadržaj nedostaje" fail env STUB_RS=none $BR
bk "K6 ruleset vraća error objekt" fail env STUB_RS=err $BR
bk "K7 nema tokena" fail env STUB_NOTOKEN=1 $BR
bk "K8 sadržaj nije Firestore pravila" fail env STUB_RS=diff $BR

echo
echo "UKUPNO: PASS=$PASS FAIL=$FAILN"
echo "Stvarni deploy nije pozvan ni u jednom slučaju (npm/npx su stubovi; DEPLOY-CALLED se bilježi samo kao broj poziva stuba)."
rm -rf "${ROOT:?}"
[ "$FAILN" = 0 ]
```
````
