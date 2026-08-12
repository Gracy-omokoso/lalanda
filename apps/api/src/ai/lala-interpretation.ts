// Interprétation d'un résultat : lecture déterministe, réserves de portée,
// cadrage des prompts (S24a).
//
// ── Ce qu'est une interprétation, et ce qu'elle n'est pas ────────────────────
//
// Une interprétation LIT un chiffre : « votre DSCR ressort à 0,82, sous le
// repère de 1,25 ». Ce n'est pas une définition (« le DSCR mesure la
// couverture… ») — l'aide contextuelle existe déjà pour ça — ni une
// recommandation d'investissement, que ce produit ne doit jamais rendre :
// `docs/11 § Rôle de l'IA` interdit de « fournir un conseil juridique ou fiscal
// comme certain », et Lalanda sert à monter des dossiers bancaires, pas à
// placer de l'argent.
//
// ── Pourquoi une lecture déterministe existe TOUJOURS ────────────────────────
//
// Même motif que `ai-actions.service.ts` (S14a) : le texte est écrit à partir
// des seuls chiffres du moteur, sans réseau. Il sert de repli quand l'IA est
// indisponible, mais aussi de FILET quand l'IA répond mal — une interprétation
// qui cite un chiffre absent du moteur est remplacée par celle-ci
// (`lala-nombres.ts`).
//
// ── Langue ───────────────────────────────────────────────────────────────────
//
// `user-preferences.schema.ts` ne connaît que `fr`, délibérément. Rien n'est
// codé « fr » en dur pour autant : tout passe par `LANGUES`, qui `satisfies
// Record<SupportedLocale, …>`. Ajouter une langue à `SUPPORTED_LOCALES` sans
// écrire sa formulation NE COMPILE PAS — c'est la seule garantie qui survit à
// un ajout fait dans six mois par quelqu'un d'autre.

import { SUPPORTED_LOCALES, type SupportedLocale } from '../account/account.dto.js';
import type { EvaluateLine } from './ai-actions.dto.js';
import type { SourceChiffree } from './lala-nombres.js';

/**
 * Mention rendue sous CHAQUE interprétation et sous chaque réponse de Lala.
 *
 * Non négociable et posée côté serveur : une interface qui oublierait de
 * l'afficher laisserait passer un texte qui peut se lire comme un conseil en
 * investissement. Elle est donc renvoyée dans la réponse, pas laissée au client.
 */
export const MENTION_NON_CONSEIL =
  'Lecture d’un chiffre calculé par le moteur financier. Ce n’est ni un conseil ' +
  'en investissement, ni un conseil juridique, comptable ou fiscal.';

/**
 * Réserves de portée d'une feuille, injectées dans le prompt ET renvoyées à
 * l'interface.
 *
 * Le cas `tresorerie` n'est pas cosmétique (docs/07 § Limites connues) : la vue
 * mensuelle est OPTIMISTE — elle ignore la variation de BFR et les intérêts, et
 * diverge du bilan d'autant plus que le délai clients est long. Un assistant qui
 * la présenterait comme « la trésorerie » du projet induirait un banquier en
 * erreur. La réserve accompagne donc toute interprétation de cette feuille,
 * quelle que soit la source du texte.
 *
 * Elle double `SHEET_WARNINGS` côté web : le bandeau à l'écran et le cadrage du
 * modèle sont deux consommateurs différents, et le second ne doit pas dépendre
 * de ce que le client a bien voulu envoyer. À unifier le jour où l'API expose le
 * `label` de feuille du DSL, seule source de vérité (même note que
 * `results-model.ts`).
 */
const RESERVES_FEUILLE_FR: Record<string, string> = {
  tresorerie:
    'Vue mensuelle simplifiée de l’année 1 : elle ignore la variation du besoin en fonds ' +
    'de roulement et les intérêts d’emprunt. Elle est donc OPTIMISTE et diverge du bilan, ' +
    'd’autant plus que le délai de paiement clients est long. C’est le bilan qui fait foi : ' +
    'cette feuille ne doit jamais être présentée comme la trésorerie de référence du projet.',
};

/** Lignes dont le feu tricolore est calculé sur la vue de trésorerie simplifiée. */
const LIGNES_RATTACHEES_TRESORERIE = new Set(['tresorerie_min_ok']);

/**
 * Réserve applicable à une feuille — ou à une ligne dont le calcul s'appuie sur
 * une feuille réservée même si elle s'affiche ailleurs.
 *
 * `tresorerie_min_ok` vit dans la feuille `ratios` mais son feu vient de la vue
 * optimiste (docs/07). Sans ce rattachement, le ratio le plus regardé du
 * bandeau serait le seul à perdre sa réserve.
 */
export function reservePour(sheetId: string, lineId?: string, locale?: SupportedLocale): string | null {
  const reserves = reglagesLangue(locale).reserves;
  if (lineId && LIGNES_RATTACHEES_TRESORERIE.has(lineId)) return reserves['tresorerie'] ?? null;
  return reserves[sheetId] ?? null;
}

// ─── Langues ─────────────────────────────────────────────────────────────────

interface Formulation {
  /** Étiquette BCP-47 passée à `Intl` pour formater les nombres. */
  intl: string;
  /** Consigne de langue insérée dans le prompt système. */
  consigneLangue: string;
  reserves: Record<string, string>;
  /** Lecture d'une valeur : « « X » s'établit à Y. » */
  valeur(label: string, affichee: string): string;
  /** Position par rapport au repère du Country Pack. */
  position(direction: 'min' | 'max', seuil: string, cote: 'au-dessus' | 'en-dessous' | 'egal'): string;
  /** Glose du feu tricolore. */
  feu(statut: 'vert' | 'orange' | 'rouge'): string;
  /** Lecture d'une ligne sans repère. */
  sansRepere(signe: 'positif' | 'negatif' | 'nul'): string;
  /** Repli du chat quand l'assistant n'est pas joignable. */
  chatIndisponible(interpretation: string): string;
  /**
   * Repli du chat quand la réponse citait un chiffre absent du moteur.
   *
   * Distinct de `chatIndisponible` : dire « l'assistant est indisponible » alors
   * qu'il a répondu serait un mensonge, et docs/11 interdit de « masquer une
   * incertitude ». On nomme le refus et on redirige vers ce qui, lui, calcule.
   */
  chatChiffreRefuse(): string;
}

const FR: Formulation = {
  intl: 'fr-FR',
  consigneLangue: 'Réponds en français, dans un registre professionnel et sobre.',
  reserves: RESERVES_FEUILLE_FR,
  valeur: (label, affichee) => `« ${label} » s’établit à ${affichee}.`,
  position: (direction, seuil, cote) => {
    const compare = direction === 'min' ? 'au moins' : 'au plus';
    const ou =
      cote === 'egal'
        ? 'votre valeur est exactement au repère'
        : cote === 'au-dessus'
          ? 'votre valeur est au-dessus'
          : 'votre valeur est en dessous';
    return (
      `Le repère de référence attend ${compare} ${seuil} : ${ou}. ` +
      'Ce repère vient du Country Pack chargé pour ce projet; ce n’est pas une norme légale.'
    );
  },
  feu: (statut) =>
    statut === 'vert'
      ? 'Le feu est vert : la ligne est au niveau attendu.'
      : statut === 'orange'
        ? 'Le feu est orange : la ligne est en zone de vigilance.'
        : 'Le feu est rouge : la ligne est hors repère.',
  sansRepere: (signe) => {
    const nature =
      signe === 'positif'
        ? 'La valeur est positive'
        : signe === 'negatif'
          ? 'La valeur est négative'
          : 'La valeur est nulle';
    return (
      `${nature}. Aucun repère n’est attaché à cette ligne dans le pack chargé : ` +
      'elle se lit en tendance et en cohérence avec les autres feuilles, pas comme une réussite ou un échec.'
    );
  },
  chatIndisponible: (interpretation) =>
    'L’assistant n’est pas joignable pour le moment, je ne peux donc pas prolonger l’échange. ' +
    'Voici la lecture établie à partir des chiffres du moteur, qui reste valable : ' +
    `${interpretation} Réessayez dans quelques instants.`,
  chatChiffreRefuse: () =>
    'Je ne peux pas avancer ce chiffre : seul le moteur financier produit les valeurs de votre ' +
    'plan, et celle-ci n’en vient pas. Reformulez votre question à partir des montants affichés, ' +
    'ou modifiez une hypothèse dans la saisie pour que le moteur recalcule.',
};

/**
 * Registre des formulations, une entrée par langue réellement servie.
 *
 * `satisfies` plutôt qu'une annotation de type : il impose l'exhaustivité (une
 * langue ajoutée à `SUPPORTED_LOCALES` sans formulation casse la compilation)
 * SANS effacer le typage littéral des clés.
 */
const LANGUES = { fr: FR } satisfies Record<SupportedLocale, Formulation>;

/** Langue servie par défaut — la première déclarée comme supportée. */
export const LOCALE_PAR_DEFAUT: SupportedLocale = SUPPORTED_LOCALES[0];

/**
 * Formulations d'une langue. Une valeur inconnue (préférence écrite avant un
 * retrait de langue, par exemple) retombe sur la langue par défaut plutôt que
 * de faire échouer une lecture de résultats.
 */
export function reglagesLangue(locale: SupportedLocale | undefined): Formulation {
  return LANGUES[locale ?? LOCALE_PAR_DEFAUT] ?? LANGUES[LOCALE_PAR_DEFAUT];
}

// ─── Formatage ───────────────────────────────────────────────────────────────

/**
 * Rendu d'une valeur du moteur, aligné sur `formatValue` de
 * `apps/web/.../results-model.ts` : le nombre autorisé dans une interprétation
 * doit être celui que l'utilisateur a sous les yeux, sinon le garde-fou
 * rejetterait des citations correctes.
 */
export function formatValeur(
  value: number,
  format: EvaluateLine['format'],
  devise: string | undefined,
  locale: SupportedLocale | undefined,
): string {
  const intl = reglagesLangue(locale).intl;
  if (format === 'percent') {
    return new Intl.NumberFormat(intl, { style: 'percent', maximumFractionDigits: 2 }).format(value);
  }
  if (format === 'money' && devise) {
    return new Intl.NumberFormat(intl, {
      style: 'currency',
      currency: devise,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return new Intl.NumberFormat(intl, { maximumFractionDigits: 2 }).format(value);
}

/** Ligne du moteur enrichie de ses rendus — base commune au prompt et au garde-fou. */
export interface LigneAffichee {
  ligne: EvaluateLine;
  valeurAffichee: string;
  seuilAffiche: string | null;
}

export function decoreLignes(
  lines: readonly EvaluateLine[],
  devise: string | undefined,
  locale: SupportedLocale | undefined,
): LigneAffichee[] {
  return lines.map((ligne) => ({
    ligne,
    valeurAffichee: formatValeur(ligne.value, ligne.format, devise, locale),
    seuilAffiche: ligne.seuil
      ? formatValeur(ligne.seuil.valeur, ligne.format, devise, locale)
      : null,
  }));
}

/** Sources citables par le garde-fou numérique, pour une ligne décorée. */
export function sourceChiffree(l: LigneAffichee): SourceChiffree {
  return {
    valeur: l.ligne.value,
    valeurAffichee: l.valeurAffichee,
    label: l.ligne.label,
    seuil:
      l.ligne.seuil && l.seuilAffiche
        ? { valeur: l.ligne.seuil.valeur, valeurAffichee: l.seuilAffiche }
        : undefined,
  };
}

// ─── Lecture déterministe ────────────────────────────────────────────────────

/**
 * Interprétation écrite sans réseau, à partir des seuls chiffres du moteur.
 *
 * Elle ne prescrit rien : elle situe la valeur, la compare à son repère quand il
 * existe, et rappelle la réserve de portée de sa feuille. Les actions à mener
 * relèvent de `/ai/corrective-actions` (S14a), pas d'une bulle de lecture.
 */
export function interpretationDeterministe(
  l: LigneAffichee,
  options: { sheetId: string; locale?: SupportedLocale },
): string {
  const f = reglagesLangue(options.locale);
  const morceaux: string[] = [f.valeur(l.ligne.label, l.valeurAffichee)];

  const seuil = l.ligne.seuil;
  if (seuil && l.seuilAffiche) {
    const cote =
      l.ligne.value === seuil.valeur ? 'egal' : l.ligne.value > seuil.valeur ? 'au-dessus' : 'en-dessous';
    morceaux.push(f.position(seuil.direction, l.seuilAffiche, cote));
    morceaux.push(f.feu(seuil.statut));
  } else {
    const signe = l.ligne.value > 0 ? 'positif' : l.ligne.value < 0 ? 'negatif' : 'nul';
    morceaux.push(f.sansRepere(signe));
  }

  const reserve = reservePour(options.sheetId, l.ligne.lineId, options.locale);
  if (reserve) morceaux.push(reserve);

  return morceaux.join(' ');
}
