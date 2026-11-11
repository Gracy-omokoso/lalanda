// Logique pure des composants de formulaire (ADR-0074).
//
// Tout ce qui se teste sans navigateur vit ici : largeurs sémantiques, dates
// (saisie tolérante JJ/MM/AAAA, grille du calendrier lundi premier), code à
// usage unique, recherche sans accents et surlignage, navigation au clavier
// dans une liste, raccourci d'enregistrement, résumé d'erreurs.
//
// AUCUN montant ici : la mise en forme des montants est dans `money.ts`, qui
// ne fait que du texte (ADR-0025 : l'UI formate, le moteur calcule).

// ─── Largeurs sémantiques ────────────────────────────────────────────────────

/**
 * Taille d'un champ selon la donnée qu'il porte, jamais selon la place libre :
 * - `xs` : code postal, quantité, pourcentage, nombre de jours ;
 * - `sm` : date, téléphone, montant, matricule ;
 * - `md` : nom, e-mail, liste de choix courte ;
 * - `lg` : client, intitulé, adresse e-mail longue ;
 * - `full` : adresse, notes, description.
 */
export type FieldSize = 'xs' | 'sm' | 'md' | 'lg' | 'full';

/**
 * Colonnes occupées dans la grille de 12 (`FormGrid`). Requêtes de CONTENEUR
 * (`@container`) et non d'écran : un formulaire dans une fenêtre modale étroite
 * se replie comme sur un téléphone. Moins de 32 rem (512 px) : une colonne.
 * Classes écrites en entier pour que Tailwind les lise.
 */
export const FIELD_SPANS: Record<FieldSize, string> = {
  xs: 'col-span-full @lg:col-span-3 @3xl:col-span-2',
  sm: 'col-span-full @lg:col-span-4 @3xl:col-span-3',
  md: 'col-span-full @lg:col-span-6 @3xl:col-span-4',
  lg: 'col-span-full @lg:col-span-8 @3xl:col-span-6',
  full: 'col-span-full',
};

/** Largeur maximale d'un contrôle posé hors grille (barre de filtres, ligne d'outils). */
export const FIELD_MAX_WIDTHS: Record<FieldSize, string> = {
  xs: 'max-w-[8rem]',
  sm: 'max-w-[12rem]',
  md: 'max-w-[20rem]',
  lg: 'max-w-[32rem]',
  full: '',
};

/** Identifiants reliés par `aria-describedby` : aide, erreur, puis extras. */
export function describedBy(
  id: string,
  etat: { hint?: unknown; error?: unknown; extra?: readonly (string | null | undefined)[] },
): string | undefined {
  const ids = [
    etat.hint ? `${id}-aide` : null,
    etat.error ? `${id}-erreur` : null,
    ...(etat.extra ?? []),
  ].filter((x): x is string => typeof x === 'string' && x !== '');
  return ids.length > 0 ? ids.join(' ') : undefined;
}

// ─── Dates (ISO `AAAA-MM-JJ`, calendrier grégorien, lundi premier) ───────────

export const MOIS_FR = [
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

export const MOIS_COURTS_FR = [
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

export const JOURS_COURTS_FR = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'] as const;
export const JOURS_FR = [
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
  'dimanche',
] as const;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function isoDe(annee: number, mois1: number, jour: number): string {
  return `${String(annee).padStart(4, '0')}-${pad2(mois1)}-${pad2(jour)}`;
}

export function joursDansMois(annee: number, mois1: number): number {
  return new Date(Date.UTC(annee, mois1, 0)).getUTCDate();
}

/** Décompose une date ISO valide ; `null` sinon. */
export function lireIso(iso: string): { annee: number; mois: number; jour: number } | null {
  const m = ISO.exec(iso);
  if (!m) return null;
  const annee = parseInt(m[1]!, 10);
  const mois = parseInt(m[2]!, 10);
  const jour = parseInt(m[3]!, 10);
  if (mois < 1 || mois > 12 || jour < 1 || jour > joursDansMois(annee, mois)) return null;
  return { annee, mois, jour };
}

export function estIsoValide(iso: string): boolean {
  return lireIso(iso) !== null;
}

/** Date du jour dans le fuseau du navigateur (pas en UTC : 23 h à Kinshasa reste aujourd'hui). */
export function aujourdhuiIso(maintenant: Date = new Date()): string {
  return isoDe(maintenant.getFullYear(), maintenant.getMonth() + 1, maintenant.getDate());
}

function versUtc(iso: string): number {
  const d = lireIso(iso);
  if (!d) throw new RangeError(`Date ISO invalide : ${iso}`);
  return Date.UTC(d.annee, d.mois - 1, d.jour);
}

function depuisUtc(ms: number): string {
  const d = new Date(ms);
  return isoDe(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function ajouterJours(iso: string, n: number): string {
  return depuisUtc(versUtc(iso) + n * 86_400_000);
}

/** Ajoute des mois en ramenant le jour au dernier du mois si besoin (31 janv. + 1 → 28/29 févr.). */
export function ajouterMois(iso: string, n: number): string {
  const d = lireIso(iso);
  if (!d) throw new RangeError(`Date ISO invalide : ${iso}`);
  const total = d.annee * 12 + (d.mois - 1) + n;
  const annee = Math.floor(total / 12);
  const mois = (total % 12) + 1;
  return isoDe(annee, mois, Math.min(d.jour, joursDansMois(annee, mois)));
}

export function finDeMois(iso: string): string {
  const d = lireIso(iso);
  if (!d) throw new RangeError(`Date ISO invalide : ${iso}`);
  return isoDe(d.annee, d.mois, joursDansMois(d.annee, d.mois));
}

/** Jour de la semaine, lundi = 0 … dimanche = 6. */
export function jourSemaine(iso: string): number {
  return (new Date(versUtc(iso)).getUTCDay() + 6) % 7;
}

/** `JJ/MM/AAAA` ; chaîne vide pour une valeur vide ou invalide. */
export function formatDateFr(iso: string): string {
  const d = lireIso(iso);
  return d ? `${pad2(d.jour)}/${pad2(d.mois)}/${d.annee}` : '';
}

/** « mercredi 11 novembre 2026 » — nom accessible d'un jour du calendrier. */
export function formatDateLongue(iso: string): string {
  const d = lireIso(iso);
  if (!d) return '';
  return `${JOURS_FR[jourSemaine(iso)]} ${d.jour === 1 ? '1er' : d.jour} ${MOIS_FR[d.mois - 1]} ${d.annee}`;
}

/**
 * Saisie tolérante : `11/11/2026`, `11-11-26`, `11.11.2026`, `11 11 2026`,
 * `11112026`, `111126`, `1/2` (année de référence), `2026-11-11` (ISO).
 * Années à deux chiffres : 20xx. `null` si la date n'existe pas (31/02).
 */
export function lireDateSaisie(texte: string, reference: string = aujourdhuiIso()): string | null {
  const t = texte.trim();
  if (t === '') return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) return valider(iso[1]!, iso[2]!, iso[3]!);
  const sep = /^(\d{1,2})[/.\-\s]+(\d{1,2})(?:[/.\-\s]+(\d{2}|\d{4}))?$/.exec(t);
  if (sep) return valider(sep[3] ?? reference.slice(0, 4), sep[2]!, sep[1]!);
  const colle = /^(\d{2})(\d{2})(\d{4}|\d{2})$/.exec(t);
  if (colle) return valider(colle[3]!, colle[2]!, colle[1]!);
  return null;
}

function valider(a: string, m: string, j: string): string | null {
  const annee = a.length === 2 ? 2000 + parseInt(a, 10) : parseInt(a, 10);
  const iso = isoDe(annee, parseInt(m, 10), parseInt(j, 10));
  return estIsoValide(iso) ? iso : null;
}

/** Comprise entre les bornes (incluses) ; une borne vide ne borne rien. */
export function dansLesBornes(iso: string, min?: string | null, max?: string | null): boolean {
  if (min && iso < min) return false;
  if (max && iso > max) return false;
  return true;
}

export function borner(iso: string, min?: string | null, max?: string | null): string {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

export interface JourCalendrier {
  iso: string;
  jour: number;
  /** Jour du mois affiché (les autres complètent les semaines). */
  duMois: boolean;
}

/** Six semaines de sept jours, lundi en premier, couvrant le mois de `annee`/`mois1`. */
export function grilleMois(annee: number, mois1: number): JourCalendrier[][] {
  const premier = isoDe(annee, mois1, 1);
  const debut = ajouterJours(premier, -jourSemaine(premier));
  const semaines: JourCalendrier[][] = [];
  for (let s = 0; s < 6; s += 1) {
    const semaine: JourCalendrier[] = [];
    for (let j = 0; j < 7; j += 1) {
      const iso = ajouterJours(debut, s * 7 + j);
      const d = lireIso(iso)!;
      semaine.push({ iso, jour: d.jour, duMois: d.mois === mois1 && d.annee === annee });
    }
    semaines.push(semaine);
  }
  return semaines;
}

export type ToucheCalendrier =
  'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'PageUp' | 'PageDown';

/** Déplacement du jour actif au clavier (WAI-ARIA « date picker dialog »). */
export function deplacerJour(iso: string, touche: string, maj = false): string | null {
  switch (touche) {
    case 'ArrowLeft':
      return ajouterJours(iso, -1);
    case 'ArrowRight':
      return ajouterJours(iso, 1);
    case 'ArrowUp':
      return ajouterJours(iso, -7);
    case 'ArrowDown':
      return ajouterJours(iso, 7);
    case 'Home':
      return ajouterJours(iso, -jourSemaine(iso));
    case 'End':
      return ajouterJours(iso, 6 - jourSemaine(iso));
    case 'PageUp':
      return ajouterMois(iso, maj ? -12 : -1);
    case 'PageDown':
      return ajouterMois(iso, maj ? 12 : 1);
    default:
      return null;
  }
}

export type RaccourciDate = 'today' | 'endOfMonth' | 'plus7' | 'plus30' | 'endOfYear';

export const LIBELLES_RACCOURCIS: Record<RaccourciDate, string> = {
  today: 'Aujourd’hui',
  endOfMonth: 'Fin de mois',
  plus7: '+7 j',
  plus30: '+30 j',
  endOfYear: 'Fin d’année',
};

/** Date d'un raccourci, à partir d'aujourd'hui. */
export function dateRaccourci(r: RaccourciDate, aujourdhui: string = aujourdhuiIso()): string {
  switch (r) {
    case 'today':
      return aujourdhui;
    case 'endOfMonth':
      return finDeMois(aujourdhui);
    case 'plus7':
      return ajouterJours(aujourdhui, 7);
    case 'plus30':
      return ajouterJours(aujourdhui, 30);
    case 'endOfYear':
      return `${aujourdhui.slice(0, 4)}-12-31`;
  }
}

/** Sélection d'une plage : premier clic = début, second = fin (inversés si besoin). */
export function choisirDansPlage(
  plage: { start: string; end: string },
  iso: string,
): { start: string; end: string } {
  if (plage.start === '' || plage.end !== '') return { start: iso, end: '' };
  return iso < plage.start ? { start: iso, end: plage.start } : { start: plage.start, end: iso };
}

// ─── Code à usage unique ─────────────────────────────────────────────────────

export interface EtatOtp {
  cases: string[];
  /** Case qui doit recevoir le focus. */
  focus: number;
  complet: boolean;
}

export function casesOtp(valeur: string, longueur: number): string[] {
  const chiffres = valeur.replace(/\D/g, '').slice(0, longueur);
  return Array.from({ length: longueur }, (_, i) => chiffres[i] ?? '');
}

/**
 * Saisie dans la case `index` : un chiffre avance d'une case ; plusieurs
 * chiffres (collage, remplissage automatique du code SMS ou de l'application)
 * remplissent à partir de la case — ou depuis la première si le code est entier.
 */
export function saisirOtp(cases: readonly string[], index: number, texte: string): EtatOtp {
  const n = cases.length;
  const chiffres = texte.replace(/\D/g, '');
  const suite = [...cases];
  if (chiffres === '') {
    suite[index] = '';
    return { cases: suite, focus: index, complet: false };
  }
  const depart = chiffres.length >= n ? 0 : index;
  let dernier = depart;
  for (let k = 0; k < chiffres.length && depart + k < n; k += 1) {
    suite[depart + k] = chiffres[k]!;
    dernier = depart + k;
  }
  return {
    cases: suite,
    focus: Math.min(dernier + 1, n - 1),
    complet: suite.every((c) => c !== ''),
  };
}

/** Retour arrière : vide la case, ou recule et vide la précédente si elle l'était déjà. */
export function effacerOtp(cases: readonly string[], index: number): EtatOtp {
  const suite = [...cases];
  if (suite[index] !== '') {
    suite[index] = '';
    return { cases: suite, focus: index, complet: false };
  }
  const precedente = Math.max(index - 1, 0);
  suite[precedente] = '';
  return { cases: suite, focus: precedente, complet: false };
}

// ─── Recherche et surlignage ─────────────────────────────────────────────────

/** Minuscules sans accents : « Société » et « societe » se trouvent l'un l'autre. */
export function normaliserRecherche(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export interface MorceauTexte {
  texte: string;
  correspond: boolean;
}

/** Découpe `texte` autour de la première occurrence de `requete` (sans accents ni casse). */
export function surligner(texte: string, requete: string): MorceauTexte[] {
  const q = normaliserRecherche(requete.trim());
  if (q === '') return [{ texte, correspond: false }];
  // Correspondance caractère par caractère : la normalisation peut changer la longueur.
  let norm = '';
  const origine: number[] = [];
  Array.from(texte).forEach((c, i) => {
    const n = normaliserRecherche(c);
    for (const x of n) {
      norm += x;
      origine.push(i);
    }
  });
  const chars = Array.from(texte);
  const pos = norm.indexOf(q);
  if (pos < 0) return [{ texte, correspond: false }];
  const debut = origine[pos]!;
  const fin = origine[pos + q.length - 1]! + 1;
  return [
    { texte: chars.slice(0, debut).join(''), correspond: false },
    { texte: chars.slice(debut, fin).join(''), correspond: true },
    { texte: chars.slice(fin).join(''), correspond: false },
  ].filter((m) => m.texte !== '');
}

/** Identifiant utilisable partout (`href="#…"`, sélecteurs) à partir de `useId()`. */
export function idSur(brut: string, prefixe = 'f'): string {
  return `${prefixe}${brut.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

export function correspondRecherche(
  textes: readonly (string | null | undefined)[],
  q: string,
): boolean {
  const r = normaliserRecherche(q.trim());
  if (r === '') return true;
  return textes.some((t) => t && normaliserRecherche(t).includes(r));
}

/** Liste de choix : un champ de recherche dès 8 options. */
export const SEUIL_RECHERCHE_SELECT = 8;

export function avecRecherche(nombre: number, force?: boolean): boolean {
  return force ?? nombre >= SEUIL_RECHERCHE_SELECT;
}

// ─── Navigation au clavier dans une liste ────────────────────────────────────

/**
 * Prochain index actif d'une liste (options désactivées sautées) pour une
 * touche ; `null` si la touche ne déplace rien. Pas de bouclage : en bas de la
 * liste, la flèche bas reste sur la dernière option (comportement natif).
 */
export function prochainIndex(
  actives: readonly boolean[],
  courant: number,
  touche: string,
): number | null {
  const n = actives.length;
  if (n === 0) return null;
  const premier = actives.indexOf(true);
  const dernier = actives.lastIndexOf(true);
  if (premier < 0) return null;
  const chercher = (depuis: number, pas: 1 | -1, limite: number): number => {
    for (let i = depuis; pas > 0 ? i <= limite : i >= limite; i += pas) {
      if (actives[i]) return i;
    }
    return courant < 0 ? (pas > 0 ? premier : dernier) : courant;
  };
  switch (touche) {
    case 'ArrowDown':
      return courant < 0 ? premier : chercher(courant + 1, 1, n - 1);
    case 'ArrowUp':
      return courant < 0 ? dernier : chercher(courant - 1, -1, 0);
    case 'Home':
      return premier;
    case 'End':
      return dernier;
    case 'PageDown':
      return chercher(Math.min(Math.max(courant, 0) + 10, n - 1), -1, 0);
    case 'PageUp':
      return chercher(Math.max(courant - 10, 0), 1, n - 1);
    default:
      return null;
  }
}

/** Recherche par première lettre dans une liste fermée (comme un `<select>` natif). */
export function indexParLettre(
  libelles: readonly string[],
  actives: readonly boolean[],
  depuis: number,
  saisie: string,
): number | null {
  const q = normaliserRecherche(saisie);
  if (q === '') return null;
  const n = libelles.length;
  for (let k = 1; k <= n; k += 1) {
    const i = (depuis + k + n) % n;
    if (actives[i] && normaliserRecherche(libelles[i]!).startsWith(q)) return i;
  }
  return null;
}

// ─── Récents (mémoire de la session, jamais le disque) ───────────────────────

/** Ajoute en tête, sans doublon, borné. Données clientes : la liste reste en mémoire. */
export function ajouterRecent<T>(
  liste: readonly T[],
  item: T,
  cle: (t: T) => string,
  max = 5,
): T[] {
  const k = cle(item);
  return [item, ...liste.filter((x) => cle(x) !== k)].slice(0, max);
}

// ─── Formulaire ──────────────────────────────────────────────────────────────

/** Cmd+Entrée (macOS) ou Ctrl+Entrée : enregistrer. */
export function estRaccourciEnregistrer(e: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): boolean {
  return e.key === 'Enter' && Boolean(e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
}

export interface ErreurResumee {
  /** Identifiant du contrôle à atteindre. */
  id: string;
  libelle: string;
  message: string;
}

/** Résumé d'erreurs dans l'ordre des champs ; une erreur sans libellé connu garde son message seul. */
export function resumerErreurs(
  erreurs: Readonly<Record<string, string | undefined>>,
  champs: readonly { cle: string; id: string; libelle: string }[],
): ErreurResumee[] {
  const vus = new Set<string>();
  const out: ErreurResumee[] = [];
  for (const c of champs) {
    const m = erreurs[c.cle];
    if (m) {
      out.push({ id: c.id, libelle: c.libelle, message: m });
      vus.add(c.cle);
    }
  }
  for (const [cle, m] of Object.entries(erreurs)) {
    if (m && !vus.has(cle)) out.push({ id: '', libelle: '', message: m });
  }
  return out;
}

export function phraseResume(n: number): string {
  return n <= 1 ? 'Un champ est à corriger.' : `${n} champs sont à corriger.`;
}

// ─── Téléphone ───────────────────────────────────────────────────────────────

export interface Indicatif {
  code: string;
  pays: string;
}

/** Indicatifs proposés ; +243 (RDC) par défaut. Liste d'affichage, aucune règle. */
export const INDICATIFS: readonly Indicatif[] = [
  { code: '+243', pays: 'RDC' },
  { code: '+242', pays: 'Congo' },
  { code: '+244', pays: 'Angola' },
  { code: '+250', pays: 'Rwanda' },
  { code: '+257', pays: 'Burundi' },
  { code: '+256', pays: 'Ouganda' },
  { code: '+255', pays: 'Tanzanie' },
  { code: '+260', pays: 'Zambie' },
  { code: '+236', pays: 'Centrafrique' },
  { code: '+237', pays: 'Cameroun' },
  { code: '+27', pays: 'Afrique du Sud' },
  { code: '+32', pays: 'Belgique' },
  { code: '+33', pays: 'France' },
  { code: '+1', pays: 'États-Unis, Canada' },
  { code: '+86', pays: 'Chine' },
  { code: '+971', pays: 'Émirats' },
];

/** Groupe un numéro national pour la lecture (RDC : 81 234 5678 ; ailleurs par trois). */
export function grouperNational(indicatif: string, national: string): string {
  const c = national.replace(/\D/g, '');
  if (indicatif === '+243') {
    return [c.slice(0, 2), c.slice(2, 5), c.slice(5, 9), c.slice(9)]
      .filter((p) => p !== '')
      .join(' ');
  }
  return (c.match(/.{1,3}/g) ?? []).join(' ');
}

/**
 * Sépare une valeur enregistrée en indicatif + numéro national. Un numéro
 * national (`0812345678`) prend l'indicatif par défaut et perd son 0 de tête ;
 * `00243…` vaut `+243…`.
 */
export function lireTelephone(
  valeur: string,
  defaut = '+243',
): { indicatif: string; national: string } {
  let v = valeur.trim().replace(/[^\d+]/g, '');
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  if (v.startsWith('+')) {
    const connu = [...INDICATIFS]
      .sort((a, b) => b.code.length - a.code.length)
      .find((i) => v.startsWith(i.code));
    if (connu) return { indicatif: connu.code, national: v.slice(connu.code.length) };
    return { indicatif: v.slice(0, 4), national: v.slice(4) };
  }
  return { indicatif: defaut, national: v.replace(/^0+/, '') };
}

/** Valeur lisible envoyée : `+243 81 234 5678` ; vide sans numéro national. */
export function ecrireTelephone(indicatif: string, national: string): string {
  const n = national.replace(/\D/g, '').replace(/^0+/, '');
  return n === '' ? '' : `${indicatif} ${grouperNational(indicatif, n)}`;
}

// ─── Jours marqués (fériés de l'organisation) ────────────────────────────────

/** Jour marqué : date ISO, nom ; `recurring` vaut chaque année (même jour, même mois). */
export interface JourMarque {
  date: string;
  label: string;
  recurring?: boolean | undefined;
}

/**
 * Index des jours marqués : rend le nom d'un jour (`undefined` s'il n'est pas
 * marqué). Une date précise l'emporte sur un jour récurrent ; deux noms le même
 * jour sont joints (« Fermeture · Fête du travail »). Purement informatif : un
 * jour marqué reste choisissable.
 */
export function indexerMarques(
  marks: readonly JourMarque[] | null | undefined,
): (iso: string) => string | undefined {
  const exacts = new Map<string, string>();
  const annuels = new Map<string, string>();
  for (const m of marks ?? []) {
    if (!estIsoValide(m.date) || m.label.trim() === '') continue;
    const cible = m.recurring ? annuels : exacts;
    const cle = m.recurring ? m.date.slice(5) : m.date;
    const deja = cible.get(cle);
    cible.set(cle, deja && deja !== m.label ? `${deja} · ${m.label}` : m.label);
  }
  return (iso) => exacts.get(iso) ?? annuels.get(iso.slice(5));
}

// ─── Mois (`AAAA-MM`, la valeur des champs natifs `type="month"`) ─────────────

const AAAA_MM = /^(\d{4})-(\d{2})$/;

/** Décompose un mois `AAAA-MM` valide ; `null` sinon. */
export function lireMoisIso(ym: string): { annee: number; mois: number } | null {
  const m = AAAA_MM.exec(ym);
  if (!m) return null;
  const annee = parseInt(m[1]!, 10);
  const mois = parseInt(m[2]!, 10);
  if (mois < 1 || mois > 12) return null;
  return { annee, mois };
}

export function moisDe(annee: number, mois1: number): string {
  return `${String(annee).padStart(4, '0')}-${pad2(mois1)}`;
}

/** Mois en cours dans le fuseau du navigateur. */
export function moisActuel(maintenant: Date = new Date()): string {
  return moisDe(maintenant.getFullYear(), maintenant.getMonth() + 1);
}

export function ajouterMoisCivils(ym: string, n: number): string {
  const d = lireMoisIso(ym);
  if (!d) throw new RangeError(`Mois invalide : ${ym}`);
  const total = d.annee * 12 + (d.mois - 1) + n;
  return moisDe(Math.floor(total / 12), (total % 12) + 1);
}

/** « nov. 2026 » ; chaîne vide pour une valeur vide ou invalide. */
export function formatMoisCourt(ym: string): string {
  const d = lireMoisIso(ym);
  return d ? `${MOIS_COURTS_FR[d.mois - 1]} ${d.annee}` : '';
}

/** « novembre 2026 » — nom accessible d'un mois. */
export function formatMoisLong(ym: string): string {
  const d = lireMoisIso(ym);
  return d ? `${MOIS_FR[d.mois - 1]} ${d.annee}` : '';
}

const MOIS_NORMALISES = MOIS_FR.map((m) => normaliserRecherche(m));

/** Numéro (1 à 12) d'un nom de mois, complet ou abrégé sans ambiguïté (« nov », « fév. ») ; `null` sinon. */
function moisParNom(brut: string): number | null {
  const t = normaliserRecherche(brut).replace(/\.$/, '');
  if (t.length < 3) return null;
  const exact = MOIS_NORMALISES.indexOf(t);
  if (exact >= 0) return exact + 1;
  const candidats = MOIS_NORMALISES.flatMap((m, i) => (m.startsWith(t) ? [i + 1] : []));
  return candidats.length === 1 ? candidats[0]! : null;
}

function annee4(a: string | undefined, reference: string): number {
  if (a === undefined) return parseInt(reference.slice(0, 4), 10);
  return a.length === 2 ? 2000 + parseInt(a, 10) : parseInt(a, 10);
}

/**
 * Saisie tolérante d'un mois : `2026-11` (ISO), `11/2026`, `11-26`, `11.2026`,
 * `11 2026`, `112026`, `11` (année de référence), `nov. 2026`, `novembre 26`,
 * `nov` ; accents et casse indifférents. `null` si rien ne se lit.
 */
export function lireMoisSaisi(texte: string, reference: string = moisActuel()): string | null {
  const t = texte.trim();
  if (t === '') return null;
  const valide = (a: number, m: number): string | null =>
    m >= 1 && m <= 12 && a >= 1 && a <= 9999 ? moisDe(a, m) : null;
  const iso = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (iso) return valide(parseInt(iso[1]!, 10), parseInt(iso[2]!, 10));
  const chiffres = /^(\d{1,2})(?:[/.\-\s]+(\d{2}|\d{4}))?$/.exec(t);
  if (chiffres) return valide(annee4(chiffres[2], reference), parseInt(chiffres[1]!, 10));
  const colle = /^(\d{2})(\d{4})$/.exec(t);
  if (colle) return valide(parseInt(colle[2]!, 10), parseInt(colle[1]!, 10));
  const nom = /^(\p{L}+\.?)(?:[\s/.\-]+(\d{2}|\d{4}))?$/u.exec(t);
  if (nom) {
    const m = moisParNom(nom[1]!);
    return m === null ? null : valide(annee4(nom[2], reference), m);
  }
  return null;
}

/** Déplacement du mois actif au clavier dans la grille de 3 colonnes × 4 lignes. */
export function deplacerMoisClavier(ym: string, touche: string): string | null {
  const d = lireMoisIso(ym);
  if (!d) return null;
  switch (touche) {
    case 'ArrowLeft':
      return ajouterMoisCivils(ym, -1);
    case 'ArrowRight':
      return ajouterMoisCivils(ym, 1);
    case 'ArrowUp':
      return ajouterMoisCivils(ym, -3);
    case 'ArrowDown':
      return ajouterMoisCivils(ym, 3);
    case 'Home':
      return moisDe(d.annee, 1);
    case 'End':
      return moisDe(d.annee, 12);
    case 'PageUp':
      return ajouterMoisCivils(ym, -12);
    case 'PageDown':
      return ajouterMoisCivils(ym, 12);
    default:
      return null;
  }
}

// ─── Garde de navigation interne (modifications non enregistrées) ────────────

/** Ce que le garde lit d'un clic (sous-ensemble de `MouseEvent`, pour les tests). */
export interface ClicLien {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

/** Ce que le garde lit d'un lien (sous-ensemble de `HTMLAnchorElement`). */
export interface LienCible {
  href: string;
  target: string;
  hasDownload: boolean;
}

/**
 * Le clic sur ce lien quitte-t-il l'écran courant DANS l'application ? Rend
 * l'adresse visée, ou `null` quand le garde doit laisser faire : clic modifié
 * (nouvel onglet), bouton autre que le gauche, clic déjà traité, `target`
 * autre que `_self`, téléchargement, autre origine, autre protocole
 * (`mailto:`, `tel:`), ou simple ancre dans la même page.
 */
export function navigationInterne(
  clic: ClicLien,
  lien: LienCible,
  actuelle: string,
): string | null {
  if (clic.defaultPrevented || clic.button !== 0) return null;
  if (clic.metaKey || clic.ctrlKey || clic.shiftKey || clic.altKey) return null;
  if (lien.hasDownload) return null;
  if (lien.target !== '' && lien.target !== '_self') return null;
  let cible: URL;
  let ici: URL;
  try {
    ici = new URL(actuelle);
    cible = new URL(lien.href, ici);
  } catch {
    return null;
  }
  if (cible.protocol !== 'http:' && cible.protocol !== 'https:') return null;
  if (cible.origin !== ici.origin) return null;
  if (cible.pathname === ici.pathname && cible.search === ici.search) return null;
  return cible.href;
}
