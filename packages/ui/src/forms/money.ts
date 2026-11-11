// Mise en forme des montants saisis (ADR-0074 ; ADR-0025 : l'UI formate, le
// moteur calcule). Ce fichier ne manipule QUE du texte : aucune conversion en
// nombre, aucune opération — un test de source le garantit
// (`forms.test.ts`). Arrondis, conversions de devise et totaux restent au
// moteur et à l'API.

/** Espace fine insécable : séparateur des milliers en français. */
export const SEPARATEUR_MILLIERS = ' ';

export interface OptionsMontant {
  /** Chiffres après la virgule admis à la saisie (défaut 2). */
  decimales?: number;
  /** Signe moins admis (défaut non). */
  negatif?: boolean;
}

function decouper(
  brut: string,
  { decimales = 2, negatif = false }: OptionsMontant,
): { signe: string; entier: string; virgule: boolean; fraction: string } {
  const s = brut.replace(/[\s  ']/g, '');
  const signe = negatif && s.startsWith('-') ? '-' : '';
  const corps = s.replace(/[^\d.,]/g, '');
  const i = corps.search(/[.,]/);
  const entierBrut = i < 0 ? corps : corps.slice(0, i);
  const fractionBrute = i < 0 ? '' : corps.slice(i + 1).replace(/[.,]/g, '');
  const entier = entierBrut.replace(/^0+(?=\d)/, '');
  return {
    signe,
    entier,
    virgule: i >= 0 && decimales > 0,
    fraction: fractionBrute.slice(0, decimales),
  };
}

/**
 * Texte affiché pendant la saisie : `1234567,5` → `1 234 567,5`. Le premier
 * séparateur (virgule ou point) devient la virgule décimale ; les suivants sont
 * ignorés. Aucun arrondi : les chiffres en trop sont simplement refusés.
 */
export function formaterSaisieMontant(brut: string, options: OptionsMontant = {}): string {
  const { signe, entier, virgule, fraction } = decouper(brut, options);
  const groupe = entier.replace(/\B(?=(\d{3})+(?!\d))/g, SEPARATEUR_MILLIERS);
  const tete = groupe === '' && virgule ? '0' : groupe;
  return `${signe}${tete}${virgule ? `,${fraction}` : ''}`;
}

/**
 * Valeur transmise au formulaire : chiffres et point décimal (`1234567.5`),
 * comme l'API l'attend pour un décimal en chaîne. Vide si rien n'est saisi.
 */
export function valeurMontant(affiche: string, options: OptionsMontant = {}): string {
  const { signe, entier, virgule, fraction } = decouper(affiche, options);
  if (entier === '' && fraction === '') return '';
  const e = entier === '' ? '0' : entier;
  return `${signe}${e}${virgule && fraction !== '' ? `.${fraction}` : ''}`;
}

/** Affichage d'une valeur transmise (`1234.5` → `1 234,5`). */
export function afficherMontant(valeur: string, options: OptionsMontant = {}): string {
  return valeur === '' ? '' : formaterSaisieMontant(valeur, options);
}

/**
 * Position du curseur après reformatage : on compte les caractères utiles
 * (chiffres, virgule, signe) avant le curseur dans l'ancien texte, puis on
 * retrouve la même position dans le nouveau.
 */
export function curseurApresFormat(ancien: string, curseur: number, nouveau: string): number {
  const utiles = (c: string): boolean => /[\d.,-]/.test(c);
  let compte = 0;
  for (const c of ancien.slice(0, curseur)) if (utiles(c)) compte += 1;
  if (compte === 0) return 0;
  let vus = 0;
  for (let i = 0; i < nouveau.length; i += 1) {
    if (utiles(nouveau[i]!)) vus += 1;
    if (vus === compte) return i + 1;
  }
  return nouveau.length;
}
