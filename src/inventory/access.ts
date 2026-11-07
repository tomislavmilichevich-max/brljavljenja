import { doc, getDocFromServer, type Firestore } from 'firebase/firestore';
import { isPermissionDenied } from './errors';

/**
 * D5: je li korisniku odbijen pristup kućanstvu — provjera ISKLJUČIVO sa servera (nikad iz keša).
 * true = opozvan/nije član; false = ima pristup ILI se ne može znati (bez mreže ništa ne tvrdimo).
 */
export async function isAccessRevoked(db: Firestore, householdId: string): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, `households/${householdId}`));
    return false;
  } catch (e) {
    return isPermissionDenied(e);
  }
}
