import { describe, expect, it } from 'vitest';

import {
  PLATFORM_SECURITY_EVENT_KINDS,
  type PlatformSecuritySummaryView,
} from '@lalanda/shared/platform';

import {
  FILTRES_VIDES,
  MOTIFS_EXPORT,
  erreurFiltres,
  filtresActifs,
  filtresEnvoyes,
  joursActifs,
  libelleActionJournal,
  lignesSecurite,
  noteMasquage,
  peutExporter,
} from './journal-model';

const zeros = () =>
  Object.fromEntries(
    PLATFORM_SECURITY_EVENT_KINDS.map((k) => [k, 0]),
  ) as PlatformSecuritySummaryView['totals'];

describe('filtres du journal', () => {
  it('retire les champs vides et rogne', () => {
    expect(
      filtresEnvoyes({ ...FILTRES_VIDES, action: ' user.disabled ', from: '2026-11-01' }),
    ).toEqual({
      action: 'user.disabled',
      from: '2026-11-01',
    });
    expect(filtresActifs(FILTRES_VIDES)).toBe(0);
  });
  it('refuse une période à l’envers', () => {
    expect(
      erreurFiltres({ ...FILTRES_VIDES, from: '2026-11-02', to: '2026-11-01' }),
    ).not.toBeNull();
    expect(erreurFiltres({ ...FILTRES_VIDES, from: '2026-11-01', to: '2026-11-01' })).toBeNull();
  });
});

describe('export', () => {
  it('réservé à `platform.audit.export`', () => {
    expect(peutExporter(['platform.console.read', 'platform.audit.read'])).toBe(false);
    expect(peutExporter(['platform.audit.read', 'platform.audit.export'])).toBe(true);
  });
  it('motifs de la liste du § 2.6', () => {
    expect(MOTIFS_EXPORT.map((m) => m.valeur)).toEqual([
      'support',
      'billing',
      'security',
      'abuse',
      'legal_request',
    ]);
  });
});

describe('libellés et masquage', () => {
  it('libellés des actions P2/P5, repli sur la table historique, puis le code brut', () => {
    expect(libelleActionJournal('platform.audit.exported')).toBe('Journal plateforme exporté');
    expect(libelleActionJournal('user.disabled')).toBe('Compte désactivé');
    expect(libelleActionJournal('x.y')).toBe('x.y');
  });
  it('note de masquage', () => {
    expect(noteMasquage(0)).toBeNull();
    expect(noteMasquage(undefined)).toBeNull();
    expect(noteMasquage(2)).toContain('2 champs masqués');
  });
});

describe('sécurité', () => {
  const resume = (): PlatformSecuritySummaryView => {
    const d1 = zeros();
    const d2 = zeros();
    d2.console_forbidden = 2;
    d2.account_blocked = 1;
    const totals = zeros();
    totals.console_forbidden = 2;
    totals.account_blocked = 1;
    return {
      from: '2026-11-01',
      to: '2026-11-02',
      kinds: PLATFORM_SECURITY_EVENT_KINDS,
      days: [
        { day: '2026-11-01', counts: d1 },
        { day: '2026-11-02', counts: d2 },
      ],
      totals,
      blockedAccountsNow: 1,
    };
  };
  it('une ligne par nature du catalogue', () => {
    const l = lignesSecurite(resume());
    expect(l.map((x) => x.kind)).toEqual([...PLATFORM_SECURITY_EVENT_KINDS]);
    expect(l.find((x) => x.kind === 'console_forbidden')?.total).toBe(2);
  });
  it('seuls les jours actifs, du plus récent', () => {
    const j = joursActifs(resume());
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({ day: '2026-11-02', total: 3 });
  });
});
