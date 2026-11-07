import { isDomainError, type DomainCode } from './errors';

/** Poruke za korisnika. Nikad se ne tvrdi da je promjena spremljena osim nakon potvrde poslužitelja. */
export const ERROR_MESSAGES: Record<DomainCode, string> = {
  'access-revoked': 'Pristup kućanstvu više nije odobren.',
  'changed-elsewhere':
    'Promijenjeno na drugom uređaju. Podaci su osvježeni — provjeri i pokušaj ponovno. Promjena NIJE spremljena.',
  'duplicate-placement':
    'Taj predmet već postoji na toj lokaciji (ili je jedinstveni predmet već smješten). Promjena NIJE spremljena.',
  cycle: 'Lokacija se ne može premjestiti unutar same sebe ili svojih podlokacija.',
  'room-immovable': 'Prostorije se ne premještaju.',
  'room-parent': 'Prostorija može biti samo izravno u kući (root).',
  'same-parent': 'Lokacija je već tamo.',
  'same-location': 'Predmet je već na toj lokaciji.',
  'bad-parent': 'Nadređena lokacija ne postoji ili nije aktivna.',
  'bad-item': 'Predmet ne postoji ili nije aktivan.',
  'bad-location': 'Lokacija ne postoji ili nije aktivna.',
  'not-found': 'Zapis više ne postoji.',
  'corrupt-tree': 'Stablo lokacija je oštećeno. Premještanje je onemogućeno.',
  'not-bootstrapped': 'Kućanstvo još nije pripremljeno. Pritisni „Pripremi kućanstvo".',
  offline:
    'Trenutačno nije moguće spremiti. Provjeri vezu. Promjena NIJE spremljena i neće se poslati naknadno.',
  'outcome-unknown':
    'Veza je pala dok se promjena potvrđivala. Ishod je NEPOZNAT: promjena je možda spremljena. Kad se veza vrati, provjeri prikaz prije ponovnog pokušaja.',
  contention: 'Previše istodobnih izmjena. Pokušaj ponovno. Promjena NIJE spremljena.',
  'invalid-input': 'Neispravan unos.',
  unknown: 'Promjena nije spremljena zbog neočekivane greške.',
};

export function messageFor(e: unknown): string {
  if (isDomainError(e)) {
    if (e.code === 'invalid-input' && e.message && e.message !== 'invalid-input') return e.message;
    return ERROR_MESSAGES[e.code];
  }
  return ERROR_MESSAGES.unknown;
}
