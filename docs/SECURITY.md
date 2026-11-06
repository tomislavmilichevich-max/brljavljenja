# SECURITY — Kućni inventar

Status: P0 je samo siguran kostur. P1 tek treba implementirati. Ažurirano: 2026-11-06.

## Obavezne granice

- Privatni repozitorij `home-inventory-pwa` (GitHub). Privatnost repozitorija **nije zamjena za** autentifikaciju i Firestore Security Rules.
- Nema privatnih ključeva, servisnih računa, OAuth tokena, Google Drive datoteka ni privatnih fotografija u kodu/repozitoriju.
- `firestore.rules` u P0 = `allow read, write: if false`; mijenjati tek u P1 uz provjerene testove.
- Bez Firebase Blaze/Cloud Functions/Storage i bez GitHub Actions.

## P1: model pristupa (odobreno)

Jedno kućanstvo, dva *ovlaštena* korisnika s odvojenim Firebase Google Auth računima. Autentikacija nije isto što i autorizacija.

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

## Granice P3 (još nije implementirano)

Firestore lokalni cache podržava offline čitanje/upis, ali „last write wins“ nije dovoljan za istodobno premještanje predmeta. Online transakcija mora provjeriti `baseVersion`; `operationId` i ažuriranje trebaju atomsku idempotenciju. Sigurnosna pravila moraju posebno štititi reference i sistemska polja. Ovu logiku **ne implementirati u P1**.

## P4: Drive (još nije implementirano)

`drive.file` ograničava pristup datotekama; ne omogućuje drugom Google računu automatski privatni pristup. Dijeljenje i OAuth testirati zasebno.

Reference: https://firebase.google.com/docs/firestore/security/rules-conditions · https://firebase.google.com/docs/rules/unit-tests · https://firebase.google.com/docs/firestore/security/rules-query
