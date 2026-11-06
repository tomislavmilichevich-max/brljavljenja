import { classifyAccessError } from './errors';
import type { AccessResult } from './types';

/** Što je poslužitelj vratio za dokument kućanstva (neovisno o Firebase tipovima — testabilno). */
export interface HouseholdRead {
  exists: boolean;
  name: string | null;
}

/**
 * Odluka o pristupu iz rezultata čitanja `households/{h}` S POSLUŽITELJA.
 *  - čitanje uspjelo + dokument postoji  -> member
 *  - čitanje uspjelo, dokument NE postoji -> error 'household-missing' (Rules dopuštaju get nepostojećeg
 *    dokumenta aktivnom članu jer subkolekcija members može postojati bez roditelja; nije "odobren")
 *  - permission-denied -> denied; unavailable -> offline; ostalo -> unknown
 */
export async function evaluateAccess(read: () => Promise<HouseholdRead>): Promise<AccessResult> {
  try {
    const household = await read();
    if (!household.exists) return { status: 'error', kind: 'household-missing' };
    return { status: 'member', householdName: household.name };
  } catch (e) {
    const kind = classifyAccessError(e);
    return kind === 'denied' ? { status: 'denied' } : { status: 'error', kind };
  }
}
