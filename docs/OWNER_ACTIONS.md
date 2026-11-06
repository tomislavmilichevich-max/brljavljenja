# OWNER_ACTIONS — ručne radnje korisnika na Android tabletu

Ažurirano: 2026-11-06. Ne slati tokene, servisne račune, tajne ili stvarne fotografije u chat.

## Stanje repozitorija

- **Aktivno:** `tomislavmilichevich-max/home-inventory-pwa`, Private, `main`; P0 je prenesen.
- **Staro:** `tomislavmilichevich-max/brljavljenja`, još javno u trenutku provjere. Nakon kontrole da ništa ne nedostaje, korisnik može odlučiti želi li ga ukloniti ili staviti na Private. Nije dio aktivnog rada.
- P0 **ne zahtijeva PR**; već je na `main`. Ovaj dokumentacijski paket dolazi kao zaseban PR za pregled.
- Ne pokretati GitHub Actions dok je limit potrošen.

## P1.5 — Objava na Firebase Hosting i test na dva Androida (korak po korak)

Ažurirano za P1.5. Koraci 1–4 starog P1 popisa (projekt, Google prijava, Firestore, `households/kuca1`) su već obavljeni; ispod je ono što slijedi. Nazivi izbornika u Firebase Console / Google Cloud mogu se malo razlikovati od onoga što piše ovdje; ako nešto ne nalaziš, javi što vidiš na ekranu.

**Zašto ne objavljujem ja:** Claude Code cloud okruženje nema autorizirani Firebase pristup (`firebase login:list` → „No authorized accounts“). Jedini legitimni načini bili bi lijepljenje autorizacijskog koda/tokena u chat ili servisni ključ u repozitorij — oboje je zabranjeno. Zato objavu pokrećeš ti u **Google Cloud Shellu** (terminal u pregledniku, besplatan, već prijavljen tvojim Google računom). _Napomena: Cloud Shell nisam mogao isprobati iz svog okruženja, pa je to NOT VERIFIED._

### A. Priprema (ništa se ne objavljuje; možeš odmah)

1. **Tri javne vrijednosti iz Console.** Firebase Console → projekt `home-inventory-pwa-218be` → zupčanik → _Project settings_ → _General_ → dolje _Your apps_ → tvoja web aplikacija → _SDK setup and configuration_ → _Config_. Trebaju ti `apiKey`, `messagingSenderId`, `appId`. (Nisu tajne, ali ih ne trebaš slati u chat.)
2. **Autorizirane domene.** Console → _Authentication_ → _Settings_ → _Authorized domains_. Provjeri da postoji `home-inventory-pwa-218be.firebaseapp.com` (obično je zadano). Ako ne, _Add domain_.
3. **Provjeri plan.** Console → lijevo dolje treba pisati **Spark** (ne Blaze). Ne klikaj _Upgrade_. Ne dodaj karticu.
4. **Provjeri dokument.** _Firestore Database_ → _Data_ → `households` → `kuca1` ima polja `name` (string) i `schemaVersion` (number) `1`. Članova (`members`) još nema, to je ispravno.
5. **Otvori Cloud Shell:** u Chromeu otvori <https://shell.cloud.google.com>, prijavi se **istim Google računom koji je vlasnik Firebase projekta**, prihvati uvjete (_Authorize_ / _Continue_). Ako traži kreiranje Cloud projekta ili karticu, **stani** i javi mi.
6. **Preuzmi kod** (u terminalu Cloud Shella; dugi pritisak za _Paste_):
   ```bash
   gh auth login        # GitHub.com → HTTPS → Login with a web browser; prepiši kratki kod na github.com/login/device
   gh repo clone tomislavmilichevich-max/home-inventory-pwa
   cd home-inventory-pwa
   git checkout p1-5/firebase-hosting-readiness   # dok PR za P1.5 nije spojen u main; nakon spajanja: git checkout main && git pull
   node -v                 # mora biti 20.19 ili noviji; ako nije: nvm install 22 && nvm use 22
   npm ci
   ```
   (Ako `gh` nije dostupan: `git clone https://github.com/tomislavmilichevich-max/home-inventory-pwa`, pa korisničko ime i GitHub _personal access token_ kao lozinku — token upisuješ samo ovdje u Cloud Shell, nikad u chat.)
7. **Konfiguracija (ne ide u Git).** Zamijeni tri `...` svojim vrijednostima iz koraka 1 i zalijepi cijeli blok:
   ```bash
   cat > .env.production.local <<'EOF'
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=home-inventory-pwa-218be.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=home-inventory-pwa-218be
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   VITE_HOUSEHOLD_ID=kuca1
   EOF
   git status --short     # .env.production.local NE smije biti na popisu (ignoriran je)
   ```
8. **Probni build i provjere (još uvijek bez objave):**
   ```bash
   npm run guard:rules    # provjera pravila
   npm run build:prod     # provjera konfiguracije → build → provjera dist-a; ispisuje TOČAN popis datoteka koje bi se objavile
   ```
   Ako ijedna provjera javi „ZAUSTAVLJENO“, **ne nastavljaj** nego mi pošalji ispis (bez ključeva).
9. **Prijava firebase alata** (u Cloud Shellu):
   ```bash
   npx firebase login --no-localhost
   ```
   Otvori ispisani link u pregledniku, prijavi se i odobri, a dobiveni kod zalijepi **natrag u terminal Cloud Shella** (ne u chat). Zatim `npx firebase projects:list` mora prikazati `home-inventory-pwa-218be`.

### B. Objava — TEK nakon mog prikaza i tvog izričitog odobrenja u chatu

Prvo pravila, zatim Hosting; svaka naredba ima fiksni projekt i `--only` (nema generičkog `firebase deploy`):

```bash
npm run deploy:rules      # guard:rules → firebase deploy --only firestore:rules --project home-inventory-pwa-218be
npm run deploy:hosting    # build:prod (sve provjere) → firebase deploy --only hosting --project home-inventory-pwa-218be
```

Provjera: `curl -sI https://home-inventory-pwa-218be.firebaseapp.com/ | head -5` treba vratiti `HTTP/2 200`.
**Povrat (ako nešto pođe po zlu):** Console → _Hosting_ → _Release history_ → uz prethodno izdanje _Rollback_; pravila: vrati sadržaj deny-all (`allow read, write: if false;`) u Console → _Firestore_ → _Rules_ → _Publish_.

### C. Testiranje na Androidima

Vodi bilješke (datum, uređaj, što si vidio); rezultati idu u `docs/P1_5_TEST_REPORT.md` tek kad ih ti potvrdiš.

1. **Uređaj A, Chrome:** otvori `https://home-inventory-pwa-218be.firebaseapp.com`. Treba se pojaviti ekran **Prijava**. Pritisni _Prijava Google računom_, odaberi račun, odobri. Posebno zabilježi što se događa pri **povratku iz Google prozora** (vrati li te u aplikaciju ili ostaneš na praznoj stranici).
2. Očekuješ **„Nemaš pristup“** i polje **„Tvoj UID“**. Pritisni _Kopiraj UID_ (ili označi i kopiraj). UID se vidi i u Console → _Authentication_ → _Users_. Ne šalji ga u chat.
3. **Ručno odobrenje (Console):** _Firestore Database_ → _Data_ → `households` → `kuca1` → _Start collection_ (ako `members` ne postoji) → Collection ID `members` → Document ID = **zalijepljeni UID uređaja A** → polja:

   | Polje     | Tip         | Vrijednost |
   | --------- | ----------- | ---------- |
   | `uid`     | string      | isti UID   |
   | `role`    | string      | `member`   |
   | `enabled` | **boolean** | `true`     |

   _Save_. (`enabled` mora biti boolean, ne string.)

4. Na uređaju A pritisni **Provjeri ponovno** → očekuješ **„Pristup odobren“**, naziv kućanstva i „Pristup potvrđen sa servera u HH:MM“.
5. **Uređaj B** (drugi Google račun): isto — prije odobrenja „Nemaš pristup“; zatim dodaj `members/{UID-B}` kao u koraku 3; „Provjeri ponovno“ → odobreno.
6. **Treći račun** (ako ga imaš): prijava smije uspjeti, ali mora ostati „Nemaš pristup“. Ako ga nemaš, upiši NOT VERIFIED.
7. **Opoziv:** u Console postavi `members/{UID-B}` → `enabled` = **false** (boolean). Na uređaju B pritisni _Provjeri pristup_ (ili pređi u drugu aplikaciju i vrati se, najkasnije ≈10 min) → treba „Nemaš pristup“. Uređaj A mora zadržati pristup. Zatim vrati `enabled` = true.
8. **Instalacija PWA:** u Chromeu na uređaju A izbornik ⋮ → _Install app_ / _Dodaj na početni zaslon_. Otvori instaliranu aplikaciju s početnog zaslona, odjavi se i ponovno prijavi (redirect/popup i povratak u aplikaciju). Isto na uređaju B.
9. **Bez veze:** uključi način rada u zrakoplovu na uređaju A dok je aplikacija otvorena, pa je zatvori i ponovno otvori. Ljuska aplikacije se mora otvoriti, ali **ne smije** pisati da je pristup svježe potvrđen (vidjet ćeš upozorenje o nepotvrđenom pristupu ili grešku veze). Ovo NIJE test offline pretrage (to je P2/P3).
10. **Spark / trošak:** Console → lijevo dolje i _Usage and billing_ — treba i dalje pisati **Spark**; zabilježi _Usage_ za Firestore i Hosting.

Ako bilo što od 1–10 ne uspije, **ne pokušavaj zaobilaziti** (ne mijenjaj pravila ručno, ne uključuj plaćene usluge). Zabilježi točan tekst poruke i javi mi.

---

## P1: precizni koraci za Android tablet (Chrome, stranica „Desktop site“ za Firebase Console)

> **Zamijenjeno za P1.5 (vidi gore).** Koraci 1–4 su obavljeni; korak 5 (varijable u Claude Code okruženju) više se ne koristi jer objavu radi vlasnik u Cloud Shellu s `.env.production.local`; korake 7–12 zamjenjuje odjeljak P1.5 A–C.

Redom; ništa od ovoga ne zahtijeva karticu. **Ne slati UID-ove ni konfiguraciju u chat osim ako Claude izričito zatraži.**

1. **Projekt:** console.firebase.google.com → _Add project_ → naziv po želji → _Google Analytics: isključi_ → Create. Plan mora ostati **Spark** (ne kliknuti _Upgrade_).
2. **Prijava:** _Build → Authentication → Get started → Sign-in method → Google → Enable_ → odaberi support e-mail → Save.
3. **Firestore:** _Build → Firestore Database → Create database_ → **Standard edition**, lokacija po izboru (ne mijenja se kasnije) → **Production mode** → Create. Ne dirati _Rules_ (deploy radimo tek uz odobrenje).
4. **Web aplikacija:** _Project settings (zupčanik) → General → Your apps → Web (</>)_ → nadimak → **bez** „Firebase Hosting“ kvačice → Register. Kopiraj 6 vrijednosti `firebaseConfig`.
5. **Konfiguracija u okruženje (ne u GitHub):** u Claude Code cloud okruženju postavi varijable okruženja `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` i `VITE_HOUSEHOLD_ID` (npr. `kuca1`). Vrijednosti nisu tajne, ali ih se ne commita.
6. **Autorizirane domene:** _Authentication → Settings → Authorized domains_ — dodaj domenu na kojoj će PWA biti objavljena (`<projekt>.web.app` i `<projekt>.firebaseapp.com` su obično već unutra). Bez toga Google prijava na toj domeni ne radi.
7. **Prva prijava:** oba korisnika otvore objavljenu aplikaciju i prijave se (vidjet će „Nemaš pristup“ i svoj UID). _Napomena:_ stvarnu prijavu moguće je isprobati tek na objavljenoj domeni (P5 deploy uz tvoje odobrenje); lokalno u cloud okruženju to nije moguće.
8. **UID-ovi:** _Authentication → Users → stupac User UID_ (ili kopiraj gumbom „Kopiraj UID“ u aplikaciji).
9. **Kućanstvo (Console zapis zaobilazi pravila — samo ti):** _Firestore Database → Data → Start collection_ → Collection ID `households` → Document ID = tvoj `VITE_HOUSEHOLD_ID` → polja: `name` (string), `schemaVersion` (number) `1` → Save.
10. **Članovi:** otvori taj dokument → _Add collection_ → ID `members` → Document ID = **UID prvog korisnika** → polja: `uid` (string, isti UID), `role` (string) `member`, `enabled` (**boolean**) `true` → Save. Ponovi za drugog korisnika. Polje `enabled` mora biti boolean, ne string „true“.
    11a. Ako korisnik vidi „Tvoje članstvo postoji, ali dokument kućanstva nije postavljen“, nedostaje dokument `households/{id}` (korak 9) — pristup NIJE odobren dok se ne stvori.
11. **Provjera:** korisnik na „Nemaš pristup“ pritisne _Provjeri ponovno_ → treba vidjeti „Pristup odobren“ i naziv kućanstva. **Opoziv:** promijeni `enabled` na `false` ili obriši člana. Otvorena aplikacija to primijeti pri povratku u prvi plan, kad se veza vrati, najkasnije nakon ≈10 min, ili pritiskom na „Provjeri pristup“; zatim prikazuje „Nemaš pristup“.
12. Pravila: **ne deployati** sam. Kad odobriš, deploy radi samo `firestore.rules` (Spark, bez Blaze).

Starije općenite korake zadržavamo ispod za referencu.

## Stari opći koraci (referenca)

1. Otvori https://console.firebase.google.com/ i izradi projekt s **Spark** (besplatnim) planom, **bez kartice / povezivanja billing računa**. Google Analytics nije potreban.
2. Dodaj Web App u Project Settings. Postavi Google Authentication provider u Authentication → Sign-in method.
3. U Firestore Database stvori **jednu** standardnu bazu u production mode. Nema otvorenih pravila; izvorna P0 pravila ostaju deny-all do pregledanih i testiranih P1 pravila. Lokaciju baze odaberi pažljivo, ne treba je kasnije mijenjati.
4. Kopiraj javnu Firebase web konfiguraciju u lokalno/privatno `.env.local`, ne u GitHub. Konfiguracija sama nije tajna; prava daju Security Rules.
5. Za pilot odredi identifikator jednog kućanstva (`householdId`). Isti se koristi u aplikaciji i putanjama dokumenata.
6. Nakon prve uspješne Google prijave oba korisnika, njihove Firebase Auth UID-ove pronađi u Authentication → Users. **Nemoj ih slati u chat** ako nije potrebno.
7. Samo vlasnik kroz Firebase Console kreira `households/{householdId}` i dva `households/{householdId}/members/{uid}` dokumenta s `enabled: true` i `role: "member"` prema provjerenoj P1 uputi. Ne postoji javni poziv ili klijentska opcija „sam se pridruži“.
8. Prije bilo kakvog stvarnog deploya provjeri sigurnosna pravila i provedi emulator testove. Za P1 nije odobren produkcijski deploy bez posebnog odobrenja.

**Bitan test autentikacije:** pokušati Google login na oba Androida, uključujući instaliranu PWA kad bude dostupna, i provjeriti povratak iz Google prijave. Za besplatnu Firebase Hosting `firebaseapp.com` domenu preferirati identičan origin aplikacije i `authDomain`, ili slijediti službene redirect smjernice.

## P1: što korisnik ne treba raditi

- Ne unositi podatke inventara niti stvarne fotografije.
- Ne uključivati Cloud Functions, Cloud Storage for Firebase, App Hosting, plaćene API-je ili billing.
- Ne kreirati GitHub Actions workflow.
- Ne dijeliti osobne OAuth tokene ni servisne ključeve s Claudeom / ChatGPT-om.
- Ne ručno mijenjati Firestore pravila u produkciji mimo reviewa.

## P4: Google Drive (kasnije, ne u P1)

1. U istom Google Cloud projektu omogućiti Google Drive API; prvo verificirati kvote i OAuth uvjete.
2. Koristiti najmanji potreban scope (plan: `drive.file`). Ne koristiti zajednički `appDataFolder` kao običnu mapu.
3. Privatna pohrana fotografija + dijeljenje za oba računa mora biti provjereno; to nije automatsko.
4. OAuth testing status i trajanje tokena testirati. Ne činiti datoteke javnima.

## P5: objava (kasnije)

Samo uz odobrenje vlasnika: izravni Firebase Hosting deploy s potrebnim, testiranim Firestore pravilima. Nema GitHub Actions ni Blaze plana.

Službene reference: https://firebase.google.com/pricing · https://firebase.google.com/docs/auth/web/redirect-best-practices
