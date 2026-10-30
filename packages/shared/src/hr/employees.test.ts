// Contrats du lot H2 (ADR-0045 § 2.1 à § 2.4). ADR-0045 — H2.
import { describe, expect, it } from 'vitest';

import {
  AnonymizeEmployeeBody,
  CreateEmployeeBody,
  CreateEmployeesFromMembersBody,
  HR_PRIVATE_FIELDS,
  ListEmployeesQuery,
  RevealPrivateBody,
  UpdateEmployeeBody,
  updatePrivateSectionBody,
} from './index.js';

type Issues = { issues: { params?: { code?: string }; message: string }[] };
const codes = (r: { success: boolean; error?: unknown }): string[] =>
  r.success ? [] : (r.error as Issues).issues.map((i) => i.params?.code ?? i.message);

const base = {
  firstName: ' Aline ',
  lastName: 'Mbuyi',
  jobTitle: 'Comptable',
  contractType: 'permanent',
  startDate: '2026-01-16',
};

describe('@lalanda/shared/hr — dossiers (H2)', () => {
  it('fiche minimale : nom, poste, type de contrat, entrée ; textes nettoyés', () => {
    const r = CreateEmployeeBody.parse(base);
    expect(r.firstName).toBe('Aline');
    expect(r.userId).toBeUndefined();
  });

  it('corps strict, dates et téléphone vérifiés', () => {
    expect(codes(CreateEmployeeBody.safeParse({ ...base, birthDate: '1990-01-01' }))).toHaveLength(
      1,
    );
    expect(codes(CreateEmployeeBody.safeParse({ ...base, startDate: '2026-02-30' }))).toContain(
      'INVALID_DATE',
    );
    expect(codes(CreateEmployeeBody.safeParse({ ...base, workPhone: 'abc' }))).toContain(
      'PHONE_INVALID',
    );
    expect(codes(CreateEmployeeBody.safeParse({ ...base, contractType: 'CDI!' }))).toContain(
      'CONTRACT_TYPE_UNKNOWN',
    );
    // Aucune donnée sensible dans la fiche : pas de champ salaire.
    expect(CreateEmployeeBody.safeParse({ ...base, salary: '100.00' }).success).toBe(false);
  });

  it('mise à jour : révision exigée ; listes : statut par défaut actif', () => {
    expect(UpdateEmployeeBody.safeParse({ jobTitle: 'X' }).success).toBe(false);
    expect(UpdateEmployeeBody.parse({ expectedRevision: 1, managerEmployeeId: null })).toEqual({
      expectedRevision: 1,
      managerEmployeeId: null,
    });
    expect(ListEmployeesQuery.parse({})).toMatchObject({ status: 'active', limit: 50 });
  });

  it('from-members sans doublon ; anonymisation confirmée explicitement', () => {
    expect(codes(CreateEmployeesFromMembersBody.safeParse({ userIds: ['a', 'a'] }))).toContain(
      'USER_DUPLICATE',
    );
    expect(AnonymizeEmployeeBody.safeParse({ confirm: false, expectedRevision: 1 }).success).toBe(
      false,
    );
  });
});

describe('@lalanda/shared/hr — données sensibles (H2)', () => {
  it('cinq champs chiffrés : quatre sections et le motif de sortie', () => {
    expect(HR_PRIVATE_FIELDS).toEqual([
      'compensation',
      'bankDetails',
      'identity',
      'personalContact',
      'exitNote',
    ]);
  });

  it('salaire en chaîne décimale, jamais un nombre', () => {
    const body = updatePrivateSectionBody('compensation');
    const ok = body.parse({
      expectedRevision: 0,
      data: {
        history: [
          { effectiveFrom: '2026-01-01', amount: '450000', currency: 'CDF', period: 'month' },
        ],
      },
    });
    expect(ok.data!.history[0]!.amount).toBe('450000.00');
    expect(
      codes(
        body.safeParse({
          expectedRevision: 0,
          data: {
            history: [{ effectiveFrom: '2026-01-01', amount: 1, currency: 'CDF', period: 'month' }],
          },
        }),
      ),
    ).toContain('DECIMAL_MUST_BE_STRING');
  });

  it('coordonnées bancaires : forme seulement, trois au plus ; effacement par null', () => {
    const body = updatePrivateSectionBody('bankDetails');
    expect(body.parse({ expectedRevision: 2, data: null }).data).toBeNull();
    const four = Array.from({ length: 4 }, () => ({
      kind: 'mobile_money',
      operator: 'M-Pesa',
      holderName: 'A',
      phoneNumber: '+243 810000000',
    }));
    expect(body.safeParse({ expectedRevision: 0, data: { accounts: four } }).success).toBe(false);
    expect(
      codes(
        body.safeParse({
          expectedRevision: 0,
          data: {
            accounts: [{ kind: 'bank', bankName: 'R', holderName: 'A', accountNumber: '12/34' }],
          },
        }),
      ),
    ).toContain('ACCOUNT_INVALID');
  });

  it('reveal : sections connues, sans doublon', () => {
    expect(RevealPrivateBody.safeParse({ sections: [] }).success).toBe(false);
    expect(codes(RevealPrivateBody.safeParse({ sections: ['identity', 'identity'] }))).toContain(
      'SECTION_DUPLICATE',
    );
    expect(RevealPrivateBody.safeParse({ sections: ['salary'] }).success).toBe(false);
  });
});
