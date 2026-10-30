import { describe, expect, it } from 'vitest';

import type { CrmReportsView } from '@/lib/api-crm-reports';

import {
  MENTION_TRONQUE,
  PERIODES_MOIS,
  PERIODE_PAR_DEFAUT,
  bornesPeriode,
  largeur,
  libelleBucket,
  libelleMois,
  lignesConversion,
  lignesEntonnoir,
  lignesMotifs,
  lignesPrevisionMois,
  lignesResponsables,
  messageRapports,
  montantsEstimes,
  nomResponsable,
  periodeDepuis,
  phrasePeriode,
  requeteRapports,
  texteDuree,
  texteTaux,
} from './rapports-model';

const VUE: CrmReportsView = {
  version: '1.1.0',
  basis: 'estimated',
  label: 'Montants estimés',
  generatedAt: '2026-10-30T10:00:00.000Z',
  period: { from: '2025-10-31', to: '2026-10-30' },
  asOf: '2026-10-30',
  ownerId: null,
  minSample: 10,
  stages: [
    { key: 'qualif', label: 'Qualification', kind: 'open' },
    { key: 'prop', label: 'Proposition', kind: 'open' },
    { key: 'won', label: 'Gagnée', kind: 'won' },
    { key: 'lost', label: 'Perdue', kind: 'lost' },
  ],
  funnel: {
    created: 40,
    stages: [
      {
        stageKey: 'qualif',
        count: 40,
        amounts: [
          { currency: 'USD', total: '15000', count: 30 },
          { currency: 'CDF', total: '2500000.5', count: 10 },
        ],
      },
      { stageKey: 'prop', count: 10, amounts: [] },
    ],
  },
  conversion: {
    stages: [
      {
        fromStageKey: 'qualif',
        toStageKey: 'prop',
        rate: { status: 'available', ratePercent: '25', sample: 40, count: 10 },
      },
      {
        fromStageKey: 'prop',
        toStageKey: null,
        rate: { status: 'unavailable', sample: 4, count: 1, requiredSample: 10 },
      },
    ],
    overall: { status: 'unavailable', sample: 3, count: 1, requiredSample: 10 },
  },
  cycle: {
    won: { status: 'available', meanDays: 34, medianDays: 1, sample: 12 },
    lost: { status: 'unavailable', sample: 0, requiredSample: 10 },
  },
  byOwner: [
    {
      ownerId: 'a'.repeat(24),
      ownerName: 'Awa',
      isMember: true,
      open: { count: 1, amounts: [{ currency: 'USD', total: '100', count: 1 }] },
      won: { count: 0, amounts: [] },
      lost: { count: 2, amounts: [] },
      winRate: { status: 'unavailable', sample: 2, count: 0, requiredSample: 10 },
      forecast: [
        {
          currency: 'USD',
          weighted: '25',
          unweighted: '100',
          count: 1,
          notWeightable: { total: '0', count: 0 },
        },
      ],
      topLostReasons: [
        { lostReasonKey: 'prix', label: 'Prix', count: 2 },
        { lostReasonKey: null, label: null, count: 1 },
      ],
    },
    {
      ownerId: null,
      ownerName: null,
      isMember: false,
      open: { count: 0, amounts: [] },
      won: { count: 0, amounts: [] },
      lost: { count: 0, amounts: [] },
      winRate: { status: 'unavailable', sample: 0, count: 0, requiredSample: 10 },
      forecast: [],
      topLostReasons: [],
    },
  ],
  forecastByMonth: {
    probabilitySource: 'historical',
    buckets: [
      {
        kind: 'overdue',
        month: null,
        count: 2,
        currencies: [
          {
            currency: 'USD',
            weighted: '50',
            unweighted: '200',
            count: 2,
            notWeightable: { total: '0', count: 0 },
          },
        ],
      },
      {
        kind: 'month',
        month: '2026-11',
        count: 3,
        currencies: [
          {
            currency: 'USD',
            weighted: '200',
            unweighted: '400',
            count: 2,
            notWeightable: { total: '300', count: 1 },
          },
          {
            currency: 'CDF',
            weighted: '10',
            unweighted: '10',
            count: 1,
            notWeightable: { total: '0', count: 0 },
          },
        ],
      },
      { kind: 'no_date', month: null, count: 0, currencies: [] },
    ],
  },
  lostReasons: {
    total: 3,
    reasons: [
      { lostReasonKey: 'prix', label: 'Prix', count: 2 },
      { lostReasonKey: 'vieux', label: null, count: 1 },
    ],
  },
  truncated: false,
};

describe('période', () => {
  it('12 mois par défaut, 24 au plus', () => {
    expect(PERIODE_PAR_DEFAUT).toBe(12);
    expect(Math.max(...PERIODES_MOIS)).toBe(24);
    expect(periodeDepuis('6')).toBe(6);
    expect(periodeDepuis('36')).toBe(12);
    expect(periodeDepuis('n’importe quoi')).toBe(12);
  });

  it('12 mois : aucune borne envoyée (défaut de l’API)', () => {
    expect(bornesPeriode(12, '2026-10-30')).toEqual({});
  });

  it('N mois : même convention que le moteur (aujourd’hui − N mois + 1 jour)', () => {
    expect(bornesPeriode(24, '2026-10-30')).toEqual({ from: '2024-10-31', to: '2026-10-30' });
    expect(bornesPeriode(3, '2026-05-31')).toEqual({ from: '2026-03-01', to: '2026-05-31' });
    // Fin de mois : 31 → 28 février, puis + 1 jour.
    expect(bornesPeriode(3, '2026-05-31').from).toBe('2026-03-01');
    expect(bornesPeriode(6, '2026-08-31')).toEqual({ from: '2026-03-01', to: '2026-08-31' });
  });

  it('requête : filtre responsable facultatif', () => {
    expect(requeteRapports(12, '', '2026-10-30')).toEqual({});
    expect(requeteRapports(12, 'me', '2026-10-30')).toEqual({ ownerId: 'me' });
    expect(requeteRapports(6, 'b'.repeat(24), '2026-10-30')).toEqual({
      from: '2026-05-01',
      to: '2026-10-30',
      ownerId: 'b'.repeat(24),
    });
  });

  it('phrase de période', () => {
    expect(phrasePeriode(VUE)).toBe('Du 31 octobre 2025 au 30 octobre 2026 (jours de Kinshasa)');
  });
});

describe('taux et durées', () => {
  it('un taux disponible garde la chaîne de l’API', () => {
    const t = texteTaux({ status: 'available', ratePercent: '33.3', sample: 12, count: 4 });
    expect(t.disponible).toBe(true);
    expect(t.valeur).toBe('33,3\u00a0%');
    expect(t.detail).toBe('4 sur 12 clôturées');
  });

  it('un taux `unavailable` affiche l’échantillon et le minimum, jamais 0 %', () => {
    const t = texteTaux({ status: 'unavailable', sample: 3, count: 0, requiredSample: 10 });
    expect(t.disponible).toBe(false);
    expect(t.valeur).toBe('Indisponible');
    expect(t.detail).toBe('Pas assez d’opportunités clôturées (3 sur 10)');
    expect(`${t.valeur} ${t.detail}`).not.toMatch(/0\s?%/);
  });

  it('durée : moyenne, médiane et échantillon ; indisponible sous le seuil', () => {
    expect(texteDuree(VUE.cycle.won, 'gagnées')).toEqual({
      disponible: true,
      valeur: '34 jours',
      detail: 'Médiane : 1 jour · 12 gagnées',
    });
    const perdues = texteDuree(VUE.cycle.lost, 'perdues');
    expect(perdues.disponible).toBe(false);
    expect(perdues.detail).toBe('Pas assez d’opportunités perdues (0 sur 10)');
  });
});

describe('montants', () => {
  it('par devise, étiquetés « estimé », jamais additionnés', () => {
    expect(montantsEstimes(VUE.funnel.stages[0]!.amounts)).toEqual([
      '15\u202f000,00\u00a0USD (estimé)',
      '2\u202f500\u202f000,50\u00a0CDF (estimé)',
    ]);
  });
});

describe('barres', () => {
  it('largeur bornée entre 0 et 100', () => {
    expect(largeur(5, 10)).toBe(50);
    expect(largeur(0, 10)).toBe(0);
    expect(largeur(3, 0)).toBe(0);
    expect(largeur(20, 10)).toBe(100);
    expect(largeur(Number.NaN, 10)).toBe(0);
  });
});

describe('blocs', () => {
  it('entonnoir : étapes dans l’ordre de l’API, libellés et barres', () => {
    const l = lignesEntonnoir(VUE);
    expect(l.map((x) => x.etape)).toEqual(['Qualification', 'Proposition']);
    expect(l.map((x) => x.largeur)).toEqual([100, 25]);
    expect(l[1]!.texteNombre).toBe('10 opportunités');
    expect(l[1]!.montants).toEqual([]);
  });

  it('conversion : étape suivante, « Gagnée » en dernier, barre nulle si indisponible', () => {
    const l = lignesConversion(VUE);
    expect(l[0]).toMatchObject({ de: 'Qualification', vers: 'Proposition', largeur: 25 });
    expect(l[0]!.taux.detail).toBe('10 sur 40 passées par l’étape');
    expect(l[1]).toMatchObject({ de: 'Proposition', vers: 'Gagnée', largeur: 0 });
    expect(l[1]!.taux.detail).toBe('Pas assez d’opportunités passées par cette étape (4 sur 10)');
  });

  it('responsables : nom joint par l’API, sans responsable, ancien membre', () => {
    const l = lignesResponsables(VUE);
    expect(l[0]!.nom).toBe('Awa');
    expect(l[0]!.ouvertes.montants).toEqual(['100,00\u00a0USD (estimé)']);
    expect(l[0]!.perdues.nombre).toBe('2 opportunités');
    expect(l[0]!.tauxGain.valeur).toBe('Indisponible');
    expect(l[0]!.prevision).toEqual(['25,00\u00a0USD pondéré (estimé)']);
    expect(l[0]!.motifs).toEqual(['Prix (2)', 'Sans motif (1)']);
    expect(l[1]!.nom).toBe('Sans responsable');
    expect(nomResponsable({ ownerId: 'x', ownerName: null, isMember: false })).toBe(
      'Ancien membre (à réassigner)',
    );
    expect(nomResponsable({ ownerId: 'x', ownerName: 'Ben', isMember: false })).toBe(
      'Ben (ancien membre)',
    );
    expect(
      nomResponsable({ ownerId: 'x', ownerName: null, isMember: true }, [
        { userId: 'x', name: 'Chloé' },
      ]),
    ).toBe('Chloé');
  });

  it('prévision par mois : en retard, mois, sans date ; barres par devise', () => {
    const l = lignesPrevisionMois(VUE);
    expect(l.map((x) => x.periode)).toEqual([
      'En retard (date passée)',
      'Novembre 2026',
      'Sans date prévue',
    ]);
    expect(l[0]!.enRetard).toBe(true);
    // USD : 50 sur 200 ; CDF rapporté à lui-même, jamais aux USD.
    expect(l[0]!.devises[0]!.largeur).toBe(25);
    expect(l[1]!.devises.map((d) => d.largeur)).toEqual([100, 100]);
    expect(l[1]!.devises[0]!.pondere).toBe('200,00\u00a0USD (estimé)');
    expect(l[1]!.devises[0]!.nonPonderable).toBe(
      'Non pondérable : 300,00\u00a0USD (1 opportunité)',
    );
    expect(l[2]!.devises).toEqual([]);
  });

  it('libellés de mois et de période', () => {
    expect(libelleMois('2027-01')).toBe('Janvier 2027');
    expect(libelleBucket({ kind: 'no_date', month: null })).toBe('Sans date prévue');
  });

  it('motifs de perte : libellé du réglage, motif retiré signalé', () => {
    expect(lignesMotifs(VUE).map((m) => [m.motif, m.nombre, m.largeur])).toEqual([
      ['Prix', '2 opportunités', 100],
      ['vieux (motif retiré)', '1 opportunité', 50],
    ]);
  });
});

describe('erreurs et mentions', () => {
  it('codes de période et refus', () => {
    expect(messageRapports({ status: 403 })).toMatch(/rôle/);
    expect(messageRapports({ status: 400, detail: { code: 'CRM_REPORT_PERIOD_TOO_LONG' } })).toBe(
      'La période ne peut pas dépasser 24 mois.',
    );
    expect(messageRapports(new Error('x'))).toBe('Impossible de charger les rapports du CRM.');
  });

  it('la mention de troncature dit que les chiffres sont partiels', () => {
    expect(MENTION_TRONQUE).toMatch(/partiels/);
  });
});
