// Règles pures des alertes des engagements — ADR-0050 § 6. ADR-0050 — V6.

import { contractAlerts, type AlertContractInput, type ContractAlert } from '@lalanda/engine';
import { describe, expect, it } from 'vitest';

import {
  blockedDetail,
  compareAgendaItems,
  depositItem,
  isForViewer,
  itemOfAlert,
  type AgendaContractRef,
  type AgendaViewer,
} from './contracts-agenda-model.js';
import { contractGestureOf } from './contracts-notifications.interceptor.js';

const contract: AgendaContractRef = {
  id: 'c1',
  number: 'CT2701-000001',
  title: 'Maintenance annuelle',
  customerName: 'Kin Services',
  ownerUserId: 'owner',
  createdBy: 'rep',
  submittedBy: 'rep',
};

function viewer(partial: Partial<AgendaViewer>): AgendaViewer {
  return {
    userId: 'u',
    holdsApprove: false,
    holdsInvoice: false,
    approverCount: 2,
    allowSoleApprover: true,
    ...partial,
  };
}

function input(partial: Partial<AlertContractInput>): AlertContractInput {
  return {
    id: 'c1',
    ownerUserId: 'owner',
    status: 'signed',
    submittedOn: null,
    submittedBy: null,
    startDate: '2027-01-15',
    initialTermMonths: 12,
    renewal: { mode: 'tacit', periodMonths: 12, maxRenewals: null },
    noticeDays: 30,
    renewals: [],
    termination: null,
    amendments: [],
    draftOccurrenceDates: [],
    blockedOccurrences: [],
    ...partial,
  };
}

const SETTINGS = { noticeAlertDays: 30, termEndAlertDays: 60 };

describe('alertes des contrats — audience (droits effectifs, § 6)', () => {
  const toApprove = contractAlerts(
    [input({ status: 'submitted', submittedOn: '2027-01-02', submittedBy: 'rep' })],
    SETTINGS,
    '2027-01-03',
  ).alerts.find((a) => a.kind === 'contract_to_approve')!;

  it('« à approuver » : un approbateur autre que le soumetteur ; ni le Commercial ni un non-détenteur', () => {
    expect(isForViewer(toApprove, viewer({ userId: 'owner2', holdsApprove: true }), contract)).toBe(
      true,
    );
    expect(isForViewer(toApprove, viewer({ userId: 'rep', holdsApprove: false }), contract)).toBe(
      false,
    );
    expect(isForViewer(toApprove, viewer({ userId: 'x', holdsApprove: false }), contract)).toBe(
      false,
    );
  });

  it('le soumetteur détenteur ne le voit que s’il est approbateur unique et que le réglage le permet', () => {
    const self = viewer({ userId: 'rep', holdsApprove: true });
    expect(isForViewer(toApprove, self, contract)).toBe(false);
    expect(isForViewer(toApprove, { ...self, approverCount: 1 }, contract)).toBe(true);
    expect(
      isForViewer(toApprove, { ...self, approverCount: 1, allowSoleApprover: false }, contract),
    ).toBe(false);
  });

  it('préavis : le responsable seul ; brouillons : les détenteurs de `sales.invoice`', () => {
    const { alerts } = contractAlerts(
      [input({ draftOccurrenceDates: ['2027-11-01'] })],
      SETTINGS,
      '2027-11-15',
    );
    const notice = alerts.find((a) => a.kind === 'notice_deadline')!;
    expect(notice.dueDate).toBe('2027-12-15');
    expect(isForViewer(notice, viewer({ userId: 'owner' }), contract)).toBe(true);
    expect(isForViewer(notice, viewer({ userId: 'other', holdsApprove: true }), contract)).toBe(
      false,
    );
    const drafts = alerts.find((a) => a.kind === 'subscription_drafts_to_issue')!;
    expect(isForViewer(drafts, viewer({ holdsInvoice: true }), null)).toBe(true);
    expect(isForViewer(drafts, viewer({ holdsInvoice: false }), null)).toBe(false);
  });

  it('reconduction à constater : tout détenteur de `sales.contract.approve`', () => {
    const { alerts } = contractAlerts([input({})], SETTINGS, '2028-01-01');
    const renewal = alerts.find((a) => a.kind === 'renewal_to_record')!;
    expect(isForViewer(renewal, viewer({ holdsApprove: true }), contract)).toBe(true);
    expect(isForViewer(renewal, viewer({ userId: 'owner' }), contract)).toBe(false);
  });
});

describe('alertes des contrats — mise en forme', () => {
  it('chaque nature a un titre, une pastille, un lien ; aucun mot qui juge une clause', () => {
    const { alerts } = contractAlerts(
      [
        input({
          renewal: { mode: 'none', periodMonths: null, maxRenewals: null },
          draftOccurrenceDates: ['2027-12-01', '2027-11-30'],
          blockedOccurrences: [
            { key: '2027-12-01', date: '2027-12-01', reasons: ['RENEWAL_NOT_RECORDED'] },
          ],
        }),
      ],
      SETTINGS,
      '2027-11-20',
    );
    const items = alerts
      .map((a: ContractAlert) => itemOfAlert(a, contract, null))
      .filter((i) => i !== null);
    expect(items.map((i) => i.kind).sort()).toEqual([
      'notice_deadline',
      'occurrence_blocked',
      'subscription_drafts_to_issue',
      'term_end',
    ]);
    for (const i of items) {
      expect(i.id.startsWith('sct:')).toBe(true);
      expect(i.source).toBe('sales_contracts');
      expect(i.href.startsWith('/ventes/')).toBe(true);
      const text = `${i.title} ${i.detail ?? ''} ${i.kindLabel}`.toLowerCase();
      for (const forbidden of ['conforme', 'valable', 'reconduit automatiquement']) {
        expect(text).not.toContain(forbidden);
      }
    }
    const drafts = items.find((i) => i.kind === 'subscription_drafts_to_issue')!;
    expect(drafts).toMatchObject({ count: 2, dueDate: '2027-11-30', href: '/ventes/factures' });
    expect(drafts.title).toBe('2 brouillons d’échéance à émettre');
    const term = items.find((i) => i.kind === 'term_end')!;
    expect(term.title).toBe('Fin du terme le 14/01/2028 — contrat CT2701-000001');
    const blocked = items.find((i) => i.kind === 'occurrence_blocked')!;
    expect(blocked.detail).toContain('reconduction doit être constatée');
  });

  it('un avenant inconnu ne produit aucun élément ; un motif inconnu est ignoré', () => {
    const alert: ContractAlert = {
      id: 'sct:amendment_to_approve:c1:a1',
      kind: 'amendment_to_approve',
      contractId: 'c1',
      amendmentId: 'a1',
      audience: 'approvers',
      ownerUserId: 'owner',
      excludeUserId: 'rep',
      dueDate: '2027-02-01',
      visibleFrom: null,
      count: 1,
      reasons: [],
    };
    expect(itemOfAlert(alert, contract, null)).toBeNull();
    expect(
      itemOfAlert(alert, contract, {
        id: 'a1',
        number: 'CT2701-000001-A1',
        createdBy: 'rep',
        submittedBy: 'rep',
      })?.title,
    ).toBe('Approuver l’avenant CT2701-000001-A1');
    expect(blockedDetail(['INCONNU'])).toBeNull();
  });

  it('acompte à traiter : un élément par engagement, sans échéance, vers la commande', () => {
    const item = depositItem({
      ownerKind: 'order',
      ownerId: 'o1',
      number: 'CC2701-000002',
      references: ['FT-1'],
    });
    expect(item).toMatchObject({
      id: 'sct:deposit_not_resolved:order:o1',
      kind: 'deposit_not_resolved',
      orderId: 'o1',
      contractId: null,
      dueDate: null,
      href: '/ventes/commandes/o1',
      kindLabel: 'Acompte à traiter',
    });
    expect(item.title).toContain('FT-1');
  });

  it('tri : par échéance, sans date en dernier, puis identifiant', () => {
    const a = depositItem({ ownerKind: 'order', ownerId: 'a', number: 'CC', references: [] });
    const b = { ...a, id: 'sct:b', dueDate: '2027-01-02' };
    const c = { ...a, id: 'sct:c', dueDate: '2027-01-01' };
    expect([a, b, c].sort(compareAgendaItems).map((i) => i.id)).toEqual(['sct:c', 'sct:b', a.id]);
  });
});

describe('notifications — gestes observés', () => {
  it('six routes POST du lot V3, rien d’autre', () => {
    expect(contractGestureOf('POST', '/sales/contracts/:contractId/submit')).toEqual({
      gesture: 'submit',
      amendment: false,
    });
    expect(
      contractGestureOf('POST', '/sales/contracts/:contractId/amendments/:amendmentId/reject'),
    ).toEqual({ gesture: 'reject', amendment: true });
    expect(contractGestureOf('GET', '/sales/contracts/:contractId/submit')).toBeNull();
    expect(contractGestureOf('POST', '/sales/contracts/:contractId/terminate')).toBeNull();
    expect(contractGestureOf('POST', undefined)).toBeNull();
  });
});
