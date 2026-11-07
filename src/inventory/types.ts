export type LocationKind = 'house' | 'room' | 'cabinet' | 'shelf' | 'box' | 'drawer' | 'other';
export type ItemKind = 'unique' | 'type';

/** Vrste koje korisnik smije birati pri dodavanju (house ima isključivo root). */
export const CREATABLE_LOCATION_KINDS = [
  'room',
  'cabinet',
  'shelf',
  'box',
  'drawer',
  'other',
] as const;

export const ROOT_ID = 'root';

export interface Location {
  id: string;
  name: string;
  parentId: string | null;
  kind: LocationKind;
  version: number;
  archived: boolean;
}

export interface Item {
  id: string;
  name: string;
  kind: ItemKind;
  aliases: string[];
  category: string | null;
  note: string | null;
  version: number;
  archived: boolean;
}

export interface Placement {
  id: string;
  itemId: string;
  locationId: string;
  version: number;
  archived: boolean;
}

export interface InventoryData {
  locations: Location[];
  items: Item[];
  placements: Placement[];
}
