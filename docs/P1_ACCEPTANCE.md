# P1 — prihvatni kriteriji i test matrica

Verzija P1-AT-01 · 2026-11-06 · samo Firebase Auth/ACL, bez implementacije inventara.

## Minimalni testni fixture

- Kućanstvo **h1** s dva aktivna člana **uidA**, **uidB**.
- Kućanstvo **h2** s drugim članstvom (ili bez člana).
- Treći autentificirani korisnik **uidC** nije član h1.
- **uidDisabled** ima `enabled:false` u h1.
- Testovi ne smiju koristiti stvarne korisničke UID-ove ni produkcijski Firebase projekt.

## Automatski Security Rules testovi

| ID | Scenarij | Očekivano |
|---|---|---|
| ACL-01 | Neautentificiran GET household h1 | DENY |
| ACL-02 | Neautentificiran GET membership uidA | DENY |
| ACL-03 | uidC (nije član) GET household h1 | DENY |
| ACL-04 | uidDisabled GET household h1 | DENY |
| ACL-05 | uidA GET household h1 | ALLOW |
| ACL-06 | uidB GET household h1 | ALLOW |
| ACL-07 | uidA GET vlastiti membership | ALLOW |
| ACL-08 | uidA GET uidB membership | DENY |
| ACL-09 | uidA LIST members | DENY |
| ACL-10 | uidA LIST households | DENY |
| ACL-11 | uidA GET household h2 | DENY |
| ACL-12 | uidA CREATE self membership u neodobrenom household | DENY |
| ACL-13 | uidA CREATE membership za trećeg korisnika | DENY |
| ACL-14 | uidA UPDATE `enabled` ili `role` | DENY |
| ACL-15 | uidA DELETE membership | DENY |
| ACL-16 | uidA WRITE household h1 | DENY |
| ACL-17 | uidA READ/WRITE locations/items/placements/appliedOps u P1 | DENY |
| ACL-18 | uidA READ/WRITE nepoznate putanje | DENY |
| ACL-19 | nakon `enabled:false` za uidA, GET household | DENY |
| ACL-20 | uidB ostaje ALLOW nakon opoziva uidA | ALLOW |

## Aplikacijski i UX testovi

| ID | Radnja | Očekivano |
|---|---|---|
| APP-01 | Nedostaje Firebase konfiguracija | Jasna poruka, bez pada aplikacije |
| APP-02 | Uspješan Google login, UID nije član | „Nemaš pristup“, nema privatnih podataka |
| APP-03 | Prijavljen odobreni član | Prikaz dozvoljenog household naziva / pilot zaslona |
| APP-04 | Odjava | Povratak na prijavu; nema privatnih podataka |
| APP-05 | Error/rate limit/offline u autentikaciji | Razumljiva poruka, bez lažne potvrde uspjeha |
| APP-06 | Neodobreni korisnik može kopirati samo svoj UID | Da, bez tuđih podataka |
| APP-07 | PWA app shell offline | P0 regresijski test i dalje PASS |
| APP-08 | Developer konzola i build | Bez otkrivenih tokena i grešaka uz normalan rad |

## Status koji se NE SMIJE lažno proglasiti PASS

- Dva stvarna Google računa na dva fizička Androida: **NOT VERIFIED** dok korisnik ne proba.
- Prijava u instaliranoj PWA nakon redirecta: **NOT VERIFIED** dok se proba na Androidu.
- Google Drive fotografije: **NOT STARTED** (P4).
- Offline promjena lokacija i konflikti: **NOT STARTED** (P3).
- NFC/QR/barcode: **NOT STARTED** (v0.2).
- Shopping list: **NOT STARTED** (v0.3).

## Gates prije P1 odobrenja

1. `npm run check` PASS.
2. `npm run check:no-actions` PASS.
3. `@firebase/rules-unit-testing` s Firestore emulatorom: **svi ACL testovi PASS**.
4. Dokumentacija i Security Rules međusobno usklađeni.
5. Testovi su ponovljivi bez GitHub Actionsa i bez produkcijskih vjerodajnica.
6. Nema deploya, plaćenih servisa ni neodobrenog funkcionalnog scope creepa.
7. Claude dostavlja `docs/P1_TEST_REPORT.md`, granu i PR; vlasnik odlučuje o prihvaćanju.

Ako emulator ne može raditi, status testova je **BLOCKED**, nikad PASS na temelju čitanja koda.
