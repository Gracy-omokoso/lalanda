// URL signée d'un logo d'organisation (ADR-0028 § 7).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mintAvatarToken } from '../account/avatar-url.js';
import {
  BRAND_ASSET_URL_TTL_SECONDS,
  brandAssetUrlFor,
  mintBrandAssetToken,
  verifyBrandAssetToken,
} from './brand-asset-url.js';

const ID = '0123456789abcdef0123456789abcdef';

describe('jeton de logo', () => {
  let ancien: string | undefined;
  beforeEach(() => {
    ancien = process.env['AUTH_SECRET'];
    process.env['AUTH_SECRET'] = 'secret-de-test-0123456789abcdef-0123456789';
  });
  afterEach(() => {
    process.env['AUTH_SECRET'] = ancien;
  });

  it('authentique et non expiré → identifiant', () => {
    const now = Date.UTC(2026, 9, 21);
    expect(verifyBrandAssetToken(mintBrandAssetToken(ID, now), now + 1000)).toBe(ID);
  });

  it('expiré, altéré, mal formé → null (aucun oracle)', () => {
    const now = Date.UTC(2026, 9, 21);
    const t = mintBrandAssetToken(ID, now);
    expect(verifyBrandAssetToken(t, now + (BRAND_ASSET_URL_TTL_SECONDS + 1) * 1000)).toBeNull();
    expect(verifyBrandAssetToken(`${t}x`, now)).toBeNull();
    expect(verifyBrandAssetToken(t.replace(ID, 'f'.repeat(32)), now)).toBeNull();
    expect(verifyBrandAssetToken('pas-un-jeton', now)).toBeNull();
  });

  it('un jeton d’avatar ne vaut pas jeton de logo (clés distinctes)', () => {
    const now = Date.UTC(2026, 9, 21);
    expect(verifyBrandAssetToken(mintAvatarToken(ID, now), now)).toBeNull();
  });

  it('URL absolue sous /brand-assets/', () => {
    expect(brandAssetUrlFor(ID)).toMatch(/\/brand-assets\/[0-9a-f]{32}\.\d+\.[\w-]+$/);
  });
});
