// A5: FIZIČKA brava produkcijskog apply-a. Konstanta je `false` u kodu: da bi se apply ikad pokrenuo na stvarnom
// projektu, vlasnik mora izričito odobriti IZMJENU OVE DATOTEKE u zasebnom PR-u (Faza B). Do tada apply radi samo
// za projekte s prefiksom `demo-` (emulator).
export const PRODUCTION_APPLY_ENABLED = false as boolean;
export const isDemoProject = (p: string): boolean => p.startsWith('demo-');
