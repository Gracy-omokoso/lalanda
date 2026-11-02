import { describe, expect, it } from 'vitest';

import { AudienceFilterSchema } from '@lalanda/shared/platform';

import {
  audienceDepuisSaisie,
  erreursBrouillon,
  finDepuisSaisie,
  LIBELLES_ROLES_ORG,
  messageErreurAnnonces,
  nombreRetapeValide,
  paysSaisis,
  resumeAudience,
  ROLES_ORG,
  SAISIE_AUDIENCE_VIDE,
  saisieDepuisAudience,
  statutAnnonce,
} from './annonces-model';

const MAINTENANT = new Date('2026-11-02T10:00:00.000Z');

describe('catégorie de destinataires (ADR-0053 § 6.6)', () => {
  it('saisie vide → « tous les comptes actifs », filtre vide', () => {
    expect(audienceDepuisSaisie(SAISIE_AUDIENCE_VIDE)).toEqual({});
    expect(resumeAudience({})).toBe('Tous les comptes actifs');
  });

  it('Propriétaires `pro` au Congo : filtre accepté par le schéma partagé, aller-retour fidèle', () => {
    const saisie = {
      ...SAISIE_AUDIENCE_VIDE,
      proprietairesSeulement: true,
      offres: ['pro' as const],
      pays: 'cd, CD ',
      inscritsApres: '2026-01-01',
    };
    const filtre = audienceDepuisSaisie(saisie);
    expect(filtre).toEqual({
      ownersOnly: true,
      plans: ['pro'],
      countries: ['CD'],
      signedUpAfter: '2026-01-01T00:00:00.000Z',
    });
    expect(AudienceFilterSchema.safeParse(filtre).success).toBe(true);
    expect(saisieDepuisAudience(filtre)).toMatchObject({
      proprietairesSeulement: true,
      offres: ['pro'],
      pays: 'CD',
      inscritsApres: '2026-01-01',
    });
    expect(resumeAudience(filtre)).toContain('Propriétaires');
    expect(resumeAudience(filtre)).toContain('pays CD');
  });

  it('pays invalide → signalé', () => {
    expect(paysSaisis('RDC')).toBeNull();
    expect(paysSaisis('')).toEqual([]);
  });

  it('chaque rôle d’organisation a un libellé', () => {
    for (const r of ROLES_ORG) expect(LIBELLES_ROLES_ORG[r].length).toBeGreaterThan(2);
  });
});

describe('brouillon, envoi et erreurs', () => {
  it('titre, texte et date de fin future exigés', () => {
    expect(
      erreursBrouillon({
        titre: '',
        texte: '',
        saisie: SAISIE_AUDIENCE_VIDE,
        fin: '2020-01-01',
        maintenant: MAINTENANT,
      }),
    ).toHaveLength(3);
    expect(
      erreursBrouillon({
        titre: 'T',
        texte: 'Corps',
        saisie: SAISIE_AUDIENCE_VIDE,
        fin: '',
        maintenant: MAINTENANT,
      }),
    ).toEqual([]);
    expect(finDepuisSaisie('2026-12-01')).toBe('2026-12-01T23:59:59.000Z');
    expect(finDepuisSaisie('')).toBeUndefined();
  });

  it('le nombre retapé doit égaler le nombre approuvé', () => {
    expect(nombreRetapeValide('12', 12)).toBe(true);
    expect(nombreRetapeValide(' 12 ', 12)).toBe(true);
    expect(nombreRetapeValide('13', 12)).toBe(false);
    expect(nombreRetapeValide('douze', 12)).toBe(false);
    expect(nombreRetapeValide('12', null)).toBe(false);
  });

  it('statuts et codes métier traduits', () => {
    expect(statutAnnonce('pending_approval').ton).toBe('attention');
    expect(statutAnnonce('sent').libelle).toBe('Envoyée');
    const err = Object.assign(new Error('x'), {
      status: 409,
      detail: { code: 'SELF_APPROVAL_FORBIDDEN' },
    });
    expect(messageErreurAnnonces(err, 'repli')).toContain('autre personne');
  });
});
