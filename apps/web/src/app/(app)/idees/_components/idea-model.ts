// Logique pure de l'Idea Lab (ADR-0036).
//
// Isolée du rendu pour être testable (vitest en environnement `node`, sans DOM).
// Trois règles :
//
// 1. AUCUN CALCUL. Score, taux, seuils et classement viennent du moteur par
//    l'API ; ce module les MET EN FORME et prépare les corps de requête.
// 2. RIEN N'AUTORISE. Masquer un bouton est un confort : l'API refuse de toute
//    façon.
// 3. RIEN N'EST INVENTÉ. Une taille de marché ne part jamais sans sa source ; une
//    suggestion de l'IA ne s'applique qu'au formulaire, que l'utilisateur
//    enregistre lui-même.

import type { OrgAction } from '@/lib/api';
import type {
  AssistAnswer,
  CriterionState,
  ExperimentBody,
  ExperimentConclusion,
  ExperimentStatus,
  ExperimentType,
  Hypothesis,
  IdeaFicheBody,
  IdeaView,
  MarketUnit,
  ValidationLevel,
  ValidationScore,
} from '@/lib/idea-lab-api';

export const IDEES_BASE = '/idees';

export interface IdeesTab {
  segment: 'idees' | 'validation';
  href: string;
  label: string;
}

export const IDEES_TABS: readonly IdeesTab[] = [
  { segment: 'idees', href: IDEES_BASE, label: 'Idées' },
  { segment: 'validation', href: `${IDEES_BASE}/validation`, label: 'Validation' },
];

/** Onglet allumé : « Validation » sur `/idees/validation`, « Idées » partout ailleurs sous `/idees`. */
export function ongletIdees(pathname: string): IdeesTab['segment'] | null {
  if (pathname !== IDEES_BASE && !pathname.startsWith(`${IDEES_BASE}/`)) return null;
  return pathname === `${IDEES_BASE}/validation` ? 'validation' : 'idees';
}

/** Sous-onglets d'une idée. */
export function ongletsIdee(
  id: string,
): { href: string; label: string; segment: 'fiche' | 'validation' }[] {
  const b = `${IDEES_BASE}/${encodeURIComponent(id)}`;
  return [
    { href: b, label: 'Fiche', segment: 'fiche' },
    { href: `${b}/validation`, label: 'Validation', segment: 'validation' },
  ];
}

export function droitsIdees(actions: readonly OrgAction[] | null): {
  modifier: boolean;
  reglerIa: boolean;
} {
  return {
    modifier: actions !== null && actions.includes('canvas.update'),
    reglerIa: actions !== null && actions.includes('organization.manage'),
  };
}

/** Lien vers la création de projet existante, ouverte depuis une idée (ADR-0036 § 3). */
export function lienNouveauProjet(ideaId: string): string {
  return `/initiatives?idee=${encodeURIComponent(ideaId)}`;
}

/** Identifiant d'idée lu dans `?idee=` : 24 caractères hexadécimaux, sinon `null`. */
export function ideeDepuisRecherche(search: string): string | null {
  const v = new URLSearchParams(search).get('idee');
  return v !== null && /^[0-9a-f]{24}$/.test(v) ? v : null;
}

// ─── Libellés ───────────────────────────────────────────────────────────────

export const LIBELLES_TYPES: Readonly<Record<ExperimentType, string>> = {
  entretiens: 'Entretiens clients',
  page_attente: 'Page d’attente',
  pre_commande: 'Pré-commande',
  autre: 'Autre expérience',
};

export const LIBELLES_STATUTS: Readonly<Record<ExperimentStatus, string>> = {
  a_faire: 'À faire',
  en_cours: 'En cours',
  terminee: 'Terminée',
};

export const LIBELLES_CONCLUSIONS: Readonly<Record<ExperimentConclusion, string>> = {
  confirmee: 'Hypothèse confirmée',
  infirmee: 'Hypothèse infirmée',
  non_concluante: 'Non concluante',
};

export const LIBELLES_UNITES: Readonly<Record<MarketUnit, string>> = {
  personnes: 'personnes',
  menages: 'ménages',
  entreprises: 'entreprises',
  montant: 'montant',
};

export const LIBELLES_ETATS_CRITERE: Readonly<Record<CriterionState, string>> = {
  renseigne: 'Noté avec une preuve',
  non_renseigne: 'Non noté',
  preuve_manquante: 'Preuve manquante',
  source_manquante: 'Taille de marché sans source',
};

/** Champs de résultats saisis, par type d'expérience. */
export const CHAMPS_RESULTATS: Readonly<
  Record<ExperimentType, { cle: keyof ExperimentBody['results']; libelle: string }[]>
> = {
  entretiens: [
    { cle: 'realises', libelle: 'Entretiens réalisés' },
    { cle: 'confirmant', libelle: 'Confirmant le problème' },
  ],
  page_attente: [
    { cle: 'visiteurs', libelle: 'Visiteurs' },
    { cle: 'inscrits', libelle: 'Inscrits' },
  ],
  pre_commande: [
    { cle: 'sollicites', libelle: 'Personnes sollicitées' },
    { cle: 'precommandes', libelle: 'Pré-commandes' },
  ],
  autre: [],
};

export function tonNiveau(niveau: ValidationLevel | null): 'ok' | 'warn' | 'ko' | 'neutre' {
  if (niveau === 'prometteuse') return 'ok';
  if (niveau === 'a_consolider') return 'warn';
  if (niveau === 'fragile') return 'ko';
  return 'neutre';
}

/** Score affiché : « 69 / 100 » ou « Indisponible » — jamais un 0 par défaut. */
export function libelleScore(score: ValidationScore): string {
  return score.disponible ? `${score.valeur} / 100` : 'Indisponible';
}

/** Ratio du moteur affiché en pourcentage à la française (0,7500 → « 75 % »). */
export function formatPct(ratio: number): string {
  return `${(Math.round(ratio * 1000) / 10).toLocaleString('fr-FR')} %`;
}

/** Valeur décimale saisie (« 1 200 », « 1200,5 ») → chaîne décimale de l'API, ou `null`. */
export function normaliseDecimal(saisie: string): string | null {
  const s = saisie.replace(/[\s  ]/g, '').replace(',', '.');
  return /^\d{1,15}(\.\d{1,2})?$/.test(s) ? s : null;
}

/** Entier saisi, ou `null` si vide ; `undefined` si illisible. */
export function normaliseEntier(saisie: string): number | null | undefined {
  const s = saisie.replace(/[\s  ]/g, '');
  if (s === '') return null;
  return /^\d{1,8}$/.test(s) ? Number(s) : undefined;
}

// ─── Formulaire de fiche ────────────────────────────────────────────────────

export interface FicheForm {
  title: string;
  problem: string;
  target: string;
  solution: string;
  revenueModel: string;
  country: string;
  market: string;
  alternatives: { name: string; description: string; source: string }[];
  hypotheses: Hypothesis[];
  marche: {
    value: string;
    unit: MarketUnit;
    currency: string;
    scope: string;
    source: string;
    sourceDate: string;
    sourceUrl: string;
  };
}

export function ficheVide(): FicheForm {
  return {
    title: '',
    problem: '',
    target: '',
    solution: '',
    revenueModel: '',
    country: 'CD',
    market: '',
    alternatives: [],
    hypotheses: [],
    marche: {
      value: '',
      unit: 'personnes',
      currency: '',
      scope: '',
      source: '',
      sourceDate: '',
      sourceUrl: '',
    },
  };
}

export function ficheDepuisIdee(idea: IdeaView): FicheForm {
  const m = idea.marketSize;
  return {
    title: idea.title,
    problem: idea.problem,
    target: idea.target,
    solution: idea.solution,
    revenueModel: idea.revenueModel,
    country: idea.country ?? '',
    market: idea.market,
    alternatives: idea.alternatives.map((a) => ({
      name: a.name,
      description: a.description,
      source: a.source ?? '',
    })),
    hypotheses: idea.hypotheses.map((h) => ({ ...h })),
    marche: m
      ? {
          value: m.value,
          unit: m.unit,
          currency: m.currency ?? '',
          scope: m.scope,
          source: m.source,
          sourceDate: m.sourceDate ?? '',
          sourceUrl: m.sourceUrl ?? '',
        }
      : ficheVide().marche,
  };
}

export type Resultat<T> = { ok: true; body: T } | { ok: false; erreur: string };

/**
 * Corps du `PUT`/`POST` de la fiche. Une taille de marché entièrement vide
 * vaut « pas de taille » ; une taille partielle est refusée ici avant l'API —
 * en particulier sans source (ADR-0036 § 2.3).
 */
export function corpsFiche(f: FicheForm): Resultat<IdeaFicheBody> {
  if (f.title.trim() === '') return { ok: false, erreur: 'Donnez un titre à votre idée.' };
  const m = f.marche;
  const marcheVide = [m.value, m.scope, m.source, m.sourceDate, m.sourceUrl, m.currency].every(
    (v) => v.trim() === '',
  );
  let marketSize: IdeaFicheBody['marketSize'] = null;
  if (!marcheVide) {
    const value = normaliseDecimal(m.value);
    if (value === null) {
      return { ok: false, erreur: 'Taille de marché : une valeur positive, sans lettres.' };
    }
    if (m.source.trim().length < 3) {
      return {
        ok: false,
        erreur:
          'Taille de marché : la source est obligatoire. Lalanda n’accepte aucun chiffre de marché sans sa provenance.',
      };
    }
    if (m.scope.trim() === '') {
      return { ok: false, erreur: 'Taille de marché : dites ce qui est compté (périmètre).' };
    }
    const currency = m.unit === 'montant' ? m.currency.trim().toUpperCase() : '';
    if (m.unit === 'montant' && !/^[A-Z]{3}$/.test(currency)) {
      return { ok: false, erreur: 'Taille de marché en montant : précisez la devise (ex. USD).' };
    }
    marketSize = {
      value,
      unit: m.unit,
      currency: m.unit === 'montant' ? currency : null,
      scope: m.scope.trim(),
      source: m.source.trim(),
      sourceDate: m.sourceDate.trim() === '' ? null : m.sourceDate.trim(),
      sourceUrl: m.sourceUrl.trim() === '' ? null : m.sourceUrl.trim(),
    };
  }
  return {
    ok: true,
    body: {
      title: f.title.trim(),
      problem: f.problem.trim(),
      target: f.target.trim(),
      solution: f.solution.trim(),
      revenueModel: f.revenueModel.trim(),
      country: /^[A-Z]{2}$/.test(f.country.trim().toUpperCase())
        ? f.country.trim().toUpperCase()
        : null,
      market: f.market.trim(),
      alternatives: f.alternatives
        .filter((a) => a.name.trim() !== '')
        .map((a) => ({
          name: a.name.trim(),
          description: a.description.trim(),
          source: a.source.trim() === '' ? null : a.source.trim(),
        })),
      hypotheses: f.hypotheses
        .filter((h) => h.text.trim() !== '')
        .map((h) => ({ ...h, text: h.text.trim() })),
      marketSize,
    },
  };
}

/** Identifiant d'hypothèse nouveau, stable et unique dans la fiche. */
export function nouvelIdHypothese(existants: readonly Hypothesis[]): string {
  const pris = new Set(existants.map((h) => h.id));
  let n = existants.length + 1;
  while (pris.has(`h${n}`)) n += 1;
  return `h${n}`;
}

/**
 * Applique une suggestion de l'IA AU FORMULAIRE seulement : rien n'est enregistré
 * tant que l'utilisateur ne clique pas « Enregistrer ».
 */
export function appliquerSuggestion(f: FicheForm, answer: AssistAnswer, index?: number): FicheForm {
  if (answer.intent === 'reformuler') {
    const r = answer.reformulation;
    return {
      ...f,
      problem: r.probleme || f.problem,
      target: r.cible || f.target,
      solution: r.solution || f.solution,
    };
  }
  if (answer.intent === 'hypotheses') {
    const choisies =
      index === undefined ? answer.hypotheses : answer.hypotheses.slice(index, index + 1);
    const hypotheses = [...f.hypotheses];
    for (const h of choisies) {
      if (hypotheses.length >= 20) break;
      if (hypotheses.some((x) => x.text === h.texte)) continue;
      hypotheses.push({ id: nouvelIdHypothese(hypotheses), text: h.texte, status: 'a_tester' });
    }
    return { ...f, hypotheses };
  }
  return f;
}

// ─── Formulaire d'expérience ────────────────────────────────────────────────

export interface ExperienceForm {
  type: ExperimentType;
  title: string;
  hypothesis: string;
  targetPct: string;
  status: ExperimentStatus;
  conclusion: ExperimentConclusion | '';
  notes: string;
  resultats: Record<
    'realises' | 'confirmant' | 'visiteurs' | 'inscrits' | 'sollicites' | 'precommandes',
    string
  >;
  montant: string;
  devise: string;
}

export function experienceVide(type: ExperimentType = 'entretiens'): ExperienceForm {
  return {
    type,
    title: LIBELLES_TYPES[type],
    hypothesis: '',
    targetPct: '',
    status: 'a_faire',
    conclusion: '',
    notes: '',
    resultats: {
      realises: '',
      confirmant: '',
      visiteurs: '',
      inscrits: '',
      sollicites: '',
      precommandes: '',
    },
    montant: '',
    devise: '',
  };
}

export function experienceDepuis(e: ExperimentBody): ExperienceForm {
  const s = (n: number | null): string => (n === null ? '' : String(n));
  return {
    type: e.type,
    title: e.title,
    hypothesis: e.hypothesis,
    targetPct: e.targetPct === null ? '' : String(e.targetPct),
    status: e.status,
    conclusion: e.conclusion ?? '',
    notes: e.notes,
    resultats: {
      realises: s(e.results.realises),
      confirmant: s(e.results.confirmant),
      visiteurs: s(e.results.visiteurs),
      inscrits: s(e.results.inscrits),
      sollicites: s(e.results.sollicites),
      precommandes: s(e.results.precommandes),
    },
    montant: e.results.montant ?? '',
    devise: e.results.devise ?? '',
  };
}

export function corpsExperience(f: ExperienceForm): Resultat<ExperimentBody> {
  if (f.title.trim() === '') return { ok: false, erreur: 'Donnez un titre à l’expérience.' };
  const results: ExperimentBody['results'] = {
    realises: null,
    confirmant: null,
    visiteurs: null,
    inscrits: null,
    sollicites: null,
    precommandes: null,
    montant: null,
    devise: null,
  };
  for (const champ of CHAMPS_RESULTATS[f.type]) {
    const k = champ.cle as keyof typeof f.resultats;
    const v = normaliseEntier(f.resultats[k]);
    if (v === undefined) return { ok: false, erreur: `${champ.libelle} : un nombre entier.` };
    (results as unknown as Record<string, number | null>)[k] = v;
  }
  if (f.type === 'pre_commande' && (f.montant.trim() !== '' || f.devise.trim() !== '')) {
    const montant = normaliseDecimal(f.montant);
    const devise = f.devise.trim().toUpperCase();
    if (montant === null || !/^[A-Z]{3}$/.test(devise)) {
      return {
        ok: false,
        erreur: 'Montant des pré-commandes : un montant et sa devise (ex. USD).',
      };
    }
    results.montant = montant;
    results.devise = devise;
  }
  let targetPct: number | null = null;
  if (f.targetPct.trim() !== '') {
    const t = normaliseEntier(f.targetPct);
    if (t === undefined || t === null || t > 100) {
      return { ok: false, erreur: 'Critère de réussite : un pourcentage entier entre 0 et 100.' };
    }
    targetPct = t;
  }
  if (f.status === 'terminee' && f.conclusion === '') {
    return { ok: false, erreur: 'Une expérience terminée porte sa conclusion.' };
  }
  return {
    ok: true,
    body: {
      type: f.type,
      title: f.title.trim(),
      hypothesis: f.hypothesis.trim(),
      targetPct,
      status: f.status,
      results,
      conclusion: f.status === 'terminee' && f.conclusion !== '' ? f.conclusion : null,
      notes: f.notes.trim(),
    },
  };
}

// ─── Erreurs ────────────────────────────────────────────────────────────────

interface ApiError {
  status?: number;
  detail?: unknown;
}

/** Message lisible d'une erreur d'API. */
export function messageErreur(err: unknown, defaut: string): string {
  const e = err as ApiError;
  const d = e?.detail as { message?: unknown; details?: { issues?: { message?: string }[] } };
  const issue = d?.details?.issues?.[0]?.message;
  if (typeof issue === 'string') return issue;
  if (typeof d?.message === 'string') return d.message;
  if (e?.status === 403) return 'Votre rôle ne permet pas cette action.';
  if (e?.status === 404) return 'Idée introuvable dans votre organisation.';
  return defaut;
}

/** Phrase qui dit d'où vient une réponse de l'assistance. */
export function origineAssistance(source: 'llm' | 'fallback', reason: string | null): string {
  if (source === 'llm') return 'Suggestion de l’IA, vérifiée : aucun chiffre ajouté.';
  switch (reason) {
    case 'desactivee_plateforme':
    case 'desactivee_organisation':
      return 'IA désactivée : proposition automatique, sans IA.';
    case 'rejetee':
      return 'La réponse de l’IA a été écartée (chiffre absent de votre fiche ou forme invalide) : proposition automatique.';
    default:
      return 'IA indisponible : proposition automatique, sans IA.';
  }
}
