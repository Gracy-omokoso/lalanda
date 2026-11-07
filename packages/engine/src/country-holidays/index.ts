// Jours fériés légaux de la RDC proposés à l'organisation (ADR-0068 § 5).
//
// Donnée PAYS, sourcée, datée et versionnée (docs/09), tenue HORS de `hr/` : le module
// RH ne code aucun férié (ADR-0045, critère 21) ; il reçoit cette liste comme une
// proposition. : chaque date proposée est
// marquée « à vérifier » par l'API tant qu'une personne RH ne l'a pas confirmée.
// Aucune règle de report (férié tombant un dimanche) ni journée « chômée et payée »
// décidée par arrêté ponctuel n'est calculée ici : seulement la liste du texte.

export interface CountryHolidaySource {
  /** Texte juridique cité. */
  text: string;
  /** Où la liste a été lue (le texte n'a pas été lu au Journal officiel). */
  readVia: string;
  url: string;
  /** Jour de consultation. */
  consultedOn: string;
}

export interface CountryHolidayRule {
  /** `MM-DD`, même jour chaque année. */
  monthDay: string;
  label: string;
}

export interface CountryHolidayProposal {
  date: string;
  label: string;
}

export const RDC_HOLIDAYS_VERSION = 'cd-holidays-2023-03-30';

export const RDC_HOLIDAYS_SOURCE: CountryHolidaySource = {
  text: 'Ordonnance n° 23/042 du 30 mars 2023 fixant les jours fériés légaux en République démocratique du Congo',
  readVia:
    'Agence congolaise de presse (ACP), « Tshisekedi décrète le 6 avril jour férié en mémoire de Simon Kimbangu »',
  url: 'https://acp.cd/nation/combat-de-simon-kimbangu-le-6-avril-decrete-jour-ferie-legal-en-rdc/',
  consultedOn: '2026-11-07',
};

/** Les dix jours fériés de l'ordonnance, dans l'ordre de l'année (libellés de l'ACP). */
export const RDC_PUBLIC_HOLIDAYS: readonly CountryHolidayRule[] = [
  { monthDay: '01-01', label: 'Nouvel an' },
  { monthDay: '01-04', label: 'Martyrs de l’indépendance' },
  { monthDay: '01-16', label: 'Héros national Laurent-Désiré Kabila' },
  { monthDay: '01-17', label: 'Héros national Patrice Emery Lumumba' },
  { monthDay: '04-06', label: 'Combat de Simon Kimbangu et conscience africaine' },
  { monthDay: '05-01', label: 'Fête du travail' },
  { monthDay: '05-17', label: 'Journée des Forces armées' },
  { monthDay: '06-30', label: 'Indépendance' },
  { monthDay: '08-01', label: 'Fête des parents' },
  { monthDay: '12-25', label: 'Noël' },
];

/** Bornes de l'année demandée. */
export const COUNTRY_HOLIDAY_YEARS = { min: 2023, max: 2100 } as const;

/** Dates proposées pour une année (2023, entrée en vigueur du texte, au plus tôt). */
export function rdcHolidaysFor(year: number): CountryHolidayProposal[] {
  if (
    !Number.isInteger(year) ||
    year < COUNTRY_HOLIDAY_YEARS.min ||
    year > COUNTRY_HOLIDAY_YEARS.max
  ) {
    throw new RangeError('Année hors des bornes du calendrier proposé.');
  }
  return RDC_PUBLIC_HOLIDAYS.map((h) => ({ date: `${year}-${h.monthDay}`, label: h.label }));
}
