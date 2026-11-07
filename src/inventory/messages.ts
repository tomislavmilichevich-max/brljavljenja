import { isDomainError, type DomainCode } from './errors';

/** Poruke za korisnika. Nikad se ne tvrdi da je promjena spremljena osim nakon potvrde poslužitelja. */
export const ERROR_MESSAGES: Record<DomainCode, string> = {
  'access-revoked': 'Pristup kućanstvu više nije odobren.',
  'changed-elsewhere':
    'Netko je promijenio zapis. Nismo prepisali tuđu promjenu. Tvoja promjena NIJE spremljena, a unos je sačuvan.',
  'duplicate-placement':
    'Ovaj predmet već je evidentiran na toj lokaciji (ili je jedinstveni predmet već smješten). Promjena NIJE spremljena.',
  cycle: 'Odabrano mjesto nalazi se unutar premještane lokacije.',
  'room-immovable': 'Prostoriju nije moguće premještati.',
  'room-parent': 'Prostorija može biti samo neposredno u Kući.',
  'same-parent': 'Već se nalazi ovdje.',
  'same-location': 'Već se nalazi ovdje.',
  'bad-parent': 'Odabrana lokacija ili predmet više nije dostupan. Provjeri stanje.',
  'bad-item': 'Odabrana lokacija ili predmet više nije dostupan. Provjeri stanje.',
  'bad-location': 'Odabrana lokacija ili predmet više nije dostupan. Provjeri stanje.',
  'not-found': 'Odabrana lokacija ili predmet više nije dostupan. Provjeri stanje.',
  'corrupt-tree': 'Stablo lokacija je oštećeno. Premještanje je onemogućeno.',
  'not-bootstrapped': 'Kućanstvo još nije pripremljeno. Pritisni „Pripremi kućanstvo".',
  offline:
    'Trenutačno nije moguće spremiti. Provjeri vezu. Promjena NIJE spremljena i neće se poslati naknadno.',
  'outcome-unknown':
    'Veza je prekinuta tijekom potvrđivanja. Promjena je možda spremljena; ishod je NEPOZNAT. Provjeri stanje prije novog pokušaja.',
  contention: 'Trenutačno mnogo izmjena. Pokušaj kasnije. Promjena NIJE spremljena.',
  'invalid-input': 'Neispravan unos.',
  unknown: 'Promjena nije spremljena zbog neočekivane greške. Unos je sačuvan.',
};

export function messageFor(e: unknown): string {
  if (isDomainError(e)) {
    if (e.code === 'invalid-input' && e.message && e.message !== 'invalid-input') return e.message;
    return ERROR_MESSAGES[e.code];
  }
  return ERROR_MESSAGES.unknown;
}
