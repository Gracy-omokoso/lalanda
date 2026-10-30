import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { DEFAULT_WORK_COLUMNS } from './constants.js';
import {
  AddDependencyBody,
  CreateProjectFromOpportunityBody,
  CreateProjectFromQuoteBody,
  CreateTimeEntryBody,
  CreateWorkCommentBody,
  CreateWorkProjectBody,
  CreateWorkTaskBody,
  ListWorkTasksQuery,
  MoveWorkTaskBody,
  PatchWorkTaskBody,
  PrepareInvoiceBody,
  PutWorkSettingsBody,
  SetMemberRateBody,
  UpdateWorkProjectBody,
} from './schemas.js';

const ID = '64b7f0c2a1b2c3d4e5f60718';
const ID2 = '64b7f0c2a1b2c3d4e5f60719';

/** Codes portés par les problèmes (`params.code`, sinon le code zod brut). */
function codes(schema: z.ZodType, input: unknown): string[] {
  const r = schema.safeParse(input);
  if (r.success) return [];
  return r.error.issues.map((i) => {
    const c = (i as { params?: { code?: unknown } }).params?.code;
    return typeof c === 'string' ? c : i.code;
  });
}

describe('compatibilité avec zod-compat.ts de l’API', () => {
  it('un champ absent porteur d’un message propre garde `received: "undefined"` (→ FIELD_REQUIRED)', () => {
    const r = CreateWorkProjectBody.safeParse({ name: 'P' });
    expect(r.success).toBe(false);
    const kind = r.error!.issues.find((i) => i.path[0] === 'kind')!;
    expect(kind.code).toBe('invalid_value');
    expect((kind as { received?: string }).received).toBe('undefined');
    expect(kind.message).toBe('Nature : client ou internal.');
  });
});

describe('corps stricts', () => {
  it('refuse un champ inconnu', () => {
    expect(codes(CreateWorkProjectBody, { name: 'P', kind: 'client', extra: 1 })).toContain(
      'unrecognized_keys',
    );
    expect(codes(AddDependencyBody, { predecessorTaskId: ID, x: 1 })).toContain(
      'unrecognized_keys',
    );
  });
});

describe('projets', () => {
  it('accepte un projet minimal et normalise les textes', () => {
    const r = CreateWorkProjectBody.parse({
      name: '  Chantier  ',
      kind: 'internal',
      description: '  ',
    });
    expect(r).toEqual({ name: 'Chantier', kind: 'internal', description: null });
  });

  it('nom vide ou trop long', () => {
    expect(codes(CreateWorkProjectBody, { name: '  ', kind: 'client' })).toEqual([
      'FIELD_REQUIRED',
    ]);
    expect(codes(CreateWorkProjectBody, { name: 'x'.repeat(121), kind: 'client' })).toEqual([
      'TEXT_TOO_LONG',
    ]);
  });

  it('échéance avant le début : WORK_DATES_INVERTED', () => {
    expect(
      codes(CreateWorkProjectBody, {
        name: 'P',
        kind: 'client',
        startDate: '2026-11-10',
        dueDate: '2026-11-01',
      }),
    ).toEqual(['WORK_DATES_INVERTED']);
  });

  it('identifiants : format, minuscules, doublons', () => {
    const r = CreateWorkProjectBody.parse({
      name: 'P',
      kind: 'client',
      links: { customerId: ID.toUpperCase(), quoteIds: [ID] },
    });
    expect(r.links?.customerId).toBe(ID);
    expect(
      codes(CreateWorkProjectBody, { name: 'P', kind: 'client', links: { customerId: 'abc' } }),
    ).toEqual(['WORK_ID_INVALID']);
    expect(
      codes(CreateWorkProjectBody, { name: 'P', kind: 'client', links: { quoteIds: [ID, ID] } }),
    ).toEqual(['WORK_ID_DUPLICATE']);
  });

  it('colonnes : au moins une « à faire », exactement une « terminé », clés uniques', () => {
    const base = { name: 'P', kind: 'client' };
    expect(codes(CreateWorkProjectBody, { ...base, columns: DEFAULT_WORK_COLUMNS })).toEqual([]);
    expect(
      codes(CreateWorkProjectBody, {
        ...base,
        columns: [
          { key: 'a', label: 'A', category: 'in_progress' },
          { key: 'b', label: 'B', category: 'done' },
        ],
      }),
    ).toEqual(['WORK_COLUMNS_INVALID']);
    expect(
      codes(CreateWorkProjectBody, {
        ...base,
        columns: [
          { key: 'a', label: 'A', category: 'todo' },
          { key: 'b', label: 'B', category: 'done' },
          { key: 'c', label: 'C', category: 'done' },
        ],
      }),
    ).toEqual(['WORK_COLUMNS_INVALID']);
    expect(
      codes(CreateWorkProjectBody, {
        ...base,
        columns: [
          { key: 'a', label: 'A', category: 'todo' },
          { key: 'a', label: 'B', category: 'done' },
        ],
      }),
    ).toEqual(['WORK_COLUMN_KEY_DUPLICATE']);
    expect(
      codes(CreateWorkProjectBody, {
        ...base,
        columns: [{ key: 'a', label: 'A', category: 'todo' }],
      }),
    ).toContain('WORK_COLUMNS_INVALID');
    expect(
      codes(CreateWorkProjectBody, {
        ...base,
        columns: [
          { key: 'A B', label: 'A', category: 'todo' },
          { key: 'b', label: 'B', category: 'done' },
        ],
      }),
    ).toEqual(['WORK_KEY_INVALID']);
  });

  it('mise à jour : révision exigée, statut « archived » refusé', () => {
    expect(codes(UpdateWorkProjectBody, { name: 'P' })).toEqual(['invalid_type']);
    expect(codes(UpdateWorkProjectBody, { expectedRevision: 1, status: 'archived' })).toEqual([
      'invalid_value',
    ]);
    expect(codes(UpdateWorkProjectBody, { expectedRevision: 1, status: 'on_hold' })).toEqual([]);
  });

  it('depuis un devis : lignes uniques, jalon daté', () => {
    expect(codes(CreateProjectFromQuoteBody, { quoteId: ID, lineIndexes: [0, 2] })).toEqual([]);
    expect(codes(CreateProjectFromQuoteBody, { quoteId: ID, lineIndexes: [1, 1] })).toEqual([
      'WORK_ID_DUPLICATE',
    ]);
    expect(
      codes(CreateProjectFromQuoteBody, { quoteId: ID, milestone: { title: 'Fin', dueDate: 'x' } }),
    ).toEqual(['DATE_INVALID']);
  });

  it('depuis une opportunité : devis facultatif, mêmes règles de lignes (ADR-0040 C7)', () => {
    expect(codes(CreateProjectFromOpportunityBody, { opportunityId: ID })).toEqual([]);
    expect(
      codes(CreateProjectFromOpportunityBody, { opportunityId: ID, quoteId: ID, lineIndexes: [0] }),
    ).toEqual([]);
    expect(
      codes(CreateProjectFromOpportunityBody, { opportunityId: ID, lineIndexes: [0, 0] }),
    ).toEqual(['WORK_ID_DUPLICATE']);
    expect(codes(CreateProjectFromOpportunityBody, { opportunityId: ID, amount: '1' })).toEqual([
      'unrecognized_keys',
    ]);
  });
});

describe('tâches', () => {
  it('jalon sans échéance, jalon avec début, jalon sous-tâche', () => {
    expect(codes(CreateWorkTaskBody, { title: 'J', isMilestone: true })).toEqual([
      'WORK_MILESTONE_NEEDS_DATE',
    ]);
    expect(
      codes(CreateWorkTaskBody, {
        title: 'J',
        isMilestone: true,
        startDate: '2026-11-01',
        dueDate: '2026-11-02',
      }),
    ).toEqual(['WORK_MILESTONE_HAS_START']);
    expect(
      codes(CreateWorkTaskBody, {
        title: 'J',
        isMilestone: true,
        dueDate: '2026-11-02',
        parentTaskId: ID,
      }),
    ).toEqual(['WORK_SUBTASK_DEPTH']);
  });

  it('patch : retirer l’échéance d’un jalon est refusé', () => {
    expect(
      codes(PatchWorkTaskBody, { expectedRevision: 2, isMilestone: true, dueDate: null }),
    ).toEqual(['WORK_MILESTONE_NEEDS_DATE']);
    expect(codes(PatchWorkTaskBody, { expectedRevision: 2, priority: 'urgent' })).toEqual([]);
  });

  it('étiquettes en double, priorité inconnue', () => {
    expect(codes(CreateWorkTaskBody, { title: 'T', labelKeys: ['a', 'a'] })).toEqual([
      'WORK_LABEL_KEY_DUPLICATE',
    ]);
    expect(codes(CreateWorkTaskBody, { title: 'T', priority: 'critique' })).toEqual([
      'invalid_value',
    ]);
  });

  it('déplacement : deux voisines identiques refusées', () => {
    expect(
      codes(MoveWorkTaskBody, {
        columnKey: 'done',
        beforeTaskId: ID,
        afterTaskId: ID,
        expectedRevision: 1,
      }),
    ).toEqual(['INVALID_VALUE']);
    expect(
      codes(MoveWorkTaskBody, { columnKey: 'done', afterTaskId: ID2, expectedRevision: 1 }),
    ).toEqual([]);
  });

  it('commentaire : mentions uniques, 20 au plus', () => {
    expect(codes(CreateWorkCommentBody, { body: 'Salut @[x]', mentionedUserIds: [ID] })).toEqual(
      [],
    );
    expect(codes(CreateWorkCommentBody, { body: 'x', mentionedUserIds: [ID, ID] })).toEqual([
      'WORK_ID_DUPLICATE',
    ]);
  });
});

describe('temps et taux', () => {
  it('minutes entières de 1 à 1 440', () => {
    expect(codes(CreateTimeEntryBody, { workedOn: '2026-10-29', minutes: 90 })).toEqual([]);
    expect(codes(CreateTimeEntryBody, { workedOn: '2026-10-29', minutes: 0 })).toEqual([
      'too_small',
    ]);
    expect(codes(CreateTimeEntryBody, { workedOn: '2026-10-29', minutes: 1_441 })).toEqual([
      'too_big',
    ]);
    expect(codes(CreateTimeEntryBody, { workedOn: '2026-10-29', minutes: 1.5 })).toEqual([
      'invalid_type',
    ]);
  });

  it('coût horaire : chaîne décimale, jamais un nombre', () => {
    const ok = SetMemberRateBody.parse({
      userId: ID,
      currency: 'USD',
      hourlyCost: '12.5',
      effectiveFrom: '2026-01-01',
    });
    expect(ok.hourlyCost).toBe('12.50');
    const base = { userId: ID, currency: 'USD', effectiveFrom: '2026-01-01' };
    expect(codes(SetMemberRateBody, { ...base, hourlyCost: 12.5 })).toEqual([
      'DECIMAL_MUST_BE_STRING',
    ]);
    expect(codes(SetMemberRateBody, { ...base, hourlyCost: '12.505' })).toEqual([
      'AMOUNT_TOO_PRECISE',
    ]);
    expect(codes(SetMemberRateBody, { ...base, hourlyCost: '0.00' })).toEqual([
      'AMOUNT_NOT_POSITIVE',
    ]);
    expect(codes(SetMemberRateBody, { ...base, hourlyCost: '1e3' })).toEqual(['AMOUNT_INVALID']);
    expect(codes(SetMemberRateBody, base)).toEqual(['FIELD_REQUIRED']);
  });
});

describe('réglages, factures, requêtes', () => {
  it('réglages : couleurs fermées, clés uniques, échéance proche 0 à 14', () => {
    const base = { expectedRevision: 0, defaultColumns: DEFAULT_WORK_COLUMNS, dueSoonDays: 1 };
    expect(
      codes(PutWorkSettingsBody, {
        ...base,
        labels: [{ key: 'urg', label: 'Urgent', color: 'red' }],
      }),
    ).toEqual([]);
    expect(
      codes(PutWorkSettingsBody, {
        ...base,
        labels: [{ key: 'urg', label: 'Urgent', color: '#ff0000' }],
      }),
    ).toEqual(['invalid_value']);
    expect(
      codes(PutWorkSettingsBody, {
        ...base,
        labels: [
          { key: 'a', label: 'A', color: 'red' },
          { key: 'a', label: 'B', color: 'blue' },
        ],
      }),
    ).toEqual(['WORK_LABEL_KEY_DUPLICATE']);
    expect(codes(PutWorkSettingsBody, { ...base, labels: [], dueSoonDays: 15 })).toEqual([
      'too_big',
    ]);
  });

  it('préparer une facture : deux sources fermées', () => {
    expect(codes(PrepareInvoiceBody, { source: 'empty' })).toEqual([]);
    expect(
      codes(PrepareInvoiceBody, { source: 'quote_lines', quoteId: ID, lineIndexes: [0] }),
    ).toEqual([]);
    expect(codes(PrepareInvoiceBody, { source: 'percent' })).toEqual(['invalid_union']);
  });

  it('liste transverse : assignee, booléens, période', () => {
    const r = ListWorkTasksQuery.parse({ assignee: 'me', done: 'false' });
    expect(r).toMatchObject({ assignee: 'me', done: false, limit: 50 });
    expect(codes(ListWorkTasksQuery, { dueFrom: '2026-11-02', dueTo: '2026-11-01' })).toEqual([
      'WORK_DATES_INVERTED',
    ]);
    expect(codes(ListWorkTasksQuery, { limit: '500' })).toEqual(['too_big']);
  });
});
