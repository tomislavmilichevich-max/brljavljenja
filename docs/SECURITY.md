# SECURITY — Kućni inventar

Status: P1 pravila i klijent implementirani i testirani u emulatoru (PR čeka odobrenje); NISU deployani. Stvarni Android/Google login NOT VERIFIED. Ažurirano: 2026-11-06.

## Obavezne granice

- Privatni repozitorij `home-inventory-pwa` (GitHub). Privatnost repozitorija **nije zamjena za** autentifikaciju i Firestore Security Rules.
- Nema privatnih ključeva, servisnih računa, OAuth tokena, Google Drive datoteka ni privatnih fotografija u kodu/repozitoriju.
- `firestore.rules` u P0 = `allow read, write: if false`; mijenjati tek u P1 uz provjerene testove.
- Bez Firebase Blaze/Cloud Functions/Storage i bez GitHub Actions.

## P1: model pristupa (odobreno)

Jedno kućanstvo, dva _ovlaštena_ korisnika s odvojenim Firebase Google Auth računima. Autentikacija nije isto što i autorizacija.

Putanje:

```text
households/{householdId}
households/{householdId}/members/{uid}
households/{householdId}/locations/{locationId}     # P2
households/{householdId}/items/{itemId}             # P2
households/{householdId}/placements/{placementId}   # P2
households/{householdId}/appliedOps/{opId}          # P3
```

- Pravilo čitanja zajedničkih podataka: `request.auth != null` **i** dokument članstva za `request.auth.uid` u tome kućanstvu postoji **i** ima `enabled == true`.
- Identifikator kućanstva unesen u frontend **nije** dokaz ovlaštenja.
- Članstvo i uloge upisuje/uređuje samo korisnik preko Firebase Console; **svi klijentski create/update/delete na `members` i promjenu uloga moraju biti odbijeni**. Svaki korisnik smije dohvatiti najviše svoj membership dokument ako je aktivan; popis članova nije potreban za P1.
- Ne postoji automatsko dodavanje Google računa u kućanstvo. Treći uspješno prijavljeni Google korisnik vidi „Nemaš pristup“ i ne čita inventar.
- `households/{h}` podaci u P1: samo čitanje za aktivnog člana; uređivanje kućanstva nije potrebno.
- P2/P3 kolekcije do zasebnog odobrenja ostaju **deny all** (osim eventualno namjenskih emulator-only testnih fixturea koji se ne smiju deployati).
- P1 sučelje nakon odjave ne prikazuje privatno predmemorirane podatke. Ako se web cache aktivira, testirati prelazak s ovlaštenog na neovlašten račun na istom uređaju.
- Security Rules su autoritet; ne oslanjati se na skrivanje gumba ili frontend whitelistu e-mailova.

## P1: implementirana pravila (`firestore.rules`)

- `get` na `households/{h}` i na vlastiti `members/{uid}` samo za aktivnog člana (`members/{auth.uid}` postoji i `enabled == true`, strogo boolean).
- Nema `list`, nema nijednog klijentskog `write`, nema catch-all pravila; `locations/items/placements/appliedOps` i nepoznate putanje = implicitno DENY.
- Onemogućeni član ne može čitati ni vlastiti membership. Brisanjem ili `enabled:false` članstva pristup se gubi pri sljedećem čitanju s poslužitelja.
- Pisanje članstva samo kroz Firebase Console (Admin zaobilazi pravila).
- Stvarni rezultati: `docs/P1_TEST_REPORT.md` (36 testova pravila PASS + provjera mutacijama).

### Sigurnosni nalazi P1

1. **Offline `getDoc` iz keša** moglo bi pokazati „odobren“ bez potvrde poslužitelja i preko odjave. Ispravljeno: `getDocFromServer`; pokriveno e2e testom E2E-9. Preostaje za P2 (vidi ARCHITECTURE).
2. Firebase web konfiguracija nije tajna; zaštita je isključivo u pravilima. Dev-only kuka za emulator nije u produkcijskom bundleu (provjereno pretragom `dist`).
3. Pravila nisu deployana; produkcijski deploy traži vlasnikovo odobrenje.
4. **P1-REV-01:** aktivni član smije `get` nepostojećeg household dokumenta (Rules to dopuštaju). Klijent to tretira kao `household-missing`, nikad kao odobren pristup. Pokriveno: unit regresija, test pravila i E2E-13.
5. **P1-REV-02:** opoziv tijekom otvorene sesije primjenjuje se pri revalidaciji (prvi plan / mreža / 10-min timer / ručno); do tada Rules već odbijaju svako novo čitanje s poslužitelja. Offline se prikaz označava nepotvrđenim. Pokriveno: E2E-11/12 i unit testovi.
6. Preostalo za P2/P3: lokalni keš među računima i razdvajanje offline pristupa od mrežne autorizacije (ARCHITECTURE).

## P1: minimalni negativni testovi (emulator)

1. Bez auth: odbijen zahtjev za `households/{h}` i `members/{uid}`.
2. Treći validni Firebase UID (nije član): odbijen.
3. Član s `enabled: false`: odbijen.
4. Dva aktivna UID-a istog kućanstva: mogu `get` istog `households/{h}`, svaki može dobiti vlastiti membership dokument.
5. Aktivni član `h1`: odbijen pristup `h2`.
6. Član: ne može čitati drugi membership niti listati članove.
7. Član: ne može dodati samoga sebe, dodati trećeg, promijeniti `role`, `enabled` ni obrisati članstvo.
8. Član: ne može pisati na `households/{h}`, `locations`, `items`, `placements`, `appliedOps` u P1.
9. Ne postoji široka rekurzivna allow iznimka. Nepoznate putanje su odbijene.
10. Nakon sign-out ili promjene računa: nema prikaza privatnih podataka kroz UI; emulator pravila i dalje odbijaju neovlašten pristup.

Emulator test mora eksplicitno učitati `firestore.rules`. Ako emulator ili Java nisu dostupni, **status je BLOKIRANO**, a ne PASS; bez dokaza nije dopušten deploy novih pravila.

## P2-A: pravila za inventar (implementirano u emulatoru, NIJE deployano)

Detalji i dokazi: `docs/P2_A_ADR.md`, `docs/P2_A_TEST_REPORT.md` (pravila sha256 `b998f2269754`). Sažetak:

- `locations`, `items`, `placements`, `meta/tree`: čitanje samo aktivnom članu; upis samo uz strogu shemu, `version + 1`, serverska vremena i `auth.uid`; bez tvrdog brisanja.
- Jedinstvenost smještaja kroz `placementKeys` (create/delete, nikad update); strukturne promjene stabla serijalizirane CAS-om na `meta/tree.rev`.
- `appliedOps` (P3) i sve nepoznato: DENY. Članstvo/kućanstvo: nepromijenjeno iz P1.
- **Odluke (revizija 2):** acikličnost je **ograničeno** provjerena na serveru (udaljenost ≤ 6) i Rules je NE jamče; potpunu provjeru lanca predaka u transakciji i detekciju oštećenog stabla mora imati P2-B (D1). Arhiviranje Location i Item je zabranjeno u pravilima (D2); `Location.kind` je nepromjenjiv, samo `root` je `house`, prostorije (`room`) smiju imati isključivo roditelja `root` i ne premještaju se (P2-LOC-ROOM-01). Opoziv članstva razlikuje se od konflikta (D5). Pravila (sha256 `d73cb80ba712`) se ne smiju deployati prije P2-B klijenta i odobrenja.

## P2-B: podaci na klijentu (implementirano u emulatorima, nije objavljeno)

Dokazi: `docs/P2_B_TEST_REPORT.md` §4–§6. Sažetak: izolirana podatkovna sesija po korisniku (memorijski keš, Auth bez perzistencije, uništava se pri odjavi/promjeni računa/opozivu); u Chromium IndexedDB-u nema Firestore keša ni tokena podatkovnih sesija; upisi samo online kroz transakcije (ESLint + test politike); opoziv ≠ konflikt (`access-revoked`); oštećeno stablo ⇒ bez prikaza podataka. Otvoreno: Android i produkcija NOT VERIFIED; opoziv bez promjene podataka oslanja se na revalidaciju iz P1.

## P2B-REV-04: atomarno stvaranje predmeta (izmjena pravila, nije deployana)

Pravila za stvaranje smještaja i ključa čitaju predmet kroz `getAfter()` (stanje nakon upisa), pa se Item, prvi Placement i ključ mogu stvoriti u jednoj transakciji. Sigurnosno je neutralno jer su `kind` i `archived` predmeta nepromjenjivi (D2). Jedinstvenost smještaja, limiti pristupa dokumentima i sve ranije invarijante ostaju (200 prethodnih testova prolazi nepromijenjeno). Pravila (sha256 `157feee0f7ca`) se moraju objaviti prije ili zajedno s aplikacijom; ništa nije objavljeno. Detalji: `docs/P2_B_TEST_REPORT.md` §8.

## Granice P3 (još nije implementirano)

Firestore lokalni cache podržava offline čitanje/upis, ali „last write wins“ nije dovoljan za istodobno premještanje predmeta. Online transakcija mora provjeriti `baseVersion`; `operationId` i ažuriranje trebaju atomsku idempotenciju. Sigurnosna pravila moraju posebno štititi reference i sistemska polja. Ovu logiku **ne implementirati u P1**.

## P4: Drive (još nije implementirano)

`drive.file` ograničava pristup datotekama; ne omogućuje drugom Google računu automatski privatni pristup. Dijeljenje i OAuth testirati zasebno.

Reference: https://firebase.google.com/docs/firestore/security/rules-conditions · https://firebase.google.com/docs/rules/unit-tests · https://firebase.google.com/docs/firestore/security/rules-query
