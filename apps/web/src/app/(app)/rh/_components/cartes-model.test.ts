import { describe, expect, it } from 'vitest';

import type { CardProfileView, CardTemplateSummary } from '@/lib/api-hr-cards';

import {
  basculerSelection,
  messageExport,
  modelesDe,
  phraseConsentement,
  statutPublic,
  urlMasquee,
} from './cartes-model';

const t = (
  id: string,
  kind: 'badge' | 'business',
  o: 'horizontal' | 'vertical',
  source: CardTemplateSummary['source'] = 'lalanda',
): CardTemplateSummary => ({
  id,
  kind,
  orientation: o,
  name: id,
  description: '',
  version: '1.0.0',
  source,
});

const profil = (over: Partial<CardProfileView> = {}): CardProfileView => ({
  employeeId: 'e1',
  photo: null,
  consent: { photo: false, photoPublic: false, at: null, by: null },
  verification: { issued: false, serial: 0, issuedAt: null, url: null, revokedAt: null },
  publicStatus: 'invalid',
  revision: 0,
  ...over,
});

describe('cartes — modèle d’écran', () => {
  it('trie les modèles : Lalanda horizontaux, verticaux, puis sur mesure ; filtre par type', () => {
    const list = modelesDe(
      [
        t('z', 'badge', 'vertical'),
        t('pkg', 'badge', 'horizontal', 'code'),
        t('a', 'badge', 'horizontal'),
        t('v', 'business', 'horizontal'),
      ],
      'badge',
    );
    expect(list.map((x) => x.id)).toEqual(['a', 'z', 'pkg']);
  });

  it('dit le statut public sans jargon', () => {
    expect(statutPublic(profil()).texte).toBe('Aucune carte valide');
    expect(statutPublic(profil({ publicStatus: 'active' })).texte).toContain('En fonction');
    expect(statutPublic(profil({ publicStatus: 'inactive' })).texte).toContain('N’est plus');
  });

  it('distingue l’absence de consentement, la carte seule et la page publique', () => {
    expect(phraseConsentement(profil())).toContain('sans photo');
    const c = { photo: true, photoPublic: false, at: '2026-11-07T10:00:00Z', by: 'u' };
    expect(phraseConsentement(profil({ consent: c }))).toContain('carte seulement');
    expect(phraseConsentement(profil({ consent: { ...c, photoPublic: true } }))).toContain(
      'page de vérification',
    );
  });

  it('masque le jeton dans l’URL affichée', () => {
    expect(urlMasquee('https://lalanda.co/v/AbCdEfGhIjKlMnOpQrStUvWx')).toBe(
      'https://lalanda.co/v/AbCd…Wx',
    );
    expect(urlMasquee(null)).toBeNull();
  });

  it('borne la sélection d’un lot', () => {
    expect(basculerSelection(['a'], 'a')).toEqual([]);
    expect(basculerSelection(['a'], 'b')).toEqual(['a', 'b']);
    expect(basculerSelection(['a', 'b'], 'c', 2)).toEqual(['a', 'b']);
  });

  it('explique un badge non émis', () => {
    expect(
      messageExport({ detail: { code: 'CARD_NOT_ISSUED', message: 'Aucune carte.' } }),
    ).toContain('Émettez');
    expect(messageExport({ status: 503 })).toContain('saturé');
  });
});
