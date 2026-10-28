// Questionnaire de cadrage du modèle générique (S23b) — logique pure, testable seule.
//
// ══ LA RÈGLE QUI STRUCTURE CE FICHIER ═══════════════════════════════════════
//
// Le questionnaire mélange deux natures de réponses, et les confondre serait une
// faute grave :
//
//   • une réponse en TEXTE (le problème, la solution, les clients, les coûts)
//     alimente le Business Model Canvas, et lui seul. Elle ne produit AUCUN
//     chiffre;
//   • un chiffre du plan financier est DEMANDÉ comme un nombre, dans un champ
//     numérique, avec son unité et ses bornes — exactement comme l'assistant de
//     saisie le fait déjà.
//
// On n'extrait JAMAIS un montant d'une phrase libre, ni par expression régulière,
// ni par l'IA. « Mon coût de revient tourne autour de 12 000 » ne doit pas devenir
// `cout_revient: 12000`. Un chiffre deviné qui atterrit dans un dossier bancaire
// est le pire défaut que ce produit puisse produire — et personne ne le verrait,
// puisqu'il aurait l'air d'un chiffre saisi (CLAUDE.md : « le moteur financier est
// l'unique source de vérité des calculs », « ne pas inventer de règle financière »).
//
// Cette règle n'est pas seulement documentée, elle est PORTÉE PAR LES TYPES :
// `QuestionTexte` et `QuestionChoix` ne possèdent pas de champ `driverId`, et
// `QuestionNombre` ne possède pas de champ `bloc`. Écrire un jour un driver à
// partir d'une réponse en texte demanderait donc de modifier ce fichier, pas
// seulement de se tromper ailleurs. `custom-questionnaire-model.test.ts` le
// vérifie en plus à l'exécution, avec des réponses en texte truffées de chiffres.
//
// ══ Les métadonnées financières ne sont pas dupliquées ══════════════════════
//
// Une question numérique ne porte QUE l'id du driver qu'elle remplit et sa
// formulation en langage courant. Le libellé technique, l'unité, la devise, les
// bornes et l'aide viennent du template (`TemplateDriverMeta`) : le champ affiché
// est le composant `WizardField` de l'assistant, avec sa validation à trois
// niveaux. Recopier ici une borne ou une unité créerait une seconde vérité qui
// divergerait au premier changement de template.

import { CANVAS_BLOCKS, type CanvasBlockId, type CanvasBlocks, type CanvasCard } from '@/lib/api';
import type { TemplateDriverMeta } from '@/lib/api';

import { parseInput } from './wizard-model';

/** Slug du modèle générique — le seul qui ouvre ce questionnaire. */
export const CUSTOM_TEMPLATE_SLUG = 'custom';

/** Longueur maximale d'une carte de Canvas côté API (`CANVAS_MAX_CARD_TEXT`). */
const MAX_TEXTE_CARTE = 500;

// ─── Questions ────────────────────────────────────────────────

/** Le nom du projet — ni Canvas, ni driver : il nomme le projet lui-même. */
export interface QuestionNomProjet {
  readonly id: string;
  readonly kind: 'nom_projet';
  readonly question: string;
  readonly aide: string;
  readonly placeholder: string;
}

/** Réponse libre → une carte du Canvas. Aucun champ `driverId` : par construction. */
export interface QuestionTexte {
  readonly id: string;
  readonly kind: 'texte';
  readonly question: string;
  readonly aide: string;
  readonly placeholder: string;
  readonly bloc: CanvasBlockId;
}

/** Réponse à choisir dans une liste fermée → une carte du Canvas. */
export interface QuestionChoix {
  readonly id: string;
  readonly kind: 'choix';
  readonly question: string;
  readonly aide: string;
  readonly options: readonly string[];
  readonly bloc: CanvasBlockId;
  /** Texte de la carte produite, `{reponse}` remplacé par l'option choisie. */
  readonly gabarit: string;
}

/** Champ numérique → un driver du moteur. Aucun champ `bloc` : par construction. */
export interface QuestionNombre {
  readonly id: string;
  readonly kind: 'nombre';
  readonly question: string;
  /** Id du driver rempli. Libellé, unité, bornes et aide viennent du template. */
  readonly driverId: string;
}

export type QuestionCadrage = QuestionNomProjet | QuestionTexte | QuestionChoix | QuestionNombre;

/**
 * Le parcours, dans l'ordre d'affichage : un champ par étape (demande du
 * décideur). Les questions en texte d'abord — on parle du projet avant d'en
 * parler en chiffres —, les questions numériques ensuite, dans l'ordre même de
 * l'assistant de saisie (CA → coûts → charges), pour que la suite du parcours
 * soit la continuation naturelle de celui-ci et non un second départ.
 *
 * Les deux blocs BMC non couverts (`relations_clients`, `activites_cles`) restent
 * vides et se remplissent dans l'écran Canvas : mieux vaut un questionnaire qu'on
 * termine et un Canvas à compléter, qu'un questionnaire de vingt écrans qu'on
 * abandonne au tiers.
 */
export const QUESTIONS: readonly QuestionCadrage[] = [
  {
    id: 'nom_projet',
    kind: 'nom_projet',
    question: 'Comment s’appelle votre projet ?',
    aide: 'C’est le nom qui apparaîtra en tête de votre plan financier. Vous pourrez le changer.',
    placeholder: 'Ex : Mon activité 2026',
  },
  {
    id: 'nature_offre',
    kind: 'choix',
    question: 'Vendez-vous un produit, un service, ou les deux ?',
    aide: 'Cela décide de la suite : un produit s’achète et se stocke, un service se facture en temps passé.',
    options: ['Un produit', 'Un service', 'Les deux'],
    bloc: 'revenus',
    gabarit: 'Nature de l’offre : {reponse}',
  },
  {
    id: 'probleme',
    kind: 'texte',
    question: 'Quel problème vos futurs clients rencontrent-ils aujourd’hui ?',
    aide: 'Décrivez la situation avant vous : ce qui manque, ce qui coûte trop cher, ce qui prend trop de temps.',
    placeholder: 'Ex : ils doivent faire deux heures de route pour trouver ce produit.',
    bloc: 'proposition_valeur',
  },
  {
    id: 'solution',
    kind: 'texte',
    question: 'Comment le résolvez-vous ?',
    aide: 'Votre réponse à ce problème, en une ou deux phrases. Pas encore le détail de l’offre.',
    placeholder: 'Ex : je l’apporte à moins de dix minutes de chez eux.',
    bloc: 'proposition_valeur',
  },
  {
    id: 'offre',
    kind: 'texte',
    question: 'Concrètement, qu’achète-t-on chez vous ?',
    aide: 'Ce que le client repart avec, ou ce que vous lui livrez. Le plus précis possible.',
    placeholder: 'Ex : trois gammes, de la plus courante à la plus technique.',
    bloc: 'proposition_valeur',
  },
  {
    id: 'clients',
    kind: 'texte',
    question: 'À qui vendez-vous, précisément ?',
    aide: 'Vos clients types. « Tout le monde » n’est pas une réponse utile — ni pour vous, ni pour un banquier.',
    placeholder: 'Ex : les familles du quartier, et les artisans qui travaillent à côté.',
    bloc: 'segments_clients',
  },
  {
    id: 'canaux',
    kind: 'texte',
    question: 'Par où passez-vous pour vendre et pour livrer ?',
    aide: 'Boutique, tournée, réseaux sociaux, bouche-à-oreille, revendeurs, livraison…',
    placeholder: 'Ex : sur place, plus des commandes reçues par téléphone.',
    bloc: 'canaux',
  },
  {
    id: 'ressources',
    kind: 'texte',
    question: 'De quoi avez-vous besoin pour démarrer ?',
    aide: 'Le local, le matériel, les personnes, les autorisations. Ce sont eux qui deviendront vos investissements.',
    placeholder: 'Ex : un local, deux personnes, du matériel et un véhicule.',
    bloc: 'ressources_cles',
  },
  {
    id: 'partenaires',
    kind: 'texte',
    question: 'Sur qui comptez-vous : fournisseurs, partenaires ?',
    aide: 'Ceux sans qui vous ne pouvez pas livrer votre promesse. Leurs délais de paiement pèseront sur votre trésorerie.',
    placeholder: 'Ex : un fournisseur principal, et un transporteur.',
    bloc: 'partenaires_cles',
  },
  {
    id: 'couts',
    kind: 'texte',
    question: 'Qu’est-ce qui vous coûtera le plus cher ?',
    aide: 'Votre intuition suffit ici. Les montants se saisissent aux étapes suivantes et dans l’assistant.',
    placeholder: 'Ex : les achats de marchandise, puis les salaires.',
    bloc: 'couts',
  },

  // ── Questions NUMÉRIQUES ────────────────────────────────────
  // Chacune remplit un driver et un seul. La formulation est en langage courant;
  // le libellé technique, l'unité et les bornes viennent du template.
  {
    id: 'q_ca_moyen_jour',
    kind: 'nombre',
    question: 'Un jour ordinaire, combien pensez-vous encaisser ?',
    driverId: 'ca_moyen_jour',
  },
  {
    id: 'q_jours_ouverture_mois',
    kind: 'nombre',
    question: 'Combien de jours par mois allez-vous vendre ?',
    driverId: 'jours_ouverture_mois',
  },
  {
    // Question du décideur : « c'est quoi votre coût de revient ? ». Elle est posée
    // ici comme une MARGE, pas comme un coût — voir la note « Décisions remontées »
    // du rapport. Le moteur n'a pas de driver « coût de revient » : traduire une
    // réponse en coût vers `marge_brute_pct` supposerait de connaître le prix de
    // vente unitaire, que rien ne demande. On pose donc directement la grandeur
    // que le moteur consomme.
    id: 'q_marge_brute_pct',
    kind: 'nombre',
    question:
      'Sur 100 encaissés, combien vous reste-t-il une fois payé ce que la vente vous a directement coûté ?',
    driverId: 'marge_brute_pct',
  },
  {
    id: 'q_personnel_mois',
    kind: 'nombre',
    question: 'Combien verserez-vous en salaires chaque mois ?',
    driverId: 'personnel_mois',
  },
  {
    id: 'q_loyer_mois',
    kind: 'nombre',
    question: 'Et en loyer, chaque mois ?',
    driverId: 'loyer_mois',
  },
] as const;

/** Réponses saisies, indexées par `question.id`. Toujours du texte brut. */
export type Reponses = Readonly<Record<string, string>>;

/** Ids des drivers que le questionnaire peut remplir — utile aux tests et à l'UI. */
export const DRIVERS_DU_QUESTIONNAIRE: readonly string[] = QUESTIONS.filter(
  (q): q is QuestionNombre => q.kind === 'nombre',
).map((q) => q.driverId);

// ─── Sorties ──────────────────────────────────────────────────

/** Nom du projet saisi, nettoyé. Chaîne vide si l'étape a été passée. */
export function nomProjet(reponses: Reponses): string {
  const q = QUESTIONS.find((x) => x.kind === 'nom_projet');
  return q ? (reponses[q.id] ?? '').trim() : '';
}

/**
 * Texte de la carte produite par une question de Canvas, ou `null` si l'étape a
 * été passée ou laissée vide. Une carte vide est refusée par l'API et n'apprend
 * rien : on ne l'écrit pas.
 */
function texteCarte(q: QuestionTexte | QuestionChoix, reponses: Reponses): string | null {
  const brut = (reponses[q.id] ?? '').trim();
  if (brut === '') return null;
  const texte = q.kind === 'choix' ? q.gabarit.replace('{reponse}', brut) : brut;
  return texte.slice(0, MAX_TEXTE_CARTE);
}

/**
 * Construit les neuf blocs du Canvas à partir des réponses EN TEXTE.
 *
 * Les neuf blocs sont toujours présents (l'API refuse un `PUT` partiel), les
 * blocs sans réponse restent vides. Les ids de cartes sont déterministes
 * (`cadrage-<question>`) : rejouer le questionnaire met la carte à jour au lieu
 * d'en empiler une seconde.
 */
export function buildCanvasBlocks(reponses: Reponses): CanvasBlocks {
  const blocs = {} as CanvasBlocks;
  for (const b of CANVAS_BLOCKS) blocs[b] = [];

  for (const q of QUESTIONS) {
    if (q.kind !== 'texte' && q.kind !== 'choix') continue;
    const texte = texteCarte(q, reponses);
    if (texte === null) continue;
    const carte: CanvasCard = {
      id: `cadrage-${q.id}`,
      texte,
      ordre: blocs[q.bloc].length,
    };
    blocs[q.bloc] = [...blocs[q.bloc], carte];
  }
  return blocs;
}

/** Nombre de cartes réellement produites — sert le récapitulatif de préremplissage. */
export function compterCartes(blocs: CanvasBlocks): number {
  return CANVAS_BLOCKS.reduce((n, b) => n + blocs[b].length, 0);
}

/** Vrai si au moins une carte serait écrite. Évite un `PUT` (et une révision) vide. */
export function aDesCartes(blocs: CanvasBlocks): boolean {
  return compterCartes(blocs) > 0;
}

/**
 * Construit les valeurs de drivers à partir des réponses NUMÉRIQUES uniquement.
 *
 * Seules les questions de type `nombre` sont lues — aucune réponse en texte n'est
 * inspectée, à aucun moment. Une réponse vide ou illisible ne pose rien : le
 * driver retombera sur le défaut du modèle dans l'assistant, avec son badge
 * « Valeur suggérée ».
 *
 * Une valeur hors bornes est POSÉE malgré tout, volontairement : la faire
 * disparaître en silence serait pire que l'afficher en rouge dans l'assistant,
 * où l'utilisateur la voit et la corrige (docs/06 : « les erreurs bloquantes
 * empêchent la validation, pas la sauvegarde »).
 *
 * Les pourcentages suivent la conversion de l'assistant (saisis en points,
 * stockés en fraction) — même fonction `parseInput`, jamais une seconde.
 */
export function buildDriverValues(
  reponses: Reponses,
  drivers: readonly TemplateDriverMeta[],
): Record<string, number> {
  const parDriverId = new Map(drivers.map((d) => [d.id, d]));
  const out: Record<string, number> = {};

  for (const q of QUESTIONS) {
    if (q.kind !== 'nombre') continue;
    const driver = parDriverId.get(q.driverId);
    // Un driver disparu du template ne fait pas tomber le parcours : la question
    // est simplement sans effet (l'UI la masque également).
    if (!driver) continue;
    const valeur = parseInput(driver, reponses[q.id] ?? '');
    if (valeur === null) continue;
    out[driver.id] = valeur;
  }
  return out;
}

/**
 * Questions réellement affichables pour un template donné : une question
 * numérique dont le driver n'existe pas est retirée du parcours plutôt que
 * rendue avec un champ vide et sans libellé.
 */
export function questionsAffichables(
  drivers: readonly TemplateDriverMeta[],
): readonly QuestionCadrage[] {
  const ids = new Set(drivers.map((d) => d.id));
  return QUESTIONS.filter((q) => q.kind !== 'nombre' || ids.has(q.driverId));
}
