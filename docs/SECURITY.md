# SECURITY

## Stanje u P0

- Nema autentikacije ni podataka. `firestore.rules` je **deny all** (nijedan klijent ne može čitati/pisati).
- Repozitorij ne sadrži tajne; `.gitignore` blokira `.env*` (osim `.env.example`), ključeve, servisne račune, `client_secret*.json`.
- Nema `.github/workflows` (provjera: `npm run check:no-actions`).
- Provedeni testovi sigurnosnih pravila: **nema** (pravila još ne postoje; P1).

## Plan (P1) — Firestore ACL

Deny by default; pristup samo za `request.auth.uid` s dokumentom `households/{h}/members/{uid}` gdje `enabled == true`.
Članovi se upisuju isključivo ručno (Firebase Console) — klijent ne smije kreirati/mijenjati `members`, role ni owner polja, ni brisati masovno.
Testovi u Firebase Emulator Suite (zahtijeva Java za Firestore emulator — dostupnost u cloud okruženju još **nije provjerena**).

## Plan (P4) — Google Drive preduvjeti

- Scope `drive.file` (najmanje ovlasti; pristup samo datotekama koje je app stvorila ili korisnik odabrao Pickerom). Ne `appDataFolder` kao zajednički prostor.
- Dva korisnika s dva računa: datoteka stvorena jednim računom nije automatski vidljiva drugom; dijeljenje i/ili Picker treba stvarno testirati — **neprovjereno**.
- OAuth consent screen u „Testing“ načinu zahtijeva dodavanje oba računa kao test korisnika; ponašanje isteka tokena u tom načinu treba provjeriti u P4.
- Tokeni se drže samo u memoriji/sesiji preglednika, nikad u repozitoriju.
