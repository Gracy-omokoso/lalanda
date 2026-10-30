// CSV v2 du CRM (ADR-0040 — C9) : règles pures des colonnes ajoutées — compte
// (rattachement unique), motif de perte (exigé pour une perdue, sans défaut).

import { describe, expect, it } from 'vitest';

import { lostReasonCell, parseCsv, uniqueMatch, type SheetLostReason } from './crm-csv.js';

const REASONS: SheetLostReason[] = [
  { key: 'price', label: 'Prix', active: true },
  { key: 'competitor', label: 'Concurrent retenu', active: true },
  { key: 'old', label: 'Ancien motif', active: false },
];

describe('CSV v2 — rattachement par nom', () => {
  it('un seul candidat ; aucun → inconnu ; plusieurs → ambigu (nombre)', () => {
    expect(uniqueMatch(['a'])).toEqual({ kind: 'one', value: 'a' });
    expect(uniqueMatch([])).toEqual({ kind: 'none' });
    expect(uniqueMatch(['a', 'b'])).toEqual({ kind: 'many', count: 2 });
  });
});

describe('CSV v2 — motif de perte', () => {
  const cell = (raw: string, stageKind: 'open' | 'won' | 'lost', required = true) =>
    lostReasonCell({ raw, stageKind, required, reasons: REASONS });

  it('perdue sans motif (ancien fichier ADR-0035) : erreur explicite, aucun défaut', () => {
    const r = cell('', 'lost');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/motif de perte obligatoire.*motif_perte/);
  });

  it('perdue sans motif quand les réglages ne l’exigent pas : accepté, motif nul', () => {
    expect(cell('', 'lost', false)).toEqual({ ok: true, key: null });
  });

  it('ouverte ou gagnée sans motif : accepté', () => {
    expect(cell('', 'open')).toEqual({ ok: true, key: null });
    expect(cell('  ', 'won')).toEqual({ ok: true, key: null });
  });

  it('motif par clé ou par libellé (casse et accents ignorés)', () => {
    expect(cell('price', 'lost')).toEqual({ ok: true, key: 'price' });
    expect(cell('PRICE', 'lost')).toEqual({ ok: true, key: 'price' });
    expect(cell('concurrent  RETENU', 'lost')).toEqual({ ok: true, key: 'competitor' });
    expect(cell('prix', 'lost')).toEqual({ ok: true, key: 'price' });
  });

  it('refus : motif inconnu, désactivé, ou porté par une opportunité non perdue', () => {
    expect(cell('meteo', 'lost')).toMatchObject({
      ok: false,
      message: expect.stringMatching(/inconnu/),
    });
    expect(cell('old', 'lost')).toMatchObject({
      ok: false,
      message: expect.stringMatching(/désactivé/),
    });
    expect(cell('price', 'open')).toMatchObject({
      ok: false,
      message: expect.stringMatching(/réservé aux opportunités perdues/),
    });
  });
});

describe('CSV v2 — compatibilité', () => {
  it('un fichier ADR-0035 (sans les colonnes v2) se lit toujours ; colonnes v2 absentes = vides', () => {
    const r = parseCsv(
      'titre;etape;montant;devise;cloture_prevue;prospect;nif_client;email_contact\nA;;;;;Prospect;;\n',
      { required: ['titre'], maxRows: 10 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows[0]!.cells['compte']).toBeUndefined();
      expect(r.rows[0]!.cells['responsable']).toBeUndefined();
    }
  });

  it('en-têtes v2 lisibles écrits à la main (« Motif perte », « Compte »)', () => {
    const r = parseCsv('Titre;Compte;Responsable;Motif perte\nA;Acme;a@b.cd;Prix\n', {
      required: ['titre'],
      maxRows: 10,
    });
    expect(r.ok && r.header).toEqual(['titre', 'compte', 'responsable', 'motif_perte']);
  });
});
