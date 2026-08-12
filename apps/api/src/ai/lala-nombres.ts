// Vérification des citations numériques d'une interprétation (S24a).
//
// ── Pourquoi ce fichier existe ───────────────────────────────────────────────
//
// `CLAUDE.md` : « le moteur financier est l'unique source de vérité des calculs »
// et « l'IA explique; elle ne produit pas les calculs officiels ». docs/11 § Garde-fous
// en tire une obligation opérationnelle : « vérification des nombres cités contre
// les résultats du moteur ».
//
// Un prompt qui DEMANDE de ne pas inventer de chiffre n'est pas une vérification :
// c'est un souhait. Ici la règle est vérifiée APRÈS coup, sur le texte rendu, et
// une interprétation qui cite un nombre absent du moteur est REJETÉE — elle
// retombe alors sur le texte déterministe. Un dossier bancaire ne peut pas
// porter un chiffre que personne n'a calculé.
//
// ── La règle exacte ──────────────────────────────────────────────────────────
//
// Un nombre est autorisé s'il apparaît dans **ce qui a été fourni au modèle** :
// la valeur d'une ligne, son seuil, leurs rendus formatés, les nombres déjà
// présents dans les libellés du moteur (« exercice 3 ») et dans les réserves de
// portée injectées (« sur 12 mois »). Rien d'autre. Le zéro est admis d'office :
// il sert de repère de signe (« au-dessus de zéro ») sans rien affirmer.
//
// ── Pourquoi une canonisation « française » ──────────────────────────────────
//
// Lala répond en français : ses nombres sont écrits « 1 234,56 », le moteur les
// produit en flottant `1234.56`. Comparer les chaînes serait inutile; comparer
// des nombres canonisés est le seul rapprochement fiable. La lecture retenue
// suit fr-FR : la virgule est TOUJOURS décimale, l'espace (y compris insécable
// et fine insécable) est TOUJOURS un séparateur de milliers, et le point est
// tranché par la taille du groupe qui le suit.

/** Espaces utilisés comme séparateurs de milliers, y compris insécables. */
const ESPACES = /[\s\u00A0\u202F\u2009']/g;

/**
 * Forme canonique d'un nombre : chaîne décimale sans zéros inutiles.
 *
 * `toFixed(6)` puis rognage plutôt que `String(n)` : `String(0.1+0.2)` donne
 * `'0.30000000000000004'`, qui ne rapprocherait jamais un « 0,3 » écrit par le
 * modèle. Six décimales couvrent largement les grandeurs financières du moteur
 * (le plus fin est un ratio, pas une fraction de centime).
 *
 * Retourne `null` pour un nombre non fini ou hors de la plage où `toFixed`
 * reste décimal (≥ 1e21 bascule en notation exponentielle) : un tel nombre
 * n'est de toute façon pas citable dans une phrase.
 */
export function nombreCanonique(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n) >= 1e15) return null;
  const fixe = n.toFixed(6);
  const rogne = fixe.includes('.') ? fixe.replace(/0+$/, '').replace(/\.$/, '') : fixe;
  // `-0` et `0` sont le même repère de signe.
  return rogne === '-0' ? '0' : rogne;
}

/**
 * Canonise un nombre TEL QU'ÉCRIT dans une phrase française.
 *
 * Retourne `null` si le fragment n'est pas lisible comme un nombre — le cas ne
 * doit pas faire échouer la vérification, il doit seulement ne rien autoriser.
 */
export function canoniseTokenFr(token: string): string | null {
  const s = token.replace(ESPACES, '');
  if (s === '') return null;

  let normalise: string;

  if (s.includes(',')) {
    // La virgule est décimale en français. Plusieurs virgules = fragment
    // douteux (« 1,2,3 ») : on ne l'autorise pas plutôt que de deviner.
    if ((s.match(/,/g) ?? []).length > 1) return null;
    normalise = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes('.')) {
    const parts = s.split('.');
    const groupesDeTrois = parts.slice(1).every((p) => p.length === 3);
    // « 0.185 » : personne n'écrit un séparateur de milliers derrière un zéro
    // seul — c'est une décimale (typiquement une valeur brute du moteur
    // recopiée telle quelle). Sinon, des groupes de trois sont des milliers.
    const estGroupement = groupesDeTrois && parts[0] !== '0' && parts[0] !== '';
    normalise = estGroupement ? parts.join('') : parts.length === 2 ? s : '';
    if (normalise === '') return null;
  } else {
    normalise = s;
  }

  if (!/^-?\d+(\.\d+)?$/.test(normalise)) return null;
  return nombreCanonique(Number(normalise));
}

/**
 * Fragments numériques d'un texte, sous forme canonique.
 *
 * Le motif s'arrête au premier caractère non numérique : « 12 mois » rend
 * « 12 », « 1 234,56 USD » rend « 1234.56 ». Les nombres illisibles sont
 * ignorés silencieusement côté ENTRÉE autorisée, mais comptés comme non
 * vérifiables côté SORTIE (voir `chiffresNonAutorises`).
 */
export function fragmentsNumeriques(texte: string): string[] {
  const bruts = texte.match(/\d[\d\u00A0\u202F\u2009 ,.']*\d|\d/g) ?? [];
  return bruts;
}

/** Ensemble canonique des nombres extraits d'un texte. */
export function tokensNumeriques(texte: string): Set<string> {
  const out = new Set<string>();
  for (const brut of fragmentsNumeriques(texte)) {
    const c = canoniseTokenFr(brut);
    if (c !== null) out.add(c);
  }
  return out;
}

/** Élément du moteur dont les nombres deviennent citables. */
export interface SourceChiffree {
  /** Valeur brute produite par le moteur. */
  valeur: number;
  /** Rendu affiché de cette valeur (ce que l'utilisateur lit à l'écran). */
  valeurAffichee: string;
  /** Libellé de la ligne, tel que déclaré par le moteur. */
  label: string;
  seuil?: { valeur: number; valeurAffichee: string };
}

/**
 * Construit l'ensemble des nombres qu'une interprétation a le droit de citer.
 *
 * `textesContexte` porte les textes injectés dans le prompt qui contiennent
 * légitimement des nombres — réserve de portée d'une feuille (« sur 12 mois »),
 * libellé de la feuille. Sans eux, une interprétation correcte qui reprend la
 * réserve serait rejetée.
 */
export function construireChiffresAutorises(
  sources: readonly SourceChiffree[],
  textesContexte: readonly string[] = [],
): Set<string> {
  // Zéro : repère de signe, il n'affirme aucune grandeur.
  const autorises = new Set<string>(['0']);

  const ajouteNombre = (n: number): void => {
    // La MAGNITUDE seule est comparée : le motif d'extraction ne capture pas le
    // signe, qui est porté par la prose (« un déficit de 1 500 », « −1 500 »).
    // Sans `Math.abs`, toute interprétation d'un résultat négatif serait rejetée.
    // Le signe reste vérifié ailleurs : le texte déterministe le nomme, et le
    // modèle reçoit la valeur signée.
    for (const v of [n, Math.abs(n)]) {
      const c = nombreCanonique(v);
      if (c !== null) autorises.add(c);
      // Un pourcentage est stocké en fraction (0,185) et lu en points (18,5) :
      // les deux écritures désignent la même grandeur du moteur.
      const cent = nombreCanonique(v * 100);
      if (cent !== null) autorises.add(cent);
    }
  };
  const ajouteTexte = (t: string): void => {
    for (const tok of tokensNumeriques(t)) autorises.add(tok);
  };

  for (const s of sources) {
    ajouteNombre(s.valeur);
    ajouteTexte(s.valeurAffichee);
    ajouteTexte(s.label);
    if (s.seuil) {
      ajouteNombre(s.seuil.valeur);
      ajouteTexte(s.seuil.valeurAffichee);
    }
  }
  for (const t of textesContexte) ajouteTexte(t);

  return autorises;
}

/**
 * Nombres cités par `texte` qui ne viennent pas du moteur.
 *
 * Un fragment illisible (`canoniseTokenFr` → `null`) est signalé tel quel :
 * mieux vaut rejeter une interprétation dont on ne sait pas lire un nombre que
 * la publier en espérant qu'il soit juste.
 */
export function chiffresNonAutorises(texte: string, autorises: ReadonlySet<string>): string[] {
  const fautifs: string[] = [];
  for (const brut of fragmentsNumeriques(texte)) {
    const c = canoniseTokenFr(brut);
    if (c === null || !autorises.has(c)) fautifs.push(brut);
  }
  return fautifs;
}
