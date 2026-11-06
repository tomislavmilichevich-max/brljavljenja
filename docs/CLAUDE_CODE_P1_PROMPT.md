# PROMPT ZA CLAUDE CODE — HOME INVENTORY PWA / P1

Ti si implementator projekta **Kućni inventar PWA**. ChatGPT je funkcionalni arhitekt i reviewer, a vlasnik odobrava faze. UI/UX se radi u zasebnom razgovoru.

**Repozitorij:** `tomislavmilichevich-max/home-inventory-pwa` (Private).
**Temelj:** `main` nakon spajanja dokumentacijskog PR-a koji sadrži `docs/P1_HANDOFF.md`.
**Zadatak:** implementiraj **samo fazu P1** (Google Authentication + Firestore autorizacija članova kućanstva + sigurnosni testovi). Nemoj započeti P2.

## 1. Obavezno pročitaj prije prvog commita

- `CLAUDE.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/OWNER_ACTIONS.md`
- `docs/UI_UX_DECISIONS_V0.1.md`
- `docs/P1_HANDOFF.md`
- `docs/P1_ACCEPTANCE.md`
- `docs/PILOT_TEST_REPORT.md`

Ovo su mjerodavni dokumenti. Ako nešto nedostaje ili se proturječi, dokumentiraj odstupanje. Nemoj ga prešutno rješavati izmjenom funkcionalnih pravila.

## 2. Nezaobilazna ograničenja

- **0 € novih troškova**: Firebase Spark, bez kartice/Blaze, Cloud Functions, Firebase Storage, App Hosting ili drugih plaćenih servisa.
- **NE koristiti GitHub Actions** niti stvarati `.github/workflows`; GitHub Actions limit je potrošen. Testiraj u Claude Code okruženju.
- Samo dva ručno odobrena Google Auth UID-a smiju pristupiti istom kućanstvu. Prijavljen korisnik koji nije član mora dobiti jasnu poruku bez ikakvog pristupa privatnim podacima.
- Firestore Rules su deny-by-default, bez javnih iznimaka.
- Nikad ne upisuj tokene, ključeve, stvarne fotografije ili privatne podatke u repozitorij.
- Ne koristi stari javni repozitorij `brljavljenja`.
- **Ne implementiraj inventar, Item/Placement CRUD, offline red konflikata, Google Drive, NFC/QR/barcode, shopping listu ili konačni Organized Cozy UI.** To su iduće faze.

## 3. Zadatak

1. Pregledaj P0 i zabilježi početne rezultate `npm run check` i `npm run check:no-actions`.
2. Provjeri aktualnu službenu Firebase dokumentaciju i Spark kvote te dostupnost Jave i Firestore emulatora u svojem okruženju.
3. Kreiraj radnu granu za P1 iz ažurnog `main`.
4. Dodaj Firebase JS SDK, inicijalizaciju iz postojećeg konfiguracijskog predloška i Google prijavu/odjavu.
5. Implementiraj minimalne korisničke statuse: prijava, provjera pristupa, aktivni član, nema pristupa, mrežna greška. Neodobreni korisnik može kopirati svoj UID za ručni upis u članstvo.
6. Definiraj `households/{h}` i `households/{h}/members/{uid}`. Pristup samo aktivnom članu kućanstva; `members` ne smije dopuštati nikakav klijentski write. Sve buduće kolekcije ostaju nedostupne u P1.
7. Napiši i izvrši sve pozitivne i negativne testove iz `docs/P1_ACCEPTANCE.md` uz `@firebase/rules-unit-testing` i Firestore emulator. Pravilima mora upravljati stvarni `firestore.rules`, ne mock umjesto pravila.
8. Testiraj i dokumentiraj odjavu, neodobreni račun, offline/error stanja i P0 regresiju. Ne tvrdi da je proveden stvarni Android test dok vlasnik to ne napravi.
9. Ažuriraj `docs/OWNER_ACTIONS.md` točnim koracima koji se moraju obaviti ručno na Android tabletu, bez predaje korisničkih tajni.
10. Izradi `docs/P1_TEST_REPORT.md`: provedeno, promijenjene datoteke, točne naredbe i rezultati, negativni testovi, rizici, otvorene prepreke, ručne radnje vlasnika.

## 4. Postupak rada

- Modularan, čitljiv TypeScript/React kod; bez nepotrebnih paketa.
- Ne implementiraj produkcijski deploy, ne mijenjaj billing, ne mergeaj samostalno.
- Napravi razumljive commitove u zasebnoj grani i pripremi PR na `main`.
- Ako Java, emulator ili Firebase pristup nisu dostupni, jasno prijavi **BLOCKED / NOT VERIFIED** umjesto lažnog PASS.
- Za P1 završetak tražim stvarne rezultate: `npm run check`, `npm run check:no-actions`, emulator testovi, provjera sadržaja PR-a i odsutnosti osjetljivih podataka.
- U završnom izvještaju jasno razdvoji **implementirano**, **provjereno lokalno**, **nije provjereno na stvarnim Androidima**, **radnje vlasnika** i **rizike**.

**Zaustavi se nakon P1. Ne započinji P2 niti odobreni UI/UX dizajn bez novog zadatka.**
