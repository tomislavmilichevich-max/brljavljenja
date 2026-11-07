# P2_D1_ANDROID_PILOT_CHECKLIST — pilot na dva Android uređaja

**Status: PRIPREMLJENO, NIJE IZVRŠENO.** Slijedi se tek nakon objave prema `docs/P2_D1_DEPLOY_ROLLBACK.md` i vlasnikova odobrenja. Uređaj A i B = dva fizička Androida s dva Google računa koja su članovi kućanstva `kuca1`. Podaci koje unosiš su **stvarni testni unosi** (ne demo fixture); nemoj unositi osjetljive podatke. U stupac Rezultat upiši **PASS**, **FAIL** ili **NOT VERIFIED**; uz FAIL kratko opiši što si vidio (screenshot bez privatnih podataka).

Podaci o testu: datum ______ · Uređaj A (model, Android, Chrome) ______ · Uređaj B ______ · Verzija aplikacije (commit iz objave) ______

> Tablice ispod koriste: **ID · Koraci · Očekivano · Rezultat (PASS/FAIL) · Bilješka**.

## A. Google prijava i ostanak prijavljen

| ID | Koraci | Očekivani rezultat | PASS / FAIL | Bilješka |
| --- | --- | --- | --- | --- |
| A1 | Uređaj A (Chrome): otvori adresu aplikacije; pritisni „Prijava Google računom“, odaberi račun. | Nakon povratka iz Google prozora vraćaš se u aplikaciju; vidiš Početnu („Što tražiš?“), u zaglavlju naziv kućanstva i „Pristup potvrđen sa servera u HH:MM“. | ☐ PASS ☐ FAIL | |
| A2 | Zatvori karticu, ponovno otvori adresu. | Ostaješ prijavljen/a; pristup se ponovno potvrđuje (vrijeme u zaglavlju se obnovi). | ☐ PASS ☐ FAIL | |
| A3 | Uređaj B (drugi račun): isto kao A1–A2. | Isto kao A1–A2. | ☐ PASS ☐ FAIL | |
| A4 | Treći Google račun (ako postoji): prijava. | „Nemaš pristup“ + polje „Tvoj UID“; nikakvi podaci kuće. (Ako nema trećeg računa: upiši NOT VERIFIED.) | ☐ PASS ☐ FAIL | |

## B. Prostorija, ormar, kutija

| ID | Koraci | Očekivani rezultat | PASS / FAIL | Bilješka |
| --- | --- | --- | --- | --- |
| B1 | (Samo prvi put, uređaj A) Zaslon „Počinjemo od prazne kuće“ → „Pripremi kućanstvo“. | „Spremljeno · potvrđeno online“; Lokacije: „Još nema prostorija“. U Console samo `locations/root` i `meta/tree`. | ☐ PASS ☐ FAIL | |
| B2 | Lokacije → „Dodaj prvu prostoriju“; vrsta **Prostorija**, naziv „Garaža“ → Spremi. | Otvara se „Garaža“; roditelj je bio zaključan na Kuću; poruka „Spremljeno“. | ☐ PASS ☐ FAIL | |
| B3 | U Garaži: „Dodaj podlokaciju“; vrsta Prostorija je onemogućena („dodaj iz Kuće“). Dodaj **Ormar** „Ormar s alatom“. | Ormar nastaje unutar Garaže. | ☐ PASS ☐ FAIL | |
| B4 | U ormaru: „Dodaj podlokaciju“ → **Kutija** „Kutija B“. | Kutija nastaje; putanja „Kuća › Garaža › Ormar s alatom › Kutija B“. | ☐ PASS ☐ FAIL | |
| B5 | Uređaj B: otvori Lokacije. | Istu strukturu vidi uživo (bez ručnog osvježavanja). | ☐ PASS ☐ FAIL | |

## C. Dodavanje predmeta

| ID | Koraci | Očekivani rezultat | PASS / FAIL | Bilješka |
| --- | --- | --- | --- | --- |
| C1 | Dodaj (+): polje Lokacija je prazno („Odaberi lokaciju…“); Jedinstveni predmet je odabran. Upiši naziv, ne biraj lokaciju, pritisni „Dodaj predmet“. | Poruka „Odaberi lokaciju…“, ništa se ne sprema, naziv ostaje. | ☐ PASS ☐ FAIL | |
| C2 | Odaberi lokaciju „… › Kutija B“, naziv „Čekić“, Dodaj predmet. | Otvara se detalj „Čekić“ s putanjom i „Spremljeno · potvrđeno online“. | ☐ PASS ☐ FAIL | |
| C3 | Iz Kutije B → „Dodaj predmet ovdje“: lokacija je predložena i može se promijeniti. Vrsta **Vrsta predmeta**, naziv „AA baterije“, sinonimi „baterija, AA“. | Predmet nastaje; može se kasnije dodati drugi smještaj („Dodaj drugi smještaj“). | ☐ PASS ☐ FAIL | |
| C4 | Detalj „AA baterije“ → „Dodaj drugi smještaj“ → odaberi drugu lokaciju (npr. Garaža). | Dvije putanje na detalju; već zauzeta lokacija je onemogućena s razlogom. | ☐ PASS ☐ FAIL | |

## D. Pretraga (hrvatski znakovi i tipfeleri)

| ID | Koraci | Očekivani rezultat | PASS / FAIL | Bilješka |
| --- | --- | --- | --- | --- |
| D1 | Početna → upiši „cekic“. | Pronađen „Čekić“. | ☐ PASS ☐ FAIL | |
| D2 | Upiši „garaza“. | Lokacija „Garaža“ među rezultatima; predmeti iz nje preko putanje. | ☐ PASS ☐ FAIL | |
| D3 | Upiši „aa baterije“ pa „baterija“. | „AA baterije“ prvi; prikazane **sve** putanje. | ☐ PASS ☐ FAIL | |
| D4 | Upiši „cekik“ (tipfeler). | Čekić je u zasebnoj skupini **Približni rezultati** (oznaka „približno“). | ☐ PASS ☐ FAIL | |
| D5 | Upiši „cekic random“. | „Nema rezultata“ (nema lažnih pogodaka). | ☐ PASS ☐ FAIL | |
| D6 | Tipkaj brzo uz uključenu soft tipkovnicu. | Rezultati se osvježavaju bez zastajkivanja; gumbi ostaju vidljivi. | ☐ PASS ☐ FAIL | |

## E. Premještanje

| ID | Koraci | Očekivani rezultat | PASS / FAIL | Bilješka |
| --- | --- | --- | --- | --- |
| E1 | Detalj „Čekić“ → „Premjesti“ → odaberi odredište (npr. Garaža). | Odabir odredišta ODMAH sprema (bez dodatne potvrde); „Spremljeno“; nova putanja. | ☐ PASS ☐ FAIL | |
| E2 | Detalj „AA baterije“ (2 smještaja) → „Premjesti“. | Najprije „Koji smještaj premještaš?“; ostali smještaj se ne mijenja; odredište gdje već postoji je onemogućeno („Isti predmet već postoji ovdje“). | ☐ PASS ☐ FAIL | |
| E3 | Lokacije → … → „Kutija B“ → „Premjesti cijelu lokaciju“ → odaberi drugi ormar. | Sama kutija i sadržaj slijede; putanje predmeta u kutiji se promijene; sebe/potomke/trenutnog roditelja nije moguće odabrati (razlog vidljiv). | ☐ PASS ☐ FAIL | |
| E4 | Prostorija (Garaža): postoji li „Premjesti“? | Ne postoji. | ☐ PASS ☐ FAIL | |

## F. Istodobna izmjena na dva uređaja

| ID | Koraci | Očekivani rezultat | PASS / FAIL | Bilješka |
| --- | --- | --- | --- | --- |
| F1 | A i B otvore „Uredi“ istog predmeta; A promijeni naziv i spremi; B zatim promijeni naziv i spremi. | B vidi „Netko je promijenio zapis. Nismo prepisali tuđu promjenu.“ i karticu usporedbe; tekst koji je B upisao je sačuvan. | ☐ PASS ☐ FAIL | |
| F2 | B: „Nastavi nad aktualnom verzijom“ → Spremi promjene. | Spremljeno nad aktualnom verzijom. | ☐ PASS ☐ FAIL | |
| F3 | A i B istodobno dodaju predmet na istu lokaciju. | Oba predmeta nastaju (različiti predmeti); nema gubitka. | ☐ PASS ☐ FAIL | |
| F4 | A i B istodobno pokušaju isti predmet staviti na istu lokaciju (Dodaj drugi smještaj). | Jedan uspije, drugi vidi „već evidentirano“; nema duplikata. | ☐ PASS ☐ FAIL | |

## G. Prekid interneta i oporavak

| ID | Koraci | Očekivani rezultat | PASS / FAIL | Bilješka |
| --- | --- | --- | --- | --- |
| G1 | A: uključi način rada u zrakoplovu dok je aplikacija otvorena. | Unutar ≈ 1 min: „Veza je prekinuta … samo pregled“; zadnje potvrđeni podaci se vide; gumbi za spremanje onemogućeni. | ☐ PASS ☐ FAIL | |
| G2 | Otvori „Dodaj“, upiši naziv; pokušaj spremiti. | Ne sprema se; poruka da nije moguće; unos ostaje. | ☐ PASS ☐ FAIL | |
| G3 | Isključi način rada u zrakoplovu. | Aplikacija se oporavlja sama (stanje „potvrđeno“); **ništa što je tipkano offline nije poslano** (provjeri na uređaju B i u Console). | ☐ PASS ☐ FAIL | |
| G4 | (Neobavezno) Prekini vezu u trenutku spremanja (odmah nakon pritiska). | Ako se pojavi „Veza je prekinuta tijekom potvrđivanja… možda spremljena“: **Provjeri stanje**; ne tipkaj isti unos ponovno prije provjere pretragom. | ☐ PASS ☐ FAIL | |
| G5 | Ako je G4 dao nepoznat ishod: poslije provjere „nije pronađeno“ → „Ponovi isti pokušaj“. | Nastaje točno jedan predmet; „Odustani od pokušaja“ prikazuje upozorenje o duplikatu. | ☐ PASS ☐ FAIL | |

## H. Android Back

| ID | Koraci | Očekivani rezultat | PASS / FAIL | Bilješka |
| --- | --- | --- | --- | --- |
| H1 | Početna → Lokacije → neka lokacija → Android Back (gesta/tipka). | Vraća razinu po razinu: lokacija → Lokacije → Početna. | ☐ PASS ☐ FAIL | |
| H2 | Na Početnoj Back. | Aplikacija se zatvara/napušta (očekivano). | ☐ PASS ☐ FAIL | |
| H3 | Uredi predmet, promijeni naziv, Android Back. | Dijalog „Nespremljene izmjene“ (Spremi pa nastavi / Odbaci / Ostani); Back dok je dijalog otvoren = „Ostani ovdje“. | ☐ PASS ☐ FAIL | |
| H4 | Dijalog → „Spremi promjene pa nastavi“. | Sprema online i nastavlja tek nakon potvrde. | ☐ PASS ☐ FAIL | |

## I. Odjava, promjena računa, povratak

| ID | Koraci | Očekivani rezultat | PASS / FAIL | Bilješka |
| --- | --- | --- | --- | --- |
| I1 | Više → Odjava. | Ekran prijave; nijedan naziv iz inventara nije vidljiv (ni u povijesti natrag). | ☐ PASS ☐ FAIL | |
| I2 | Prijavi se drugim Google računom (član) na istom uređaju. | Vidi inventar kuće (isti podaci), ništa nije zaostalo od prethodnog zaslona. | ☐ PASS ☐ FAIL | |
| I3 | Prijavi se računom koji nije član. | „Nemaš pristup“; nikakvi podaci. | ☐ PASS ☐ FAIL | |
| I4 | Povratak prvim računom. | Radi kao A1. | ☐ PASS ☐ FAIL | |
| I5 | Opoziv: vlasnik u Console postavi `members/{UID-B}.enabled=false`; na B otvori aplikaciju/pritisni „Provjeri pristup“. | B vidi „Članstvo je opozvano“/„Nemaš pristup“; podaci nestaju; A nesmetano radi. Zatim vrati `enabled=true`. | ☐ PASS ☐ FAIL | |

## J. PWA s početnog zaslona

| ID | Koraci | Očekivani rezultat | PASS / FAIL | Bilješka |
| --- | --- | --- | --- | --- |
| J1 | Chrome ⋮ → Instaliraj aplikaciju / Dodaj na početni zaslon; otvori ikonu. | Otvara se bez adresne trake; prijava ostaje/ponovna prijava radi (povratak u aplikaciju). | ☐ PASS ☐ FAIL | |
| J2 | Zatvori PWA potpuno (iz pregleda aplikacija) i ponovno otvori. | Aplikacija se pokreće; ponovno potvrđuje pristup; inventar se učitava sa servera. | ☐ PASS ☐ FAIL | |
| J3 | Zrakoplovni način + otvori PWA. | Ljuska se otvori, ali pristup NIJE prikazan kao svježe potvrđen; nema inventara dok nema veze (nema offline pretrage u P2). | ☐ PASS ☐ FAIL | |
| J4 | Tijekom nepoznatog ishoda (ako ga uspiješ izazvati, G4) potpuno zatvori aplikaciju. | Pri ponovnom otvaranju nema „nerazriješenog pokušaja“ (registar je samo u memoriji) — **pretraži** je li predmet nastao prije ponovnog unosa. | ☐ PASS ☐ FAIL | |

## K. TalkBack i povećani font

| ID | Koraci | Očekivani rezultat | PASS / FAIL | Bilješka |
| --- | --- | --- | --- | --- |
| K1 | Uključi TalkBack. Početna: prijeđi gestom po kontrolama. | Polje „Pretraži predmet ili lokaciju“, kartice navigacije („Dodaj predmet“, „Popis kupnje, u pripremi“), zupčanik „Otvori Više“ imaju smislena imena; redoslijed je logičan. | ☐ PASS ☐ FAIL | |
| K2 | Dodaj predmet s TalkBackom. | Polja imaju oznake; greške se najavljuju; radio-izbor vrste čitljiv; gumb „Dodaj predmet“ dostupan. | ☐ PASS ☐ FAIL | |
| K3 | Dijalog nespremljenih izmjena. | Najavljen kao dijalog „Nespremljene izmjene“; fokus unutar dijaloga; pozadina nedostupna. | ☐ PASS ☐ FAIL | |
| K4 | Postavke → Zaslon → Veličina fonta najveća + Veličina prikaza veća. | Sve čitljivo; nema odsječenog teksta; donja navigacija i gumbi dostupni; nema vodoravnog pomicanja. | ☐ PASS ☐ FAIL | |
| K5 | Soft tipkovnica otvorena na obrascu „Dodaj predmet“. | Polje i gumb „Dodaj predmet“ dohvatljivi pomicanjem; donja navigacija ne prekriva polje u kojem tipkaš. | ☐ PASS ☐ FAIL | |

## Zaključak testa

| Stavka | Vrijednost |
| --- | --- |
| Broj PASS / FAIL / NOT VERIFIED | ____ / ____ / ____ |
| Blokirajući FAIL (koje stavke) | |
| Preporuka (nastavak P2-D2 / povrat / ispravak) | |
| Potpis vlasnika, datum | |
