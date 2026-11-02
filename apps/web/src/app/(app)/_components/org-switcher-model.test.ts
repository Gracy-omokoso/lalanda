// ADR-0052 — O1 : création d'organisation et sélecteur.

import { describe, expect, it } from 'vitest';

import type { OrganizationView } from '@/lib/api';

import {
  AVERTISSEMENT_PAYS_HORS_RDC,
  DESTINATION_APRES_CREATION,
  FORMULAIRE_CREATION_VIDE,
  PAYS_CREATION,
  avertissementPays,
  cookieARectifier,
  detailOrganisation,
  libelleAvancement,
  organisationAffichee,
  validerCreation,
} from './org-switcher-model';

const org = (id: string, roleLabel = 'Propriétaire'): OrganizationView => ({
  id,
  name: id.toUpperCase(),
  slug: id,
  type: 'solo',
  pays: 'CD',
  role: 'owner',
  roleLabel,
  canClosePeriods: false,
});

describe('fenêtre de création (ADR-0052 § 5, critère 10)', () => {
  it('propose la RDC par défaut et n’avertit pas pour CD', () => {
    expect(FORMULAIRE_CREATION_VIDE.pays).toBe('CD');
    expect(PAYS_CREATION[0]?.code).toBe('CD');
    expect(avertissementPays('CD')).toBeNull();
    expect(avertissementPays('cd')).toBeNull();
  });

  it('avertit sur la facture normalisée hors RDC', () => {
    expect(avertissementPays('CG')).toBe(AVERTISSEMENT_PAYS_HORS_RDC);
  });

  it('envoie name, pays et type', () => {
    expect(validerCreation({ nom: '  Kin Agro ', pays: 'cg', type: 'agence' })).toEqual({
      ok: true,
      corps: { name: 'Kin Agro', pays: 'CG', type: 'agence' },
    });
  });

  it('refuse un nom vide, trop long, un pays ou un type invalide', () => {
    expect(validerCreation({ ...FORMULAIRE_CREATION_VIDE, nom: '  ' }).ok).toBe(false);
    expect(validerCreation({ ...FORMULAIRE_CREATION_VIDE, nom: 'x'.repeat(101) }).ok).toBe(false);
    expect(validerCreation({ nom: 'A', pays: 'C', type: 'solo' }).ok).toBe(false);
    expect(validerCreation({ nom: 'A', pays: 'CD', type: 'autre' as unknown as 'solo' }).ok).toBe(
      false,
    );
  });

  it('mène à la mise en route, étape Société', () => {
    expect(DESTINATION_APRES_CREATION).toBe('/organisation/mise-en-route?etape=societe');
  });
});

describe('sélecteur (F2, critère 13)', () => {
  it('affiche l’organisation servie par l’API, pas la première appartenance', () => {
    const orgs = [org('ancienne-b'), org('recente-a')];
    expect(organisationAffichee(orgs, 'recente-a')?.id).toBe('recente-a');
    expect(organisationAffichee(orgs, undefined)?.id).toBe('ancienne-b');
    expect(organisationAffichee([], 'x')).toBeUndefined();
  });

  it('repose le cookie quand il manque ou diffère de l’organisation servie', () => {
    expect(cookieARectifier(undefined, 'a')).toBe(true);
    expect(cookieARectifier('b', 'a')).toBe(true);
    expect(cookieARectifier('a', 'a')).toBe(false);
    expect(cookieARectifier(undefined, undefined)).toBe(false);
  });

  it('dit le rôle et l’avancement de la mise en route', () => {
    const p = { organizationId: 'a', done: 3, deferred: 1, total: 9 };
    expect(libelleAvancement(p)).toBe('Mise en route : 3 étapes sur 9');
    expect(libelleAvancement({ ...p, done: 1, deferred: 0 })).toBe('Mise en route : 1 étape sur 9');
    expect(libelleAvancement({ ...p, done: 7, deferred: 2 })).toBe('Mise en route terminée');
    expect(libelleAvancement(undefined)).toBeNull();
    expect(detailOrganisation(org('a', 'Lecteur'), p)).toBe(
      'Lecteur · Mise en route : 3 étapes sur 9',
    );
    expect(detailOrganisation(org('a', 'Lecteur'), undefined)).toBe('Lecteur');
  });
});
