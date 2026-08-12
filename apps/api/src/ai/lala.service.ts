// Service « Lala » — interprétation des résultats et échange (S24a).
//
// Reprend, sans le réinventer, le motif de `ai-actions.service.ts` (S14a) :
// deux backends, un LLM borné et un repli déterministe testable sans réseau,
// avec une trace de repli au préfixe stable. Trois choses lui sont propres.
//
//  1. **Le repli n'est pas seulement un plan B, c'est un FILET.** Une réponse du
//     modèle qui cite un chiffre absent du moteur est écartée LIGNE PAR LIGNE et
//     remplacée par la lecture déterministe. `CLAUDE.md` : « le moteur financier
//     est l'unique source de vérité des calculs ».
//  2. **Les réserves de portée ne passent pas par le modèle.** L'avertissement
//     de la trésorerie mensuelle est renvoyé par le service, structurellement,
//     que le texte vienne du LLM ou du déterministe. Une réserve qui dépendrait
//     du bon vouloir d'un modèle n'est pas une réserve.
//  3. **Lala ne calcule pas.** Le prompt le lui interdit, et le garde-fou
//     numérique le vérifie après coup — parce qu'un prompt n'est pas un contrôle.

import { Injectable, Logger } from '@nestjs/common';

import type { SupportedLocale } from '../account/account.dto.js';
import { FALLBACK_LOG_PREFIX, type OpenAIChatClient } from './ai-actions.service.js';
import {
  MENTION_NON_CONSEIL,
  decoreLignes,
  interpretationDeterministe,
  reglagesLangue,
  reservePour,
  sourceChiffree,
  type LigneAffichee,
} from './lala-interpretation.js';
import { chiffresNonAutorises, construireChiffresAutorises } from './lala-nombres.js';
import {
  ChatResponseSchema,
  InterpretationsResponseSchema,
  type ChatRequest,
  type ChatResponse,
  type Interpretation,
  type InterpretationsRequest,
  type InterpretationsResponse,
} from './lala.dto.js';

const DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * Longueurs maximales acceptées d'un texte rendu par le modèle.
 *
 * Une bulle d'interprétation est lue d'un coup d'œil sous un tableau : au-delà,
 * elle cesse d'être une bulle. Un texte plus long n'est pas tronqué — il est
 * REJETÉ au profit du déterministe : couper une phrase au milieu produirait une
 * lecture financière incomplète, ce qui est pire que sobre.
 */
export const MAX_CARACTERES_INTERPRETATION = 700;
export const MAX_CARACTERES_REPONSE_CHAT = 1400;

@Injectable()
export class LalaService {
  private readonly logger = new Logger(LalaService.name);

  /** L'absence de client est un ÉTAT de configuration, pas un incident par appel. */
  private clientAbsentSignale = false;

  constructor(private readonly openai: OpenAIChatClient | null = null) {}

  // ─── Interprétations ───────────────────────────────────────────────────────

  async interpretations(
    req: InterpretationsRequest,
    locale: SupportedLocale | undefined,
  ): Promise<InterpretationsResponse> {
    const decorees = decoreLignes(req.lines, req.devise, locale);
    const parId = new Map(decorees.map((l) => [l.ligne.lineId, l]));
    const demandees = req.lineIds
      .map((id) => parId.get(id))
      .filter((l): l is LigneAffichee => l !== undefined);

    const reserveFeuille = reservePour(req.sheetId, undefined, locale);
    const deterministes = new Map(
      demandees.map((l) => [
        l.ligne.lineId,
        interpretationDeterministe(l, { sheetId: req.sheetId, locale }),
      ]),
    );

    const enveloppe = (interpretations: Interpretation[]): InterpretationsResponse =>
      InterpretationsResponseSchema.parse({
        sheetId: req.sheetId,
        interpretations,
        // Provenance du texte RENDU, comme pour `/ai/corrective-actions` : c'est
        // ce que l'interface annonce à l'utilisateur (docs/11).
        source: interpretations.some((i) => i.source === 'llm') ? 'llm' : 'fallback',
        avertissementFeuille: reserveFeuille,
        mention: MENTION_NON_CONSEIL,
      });

    const replis = (): Interpretation[] =>
      demandees.map((l) => ({
        lineId: l.ligne.lineId,
        texte: deterministes.get(l.ligne.lineId) ?? '',
        source: 'fallback' as const,
      }));

    if (demandees.length === 0) return enveloppe([]);
    if (!this.openai) {
      this.signaleClientAbsent();
      return enveloppe(replis());
    }

    // Tout ce qui est dans `lines` vient du moteur et s'affiche déjà à l'écran :
    // c'est exactement le périmètre des chiffres citables. Le garde-fou est
    // construit sur la feuille entière, pas sur la seule ligne interprétée, pour
    // qu'une lecture qui situe un résultat par rapport à un autre reste possible
    // sans jamais sortir du moteur.
    const autorises = construireChiffresAutorises(
      decorees.map(sourceChiffree),
      reserveFeuille ? [reserveFeuille] : [],
    );

    let brutes: Map<string, string>;
    try {
      const raw = await this.openai.chatJson({
        model: DEFAULT_MODEL,
        system: promptSystemeInterpretations(locale),
        user: promptUtilisateurInterpretations(req, demandees, reserveFeuille),
      });
      brutes = parseInterpretationsLlm(raw, new Set(demandees.map((l) => l.ligne.lineId)));
    } catch (err) {
      this.journaliseRepli('interpretations', err);
      return enveloppe(replis());
    }

    const interpretations = demandees.map<Interpretation>((l) => {
      const id = l.ligne.lineId;
      const deterministe = deterministes.get(id) ?? '';
      const texte = brutes.get(id);
      const refus = texte === undefined ? 'absente' : motifDeRefus(texte, autorises, MAX_CARACTERES_INTERPRETATION);
      if (texte === undefined || refus !== null) {
        this.logger.warn(
          `${FALLBACK_LOG_PREFIX} raison=InterpretationRefusee ligne=${id} — ${refus ?? 'absente'}`,
        );
        return { lineId: id, texte: deterministe, source: 'fallback' };
      }
      // La réserve de portée est RAJOUTÉE au texte du modèle, jamais laissée à
      // sa discrétion : c'est ce qui garantit qu'une lecture de la trésorerie
      // mensuelle ne peut pas être servie sans sa réserve.
      const reserveLigne = reservePour(req.sheetId, id, locale);
      const complet = reserveLigne && !texte.includes(reserveLigne) ? `${texte} ${reserveLigne}` : texte;
      return { lineId: id, texte: complet, source: 'llm' };
    });

    return enveloppe(interpretations);
  }

  // ─── Chat ──────────────────────────────────────────────────────────────────

  async chat(req: ChatRequest, locale: SupportedLocale | undefined): Promise<ChatResponse> {
    const f = reglagesLangue(locale);
    const decorees = decoreLignes(req.lines, req.devise, locale);
    const origine = decorees.find((l) => l.ligne.lineId === req.lineId);
    const reserveFeuille = reservePour(req.sheetId, req.lineId, locale);

    const enveloppe = (reply: string, source: 'llm' | 'fallback'): ChatResponse =>
      ChatResponseSchema.parse({
        reply,
        source,
        avertissementFeuille: reserveFeuille,
        mention: MENTION_NON_CONSEIL,
      });

    // `ChatRequestSchema` garantit que la ligne d'origine existe; la garde reste
    // pour que le service soit sûr appelé directement (tests, futur worker).
    const lectureDeterministe = origine
      ? interpretationDeterministe(origine, { sheetId: req.sheetId, locale })
      : (req.interpretation ?? '');

    if (!this.openai) {
      this.signaleClientAbsent();
      return enveloppe(f.chatIndisponible(lectureDeterministe), 'fallback');
    }

    const autorises = construireChiffresAutorises(
      decorees.map(sourceChiffree),
      reserveFeuille ? [reserveFeuille] : [],
    );

    let reply: string;
    try {
      const raw = await this.openai.chatJson({
        model: DEFAULT_MODEL,
        system: promptSystemeChat(locale),
        user: promptUtilisateurChat(req, decorees, origine, reserveFeuille),
      });
      reply = parseReponseChat(raw);
    } catch (err) {
      this.journaliseRepli('chat', err);
      return enveloppe(f.chatIndisponible(lectureDeterministe), 'fallback');
    }

    const refus = motifDeRefus(reply, autorises, MAX_CARACTERES_REPONSE_CHAT);
    if (refus !== null) {
      this.logger.warn(`${FALLBACK_LOG_PREFIX} raison=ReponseChatRefusee — ${refus}`);
      // Un chiffre inventé n'est pas une panne : on nomme le refus plutôt que de
      // prétendre que l'assistant est injoignable (docs/11, « ne pas masquer une
      // incertitude »).
      const motifChiffre = refus.startsWith('chiffres');
      return enveloppe(
        motifChiffre ? f.chatChiffreRefuse() : f.chatIndisponible(lectureDeterministe),
        'fallback',
      );
    }

    return enveloppe(reply, 'llm');
  }

  // ─── Traces ────────────────────────────────────────────────────────────────

  private signaleClientAbsent(): void {
    if (this.clientAbsentSignale) return;
    this.clientAbsentSignale = true;
    this.logger.warn(
      `${FALLBACK_LOG_PREFIX} raison=ClientAbsent — aucun client OpenAI configuré ; ` +
        `interprétations et échanges Lala servis par la lecture déterministe.`,
    );
  }

  private journaliseRepli(operation: string, err: unknown): void {
    this.logger.warn(
      `${FALLBACK_LOG_PREFIX} raison=${err instanceof Error ? err.name : 'Inconnue'} ` +
        `operation=${operation} — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ─── Contrôle d'un texte rendu ───────────────────────────────────────────────

/**
 * Motif de refus d'un texte rendu par le modèle, ou `null` s'il est acceptable.
 *
 * L'ordre compte : un texte vide n'est pas « trop long », et un texte trop long
 * n'a pas besoin d'être fouillé pour ses chiffres — il est déjà écarté.
 */
export function motifDeRefus(
  texte: string,
  autorises: ReadonlySet<string>,
  maxCaracteres: number,
): string | null {
  const t = texte.trim();
  if (t === '') return 'texte vide';
  if (t.length > maxCaracteres) return `texte trop long (${t.length} > ${maxCaracteres})`;
  const fautifs = chiffresNonAutorises(t, autorises);
  if (fautifs.length > 0) return `chiffres absents du moteur : ${fautifs.join(', ')}`;
  return null;
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

/** Règles communes aux deux prompts — elles n'ont qu'un seul énoncé. */
function reglesCommunes(locale: SupportedLocale | undefined): string[] {
  return [
    reglagesLangue(locale).consigneLangue,
    'Tu es « Lala », assistante financière de Lalanda, en contexte OHADA / SYSCOHADA.',
    'RÈGLE ABSOLUE : tu EXPLIQUES des chiffres déjà calculés, tu n’en PRODUIS aucun.',
    '- Ne recalcule rien, n’additionne rien, ne convertis rien, ne projette rien.',
    "- Ne cite AUCUN nombre absent des données fournies : recopie les valeurs affichées telles quelles.",
    '- Ne propose aucune valeur destinée à être saisie dans le plan.',
    '- Ne donne jamais de conseil en investissement, juridique, comptable ou fiscal.',
    '- Ne promets aucun résultat et ne masque aucune incertitude.',
    'Si on te demande un calcul ou un chiffre que tu n’as pas, dis-le et renvoie vers la saisie des hypothèses, que le moteur recalcule.',
  ];
}

export function promptSystemeInterpretations(locale: SupportedLocale | undefined): string {
  return [
    ...reglesCommunes(locale),
    '',
    'Ta tâche : pour chaque ligne demandée, écrire une INTERPRÉTATION de CETTE valeur.',
    '- Une interprétation lit le chiffre (« votre X ressort à …, sous le repère de … »).',
    '- Ce n’est PAS une définition du concept : l’utilisateur a déjà une aide pour ça.',
    '- Deux ou trois phrases, 400 caractères au plus, sans liste ni titre.',
    'Réponds UNIQUEMENT en JSON valide : { "interpretations": [ { "lineId": "...", "texte": "..." } ] }.',
  ].join('\n');
}

export function promptUtilisateurInterpretations(
  req: InterpretationsRequest,
  demandees: readonly LigneAffichee[],
  reserveFeuille: string | null,
): string {
  return [
    `Feuille : ${req.sheetId}${req.sheetLabel ? ` (${req.sheetLabel})` : ''}`,
    `Modèle sectoriel : ${req.templateSlug}`,
    req.devise ? `Devise : ${req.devise}` : null,
    reserveFeuille ? `Réserve de portée de cette feuille (à respecter) : ${reserveFeuille}` : null,
    '',
    'Lignes à interpréter :',
    JSON.stringify(demandees.map(ligneJson), null, 2),
    '',
    `Retourne une entrée par ligne, dans le même ordre, avec le lineId exact.`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function promptSystemeChat(locale: SupportedLocale | undefined): string {
  return [
    ...reglesCommunes(locale),
    '',
    'Ta tâche : approfondir, avec l’utilisateur, l’interprétation d’un résultat qu’il vient de lire.',
    '- Réponds à sa question en t’appuyant sur les chiffres fournis et sur eux seuls.',
    '- Reste bref : 150 mots au plus, sans liste à puces.',
    '- Tu peux expliquer un mécanisme, nommer les leviers, poser une question de clarification.',
    '- Tu ne chiffres jamais l’effet d’un levier : c’est le moteur qui le fait.',
    'Réponds UNIQUEMENT en JSON valide : { "reponse": "..." }.',
  ].join('\n');
}

export function promptUtilisateurChat(
  req: ChatRequest,
  decorees: readonly LigneAffichee[],
  origine: LigneAffichee | undefined,
  reserveFeuille: string | null,
): string {
  return [
    `Feuille : ${req.sheetId}${req.sheetLabel ? ` (${req.sheetLabel})` : ''}`,
    `Modèle sectoriel : ${req.templateSlug}`,
    req.devise ? `Devise : ${req.devise}` : null,
    reserveFeuille ? `Réserve de portée (à respecter, à rappeler si le sujet y touche) : ${reserveFeuille}` : null,
    '',
    'Résultat dont part la conversation :',
    JSON.stringify(origine ? ligneJson(origine) : { lineId: req.lineId }, null, 2),
    req.interpretation ? `\nInterprétation déjà affichée : ${req.interpretation}` : null,
    '',
    'Autres résultats de la feuille (contexte, chiffres citables) :',
    JSON.stringify(decorees.map(ligneJson), null, 2),
    '',
    'Échange :',
    req.messages.map((m) => `${m.role === 'user' ? 'Utilisateur' : 'Lala'} : ${m.content}`).join('\n'),
  ]
    .filter(Boolean)
    .join('\n');
}

/** Vue d'une ligne transmise au modèle : lisible, sans champ interne inutile. */
function ligneJson(l: LigneAffichee): Record<string, unknown> {
  return {
    lineId: l.ligne.lineId,
    label: l.ligne.label,
    valeur_affichee: l.valeurAffichee,
    valeur_brute: l.ligne.value,
    ...(l.ligne.seuil && l.seuilAffiche
      ? {
          seuil: {
            valeur_affichee: l.seuilAffiche,
            direction: l.ligne.seuil.direction,
            statut: l.ligne.seuil.statut,
          },
        }
      : {}),
  };
}

// ─── Parsing strict des réponses ─────────────────────────────────────────────

/** Interprétations rendues par le modèle, indexées par `lineId` demandé. */
export function parseInterpretationsLlm(raw: string, attendus: ReadonlySet<string>): Map<string, string> {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !('interpretations' in parsed)) {
    throw new Error('Réponse LLM sans champ "interpretations"');
  }
  const arr = (parsed as { interpretations: unknown }).interpretations;
  if (!Array.isArray(arr)) throw new Error('"interpretations" n’est pas un tableau');

  const out = new Map<string, string>();
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const { lineId, texte } = item as { lineId?: unknown; texte?: unknown };
    if (typeof lineId !== 'string' || typeof texte !== 'string') continue;
    // Une ligne non demandée est ignorée, pas fatale : les autres lectures
    // restent bonnes, et la ligne manquante retombera sur son déterministe.
    if (!attendus.has(lineId)) continue;
    out.set(lineId, texte);
  }
  return out;
}

export function parseReponseChat(raw: string): string {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !('reponse' in parsed)) {
    throw new Error('Réponse LLM sans champ "reponse"');
  }
  const r = (parsed as { reponse: unknown }).reponse;
  if (typeof r !== 'string') throw new Error('"reponse" n’est pas une chaîne');
  return r;
}
