// Règles pures du CRM (ADR-0035 § 2) : réglages du pipeline, indicateurs
// déterministes, CSV.

import { describe, expect, it } from 'vitest';

import { amountFromSheet, parseCsv, toCsv } from './crm-csv.js';
import {
  DEFAULT_STAGES,
  addDays,
  daysSince,
  isOverdue,
  isStale,
  kinshasaDay,
  stageChangeConflicts,
  stageConfigIssues,
} from './crm-model.js';
import { CreateActivitySchema, CreateOpportunitySchema, PutCrmSettingsSchema } from './crm.dto.js';

describe('pipeline (ADR-0035 § 2)', () => {
  it('le pipeline par défaut suit le brief : Lead → … → Gagné/Perdu', () => {
    expect(DEFAULT_STAGES.map((s) => s.label)).toEqual([
      'Lead',
      'Qualifié',
      'Proposition',
      'Négociation',
      'Gagné',
      'Perdu',
    ]);
    expect(stageConfigIssues(DEFAULT_STAGES)).toEqual([]);
  });

  it('exactement une étape gagnée et une perdue, au moins une en cours, clés uniques', () => {
    const codes = stageConfigIssues([
      { key: 'a', label: 'A', kind: 'won' },
      { key: 'a', label: 'B', kind: 'won' },
      { key: 'B!', label: '', kind: 'won' },
    ]).map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'STAGE_KEY_DUPLICATE',
        'STAGE_KEY_INVALID',
        'STAGE_LABEL_INVALID',
        'STAGE_WON_REQUIRED',
        'STAGE_LOST_REQUIRED',
        'STAGE_OPEN_REQUIRED',
      ]),
    );
    expect(stageConfigIssues(DEFAULT_STAGES.slice(0, 2)).map((i) => i.code)).toContain(
      'STAGE_COUNT_INVALID',
    );
  });

  it('retirer une étape utilisée ou changer une nature est signalé', () => {
    const after = [
      { key: 'lead', label: 'Piste', kind: 'open' as const },
      { key: 'won', label: 'Signé', kind: 'won' as const },
      { key: 'lost', label: 'Perdu', kind: 'open' as const },
    ];
    expect(stageChangeConflicts(DEFAULT_STAGES, after, new Set(['qualified', 'proposal']))).toEqual(
      {
        removed: ['qualified', 'proposal'],
        kindChanged: ['lost'],
      },
    );
  });

  it('le corps des réglages rend tous les problèmes, avec leur code', () => {
    const r = PutCrmSettingsSchema.safeParse({
      expectedRevision: 0,
      stages: [{ key: 'x', label: 'X', kind: 'open' }],
      autoWinOnQuoteAccepted: true,
      staleAfterDays: 14,
    });
    expect(r.success).toBe(false);
  });
});

describe('indicateurs déterministes', () => {
  const now = new Date('2026-10-21T12:00:00Z');

  it('inactive : ouverte et sans activité depuis N jours ou plus', () => {
    expect(daysSince(new Date('2026-10-07T12:00:00Z'), now)).toBe(14);
    expect(isStale('open', new Date('2026-10-07T12:00:00Z'), 14, now)).toBe(true);
    expect(isStale('open', new Date('2026-10-07T12:00:01Z'), 14, now)).toBe(false);
    expect(isStale('won', new Date('2026-01-01T00:00:00Z'), 14, now)).toBe(false);
    expect(daysSince(new Date('2026-10-22T00:00:00Z'), now)).toBe(0);
  });

  it('en retard : non faite, échéance passée', () => {
    expect(isOverdue(false, new Date('2026-10-21T11:59:59Z'), now)).toBe(true);
    expect(isOverdue(true, new Date('2026-10-21T11:59:59Z'), now)).toBe(false);
    expect(isOverdue(false, null, now)).toBe(false);
    expect(isOverdue(false, new Date('2026-10-21T12:00:01Z'), now)).toBe(false);
  });

  it('jour civil de Kinshasa (UTC+1) et ajout de jours', () => {
    expect(kinshasaDay(new Date('2026-10-21T23:30:00Z'))).toBe('2026-10-22');
    expect(addDays('2026-10-21', 30)).toBe('2026-11-20');
    expect(addDays('2026-12-15', 30)).toBe('2027-01-14');
  });
});

describe('corps de requête', () => {
  it('montant estimé : chaîne seulement, 2 décimales, strictement positif', () => {
    const base = { title: 'T', prospectName: 'P', currency: 'USD' };
    expect(CreateOpportunitySchema.safeParse({ ...base, amount: 1500 }).success).toBe(false);
    expect(CreateOpportunitySchema.safeParse({ ...base, amount: '1.001' }).success).toBe(false);
    expect(CreateOpportunitySchema.safeParse({ ...base, amount: '0' }).success).toBe(false);
    const ok = CreateOpportunitySchema.safeParse({ ...base, amount: '1500' });
    expect(ok.success && ok.data.opportunity.amount).toBe('1500.00');
  });

  it('une opportunité vise un client ou un prospect nommé', () => {
    const r = CreateOpportunitySchema.safeParse({ title: 'T', currency: 'CDF' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.map((i) => (i as { params?: { code?: string } }).params?.code),
      ).toContain('CUSTOMER_OR_PROSPECT_REQUIRED');
    }
  });

  it('une note n’a pas d’échéance ; une relance en a une ; un jour seul = fin de journée à Kinshasa', () => {
    expect(
      CreateActivitySchema.safeParse({ kind: 'note', subject: 'S', dueAt: '2026-10-22' }).success,
    ).toBe(false);
    expect(CreateActivitySchema.safeParse({ kind: 'follow_up', subject: 'S' }).success).toBe(false);
    const r = CreateActivitySchema.safeParse({
      kind: 'follow_up',
      subject: 'S',
      dueAt: '2026-10-22',
    });
    expect(r.success && r.data.dueAt?.toISOString()).toBe('2026-10-22T22:59:59.000Z');
    expect(
      CreateActivitySchema.safeParse({ kind: 'call', subject: 'S', dueAt: '2026-02-31' }).success,
    ).toBe(false);
  });
});

describe('CSV', () => {
  it('export : « ; », BOM, formules neutralisées ; relu à l’identique', () => {
    const csv = toCsv(
      ['nom', 'notes'],
      [
        ['Awa ; Kabila', '=1+1'],
        ['Jean "JB"', null],
      ],
    );
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain(`"Awa ; Kabila";'=1+1`);
    const back = parseCsv(csv, { required: ['nom'], maxRows: 10 });
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.rows.map((r) => r.cells)).toEqual([
        { nom: 'Awa ; Kabila', notes: '=1+1' },
        { nom: 'Jean "JB"', notes: '' },
      ]);
      expect(back.rows.map((r) => r.line)).toEqual([2, 3]);
    }
  });

  it('import : « , » détecté, en-têtes accentués normalisés, lignes vides ignorées', () => {
    const r = parseCsv('Nom,Téléphone\nA,+243 1\n\n"B\nsuite",2\n', {
      required: ['nom'],
      maxRows: 10,
    });
    expect(r.ok && r.header).toEqual(['nom', 'telephone']);
    expect(r.ok && r.rows.map((x) => x.cells['nom'])).toEqual(['A', 'B\nsuite']);
  });

  it('refus explicites : colonne manquante, guillemet ouvert, trop de lignes, aucune ligne', () => {
    expect(parseCsv('x\n1', { required: ['nom'], maxRows: 10 })).toMatchObject({ ok: false });
    expect(parseCsv('nom\n"a', { required: ['nom'], maxRows: 10 })).toMatchObject({ ok: false });
    expect(parseCsv('nom\na\nb', { required: ['nom'], maxRows: 1 })).toMatchObject({ ok: false });
    expect(parseCsv('nom\n', { required: ['nom'], maxRows: 1 })).toMatchObject({ ok: false });
  });

  it('montant de tableur : espaces et virgule décimale, sans calcul', () => {
    expect(amountFromSheet('1 500,50')).toBe('1500.50');
    expect(amountFromSheet('1 500')).toBe('1500');
  });
});
