import { describe, expect, it } from 'vitest';

import {
  duree,
  etatValidationClient,
  libelleFermeture,
  messageExterne,
  minutesDe,
} from './externes-model';

describe('membres externes — logique des écrans (ADR-0078)', () => {
  it('traduit les codes d’erreur connus et laisse passer les autres', () => {
    expect(messageExterne('WORK_EXTERNAL_CUSTOMER_MISMATCH')).toContain('fiche client');
    expect(messageExterne('INCONNU')).toBeNull();
    expect(messageExterne(null)).toBeNull();
  });

  it('nomme le motif de fermeture', () => {
    expect(libelleFermeture('project_archived')).toBe('projet archivé');
    expect(libelleFermeture('n’importe quoi')).toBe('fermé');
    expect(libelleFermeture(null)).toBe('fermé');
  });

  it('donne un ton à chaque état de validation client', () => {
    expect(etatValidationClient('approved').ton).toBe('ok');
    expect(etatValidationClient('pending').ton).toBe('wait');
    expect(etatValidationClient('changes_requested').ton).toBe('late');
    expect(etatValidationClient('none').libelle).toBe('Pas de validation client');
  });

  it('affiche et lit une durée', () => {
    expect(duree(45)).toBe('45 min');
    expect(duree(90)).toBe('1 h 30');
    expect(duree(120)).toBe('2 h');
    expect(minutesDe('1,5')).toBe(90);
    expect(minutesDe('0.25')).toBe(15);
    expect(minutesDe('25')).toBeNull();
    expect(minutesDe('abc')).toBeNull();
    expect(minutesDe('0')).toBeNull();
  });
});
