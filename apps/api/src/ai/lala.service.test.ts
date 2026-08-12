// Tests du service Lala (S24a). Aucun appel réseau réel : le client est mocké.
//
// Ce fichier vérifie les quatre situations qui décident si la fonctionnalité est
// déposable en production :
//
//  1. IA indisponible → une interprétation déterministe reste servie;
//  2. réponse tronquée par le plafond de jetons (S22h) → repli;
//  3. délai dépassé → repli;
//  4. une interprétation ne contient JAMAIS un chiffre absent du moteur.
//
// Plus la règle produit qui prime sur le confort : la trésorerie mensuelle ne
// peut pas être servie sans sa réserve, quoi qu'ait écrit le modèle.

import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { FALLBACK_LOG_PREFIX, type OpenAIChatClient } from './ai-actions.service.js';
import type { EvaluateLine } from './ai-actions.dto.js';
import { MENTION_NON_CONSEIL } from './lala-interpretation.js';
import {
  LalaService,
  motifDeRefus,
  parseInterpretationsLlm,
  parseReponseChat,
  promptSystemeChat,
  promptSystemeInterpretations,
  promptUtilisateurInterpretations,
} from './lala.service.js';
import { OpenAITimeoutError, OpenAITruncatedResponseError } from './openai-client.js';
import type { ChatRequest, InterpretationsRequest } from './lala.dto.js';

// ─── Fixtures : une feuille `ratios` telle que le moteur la produit ──────────

const DSCR: EvaluateLine = {
  sheetId: 'ratios',
  lineId: 'dscr',
  label: 'DSCR (couverture du service de la dette)',
  value: 0.82,
  format: 'number',
  seuil: { valeur: 1.25, direction: 'min', statut: 'rouge' },
};

const MARGE: EvaluateLine = {
  sheetId: 'ratios',
  lineId: 'marge_nette_pct',
  label: 'Marge nette',
  value: 0.185,
  format: 'percent',
  seuil: { valeur: 0.1, direction: 'min', statut: 'vert' },
};

const TRESO_MIN: EvaluateLine = {
  sheetId: 'ratios',
  lineId: 'tresorerie_min_ok',
  label: 'Trésorerie mini sur 12 mois (vue simplifiée)',
  value: -400,
  format: 'money',
  seuil: { valeur: 0, direction: 'min', statut: 'rouge' },
};

function requeteInterpretations(over: Partial<InterpretationsRequest> = {}): InterpretationsRequest {
  return {
    templateSlug: 'commerce-detail',
    sheetId: 'ratios',
    sheetLabel: 'Ratios bancaires',
    devise: 'USD',
    lines: [DSCR, MARGE, TRESO_MIN],
    lineIds: ['dscr'],
    ...over,
  };
}

function requeteChat(over: Partial<ChatRequest> = {}): ChatRequest {
  return {
    templateSlug: 'commerce-detail',
    sheetId: 'ratios',
    lineId: 'dscr',
    devise: 'USD',
    lines: [DSCR, MARGE, TRESO_MIN],
    messages: [{ role: 'user', content: 'Pourquoi mon DSCR est-il rouge ?' }],
    ...over,
  } as ChatRequest;
}

/** Client mocké renvoyant une charge JSON fixe, ou levant l'erreur fournie. */
function client(reponse: string | Error): OpenAIChatClient {
  return {
    chatJson: vi.fn(async () => {
      if (reponse instanceof Error) throw reponse;
      return reponse;
    }),
  };
}

const interpretationsJson = (entrees: Array<{ lineId: string; texte: string }>): string =>
  JSON.stringify({ interpretations: entrees });

// ─── 1. IA indisponible ──────────────────────────────────────────────────────

describe('IA indisponible — une lecture déterministe reste servie', () => {
  it('sans client OpenAI, chaque ligne demandée reçoit une interprétation', async () => {
    const svc = new LalaService(null);
    const res = await svc.interpretations(requeteInterpretations({ lineIds: ['dscr', 'marge_nette_pct'] }), 'fr');

    expect(res.source).toBe('fallback');
    expect(res.interpretations).toHaveLength(2);
    for (const i of res.interpretations) {
      expect(i.source).toBe('fallback');
      expect(i.texte.length).toBeGreaterThan(40);
    }
    // La lecture SITUE le chiffre : elle le cite et le compare à son repère.
    const dscr = res.interpretations.find((i) => i.lineId === 'dscr');
    expect(dscr?.texte).toContain('0,82');
    expect(dscr?.texte).toContain('1,25');
    expect(dscr?.texte).toMatch(/en dessous/i);
    expect(dscr?.texte).toMatch(/rouge/i);
  });

  it('l’absence de client n’est signalée QU’UNE FOIS par processus', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const svc = new LalaService(null);
    await svc.interpretations(requeteInterpretations(), 'fr');
    await svc.interpretations(requeteInterpretations(), 'fr');

    const absents = warn.mock.calls.filter((c) => String(c[0]).includes('ClientAbsent'));
    expect(absents).toHaveLength(1);
    expect(String(absents[0]?.[0])).toContain(FALLBACK_LOG_PREFIX);
    warn.mockRestore();
  });

  it('le chat sans client répond honnêtement, sans inventer d’échange', async () => {
    const svc = new LalaService(null);
    const res = await svc.chat(requeteChat(), 'fr');

    expect(res.source).toBe('fallback');
    expect(res.reply).toMatch(/pas joignable/i);
    // Il ne laisse pas l'utilisateur les mains vides : la lecture reste dedans.
    expect(res.reply).toContain('0,82');
    expect(res.mention).toBe(MENTION_NON_CONSEIL);
  });
});

// ─── 2 & 3. Bornes techniques (S22h) ─────────────────────────────────────────

describe('bornes techniques — la réponse dégradée ne remonte jamais en erreur', () => {
  it('réponse tronquée par le plafond de jetons → repli déterministe', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const svc = new LalaService(client(new OpenAITruncatedResponseError(1024)));
    const res = await svc.interpretations(requeteInterpretations(), 'fr');

    expect(res.source).toBe('fallback');
    expect(res.interpretations[0]?.texte).toContain('0,82');
    expect(warn.mock.calls.some((c) => String(c[0]).includes('OpenAITruncatedResponseError'))).toBe(
      true,
    );
    warn.mockRestore();
  });

  it('délai dépassé → repli déterministe, raison nommée par son type', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const svc = new LalaService(client(new OpenAITimeoutError(15000)));
    const res = await svc.chat(requeteChat(), 'fr');

    expect(res.source).toBe('fallback');
    const trace = warn.mock.calls.map((c) => String(c[0])).find((m) => m.includes(FALLBACK_LOG_PREFIX));
    expect(trace).toContain('OpenAITimeoutError');
    warn.mockRestore();
  });

  it('JSON illisible → repli, sans faire échouer la requête', async () => {
    const svc = new LalaService(client('{ ceci n’est pas du JSON'));
    const res = await svc.interpretations(requeteInterpretations(), 'fr');
    expect(res.source).toBe('fallback');
  });
});

// ─── 4. Le garde-fou numérique, en situation ─────────────────────────────────

describe('une interprétation ne contient jamais un chiffre absent du moteur', () => {
  it('accepte un texte qui recopie la valeur et le repère', async () => {
    const svc = new LalaService(
      client(
        interpretationsJson([
          {
            lineId: 'dscr',
            texte:
              'Votre DSCR ressort à 0,82 quand le repère attend au moins 1,25 : ' +
              'les flux dégagés ne suffisent pas à couvrir l’échéance sur cet exercice.',
          },
        ]),
      ),
    );
    const res = await svc.interpretations(requeteInterpretations(), 'fr');
    expect(res.source).toBe('llm');
    expect(res.interpretations[0]?.source).toBe('llm');
    expect(res.interpretations[0]?.texte).toContain('0,82');
  });

  it('REJETTE un texte qui avance un chiffre jamais calculé', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const svc = new LalaService(
      client(
        interpretationsJson([
          {
            lineId: 'dscr',
            // 1,10 n'existe nulle part dans la feuille : c'est une projection.
            texte: 'Votre DSCR de 0,82 remonterait à 1,10 avec un différé de six mois.',
          },
        ]),
      ),
    );
    const res = await svc.interpretations(requeteInterpretations(), 'fr');

    expect(res.interpretations[0]?.source).toBe('fallback');
    expect(res.interpretations[0]?.texte).not.toContain('1,10');
    expect(res.source).toBe('fallback');
    expect(warn.mock.calls.some((c) => String(c[0]).includes('InterpretationRefusee'))).toBe(true);
    warn.mockRestore();
  });

  it('le refus est LIGNE PAR LIGNE : une mauvaise lecture n’emporte pas les bonnes', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const svc = new LalaService(
      client(
        interpretationsJson([
          { lineId: 'dscr', texte: 'Votre DSCR atteindra 3,40 l’an prochain.' },
          { lineId: 'marge_nette_pct', texte: 'Votre marge nette ressort à 18,5 %, au-dessus du repère de 10 %.' },
        ]),
      ),
    );
    const res = await svc.interpretations(
      requeteInterpretations({ lineIds: ['dscr', 'marge_nette_pct'] }),
      'fr',
    );

    expect(res.interpretations.find((i) => i.lineId === 'dscr')?.source).toBe('fallback');
    expect(res.interpretations.find((i) => i.lineId === 'marge_nette_pct')?.source).toBe('llm');
    warn.mockRestore();
  });

  it('une ligne oubliée par le modèle retombe sur son déterministe', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const svc = new LalaService(client(interpretationsJson([{ lineId: 'dscr', texte: 'Votre DSCR est à 0,82.' }])));
    const res = await svc.interpretations(
      requeteInterpretations({ lineIds: ['dscr', 'marge_nette_pct'] }),
      'fr',
    );
    expect(res.interpretations.find((i) => i.lineId === 'marge_nette_pct')?.source).toBe('fallback');
    warn.mockRestore();
  });

  it('un texte anormalement long est rejeté, pas tronqué', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const svc = new LalaService(
      client(interpretationsJson([{ lineId: 'dscr', texte: 'Votre DSCR. '.repeat(200) }])),
    );
    const res = await svc.interpretations(requeteInterpretations(), 'fr');
    expect(res.interpretations[0]?.source).toBe('fallback');
    warn.mockRestore();
  });

  it('le chat aussi : une réponse qui chiffre un levier est refusée et NOMMÉE', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const svc = new LalaService(
      client(JSON.stringify({ reponse: 'En baissant le loyer de 250 USD, le DSCR passerait à 1,30.' })),
    );
    const res = await svc.chat(requeteChat(), 'fr');

    expect(res.source).toBe('fallback');
    // On ne prétend PAS que l'assistant est en panne : il a répondu, on refuse.
    expect(res.reply).not.toMatch(/pas joignable/i);
    expect(res.reply).toMatch(/seul le moteur financier/i);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('ReponseChatRefusee'))).toBe(true);
    warn.mockRestore();
  });

  it('une réponse de chat ancrée sur les chiffres affichés passe', async () => {
    const svc = new LalaService(
      client(
        JSON.stringify({
          reponse:
            'Le feu est rouge parce que 0,82 est en dessous du repère de 1,25 : ' +
            'l’exploitation ne dégage pas encore de quoi tenir l’échéance. ' +
            'Les leviers habituels sont la durée du prêt et le niveau des charges fixes.',
        }),
      ),
    );
    const res = await svc.chat(requeteChat(), 'fr');
    expect(res.source).toBe('llm');
    expect(res.reply).toContain('1,25');
  });
});

// ─── La trésorerie mensuelle ne perd jamais sa réserve ───────────────────────

describe('trésorerie mensuelle — réserve structurelle, pas discrétionnaire', () => {
  const reqTreso = requeteInterpretations({
    sheetId: 'tresorerie',
    sheetLabel: 'Trésorerie mensuelle',
    lines: [
      {
        sheetId: 'tresorerie',
        lineId: 'tresorerie_solde_m3',
        label: 'Solde de trésorerie — mois 3',
        value: 1500,
        format: 'money',
      },
    ],
    lineIds: ['tresorerie_solde_m3'],
  });

  it('la réserve accompagne la réponse même quand le texte vient du modèle', async () => {
    const svc = new LalaService(
      client(interpretationsJson([{ lineId: 'tresorerie_solde_m3', texte: 'Le solde du mois 3 s’élève à 1 500 $US.' }])),
    );
    const res = await svc.interpretations(reqTreso, 'fr');

    expect(res.interpretations[0]?.source).toBe('llm');
    expect(res.avertissementFeuille).toMatch(/OPTIMISTE/);
    expect(res.avertissementFeuille).toMatch(/c’est le bilan qui fait foi/i);
    // Elle est aussi RAJOUTÉE au texte : la bulle ne peut pas être lue sans.
    expect(res.interpretations[0]?.texte).toMatch(/jamais être présentée comme la trésorerie de référence/i);
  });

  it('la réserve suit `tresorerie_min_ok`, qui s’affiche pourtant dans `ratios`', async () => {
    const svc = new LalaService(null);
    const res = await svc.chat(requeteChat({ lineId: 'tresorerie_min_ok' }), 'fr');
    expect(res.avertissementFeuille).toMatch(/OPTIMISTE/);
  });

  it('une feuille sans réserve n’en invente pas', async () => {
    const svc = new LalaService(null);
    const res = await svc.interpretations(requeteInterpretations(), 'fr');
    expect(res.avertissementFeuille).toBeNull();
  });
});

// ─── Cadrage des prompts ─────────────────────────────────────────────────────

describe('prompts — les interdits sont écrits, pas sous-entendus', () => {
  it('les deux prompts systèmes portent la même règle absolue', () => {
    for (const p of [promptSystemeInterpretations('fr'), promptSystemeChat('fr')]) {
      expect(p).toMatch(/tu EXPLIQUES des chiffres déjà calculés/);
      expect(p).toMatch(/Ne recalcule rien/);
      expect(p).toMatch(/AUCUN nombre absent des données fournies/);
      expect(p).toMatch(/conseil en investissement/);
      expect(p).toMatch(/français/i);
    }
  });

  it('le prompt d’interprétation demande une lecture, pas une définition', () => {
    expect(promptSystemeInterpretations('fr')).toMatch(/PAS une définition/);
  });

  it('la réserve de portée est transmise au modèle quand la feuille en porte une', () => {
    const req = requeteInterpretations({ sheetId: 'tresorerie' });
    const user = promptUtilisateurInterpretations(req, [], 'RÉSERVE DE TEST');
    expect(user).toContain('RÉSERVE DE TEST');
  });
});

// ─── Parsing et contrôle ─────────────────────────────────────────────────────

describe('parsing strict', () => {
  it('ignore une ligne non demandée sans faire échouer les autres', () => {
    const out = parseInterpretationsLlm(
      interpretationsJson([
        { lineId: 'dscr', texte: 'ok' },
        { lineId: 'inconnu', texte: 'hors périmètre' },
      ]),
      new Set(['dscr']),
    );
    expect([...out.keys()]).toEqual(['dscr']);
  });

  it('refuse une charge sans le champ attendu', () => {
    expect(() => parseInterpretationsLlm('{"autre":[]}', new Set())).toThrow(/interpretations/);
    expect(() => parseReponseChat('{"autre":"x"}')).toThrow(/reponse/);
  });
});

describe('motifDeRefus', () => {
  const autorises = new Set(['0.82', '1.25', '0']);

  it('nomme le motif, dans l’ordre vide → trop long → chiffres', () => {
    expect(motifDeRefus('   ', autorises, 100)).toBe('texte vide');
    expect(motifDeRefus('x'.repeat(101), autorises, 100)).toMatch(/trop long/);
    expect(motifDeRefus('Un DSCR de 9,99.', autorises, 100)).toMatch(/chiffres absents du moteur/);
    expect(motifDeRefus('Un DSCR de 0,82.', autorises, 100)).toBeNull();
  });
});
