// Bibliothèque (ADR-0046 § 4, § 5.3) : droits, types de fichier, dépôt sans rien dans
// l'URL, recherche en corps, liens vers les entités selon la lecture du module.

import { describe, expect, it } from 'vitest';

import {
  badgeExpiration,
  corpsRecherche,
  entitesLiables,
  formulaireDepot,
  lienEntite,
  lireEtiquettes,
  messageDocuments,
  peutDeposer,
  preparerDepot,
  titreDepuisFichier,
  validerFichier,
  FILTRES_VIDES,
  PHRASE_TYPES,
} from './documents-model';
import { dossier } from './fixtures.test-utils';

const pdf = { type: 'application/pdf', size: 1000, name: 'attestation.pdf' };

describe('droits', () => {
  it('dépôt : docs.manage ou un dossier ouvert en écriture', () => {
    expect(peutDeposer(['docs.read', 'docs.manage'], [])).toBe(true);
    expect(peutDeposer(['docs.read'], [dossier({ id: 'f1' })])).toBe(false);
    expect(peutDeposer(['docs.read'], [dossier({ id: 'f1', canWrite: true })])).toBe(true);
    expect(peutDeposer(null, [dossier({ id: 'f1', canWrite: true })])).toBe(false);
  });

  it('entités liables et liens selon la lecture du module', () => {
    expect(entitesLiables(['purchase.read', 'assets.read'])).toEqual(['supplier', 'asset']);
    expect(lienEntite({ entityType: 'supplier', entityId: 's1' }, ['purchase.read'])).toBe(
      '/achats/fournisseurs/s1',
    );
    expect(lienEntite({ entityType: 'supplier', entityId: 's1' }, ['sales.read'])).toBeNull();
    expect(lienEntite({ entityType: 'customer', entityId: 'c1' }, ['sales.read'])).toBe(
      '/ventes/clients?fiche=c1',
    );
  });
});

describe('fichiers', () => {
  it('seuls les PDF et les images, avec un message clair', () => {
    expect(validerFichier(pdf)).toBeNull();
    expect(validerFichier({ type: 'image/webp', size: 10, name: 'a.webp' })).toBeNull();
    const word = validerFichier({
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 10,
      name: 'statuts.docx',
    });
    expect(word).toContain('« statuts.docx » n’est pas accepté.');
    expect(word).toContain(PHRASE_TYPES);
    expect(validerFichier({ type: 'image/png', size: 3 * 1024 * 1024, name: 'p.png' })).toMatch(
      /trop lourd/,
    );
    expect(validerFichier(null)).toBe('Choisissez un fichier.');
  });

  it('refus 415 de l’API traduit', () => {
    expect(messageDocuments({ status: 415, detail: { code: 'DOCUMENT_TYPE' } }, 'x')).toMatch(
      /PDF/,
    );
    expect(messageDocuments({ status: 404, detail: {} }, 'x')).toMatch(/invisible/);
  });
});

describe('dépôt', () => {
  it('métadonnées complètes, étiquettes normalisées', () => {
    const f = {
      ...formulaireDepot('f1', [{ entityType: 'supplier' as const, entityId: 's1', label: 'X' }]),
      title: ' Attestation fiscale ',
      tags: 'Fiscal, 2026, fiscal',
      expiresOn: '2027-03-31',
      reminderDays: '45',
    };
    const p = preparerDepot(f, pdf, false);
    expect(p).toEqual({
      ok: true,
      meta: {
        title: 'Attestation fiscale',
        folderId: 'f1',
        nature: 'other',
        tags: ['fiscal', '2026'],
        links: [{ entityType: 'supplier', entityId: 's1' }],
        issuedOn: null,
        expiresOn: '2027-03-31',
        reminderDays: 45,
        sensitive: false,
        note: null,
      },
    });
  });

  it('sans dossier : lié et gestionnaire ; sensible : gestionnaire', () => {
    const base = { ...formulaireDepot(''), title: 'T' };
    const p = preparerDepot(base, pdf, true);
    expect(!p.ok && p.champs['folderId']).toMatch(/au moins un élément/);
    const q = preparerDepot({ ...base, folderId: 'f1', sensitive: true }, pdf, false);
    expect(!q.ok && q.champs['sensitive']).toBeTruthy();
    const r = preparerDepot(
      { ...base, folderId: 'f1', issuedOn: '2026-05-01', expiresOn: '2026-01-01' },
      pdf,
      true,
    );
    expect(!r.ok && r.champs['expiresOn']).toMatch(/précède/);
  });

  it('étiquettes bornées, titre depuis le fichier', () => {
    expect(lireEtiquettes('a'.repeat(41)).ok).toBe(false);
    expect(lireEtiquettes(Array.from({ length: 11 }, (_, i) => `t${i}`).join(',')).ok).toBe(false);
    expect(titreDepuisFichier('attestation_fiscale-2026.pdf')).toBe('attestation fiscale 2026');
  });
});

describe('recherche en corps', () => {
  it('aucun critère : liste par dossier', () => {
    expect(corpsRecherche(FILTRES_VIDES, 'f1')).toBeNull();
  });
  it('critères dans le corps, dossier courant compris', () => {
    expect(
      corpsRecherche({ texte: ' bail ', etiquette: 'Gombe', nature: 'contract' }, 'f1'),
    ).toEqual({ text: 'bail', tags: ['gombe'], nature: 'contract', folderId: 'f1', limit: 50 });
  });
});

describe('expiration', () => {
  const j = (s: string | null) => s ?? '—';
  it('badge selon le statut servi par l’API', () => {
    expect(badgeExpiration('expired', '2026-01-01', j)).toEqual({
      texte: 'Expiré le 2026-01-01',
      ton: 'danger',
    });
    expect(badgeExpiration(null, null, j)).toBeNull();
  });
});
