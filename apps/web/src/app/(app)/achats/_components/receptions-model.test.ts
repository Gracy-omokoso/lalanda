import { describe, expect, it } from 'vitest';

import type {
  PurchaseOrderDetailView,
  PurchaseReceptionView,
  PurchaseReceptionWriteResult,
} from '@/lib/api-purchases-payables';

import {
  aDejaDesReceptions,
  avertissementNonEnvoyee,
  formulaireReception,
  jourKinshasa,
  peutAnnulerReception,
  peutRecevoir,
  phrasesResultat,
  preparerReception,
  requeteReceptions,
  resumeReception,
  toutRecu,
} from './receptions-model';

const ligne = (id: string, quantity: string, receivable = true) => ({
  id,
  label: `Article ${id}`,
  quantity,
  unit: 'u',
  unitPrice: '5.00',
  discountPercent: null,
  kind: receivable ? ('goods' as const) : ('service' as const),
  receivable,
  category: null,
  workProjectId: null,
  itemRef: null,
  amount: '50.00',
});

const reception = (over: Partial<PurchaseReceptionView> = {}): PurchaseReceptionView => ({
  id: 'r1',
  orderId: 'o1',
  orderNumber: 'BC2610-000001',
  supplierId: 's1',
  receivedOn: '2026-10-28',
  lines: [{ orderLineId: 'l1', label: 'Article l1', unit: 'u', quantity: '6' }],
  deliveryNoteRef: 'BL-12',
  note: null,
  attachment: null,
  status: 'recorded',
  cancellation: null,
  revision: 1,
  createdBy: 'u1',
  createdAt: '2026-10-28T10:00:00.000Z',
  updatedAt: '2026-10-28T10:00:00.000Z',
  ...over,
});

const commande = (over: Partial<PurchaseOrderDetailView> = {}): PurchaseOrderDetailView =>
  ({
    id: 'o1',
    phase: 'order',
    status: 'sent',
    lines: [ligne('l1', '10'), ligne('l2', '1', false)],
    receptions: [],
    invoices: [],
    ...over,
  }) as PurchaseOrderDetailView;

const GERER = ['purchase.read', 'purchase.manage'] as const;

describe('réceptions — droits et statuts', () => {
  it('recevoir exige purchase.manage et une commande approuvée ou envoyée', () => {
    expect(peutRecevoir(commande(), [...GERER])).toBe(true);
    expect(peutRecevoir(commande({ status: 'partially_received' }), [...GERER])).toBe(true);
    expect(peutRecevoir(commande(), ['purchase.read'])).toBe(false);
    expect(peutRecevoir(commande({ status: 'received' }), [...GERER])).toBe(false);
    expect(peutRecevoir(commande({ status: 'cancelled' }), [...GERER])).toBe(false);
    expect(peutRecevoir(commande({ phase: 'request', status: 'approved' }), [...GERER])).toBe(
      false,
    );
  });

  it('commande approuvée non envoyée : livraison sur appel signalée', () => {
    expect(avertissementNonEnvoyee({ status: 'approved' })).toMatch(/sur appel/);
    expect(avertissementNonEnvoyee({ status: 'sent' })).toBeNull();
  });

  it('annuler : réception enregistrée et purchase.manage', () => {
    expect(peutAnnulerReception(reception(), [...GERER])).toBe(true);
    expect(peutAnnulerReception(reception({ status: 'cancelled' }), [...GERER])).toBe(false);
    expect(peutAnnulerReception(reception(), ['purchase.read'])).toBe(false);
  });
});

describe('réceptions — formulaire', () => {
  it('liste les lignes, services compris, et les quantités déjà reçues sans les sommer', () => {
    const f = formulaireReception(
      commande({
        receptions: [
          reception(),
          reception({ id: 'r2', receivedOn: '2026-10-29' }),
          reception({ id: 'r3', status: 'cancelled' }),
        ],
      }),
      '2026-10-30',
    );
    expect(f.receivedOn).toBe('2026-10-30');
    expect(f.lignes.map((l) => [l.orderLineId, l.service])).toEqual([
      ['l1', false],
      ['l2', true],
    ]);
    expect(f.lignes[0]!.dejaRecu).toEqual([
      { receivedOn: '2026-10-28', quantity: '6' },
      { receivedOn: '2026-10-29', quantity: '6' },
    ]);
    expect(aDejaDesReceptions(f)).toBe(true);
  });

  it('« tout est arrivé » recopie les quantités commandées', () => {
    const f = toutRecu(formulaireReception(commande(), '2026-10-30'));
    expect(f.lignes.map((l) => l.saisie)).toEqual(['10', '1']);
    expect(aDejaDesReceptions(f)).toBe(false);
  });

  it('réception partielle : seules les lignes saisies partent, virgule acceptée', () => {
    const f = formulaireReception(commande(), '2026-10-30');
    f.lignes[0]!.saisie = '6,5';
    f.deliveryNoteRef = ' BL 9 ';
    const p = preparerReception('o1', f, '2026-10-30');
    expect(p).toEqual({
      ok: true,
      corps: {
        orderId: 'o1',
        receivedOn: '2026-10-30',
        lines: [{ orderLineId: 'l1', quantity: '6.5' }],
        deliveryNoteRef: 'BL 9',
      },
    });
  });

  it('refus : aucune ligne, quantité invalide, date future', () => {
    const f = formulaireReception(commande(), '2026-10-30');
    expect(preparerReception('o1', f, '2026-10-30')).toMatchObject({
      ok: false,
      champs: { lignes: expect.any(String) },
    });
    f.lignes[0]!.saisie = '0';
    f.receivedOn = '2026-10-31';
    const p = preparerReception('o1', f, '2026-10-30');
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.champs['ligne-0']).toMatch(/supérieure à zéro/);
      expect(p.champs['receivedOn']).toMatch(/future/);
      expect(p.champs['lignes']).toBeUndefined();
    }
  });
});

describe('réceptions — résultat rendu par l’API', () => {
  const r: PurchaseReceptionWriteResult = {
    reception: reception(),
    order: {
      id: 'o1',
      status: 'partially_received',
      lines: [
        {
          orderLineId: 'l1',
          receivable: true,
          ordered: '10',
          received: '6',
          remaining: '4',
          overReceived: '0',
        },
        {
          orderLineId: 'l3',
          receivable: true,
          ordered: '2',
          received: '2',
          remaining: '0',
          overReceived: '0',
        },
        {
          orderLineId: 'l4',
          receivable: true,
          ordered: '1',
          received: '3',
          remaining: '0',
          overReceived: '2',
        },
        {
          orderLineId: 'l2',
          receivable: false,
          ordered: '1',
          received: '0',
          remaining: '1',
          overReceived: '0',
        },
      ],
    },
  };

  it('reste, tout reçu, excédent ; les services sont omis', () => {
    const p = phrasesResultat(r, new Map([['l1', 'Ramettes']]));
    expect(p).toEqual([
      { label: 'Ramettes', phrase: 'Reste à recevoir : 4', excedent: false },
      { label: 'Ligne', phrase: 'Tout est reçu', excedent: false },
      { label: 'Ligne', phrase: '2 de plus que commandé (écart signalé)', excedent: true },
    ]);
  });
});

describe('réceptions — liste et jour', () => {
  it('requête et résumé', () => {
    expect(requeteReceptions(null)).toEqual({ limit: 50 });
    expect(requeteReceptions('o1', 'c')).toEqual({ limit: 50, orderId: 'o1', cursor: 'c' });
    expect(resumeReception(reception())).toBe('1 ligne · BL BL-12');
    expect(resumeReception(reception({ deliveryNoteRef: null, lines: [] }))).toBe('0 ligne');
  });

  it('jour de Kinshasa (UTC+1) au changement de jour', () => {
    expect(jourKinshasa(new Date('2026-10-30T22:59:00Z'))).toBe('2026-10-30');
    expect(jourKinshasa(new Date('2026-10-30T23:01:00Z'))).toBe('2026-10-31');
  });
});
