import { describe, expect, it } from 'vitest';

import {
  CountStockLineBody,
  CreateStockCountBody,
  CreateStockItemBody,
  CreateStockVoucherBody,
  StockReportsQuery,
  UpdateStockSettingsBody,
} from './index.js';

type Issues = { issues: { params?: { code?: string }; message: string }[] };
const codes = (r: { success: boolean; error?: unknown }): string[] =>
  r.success ? [] : (r.error as Issues).issues.map((i) => i.params?.code ?? i.message);

const ID = 'AAAAAAAAAAAAAAAAAAAAAAAA';
const ID2 = 'bbbbbbbbbbbbbbbbbbbbbbbb';

describe('stocks — contrats du lot S3 (ADR-0046 § 5.1)', () => {
  it('article : valeurs par défaut, corps strict, quantités en chaînes', () => {
    const ok = CreateStockItemBody.parse({ name: ' Ciment ', unit: 'sac' });
    expect(ok).toMatchObject({
      name: 'Ciment',
      kind: 'goods',
      tracked: true,
      discreteUnit: false,
      unitConversions: [],
    });
    expect(CreateStockItemBody.safeParse({ name: 'X', unit: 'u', extra: 1 }).success).toBe(false);
    expect(
      codes(
        CreateStockItemBody.safeParse({
          name: 'X',
          unit: 'u',
          reorder: { minQuantity: 5, locationId: null },
        }),
      ),
    ).toContain('DECIMAL_MUST_BE_STRING');
  });

  it('bon : emplacements et sens selon le type', () => {
    const line = { itemId: ID, quantity: '2' };
    expect(
      CreateStockVoucherBody.safeParse({
        kind: 'issue',
        fromLocationId: ID,
        postedOn: '2026-10-30',
        lines: [line],
      }).success,
    ).toBe(true);
    expect(
      codes(
        CreateStockVoucherBody.safeParse({
          kind: 'transfer',
          fromLocationId: ID,
          toLocationId: ID.toLowerCase(),
          postedOn: '2026-10-30',
          lines: [line],
        }),
      ),
    ).toContain('STOCK_TRANSFER_SAME_LOCATION');
    const adj = codes(
      CreateStockVoucherBody.safeParse({
        kind: 'adjustment',
        fromLocationId: ID,
        postedOn: '2026-10-30',
        lines: [line],
      }),
    );
    expect(adj).toEqual(expect.arrayContaining(['FIELD_REQUIRED']));
    expect(
      codes(
        CreateStockVoucherBody.safeParse({
          kind: 'issue',
          fromLocationId: ID,
          postedOn: '2026-10-30',
          lines: [{ ...line, unitCost: '1.5' }],
        }),
      ),
    ).toContain('FIELD_NOT_ALLOWED');
    expect(
      CreateStockVoucherBody.safeParse({
        kind: 'issue',
        fromLocationId: ID,
        postedOn: '2026-10-30',
        lines: [{ itemId: ID2, quantity: '0' }],
      }).success,
    ).toBe(false);
  });

  it('inventaire : aveugle par défaut, portée « items » exige des articles', () => {
    expect(CreateStockCountBody.parse({ locationId: ID })).toMatchObject({
      scope: 'all',
      blind: true,
      assignees: [],
    });
    expect(codes(CreateStockCountBody.safeParse({ locationId: ID, scope: 'items' }))).toContain(
      'FIELD_REQUIRED',
    );
    expect(CountStockLineBody.parse({ countedQuantity: '16' }).countedQuantity).toBe('16.000');
  });

  it('réglages et période', () => {
    expect(
      codes(
        UpdateStockSettingsBody.safeParse({
          expectedRevision: 1,
          adjustmentReasons: [
            { key: 'casse', label: 'Casse' },
            { key: 'casse', label: 'Autre' },
          ],
        }),
      ),
    ).toContain('DUPLICATE_KEY');
    expect(codes(StockReportsQuery.safeParse({ from: '2026-10-31', to: '2026-10-01' }))).toContain(
      'INVALID_PERIOD',
    );
  });
});
