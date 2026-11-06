// Mise en forme du tableau de bord des devis (ADR-0067) : aucun calcul, des
// libellés justes, et des chiffres repris tels que le serveur les sert.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { QuoteStatsSchema, type QuoteStats } from '@lalanda/shared/sales-invoices';
import { describe, expect, it } from 'vitest';

import {
  autresDevises,
  cartesDevis,
  compteursDevis,
  noteDevisesDevis,
  statutDevis,
  tranchesStatutDevis,
} from './quote-dashboard-model';

const NB = ' ';

const mois = Array.from({ length: 12 }, (_, i) => ({
  month: `${i === 0 ? '2025-12' : `2026-${String(i).padStart(2, '0')}`}`,
  sent: i,
  accepted: i % 3,
  acceptedAmount: `${i * 1000}.00`,
}));

const stats = (over: Partial<QuoteStats> = {}): QuoteStats =>
  QuoteStatsSchema.parse({
    currency: 'CDF',
    currencySource: 'default_cdf',
    asOf: '2026-11-06',
    from: '2025-12',
    to: '2026-11',
    months: mois,
    open: {
      count: 3,
      amount: '4812300.40',
      notConvertible: [{ currency: 'USD', count: 1, total: '1300.00' }],
    },
    acceptedThisMonth: { count: 1, amount: '232000.00', notConvertible: [] },
    expiringSoon: {
      count: 2,
      amount: '348000.00',
      notConvertible: [],
      until: '2026-11-13',
      withinDays: 7,
    },
    conversion: { windowDays: 90, since: '2026-08-09', sent: 8, accepted: 3, ratePercent: 38 },
    statusCounts: { all: 12, draft: 2, sent: 3, accepted: 4, refused: 1, expired: 2 },
    converted: 2,
    excluded: {
      withoutAmount: 0,
      notConvertible: [{ currency: 'USD', count: 1, total: '1300.00' }],
    },
    truncated: false,
    version: '1.0.0',
    ...over,
  });

describe('cartes du tableau des devis', () => {
  it('reprend les chiffres du serveur, devises à part sans conversion', () => {
    const [enCours, taux, accepte, expirent] = cartesDevis(stats());
    expect(enCours!.valeur).toBe(`4${NB}812${NB}300${NB}CDF`);
    expect(enCours!.note).toBe(`3 devis envoyés · +${NB}1${NB}300${NB}USD`);
    expect(taux!.valeur).toBe(`38${NB}%`);
    expect(taux!.note).toBe('3 acceptés sur 8 envoyés');
    expect(accepte!.valeur).toBe(`232${NB}000${NB}CDF`);
    expect(expirent!).toMatchObject({ valeur: '2 devis', ton: 'attention' });
  });

  it('sans devis envoyé : tiret et phrase claire', () => {
    const s = stats({
      conversion: { windowDays: 90, since: '2026-08-09', sent: 0, accepted: 0, ratePercent: null },
      expiringSoon: {
        count: 0,
        amount: '0.00',
        notConvertible: [],
        until: '2026-11-13',
        withinDays: 7,
      },
    });
    const [, taux, , expirent] = cartesDevis(s);
    expect(taux!.valeur).toBe('—');
    expect(taux!.note).toBe(`Rien d’envoyé sur 90${NB}j`);
    expect(expirent!).toMatchObject({ note: 'Aucun devis à relancer', ton: 'normal' });
  });

  it('anneau, compteurs et note de devise', () => {
    expect(tranchesStatutDevis(stats()).map((t) => [t.id, t.value])).toEqual([
      ['draft', 2],
      ['sent', 3],
      ['accepted', 4],
      ['refused', 1],
      ['expired', 2],
    ]);
    expect(compteursDevis(stats()).all).toBe(12);
    expect(noteDevisesDevis(stats())).toContain('1 devis en USD');
    expect(autresDevises([])).toBeNull();
  });
});

describe('statut d’une ligne de devis', () => {
  const d = (
    status: 'draft' | 'sent' | 'accepted' | 'refused' | 'expired',
    validUntil = '2026-12-31',
  ) => ({
    status,
    validUntil,
    convertedInvoiceId: null,
  });
  it('envoyé : « Expire dans N j » sous 7 jours, sinon « Envoyé »', () => {
    expect(statutDevis(d('sent', '2026-11-09'), '2026-11-06').label).toBe(
      `Expire dans${NB}3${NB}j`,
    );
    expect(statutDevis(d('sent', '2026-11-06'), '2026-11-06').label).toBe('Expire aujourd’hui');
    expect(statutDevis(d('sent'), '2026-11-06')).toEqual({ ton: 'open', label: 'Envoyé' });
  });
  it('autres statuts', () => {
    expect(statutDevis(d('expired'), '2026-11-06').ton).toBe('wait');
    expect(statutDevis(d('refused'), '2026-11-06').ton).toBe('late');
    expect(statutDevis({ ...d('accepted'), convertedInvoiceId: 'x' }, '2026-11-06').label).toBe(
      'Accepté · facturé',
    );
  });
});

describe('lecture des sources : aucun calcul de montant dans l’interface', () => {
  for (const fichier of [
    './quote-dashboard-model.ts',
    './quote-dashboard.tsx',
    './quote-list.tsx',
  ]) {
    it(fichier, () => {
      const code = readFileSync(fileURLToPath(new URL(fichier, import.meta.url)), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(code).not.toMatch(/\bNumber\s*\(|\bparseFloat\b|\bparseInt\b|\.toFixed\s*\(|\bMath\./);
    });
  }
});
