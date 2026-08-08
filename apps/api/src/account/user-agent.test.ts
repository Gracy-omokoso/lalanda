import { describe, expect, it } from 'vitest';

import { describeUserAgent } from './user-agent.js';

describe('describeUserAgent (S20b)', () => {
  it('reconnaît Chrome sur macOS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    expect(describeUserAgent(ua)).toEqual({
      browser: 'Chrome',
      os: 'macOS',
      label: 'Chrome sur macOS',
    });
  });

  it('reconnaît Firefox sur Windows', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';
    expect(describeUserAgent(ua).label).toBe('Firefox sur Windows');
  });

  it('reconnaît Safari sur iOS', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
    expect(describeUserAgent(ua)).toMatchObject({ browser: 'Safari', os: 'iOS' });
  });

  it('distingue Edge de Chrome — son UA contient « Chrome »', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
    expect(describeUserAgent(ua).browser).toBe('Edge');
  });

  it('distingue Opera de Chrome — même piège', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 OPR/114.0.0.0';
    expect(describeUserAgent(ua).browser).toBe('Opera');
  });

  it('classe un iPad en iPadOS malgré son UA « Macintosh »', () => {
    // Depuis iPadOS 13, Safari sur iPad s'annonce comme un Mac de bureau.
    const ua =
      'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/604.1';
    expect(describeUserAgent(ua).os).toBe('iPadOS');
  });

  it('classe Chrome Android sans le confondre avec Linux', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
    expect(describeUserAgent(ua)).toMatchObject({ browser: 'Chrome', os: 'Android' });
  });

  it('renvoie un libellé neutre pour un UA vide, absent ou non reconnu', () => {
    // better-auth enregistre une chaîne vide pour les sessions créées hors navigateur.
    for (const value of ['', '   ', null, undefined, 'curl/8.7.1']) {
      expect(describeUserAgent(value)).toEqual({
        browser: null,
        os: null,
        label: 'Appareil inconnu',
      });
    }
  });

  it('ne renvoie jamais un libellé vide', () => {
    for (const value of ['x', 'Mozilla/5.0', 'Windows NT 10.0']) {
      expect(describeUserAgent(value).label.length).toBeGreaterThan(0);
    }
  });
});
