// ---------------------------------------------------------------------------
// Décompte des jours ouvrés (xFINT2).
//
// Les dates circulent en 'YYYY-MM-DD' partout (cf. le type parser DATE dans
// db.ts). On raisonne donc en UTC : construire un Date local décalerait le jour
// d'une unité selon le fuseau, et ferait basculer un lundi en dimanche.
// ---------------------------------------------------------------------------

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MS_PER_DAY = 86_400_000;

function toUTC(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function toISO(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Vrai si la date ISO est un samedi ou un dimanche. */
export function isWeekend(iso: string): boolean {
  const day = new Date(toUTC(iso)).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Dimanche de Pâques (calendrier grégorien), algorithme de Meeus/Jones/Butcher.
 * Sert de pivot aux trois fériés mobiles français.
 */
function easterSunday(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

const cache = new Map<number, Set<string>>();

/**
 * Jours fériés légaux français d'une année (métropole). Alsace-Moselle a deux
 * fériés supplémentaires, non gérés ici.
 */
export function holidaysForYear(year: number): Set<string> {
  const cached = cache.get(year);
  if (cached) return cached;

  const easter = easterSunday(year);
  const days = new Set<string>([
    `${year}-01-01`, // Jour de l'an
    `${year}-05-01`, // Fête du travail
    `${year}-05-08`, // Victoire 1945
    `${year}-07-14`, // Fête nationale
    `${year}-08-15`, // Assomption
    `${year}-11-01`, // Toussaint
    `${year}-11-11`, // Armistice
    `${year}-12-25`, // Noël
    toISO(easter + 1 * MS_PER_DAY), // Lundi de Pâques
    toISO(easter + 39 * MS_PER_DAY), // Ascension
    toISO(easter + 50 * MS_PER_DAY), // Lundi de Pentecôte
  ]);

  cache.set(year, days);
  return days;
}

export function isHoliday(iso: string): boolean {
  return holidaysForYear(Number(iso.slice(0, 4))).has(iso);
}

/** Ni week-end ni jour férié. */
export function isBusinessDay(iso: string): boolean {
  return !isWeekend(iso) && !isHoliday(iso);
}

/**
 * Nombre de jours ouvrés entre deux dates ISO, bornes incluses.
 * Renvoie 0 si la période ne contient que des week-ends/fériés.
 */
export function countBusinessDays(startISO: string, endISO: string): number {
  const start = toUTC(startISO);
  const end = toUTC(endISO);
  if (end < start) return 0;

  let count = 0;
  for (let ms = start; ms <= end; ms += MS_PER_DAY) {
    if (isBusinessDay(toISO(ms))) count += 1;
  }
  return count;
}

/** Liste des jours ouvrés de la période — utile pour un rendu calendrier. */
export function businessDaysBetween(startISO: string, endISO: string): string[] {
  const start = toUTC(startISO);
  const end = toUTC(endISO);
  const days: string[] = [];
  for (let ms = start; ms <= end; ms += MS_PER_DAY) {
    const iso = toISO(ms);
    if (isBusinessDay(iso)) days.push(iso);
  }
  return days;
}
