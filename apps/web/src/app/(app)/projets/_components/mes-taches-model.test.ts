import type { CrmMyTaskItem } from '@lalanda/shared/crm';
import type { HrMyTaskItem } from '@lalanda/shared/hr';
import type { PurchasesMyTaskItem } from '@lalanda/shared/purchases';
import type { MyTasksView, WorkMyTaskItem } from '@lalanda/shared/work';
import { describe, expect, it } from 'vitest';

import { oid, tache } from './fixtures.test-helpers';
import {
  PASTILLE_APPROBATION,
  PASTILLE_VALIDATION_ABSENCE,
  aPlat,
  appliquerRelance,
  appliquerTache,
  estApprobation,
  estElementRh,
  estRelance,
  GROUPES_MES_TACHES,
  instantDeplace,
  peutCocherRelance,
  regrouper,
  retirerElement,
  pastilleElementRh,
  sousTitreApprobation,
  sousTitreElementRh,
  sousTitreRelance,
  titreElementRh,
  totalMesTaches,
} from './mes-taches-model';

const item = (i: number, dueDate: string | null): WorkMyTaskItem => ({
  ...tache({ id: oid(i), dueDate }),
  projectName: 'Chantier',
  source: 'work',
});

const relance = (activityId: string, dueDate: string, dueAt: string): CrmMyTaskItem => ({
  source: 'crm',
  id: `crm:${activityId}`,
  activityId,
  kind: 'follow_up',
  kindLabel: 'Relance',
  subject: 'Relancer le client',
  notes: null,
  dueDate,
  dueAt,
  priority: 'none',
  rank: dueAt,
  done: false,
  accountId: null,
  accountName: null,
  opportunityId: 'o1',
  opportunityTitle: 'Logiciel de caisse',
  contactId: null,
  contactName: null,
  customerId: null,
  assigneeUserId: 'u1',
  revision: 3,
  href: '/crm/opportunites/o1',
});

const vue: MyTasksView = {
  asOf: '2026-10-29',
  overdue: [item(1, '2026-10-20')],
  today: [item(2, '2026-10-29')],
  next7Days: [item(3, '2026-11-02')],
  later: [],
  noDate: [item(4, null)],
  dueSoonCount: 1,
  truncated: false,
};

describe('Mes tâches', () => {
  it('cinq groupes dans l’ordre de l’ADR', () => {
    expect(GROUPES_MES_TACHES.map((g) => g.cle)).toEqual([
      'overdue',
      'today',
      'next7Days',
      'later',
      'noDate',
    ]);
  });
  it('terminer une tâche la retire et garde le nom du projet des autres', () => {
    const t = { ...item(2, '2026-10-29'), done: true };
    const v = appliquerTache(vue, t, 1);
    expect(v.today).toEqual([]);
    expect(totalMesTaches(v)).toBe(3);
    expect(aPlat(v).every((x) => x.source === 'work' && x.projectName === 'Chantier')).toBe(true);
    expect(v.asOf).toBe('2026-10-29');
  });
  it('changer l’échéance reclasse au jour du serveur', () => {
    const t = { ...item(4, null), dueDate: '2026-10-01' };
    const v = appliquerTache(vue, t, 1);
    expect(v.overdue.map((x) => x.id)).toEqual([oid(4), oid(1)]);
  });
});

describe('Mes tâches mixte — relances du CRM (ADR-0040 — C4)', () => {
  const mixte = regrouper(
    vue,
    [...aPlat(vue), relance('a1', '2026-10-29', '2026-10-29T09:00:00.000Z')],
    1,
  );

  it('la relance se range avec les tâches du jour, reconnue par sa source', () => {
    expect(mixte.today.map((e) => e.id).sort()).toEqual([oid(2), 'crm:a1'].sort());
    expect(mixte.today.filter(estRelance).map((e) => e.activityId)).toEqual(['a1']);
    expect(mixte.dueSoonCount).toBe(2);
  });

  it('cochée, elle sort de la liste ; les tâches restent', () => {
    const v = retirerElement(mixte, 'crm:a1', 1);
    expect(v.today.map((e) => e.id)).toEqual([oid(2)]);
    expect(totalMesTaches(v)).toBe(4);
  });

  it('déplacée, elle change de groupe et de révision', () => {
    const v = appliquerRelance(
      mixte,
      'crm:a1',
      { dueDate: '2026-10-31', dueAt: '2026-10-31T09:00:00.000Z', revision: 4 },
      1,
    );
    const r = v.next7Days.find((e) => e.id === 'crm:a1');
    expect(r).toMatchObject({
      revision: 4,
      dueDate: '2026-10-31',
      rank: '2026-10-31T09:00:00.000Z',
    });
  });

  it('déplacer garde l’heure de Kinshasa, même près de minuit', () => {
    // 23 h 30 UTC le 28 = 0 h 30 le 29 à Kinshasa.
    expect(instantDeplace('2026-10-28T23:30:00.000Z', '2026-11-02')).toBe(
      '2026-11-01T23:30:00.000Z',
    );
    expect(instantDeplace('2026-10-29T09:00:00.000Z', '2026-10-30')).toBe(
      '2026-10-30T09:00:00.000Z',
    );
    expect(() => instantDeplace('pas une date', '2026-10-30')).toThrow(RangeError);
  });

  it('sous-titre : compte, sinon opportunité, sinon contact', () => {
    const r = relance('a2', '2026-10-29', '2026-10-29T09:00:00.000Z');
    expect(sousTitreRelance(r)).toBe('Logiciel de caisse');
    expect(sousTitreRelance({ ...r, accountName: 'ACME' })).toBe('ACME');
    expect(sousTitreRelance({ ...r, opportunityTitle: null, contactName: 'Awa' })).toBe('Awa');
  });

  it('cocher une relance exige crm.manage', () => {
    expect(peutCocherRelance(null)).toBe(false);
    expect(peutCocherRelance(['crm.read', 'work.update'])).toBe(false);
    expect(peutCocherRelance(['crm.read', 'crm.manage'])).toBe(true);
  });
});

// ADR-0044 § 6.5 (lot P3) : approbations d'achat dans « Mes tâches ».
describe('approbations d’achat (ADR-0044 § 6.5)', () => {
  const approbation: PurchasesMyTaskItem = {
    source: 'purchases',
    id: 'purchases:o1',
    orderId: 'o1',
    requestNumber: 'DA2610-000001',
    title: 'Fournitures',
    supplierName: 'Socimex SARL',
    total: '89.35',
    currency: 'USD',
    dueDate: '2026-10-30',
    priority: 'none',
    rank: '2026-10-30T09:00:00.000Z',
    done: false,
    kindLabel: 'Approbation',
    href: '/achats/commandes/o1',
  };

  it('reconnue, ni tâche ni relance ; sous-titre : numéro, fournisseur, total de l’API', () => {
    expect(estApprobation(approbation)).toBe(true);
    expect(estRelance(approbation)).toBe(false);
    expect(estApprobation(item(1, null))).toBe(false);
    expect(sousTitreApprobation(approbation)).toBe('DA2610-000001 · Socimex SARL · 89,35\u00a0USD');
    expect(PASTILLE_APPROBATION).toBe('Approbation');
  });

  it('regroupée au jour de soumission avec les autres éléments', () => {
    const v: MyTasksView = {
      asOf: '2026-10-30',
      overdue: [],
      today: [],
      next7Days: [],
      later: [],
      noDate: [],
      dueSoonCount: 0,
      truncated: false,
    };
    const r = regrouper(v, [approbation, item(2, '2026-10-29')], 1);
    expect(r.today.map((e) => e.id)).toEqual(['purchases:o1']);
    expect(r.overdue).toHaveLength(1);
  });
});

// ADR-0045 § 6.1 (lot H3) : absences à valider dans « Mes tâches ».
describe('absences à valider (ADR-0045 § 6.1)', () => {
  const absence: HrMyTaskItem = {
    source: 'hr',
    kind: 'leave_approval',
    id: 'hr:leave:r1',
    requestId: 'r1',
    employeeName: 'Bea Kanku',
    typeLabel: 'Absence',
    start: { date: '2027-03-01', half: 'full' },
    end: { date: '2027-03-05', half: 'am' },
    days: '3.5',
    dueDate: '2027-03-01',
    priority: 'none',
    rank: '2026-10-30T09:00:00.000Z',
    done: false,
    kindLabel: 'Validation d’absence',
    href: '/rh/absences?vue=a-valider',
  };

  it('reconnue, ni tâche, ni relance, ni approbation ; libellés de l’API, durée mise en forme', () => {
    expect(estElementRh(absence)).toBe(true);
    expect(estRelance(absence)).toBe(false);
    expect(estApprobation(absence)).toBe(false);
    expect(estElementRh(item(1, null))).toBe(false);
    // Le type confidentiel arrive masqué : l'écran affiche ce qu'il reçoit.
    expect(titreElementRh(absence)).toBe('Bea Kanku — Absence');
    expect(sousTitreElementRh(absence)).toBe('du 1 mars au 5 mars 2027 (matin) · 3,5 jours');
    expect(pastilleElementRh(absence)).toBe(PASTILLE_VALIDATION_ABSENCE);
  });

  it('regroupée au premier jour de l’absence avec les autres éléments', () => {
    const v: MyTasksView = {
      asOf: '2027-02-27',
      overdue: [],
      today: [],
      next7Days: [],
      later: [],
      noDate: [],
      dueSoonCount: 0,
      truncated: false,
    };
    const r = regrouper(v, [absence, item(2, null)], 1);
    expect(r.next7Days.map((e) => e.id)).toEqual(['hr:leave:r1']);
    expect(r.noDate).toHaveLength(1);
  });
});
