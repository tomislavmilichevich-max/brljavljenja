# OWNER_ACTIONS — ručne radnje vlasnika (s Android tableta, bez lijepljenja tajni u chat)

**Za P0 nije potrebna nijedna radnja** da bi kod radio lokalno. Ispod je popis za P1+ (ne radi se dok ne zatražimo).

## Odluke koje čekaju vlasnika

1. Repozitorij je preseljen u `-home-inventory-pwa` (ime počinje crticom). Ako to nije namjerno, preimenuj ga u `home-inventory-pwa` (GitHub → Settings → Repository name). Stari repozitorij `brljavljenja` više se ne koristi.
2. Pregled i spajanje P0 pull requesta.

## Prije P1 (Firebase)

1. console.firebase.google.com → Add project → **ostani na Spark planu**, bez kartice; isključi Google Analytics.
2. Build → Authentication → Sign-in method → uključi **Google**.
3. Build → Firestore Database → Create database (**production mode**, lokacija po izboru; lokacija se ne može mijenjati).
4. Project settings → Your apps → Web (`</>`) → kopiraj konfiguraciju u lokalni `.env.local` (vidi `.env.example`). Ova konfiguracija nije tajna, ali je ne šalji u chat bez potrebe.
5. Obje osobe se jednom prijave aplikacijom; UID-ovi se vide u Authentication → Users. Zatim ručno u Firestoreu stvori `households/{id}/members/{uid}` (`enabled: true`, `role: "member"`) — točan postupak dat će P1.
6. **Ne** klikati Upgrade/Blaze, ne unositi payment method, ne uključivati Storage/Functions/App Hosting.

## Prije P4 (Google Drive)

1. Google Cloud Console (isti projekt) → APIs & Services → uključi Google Drive API (besplatno).
2. OAuth consent screen: User type External, status Testing, dodaj **oba** Google računa kao test korisnike.
3. Scope samo `drive.file`. Client ID (Web) s autoriziranim izvorima; client secret se ne koristi u frontendu i ne dijeli.

## Prije P5 (deploy)

`firebase login` (preko preglednika) i izričito odobrenje deploya. Samo Hosting + Firestore rules.
