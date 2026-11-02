import { describe, expect, it } from 'vitest';

import { findForbiddenPlatformFinanceWords } from '@lalanda/shared/platform';

import {
  echeanceDepuisSaisie,
  formaterMontant,
  identifiantOrganisationValide,
  libelleStatutAbonnement,
  libelleStatutPaiement,
  octroiDemandeSecondePersonne,
  offresOctroyables,
  phaseOctroi,
  resultatOctroi,
  STATUTS_ABONNEMENT,
  STATUTS_PAIEMENT,
  tonStatutAbonnement,
} from './abonnements-model';

const NOW = new Date('2026-11-02T10:00:00.000Z');
const dans = (jours: number) => new Date(NOW.getTime() + jours * 86_400_000).toISOString();

describe('ADR-0053 — P3 : seconde personne annoncée avant le geste', () => {
  it('Expert, sans échéance ou au-delà de 90 jours : seconde personne', () => {
    expect(octroiDemandeSecondePersonne('expert', dans(10), NOW)).toBe(true);
    expect(octroiDemandeSecondePersonne('pro', null, NOW)).toBe(true);
    expect(octroiDemandeSecondePersonne('pro', dans(91), NOW)).toBe(true);
  });

  it('court, hors Expert : actif tout de suite', () => {
    expect(octroiDemandeSecondePersonne('pro', dans(30), NOW)).toBe(false);
    expect(octroiDemandeSecondePersonne('business', dans(90), NOW)).toBe(false);
  });
});

describe('ADR-0053 — P3 : saisies', () => {
  it('échéance AAAA-MM-JJ → fin de journée UTC', () => {
    expect(echeanceDepuisSaisie('2026-12-31')).toBe('2026-12-31T23:59:59.000Z');
    expect(echeanceDepuisSaisie('31/12/2026')).toBeNull();
    expect(echeanceDepuisSaisie('')).toBeNull();
  });

  it('identifiant d’organisation : 24 hexadécimaux', () => {
    expect(identifiantOrganisationValide('0123456789abcdef01234567')).toBe(true);
    expect(identifiantOrganisationValide('org-acme')).toBe(false);
  });

  it('`free` n’est pas une offre octroyable', () => {
    expect(offresOctroyables(['free', 'pro', 'cabinet', 'business', 'expert'])).toEqual([
      'pro',
      'cabinet',
      'business',
      'expert',
    ]);
  });
});

describe('ADR-0053 — P3 : libellés', () => {
  it('montant dû en unités, devise sans conversion', () => {
    expect(formaterMontant(900, 'USD').replace(/\s/g, ' ')).toBe('9,00 USD');
  });

  it('l’impayé n’est pas la suspension administrative', () => {
    expect(libelleStatutAbonnement('suspended')).toBe('Suspendu (impayé)');
    expect(tonStatutAbonnement('suspended')).toBe('echec');
    expect(libelleStatutPaiement('pending')).toBe('En attente');
  });

  it('octroi : phase et résultat lisibles', () => {
    expect(phaseOctroi('pending_approval').ton).toBe('attention');
    expect(resultatOctroi('pending_approval', false)).toContain('seconde personne');
    expect(resultatOctroi('active', true)).toContain('seul détenteur');
  });

  it('aucun mot réservé aux pièces fiscales (§ 6.8)', () => {
    const textes = [
      ...STATUTS_ABONNEMENT.map((s) => s.libelle),
      ...STATUTS_PAIEMENT.map((s) => s.libelle),
      resultatOctroi('active', false),
      resultatOctroi('pending_approval', false),
      formaterMontant(1234, 'USD'),
    ];
    for (const t of textes) expect(findForbiddenPlatformFinanceWords(t), t).toEqual([]);
  });
});
