# P2 — KUĆNI INVENTAR: FUNKCIONALNA I TEHNIČKA SPECIFIKACIJA

**Verzija:** P2-HO-01 · **Datum:** 2026-11-07 · **Status:** ZA PREGLED, nije nalog za implementaciju.
Aktivni privatni repozitorij: `tomislavmilichevich-max/home-inventory-pwa`, grana `main` nakon spajanja ovog dokumentacijskog PR-a.

## 0. Ulazi i stvarno stanje

- P0/P1 spojeni; P1.5 Firebase Hosting + Google prijava na dva fizička Android uređaja, članstvo oba računa i opoziv/pristup **potvrđeni od vlasnika**. Vlasnik navodi i uspješnu instalaciju/offline otvaranje te Spark plan. Zadržati status testova kao korisnički potvrđen, ne pripisivati ih Claudeu.
- Projekt `home-inventory-pwa-218be` (Spark), postojeće produkcijsko kućanstvo `households/kuca1`. **Nema stvarnog inventara ni demo podataka u tom kućanstvu.**
- Originalni UI/UX `Kucni_inventar_UIUX_v0.3.2_ZAVRSNI_za_glavni_razvoj.zip` dobavljen vlasniku u ChatGPT razgovoru. Preporučene odluke i nalazi u `docs/UI_UX_REVIEW_V0.3.2.md` na dokumentacijskoj grani PR #3; dizajnerski PR je draft dok ga vlasnik ne odobri. HTML prototip nije produkcijski izvor istine.
- Odobreni **vizualni smjer** Organized Cozy: krem/bež svijetla tema, bijele kartice, kadulja akcije, plavo/koraljno, Manrope/Inter. Navigacija Početna | Lokacije | + | Popis | Više. NEMA automatskog odobrenja funkcionalnosti prikazanih u ilustracijama.
- Uloge: glavni razvoj specifikacija/revizija; UI/UX razgovor završni vizualni handoff; Claude Code implementira; vlasnik testira/prihvaća.

## 1. Svrha i granice P2

**Svrha:** dva ovlaštena korisnika mogu ONLINE pronaći fizičku lokaciju evidentiranog predmeta, pregledati sadržaj lokacije, dodati/urediti, premjestiti pojedinačni smještaj i cijelu fizičku kutiju/lokaciju.

**P2 ISPORUČUJE**
1. Stablo lokacija neograničene poslovne dubine; stvarni naziv/podlokacije unosivi u UI; zaštita od ciklusa.
2. `Item` (što) odvojen od `Placement` (gdje), više smještaja iste vrste, ali samo jedan Placement iste vrste na istoj lokaciji.
3. Pregled inventara, izravnog i potomka sadržaja; brojači različitih Item ID-ova.
4. Lokalna pretraga nad već dohvaćenim podacima (ne zahtjev prema serveru po znaku), hrvatska normalizacija, sinonimi, višerječni mali tipfeleri, rangiranje; prikaz svih lokacija istoga Itema.
5. Kreiranje, uređivanje naziva/napomene/kategorije, dodavanje smještaja, premještanje samo odabranog smještaja i cijele podlokacije; obvezni samo naziv i lokacija pri dodavanju predmeta.
6. Zaštita nespremljenih izmjena UX-032-01, jasne uspjeh/pogreška/pending poruke i UX brzo premještanje.
7. Kontroliran online Firestore CRUD i stvarno testirana prava čitanja/upisa za **dva** ovlaštena UID-a.
8. Testni inventar samo u izoliranom emulatoru: `docs/fixtures/P2_DEMO_HOUSE.json`.

**P2 NE ISPORUČUJE:** offline zapisivanje, trajni lokalni red, automatsko rješavanje konflikata, background sync, offline-only pretragu nakon restarta, server-level Undo/audit-log, Drive fotografije, NFC/QR/EAN, točne količine/„Pri kraju“, popis kupnje, favorite, dokumente, statistiku ni druge opcije s ilustracija. **P3** pokriva pouzdanu offline/online sinkronizaciju i povijest/Undo; **P4** Drive; **v0.2** skeniranje; **v0.3** zalihe/kupnju.

## 2. MODEL — ugovor, ne pretpostavljati jedno currentLocationId

```
households/{householdId}
  members/{uid}                      # postojeći P1; klijenti ih ne mogu pisati
  locations/{locationId}
  items/{itemId}
  placements/{placementId}
  # appliedOps/{opId} = ISKLJUČIVO P3 (nije dio P2)
```

### Location
- `id` nepromjenjiv doc ID, UUID ili kompatibilan stabilan ID.
- `name`: ne-prazan trimmed string; `parentId`: `null` samo za **jedan logički root** ili stvarno nadređeni ID; `kind` npr. `house | room | cabinet | shelf | box | drawer | other` (primjeri, ne ograničavaju podlokacije).
- `createdAt`, `updatedAt`, `version` (brojač za online concurrency), `archived` (zadano false) i po potrebi `createdBy/updatedBy` uz provjeru UID-a.
- Putanja se izvodi iz roditeljskih ID-ova u memoriji. **Ne pohranjuj kanonski tekstualni path kao izvor istine.** Promjena naziva/roditelja ne prepisuje potomke.
- Točno jedan aktivan root u jednom kućanstvu. Prostorije su djeca root-a i u v0.1 nemaju radnju „Premjesti cijelu prostoriju“; kutije/police/ormari mogu se premještati unutar kuće.
- `parentId` ne smije referencirati sebe ili potomka; svaka ciljna nadređena lokacija mora postojati, biti aktivna i pripadati istom household-u.
- Ne briši/archiviraj lokaciju s aktivnim potomcima ili Placementima: prvo premjesti sadržaj ili ponudi čitljivu blokadu; bez automatskog kaskadnog brisanja.

### Item
- `id`: stabilni ID; `name` obavezan; `aliases` string[] neobavezan; `category` i `note` neobavezni; `kind` = `unique | type` s jasno opisanom semantikom (jedinstveni predmet vs vrsta, npr. AA baterije).
- `createdAt`, `updatedAt`, `version`, `archived`; reference fotografija nisu obavezne (P4).
- **Edit ne smije imati polje za promjenu fizičke lokacije**. Samo Move mijenja Placement.
- Za `unique` najviše jedan aktivni Placement; za `type` može ih biti više, ali ne više njih na istoj lokaciji.
- Arhiviranje Itema ne smije „sakriti“ aktivne smještaje: traži uklanjanje/arhiviranje smještaja kontrolirano, bez gubitka drugih zapisa. U P2 nema tvrdog brisanja.

### Placement
- `id` stabilan nepromjenjivi ID odvojen od `itemId` i `locationId`; `itemId`, `locationId`, `version`, `createdAt`, `updatedAt`, `archived`; količina je rezervirana za kasnije i ne mora imati UI.
- **Preporuka za P2 tehničku odluku:** osigurati da su (itemId,locationId) jedinstveni preko determinističkog indeksa / transakcije ili drugog serverom provjerljivog mehanizma. Samo klijentski `query` za duplikate nije dovoljan kod utrke dvaju korisnika. Ako Cloud Firestore Rules ne mogu potpuno garantirati ovaj uvjet za odabranu shemu, Claude mora prije implementacije ponuditi dokaz i konzistentnu alternativu. *Ne obećavati jedinstvenost bez testiranih invarijanti*.
- Premještanje jednog Placementa mijenja samo njegov `locationId`, uz kontrolu verzije i mogućeg duplikata; ostali Placementi istoga Itema ostaju netaknuti.
- „Premjesti cijelu kutiju“ mijenja **samo `Location.parentId`**, ne mijenja pojedinačne Placemente.

## 3. Online izmjene i kolizije — P2, ne P3

- P2 zahtijeva mrežu za **bilo kakvu promjenu**, i to **potvrđen Firestore transakcijski upis** (ne oslanjati se na `setDoc` koje SDK može offline staviti u red).
- Svaki upis čita trenutnu verziju i relevantne reference unutar transakcije; verzija raste za 1; ako je od korisnikova otvaranja zapisa drugi uređaj promijenio isti zapis, vrati `promijenjeno na drugom uređaju` i ponudi ponovno učitavanje (bez tihog prepisivanja).
- Online kretanje može biti optimistično samo uz vidljiv `Spremanje…` i siguran povrat UI na potvrđeno stanje kada upis ne uspije. **P2 ne prikazuje „Sinkronizirano“ prije server potvrde.**
- Izmjene dva odvojena Itema/Placementa ne smiju biti serijalizirane nepotrebno.
- Kod reorganizacije roditeljskog stabla radi provjere ciklusa protiv **ažurnog** stanja. Dvije istodobne izmjene različitih roditelja mogu inače proizvesti ciklus; validirati i serijalizirati tree-move operacije pouzdanim zajedničkim revision/lock dokumentom ili dokazati alternativnu sigurnu izvedbu, uz emulator test. Server Rules ne mogu neograničeno rekurzivno obilaziti stablo; klijentska zaštita sama nije dokaz potpune zaštite od zlonamjernog klijenta. <https://firebase.google.com/docs/rules/rules-behavior>
- **P2 nema offline queue i nema produktivni „Poništi“ nakon server potvrde**. Ako je Undo prikazan u prototipu, na P2 mora biti jasno označen kao demo/odgođen ili zamijenjen novom eksplicitnom online obrnutom transakcijom koja sigurno provjerava verziju. Ne koristiti skriven rollback. **P3** kasnije pruža formalni Undo i povijest.
- Kad nema mrežne potvrde, UI mora reći `Trenutačno nije moguće spremiti. Provjeri vezu.` i **ne** tvrditi da je lokalno spremljeno za buduću sinkronizaciju.

## 4. Read sync i autentikacija — zaštita privatnosti

- **P1.5** Google Auth i P1 revalidacija ostaju netaknuti.
- `households/kuca1` podaci postaju dohvatljivi tek nakon potvrđenog pristupa istom UID-u. Zatražiti **server-confirmed** početni snapshot na sesiji. Potom real-time listeneri na `locations/items/placements` za aktivni household i UID; učinkovito ih odjaviti prije signout, promjene UID-a, revoke ili promjene household-a.
- Potpuno isprazniti React store / lokalno pretraživačko stanje pri signout, promjeni računa, gubitku autorizacije i ponovnoj inicijalizaciji. Ne prikazivati snapshot iz cachea drugom računu; ne koristiti zastarjele listener callbacke.
- **Za P2 zadrži Firestore samo memorijski cache; ne uključuj `persistentLocalCache`, IndexedDB ni aplikacijski `localStorage` s privatnim inventarom.** Tako P2 tijekom aktivne veze radi brzo, ali offline inventar nakon zatvaranja namjerno ne radi sve do P3 sigurnosnog dizajna. PWA app shell offline ostaje otvoriv.
- Kad je auth `stale`/offline, razlikovati prethodnu potvrdu od trenutno provjerene; ako nema sigurne server potvrde za tu sesiju, ne otkrivati privatni inventar. Status: `Čeka se veza`, `Pristup nije moguće potvrditi`.
- Firestore Rules moraju osigurati membership za sva čitanja i upise, ograničiti klijenta na dozvoljena polja i tipove, spriječiti promjene sistemskih polja i upise u tuđe kućanstvo. `members` ostaju read-only/self-get, `households` read-only, `appliedOps` deny-all.
- Nema masovnog public `allow write`. Za list query podataka house collections dopušten samo aktivnom članu odgovarajućeg household-a. Testirati treći UID i opozvanog člana na sve nove putanje.

## 5. Lokalna pretraga (nad učitanim podacima)

- Normalizacija: trim, case fold, NFC/NFD diakritika, hrvatsko `đ/d/dj`, tolerancija `š/s č/c ć/c ž/z`.
- Podržava ime, alternativna imena, kategoriju, relevantnu napomenu i **putanje lokacije**. Rangiranje: točan naziv → točan alias → prefix → substring → metadata/path → označeni fuzzy rezultati; riječi u višerječnom upitu ne smiju besmisleno podudarati istu riječ više puta.
- Testovi `imbus`, `aku busilca`, `AKU BUSILCA`, `durdevak/durdjevak`, `AA baterije`, `spajza` i negativni `aku busilca random`.
- Jedan Item na više lokacija prikazuje **sve** aktivne Placemente s punim putanjama. Rezultate održavati iz promijenjenih online snapshotova; bez server pretraživanja po svakom znaku.
- Različita kratka imena „Ladica 1“ nisu globalno zabranjena; putanja razjašnjava lokaciju.

## 6. UX iz dizajna i obavezna zaštita

- `Organized Cozy`, mobile-first telefon + tablet, zaglavlje Kućni inventar, velika pretraga, nedavno pregledano, lokacijske kartice, detalj predmeta, read-only lokacije u Uredi, Move kao zaseban tok.
- Brzi Move: iz detalja jednog Placementa dodir Premjesti + odabir nedavne/brze destinacije, bez treće potvrde; spinner/izvršavanje može potrajati, ali podaci se ne predstavljaju kao spremljeni prije servera.
- Za više Placemenata odabrati točan izvor, zatim destinaciju. Duplikat odredišta blokirati s kratkim razlogom; ne zbrajati/mergati.
- **UX-032-01**: ako je `Uredi` izmijenjen, odlazak u `Premjesti` / Natrag mora ponuditi: `Spremi promjene pa nastavi` / `Odbaci izmjene` / `Ostani ovdje`; bez prompta kada nema nespremljenih promjena.
- Premještanje kutije: jasna trenutna putanja, broj zasebnih Item ID-ova unutar podstabla, ne mijenjati svaki Placement; ciklusi i odredište = trenutačni parent blokirani.
- Bez slike koristiti neutralan placeholder; P4 tek integrira privatni Drive.
- `Popis` i `Skeniraj` nisu funkcionalni u P2: jasna oznaka `U pripremi` ili onemogućeno stanje. Nema gumba koji se čini funkcionalnim a ne radi.

## 7. Demo podaci samo u izolaciji

Datoteka `docs/fixtures/P2_DEMO_HOUSE.json` s najmanje 6 prostorija, višerazinskim regalima/kutijama, 25+ sintetskih Item zapisa, primjerima `unique` i `type`, Item na dvije lokacije, datumima/imenima koje nisu osobni stvarni podaci. `Demo householdId=demo-house` **nikad** ne zapisivati pod `kuca1` niti koristiti stvarne UID-ove.
- Seed samo u Firebase Emulator Suite (projekt `demo-home-inventory-p2`) ili lokalna mock memorija za UI testove, ali nije produkcijski izvor.
- U produkcijskom `households/kuca1` ostaju samo stvarni podaci koje vlasnik **naknadno ručno** unese kroz UI.
- Nepoznate korisničke lokacije nikad ne ugraditi kao stalne početne podatke.

## 8. Izvedba u kontroliranim podfazama

**P2-A — model i sigurnost:** predložiti shemu i dokaz server-enforced jedinstvenosti, konzistentnosti putanja i sigurnosnih pravila; zatim emulator Rules, transakcijski i multi-UID testovi. Nema produkcijskog deploya.

**P2-B — online inventar:** sloj repozitorija/transakcije/listeneri, lokacije/Item/Placement CRUD, stroga online-only pravila, logout i 2 UID izolacija; UI privremen. Nema produkcijskog deploya.

**P2-C — pretraga i Organizer Cozy UI:** izdvojen search modul, vizualna implementacija nakon predaje originalnog ZIP-a prototipa i prihvaćanja dizajnerskog PR #3, testovi telefona/tableta, zaštita nepohranjenih promjena.

**P2-D — završna integracijska provjera:** emulator end-to-end testovi, otvaranje sadržaja, multi-user simulacija, offline fail-closed, sigurnosni i performans test, upute za owner pilot. Svaki PR traži pregled i vlasnikovo odobrenje; produkcija se ne objavljuje automatski.

## 9. Obvezni prihvatni kriteriji

Detaljna matrica u `docs/P2_ACCEPTANCE.md`. Niti jedna funkcionalnost nije `PASS` samo zato što radi u starom HTML mockupu. Pravi Firestore CRUD/Rules testovi, online multi-user testovi i Android prihvat ownera zasebni su dokazi.

## 10. Tehnička otvorena pitanja koja Claude mora eksplicitno riješiti u P2-A, prije koda CRUD-a

1. Kako server-enforceati jedinstvenost (itemId,locationId) i najviše jedan aktivan Placement za `kind=unique`, bez Cloud Functions?
2. Kako potpuno kontrolirati istodobne move operacije u hijerarhiji i očuvati acikličnost (serijalizacija treeRev)?
3. Može li odabrana shema provesti sve write invariants u Firestore Rules unutar limita `get/exists/getAfter` poziva (10/20)? Ne tvrditi da može bez emulator testova.
4. Kako online-only mutations osiguravaju da se ne pojavi nevidljivi offline Firestore queue?
5. Kako se privatni memorijski cache poništava pri zamjeni računa, uz već postojeći P1 session model?
6. Kako će se P3 budući red namjera uvesti bez migracijskog lomljenja ID-ova?

Ako se pokaže da bez server komponenti nije moguća obavezna **stroga** invarijanta, Claude vraća opcije s posljedicama i testnim dokazom te **traži funkcionalnu odluku glavnog razvoja**. Nema samostalnog kompromisa.
