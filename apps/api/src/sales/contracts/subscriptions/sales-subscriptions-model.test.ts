// Règles pures de l'échéancier — ADR-0050 § 4.3, § 5.3. ADR-0050 — V5.

import { OCCURRENCE_BLOCK_REASONS, type OccurrenceBlockReason } from '@lalanda/engine';
import {
  SALES_CONTRACT_OCCURRENCE_BLOCKS,
  SALES_SUBSCRIPTIONS_SYSTEM_ACTOR,
  findForbiddenSalesContractWords,
} from '@lalanda/shared/sales-contracts';
import { describe, expect, it } from 'vitest';

import {
  BLOCK_CODE_OF,
  BLOCK_MESSAGES,
  OCCURRENCE_STATE_LABELS,
  OccurrenceKeySchema,
  SUBSCRIPTIONS_ACTOR,
  frenchDay,
  occurrenceComment,
  scheduleKeyOf,
} from './sales-subscriptions-model.js';

describe('échéancier — règles pures (ADR-0050, V5)', () => {
  it('chaque motif du moteur a un code partagé et un message ; tous les codes partagés sont atteints', () => {
    const codes = OCCURRENCE_BLOCK_REASONS.map((r: OccurrenceBlockReason) => BLOCK_CODE_OF[r]);
    expect([...codes].sort()).toEqual([...SALES_CONTRACT_OCCURRENCE_BLOCKS].sort());
    for (const c of codes) expect(BLOCK_MESSAGES[c].length).toBeGreaterThan(10);
  });

  it('aucun libellé ne juge la validité ni ne dit « reconduit automatiquement » (critère 18)', () => {
    for (const text of [
      ...Object.values(BLOCK_MESSAGES),
      ...Object.values(OCCURRENCE_STATE_LABELS),
    ]) {
      expect(findForbiddenSalesContractWords(text), text).toEqual([]);
    }
  });

  it('acteur de la tâche : `system:subscriptions`', () => {
    expect(SUBSCRIPTIONS_ACTOR.userId).toBe(SALES_SUBSCRIPTIONS_SYSTEM_ACTOR);
  });

  it('clé d’échéance : date ou `item:<ref>`', () => {
    expect(scheduleKeyOf('E1')).toBe('item:E1');
    for (const k of ['2027-01-31', 'item:E1', 'item:a_b-9']) {
      expect(OccurrenceKeySchema.safeParse(k).success, k).toBe(true);
    }
    for (const k of ['31-01-2027', 'item:', 'item:é', 'E1', '']) {
      expect(OccurrenceKeySchema.safeParse(k).success, k).toBe(false);
    }
  });

  it('commentaire C : abonnement (période), échéancier (libellé), troncature signalée', () => {
    expect(frenchDay('2027-02-28')).toBe('28/02/2027');
    expect(
      occurrenceComment({
        kind: 'subscription_occurrence',
        number: 'CT2701-000001',
        periodStart: '2027-01-31',
        periodEnd: '2027-02-27',
        date: '2027-01-31',
      }),
    ).toEqual({
      text: 'Abonnement CT2701-000001 — période du 31/01/2027 au 27/02/2027',
      truncated: false,
    });
    expect(
      occurrenceComment({
        kind: 'schedule_item',
        number: 'CT2701-000001',
        itemRef: 'E2',
        date: '2027-03-15',
        label: 'Livraison',
      }).text,
    ).toBe('Contrat CT2701-000001 — échéance E2 du 15/03/2027 — Livraison');
    const long = occurrenceComment(
      {
        kind: 'schedule_item',
        number: 'CT2701-000001',
        itemRef: 'E2',
        date: '2027-03-15',
        label: 'x'.repeat(300),
      },
      255,
    );
    expect(long.truncated).toBe(true);
    expect(long.text).toHaveLength(255);
  });
});
