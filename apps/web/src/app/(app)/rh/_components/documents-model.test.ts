// Documents RH (ADR-0045 § 2.8) — lot H7.
import { describe, expect, it } from 'vitest';

import {
  categoriesProposees,
  changerCategorie,
  formDocument,
  libelleExpiration,
  libelleTaille,
  peutSupprimerDocument,
  validerDocument,
} from './documents-model';

const pdf = { name: 'contrat.pdf', size: 200_000, type: 'application/pdf' };

describe('catégories et droits', () => {
  it('sensibles seulement avec hr.sensitive.read ; justificatif pour soi', () => {
    expect(categoriesProposees(['hr.manage', 'hr.sensitive.read'], false)).toContain('medical');
    expect(categoriesProposees(['hr.manage'], false)).not.toContain('id_document');
    expect(categoriesProposees(['leave.request'], true)).toEqual(['leave_justification']);
    expect(categoriesProposees(['hr.read'], false)).toEqual([]);
  });

  it('supprimer une pièce sensible exige hr.sensitive.read', () => {
    expect(peutSupprimerDocument(['hr.manage'], { sensitive: true })).toBe(false);
    expect(peutSupprimerDocument(['hr.manage'], { sensitive: false })).toBe(true);
  });
});

describe('formulaire', () => {
  it('une pièce d’identité est toujours sensible et non visible par défaut', () => {
    const f = changerCategorie(formDocument('contract'), 'id_document');
    expect(f.sensitive).toBe(true);
    expect(f.visibleToEmployee).toBe(false);
    expect(formDocument('contract').visibleToEmployee).toBe(true);
  });

  it('valide fichier, type, taille et dates', () => {
    const toutes = categoriesProposees(['hr.manage', 'hr.sensitive.read'], false);
    const f = { ...formDocument('contract'), label: 'Contrat CDI' };
    const ok = validerDocument(f, pdf, toutes);
    expect(ok).toMatchObject({ ok: true, meta: { category: 'contract', sensitive: false } });
    expect(validerDocument(f, null, toutes).ok).toBe(false);
    expect(
      validerDocument(f, { name: 'x.docx', size: 10, type: 'application/msword' }, toutes),
    ).toMatchObject({ ok: false });
    const lourd = validerDocument(
      f,
      { name: 'a.png', size: 3 * 1024 * 1024, type: 'image/png' },
      toutes,
    );
    expect(lourd.ok ? '' : lourd.erreurs.join(' ')).toMatch(/2 Mo/);
    const dates = validerDocument(
      { ...f, issuedOn: '2026-05-01', expiresOn: '2026-04-01' },
      pdf,
      toutes,
    );
    expect(dates.ok ? '' : dates.erreurs.join(' ')).toMatch(/expiration précède/);
  });

  it('refuse une catégorie que le rôle ne peut pas déposer', () => {
    const f = { ...formDocument('medical'), label: 'Certificat' };
    expect(validerDocument(f, pdf, ['contract']).ok).toBe(false);
  });
});

describe('liste', () => {
  it('taille et expiration mises en forme', () => {
    expect(libelleTaille(820 * 1024)).toBe('820 Ko');
    expect(libelleTaille(1.5 * 1024 * 1024)).toBe('1,5 Mo');
    expect(libelleExpiration('2026-10-01', '2026-10-30')).toEqual({
      texte: 'Expiré le 1 oct. 2026',
      expire: true,
    });
    expect(libelleExpiration(null, '2026-10-30')).toBeNull();
  });
});
