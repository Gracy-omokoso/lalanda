import { describe, expect, it } from 'vitest';

import {
  AnnouncementDraftInputSchema,
  AnnouncementSendInputSchema,
  AudienceFilterSchema,
  BlockUserInputSchema,
  ConfirmManualPaymentInputSchema,
  PLATFORM_ACTIONS,
  PLATFORM_ACTION_DEFINITIONS,
  PLATFORM_CONSOLE_MODULES,
  PLATFORM_LIMITS,
  PLATFORM_MIRROR_ACTOR_ID,
  PLATFORM_ROLE_SLUGS,
  PlanGrantInputSchema,
  PlatformSearchQuerySchema,
  PlatformViewReasonQuerySchema,
  RejectManualPaymentInputSchema,
  RestoreOrganizationInputSchema,
  SuspendOrganizationInputSchema,
  UnblockUserInputSchema,
  featureOverrideInputSchema,
  findForbiddenPlatformFinanceWords,
  grantPlatformRoleInputSchema,
  isPlatformAction,
  sortPlatformActions,
} from './index.js';

type Issues = { issues: { params?: { code?: string }; message: string }[] };
const codes = (r: { success: boolean; error?: unknown }): (string | undefined)[] =>
  r.success ? [] : (r.error as Issues).issues.map((i) => i.params?.code);

const NOW = new Date('2026-11-02T10:00:00.000Z');
const inDays = (d: number): string => new Date(NOW.getTime() + d * 86_400_000).toISOString();
const ORG = 'a'.repeat(24);

describe('catalogue des actions plateforme (ADR-0053 § 5.1)', () => {
  it('21 actions, préfixées `platform.`, sans doublon', () => {
    expect(PLATFORM_ACTIONS).toHaveLength(21);
    expect(new Set(PLATFORM_ACTIONS).size).toBe(21);
    for (const a of PLATFORM_ACTIONS) expect(a.startsWith('platform.'), a).toBe(true);
  });

  it('chaque action a un libellé et un module connus', () => {
    expect(Object.keys(PLATFORM_ACTION_DEFINITIONS).sort()).toEqual([...PLATFORM_ACTIONS].sort());
    for (const a of PLATFORM_ACTIONS) {
      expect(PLATFORM_ACTION_DEFINITIONS[a].label.length, a).toBeGreaterThan(5);
      expect(PLATFORM_CONSOLE_MODULES).toContain(PLATFORM_ACTION_DEFINITIONS[a].module);
    }
  });

  it('six rôles plateforme, préfixés `platform_`', () => {
    expect(PLATFORM_ROLE_SLUGS).toHaveLength(6);
    for (const r of PLATFORM_ROLE_SLUGS) expect(r.startsWith('platform_')).toBe(true);
  });

  it('`isPlatformAction` refuse une action d’organisation', () => {
    expect(isPlatformAction('platform.console.read')).toBe(true);
    expect(isPlatformAction('organization.manage')).toBe(false);
    expect(isPlatformAction('plan.approve')).toBe(false);
    expect(isPlatformAction(undefined)).toBe(false);
  });

  it('`sortPlatformActions` rend l’ordre du catalogue, sans doublon', () => {
    expect(
      sortPlatformActions(['platform.stats.read', 'platform.console.read', 'platform.stats.read']),
    ).toEqual(['platform.console.read', 'platform.stats.read']);
  });

  it('l’acteur du miroir est un pseudonyme, jamais un identifiant', () => {
    expect(PLATFORM_MIRROR_ACTOR_ID).toBe('platform:lalanda');
  });
});

describe('recherche et lecture journalisée (§ 2.6)', () => {
  it('moins de trois caractères → SEARCH_REQUIRED', () => {
    expect(codes(PlatformSearchQuerySchema.safeParse({ q: 'ab' }))).toEqual(['SEARCH_REQUIRED']);
    expect(PlatformSearchQuerySchema.safeParse({}).success).toBe(false);
    expect(PlatformSearchQuerySchema.safeParse({ q: ' abc ' }).success).toBe(true);
  });

  it('le motif de consultation est pris dans la liste', () => {
    expect(PlatformViewReasonQuerySchema.safeParse({ reason: 'billing' }).success).toBe(true);
    expect(PlatformViewReasonQuerySchema.safeParse({ reason: 'curiosité' }).success).toBe(false);
    expect(PlatformViewReasonQuerySchema.safeParse({}).success).toBe(false);
  });
});

describe('motifs obligatoires (§ 6.1, § 6.2)', () => {
  it('bloquer exige catégorie et note de dix caractères', () => {
    expect(BlockUserInputSchema.safeParse({ reasonCategory: 'abuse' }).success).toBe(false);
    expect(
      codes(BlockUserInputSchema.safeParse({ reasonCategory: 'abuse', internalNote: 'court' })),
    ).toEqual(['REASON_REQUIRED']);
    expect(
      BlockUserInputSchema.safeParse({ reasonCategory: 'abuse', internalNote: 'Spam répété.' })
        .success,
    ).toBe(true);
    expect(UnblockUserInputSchema.safeParse({}).success).toBe(false);
  });

  it('un champ inattendu est refusé (`.strict()`)', () => {
    expect(
      BlockUserInputSchema.safeParse({
        reasonCategory: 'abuse',
        internalNote: 'Spam répété.',
        userId: ORG,
      }).success,
    ).toBe(false);
  });

  it('suspendre : lecture seule par défaut, message client borné', () => {
    const ok = SuspendOrganizationInputSchema.safeParse({
      reasonCategory: 'fraud',
      clientMessage: 'Votre espace est en lecture seule.',
      internalNote: 'Paiement frauduleux signalé.',
    });
    expect(ok.success && ok.data.mode).toBe('read_only');
    expect(
      SuspendOrganizationInputSchema.safeParse({
        reasonCategory: 'fraud',
        clientMessage: 'x'.repeat(PLATFORM_LIMITS.clientMessageMaxLength + 1),
        internalNote: 'Paiement frauduleux signalé.',
      }).success,
    ).toBe(false);
    expect(
      RestoreOrganizationInputSchema.safeParse({ liftReason: 'Régularisé ce jour.' }).success,
    ).toBe(false);
  });

  it('confirmer et refuser un paiement manuel exigent une note', () => {
    expect(ConfirmManualPaymentInputSchema.safeParse({}).success).toBe(false);
    expect(ConfirmManualPaymentInputSchema.safeParse({ note: 'Réf. MPESA 123456' }).success).toBe(
      true,
    );
    expect(RejectManualPaymentInputSchema.safeParse({ reason: '' }).success).toBe(false);
  });
});

describe('attribution de rôle (§ 5.3, critère 16)', () => {
  const schema = grantPlatformRoleInputSchema(NOW);

  it('sans motif → 400', () => {
    expect(schema.safeParse({ role: 'platform_admin' }).success).toBe(false);
    expect(codes(schema.safeParse({ role: 'platform_admin', reason: 'court' }))).toEqual([
      'REASON_REQUIRED',
    ]);
  });

  it('Support : échéance obligatoire, 90 jours au plus', () => {
    const reason = 'Renfort du support pour novembre.';
    expect(codes(schema.safeParse({ role: 'platform_support', reason }))).toEqual([
      'SUPPORT_EXPIRY_REQUIRED',
    ]);
    expect(
      codes(schema.safeParse({ role: 'platform_support', reason, expiresAt: inDays(91) })),
    ).toEqual(['SUPPORT_EXPIRY_TOO_LONG']);
    expect(
      schema.safeParse({ role: 'platform_support', reason, expiresAt: inDays(90) }).success,
    ).toBe(true);
  });

  it('une échéance passée est refusée ; les autres rôles peuvent être permanents', () => {
    const reason = 'Arrivée de la responsable finance.';
    expect(
      codes(schema.safeParse({ role: 'platform_billing', reason, expiresAt: inDays(-1) })),
    ).toEqual(['EXPIRY_IN_PAST']);
    expect(schema.safeParse({ role: 'platform_billing', reason }).success).toBe(true);
  });

  it('un rôle d’organisation n’est pas un rôle plateforme', () => {
    expect(schema.safeParse({ role: 'owner', reason: 'Tentative de mélange.' }).success).toBe(
      false,
    );
  });
});

describe('octroi manuel et dérogation (§ 6.2, § 6.3)', () => {
  const base = {
    targetOrganizationId: ORG.toUpperCase(),
    plan: 'expert',
    reasonCategory: 'request',
    clientMessage: 'Offre Expert accordée.',
    internalNote: 'Accord commercial du 2 nov.',
  };

  it('octroi : motif obligatoire, identifiant normalisé, période cohérente', () => {
    const ok = PlanGrantInputSchema.safeParse(base);
    expect(ok.success && ok.data.targetOrganizationId).toBe(ORG);
    expect(PlanGrantInputSchema.safeParse({ ...base, internalNote: undefined }).success).toBe(
      false,
    );
    expect(
      codes(PlanGrantInputSchema.safeParse({ ...base, startsAt: inDays(10), endsAt: inDays(5) })),
    ).toEqual(['GRANT_PERIOD_INVALID']);
  });

  it('dérogation : échéance obligatoire dans les 90 jours', () => {
    const schema = featureOverrideInputSchema(NOW);
    const d = {
      targetOrganizationId: ORG,
      feature: 'crm',
      value: true,
      reasonCategory: 'request',
      internalNote: 'Essai prolongé du CRM.',
    };
    expect(schema.safeParse({ ...d, endsAt: inDays(30) }).success).toBe(true);
    expect(codes(schema.safeParse({ ...d, endsAt: inDays(91) }))).toEqual([
      'OVERRIDE_EXPIRY_INVALID',
    ]);
    expect(schema.safeParse(d).success).toBe(false);
  });
});

describe('annonces (§ 6.6)', () => {
  it('catégories : métadonnées seulement, combinables', () => {
    expect(
      AudienceFilterSchema.safeParse({ ownersOnly: true, plans: ['pro'], countries: ['CD'] })
        .success,
    ).toBe(true);
    expect(AudienceFilterSchema.safeParse({ countries: ['RDC'] }).success).toBe(false);
    expect(AudienceFilterSchema.safeParse({ projectName: 'x' }).success).toBe(false);
  });

  it('corps en texte borné ; envoi avec un nombre retapé', () => {
    expect(
      AnnouncementDraftInputSchema.safeParse({
        title: 'Maintenance',
        body: 'x'.repeat(PLATFORM_LIMITS.announcementBodyMaxLength + 1),
        audience: {},
      }).success,
    ).toBe(false);
    expect(AnnouncementSendInputSchema.safeParse({}).success).toBe(false);
    expect(AnnouncementSendInputSchema.safeParse({ confirmedAudienceCount: 12 }).success).toBe(
      true,
    );
  });
});

describe('finances du site : mots interdits (§ 6.8, critère 21)', () => {
  it('repère chiffre d’affaires, facturé et TVA, pas les encaissements', () => {
    expect(findForbiddenPlatformFinanceWords('Encaissements constatés')).toEqual([]);
    expect(findForbiddenPlatformFinanceWords('Revenu récurrent déclaré')).toEqual([]);
    expect(findForbiddenPlatformFinanceWords("Chiffre d'affaires du mois")).toEqual([
      "chiffre d'affaires",
    ]);
    expect(findForbiddenPlatformFinanceWords('Montant facturé')).toEqual(['facturé']);
    expect(findForbiddenPlatformFinanceWords('TVA collectée')).toEqual(['tva']);
    expect(findForbiddenPlatformFinanceWords('activation')).toEqual([]);
  });
});
