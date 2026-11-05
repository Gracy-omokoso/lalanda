import { CARD_COLORS } from '@lalanda/ui';
import { WORK_CARD_COLORS } from '@lalanda/shared/work';
import { describe, expect, it } from 'vitest';

import { estCouleurCarte, numeroVisible, styleCarte, stylePastille } from './cartes-model';

describe('couleur des cartes (ADR-0061 § 4)', () => {
  it('la palette partagée et les jetons du design system ont les mêmes clés', () => {
    expect([...WORK_CARD_COLORS]).toEqual([...CARD_COLORS]);
  });

  it('sans couleur : affichage actuel (aucun style)', () => {
    expect(styleCarte(null)).toBeUndefined();
    expect(styleCarte(undefined)).toBeUndefined();
    expect(stylePastille(null)).toBeUndefined();
  });

  it('couleur hors palette : ignorée (jamais un code libre)', () => {
    expect(estCouleurCarte('#ff0000')).toBe(false);
    expect(styleCarte('red')).toBeUndefined();
  });

  it('couleur de la palette : fond et liseré par jetons', () => {
    const s = styleCarte('yellow')!;
    expect(s.background).toBe('var(--card-yellow-bg)');
    expect(String(s.boxShadow)).toContain('var(--card-yellow-dot)');
    expect(stylePastille('teal')).toEqual({ background: 'var(--card-teal-dot)' });
  });
});

describe('numéros de tâche (ADR-0061 § 3, `showTaskNumbers`)', () => {
  it('affichés par défaut, masqués si le réglage le dit', () => {
    expect(numeroVisible(12, true)).toBe('#12');
    expect(numeroVisible(12, undefined)).toBe('#12');
    expect(numeroVisible(12, false)).toBeNull();
  });
});
