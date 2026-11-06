# ARCHITECTURE

Status: **P0 implementiran samo kao okvir.** Sve ispod „Plan“ je planirano, ne implementirano.

## Implementirano (P0)

- Vite + React + TS (strict) PWA kostur, `manifest.webmanifest`, service worker (app shell cache).
- Čitanje javne Firebase konfiguracije iz `VITE_*` varijabli (`src/config/env.ts`), bez Firebase SDK-a.
- `firebase.json` (Hosting + Firestore + emulatori), `firestore.rules` = **deny all**.

## Plan (prema handoffu §3–§5; NIJE implementirano)

- `households/{h}`, `members/{uid}`, `locations/{id}` (`parentId`, `version`), `items/{id}` (`currentLocationId`, `version`).
- Firestore je jedini autoritativni zapis. Premještanje = **uvjetna transakcija** na serveru: `baseVersion` mora odgovarati
  trenutnoj verziji, inače sukob. Idempotencija: dokument `households/{h}/appliedOps/{operationId}` pišu se **u istoj transakciji**
  (bez Cloud Functions). Lokalni red namjera u IndexedDB (`operationId, baseVersion, targetLocationId, createdAt, actorUid`), slanje redom.
- Statusi: `lokalno spremljeno → čeka prijenos → sinkronizirano | sukob | greška`.
- Pretraga lokalno nad predmemoriranim podacima.

## Tehnički nalazi i odstupanja

1. **Ime repozitorija:** razvoj je preseljen iz `brljavljenja` u `-home-inventory-pwa` (ime počinje crticom, vjerojatno nenamjerno). `package.json` name je `home-inventory-pwa`. Preimenovanje je odluka vlasnika.
2. **TypeScript 6.0.3 umjesto 7.0.2**: `typescript-eslint@8.72.1` deklarira peer `typescript <6.1.0`.
3. **Bez `vite-plugin-pwa`**: minimalni vlastiti plugin (≈50 linija, testiran) smanjuje ovisnosti i kompatibilnost s Viteom 8 se ne treba pretpostavljati.
4. **Kontradikcija u handoffu (za odluku funkcionalne arhitekture):** §4 traži da se `appliedOps` mehanizam izvede unutar Firestore transakcije, a §2 traži
   offline red. Firestore transakcije **ne rade offline** pa konflikt-provjera nužno ide tek pri povezivanju; ovo je očekivano i već tako opisano u handoffu — samo potvrđujem da offline korisnik vidi isključivo „čeka prijenos“.
5. **Rizik: Firestore SDK offline cache i transakcije.** `runTransaction` zahtijeva mrežu; red namjera mora sam hendlati ponovno pokušavanje i prikaz statusa (P3).
6. **Rizik: Spark kvote** (Firestore dnevne kvote čitanja/pisanja) — iznose treba potvrditi u aktualnoj dokumentaciji prije P1; u P0 nisu provjereni.
7. **Rizik: Firebase Auth + PWA na Androidu** — `signInWithPopup` može biti nepouzdan u instaliranom PWA-u; vjerojatno `signInWithRedirect` uz `authDomain` konfiguraciju. Treba probati na stvarnom uređaju u P1.

## Faze

P0 repo/okvir (ovo) · P1 Auth + ACL + rules testovi · P2 demo inventar + pretraga · P3 red namjera + sukobi · P4 Drive spike · P5 Hosting + izvještaj.
