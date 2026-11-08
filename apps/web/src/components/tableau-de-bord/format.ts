// Écriture des chiffres des tableaux de bord (ADR-0056, ADR-0067 ; mise en commun
// ADR-0071) : mois, montants arrondis à l'unité pour l'affichage, graduations
// courtes. Aucune règle de calcul : des valeurs déjà servies par le moteur sont
// mises en forme. `nombre` produit une valeur D'AFFICHAGE pour les graphiques.

const INSECABLE = ' ';

const MOIS_COURTS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
] as const;
const MOIS_LONGS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

function indexMois(mois: string): number | null {
  const m = /^\d{4}-(\d{2})$/.exec(mois);
  const i = m ? Number(m[1]) - 1 : -1;
  return i >= 0 && i < 12 ? i : null;
}

/** `2026-10` → `oct.` ; illisible : rendu tel quel. */
export function moisCourt(mois: string): string {
  const i = indexMois(mois);
  return i === null ? mois : MOIS_COURTS[i]!;
}

/** `2026-10` → `octobre 2026`. */
export function moisLong(mois: string): string {
  const i = indexMois(mois);
  return i === null ? mois : `${MOIS_LONGS[i]} ${mois.slice(0, 4)}`;
}

/** Chaîne décimale du serveur → nombre d'affichage (0 si illisible). */
export function nombre(valeur: string): number {
  const n = Number(valeur);
  return Number.isFinite(n) ? n : 0;
}

function grouper(entier: string): string {
  return entier.replace(/\B(?=(\d{3})+(?!\d))/g, INSECABLE);
}

/**
 * Montant arrondi à l'unité pour une carte de chiffres : `"4812300.40"` →
 * `4 812 300 CDF`. Arrondi d'AFFICHAGE au plus proche (demi vers le haut, en
 * valeur absolue), sur la chaîne : aucun flottant.
 */
export function montantEntier(valeur: string, devise: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(valeur);
  if (!m) return `${valeur}${INSECABLE}${devise}`;
  const [, signe, entier, dec = ''] = m;
  let n = BigInt(entier!);
  if (dec.length > 0 && Number(dec[0]) >= 5) n += 1n;
  const negatif = signe === '-' && n !== 0n;
  return `${negatif ? '−' : ''}${grouper(n.toString())}${INSECABLE}${devise}`;
}

/** Écriture courte d'une graduation ou d'un classement : `12,9 M`, `350 k`, `0`. */
export function compact(valeur: number): string {
  const abs = Math.abs(valeur);
  const signe = valeur < 0 ? '−' : '';
  const un = (x: number) => {
    const arrondi = Math.round(x * 10) / 10;
    return Number.isInteger(arrondi) ? String(arrondi) : arrondi.toFixed(1).replace('.', ',');
  };
  if (abs >= 1e9) return `${signe}${un(abs / 1e9)}${INSECABLE}Md`;
  if (abs >= 1e6) return `${signe}${un(abs / 1e6)}${INSECABLE}M`;
  if (abs >= 1e3) return `${signe}${Math.round(abs / 1e3)}${INSECABLE}k`;
  return `${signe}${Math.round(abs)}`;
}

/** `+12 %`, `−40 %`, `0 %` : variation servie par le moteur, signe typographique. */
export function variation(pourcent: number): string {
  if (pourcent > 0) return `+${pourcent}${INSECABLE}%`;
  if (pourcent < 0) return `−${-pourcent}${INSECABLE}%`;
  return `0${INSECABLE}%`;
}

/** `3 factures`, `1 facture`. */
export function pluriel(n: number, un: string, plusieurs: string): string {
  return `${n.toLocaleString('fr-FR')} ${n > 1 ? plusieurs : un}`;
}

/** Jours entiers servis par le moteur : `12 j`, ou `—` inconnu. */
export function jours(n: number | null): string {
  return n === null ? '—' : `${n.toLocaleString('fr-FR')}${INSECABLE}j`;
}

/** Recherche insensible à la casse dans quelques champs d'une ligne déjà chargée. */
export function contient(champs: readonly (string | null | undefined)[], terme: string): boolean {
  const t = terme.trim().toLocaleLowerCase('fr-FR');
  if (t === '') return true;
  return champs.some((v) => (v ?? '').toLocaleLowerCase('fr-FR').includes(t));
}
