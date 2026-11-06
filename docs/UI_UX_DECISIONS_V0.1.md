# Kućni inventar — odobrena vizualna osnova v0.1

Status: **vizualni smjer odobren; konačni interaktivni prototip i implementacija nisu započeli.**
Izvor: potvrđeni UI/UX handoff iz zasebnog dizajnerskog razgovora, 2026-11-06.

## 1. Vizualni identitet

**Opcija C — Organized Cozy.**

- Topao, vedar, obiteljski izgled; bez industrijskog, korporativnog i ERP dojma.
- Svijetla krem/bež pozadina, bijele kartice.
- Kadulja zelena glavna akcijska boja, pastelna plava i koraljna dodatne.
- Mekani rubovi, suptilne sjene, zaobljene ikone.
- Manrope za naslove, Inter za tekst/kontrole.
- Svijetla tema zadana.
- **Hex kodove boja ne izmišljati**: preuzeti ih iz konačnog odobrenog UI prototipa/handoffa.

## 2. Navigacija

Donji izbornik, ovim redoslijedom:
**Početna | Lokacije | + | Popis | Više**.

Početna: „Kućni inventar“, dominantna pretraga **„Što tražiš?“**, brze radnje Lokacije/Dodaj/Popis kupnje/Skeniraj, nedavno pregledani predmeti i diskretne ilustracije.

Vizualno predviđeni zasloni:
- Početna.
- Lokacije: kartice prostorija, ilustracija, naziv, broj predmeta.
- Sadržaj lokacije: naziv/fotografija, podlokacije, predmeti, Dodaj.
- Detalji predmeta: fotografija, jasno prikazana **fizička lokacija** i naglašen zeleni „Premjesti“.
- Dodavanje/uređivanje: samo naziv i lokacija obavezni; ostalo neobavezno.

## 3. UX granice

1. Prvo pretraživanje i pronalaženje predmeta; ne dashboard statistika.
2. Kratko dodavanje i premještanje; česte destinacije dostupne brzo.
3. Android telefon i tablet, kontrole za rad dodirom.
4. Količine i kupnja sporedno, idealno jedna/dvije radnje — **funkcionalno tek v0.3**.
5. Offline/sinkronizacija predstavljeni razumljivim jezikom, bez žargona.
6. NFC/QR/EAN tokovi funkcionalno tek v0.2.

## 4. Izgled nije odobrenje funkcionalnosti

Ako ilustracija prikazuje favorite, dokumente, složene statuse, napredne količine ili analitiku — **nije automatski odobreno**.

U P1 smije se koristiti privremeni minimalni UI za prijavu i status pristupa. Konačni zasloni čekaju interaktivni HTML prototip i dizajnerski handoff; Claude Code ne osmišljava alternativni vizualni smjer.

## 5. Predstojeći UI/UX zadaci

- Brzi dijalog Premjesti (uključujući cijelu kutiju).
- NFC/QR skeniranje.
- Popis kupnje i „Pri kraju“.
- Interaktivni HTML prototip, mobilni testovi, sva prazna/error/offline/sync stanja.
- Završni implementacijski handoff Claude Codeu.

Status: **odluke zabilježene; nema naloga za kodiranje UI/UX dodatnih mogućnosti**.
