import { describe, expect, it } from 'vitest';

import type { InvoiceTemplateCatalogEntry, InvoiceTemplatesView } from '@/lib/api';

import {
  choisirModele,
  cleApercu,
  estModifiee,
  optionsAffichees,
  selectionInitiale,
  versEnvoi,
} from './template-model';

const entree = (
  id: InvoiceTemplateCatalogEntry['id'],
  fonts: string[],
  defaults: InvoiceTemplateCatalogEntry['defaults'],
): InvoiceTemplateCatalogEntry => ({
  id,
  version: '1.0.0',
  label: id,
  description: '',
  defaults,
  palettes: ['brand', 'mono'],
  fonts: fonts.map((f) => ({ id: f, label: f })),
  accentSuggestions: [],
});

const BANDEAU = entree('bandeau', ['manrope', 'inter', 'ibm-plex-sans', 'source-serif-4'], {
  palette: 'brand',
  accent: '#1d4ed8',
  font: 'manrope',
});
const EDITO = entree('editoriale', ['fraunces+inter', 'source-serif-4+manrope'], {
  palette: 'brand',
  accent: '#7f1d1d',
  font: 'fraunces+inter',
});

const vue = (current: InvoiceTemplatesView['current']): InvoiceTemplatesView => ({
  templates: [BANDEAU, EDITO],
  current,
  identity: {
    primaryColor: '#0f5132',
    secondaryColor: null,
    font: 'inter',
    logos: { primary: true, horizontal: false, symbol: false, light: false },
  },
  revision: 4,
});

describe('choix du modèle de facture', () => {
  it('sans modèle choisi : présentation d’origine', () => {
    const v = vue(null);
    expect(selectionInitiale(v)).toEqual({
      templateId: null,
      palette: null,
      accent: null,
      font: null,
    });
    expect(versEnvoi(selectionInitiale(v), 4)).toEqual({
      templateId: null,
      options: { palette: null, accent: null, font: null },
      expectedRevision: 4,
    });
  });

  it('options affichées : saisie, puis identité, puis défaut du modèle', () => {
    const v = vue(null);
    const sel = choisirModele(v, 'bandeau');
    expect(optionsAffichees(sel, BANDEAU, v.identity)).toEqual({
      palette: 'brand',
      accent: '#0f5132',
      font: 'inter',
    });
    // Éditoriale : la police de l'identité n'est pas une paire → défaut.
    expect(optionsAffichees(choisirModele(v, 'editoriale'), EDITO, v.identity).font).toBe(
      'fraunces+inter',
    );
    expect(
      optionsAffichees(
        { ...sel, palette: 'mono', accent: '#abcdef', font: 'manrope' },
        BANDEAU,
        v.identity,
      ),
    ).toEqual({ palette: 'mono', accent: '#abcdef', font: 'manrope' });
  });

  it('changer de modèle remet les options à « suivre », revenir restaure la saisie', () => {
    const v = vue({
      templateId: 'bandeau',
      version: '1.0.0',
      options: { palette: 'mono', accent: null, font: 'manrope' },
      resolved: { palette: 'mono', accent: '#0f5132', font: 'manrope' },
    });
    expect(choisirModele(v, 'editoriale')).toEqual({
      templateId: 'editoriale',
      palette: null,
      accent: null,
      font: null,
    });
    expect(choisirModele(v, 'bandeau')).toEqual(selectionInitiale(v));
    expect(estModifiee(selectionInitiale(v), v)).toBe(false);
    expect(estModifiee(choisirModele(v, 'editoriale'), v)).toBe(true);
  });

  it('clé d’aperçu stable', () => {
    expect(cleApercu('bandeau', { palette: 'mono' })).toBe('bandeau|mono||');
  });
});
