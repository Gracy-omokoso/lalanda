import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ATTESTATION_INTRO,
  GenerateHrDocumentBody,
  PutGeneratedDocumentSettingsBody,
  generatedDocumentNumber,
  placeholdersOf,
  serviceDuration,
  serviceDurationLabel,
} from './generated-documents.js';

const base = {
  signatory: { name: 'Gracy Exemple', title: 'Directrice générale' },
  place: 'Kinshasa',
  issuedOn: '2026-11-08',
};

describe('ADR-0072 — documents RH générés (contrats)', () => {
  it('numéro de pièce : préfixe, année, quatre chiffres au moins', () => {
    expect(generatedDocumentNumber('attestation', 2026, 1)).toBe('ATT-2026-0001');
    expect(generatedDocumentNumber('certificate', 2026, 12)).toBe('CT-2026-0012');
    expect(generatedDocumentNumber('certificate', 2027, 12345)).toBe('CT-2027-12345');
  });

  it('durée des services, jours de début et de fin inclus', () => {
    expect(serviceDuration('2025-01-05', '2026-01-04')).toEqual({ years: 1, months: 0, days: 0 });
    expect(serviceDuration('2026-01-01', '2026-01-01')).toEqual({ years: 0, months: 0, days: 1 });
    expect(serviceDuration('2023-03-15', '2026-11-07')).toEqual({ years: 3, months: 7, days: 24 });
    expect(serviceDuration('2026-01-31', '2026-03-01')).toEqual({ years: 0, months: 1, days: 2 });
    expect(serviceDurationLabel({ years: 2, months: 3, days: 4 })).toBe('2 ans, 3 mois et 4 jours');
    expect(serviceDurationLabel({ years: 1, months: 0, days: 0 })).toBe('1 an');
    expect(serviceDurationLabel({ years: 0, months: 1, days: 1 })).toBe('1 mois et 1 jour');
  });

  it('champs nommés : connus et inconnus', () => {
    expect(placeholdersOf(DEFAULT_ATTESTATION_INTRO).unknown).toEqual([]);
    expect(placeholdersOf('Bonjour {nom} {salaire}').unknown).toEqual(['salaire']);
  });

  it('réglages : HTML et champ inconnu refusés, vide → texte par défaut', () => {
    const ok = PutGeneratedDocumentSettingsBody.safeParse({
      templateId: 'classique',
      place: '',
      signatory: null,
      attestationIntro: '  ',
      attestationClosing: 'Pour servir et valoir ce que de droit.',
      expectedRevision: 0,
    });
    expect(ok.success).toBe(true);
    expect(ok.data!.attestationIntro).toBeNull();
    expect(ok.data!.place).toBeNull();
    for (const bad of ['<b>{nom}</b>', 'Salaire : {salaire}']) {
      const r = PutGeneratedDocumentSettingsBody.safeParse({
        templateId: 'classique',
        place: null,
        signatory: null,
        attestationIntro: bad,
        attestationClosing: null,
        expectedRevision: 0,
      });
      expect(r.success, bad).toBe(false);
    }
  });

  it('génération : le certificat ne connaît ni motif, ni salaire, ni texte libre', () => {
    expect(GenerateHrDocumentBody.safeParse({ kind: 'certificate', ...base }).success).toBe(true);
    for (const extra of [{ exitReason: 'faute' }, { salary: '1000' }, { intro: 'x' }]) {
      expect(
        GenerateHrDocumentBody.safeParse({ kind: 'certificate', ...base, ...extra }).success,
      ).toBe(false);
    }
    expect(
      GenerateHrDocumentBody.safeParse({
        kind: 'certificate',
        ...base,
        jobs: [{ title: 'Agent', from: '2026-02-01', to: '2026-01-01' }],
      }).success,
    ).toBe(false);
    expect(
      GenerateHrDocumentBody.safeParse({
        kind: 'attestation',
        ...base,
        signatory: { name: '<script>', title: 'DG' },
      }).success,
    ).toBe(false);
  });
});
