// Client de l'identité visuelle v2 — ADR-0073.
//
// Choix de logo unique, favicon, motifs de fond. Les routes existantes de
// l'identité (logos, couleurs, police — ADR-0028) restent dans `api.ts` ; la vue
// renvoyée est la même, enrichie des champs ci-dessous.

import type {
  BrandPatternSetting,
  FAVICON_LIMITS,
  LogoChoice,
  PATTERN_IMAGE_LIMITS,
  PATTERN_INTENSITY,
  PatternSource,
} from '@lalanda/shared/branding';

import { API_URL, binaryRequest, jsonRequest, type BrandView } from './api';

export type { BrandPatternSetting, LogoChoice, PatternSource };

/** Favicon ou motif téléversé (URL signée, révoquée au remplacement). */
export interface BrandImageView {
  assetId: string;
  url: string;
  width: number;
  height: number;
  byteSize: number;
}

/** `GET /organizations/current/brand`, champs d'ADR-0073 compris. */
export interface BrandViewV2 extends BrandView {
  logoChoice: LogoChoice | null;
  effectiveLogoChoice: LogoChoice;
  logoChoices: { id: LogoChoice; label: string }[];
  favicon: BrandImageView | null;
  patternImage: BrandImageView | null;
  pattern: BrandPatternSetting;
  patterns: { id: string; label: string }[];
  imageLimits: {
    favicon: typeof FAVICON_LIMITS;
    pattern: typeof PATTERN_IMAGE_LIMITS;
    intensity: typeof PATTERN_INTENSITY;
  };
}

const BASE = '/organizations/current/brand';

export const brandApi = {
  get: () => jsonRequest<BrandViewV2>(BASE, { method: 'GET' }),
  putLogoChoice: (logoChoice: LogoChoice | null, expectedRevision: number) =>
    jsonRequest<BrandViewV2>(`${BASE}/logo-choice`, {
      method: 'PUT',
      body: { logoChoice, expectedRevision },
    }),
  putPattern: (p: BrandPatternSetting, expectedRevision: number) =>
    jsonRequest<BrandViewV2>(`${BASE}/pattern`, {
      method: 'PUT',
      body: { ...p, expectedRevision },
    }),
  uploadFavicon: (file: File) => binaryRequest<BrandViewV2>(`${BASE}/favicon`, file),
  removeFavicon: () => jsonRequest<BrandViewV2>(`${BASE}/favicon`, { method: 'DELETE' }),
  uploadPatternImage: (file: File) => binaryRequest<BrandViewV2>(`${BASE}/pattern-image`, file),
  removePatternImage: () => jsonRequest<BrandViewV2>(`${BASE}/pattern-image`, { method: 'DELETE' }),
  /** Favicon de l'organisation active, pour tout membre (`null` : celui de Lalanda). */
  currentFavicon: async (): Promise<string | null> => {
    const r = await jsonRequest<{ url: string | null }>(`/organizations/current/favicon`, {
      method: 'GET',
    });
    return r.url;
  },
};

/** Origine de l'API (les URL signées des images y sont servies). */
export const BRAND_API_ORIGIN = API_URL;
