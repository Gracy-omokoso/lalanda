// Service d'actions correctives IA (S14a — agent D).
//
// Lit les ratios rouges/oranges d'un `evaluate` et retourne 2-4 suggestions
// actionnables. Deux backends :
//
// 1. LLM (OpenAI gpt-4o-mini) via SDK officiel, ancré strictement sur les
//    ratios fournis. La réponse JSON est validée par Zod ; un rejet renvoie
//    au fallback déterministe.
// 2. Fallback déterministe : règles codées en dur, testables sans réseau.
//    Actif automatiquement si `OPENAI_API_KEY` est absente.
//
// L'IA n'invente pas de chiffres : elle ne recalcule pas, ne modifie aucune
// feuille officielle et produit uniquement du texte + une magnitude suggérée.

import { Injectable, Logger } from '@nestjs/common';

import {
  CorrectiveActionSchema,
  CorrectiveActionsResponseSchema,
  type CorrectiveAction,
  type CorrectiveActionsRequest,
  type CorrectiveActionsResponse,
  type EvaluateLine,
} from './ai-actions.dto.js';

/** Injectable pour permettre le mock en test (aucun appel réseau réel). */
export interface OpenAIChatClient {
  chatJson(args: {
    system: string;
    user: string;
    model: string;
  }): Promise<string>;
}

const DEFAULT_MODEL = 'gpt-4o-mini';

/** Registre local des libellés FR par identifiant de ratio (fallback + prompt). */
const RATIO_LABELS: Record<string, string> = {
  dscr: 'DSCR (couverture du service de la dette)',
  apport_pct: "Ratio d'apport personnel",
  payback_annees: "Délai de récupération de l'investissement",
  tresorerie_min_ok: 'Trésorerie mini sur 12 mois',
  marge_ebe_pct: 'Marge EBE',
  marge_nette_pct: 'Marge nette',
};

@Injectable()
export class AiActionsService {
  private readonly logger = new Logger(AiActionsService.name);

  constructor(private readonly openai: OpenAIChatClient | null = null) {}

  /** Point d'entrée : renvoie 0 à 4 actions correctives ancrées sur les ratios. */
  async correctiveActions(
    req: CorrectiveActionsRequest,
  ): Promise<CorrectiveActionsResponse> {
    const problematiques = extractProblematiques(req.lines);
    if (problematiques.length === 0) {
      // Aucun feu rouge/orange → rien à suggérer.
      return { actions: [], source: 'fallback' };
    }

    // Pas de client OpenAI configuré → fallback déterministe direct.
    if (!this.openai) {
      return {
        actions: buildFallbackActions(problematiques, req.devise),
        source: 'fallback',
      };
    }

    try {
      const raw = await this.openai.chatJson({
        model: DEFAULT_MODEL,
        system: buildSystemPrompt(),
        user: buildUserPrompt(req, problematiques),
      });
      const actions = parseLlmActions(raw, problematiques);
      // Validation zod finale via le schéma de réponse complet.
      const parsed = CorrectiveActionsResponseSchema.parse({
        actions,
        source: 'llm',
      });
      return parsed;
    } catch (err) {
      // Toute erreur (réseau, JSON invalide, zod refuse) → fallback silencieux.
      this.logger.warn(
        `LLM indisponible ou réponse invalide, fallback déterministe : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return {
        actions: buildFallbackActions(problematiques, req.devise),
        source: 'fallback',
      };
    }
  }
}

/** Représentation compacte d'une ligne de ratio en anomalie. */
export interface Problematique {
  ratio: string;
  label: string;
  value: number;
  seuil: number;
  direction: 'min' | 'max';
  severity: 'orange' | 'rouge';
  format: 'money' | 'number' | 'percent';
}

/** Filtre les lignes portant un seuil ET un statut orange ou rouge. */
export function extractProblematiques(lines: EvaluateLine[]): Problematique[] {
  const out: Problematique[] = [];
  for (const l of lines) {
    if (!l.seuil) continue;
    if (l.seuil.statut !== 'orange' && l.seuil.statut !== 'rouge') continue;
    out.push({
      ratio: l.lineId,
      label: l.label,
      value: l.value,
      seuil: l.seuil.valeur,
      direction: l.seuil.direction,
      severity: l.seuil.statut,
      format: l.format,
    });
  }
  // On priorise rouge > orange, et limite à 4 pour rester actionnable.
  out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'rouge' ? -1 : 1));
  return out.slice(0, 4);
}

// ---------------------------------------------------------------------------
// Fallback déterministe
// ---------------------------------------------------------------------------

/**
 * Suggestions génériques par ratio, sans appel réseau. Le texte reste
 * qualitatif (pas de chiffres inventés au-delà du seuil déclaré).
 */
export function buildFallbackActions(
  problematiques: Problematique[],
  devise?: string,
): CorrectiveAction[] {
  return problematiques.map((p) => ratioToFallbackAction(p, devise));
}

function ratioToFallbackAction(p: Problematique, devise?: string): CorrectiveAction {
  const cur = devise ? ` ${devise}` : '';
  const seuilFmt = formatValue(p.seuil, p.format, devise);
  const valFmt = formatValue(p.value, p.format, devise);

  switch (p.ratio) {
    case 'dscr':
      return {
        ratio: p.ratio,
        severity: p.severity,
        suggestion:
          `Réduire le service de la dette ou renforcer l'EBE : renégocier la durée du prêt, ` +
          `demander un différé d'amortissement, ou baisser une charge d'exploitation ` +
          `significative (loyer, personnel non-opérationnel).`,
        expected_impact:
          `Amener le DSCR à au moins ${seuilFmt} (actuellement ${valFmt}) pour repasser au vert bancaire.`,
      };

    case 'apport_pct':
      return {
        ratio: p.ratio,
        severity: p.severity,
        suggestion:
          `Augmenter l'apport personnel ou réduire les besoins de financement : ` +
          `mobiliser une épargne complémentaire, chercher un co-investisseur, ou ` +
          `étaler certains investissements non critiques sur la seconde année.`,
        expected_impact:
          `Porter l'apport à au moins ${seuilFmt} des besoins (actuellement ${valFmt}) pour rassurer la banque.`,
      };

    case 'payback_annees':
      return {
        ratio: p.ratio,
        severity: p.severity,
        suggestion:
          `Raccourcir le retour sur investissement : phaser l'investissement en deux tranches, ` +
          `démarrer sur du matériel d'occasion, ou améliorer la marge nette dès l'année 1 ` +
          `(prix, mix produit, réduction des charges variables).`,
        expected_impact:
          `Ramener le payback sous ${seuilFmt} ans (actuellement ${valFmt}).`,
      };

    case 'tresorerie_min_ok':
      return {
        ratio: p.ratio,
        severity: p.severity,
        suggestion:
          `Sécuriser la trésorerie sur 12 mois : constituer une réserve initiale plus large, ` +
          `négocier des délais fournisseurs, ou mettre en place une facilité de caisse ` +
          `bancaire pour couvrir les mois creux.`,
        expected_impact:
          `Maintenir un solde mensuel minimum strictement positif${cur} (actuellement ${valFmt}, seuil ${seuilFmt}).`,
      };

    case 'marge_ebe_pct':
      return {
        ratio: p.ratio,
        severity: p.severity,
        suggestion:
          `Améliorer la marge EBE : arbitrer les charges opérationnelles récurrentes ` +
          `(loyer, personnel non-facturable, marketing), ou augmenter le prix moyen si ` +
          `la position concurrentielle le permet.`,
        expected_impact:
          `Faire remonter la marge EBE au-dessus de ${seuilFmt} (actuellement ${valFmt}).`,
      };

    case 'marge_nette_pct':
      return {
        ratio: p.ratio,
        severity: p.severity,
        suggestion:
          `Améliorer la marge nette : optimiser la structure de coûts, réduire ` +
          `les charges financières, ou revoir la politique tarifaire.`,
        expected_impact:
          `Amener la marge nette au-dessus de ${seuilFmt} (actuellement ${valFmt}).`,
      };

    default:
      return {
        ratio: p.ratio,
        severity: p.severity,
        suggestion:
          `Ce ratio (${p.label}) est en zone ${p.severity}. Identifier le driver principal ` +
          `qui le tire, puis simuler une variation ciblée avant validation.`,
        expected_impact:
          `Ramener la valeur du côté "${p.direction === 'min' ? '≥' : '≤'} ${seuilFmt}" ` +
          `(actuellement ${valFmt}).`,
      };
  }
}

function formatValue(
  v: number,
  fmt: 'money' | 'number' | 'percent',
  devise?: string,
): string {
  if (fmt === 'percent') return `${(v * 100).toFixed(1).replace('.', ',')} %`;
  if (fmt === 'money') {
    const rounded = Math.round(v).toLocaleString('fr-FR');
    return devise ? `${rounded} ${devise}` : rounded;
  }
  // number : 2 décimales max, virgule française
  return v.toFixed(2).replace('.', ',');
}

// ---------------------------------------------------------------------------
// Prompt LLM + parsing strict
// ---------------------------------------------------------------------------

export function buildSystemPrompt(): string {
  return [
    'Tu es un assistant financier francophone au service de PME (contexte OHADA).',
    'Ta seule tâche : proposer des ACTIONS CORRECTIVES concrètes pour les ratios en zone rouge ou orange.',
    "Contraintes strictes :",
    "- Réponds UNIQUEMENT en JSON valide, sans texte hors du JSON.",
    "- N'invente AUCUN chiffre absent de l'entrée : les seules valeurs numériques que tu peux citer sont celles présentes dans les ratios fournis (valeur courante ou seuil).",
    "- Ne recalcule rien, ne modifie aucune feuille officielle : tu proposes des directions, pas des calculs.",
    '- Rédige en français, ton professionnel, phrases courtes et actionnables.',
    '- Retourne exactement un objet { "actions": [...] } avec 1 à 4 actions.',
    'Schéma de chaque action :',
    '{ "ratio": "<lineId>", "severity": "orange"|"rouge", "suggestion": "<action concrete>", "expected_impact": "<impact attendu>" }',
  ].join('\n');
}

export function buildUserPrompt(
  req: CorrectiveActionsRequest,
  problematiques: Problematique[],
): string {
  const ratiosBloc = problematiques.map((p) => ({
    ratio: p.ratio,
    label: RATIO_LABELS[p.ratio] ?? p.label,
    valeur_courante: p.value,
    seuil: p.seuil,
    direction: p.direction,
    severity: p.severity,
    format: p.format,
  }));
  return [
    `Template : ${req.templateSlug}`,
    req.devise ? `Devise : ${req.devise}` : null,
    'Ratios en anomalie (à corriger) :',
    JSON.stringify(ratiosBloc, null, 2),
    '',
    'Retourne le JSON demandé, une action par ratio, dans le même ordre.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Parse la réponse brute du LLM, valide chaque action et écarte les inventions. */
export function parseLlmActions(
  raw: string,
  problematiques: Problematique[],
): CorrectiveAction[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || !('actions' in parsed)) {
    throw new Error('Réponse LLM sans champ "actions"');
  }
  const arr = (parsed as { actions: unknown }).actions;
  if (!Array.isArray(arr)) throw new Error('"actions" n\'est pas un tableau');

  const allowedRatios = new Set(problematiques.map((p) => p.ratio));
  const actions: CorrectiveAction[] = [];
  for (const item of arr) {
    const a = CorrectiveActionSchema.parse(item);
    if (!allowedRatios.has(a.ratio)) {
      // Le LLM a proposé une action pour un ratio non demandé → on refuse.
      throw new Error(`Ratio hors périmètre : ${a.ratio}`);
    }
    actions.push(a);
  }
  if (actions.length === 0) throw new Error('Aucune action retournée');
  if (actions.length > 4) throw new Error('Trop d\'actions (>4) retournées');
  return actions;
}
