import { createContext, useContext } from 'react';
import type { InventoryData } from '../../inventory/types';
import type { UseInventory } from '../../inventory/useInventory';
import type { SearchIndex } from '../../search/search';
import type { Model } from './model';
import type { Navigator } from './nav';

export interface AppCtx {
  data: InventoryData;
  model: Model;
  index: SearchIndex;
  inv: UseInventory;
  nav: Navigator;
  /** Smije li se SADA pisati: server-potvrđen prikaz, veza, nije u tijeku spremanje, nema nerazriješenog nepoznatog ishoda. */
  writable: boolean;
  /** Razlog zbog kojeg se ne piše (za objašnjenje uz onemogućene gumbe), ili null. */
  readOnlyReason: string | null;
  query: string;
  setQuery: (q: string) => void;
  recents: string[];
  pushRecent: (itemId: string) => void;
  recentDest: string[];
  pushDest: (locationId: string) => void;
}

export const AppContext = createContext<AppCtx | null>(null);
export function useApp(): AppCtx {
  const c = useContext(AppContext);
  if (!c) throw new Error('useApp izvan AppContext');
  return c;
}
