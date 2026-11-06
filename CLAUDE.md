# CLAUDE.md — trajna pravila projekta Kućni inventar PWA

Ažurirano: 2026-11-06. Ovaj dokument određuje granice implementacije. Ne mijenjati bez vlasnikova odobrenja.

## Identitet i zaduženja

- **Aktivni privatni GitHub repozitorij:** `tomislavmilichevich-max/home-inventory-pwa`; ciljna grana `main`.
- Stari javni `brljavljenja` nije izvor za razvoj niti se u njega smije pushati.
- ChatGPT (glavni razvoj): poslovna pravila, arhitektura, P1–P5 handoff, revizija.
- ChatGPT (zaseban razgovor): UI/UX prototip i dizajnerski handoff.
- **Claude Code**: implementacija i provedivi testovi; **vlasnik**: odobrenje i fizičko Android testiranje.

## Funkcionalni identitet

- **Primarno:** u nekoliko sekundi pronaći gdje se nalazi predmet.
- Lokacije su hijerarhijske, s proizvoljnom dubinom.
- Item i Placement su odvojeni: isti Item može biti na više fizičkih lokacija.
- Obavezan unos predmeta: naziv i lokacija; količine/fotografije/sinonimi neobavezni.
- V0.2: NFC, QR, EAN/barkod. V0.3: potrošne zalihe i zajednički popis kupnje.
- Odobren je vizualni stil **C — Organized Cozy** (krem, bijele kartice, kadulja zelena, pastelna plava i koraljna; Manrope/Inter; svijetla tema). Donja navigacija: **Početna | Lokacije | + | Popis | Više**. `docs/UI_UX_DECISIONS_V0.1.md` je izvor. Ne implementirati konačni dizajn bez odobrenog interaktivnog prototipa. Prikazane ideje nisu automatski nove funkcionalnosti.

## Tvrda ograničenja

1. **0 € novih troškova** za softver, hosting, bazu, API i korištenje. Samo Firebase **Spark**, bez kartice/Blaze. Fizičke NFC/QR oznake mogu biti jeftin jednokratan dodatak izvan softverskog budžeta.
2. **Nikad** Cloud Functions, Firebase Storage, Firebase App Hosting, plaćeni API, vlastiti plaćeni backend ili billing.
3. **Nema GitHub Actions**: ne stvarati ni pokretati `.github/workflows/*`, testove izvršavati u Claude Code okruženju; `npm run check:no-actions`.
4. **Nikad u repozitorij**: OAuth tokeni, client secret, servisni računi, privatni ključevi, stvarne fotografije kuće ili stvarni inventar.
5. Firestore Security Rules **deny by default**, bez javno otvorenih pravila, ni privremeno.
6. Ne izmišljati rezultate testova. Razdvojiti PASS, FAIL, BLOCKED i NOT VERIFIED.
7. Bez neodobrenih funkcionalnih promjena ili proširenja faze.

## Trenutačno: P0 završen; P1 se provodi zasebno

- P0 je kostur bez Firebase SDK-a i autentikacije. P0 ne predstavlja dokaz da rade inventar, online sinkronizacija, dva računa ili Drive.
- P1 dokument: `docs/P1_HANDOFF.md`, testovi: `docs/P1_ACCEPTANCE.md`.
- P1 = Google Auth, strogi Firestore ACL za dva ručno ovlaštena UID-a, emulator testovi i minimalni pilot UI.
- P1 **ne smije** implementirati Item/Placement CRUD, pretragu, offline red konflikata, fotografije, NFC/QR, shopping listu ili konačni UI.
- Sigurnosna pravila za buduće kolekcije ostaju deny-all do sljedeće faze.
- Ne deployati ni mergeati bez izričitog odobrenja. Koristiti zasebnu granu i PR.

## Kontrolni postupak

1. Pročitaj `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/OWNER_ACTIONS.md`, `docs/UI_UX_DECISIONS_V0.1.md`, i fazni handoff.
2. Prema potrebi provjeri aktualne službene Firebase dokumente prije implementacije.
3. Prije commita pokreni `npm run check` i `npm run check:no-actions`. Za P1 dodatno Firestore emulator rules testove.
4. Napiši izvještaj s točnim izlazima testova, commitovima, promjenama i ručnim koracima za vlasnika.
5. **Zaustavi se nakon odobrene faze.** P2 ne počinje automatski.

Stack P0: Vite + React + TypeScript strict; namjerno TypeScript ~6.0 radi kompatibilnosti lint alata.
