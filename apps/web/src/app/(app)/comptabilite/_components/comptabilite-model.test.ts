// Règles communes de la comptabilité — ADR-0049 § 3.1, § 8, § 10, lot K8.

import {
  ACCOUNTING_MODE_BANNERS,
  ACCOUNTING_MODES,
  type AccountingMode,
} from '@lalanda/shared/accounting';
import { describe, expect, it } from 'vitest';

import {
  PHRASE_BIENTOT,
  bandeauxCompta,
  bornesDuMois,
  estBientot,
  formatMontant,
  formatSolde,
  libelleMois,
  messageCompta,
  moisDe,
  packActivable,
  peutActiver,
  peutLireCompta,
  peutRouvrir,
  phraseIndisponible,
} from './comptabilite-model';

const erreur = (status: number, code?: string): unknown => ({
  status,
  detail: code ? { code, message: 'x' } : { message: 'x' },
});

describe('bandeaux (§ 3.1, § 10)', () => {
  it('le bandeau « Projet » est présent dans TOUS les états, mode inconnu compris', () => {
    const modes: (AccountingMode | null)[] = [...ACCOUNTING_MODES, null];
    for (const m of modes) {
      const b = bandeauxCompta(m);
      expect(b.map((x) => x.texte)).toContain(ACCOUNTING_MODE_BANNERS.active);
      expect(b.find((x) => x.id === 'projet')?.texte).toMatch(
        /^Projet — à valider par un expert-comptable/,
      );
    }
  });

  it('en simulation, le bandeau « Simulation » est clairement signalé, en tête', () => {
    const b = bandeauxCompta('simulation');
    expect(b.map((x) => x.id)).toEqual(['simulation', 'projet']);
    expect(b[0]!.texte).toBe(ACCOUNTING_MODE_BANNERS.simulation);
    expect(b[0]!.ton).toBe('warning');
    expect(bandeauxCompta('active').map((x) => x.id)).toEqual(['projet']);
    expect(bandeauxCompta('off').map((x) => x.id)).toEqual(['projet']);
  });
});

describe('droits (§ 8) : par actions, jamais par rôle', () => {
  it('lecture et activation', () => {
    expect(peutLireCompta(null)).toBe(false);
    expect(peutLireCompta(['accounting.read'])).toBe(true);
    expect(peutActiver(['accounting.read', 'accounting.manage'])).toBe(false);
    expect(peutActiver(['accounting.read', 'accounting.manage', 'fiscal.manage'])).toBe(true);
  });

  it('réouverture : Propriétaire seul (§ 4)', () => {
    expect(peutRouvrir('owner')).toBe(true);
    expect(peutRouvrir('finance_director')).toBe(false);
    expect(peutRouvrir(null)).toBe(false);
  });
});

describe('pack (§ 3.1)', () => {
  it('seuls `approved` et `active` ouvrent la tenue active', () => {
    expect(packActivable('draft')).toBe(false);
    expect(packActivable('review')).toBe(false);
    expect(packActivable('retired')).toBe(false);
    expect(packActivable(null)).toBe(false);
    expect(packActivable('approved')).toBe(true);
    expect(packActivable('active')).toBe(true);
  });
});

describe('erreurs', () => {
  it('404 = « bientôt disponible », jamais un zéro', () => {
    expect(estBientot(erreur(404))).toBe(true);
    expect(messageCompta(erreur(404), 'repli')).toBe(PHRASE_BIENTOT);
    expect(phraseIndisponible(erreur(404))).toBe('Bientôt disponible');
    expect(phraseIndisponible(erreur(500))).toBe('Lecture impossible pour le moment');
  });

  it('codes métier en français simple', () => {
    expect(messageCompta(erreur(409, 'REOPEN_OWNER_ONLY'), 'r')).toMatch(/Propriétaire/);
    expect(messageCompta(erreur(403), 'r')).toMatch(/rôle/);
    expect(messageCompta(erreur(500), 'repli')).toBe('repli');
  });
});

describe('mise en forme (aucun calcul)', () => {
  it('montants et soldes signés', () => {
    const n = (v: string): string => v.replace(/\s/g, ' ');
    expect(n(formatMontant('1234.5'))).toBe('1 234,50');
    expect(formatMontant(null)).toBe('');
    expect(n(formatSolde('1234.50'))).toBe('1 234,50 D');
    expect(formatSolde('-80.00')).toBe('80,00 C');
    expect(formatSolde('0.00')).toBe('0,00');
    expect(formatSolde(null)).toBe('—');
  });

  it('bornes du mois, années bissextiles comprises', () => {
    expect(bornesDuMois('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(bornesDuMois('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(bornesDuMois('2026-13')).toBeNull();
    expect(bornesDuMois('')).toBeNull();
  });

  it('mois à Kinshasa et libellé', () => {
    expect(moisDe(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11');
    expect(libelleMois(2026, 10)).toBe('octobre 2026');
  });
});
