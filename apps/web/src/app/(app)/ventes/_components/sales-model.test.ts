// Espace Ventes — ADR-0022, chantier D2.
//
// Ce que ces tests protègent : les règles qu'on casse sans que rien ne le
// signale au typecheck — un champ exigé par la DGI oublié pour un type de
// client, un montant passé par `Number()` qui perd un centime, un type
// d'article proposé dans un groupe qui le refuse, une suppression offerte pour
// une fiche déjà facturée.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { salesQuery, type CatalogItemView, type CustomerView, type TaxGroupList } from '@/lib/api';

import {
  actionsLigne,
  appliquerGroupe,
  bandeauGroupes,
  CATALOG_CURRENCIES,
  type CatalogItemDisplay,
  codeDgiApercu,
  codeReserve,
  corpsContrat,
  CURRENCY_LABELS,
  CUSTOMER_TYPES,
  CHEMINS_ARTICLE,
  erreursFormulaire,
  estRevisionPerimee,
  ficheDepuisParametre,
  ficheExistante,
  formatMontant,
  formatTaux,
  formulaireArticle,
  formulaireClient,
  fusionnerPage,
  libelleGroupe,
  libelleNom,
  libellePrix,
  libelleTaxeSpecifique,
  lireMontantSaisi,
  lireTauxSaisi,
  messageVentes,
  montantPourSaisie,
  ongletsVentes,
  OUT_OF_SCOPE_ITEM_CODE,
  peutConsulter,
  peutGerer,
  preparerArticle,
  preparerClient,
  remplacerDansListe,
  requeteArticles,
  requeteClients,
  requiredFieldsFor,
  segmentVentes,
  taxeSpecifiqueAdmise,
  typesAdmis,
  type FormulaireArticle,
  type FormulaireClient,
} from './sales-model';

const NNBSP = ' ';
const NBSP = ' ';

/** Erreur telle que `jsonRequest` la lève. */
function erreurApi(status: number, detail: unknown): Error & { status: number; detail: unknown } {
  const e = new Error(
    typeof detail === 'object' && detail !== null && 'message' in detail
      ? String((detail as { message: unknown }).message)
      : `HTTP ${status}`,
  ) as Error & { status: number; detail: unknown };
  e.status = status;
  e.detail = detail;
  return e;
}

/** Liste de groupes simulée, au format du contrat § S25c.5. */
const GROUPES_DGI: TaxGroupList = {
  source: 'dgi_snapshot',
  environment: 'test',
  fetchedAt: '2026-10-20T09:00:00.000Z',
  sha256: '9f2c',
  groups: [
    {
      letter: 'A',
      label: 'Exonéré et hors champ',
      ratePercent: '0',
      itemTypes: ['BIE', 'SER'],
      outOfScopeAllowed: true,
    },
    {
      letter: 'B',
      label: 'Taxable 16 %',
      ratePercent: '16',
      itemTypes: ['BIE', 'SER'],
      outOfScopeAllowed: false,
    },
    {
      letter: 'L',
      label: 'Prélèvements sur ventes',
      ratePercent: '0',
      itemTypes: ['TAX'],
      outOfScopeAllowed: false,
    },
    {
      letter: 'N',
      label: 'TVA spécifique',
      ratePercent: '0',
      itemTypes: ['TAX'],
      outOfScopeAllowed: false,
    },
  ],
};

const GROUPES_DEFAUT: TaxGroupList = {
  ...GROUPES_DGI,
  source: 'default',
  fetchedAt: null,
  sha256: null,
  groups: GROUPES_DGI.groups.map((g) => ({ ...g, ratePercent: null })),
};

const CLIENT: CustomerView = {
  id: '6713a0c4e1a2b3c4d5e6f701',
  type: 'PM',
  typeLabel: 'Personne morale',
  name: 'Exemple SARL',
  nif: 'A0000000X',
  exemptionReference: null,
  phone: '+243 800 000 000',
  email: 'compta@exemple.cd',
  address: '1, avenue Exemple, Gombe, Kinshasa',
  active: true,
  deactivatedAt: null,
  invoiced: false,
  revision: 1,
  createdAt: '2026-10-20T09:00:00.000Z',
  updatedAt: '2026-10-20T09:00:00.000Z',
};

const ARTICLE: CatalogItemView = {
  id: '6713a0c4e1a2b3c4d5e6f702',
  code: 'LAIT-1L',
  edefCode: 'LAIT-1L',
  name: 'Lait demi-écrémé 1 L',
  itemType: 'BIE',
  taxGroup: 'B',
  taxGroupAvailable: true,
  outOfScope: false,
  unitPrice: '464.00',
  priceMode: 'ttc',
  currency: 'CDF',
  unit: 'pièce',
  specificTax: null,
  active: true,
  deactivatedAt: null,
  invoiced: false,
  revision: 1,
  createdAt: '2026-10-20T09:00:00.000Z',
  updatedAt: '2026-10-20T09:00:00.000Z',
};

// ─────────────────────────────────────────────────────────────────────────────

describe('aucun calcul de montant dans le navigateur (docs/26, ADR-0022 § D2)', () => {
  const source = readFileSync(fileURLToPath(new URL('./sales-model.ts', import.meta.url)), 'utf8')
    // Les commentaires peuvent NOMMER ce qui est interdit ; seul le code compte.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('n’utilise ni Number(), ni parseFloat, ni parseInt, ni toFixed', () => {
    expect(source).not.toMatch(/\bNumber\s*\(/);
    expect(source).not.toMatch(/\bparseFloat\b/);
    expect(source).not.toMatch(/\bparseInt\b/);
    expect(source).not.toMatch(/\.toFixed\s*\(/);
    expect(source).not.toMatch(/\bMath\./);
    // Le `+` unaire est la conversion silencieuse la plus courante.
    expect(source).not.toMatch(/[=(,]\s*\+[a-zA-Z_]/);
  });

  it('les composants ne contiennent aucune conversion numérique non plus', () => {
    for (const fichier of [
      './customer-list.tsx',
      './customer-form.tsx',
      './catalog-list.tsx',
      './catalog-item-form.tsx',
    ]) {
      const code = readFileSync(fileURLToPath(new URL(fichier, import.meta.url)), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(code, fichier).not.toMatch(/\bNumber\s*\(|\bparseFloat\b|\bparseInt\b|\.toFixed\s*\(/);
    }
  });
});

describe('formatMontant : à la française, par manipulation de chaîne', () => {
  it('sépare les milliers et met deux décimales', () => {
    expect(formatMontant('1234.50')).toBe(`1${NNBSP}234,50${NBSP}CDF`);
    expect(formatMontant('464.00')).toBe(`464,00${NBSP}CDF`);
    expect(formatMontant('1234567890123.45')).toBe(
      `1${NNBSP}234${NNBSP}567${NNBSP}890${NNBSP}123,45${NBSP}CDF`,
    );
  });

  it('complète les décimales manquantes sans rien arrondir', () => {
    expect(formatMontant('464')).toBe(`464,00${NBSP}CDF`);
    expect(formatMontant('0.5')).toBe(`0,50${NBSP}CDF`);
    // Trois décimales restent trois : arrondir ici serait calculer.
    expect(formatMontant('1.235')).toBe(`1,235${NBSP}CDF`);
  });

  it('reste exact au-delà de la précision d’un nombre JavaScript', () => {
    // 9 007 199 254 740 993 n'est pas représentable en double : `Number()` le
    // rendrait …992. La chaîne, elle, garde chaque chiffre.
    expect(formatMontant('9007199254740993.01')).toBe(
      `9${NNBSP}007${NNBSP}199${NNBSP}254${NNBSP}740${NNBSP}993,01${NBSP}CDF`,
    );
    expect(formatMontant('0.10')).toBe(`0,10${NBSP}CDF`);
  });

  it('retire les zéros de tête et laisse une valeur anormale visible', () => {
    expect(formatMontant('0001234.50')).toBe(`1${NNBSP}234,50${NBSP}CDF`);
    expect(formatMontant('abc')).toBe(`abc${NBSP}CDF`);
  });

  it('accepte une autre devise', () => {
    expect(formatMontant('10.00', 'USD')).toBe(`10,00${NBSP}USD`);
  });
});

describe('formatTaux, montantPourSaisie', () => {
  it('écrit le taux servi par l’API à la française, et laisse null à null', () => {
    expect(formatTaux('16')).toBe(`16${NBSP}%`);
    expect(formatTaux('16.5')).toBe(`16,5${NBSP}%`);
    expect(formatTaux(null)).toBeNull();
  });

  it('prépare un montant de l’API pour l’édition', () => {
    expect(montantPourSaisie('1234.50')).toBe('1234,50');
    expect(montantPourSaisie('464.00')).toBe('464,00');
  });
});

describe('lireMontantSaisi : la forme du contrat, en chaîne', () => {
  it('accepte la saisie française et rend une chaîne à point décimal', () => {
    expect(lireMontantSaisi('1 234,50')).toEqual({ ok: true, valeur: '1234.50' });
    expect(lireMontantSaisi(`1${NNBSP}234,5`)).toEqual({ ok: true, valeur: '1234.5' });
    expect(lireMontantSaisi(`1${NBSP}234`)).toEqual({ ok: true, valeur: '1234' });
    expect(lireMontantSaisi('464')).toEqual({ ok: true, valeur: '464' });
    expect(lireMontantSaisi('464.00')).toEqual({ ok: true, valeur: '464.00' });
    expect(lireMontantSaisi('  0,10 ')).toEqual({ ok: true, valeur: '0.10' });
    expect(lireMontantSaisi('007')).toEqual({ ok: true, valeur: '7' });
    expect(lireMontantSaisi('12,')).toEqual({ ok: true, valeur: '12' });
  });

  it('ne rend JAMAIS un nombre', () => {
    const lu = lireMontantSaisi('0,1');
    expect(lu.ok && typeof lu.valeur).toBe('string');
  });

  it('refuse le vide, zéro, trop de décimales, trop de chiffres, et les formats douteux', () => {
    expect(lireMontantSaisi('')).toMatchObject({ ok: false, erreur: 'Saisissez un montant.' });
    expect(lireMontantSaisi('0')).toMatchObject({ ok: false });
    expect(lireMontantSaisi('0,00')).toMatchObject({
      ok: false,
      erreur: 'Le montant doit être supérieur à zéro.',
    });
    expect(lireMontantSaisi('1,234')).toMatchObject({
      ok: false,
      erreur: 'Deux décimales au plus.',
    });
    expect(lireMontantSaisi('12345678901234')).toMatchObject({ ok: false });
    for (const douteux of ['-5', '1e3', '1,2,3', '1.234,5', ',5', 'abc', '12 CDF', 'Infinity']) {
      expect(lireMontantSaisi(douteux).ok, douteux).toBe(false);
    }
  });

  it('borne la partie entière à 13 chiffres, comme le contrat', () => {
    expect(lireMontantSaisi('9999999999999,99')).toEqual({ ok: true, valeur: '9999999999999.99' });
  });
});

describe('lireTauxSaisi', () => {
  it('accepte un taux strictement entre 0 et 100, avec ou sans %', () => {
    expect(lireTauxSaisi('10')).toEqual({ ok: true, valeur: '10' });
    expect(lireTauxSaisi('10,5 %')).toEqual({ ok: true, valeur: '10.5' });
    expect(lireTauxSaisi('99,99')).toEqual({ ok: true, valeur: '99.99' });
  });

  it('refuse 0, 100 et au-delà', () => {
    expect(lireTauxSaisi('0').ok).toBe(false);
    expect(lireTauxSaisi('100')).toMatchObject({
      ok: false,
      erreur: 'Le taux doit être inférieur à 100 %.',
    });
    expect(lireTauxSaisi('250').ok).toBe(false);
    expect(lireTauxSaisi('')).toMatchObject({ ok: false, erreur: 'Saisissez un taux.' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('accès et onglets', () => {
  it('ne propose aucun onglet tant que les permissions sont inconnues', () => {
    expect(ongletsVentes(null)).toEqual([]);
  });

  it('propose Clients et Catalogue avec sales.read, rien sans', () => {
    expect(ongletsVentes(['sales.read']).map((t) => t.label)).toEqual(['Clients', 'Catalogue']);
    expect(ongletsVentes(['project.read', 'fiscal.manage'])).toEqual([]);
  });

  it('sépare consultation et gestion ; inconnu = lecture seule', () => {
    expect(peutConsulter(['sales.read'])).toBe(true);
    expect(peutGerer(['sales.read'])).toBe(false);
    expect(peutGerer(['sales.read', 'sales.manage'])).toBe(true);
    expect(peutConsulter(null)).toBe(false);
    expect(peutGerer(null)).toBe(false);
  });

  it('déduit l’onglet du chemin, sur des frontières de segment', () => {
    expect(segmentVentes('/ventes/clients')).toBe('clients');
    expect(segmentVentes('/ventes/catalogue')).toBe('catalogue');
    expect(segmentVentes('/ventes')).toBe('');
    expect(segmentVentes('/ventes-privees/clients')).toBe('');
  });
});

describe('requiredFieldsFor : le tableau du § S25c.2', () => {
  // Tableau de l'ADR-0022 recopié en littéral : nom requis pour TOUS les types
  // (choix Lalanda), NIF pour PM/PC/PL, référence d'exonération pour AO.
  const ATTENDU = {
    PP: { name: true, nif: false, exemptionReference: false },
    PM: { name: true, nif: true, exemptionReference: false },
    PC: { name: true, nif: true, exemptionReference: false },
    PL: { name: true, nif: true, exemptionReference: false },
    AO: { name: true, nif: false, exemptionReference: true },
  } as const;

  for (const [type, attendu] of Object.entries(ATTENDU)) {
    it(`${type}`, () => {
      expect(requiredFieldsFor(type as keyof typeof ATTENDU)).toEqual(attendu);
    });
  }

  it('couvre exactement les cinq types de la DGI, dans l’ordre du tableau', () => {
    expect(CUSTOMER_TYPES.map((t) => t.value)).toEqual(['PP', 'PM', 'PC', 'PL', 'AO']);
  });

  it('libelle le nom « Dénomination » pour une personne morale seulement', () => {
    expect(libelleNom('PM')).toBe('Dénomination');
    for (const t of ['PP', 'PC', 'PL', 'AO', ''] as const) expect(libelleNom(t)).toBe('Nom');
  });
});

describe('preparerClient', () => {
  const vide = formulaireClient(null);

  it('n’impose aucun type par défaut', () => {
    expect(vide.type).toBe('');
    expect(preparerClient({ ...vide, name: 'X' })).toMatchObject({
      ok: false,
      champs: { type: 'Choisissez le type de client.' },
    });
  });

  it('accepte un PP sans NIF', () => {
    expect(preparerClient({ ...vide, type: 'PP', name: '  Jean Mukendi ' })).toEqual({
      ok: true,
      corps: {
        type: 'PP',
        name: 'Jean Mukendi',
        nif: null,
        exemptionReference: null,
        phone: null,
        email: null,
        address: null,
      },
    });
  });

  it('exige le NIF pour PM, PC et PL', () => {
    for (const type of ['PM', 'PC', 'PL'] as const) {
      const r = preparerClient({ ...vide, type, name: 'X' });
      expect(r.ok, type).toBe(false);
      expect(!r.ok && r.champs.nif, type).toBeTruthy();
    }
  });

  it('exige la référence d’exonération pour AO, et seulement pour AO', () => {
    const r = preparerClient({ ...vide, type: 'AO', name: 'Ambassade' });
    expect(!r.ok && r.champs.exemptionReference).toBeTruthy();
    expect(
      preparerClient({ ...vide, type: 'AO', name: 'Ambassade', exemptionReference: 'EX-1' }),
    ).toMatchObject({ ok: true, corps: { exemptionReference: 'EX-1', nif: null } });
  });

  it('envoie la référence à null hors AO, même saisie avant de changer de type', () => {
    const f: FormulaireClient = {
      ...vide,
      type: 'PM',
      name: 'Exemple SARL',
      nif: 'a 000-0000x',
      exemptionReference: 'EX-1',
    };
    expect(preparerClient(f)).toMatchObject({
      ok: true,
      // Le NIF part tel que saisi : c'est l'API qui le normalise.
      corps: { nif: 'a 000-0000x', exemptionReference: null },
    });
  });

  it('exige le nom pour tous les types', () => {
    for (const t of CUSTOMER_TYPES) {
      const r = preparerClient({ ...vide, type: t.value, nif: 'A1', exemptionReference: 'R' });
      expect(!r.ok && r.champs.name, t.value).toBeTruthy();
    }
  });

  it('relit une fiche existante sans rien perdre', () => {
    expect(formulaireClient(CLIENT)).toEqual({
      type: 'PM',
      name: 'Exemple SARL',
      nif: 'A0000000X',
      exemptionReference: '',
      phone: '+243 800 000 000',
      email: 'compta@exemple.cd',
      address: '1, avenue Exemple, Gombe, Kinshasa',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('groupes de taxation (§ S25c.4)', () => {
  it('libelle le groupe avec son taux, ou sans taux pour la liste par défaut', () => {
    expect(libelleGroupe(GROUPES_DGI.groups[1]!)).toBe(`B — Taxable 16 % · taux 16${NBSP}%`);
    expect(libelleGroupe(GROUPES_DEFAUT.groups[1]!)).toBe('B — Taxable 16 %');
  });

  it('annonce la liste par défaut (février 2026)', () => {
    expect(bandeauGroupes(GROUPES_DEFAUT)).toMatchObject({
      ton: 'info',
      titre: 'Liste par défaut (février 2026)',
    });
    expect(bandeauGroupes(GROUPES_DGI).titre).toBe('Liste de la DGI');
  });

  it('restreint les types d’article à ceux servis pour le groupe', () => {
    expect(typesAdmis(GROUPES_DGI, 'B')).toEqual(['BIE', 'SER']);
    expect(typesAdmis(GROUPES_DGI, 'L')).toEqual(['TAX']);
    expect(typesAdmis(GROUPES_DGI, '')).toEqual([]);
    expect(typesAdmis(null, 'B')).toEqual([]);
  });

  it('interdit la taxe spécifique en L et N seulement', () => {
    expect(taxeSpecifiqueAdmise('L')).toBe(false);
    expect(taxeSpecifiqueAdmise('N')).toBe(false);
    expect(taxeSpecifiqueAdmise('B')).toBe(true);
    expect(taxeSpecifiqueAdmise('A')).toBe(true);
    expect(taxeSpecifiqueAdmise('')).toBe(false);
  });
});

describe('appliquerGroupe : le formulaire reste cohérent', () => {
  const base = formulaireArticle(null);

  it('choisit d’office le seul type admis (Taxe en L)', () => {
    expect(appliquerGroupe({ ...base, itemType: 'BIE' }, GROUPES_DGI, 'L').itemType).toBe('TAX');
  });

  it('garde un type admis, et vide un type refusé quand plusieurs restent possibles', () => {
    expect(appliquerGroupe({ ...base, itemType: 'SER' }, GROUPES_DGI, 'B').itemType).toBe('SER');
    expect(appliquerGroupe({ ...base, itemType: 'TAX' }, GROUPES_DGI, 'B').itemType).toBe('');
  });

  it('décoche « hors champ » hors du groupe A', () => {
    const a = appliquerGroupe({ ...base, outOfScope: true }, GROUPES_DGI, 'A');
    expect(a.outOfScope).toBe(true);
    expect(appliquerGroupe(a, GROUPES_DGI, 'B').outOfScope).toBe(false);
  });

  it('retire la taxe spécifique en L et N', () => {
    const f: FormulaireArticle = { ...base, specificKind: 'per_unit', specificValue: '75' };
    expect(appliquerGroupe(f, GROUPES_DGI, 'N')).toMatchObject({
      specificKind: 'none',
      specificValue: '',
    });
    expect(appliquerGroupe(f, GROUPES_DGI, 'B')).toMatchObject({ specificKind: 'per_unit' });
  });
});

describe('code DGI d’un article', () => {
  it('vaut « HORS CHAMP » pour une opération hors champ, le code propre sinon', () => {
    expect(OUT_OF_SCOPE_ITEM_CODE).toBe('HORS CHAMP');
    expect(codeDgiApercu({ code: 'EXO-1', outOfScope: true })).toBe('HORS CHAMP');
    expect(codeDgiApercu({ code: ' EXO-1 ', outOfScope: false })).toBe('EXO-1');
    expect(codeDgiApercu({ code: '', outOfScope: false })).toBeNull();
  });

  it('repère la valeur réservée saisie à la main, casse et espaces ignorés', () => {
    expect(codeReserve('hors champ')).toBe(true);
    expect(codeReserve('  Hors   Champ ')).toBe(true);
    // Même repliement que l'API : les séparateurs . _ / - valent une espace.
    expect(codeReserve('HORS-CHAMP')).toBe(true);
    expect(codeReserve('hors_champ')).toBe(true);
    expect(codeReserve('HORS-CHAMPS')).toBe(false);
    expect(codeReserve('HC-1')).toBe(false);
  });
});

describe('preparerArticle', () => {
  const complet: FormulaireArticle = {
    code: 'LAIT-1L',
    name: 'Lait demi-écrémé 1 L',
    unit: 'pièce',
    taxGroup: 'B',
    itemType: 'BIE',
    outOfScope: false,
    unitPrice: '1 234,50',
    priceMode: 'ttc',
    currency: 'CDF',
    specificKind: 'none',
    specificValue: '',
  };

  it('produit le corps du contrat, prix en chaîne à point décimal', () => {
    expect(preparerArticle(complet, GROUPES_DGI)).toEqual({
      ok: true,
      corps: {
        code: 'LAIT-1L',
        name: 'Lait demi-écrémé 1 L',
        itemType: 'BIE',
        taxGroup: 'B',
        outOfScope: false,
        unitPrice: '1234.50',
        priceMode: 'ttc',
        currency: 'CDF',
        unit: 'pièce',
        specificTax: null,
      },
    });
  });

  it('transmet la devise choisie, sans conversion (ADR-0023 E4)', () => {
    const r = preparerArticle(
      {
        ...complet,
        unitPrice: '40',
        currency: 'USD',
        specificKind: 'per_unit',
        specificValue: '1,5',
      },
      GROUPES_DGI,
    );
    expect(r.ok && r.corps).toMatchObject({
      unitPrice: '40',
      currency: 'USD',
      specificTax: { kind: 'per_unit', amount: '1.5' },
    });
    expect(r.ok && corpsContrat(r.corps).currency).toBe('USD');
  });

  it('devise : CDF d’office, celle de l’article à l’édition', () => {
    expect(formulaireArticle(null).currency).toBe('CDF');
    expect(
      formulaireArticle({ ...ARTICLE, currency: 'USD' } as unknown as CatalogItemView).currency,
    ).toBe('USD');
    expect(CATALOG_CURRENCIES).toEqual(['CDF', 'USD']);
    expect(CURRENCY_LABELS.USD).toBe('Dollar américain (USD)');
  });

  it('exige le mode TTC/HT : aucun défaut', () => {
    expect(formulaireArticle(null).priceMode).toBe('');
    const r = preparerArticle({ ...complet, priceMode: '' }, GROUPES_DGI);
    expect(!r.ok && r.champs.priceMode).toBe('Indiquez si le prix est TTC ou HT.');
  });

  it('transmet la taxe spécifique en chaîne, par unité ou en pour cent', () => {
    expect(
      preparerArticle({ ...complet, specificKind: 'per_unit', specificValue: '75' }, GROUPES_DGI),
    ).toMatchObject({ ok: true, corps: { specificTax: { kind: 'per_unit', amount: '75' } } });
    expect(
      preparerArticle({ ...complet, specificKind: 'percent', specificValue: '10 %' }, GROUPES_DGI),
    ).toMatchObject({ ok: true, corps: { specificTax: { kind: 'percent', rate: '10' } } });
  });

  it('refuse les combinaisons que le serveur refuserait', () => {
    const cas: [Partial<FormulaireArticle>, keyof FormulaireArticle][] = [
      [{ itemType: 'TAX' }, 'itemType'],
      [{ outOfScope: true }, 'outOfScope'],
      [{ code: 'hors champ' }, 'code'],
      [{ code: 'é-1' }, 'code'],
      [{ unitPrice: '0' }, 'unitPrice'],
      [{ unitPrice: '1,234' }, 'unitPrice'],
      [{ name: ' ' }, 'name'],
      [{ unit: '' }, 'unit'],
      [{ taxGroup: '' }, 'taxGroup'],
      [{ specificKind: 'percent', specificValue: '100' }, 'specificValue'],
      [
        { taxGroup: 'N', itemType: 'TAX', specificKind: 'per_unit', specificValue: '5' },
        'specificValue',
      ],
    ];
    for (const [modif, champ] of cas) {
      const r = preparerArticle({ ...complet, ...modif }, GROUPES_DGI);
      expect(r.ok, JSON.stringify(modif)).toBe(false);
      expect(!r.ok && r.champs[champ], JSON.stringify(modif)).toBeTruthy();
    }
  });

  it('accepte un article hors champ en groupe A, son code propre conservé', () => {
    expect(
      preparerArticle({ ...complet, taxGroup: 'A', outOfScope: true }, GROUPES_DGI),
    ).toMatchObject({ ok: true, corps: { code: 'LAIT-1L', outOfScope: true, taxGroup: 'A' } });
  });

  it('relit un article existant pour l’édition', () => {
    expect(
      formulaireArticle({ ...ARTICLE, specificTax: { kind: 'percent', rate: '10.00' } }),
    ).toMatchObject({
      unitPrice: '464,00',
      priceMode: 'ttc',
      specificKind: 'percent',
      specificValue: '10,00',
    });
  });
});

describe('affichage d’un article', () => {
  it('donne le prix servi par l’API, sa devise et son mode', () => {
    expect(libellePrix(ARTICLE)).toBe(`464,00${NBSP}CDF TTC`);
    expect(libellePrix({ ...ARTICLE, unitPrice: '1234.50', priceMode: 'ht' })).toBe(
      `1${NNBSP}234,50${NBSP}CDF HT`,
    );
  });

  it('affiche un prix en dollars dans sa devise, sans conversion', () => {
    const usd: CatalogItemDisplay = { ...ARTICLE, unitPrice: '1234.50', currency: 'USD' };
    expect(libellePrix(usd)).toBe(`1${NNBSP}234,50${NBSP}USD TTC`);
    expect(
      libelleTaxeSpecifique({ ...usd, specificTax: { kind: 'per_unit', amount: '0.25' } }),
    ).toBe(`Taxe spécifique : 0,25${NBSP}USD par pièce`);
  });

  it('écrit la taxe spécifique en mots', () => {
    expect(libelleTaxeSpecifique(ARTICLE)).toBeNull();
    expect(
      libelleTaxeSpecifique({ ...ARTICLE, specificTax: { kind: 'per_unit', amount: '75.00' } }),
    ).toBe(`Taxe spécifique : 75,00${NBSP}CDF par pièce`);
    expect(
      libelleTaxeSpecifique({ ...ARTICLE, specificTax: { kind: 'percent', rate: '10.00' } }),
    ).toBe(`Taxe spécifique : 10,00${NBSP}%`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('listes', () => {
  it('construit la requête : recherche bornée, filtres vides absents, curseur repris', () => {
    expect(requeteClients({ q: '  kin ', type: 'PM', status: 'active' }, 'abc')).toEqual({
      q: 'kin',
      type: 'PM',
      status: 'active',
      cursor: 'abc',
    });
    expect(requeteClients({ q: '', type: '', status: 'all' })).toEqual({ status: 'all' });
    expect(requeteClients({ q: 'x'.repeat(150), type: '', status: 'active' }).q).toHaveLength(100);
    expect(
      requeteArticles({ q: 'eau', taxGroup: 'B', itemType: 'BIE', status: 'inactive' }),
    ).toEqual({ q: 'eau', taxGroup: 'B', itemType: 'BIE', status: 'inactive' });
  });

  it('sérialise la requête sans paramètre vide, caractères échappés', () => {
    expect(salesQuery({ q: 'a&b', status: 'active', type: undefined })).toBe(
      '?q=a%26b&status=active',
    );
    expect(salesQuery({})).toBe('');
  });

  it('ajoute une page sans doublon', () => {
    const a = { id: '1' };
    const b = { id: '2' };
    expect(fusionnerPage([a, b], [b, { id: '3' }]).map((i) => i.id)).toEqual(['1', '2', '3']);
  });

  it('retire de la vue « Actifs » une fiche désactivée, la garde dans « Tous »', () => {
    const desactive = { ...CLIENT, active: false };
    expect(remplacerDansListe([CLIENT], desactive, 'active')).toEqual([]);
    expect(remplacerDansListe([CLIENT], desactive, 'all')).toEqual([desactive]);
    expect(remplacerDansListe([desactive], CLIENT, 'inactive')).toEqual([]);
  });

  it('ne propose la suppression que pour une fiche jamais facturée', () => {
    expect(actionsLigne({ active: true, invoiced: false }, true)).toEqual([
      'modifier',
      'desactiver',
      'supprimer',
    ]);
    expect(actionsLigne({ active: true, invoiced: true }, true)).toEqual([
      'modifier',
      'desactiver',
    ]);
    expect(actionsLigne({ active: false, invoiced: true }, true)).toEqual([
      'modifier',
      'reactiver',
    ]);
  });

  it('ne propose que la consultation sans sales.manage', () => {
    expect(actionsLigne({ active: true, invoiced: false }, false)).toEqual(['consulter']);
  });

  it('lit le paramètre ?fiche=', () => {
    expect(ficheDepuisParametre(null)).toBeNull();
    expect(ficheDepuisParametre('')).toBeNull();
    expect(ficheDepuisParametre('nouveau')).toEqual({ mode: 'creation' });
    expect(ficheDepuisParametre('6713a0c4')).toEqual({ mode: 'edition', id: '6713a0c4' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('erreurs de l’API (§ S25c.5)', () => {
  it('range les problèmes sous details.issues par champ', () => {
    const err = erreurApi(400, {
      code: 'INVALID_REQUEST',
      message: 'Requête invalide.',
      details: {
        issues: [
          {
            path: ['nif'],
            code: 'NIF_REQUIRED_FOR_TYPE',
            message: 'NIF obligatoire pour ce type.',
          },
          { path: 'exemptionReference', code: 'EXEMPTION_REFERENCE_NOT_ALLOWED', message: '' },
          { path: ['inconnu'], code: 'custom', message: 'Champ bizarre.' },
        ],
      },
    });
    expect(erreursFormulaire(err, ['type', 'name', 'nif', 'exemptionReference'] as const)).toEqual({
      champs: {
        nif: 'NIF obligatoire pour ce type.',
        exemptionReference:
          'La référence d’exonération ne concerne que les ambassades et organisations internationales.',
      },
      autres: ['inconnu : Champ bizarre.'],
    });
  });

  it('devise refusée : message en français sur le champ « Devise » (ADR-0023 E4)', () => {
    const err = erreurApi(400, {
      code: 'INVALID_REQUEST',
      issues: [{ path: ['currency'], code: 'CURRENCY_NOT_SUPPORTED', message: '' }],
    });
    expect(erreursFormulaire(err, ['currency'] as const).champs).toEqual({
      currency:
        'Devise non prise en charge : choisissez le franc congolais (CDF) ou le dollar américain (USD).',
    });
  });

  it('lit aussi les problèmes posés à la racine, et remplace les messages Zod anglais', () => {
    const err = erreurApi(400, {
      code: 'INVALID_REQUEST',
      issues: [
        { path: ['unitPrice'], code: 'PRICE_TOO_PRECISE', message: 'Invalid input' },
        {
          path: ['name'],
          code: 'too_small',
          message: 'String must contain at least 1 character(s)',
        },
      ],
    });
    expect(erreursFormulaire(err, ['unitPrice', 'name'] as const).champs).toEqual({
      unitPrice: 'Deux décimales au plus.',
      name: 'Ce champ est obligatoire ou trop court.',
    });
  });

  it('traduit les codes précisés par l’API quand le message manque ou est en anglais', () => {
    const cas: [string, string, RegExp][] = [
      ['phone', 'PHONE_INVALID', /téléphone invalide/],
      ['email', 'EMAIL_INVALID', /e-mail invalide/],
      ['address', 'ADDRESS_TOO_LONG', /255/],
      ['name', 'NAME_TOO_LONG', /200/],
      ['exemptionReference', 'EXEMPTION_REFERENCE_TOO_LONG', /200/],
      ['code', 'CODE_INVALID', /Code invalide/],
      ['itemType', 'ITEM_TYPE_INVALID', /type d’article/],
      ['unitPrice', 'PRICE_INVALID', /Montant invalide/],
      ['priceMode', 'PRICE_MODE_INVALID', /TTC ou HT/],
      ['unit', 'UNIT_REQUIRED', /unité est obligatoire/],
      ['unit', 'UNIT_TOO_LONG', /20/],
      ['specificTax.rate', 'SPECIFIC_TAX_INVALID', /Taxe spécifique invalide/],
      ['taxGroup', 'UNKNOWN_TAX_GROUP', /pas proposé/],
      ['name', 'FIELD_REQUIRED', /obligatoire/],
      ['outOfScope', 'INVALID_TYPE', /invalide/],
    ];
    for (const [path, code, attendu] of cas) {
      const err = erreurApi(400, {
        code: 'INVALID_REQUEST',
        details: { issues: [{ path, code, message: 'Expected string, received number' }] },
      });
      const champs = erreursFormulaire(
        err,
        [
          'phone',
          'email',
          'address',
          'name',
          'exemptionReference',
          'code',
          'itemType',
          'unitPrice',
          'priceMode',
          'unit',
          'specificValue',
          'taxGroup',
          'outOfScope',
        ] as const,
        CHEMINS_ARTICLE,
      ).champs as Record<string, string>;
      const cle = CHEMINS_ARTICLE[path] ?? path;
      expect(champs[cle], code).toMatch(attendu);
    }
  });

  it('range un champ inconnu (UNKNOWN_FIELD, chemin vide) en tête, jamais perdu', () => {
    const err = erreurApi(400, {
      code: 'INVALID_REQUEST',
      details: {
        issues: [{ path: '', code: 'UNKNOWN_FIELD', message: 'Champ(s) inconnu(s) : foo.' }],
      },
    });
    expect(erreursFormulaire(err, ['name'] as const)).toEqual({
      champs: {},
      autres: ['Champ(s) inconnu(s) : foo.'],
    });
  });

  it('rattache la taxe spécifique au champ unique du formulaire', () => {
    const err = erreurApi(400, {
      code: 'INVALID_REQUEST',
      details: {
        issues: [{ path: ['specificTax', 'rate'], code: 'x', message: 'Taux invalide.' }],
      },
    });
    expect(erreursFormulaire(err, ['specificValue'] as const, CHEMINS_ARTICLE).champs).toEqual({
      specificValue: 'Taux invalide.',
    });
  });

  it('rattache un doublon de NIF au champ NIF, avec le lien vers la fiche existante', () => {
    const err = erreurApi(409, {
      code: 'CUSTOMER_NIF_EXISTS',
      message: 'Doublon',
      details: { existingId: 'abc123' },
    });
    expect(erreursFormulaire(err, ['nif'] as const).champs.nif).toMatch(/existe déjà/);
    expect(ficheExistante(err)).toBe('abc123');
    expect(ficheExistante(erreurApi(409, { code: 'STALE_REVISION' }))).toBeNull();
  });

  it('rattache un doublon de code au champ code', () => {
    const err = erreurApi(409, { code: 'CATALOG_CODE_EXISTS', details: { existingId: 'i9' } });
    expect(erreursFormulaire(err, ['code'] as const).champs.code).toMatch(/déjà ce code/);
    expect(ficheExistante(err)).toBe('i9');
  });

  it('reconnaît une révision périmée et dit « modifiée par quelqu’un d’autre »', () => {
    const err = erreurApi(409, { code: 'STALE_REVISION', details: { currentRevision: 3 } });
    expect(estRevisionPerimee(err)).toBe(true);
    expect(messageVentes(err, 'repli')).toMatch(/modifiée par quelqu’un d’autre/);
    expect(estRevisionPerimee(erreurApi(409, { code: 'CUSTOMER_NIF_EXISTS' }))).toBe(false);
  });

  it('explique qu’une fiche déjà facturée se désactive', () => {
    expect(messageVentes(erreurApi(409, { code: 'CUSTOMER_ALREADY_INVOICED' }), 'r')).toMatch(
      /Désactivez-le/,
    );
    expect(messageVentes(erreurApi(409, { code: 'CATALOG_ITEM_ALREADY_INVOICED' }), 'r')).toMatch(
      /Désactivez-le/,
    );
  });

  it('rend le message du serveur sur un 400 sans problème de champ', () => {
    expect(
      messageVentes(
        erreurApi(400, { code: 'INVALID_REQUEST', message: 'q : 100 caractères au plus.' }),
        'r',
      ),
    ).toBe('q : 100 caractères au plus.');
  });

  it('dit qu’une session a expiré plutôt que « HTTP 401 »', () => {
    expect(messageVentes(erreurApi(401, 'Unauthorized'), 'r')).toBe(
      'Votre session a expiré. Reconnectez-vous pour continuer.',
    );
  });

  it('retombe sur le message de l’erreur, puis sur le repli', () => {
    expect(messageVentes(new Error('HTTP 500'), 'Repli')).toBe('HTTP 500');
    expect(messageVentes(null, 'Repli')).toBe('Repli');
  });
});
