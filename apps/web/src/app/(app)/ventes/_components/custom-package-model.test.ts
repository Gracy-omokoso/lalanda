import { describe, expect, it } from 'vitest';

import type { TemplatePackageView } from '@/lib/api';

import {
  SELECTION_VIDE,
  compareVersionsDesc,
  ligneProbleme,
  optionsPaquet,
  rapportDeRefus,
  regrouperParModele,
  taille,
} from './custom-package-model';

const paquet = (over: Partial<TemplatePackageView> = {}): TemplatePackageView => ({
  packageId: 'a'.repeat(32),
  templateId: 'atelier.ocre',
  version: '1.0.0',
  name: 'Ocre',
  description: 'd',
  contentSha256: 'f'.repeat(64),
  byteSize: 2048,
  author: { name: 'Atelier' },
  publisher: null,
  license: 'MIT',
  options: {
    palettes: ['brand', 'mono'],
    accent: '#9a3412',
    fonts: [
      { id: 'inter', label: 'Inter' },
      { id: 'source-serif-4', label: 'Source Serif 4' },
    ],
    font: 'inter',
  },
  installedAt: '2026-10-21T10:00:00.000Z',
  active: false,
  ...over,
});

describe('modèles sur mesure — logique d’affichage', () => {
  it('trie les versions SemVer de la plus récente à la plus ancienne (10 > 9)', () => {
    expect(['1.0.0', '1.10.0', '1.9.3', '2.0.0'].sort(compareVersionsDesc)).toEqual([
      '2.0.0',
      '1.10.0',
      '1.9.3',
      '1.0.0',
    ]);
  });

  it('regroupe par modèle', () => {
    const g = regrouperParModele([
      paquet({ version: '1.0.0' }),
      paquet({ version: '1.0.1', packageId: 'b'.repeat(32) }),
      paquet({ templateId: 'autre.azur', name: 'Azur' }),
    ]);
    expect(g.map((x) => x.name)).toEqual(['Azur', 'Ocre']);
    expect(g[1]!.versions.map((v) => v.version)).toEqual(['1.0.1', '1.0.0']);
  });

  it('options affichées : saisie, puis marque, puis manifeste ; police hors liste ignorée', () => {
    const p = paquet();
    expect(optionsPaquet(p, SELECTION_VIDE, { primaryColor: null, font: null })).toEqual({
      palette: 'brand',
      accent: '#9a3412',
      font: 'inter',
    });
    expect(
      optionsPaquet(
        p,
        { palette: 'mono', accent: null, font: 'manrope' },
        {
          primaryColor: '#0f5132',
          font: 'source-serif-4',
        },
      ),
    ).toEqual({ palette: 'mono', accent: '#0f5132', font: 'source-serif-4' });
    const monoSeul = paquet({ options: { ...p.options, palettes: ['mono'] } });
    expect(
      optionsPaquet(monoSeul, SELECTION_VIDE, { primaryColor: null, font: null }).palette,
    ).toBe('mono');
  });

  it('rapport de refus et lignes lisibles', () => {
    const err = Object.assign(new Error('x'), {
      status: 422,
      detail: {
        code: 'TEMPLATE_PACKAGE_INVALID',
        details: {
          report: {
            ok: false,
            errors: [
              {
                code: 'TEMPLATE_TAG_FORBIDDEN',
                message: 'Balise <script> interdite.',
                file: 'gabarit.html',
                line: 12,
                column: 5,
              },
            ],
            warnings: [],
            truncated: false,
            digest: null,
            manifest: null,
            files: [],
            cases: [],
          },
        },
      },
    });
    const r = rapportDeRefus(err)!;
    expect(ligneProbleme(r.errors[0]!)).toBe(
      'gabarit.html:12:5 — Balise <script> interdite. (TEMPLATE_TAG_FORBIDDEN)',
    );
    expect(
      ligneProbleme({ code: 'TEMPLATE_MENTION_MISSING', message: 'Total absent.', case: 'avoir' }),
    ).toBe('Total absent. (TEMPLATE_MENTION_MISSING) [cas : avoir]');
    expect(rapportDeRefus(new Error('réseau'))).toBeNull();
  });

  it('taille lisible', () => {
    expect(taille(512)).toBe('512 o');
    expect(taille(20_480)).toBe('20 Kio');
    expect(taille(3 * 1024 * 1024)).toBe('3,0 Mio');
  });
});
