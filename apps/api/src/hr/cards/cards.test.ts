// Cartes de service et de visite — unitaires (ADR-0069, plan de validation).
//
// Formats, jeton, vCard, vingt modèles (QR présent, échappement, compositions
// distinctes), paquets sur mesure (exemples valides, échappatoires refusées),
// guides recopiés à l'identique dans l'interface. Sans Chromium ni MongoDB.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { writeZip } from '../../security/zip-reader.js';
import { cardFormat, mmToPx, sheetLayout } from './card-formats.js';
import { cardThemeOf, initialsOf } from './card-model.js';
import { pagesDocument, sheetDocument } from './card-document.js';
import { renderBuiltinCard } from './card-render.js';
import { sampleCardData } from './card-sample.js';
import { CARD_TOKEN_BYTES, cardVerifyUrl, isCardToken, newCardToken } from './card-token.js';
import { cardVariableList } from './custom/card-data-contract.js';
import { validateCardPackage } from './custom/card-package.js';
import {
  BUILTIN_CARD_TEMPLATES,
  DEFAULT_CARD_TEMPLATE,
  builtinCardTemplate,
} from './templates/registry.js';
import { vcardEscape, vcardOf } from './vcard.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
const QR =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 33 33"><path d="M0 0h1v1H0z"/></svg>';
const ORG = {
  name: 'Kivu Logistique',
  logo: null,
  logoLight: null,
  address: null,
  website: null,
  phone: null,
  slogan: null,
};

function zipDir(dir: string, edit: (name: string, data: Buffer) => Buffer = (_n, d) => d): Buffer {
  const files: Array<{ name: string; data: Buffer }> = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const rel = relative(dir, full).split(sep).join('/');
        files.push({ name: rel, data: edit(rel, readFileSync(full)) });
      }
    }
  };
  walk(dir);
  return writeZip(files);
}

describe('formats (ISO/IEC 7810 ID-1, carte de visite)', () => {
  it('CR80 : 85,60 × 53,98 mm, sans fond perdu ; 1011 × 638 px à 300 dpi', () => {
    const f = cardFormat('badge', 'horizontal');
    expect([f.width, f.height, f.bleed, f.safe]).toEqual([85.6, 53.98, 0, 3]);
    expect([mmToPx(f.width), mmToPx(f.height)]).toEqual([1011, 638]);
    const v = cardFormat('badge', 'vertical');
    expect([v.width, v.height]).toEqual([53.98, 85.6]);
  });

  it('carte de visite : 85 × 55 mm, fond perdu 3 mm, zone de sécurité 4 mm', () => {
    const f = cardFormat('business', 'horizontal');
    expect([f.width, f.height, f.bleed, f.safe]).toEqual([85, 55, 3, 4]);
    expect([mmToPx(91), mmToPx(61)]).toEqual([1075, 720]);
  });

  it('planche A4 : 10 cartes horizontales, 9 verticales, centrées', () => {
    expect(sheetLayout(cardFormat('badge', 'horizontal')).perPage).toBe(10);
    expect(sheetLayout(cardFormat('business', 'vertical')).perPage).toBe(9);
    const l = sheetLayout(cardFormat('business', 'horizontal'));
    expect(l.originX).toBeCloseTo((210 - 170) / 2);
  });
});

describe('jeton de vérification', () => {
  it('144 bits aléatoires, 24 caractères base64url, jamais deux fois le même', () => {
    expect(CARD_TOKEN_BYTES * 8).toBeGreaterThanOrEqual(128);
    const a = newCardToken();
    expect(isCardToken(a)).toBe(true);
    expect(a).toHaveLength(24);
    const many = new Set(Array.from({ length: 500 }, () => newCardToken()));
    expect(many.size).toBe(500);
  });

  it('refuse toute autre forme (matricule, identifiant, injection)', () => {
    for (const bad of [
      'EX-0042',
      'a'.repeat(32),
      '../../etc/passwd/../x',
      'a'.repeat(25),
      '',
      'AbCdEfGhIjKlMnOpQrStUv=x',
    ]) {
      expect(isCardToken(bad)).toBe(false);
    }
  });

  it('URL publique sur lalanda.co par défaut', () => {
    expect(cardVerifyUrl('AbCdEfGhIjKlMnOpQrStUvWx')).toBe(
      'https://lalanda.co/v/AbCdEfGhIjKlMnOpQrStUvWx',
    );
  });
});

describe('vCard', () => {
  it('échappe virgules, points-virgules, barres et sauts de ligne ; omet les champs vides', () => {
    expect(vcardEscape('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const v = vcardOf({
      firstName: 'Aline',
      lastName: 'Mbuyi; Kabongo',
      organization: 'Kivu, SARL',
      jobTitle: null,
      workPhone: '+243 81',
      workEmail: null,
      website: null,
      address: null,
    });
    expect(v).toContain('N:Mbuyi\\; Kabongo;Aline;;;');
    expect(v).toContain('ORG:Kivu\\, SARL');
    expect(v).not.toContain('EMAIL');
    expect(v.startsWith('BEGIN:VCARD\r\nVERSION:3.0')).toBe(true);
  });
});

describe('vingt modèles Lalanda', () => {
  it('5 verticaux et 5 horizontaux par type, identifiants uniques, défauts présents', () => {
    expect(BUILTIN_CARD_TEMPLATES).toHaveLength(20);
    expect(new Set(BUILTIN_CARD_TEMPLATES.map((t) => t.id)).size).toBe(20);
    for (const kind of ['badge', 'business'] as const) {
      for (const o of ['vertical', 'horizontal'] as const) {
        expect(
          BUILTIN_CARD_TEMPLATES.filter((t) => t.kind === kind && t.orientation === o),
        ).toHaveLength(5);
      }
      expect(builtinCardTemplate(DEFAULT_CARD_TEMPLATE[kind])?.kind).toBe(kind);
    }
  });

  it('chaque carte de service porte le QR de vérification au recto et sa mention', () => {
    const t = cardThemeOf(
      { primaryColor: '#0f766e', secondaryColor: null, font: 'inter' },
      'brand',
      null,
    );
    for (const def of BUILTIN_CARD_TEMPLATES.filter((x) => x.kind === 'badge')) {
      const f = cardFormat(def.kind, def.orientation);
      const d = sampleCardData('badge', ORG, { verify: QR, vcard: null }, 'lalanda.co/v');
      const out = def.render(d, t, f);
      expect(out.recto, def.id).toContain(QR);
      expect(out.recto, def.id).toContain('lalanda.co/v');
      expect(out.verso, def.id).toContain(QR);
    }
  });

  it('aucun texte saisi ne devient du HTML (nom, poste, organisation hostiles)', () => {
    const t = cardThemeOf(
      { primaryColor: null, secondaryColor: null, font: null },
      'inverse',
      null,
    );
    for (const def of BUILTIN_CARD_TEMPLATES) {
      const f = cardFormat(def.kind, def.orientation);
      const d = sampleCardData(
        def.kind,
        { ...ORG, name: '<script>alert(1)</script>', slogan: '"><img src=x onerror=1>' },
        { verify: QR, vcard: QR },
        'lalanda.co/v',
        {
          firstName: '<b>Aline',
          lastName: 'M"buyi',
          displayName: '<b>Aline M"buyi',
          jobTitle: '<iframe>',
        },
      );
      const out = def.render(d, t, f);
      const html = out.recto + out.verso;
      expect(html, def.id).not.toMatch(/<script|<iframe|<b>Aline|onerror=1>/);
    }
  });

  it('les compositions sont distinctes (pas dix fois le même gabarit)', () => {
    const t = cardThemeOf(
      { primaryColor: '#7c2d12', secondaryColor: '#1e3a8a', font: 'manrope' },
      'brand',
      null,
    );
    const signatures = BUILTIN_CARD_TEMPLATES.map((def) => {
      const out = def.render(
        sampleCardData(def.kind, ORG, { verify: QR, vcard: QR }, 'lalanda.co/v'),
        t,
        cardFormat(def.kind, def.orientation),
      );
      // Structure : suite des classes du recto, sans les données.
      return [...out.recto.matchAll(/class="([^"]+)"/g)].map((m) => m[1]).join('|');
    });
    expect(new Set(signatures).size).toBe(20);
  });

  it('variante noir et blanc : aucun accent de couleur, logo en niveaux de gris', () => {
    const t = cardThemeOf(
      { primaryColor: '#0f766e', secondaryColor: '#f59e0b', font: null },
      'mono',
      null,
    );
    expect(t.accent).toBe('#111111');
    expect(t.logoFilter).toBe('grayscale(1)');
  });

  it('un lot isole la feuille de chaque carte (@scope) ; la planche porte les traits de coupe', () => {
    const def = builtinCardTemplate('badge-h-bandeau')!;
    const f = cardFormat('badge', 'horizontal');
    const t = cardThemeOf({ primaryColor: null, secondaryColor: null, font: null }, 'brand', null);
    const cards = [0, 1, 2].map(() =>
      renderBuiltinCard(
        def,
        sampleCardData('badge', ORG, { verify: QR, vcard: null }, 'lalanda.co/v'),
        t,
        f,
        ['recto', 'verso'],
      ),
    );
    const pages = pagesDocument({ format: f, fonts: t.fonts, cards });
    expect(pages).toContain('@scope (.lx-c2)');
    expect(pages.match(/class="lx-page"/g)).toHaveLength(6);
    expect(pages).toContain("default-src 'none'");
    const sheet = sheetDocument({ format: f, fonts: t.fonts, cards });
    expect(sheet.match(/class="lx-sheet"/g)).toHaveLength(2);
    expect(sheet).toContain('lx-crop');
  });

  it('initiales robustes', () => {
    expect(initialsOf('Aline Mbuyi Kabongo')).toBe('AM');
    expect(initialsOf('  élodie   d’Almeida ')).toBe('ÉD');
    expect(initialsOf('')).toBe('·');
  });
});

describe('modèles sur mesure', () => {
  const sample = (kind: 'badge' | 'business') => (i: number) =>
    sampleCardData(
      kind,
      ORG,
      { verify: QR, vcard: QR },
      'lalanda.co/v',
      i === 1 ? { photo: null } : {},
    );

  it('le paquet code d’exemple du dépôt est valide ; le QR est posé par le moteur', () => {
    const zip = zipDir(resolve(ROOT, 'docs/cartes/exemple-badge-code'));
    const { report, compiled } = validateCardPackage(zip, sample('badge'));
    expect(report.errors).toEqual([]);
    expect(compiled?.format).toBe('code');
    const out = compiled!.render(
      sample('badge')(0),
      cardThemeOf({ primaryColor: null, secondaryColor: null, font: null }, 'brand', null),
      ['recto', 'verso'],
    );
    expect(out.faces[0]!.html).toContain('lx-moteur-qr');
    expect(out.faces[0]!.html).toContain('<main class="lx-modele"');
    expect(out.css).toContain('@scope (.lx-modele)');
  });

  it('le gabarit graphiste d’exemple est valide', () => {
    const zip = zipDir(resolve(ROOT, 'docs/cartes/exemple-graphiste'));
    const { report, compiled } = validateCardPackage(zip, sample('business'));
    expect(report.errors).toEqual([]);
    expect(compiled?.format).toBe('designer');
  });

  const hostile = (edit: (name: string, data: Buffer) => Buffer) =>
    validateCardPackage(
      zipDir(resolve(ROOT, 'docs/cartes/exemple-badge-code'), edit),
      sample('badge'),
    ).report;
  const json = (fn: (m: Record<string, unknown>) => void) => (name: string, data: Buffer) => {
    if (name !== 'manifest.json') return data;
    const m = JSON.parse(data.toString()) as Record<string, unknown>;
    fn(m);
    return Buffer.from(JSON.stringify(m));
  };
  const codes = (r: { errors: Array<{ code: string }> }) => r.errors.map((e) => e.code);

  it('refuse un QR trop petit, hors de la zone de sécurité, ou absent', () => {
    expect(
      codes(hostile(json((m) => (m['qr'] = { face: 'recto', x: 66, y: 31, size: 12 })))),
    ).toContain('CARD_QR_TOO_SMALL');
    expect(
      codes(hostile(json((m) => (m['qr'] = { face: 'recto', x: 75, y: 31, size: 16 })))),
    ).toContain('CARD_QR_OUTSIDE_SAFE_ZONE');
    expect(codes(hostile(json((m) => (m['qr'] = null))))).toContain('CARD_QR_REQUIRED');
  });

  it('refuse un CSS qui tenterait de masquer ou recouvrir le QR', () => {
    for (const rule of [
      '.ruban { position: absolute; }',
      '.ruban { z-index: 99; }',
      '.ruban { transform: scale(3); }',
      '.ruban { opacity: 0; }',
      'body { display: none; }',
      '.lx-moteur-qr { display: none; }',
      '@import url(https://x);',
    ]) {
      const r = hostile((n, d) =>
        n === 'style.css' ? Buffer.concat([d, Buffer.from(`\n${rule}\n`)]) : d,
      );
      expect(r.ok, rule).toBe(false);
    }
  });

  it('refuse une variable inconnue, un script, et le texte réservé du moteur', () => {
    const tpl = (extra: string) => (n: string, d: Buffer) =>
      n === 'gabarit.html' ? Buffer.concat([d, Buffer.from(extra)]) : d;
    expect(codes(hostile(tpl('{{person.salary}}')))).toContain('TEMPLATE_UNKNOWN_VARIABLE');
    expect(hostile(tpl('<script>x</script>')).ok).toBe(false);
    expect(codes(hostile(tpl('<p>Vérifier : lalanda.co/v</p>')))).toContain(
      'TEMPLATE_RESERVED_TEXT',
    );
  });

  it('gabarit graphiste : fond aux mauvaises proportions, zone hors carte, format SVG refusés', () => {
    const dir = resolve(ROOT, 'docs/cartes/exemple-graphiste');
    const r1 = validateCardPackage(
      zipDir(
        dir,
        json((m) => ((m['zones'] as Array<Record<string, unknown>>)[0]!['x'] = 80)),
      ),
      sample('business'),
    ).report;
    expect(codes(r1)).toContain('DESIGNER_ZONE_OUTSIDE');
    const r2 = validateCardPackage(
      zipDir(
        dir,
        json((m) => (m['orientation'] = 'vertical')),
      ),
      sample('business'),
    ).report;
    expect(codes(r2)).toContain('DESIGNER_BACKGROUND_RATIO');
    const r3 = validateCardPackage(
      zipDir(
        dir,
        json((m) => (m['format'] = 'lalanda.modele-carte-svg')),
      ),
      sample('business'),
    ).report;
    expect(codes(r3)).toContain('MANIFEST_FORMAT_UNKNOWN');
    const r4 = validateCardPackage(
      zipDir(
        dir,
        json((m) => (m['kind'] = 'badge')),
      ),
      sample('badge'),
    ).report;
    expect(codes(r4)).toContain('CARD_QR_REQUIRED');
  });
});

describe('guides téléchargeables', () => {
  it('la liste des variables du guide concorde avec le contrat de données', () => {
    const guide = readFileSync(resolve(ROOT, 'docs/cartes/guide-paquet-code.md'), 'utf8');
    for (const v of cardVariableList()) {
      expect(guide, v.path).toContain(`| \`${v.path}\` | ${v.type} | ${v.doc} |`);
    }
    const lignes = guide
      .split('\n')
      .filter((l) => /^\| `(face|person|organization|card)\./.test(l));
    expect(lignes).toHaveLength(cardVariableList().length);
  });

  it('les guides servis par l’interface sont identiques à ceux de docs/', () => {
    for (const [src, pub] of [
      ['docs/cartes/guide-paquet-code.md', 'apps/web/public/guides/cartes-guide-paquet-code.md'],
      ['docs/cartes/guide-graphiste.md', 'apps/web/public/guides/cartes-guide-graphiste.md'],
    ] as const) {
      expect(readFileSync(resolve(ROOT, pub), 'utf8')).toBe(
        readFileSync(resolve(ROOT, src), 'utf8'),
      );
    }
  });
});
