// Audit des contextes servis au modèle — ADR-0040 — C0 § 4.4.
//
// Règle : aucune donnée de trésorerie ne part vers l'IA sans `treasury.read`,
// aucun réalisé de plan sans `project.read`. Un test de comportement ne
// prouverait la règle que pour les chemins qu'il monte ; celui-ci FIGE la liste
// des contextes. Ajouter un fichier qui parle au modèle, ou changer la
// permission d'une route qui le nourrit, casse ce test et oblige à refaire
// l'audit (docs/12, docs/17).
//
// Constat du 29 oct. 2026 :
//   - `/ai/interpretations`, `/ai/lala/messages`, `/ai/corrective-actions` :
//     le contexte est le CORPS de la requête, c'est-à-dire des résultats que
//     l'appelant a déjà obtenus sous ses propres permissions. Le module `ai/`
//     ne lit aucune collection métier (vérifié ci-dessous).
//   - `/morning-brief/explanation` : le contexte est le brief construit POUR LE
//     RÔLE (`MorningBriefService.build`) ; sans `treasury.read`, la trésorerie
//     n'y est pas chargée (fait `hidden`).
//   - business plan et Idea Lab : routes sous `canvas.update`, que seuls des
//     rôles détenant aussi `project.read` possèdent.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildMorningBrief, type MorningBriefInput } from '@lalanda/engine';
import { describe, expect, it, vi } from 'vitest';

import { REQUIRED_PERMISSIONS_KEY } from '../authz/authz.decorators.js';
import { NO_OVERRIDES, ORG_ROLES, can, type Action } from '../authz/permissions.js';
import { BusinessPlanController } from '../business-plan/business-plan.controller.js';
import { IdeaLabController } from '../idea-lab/idea-lab.controller.js';
import { payloadFor } from '../morning-brief/morning-brief-ai.js';
import { MorningBriefController } from '../morning-brief/morning-brief.controller.js';
import { MorningBriefService } from '../morning-brief/morning-brief.service.js';
import { AiActionsController } from './ai-actions.controller.js';
import { LalaVocalController } from './lala-vocal.controller.js';
import { LalaController } from './lala.controller.js';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const AI_DIR = fileURLToPath(new URL('.', import.meta.url));

function sourcesOf(dir: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue;
      out.push(...sourcesOf(path));
    } else if (name.endsWith('.ts') && !name.includes('.test.') && !name.endsWith('.d.ts')) {
      out.push({ file: relative(SRC, path), text: readFileSync(path, 'utf8') });
    }
  }
  return out;
}

/**
 * Les fichiers qui tiennent un client du modèle. Toute nouvelle entrée est un
 * nouveau contexte à auditer : il faut l'ajouter ici EN CONNAISSANCE DE CAUSE.
 */
const FICHIERS_QUI_PARLENT_AU_MODELE = [
  'ai/ai-actions.service.ts',
  'ai/ai.module.ts',
  'ai/lala.service.ts',
  'ai/openai-client.ts',
  'business-plan/business-plan-ai.service.ts',
  'business-plan/business-plan.module.ts',
  'idea-lab/idea-lab-ai.service.ts',
  'idea-lab/idea-lab.module.ts',
  'morning-brief/morning-brief-ai.service.ts',
  'morning-brief/morning-brief.module.ts',
].sort();

type Controleur = { prototype: object; name: string };

/** Les routes qui nourrissent le modèle, et la permission qu'elles exigent. */
const ROUTES_DU_MODELE: { ctrl: Controleur; methode: string; actions: Action[] }[] = [
  { ctrl: LalaController, methode: 'interpretations', actions: ['analytics.read'] },
  { ctrl: LalaController, methode: 'chat', actions: ['analytics.read'] },
  { ctrl: AiActionsController, methode: 'corrective', actions: ['analytics.read'] },
  { ctrl: LalaVocalController, methode: 'ouvrir', actions: ['analytics.read'] },
  { ctrl: MorningBriefController, methode: 'explanation', actions: ['analytics.read'] },
  { ctrl: BusinessPlanController, methode: 'draft', actions: ['canvas.update'] },
  { ctrl: IdeaLabController, methode: 'assist', actions: ['canvas.update'] },
];

describe('contextes servis au modèle (ADR-0040 § 4.4)', () => {
  const toutes = sourcesOf(SRC);

  it('la liste des fichiers qui parlent au modèle est figée', () => {
    const trouves = toutes
      .filter(({ text }) => /\bOpenAIChatClient\b|\bOPENAI_CHAT_CLIENT\b/.test(text))
      .map(({ file }) => file)
      .sort();
    expect(trouves).toEqual(FICHIERS_QUI_PARLENT_AU_MODELE);
  });

  it('chaque route qui nourrit le modèle porte la permission auditée', () => {
    for (const { ctrl, methode, actions } of ROUTES_DU_MODELE) {
      const handler = (ctrl.prototype as Record<string, unknown>)[methode];
      expect(typeof handler, `${ctrl.name}.${methode}`).toBe('function');
      expect(
        Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler as object),
        `${ctrl.name}.${methode}`,
      ).toEqual(actions);
    }
  });

  it('`canvas.update` n’est détenue que par des rôles qui lisent aussi les projets et la trésorerie', () => {
    // Business plan et Idea Lab lisent le plan du projet : le rôle doit déjà voir
    // le réalisé et la trésorerie. Le Chef de projet (non attribuable) excepté.
    for (const role of ORG_ROLES) {
      if (!can(role, 'canvas.update', NO_OVERRIDES) || role === 'project_manager') continue;
      expect(can(role, 'project.read', NO_OVERRIDES), role).toBe(true);
      expect(can(role, 'treasury.read', NO_OVERRIDES), role).toBe(true);
    }
  });

  it('le module `ai/` ne lit aucune collection métier', () => {
    const ia = sourcesOf(AI_DIR);
    expect(ia.length).toBeGreaterThan(5);
    const modeles = ia.flatMap(({ text }) =>
      [...text.matchAll(/@InjectModel\((\w+)\.name\)/g)].map((m) => m[1]),
    );
    // Seul modèle : le journal des sessions vocales (minutes consommées).
    expect([...new Set(modeles)]).toEqual(['LalaVocalSession']);
    const interdits =
      /from '\.\.\/(treasury|actuals|sales|grow|crm|work|projects|plans|morning-brief|organization-space|objectives)\//;
    const fautifs = ia.filter(({ text }) => interdits.test(text)).map(({ file }) => file);
    expect(fautifs).toEqual([]);
  });
});

describe('brief du matin envoyé au modèle, sans `treasury.read`', () => {
  const base: Omit<MorningBriefInput, 'cash'> = {
    now: '2026-10-29T08:00:00.000Z',
    sales: 'hidden',
    dueDates: { status: 'unavailable' },
    work: 'hidden',
  };

  it('la trésorerie masquée ne figure dans aucun champ du contexte', () => {
    const avec = payloadFor(
      buildMorningBrief({
        ...base,
        cash: {
          status: 'known',
          amounts: [{ currency: 'USD', amount: '987654.32' }],
          sourceLabel: 'Comptes de trésorerie',
        },
      }),
    );
    // Témoin : avec le droit, le solde part bien au modèle.
    expect(JSON.stringify(avec)).toContain('987654.32');

    const brief = buildMorningBrief({ ...base, cash: 'hidden' });
    const sans = payloadFor(brief);
    expect(sans.faits.some((f) => f.id.startsWith('tresorerie'))).toBe(false);
    expect(sans.faits_non_disponibles).toContainEqual(
      expect.objectContaining({ id: 'tresorerie', statut: 'hidden' }),
    );
    // R7 (« trésorerie à renseigner ») ne se déclenche pas : rien à renseigner
    // pour qui ne voit pas la trésorerie.
    expect(brief.recommendations.map((r) => r.ruleId)).not.toContain('tresorerie_a_renseigner');
  });

  it('le service ne LIT pas la trésorerie pour un rôle sans `treasury.read`', async () => {
    const cashOf = vi.fn(async () => ({ status: 'to_fill' as const }));
    const service = new MorningBriefService(
      null as never,
      null as never,
      null as never,
      { cashOf },
      { dueDatesOf: vi.fn() } as never,
      null as never,
      { workOf: vi.fn() } as never,
    );
    // Le Conseiller n'a ni `sales.read`, ni `work.read`, ni `treasury.read` :
    // aucune source n'est appelée.
    const brief = await service.build('org', 'advisor', NO_OVERRIDES, 'u1', new Date(base.now));
    expect(cashOf).not.toHaveBeenCalled();
    expect(brief.facts.find((f) => f.id === 'tresorerie')?.status).toBe('hidden');
  });
});
