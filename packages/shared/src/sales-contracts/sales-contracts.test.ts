import { describe, expect, it } from 'vitest';

import {
  PrepareSalesDepositSchema,
  ResolveSalesDepositSchema,
  SALES_CONTRACT_AMENDMENT_NUMBER_PATTERN,
  SALES_CONTRACT_AMENDMENT_STATUSES,
  SALES_CONTRACT_BILLING_KINDS,
  SALES_CONTRACT_CLAUSES_BANNER,
  SALES_CONTRACT_DERIVED_STATUSES,
  SALES_CONTRACT_ERROR_CODES,
  SALES_CONTRACT_HEADER_FIELDS,
  SALES_CONTRACT_NOTICE_CHECK_LABELS,
  SALES_CONTRACT_NUMBER_PATTERN,
  SALES_CONTRACT_OCCURRENCE_BLOCKS,
  SALES_CONTRACT_RENEWAL_MODES,
  SALES_CONTRACT_SETTINGS_DEFAULTS,
  SALES_CONTRACT_STATUSES,
  SALES_CONTRACT_WARNING_CODES,
  SALES_DEPOSIT_FINAL_INVOICE_WARNING,
  SALES_DOCUMENT_LINK_KINDS,
  SALES_ORDER_NUMBER_PATTERN,
  SALES_ORDER_STATUSES,
  SALES_SUBSCRIPTIONS_SYSTEM_ACTOR,
  SalesContractAmendmentSchema,
  SalesContractApproveSchema,
  SalesContractBillingSchema,
  SalesContractCalendarDay,
  SalesContractId,
  SalesContractRejectSchema,
  SalesContractRenewalSchema,
  SalesContractSettingsSchema,
  SalesContractSignatureSchema,
  SalesContractTerminateSchema,
  canonicalSalesContractAmount,
  findForbiddenSalesContractWords,
} from './index.js';

type Issues = { issues: { params?: { code?: string }; message: string }[] };
const codes = (r: { success: boolean; error?: unknown }): string[] =>
  r.success ? [] : (r.error as Issues).issues.map((i) => i.params?.code ?? i.message);

const ID = '0123456789abcdef01234567';

describe('commandes et contrats — constantes (ADR-0050 §§ 2 à 7)', () => {
  it('statuts stockés et dérivés du § 2', () => {
    expect([...SALES_ORDER_STATUSES]).toEqual(['draft', 'confirmed', 'closed', 'cancelled']);
    expect([...SALES_CONTRACT_STATUSES]).toEqual([
      'draft',
      'submitted',
      'approved',
      'signed',
      'terminated',
      'cancelled',
    ]);
    expect([...SALES_CONTRACT_DERIVED_STATUSES]).toEqual([
      'upcoming',
      'in_force',
      'expiring',
      'ended',
    ]);
    // Avenant : même cycle, sans « Résilier ».
    expect(SALES_CONTRACT_AMENDMENT_STATUSES).not.toContain('terminated');
    expect([...SALES_CONTRACT_RENEWAL_MODES]).toEqual(['none', 'tacit', 'explicit']);
    expect([...SALES_CONTRACT_BILLING_KINDS]).toEqual(['none', 'schedule', 'recurring']);
  });

  it('six natures de lien ; blocages d’échéance du § 5.3', () => {
    expect(SALES_DOCUMENT_LINK_KINDS).toHaveLength(6);
    expect(SALES_CONTRACT_OCCURRENCE_BLOCKS).toContain('RENEWAL_NOT_RECORDED');
    expect(SALES_CONTRACT_OCCURRENCE_BLOCKS).toContain('AMENDMENT_PENDING');
  });

  it('réglages par défaut (§ 2.1, décisions ouvertes n° 7 et 10)', () => {
    expect(SALES_CONTRACT_SETTINGS_DEFAULTS).toEqual({
      noticeAlertDays: 30,
      termEndAlertDays: 60,
      subscriptionLeadDays: 0,
      autoPrepareSubscriptionDrafts: true,
      allowSoleApprover: true,
    });
    expect(Object.isFrozen(SALES_CONTRACT_SETTINGS_DEFAULTS)).toBe(true);
  });

  it('numérotation hors série fiscale : CT, CC, avenant -A{n}', () => {
    expect(SALES_CONTRACT_NUMBER_PATTERN.test('CT2701-000001')).toBe(true);
    expect(SALES_ORDER_NUMBER_PATTERN.test('CC2701-000042')).toBe(true);
    expect(SALES_ORDER_NUMBER_PATTERN.test('BC2701-000042')).toBe(false);
    expect(SALES_CONTRACT_AMENDMENT_NUMBER_PATTERN.test('CT2701-000001-A2')).toBe(true);
    expect(SALES_CONTRACT_AMENDMENT_NUMBER_PATTERN.test('CT2701-000001-A0')).toBe(false);
  });

  it('codes stables des critères d’acceptation ; aucun doublon', () => {
    for (const code of [
      'SELF_APPROVAL_FORBIDDEN',
      'ORDER_EXISTS_FOR_QUOTE',
      'CONTRACT_NOT_DRAFT',
      'SIGNED_COPY_REQUIRED',
      'AMENDMENT_BEFORE_PREPARED_OCCURRENCE',
      'STALE_REVISION',
    ] as const) {
      expect(SALES_CONTRACT_ERROR_CODES).toContain(code);
    }
    for (const code of [
      'QUOTE_ALREADY_CONVERTED',
      'UNMATCHED_LINE',
      'DEPOSIT_NOT_RESOLVED',
    ] as const) {
      expect(SALES_CONTRACT_WARNING_CODES).toContain(code);
    }
    expect(new Set(SALES_CONTRACT_ERROR_CODES).size).toBe(SALES_CONTRACT_ERROR_CODES.length);
    expect(new Set(SALES_CONTRACT_WARNING_CODES).size).toBe(SALES_CONTRACT_WARNING_CODES.length);
    expect(SALES_SUBSCRIPTIONS_SYSTEM_ACTOR).toBe('system:subscriptions');
  });

  it('critère 18 — aucun texte constant ne porte un mot interdit', () => {
    for (const text of [
      SALES_CONTRACT_CLAUSES_BANNER,
      SALES_DEPOSIT_FINAL_INVOICE_WARNING,
      ...Object.values(SALES_CONTRACT_NOTICE_CHECK_LABELS),
    ]) {
      expect(findForbiddenSalesContractWords(text), text).toEqual([]);
    }
    expect(SALES_CONTRACT_CLAUSES_BANNER).toContain('il ne vérifie pas leur validité juridique');
    expect(findForbiddenSalesContractWords('Contrat Conforme')).toEqual(['conforme']);
    expect(findForbiddenSalesContractWords('non-conformité constatée')).toEqual(['conforme']);
    expect(
      findForbiddenSalesContractWords('Clause valable juridiquement, reconduit automatiquement'),
    ).toEqual(['valable juridiquement', 'reconduit automatiquement']);
  });
});

describe('commandes et contrats — briques zod', () => {
  it('identifiant ramené en minuscules ; date civile réelle', () => {
    expect(SalesContractId.parse(ID.toUpperCase())).toBe(ID);
    expect(codes(SalesContractId.safeParse('xyz'))).toEqual(['SALES_CONTRACT_ID_INVALID']);
    expect(SalesContractCalendarDay.safeParse('2028-02-29').success).toBe(true);
    expect(codes(SalesContractCalendarDay.safeParse('2027-02-29'))).toEqual(['INVALID_DATE']);
  });

  it('montant canonique, deux décimales au plus', () => {
    expect(canonicalSalesContractAmount('12.5')).toBe('12.50');
    expect(canonicalSalesContractAmount('007')).toBe('7.00');
    expect(canonicalSalesContractAmount('1.234')).toBeNull();
    expect(canonicalSalesContractAmount('-1')).toBeNull();
  });

  it('reconduction : clause saisie cohérente', () => {
    expect(
      SalesContractRenewalSchema.safeParse({ mode: 'tacit', periodMonths: 12, maxRenewals: null })
        .success,
    ).toBe(true);
    expect(
      codes(
        SalesContractRenewalSchema.safeParse({
          mode: 'tacit',
          periodMonths: null,
          maxRenewals: null,
        }),
      ),
    ).toEqual(['RENEWAL_PERIOD_REQUIRED']);
    expect(
      codes(
        SalesContractRenewalSchema.safeParse({ mode: 'none', periodMonths: 12, maxRenewals: null }),
      ),
    ).toEqual(['RENEWAL_FIELDS_WITHOUT_RENEWAL']);
    expect(
      SalesContractRenewalSchema.safeParse({ mode: 'none', periodMonths: null, maxRenewals: null })
        .success,
    ).toBe(true);
    expect(
      SalesContractRenewalSchema.safeParse({
        mode: 'explicit',
        periodMonths: 61,
        maxRenewals: null,
      }).success,
    ).toBe(false);
  });

  it('échéancier : trois natures, `.strict()`, références uniques, sans pourcentage', () => {
    expect(SalesContractBillingSchema.safeParse({ kind: 'none' }).success).toBe(true);
    expect(
      SalesContractBillingSchema.safeParse({
        kind: 'recurring',
        frequency: 'monthly',
        anchorDate: '2027-01-31',
        timing: 'in_advance',
        autoPrepare: true,
      }).success,
    ).toBe(true);
    const item = { itemRef: 'e1', dueDate: '2027-03-01', label: 'Première échéance', lines: [] };
    expect(
      codes(SalesContractBillingSchema.safeParse({ kind: 'schedule', items: [item, item] })),
    ).toEqual(['SCHEDULE_ITEM_REF_DUPLICATE']);
    expect(
      SalesContractBillingSchema.safeParse({ kind: 'schedule', items: [{ ...item, percent: 30 }] })
        .success,
    ).toBe(false);
    expect(SalesContractBillingSchema.safeParse({ kind: 'schedule', items: [] }).success).toBe(
      false,
    );
  });

  it('approbation : commentaire facultatif ; rejet : commentaire exigé', () => {
    expect(SalesContractApproveSchema.parse({ expectedRevision: 2 })).toEqual({
      expectedRevision: 2,
      comment: null,
    });
    expect(
      codes(SalesContractRejectSchema.safeParse({ expectedRevision: 2, comment: '  ' })),
    ).toEqual(['FIELD_REQUIRED']);
    expect(SalesContractApproveSchema.safeParse({ expectedRevision: 2, extra: 1 }).success).toBe(
      false,
    );
  });

  it('signature déclarée : au moins un signataire de chaque côté', () => {
    const base = {
      expectedRevision: 3,
      signedOn: '2027-01-15',
      fileId: ID,
      signatories: [
        { name: 'Client', title: null, side: 'customer' },
        { name: 'Gérante', title: 'Gérante', side: 'organization' },
      ],
    };
    expect(SalesContractSignatureSchema.safeParse(base).success).toBe(true);
    expect(
      codes(
        SalesContractSignatureSchema.safeParse({
          ...base,
          signatories: [base.signatories[0]],
        }),
      ),
    ).toEqual(['SIGNATORIES_REQUIRED']);
    // L'absence de copie est jugée par le service (`422 SIGNED_COPY_REQUIRED`).
    expect(SalesContractSignatureSchema.safeParse({ ...base, fileId: null }).success).toBe(true);
  });

  it('critère 14 — résiliation : effet jamais avant la notification ; aucun contrôle du préavis ici', () => {
    const t = {
      expectedRevision: 4,
      noticeGivenOn: '2027-12-01',
      by: 'customer',
      effectiveOn: '2028-01-14',
      reason: 'Fin de la collaboration',
    };
    expect(SalesContractTerminateSchema.safeParse(t).success).toBe(true);
    expect(
      codes(SalesContractTerminateSchema.safeParse({ ...t, effectiveOn: '2027-11-30' })),
    ).toEqual(['TERMINATION_BEFORE_NOTICE']);
  });

  it('critère 12 — acompte : groupe de taxation exigé, montant en chaîne, ni pourcentage', () => {
    expect(
      codes(PrepareSalesDepositSchema.safeParse({ type: 'FT', requestedAmount: '100' })),
    ).toEqual(['TAX_GROUP_REQUIRED']);
    expect(
      codes(
        PrepareSalesDepositSchema.safeParse({ type: 'FT', requestedAmount: '100', taxGroup: 'Z' }),
      ),
    ).toEqual(['UNKNOWN_TAX_GROUP']);
    expect(
      codes(
        PrepareSalesDepositSchema.safeParse({ type: 'FT', requestedAmount: 100, taxGroup: 'B' }),
      ),
    ).toEqual(['DECIMAL_MUST_BE_STRING']);
    expect(
      PrepareSalesDepositSchema.parse({ type: 'ET', requestedAmount: '250.5', taxGroup: 'B' }),
    ).toEqual({ type: 'ET', requestedAmount: '250.50', taxGroup: 'B', label: null });
    expect(
      PrepareSalesDepositSchema.safeParse({
        type: 'FT',
        requestedAmount: '100',
        taxGroup: 'B',
        percent: 30,
      }).success,
    ).toBe(false);
    expect(
      PrepareSalesDepositSchema.safeParse({ type: 'FV', requestedAmount: '1', taxGroup: 'B' })
        .success,
    ).toBe(false);
    expect(
      ResolveSalesDepositSchema.safeParse({ reason: 'Imputé sur la facture finale' }).success,
    ).toBe(true);
  });

  it('réglages : bornes du § 2.1', () => {
    const r = { expectedRevision: null, ...SALES_CONTRACT_SETTINGS_DEFAULTS };
    expect(SalesContractSettingsSchema.safeParse(r).success).toBe(true);
    expect(SalesContractSettingsSchema.safeParse({ ...r, subscriptionLeadDays: 31 }).success).toBe(
      false,
    );
    expect(SalesContractSettingsSchema.safeParse({ ...r, noticeAlertDays: 366 }).success).toBe(
      false,
    );
  });

  it('avenant : contenu des champs modifiables seulement', () => {
    expect(
      SalesContractAmendmentSchema.safeParse({
        effectiveDate: '2027-03-01',
        purpose: 'change',
        changes: { lines: [], noticeDays: 60 },
      }).success,
    ).toBe(true);
    expect(
      SalesContractAmendmentSchema.safeParse({
        effectiveDate: '2027-03-01',
        purpose: 'change',
        changes: { customerId: ID },
      }).success,
    ).toBe(false);
  });

  it('en-tête de contrat : extensible par les lots V2 et V3', () => {
    expect(Object.keys(SALES_CONTRACT_HEADER_FIELDS)).toEqual([
      'title',
      'opportunityId',
      'ownerUserId',
      'startDate',
      'initialTermMonths',
      'renewal',
      'noticeDays',
      'billing',
      'clauses',
    ]);
  });
});
