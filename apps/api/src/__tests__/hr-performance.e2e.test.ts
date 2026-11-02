// Objectifs individuels et évaluations contre la vraie application (ADR-0051 § 2.5 à
// § 2.7, § 3.5, § 4 ; critères 1, 2, 13, 14, 16, 17). ADR-0051 — H15.
//
// Couvre : fonction ÉTEINTE par défaut (409), réglages `performance.*` ; objectifs
// (proposés par soi, convenus et clos par le manager, jamais par soi, collègue hors
// chaîne en 404) ; campagne (trame saisie, évaluateur = manager, repli RH) ; contenu
// CHIFFRÉ (absent du document Mongo, des listes, du journal, des notifications) ;
// `reveal` journalisé AVANT la réponse (503 si l'audit échoue), 30 par heure (429) ;
// notes choisies dans l'échelle, aucune `overall` inventée ; prise de connaissance qui
// ne change rien d'autre ; clôture par `reviewCloseDecision` (ni l'évaluateur ni
// l'évalué) ; Directeur financier, Administrateur, autre organisation et plateforme
// en 404 ; anonymisation qui efface le contenu ; rotation `secrets:rewrap` k1 → k2.
//
// Appréciations et personnes inventées.

import 'reflect-metadata';

import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { Connection, Model } from 'mongoose';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditService } from '../authz/audit.service.js';
import { HrReviewsService } from '../hr/performance/hr-reviews.service.js';
import { Integration, type IntegrationDocument } from '../integrations/integration.schema.js';
import {
  OrganizationSecret,
  type OrganizationSecretDocument,
} from '../integrations/organization-secret.schema.js';
import { PlatformAuditService } from '../integrations/platform-audit.service.js';
import { RewrapService } from '../integrations/rewrap.js';
import { MasterKeyring } from '../integrations/secrets-crypto.js';
import { SecretsService } from '../integrations/secrets.service.js';
import { e2eSuite } from './e2e-utils.js';
import { code, fiche, hrFixture, ok, type HrAccount, type HrFixture } from './hr-e2e-fixtures.js';

const tag = randomBytes(4).toString('hex');
const CLE_K1 = randomBytes(32);
process.env['SECRETS_MASTER_KEY'] = CLE_K1.toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k1';

vi.setConfig({ testTimeout: 180_000 });

/** Marques qui ne doivent JAMAIS apparaître en clair hors de `reveal`. */
const AUTO = `AUTOEVAL-${tag}-QX`;
const APPRECIATION = `APPRECIATION-${tag}-ZK`;
const COMMENTAIRE = `COMMENTAIRE-${tag}-WV`;
const NOTE_RH = `NOTERH-${tag}-PL`;
const MARQUES = [AUTO, APPRECIATION, COMMENTAIRE, NOTE_RH];

const TRAME = {
  sections: [
    { id: 'bilan', title: 'Bilan de la période', kind: 'text' },
    {
      id: 'savoir_etre',
      title: 'Savoir-être',
      kind: 'scale',
      scale: { min: 1, max: 4, labels: ['Insuffisant', 'À développer', 'Maîtrisé', 'Remarquable'] },
    },
    { id: 'objectifs', title: 'Objectifs', kind: 'goals' },
  ],
};

e2eSuite('RH — objectifs et évaluations (ADR-0051 H15)', () => {
  let fx: HrFixture;
  let db: Db;
  /** A : Analyste, manager de B (Lecteur) ; C : Commercial sans manager ; D : fiche sans compte, manager A. */
  const id = { A: '', B: '', C: '', D: '' };
  const rv = { B: '', C: '', D: '' };
  const cycle = { un: '', deux: '', trois: '' };

  const revDe = async (col: string, x: string) =>
    ((await db.collection(col).findOne({ _id: new ObjectId(x) }))?.['revision'] ?? 0) as number;
  const reveal = (c: HrAccount, r: string, sections: string[]) =>
    fx.post(c, `/hr/reviews/${r}/reveal`, { sections });
  const etape = async (c: HrAccount, r: string, step: string) =>
    fx.post(c, `/hr/reviews/${r}/${step}`, { expectedRevision: await revDe('hr_reviews', r) });
  const ecrire = async (c: HrAccount, r: string, section: string, body: Record<string, unknown>) =>
    fx.put(c, `/hr/reviews/${r}/sections/${section}`, {
      expectedRevision: await revDe('hr_reviews', r),
      ...body,
    });
  const activer = async (c: HrAccount) => {
    const lu = ok(await fx.get(c, '/hr/settings/performance'));
    return ok(
      await fx.put(c, '/hr/settings/performance', {
        expectedRevision: lu['revision'],
        enabled: true,
      }),
    );
  };

  beforeAll(async () => {
    fx = await hrFixture(tag, 'rh-perf');
    db = fx.db;
    const res = ok(
      await fx.post('owner', '/hr/employees/from-members', {
        userIds: [fx.userIds['analyst'], fx.userIds['viewer'], fx.userIds['sales_rep']],
      }),
      201,
    );
    const byUser = (u: string) =>
      res['items'].find((e: { userId: string }) => e.userId === u)['id'] as string;
    id.A = byUser(fx.userIds['analyst']);
    id.B = byUser(fx.userIds['viewer']);
    id.C = byUser(fx.userIds['sales_rep']);
    ok(
      await fx.put('owner', `/hr/employees/${id.B}`, {
        expectedRevision: await revDe('hr_employees', id.B),
        managerEmployeeId: id.A,
      }),
    );
    id.D = ok(
      await fx.post('owner', '/hr/employees', fiche(`Hôtesse ${tag}`, { managerEmployeeId: id.A })),
      201,
    )['id'];
  }, 300_000);

  beforeEach(() => fx.clearThrottle());

  afterAll(async () => {
    try {
      if (fx) await fx.db.dropDatabase();
    } finally {
      await fx?.app.close();
    }
  }, 60_000);

  describe('éteint par défaut (critère 17) et réglages', () => {
    it('409 HR_FEATURE_DISABLED partout ; réglages : défauts prudents ; écriture par `hr.manage`', async () => {
      expect(ok(await fx.get('viewer', '/hr/settings/performance'))).toMatchObject({
        enabled: false,
        managerChainDepth: 1,
        reviewsYearsAfterExit: null,
        isDefault: true,
      });
      code(await fx.get('viewer', '/hr/goals'), 409, 'HR_FEATURE_DISABLED');
      code(await fx.get('owner', '/hr/reviews'), 409, 'HR_FEATURE_DISABLED');
      code(await fx.get('hr_manager', '/hr/review-cycles'), 409, 'HR_FEATURE_DISABLED');
      code(
        await fx.post('viewer', '/hr/goals', {
          period: { from: '2026-01-01', to: '2026-12-31' },
          title: 'Objectif',
        }),
        409,
        'HR_FEATURE_DISABLED',
      );
      // Le Lecteur ne règle rien ; le Responsable RH active.
      const refus = await fx.put('viewer', '/hr/settings/performance', {
        expectedRevision: 0,
        enabled: true,
      });
      expect(refus.status).toBe(403);
      code(
        await fx.put('hr_manager', '/hr/settings/performance', {
          expectedRevision: 5,
          enabled: true,
        }),
        409,
        'STALE_REVISION',
      );
      const v = await activer('hr_manager');
      expect(v).toMatchObject({ enabled: true, managerChainDepth: 1, reviewsYearsAfterExit: null });
      // Les autres réglages RH restent lisibles et intacts.
      expect(ok(await fx.get('hr_manager', '/hr/settings'))['approvalFlow']).toBeDefined();
    });
  });

  describe('objectifs (critère 13)', () => {
    let goal = '';

    it('B propose ; B ne convient pas son objectif ; C hors chaîne : 404 ; A convient', async () => {
      const g = ok(
        await fx.post('viewer', '/hr/goals', {
          period: { from: '2026-01-01', to: '2026-12-31' },
          title: `Ouvrir le guichet de Matadi ${tag}`,
          measure: 'Guichet ouvert et tenu',
          target: { kind: 'number', value: '2', unit: 'guichets' },
          weight: 40,
        }),
        201,
      );
      goal = g['id'];
      expect(g).toMatchObject({ employeeId: id.B, status: 'proposed', agreedBy: null });
      code(
        await fx.post('viewer', `/hr/goals/${goal}/agree`, { expectedRevision: 1 }),
        409,
        'SELF_APPROVAL_FORBIDDEN',
      );
      // Collègue hors chaîne, Directeur financier, Administrateur, autre organisation : 404.
      code(await fx.get('sales_rep', `/hr/goals?employeeId=${id.B}`), 404, 'EMPLOYEE_NOT_FOUND');
      for (const c of ['sales_rep', 'finance_director', 'admin'] as const) {
        code(
          await fx.post(c, `/hr/goals/${goal}/agree`, { expectedRevision: 1 }),
          404,
          'GOAL_NOT_FOUND',
        );
        expect(ok(await fx.get(c, '/hr/goals'))['items']).toEqual([]);
      }
      // Notification au manager direct : l'étape, jamais le contenu.
      const notifs = await db
        .collection('notifications')
        .find({ organizationId: fx.orgN, kind: 'hr.goal_proposed' })
        .toArray();
      expect(notifs.map((n) => n['recipientUserId'])).toEqual([fx.userIds['analyst']]);
      expect(JSON.stringify(notifs)).not.toContain('Matadi');

      const agreed = ok(
        await fx.post('analyst', `/hr/goals/${goal}/agree`, { expectedRevision: 1 }),
      );
      expect(agreed).toMatchObject({ status: 'agreed', agreedBy: fx.userIds['analyst'] });
      // Le Responsable RH (`performance.read`) voit tout ; A voit son équipe.
      expect(
        ok(await fx.get('hr_manager', '/hr/goals'))['items'].map((x: { id: string }) => x.id),
      ).toContain(goal);
      expect(ok(await fx.get('analyst', `/hr/goals?employeeId=${id.B}`))['items']).toHaveLength(1);
    });

    it('avancement déclaré (ajout seul), statut final posé par A avec commentaire, jamais par B', async () => {
      const p = ok(
        await fx.post('viewer', `/hr/goals/${goal}/progress`, {
          percent: 50,
          note: 'Local trouvé',
        }),
      );
      expect(p['progress']).toHaveLength(1);
      expect(p['progress'][0]).toMatchObject({ by: fx.userIds['viewer'], percent: 50 });
      code(
        await fx.post('viewer', `/hr/goals/${goal}/close`, {
          expectedRevision: p['revision'],
          status: 'achieved',
          comment: 'Fait',
        }),
        409,
        'SELF_APPROVAL_FORBIDDEN',
      );
      // B ne modifie plus un objectif convenu ; A le peut.
      code(
        await fx.put('viewer', `/hr/goals/${goal}`, {
          expectedRevision: p['revision'],
          title: 'Autre',
        }),
        409,
        'GOAL_WRONG_STATUS',
      );
      const closed = ok(
        await fx.post('analyst', `/hr/goals/${goal}/close`, {
          expectedRevision: p['revision'],
          status: 'partially_achieved',
          comment: 'Un guichet sur deux',
        }),
      );
      expect(closed).toMatchObject({
        status: 'partially_achieved',
        closedBy: fx.userIds['analyst'],
      });
      // Aucun avancement calculé : la seule valeur est celle déclarée.
      expect(Object.keys(closed)).not.toContain('computedProgress');
    });

    it('A pose un objectif pour B : convenu par celui qui le pose ; projet d’une autre organisation refusé', async () => {
      const g = ok(
        await fx.post('analyst', '/hr/goals', {
          employeeId: id.B,
          period: { from: '2026-07-01', to: '2026-12-31' },
          title: 'Former un binôme',
        }),
        201,
      );
      expect(g).toMatchObject({ status: 'agreed', agreedBy: fx.userIds['analyst'] });
      code(
        await fx.post('analyst', '/hr/goals', {
          employeeId: id.B,
          period: { from: '2026-07-01', to: '2026-12-31' },
          title: 'Projet forgé',
          workProjectId: '0123456789abcdef01234567',
        }),
        422,
        'GOAL_WORK_PROJECT_UNKNOWN',
      );
      // Sans fiche reliée : 409.
      code(
        await fx.post('accountant', '/hr/goals', {
          period: { from: '2026-01-01', to: '2026-12-31' },
          title: 'Pour moi',
        }),
        409,
        'EMPLOYEE_NOT_LINKED',
      );
    });
  });

  describe('campagnes (performance.read + hr.manage)', () => {
    it('Administrateur et Directeur financier : 403 nommant `performance.read` ; trame saisie contrôlée', async () => {
      const corps = {
        label: `Entretiens 2026 ${tag}`,
        period: { from: '2026-01-01', to: '2026-12-31' },
        template: TRAME,
        includesSelfAssessment: true,
        openOn: '2026-11-01',
        dueOn: '2026-11-30',
        employeeIds: [id.B],
      };
      for (const c of ['admin', 'finance_director', 'analyst'] as const) {
        const r = await fx.post(c, '/hr/review-cycles', corps);
        expect(r.status, c).toBe(403);
        expect(r.body.action).toBe('performance.read');
      }
      // Échelle sans libellés cohérents : refusée par le moteur.
      code(
        await fx.post('hr_manager', '/hr/review-cycles', {
          ...corps,
          template: {
            sections: [
              { id: 'x', title: 'X', kind: 'scale', scale: { min: 1, max: 4, labels: ['a'] } },
            ],
          },
        }),
        422,
        'REVIEW_TEMPLATE_INVALID',
      );
      // Collaborateur d'une autre organisation : 404.
      code(
        await fx.post('hr_manager', '/hr/review-cycles', {
          ...corps,
          employeeIds: ['0123456789abcdef01234567'],
        }),
        404,
        'EMPLOYEE_NOT_FOUND',
      );
      const c1 = ok(await fx.post('hr_manager', '/hr/review-cycles', corps), 201);
      cycle.un = c1['id'];
      expect(c1).toMatchObject({ status: 'draft', progress: null });
      const opened = ok(
        await fx.post('hr_manager', `/hr/review-cycles/${cycle.un}/open`, {
          expectedRevision: 1,
        }),
      );
      expect(opened['status']).toBe('open');
      expect(opened['progress']).toMatchObject({ total: 1, awaitingSelf: 1 });
      const list = ok(await fx.get('hr_manager', `/hr/reviews?cycleId=${cycle.un}`));
      expect(list['items']).toHaveLength(1);
      expect(list['items'][0]).toEqual({
        id: expect.any(String),
        cycleId: cycle.un,
        employeeId: id.B,
        reviewerUserId: fx.userIds['analyst'],
        status: 'not_started',
        revision: 1,
      });
      rv.B = list['items'][0]['id'];
    });

    it('sans manager : évaluateur de repli parmi les RH, jamais le collaborateur lui-même', async () => {
      const c2 = ok(
        await fx.post('hr_manager', '/hr/review-cycles', {
          label: `Fin de période d’essai ${tag}`,
          period: { from: '2026-06-01', to: '2026-10-31' },
          template: { sections: [TRAME.sections[0], TRAME.sections[1]] },
          includesSelfAssessment: false,
          openOn: '2026-11-01',
          dueOn: '2026-11-30',
          employeeIds: [id.C],
        }),
        201,
      );
      cycle.deux = c2['id'];
      const req = await fx.post('hr_manager', `/hr/review-cycles/${cycle.deux}/open`, {
        expectedRevision: 1,
      });
      code(req, 422, 'REVIEWER_REQUIRED');
      expect(req.body.details.employeeIds).toEqual([id.C]);
      code(
        await fx.post('hr_manager', `/hr/review-cycles/${cycle.deux}/open`, {
          expectedRevision: 1,
          fallbackReviewerUserId: fx.userIds['analyst'],
        }),
        422,
        'REVIEWER_NOT_ELIGIBLE',
      );
      ok(
        await fx.post('hr_manager', `/hr/review-cycles/${cycle.deux}/open`, {
          expectedRevision: 1,
          fallbackReviewerUserId: fx.userIds['hr_manager'],
        }),
      );
      const items = ok(await fx.get('hr_manager', `/hr/reviews?cycleId=${cycle.deux}`))['items'];
      expect(items[0]).toMatchObject({
        employeeId: id.C,
        reviewerUserId: fx.userIds['hr_manager'],
      });
      rv.C = items[0]['id'];
      // Changer d'évaluateur pour le collaborateur lui-même : refusé ; la garde exige les deux droits.
      code(
        await fx.post('hr_manager', `/hr/reviews/${rv.C}/reassign`, {
          expectedRevision: 1,
          reviewerUserId: fx.userIds['sales_rep'],
          reason: 'Essai',
        }),
        409,
        'REVIEWER_IS_EMPLOYEE',
      );
      const refus = await fx.post('admin', `/hr/reviews/${rv.C}/reassign`, {
        expectedRevision: 1,
        reviewerUserId: fx.userIds['owner'],
        reason: 'Essai',
      });
      expect(refus.status).toBe(403);
      expect(refus.body.action).toBe('performance.read');
    });
  });

  describe('évaluation de B : contenu chiffré, reveal, prise de connaissance, clôture (critère 14)', () => {
    it('auto-évaluation, appréciation notée dans l’échelle, partage', async () => {
      // A ne rédige pas l'auto-évaluation ; B ne rédige pas l'appréciation.
      code(
        await ecrire('analyst', rv.B, 'selfAssessment', { answers: { bilan: 'x' } }),
        403,
        'REVIEW_SECTION_NOT_YOURS',
      );
      code(
        await ecrire('viewer', rv.B, 'managerAssessment', { answers: { bilan: 'x' } }),
        403,
        'REVIEW_SECTION_NOT_YOURS',
      );
      // Une auto-évaluation ne porte pas de note.
      code(
        await ecrire('viewer', rv.B, 'selfAssessment', {
          answers: { bilan: AUTO },
          ratings: { savoir_etre: 3 },
        }),
        422,
        'REVIEW_RATINGS_NOT_ALLOWED',
      );
      ok(await ecrire('viewer', rv.B, 'selfAssessment', { answers: { bilan: AUTO } }));
      // A ne lit pas l'auto-évaluation avant sa remise.
      code(await reveal('analyst', rv.B, ['selfAssessment']), 409, 'REVIEW_WRONG_STATUS');
      code(await etape('analyst', rv.B, 'submit-manager'), 409, 'REVIEW_WRONG_STATUS');
      ok(await etape('viewer', rv.B, 'submit-self'));

      // Note hors échelle, note sur une section non notée : refusées.
      code(
        await ecrire('analyst', rv.B, 'managerAssessment', {
          answers: { bilan: APPRECIATION },
          ratings: { savoir_etre: 9 },
        }),
        422,
        'REVIEW_RATING_OUT_OF_SCALE',
      );
      code(
        await ecrire('analyst', rv.B, 'managerAssessment', {
          answers: { bilan: APPRECIATION },
          ratings: { bilan: 2 },
        }),
        422,
        'REVIEW_RATING_OUT_OF_SCALE',
      );
      ok(
        await ecrire('analyst', rv.B, 'managerAssessment', {
          answers: { bilan: APPRECIATION },
          ratings: { savoir_etre: 3 },
        }),
      );
      expect(
        ok(await reveal('analyst', rv.B, ['selfAssessment']))['sections']['selfAssessment'],
      ).toEqual({ answers: { bilan: AUTO } });
      // B ne lit pas l'appréciation avant le partage.
      code(await reveal('viewer', rv.B, ['managerAssessment']), 409, 'REVIEW_WRONG_STATUS');
      ok(await etape('analyst', rv.B, 'submit-manager'));
      ok(await etape('analyst', rv.B, 'share'));

      const lu = ok(await reveal('viewer', rv.B, ['managerAssessment']));
      // Aucune note `overall` si A ne l'a pas choisie ; aucune moyenne.
      expect(lu['sections']['managerAssessment']).toEqual({
        answers: { bilan: APPRECIATION },
        ratings: { savoir_etre: 3 },
      });
      expect(lu['template']['sections'].map((s: { id: string }) => s.id)).toEqual([
        'bilan',
        'savoir_etre',
        'objectifs',
      ]);
      // Instantané des objectifs de la période : titres et statuts.
      expect(lu['goalSnapshot'].length).toBeGreaterThanOrEqual(1);
      expect(lu['goalSnapshot'][0]).toEqual({
        goalId: expect.any(String),
        title: expect.any(String),
        status: expect.any(String),
      });
    });

    it('B commente et prend connaissance : seuls le statut et la signature changent', async () => {
      ok(await ecrire('viewer', rv.B, 'employeeComment', { answers: { comment: COMMENTAIRE } }));
      code(
        await ecrire('viewer', rv.B, 'employeeComment', { answers: { bilan: 'x' } }),
        422,
        'REVIEW_ANSWER_UNKNOWN_SECTION',
      );
      const avant = (await db.collection('hr_reviews').findOne({ _id: new ObjectId(rv.B) }))!;
      ok(await etape('viewer', rv.B, 'acknowledge'));
      const apres = (await db.collection('hr_reviews').findOne({ _id: new ObjectId(rv.B) }))!;
      const changes = Object.keys(apres)
        .filter((k) => JSON.stringify(apres[k]) !== JSON.stringify(avant[k]))
        .sort();
      const permis = [
        'acknowledgedAt',
        'acknowledgedBy',
        'revision',
        'status',
        'updatedAt',
        'updatedBy',
      ];
      for (const k of changes) expect(permis, k).toContain(k);
      for (const k of ['acknowledgedAt', 'acknowledgedBy', 'status']) expect(changes).toContain(k);
      expect(apres['status']).toBe('acknowledged');
      // L'évaluateur lit le commentaire après la prise de connaissance.
      expect(
        ok(await reveal('analyst', rv.B, ['employeeComment']))['sections']['employeeComment'],
      ).toEqual({ answers: { comment: COMMENTAIRE } });
    });

    it('note RH : `performance.read` seul ; ni l’évaluateur ni l’évalué ne la lisent', async () => {
      code(
        await ecrire('analyst', rv.B, 'hrNote', { answers: { comment: 'x' } }),
        403,
        'REVIEW_SECTION_NOT_YOURS',
      );
      ok(await ecrire('hr_manager', rv.B, 'hrNote', { answers: { comment: NOTE_RH } }));
      code(await reveal('analyst', rv.B, ['hrNote']), 403, 'REVIEW_SECTION_NOT_YOURS');
      code(await reveal('viewer', rv.B, ['hrNote']), 403, 'REVIEW_SECTION_NOT_YOURS');
      expect(ok(await reveal('owner', rv.B, ['hrNote']))['sections']['hrNote']).toEqual({
        answers: { comment: NOTE_RH },
      });
    });

    it('Directeur financier, Administrateur, autre organisation, plateforme, collègue : 404 (critères 1, 2, 16)', async () => {
      for (const c of ['finance_director', 'admin', 'sales_rep', 'accountant'] as const) {
        code(await reveal(c, rv.B, ['managerAssessment']), 404, 'REVIEW_NOT_FOUND');
        code(
          await ecrire(c, rv.B, 'hrNote', { answers: { comment: 'x' } }),
          404,
          'REVIEW_NOT_FOUND',
        );
        // Seulement les siennes (le Commercial est C, évalué dans la campagne 2).
        const items = ok(await fx.get(c, '/hr/reviews'))['items'] as { id: string }[];
        expect(items.map((x) => x.id)).not.toContain(rv.B);
        if (c !== 'sales_rep') expect(items).toEqual([]);
      }
      // Autre organisation (évaluations activées chez elle) : 404 sur des identifiants forgés.
      await activer('ownerB');
      code(await reveal('ownerB', rv.B, ['managerAssessment']), 404, 'REVIEW_NOT_FOUND');
      code(await fx.get('ownerB', `/hr/goals?employeeId=${id.B}`), 404, 'EMPLOYEE_NOT_FOUND');
      code(
        await fx.post('ownerB', `/hr/review-cycles/${cycle.un}/close`, { expectedRevision: 2 }),
        404,
        'REVIEW_CYCLE_NOT_FOUND',
      );
      expect(ok(await fx.get('ownerB', '/hr/reviews'))['items']).toEqual([]);
      // Plateforme sans appartenance à N (ramenée à sa propre organisation, évaluations
      // activées) : 404, jamais un contenu ; `performance.read` lui est interdit absolument.
      await activer('superAdmin');
      const p = await reveal('superAdmin', rv.B, ['managerAssessment']);
      code(p, 404, 'REVIEW_NOT_FOUND');
      expect(JSON.stringify(p.body)).not.toContain(APPRECIATION);
    });

    it('clôture : l’évaluateur RH ne clôt pas la sienne (409), le Propriétaire la clôt « non signée »', async () => {
      // Évaluation de C (évaluateur : Responsable RH), sans auto-évaluation.
      ok(
        await ecrire('hr_manager', rv.C, 'managerAssessment', {
          answers: { bilan: APPRECIATION },
          ratings: { savoir_etre: 2 },
          overall: 2,
        }),
      );
      ok(await etape('hr_manager', rv.C, 'submit-manager'));
      ok(await etape('hr_manager', rv.C, 'share'));
      code(await etape('hr_manager', rv.C, 'close'), 409, 'REVIEW_CLOSE_FORBIDDEN');
      // A (évaluateur de B) n'a pas la garde de route.
      const refus = await etape('analyst', rv.B, 'close');
      expect(refus.status).toBe(403);
      expect(refus.body.action).toBe('hr.manage');
      const c = ok(await etape('owner', rv.C, 'close'));
      expect(c).toMatchObject({ status: 'closed', soleApprover: false, unsigned: true });
      const b = ok(await etape('hr_manager', rv.B, 'close'));
      expect(b).toMatchObject({ status: 'closed', soleApprover: false, unsigned: false });
      const trace = await db
        .collection('audit_events')
        .findOne({ action: 'hr.review.closed', targetId: rv.C });
      expect(trace?.['metadata']).toEqual({ soleApprover: false, unsigned: true });
      // Plus rien ne s'écrit sur une évaluation close.
      code(
        await ecrire('hr_manager', rv.B, 'hrNote', { answers: { comment: 'tard' } }),
        409,
        'REVIEW_WRONG_STATUS',
      );
      const cycles = ok(await fx.get('hr_manager', '/hr/review-cycles'))['items'];
      expect(cycles.find((x: { id: string }) => x.id === cycle.un)['progress']).toMatchObject({
        total: 1,
        closed: 1,
      });
    });
  });

  describe('anti-fuite et journal (critère 14)', () => {
    it('aucun contenu en clair : document Mongo, listes, journal, notifications', async () => {
      const docs = await db.collection('hr_reviews').find({ organizationId: fx.orgN }).toArray();
      const enBase = JSON.stringify(docs);
      for (const m of MARQUES) expect(enBase).not.toContain(m);
      expect(
        docs.find((d) => String(d['_id']) === rv.B)!['managerAssessment']['cipher'],
      ).toMatchObject({
        alg: 'aes-256-gcm',
        keyId: 'k1',
        last4: null,
      });
      for (const c of ['owner', 'hr_manager', 'analyst', 'viewer'] as const) {
        const l = JSON.stringify(ok(await fx.get(c, '/hr/reviews')));
        for (const m of MARQUES) expect(l).not.toContain(m);
        expect(l).not.toContain('ratings');
      }
      const journal = await db
        .collection('audit_events')
        .find({ organizationId: fx.orgN })
        .toArray();
      const j = JSON.stringify(journal);
      for (const m of MARQUES) expect(j).not.toContain(m);
      const changed = journal.filter((e) => e['action'] === 'hr.review.changed');
      expect(changed.length).toBeGreaterThanOrEqual(5);
      for (const e of changed)
        expect(Object.keys(e['metadata']).sort()).toEqual(['change', 'section']);
      const revealed = journal.filter((e) => e['action'] === 'hr.review.revealed');
      expect(revealed.length).toBeGreaterThan(0);
      for (const e of revealed)
        expect(Object.keys(e['metadata']).sort()).toEqual(['sections', 'self']);
      const notifs = JSON.stringify(
        await db.collection('notifications').find({ organizationId: fx.orgN }).toArray(),
      );
      for (const m of MARQUES) expect(notifs).not.toContain(m);
      const etapes = await db
        .collection('notifications')
        .find({ organizationId: fx.orgN, kind: 'hr.review_step' })
        .toArray();
      expect(etapes.length).toBeGreaterThan(0);
    });

    it('audit en échec : 503 et rien de révélé', async () => {
      const audit = fx.app.get(AuditService);
      const spy = vi
        .spyOn(audit, 'recordStrict')
        .mockRejectedValueOnce(new Error('journal indisponible'));
      try {
        const res = await reveal('hr_manager', rv.B, ['managerAssessment']);
        code(res, 503, 'HR_AUDIT_UNAVAILABLE');
        expect(JSON.stringify(res.body)).not.toContain(APPRECIATION);
      } finally {
        spy.mockRestore();
      }
    });

    it('31e affichage de l’heure : 429', async () => {
      const deja = await db.collection('audit_events').countDocuments({
        actorUserId: fx.userIds['owner'],
        action: 'hr.review.revealed',
      });
      const faux = Array.from({ length: Math.max(0, 30 - deja) }, () => ({
        organizationId: fx.orgN,
        actorUserId: fx.userIds['owner'],
        actorRole: 'owner',
        action: 'hr.review.revealed',
        targetType: 'hr_review',
        targetId: rv.B,
        metadata: { sections: ['hrNote'], self: false },
        createdAt: new Date(),
      }));
      if (faux.length > 0) await db.collection('audit_events').insertMany(faux);
      code(await reveal('owner', rv.B, ['hrNote']), 429, 'HR_REVEAL_RATE_LIMITED');
    });
  });

  describe('rotation et anonymisation', () => {
    it('rotation k1 → k2 : toutes les sections re-chiffrées, relues avec la seule k2', async () => {
      const k1 = { keyId: 'k1', key: CLE_K1 };
      const k2 = { keyId: 'k2', key: randomBytes(32) };
      const rewrap = new RewrapService(
        fx.app.get<Model<IntegrationDocument>>(getModelToken(Integration.name)),
        fx.app.get<Model<OrganizationSecretDocument>>(getModelToken(OrganizationSecret.name)),
        fx.app.get<Connection>(getConnectionToken()),
        MasterKeyring.of([k2, k1], 'k2'),
        fx.app.get(PlatformAuditService),
        fx.app.get(SecretsService),
      );
      const sections = async () =>
        (await db.collection('hr_reviews').find({ organizationId: fx.orgN }).toArray()).flatMap(
          (d) =>
            ['selfAssessment', 'managerAssessment', 'employeeComment', 'hrNote']
              .filter((s) => d[s]?.cipher)
              .map((s) => [String(d['_id']), s, d[s].cipher.keyId] as const),
        );
      const avant = await sections();
      // B : quatre sections ; C : une.
      expect(avant.length).toBe(5);
      const revisionsAvant = await db
        .collection('hr_reviews')
        .find({ organizationId: fx.orgN }, { projection: { revision: 1 } })
        .toArray();

      const premier = await rewrap.run('operateur-1');
      expect(premier.remainingKeyIds).toEqual([]);
      for (const [, , keyId] of await sections()) expect(keyId).toBe('k2');
      // Une rotation n'est pas une modification métier : révisions inchangées.
      for (const r of revisionsAvant) {
        expect(await revDe('hr_reviews', String(r['_id']))).toBe(r['revision']);
      }
      const second = await rewrap.run('operateur-1');
      expect(second.rewrapped).toBe(0);
      expect(second.remainingKeyIds).toEqual([]);

      // `_PREVIOUS` retirée : l'application ne connaît plus que k2.
      const service = fx.app.get(HrReviewsService) as unknown as { keyring: MasterKeyring };
      const ancien = service.keyring;
      service.keyring = MasterKeyring.of([k2], 'k2');
      try {
        const lu = ok(
          await reveal('hr_manager', rv.B, [
            'selfAssessment',
            'managerAssessment',
            'employeeComment',
            'hrNote',
          ]),
        );
        expect(lu['sections']).toEqual({
          selfAssessment: { answers: { bilan: AUTO } },
          managerAssessment: { answers: { bilan: APPRECIATION }, ratings: { savoir_etre: 3 } },
          employeeComment: { answers: { comment: COMMENTAIRE } },
          hrNote: { answers: { comment: NOTE_RH } },
        });
      } finally {
        service.keyring = ancien;
      }
      const traces = await db
        .collection('audit_events')
        .find({ action: 'secret.rewrapped', targetType: 'hr_review' })
        .toArray();
      expect(traces.length).toBe(avant.length);
      for (const t of traces) {
        expect(Object.keys(t['metadata']).sort()).toEqual(['keyId', 'section']);
        expect(t['metadata']['keyId']).toBe('k2');
      }
    });

    it('anonymisation : contenu et instantané effacés, squelette conservé', async () => {
      const c3 = ok(
        await fx.post('hr_manager', '/hr/review-cycles', {
          label: `Bilan saisonnier ${tag}`,
          period: { from: '2026-01-01', to: '2026-03-31' },
          template: { sections: [TRAME.sections[0]] },
          includesSelfAssessment: false,
          openOn: '2026-04-01',
          dueOn: '2026-04-30',
          employeeIds: [id.D],
        }),
        201,
      );
      cycle.trois = c3['id'];
      ok(
        await fx.post('hr_manager', `/hr/review-cycles/${cycle.trois}/open`, {
          expectedRevision: 1,
        }),
      );
      rv.D = ok(await fx.get('analyst', `/hr/reviews?cycleId=${cycle.trois}`))['items'][0]['id'];
      ok(await ecrire('analyst', rv.D, 'managerAssessment', { answers: { bilan: APPRECIATION } }));
      ok(
        await fx.post('hr_manager', `/hr/employees/${id.D}/exit`, {
          endDate: '2026-05-01',
          exitCategory: 'end_of_contract',
          expectedRevision: await revDe('hr_employees', id.D),
        }),
      );
      ok(
        await fx.post('owner', `/hr/employees/${id.D}/anonymize`, {
          confirm: true,
          expectedRevision: await revDe('hr_employees', id.D),
        }),
      );
      const d = (await db.collection('hr_reviews').findOne({ _id: new ObjectId(rv.D) }))!;
      expect(d).toMatchObject({
        selfAssessment: null,
        managerAssessment: null,
        employeeComment: null,
        hrNote: null,
        goalSnapshot: null,
        cycleId: cycle.trois,
        status: 'not_started',
        reviewerUserId: fx.userIds['analyst'],
      });
      expect(d['erasedAt']).toBeInstanceOf(Date);
      // Le manager ne voit plus rien ; `performance.read` voit un squelette vide.
      code(await reveal('analyst', rv.D, ['managerAssessment']), 404, 'REVIEW_NOT_FOUND');
      expect(ok(await reveal('hr_manager', rv.D, ['managerAssessment']))['sections']).toEqual({
        managerAssessment: null,
      });
      // Les évaluations d'autrui sont intactes.
      expect(
        (await db.collection('hr_reviews').findOne({ _id: new ObjectId(rv.B) }))![
          'managerAssessment'
        ],
      ).not.toBeNull();
    });
  });
});
