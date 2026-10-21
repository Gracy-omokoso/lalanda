// Modèles de facture sur mesure — ADR-0029 (plan de validation, unitaires).
//
// Un paquet est du contenu NON FIABLE : chaque test « hostile » ci-dessous
// part du paquet d'exemple du dépôt (valide) et y introduit UNE attaque, pour
// prouver que c'est bien la règle visée qui la refuse.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { qrCodeSvg } from '../../invoice-qr.js';
import { renderDocumentHtml } from '../template-engine.js';
import { CUSTOM_ENGINE_VERSION, compileCustomTemplate } from './custom-template.js';
import { compileCss } from './css-policy.js';
import { DATA_SCHEMA, variableList } from './data-contract.js';
import { checkHtml, maskMustache } from './html-policy.js';
import { checkTemplate, parseTemplate, renderTemplate } from './mustache.js';
import { collectPackageFiles, filesFromArchive, packageDigest } from './package-files.js';
import { IssueList } from './report.js';
import {
  SAMPLE_IDENTITY,
  sampleLogos,
  validateArchive,
  validatePackageFiles,
} from './validate-package.js';
import { validationCases } from './validation-cases.js';
import { crc32, readZip, writeZip } from './zip.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../../../..');
const EXAMPLE = resolve(ROOT, 'docs/modeles-facture/exemple-ocre');
const GUIDE = resolve(ROOT, 'docs/modeles-facture/README.md');

function exampleFiles(): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(relative(EXAMPLE, full).split(sep).join('/'), readFileSync(full));
    }
  };
  walk(EXAMPLE);
  return out;
}

const text = (s: string) => Buffer.from(s, 'utf8');

/** Paquet d'exemple avec des fichiers remplacés (`null` : retiré). */
function variant(over: Record<string, string | Buffer | null> = {}): Map<string, Buffer> {
  const files = exampleFiles();
  for (const [k, v] of Object.entries(over)) {
    if (v === null) files.delete(k);
    else files.set(k, typeof v === 'string' ? text(v) : v);
  }
  return files;
}

async function validate(over: Record<string, string | Buffer | null> = {}) {
  const issues = new IssueList();
  const files = collectPackageFiles(
    [...variant(over)].map(([name, data]) => ({ name, directory: false, data, size: data.length })),
    issues,
  );
  return validatePackageFiles(files, issues);
}

const codes = (r: { errors: { code: string }[] }) => r.errors.map((e) => e.code);
const exampleTemplate = () => readFileSync(join(EXAMPLE, 'gabarit.html'), 'utf8');
const exampleCss = () => readFileSync(join(EXAMPLE, 'style.css'), 'utf8');
const manifest = () => JSON.parse(readFileSync(join(EXAMPLE, 'manifest.json'), 'utf8'));

function zipOf(files: Map<string, Buffer>): Buffer {
  return writeZip([...files].map(([name, data]) => ({ name, data })));
}

// ─── Paquet d'exemple ────────────────────────────────────────────────────────

describe('paquet d’exemple du dépôt (docs/modeles-facture/exemple-ocre)', () => {
  it('est valide et passe toute la batterie de rendu', async () => {
    const { report, template } = await validate();
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(template).not.toBeNull();
    expect(report.cases.length).toBeGreaterThanOrEqual(8);
    expect(report.cases.every((c) => c.ok)).toBe(true);
    expect(report.manifest?.id).toBe('lalanda.ocre');
  }, 120_000);

  it('empreinte canonique : indépendante de l’ordre, des dates et du dossier racine', async () => {
    const files = exampleFiles();
    const direct = await validateArchive(zipOf(files));
    const reversed = await validateArchive(
      writeZip([...files].reverse().map(([name, data]) => ({ name: `ocre/${name}`, data }))),
    );
    expect(direct.report.ok).toBe(true);
    expect(reversed.report.ok).toBe(true);
    expect(direct.report.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(reversed.report.digest).toBe(direct.report.digest);
    // Un octet de plus change l'empreinte.
    const touched = await validate({ 'style.css': `${exampleCss()}\n` });
    expect(touched.report.digest).not.toBe(direct.report.digest);
  }, 120_000);

  it('l’archive « Compresser » de macOS (dossier racine, __MACOSX, .DS_Store) est admise', async () => {
    const files = exampleFiles();
    const entries = [
      { name: 'ocre/', data: Buffer.alloc(0) },
      ...[...files].map(([name, data]) => ({ name: `ocre/${name}`, data })),
      { name: '__MACOSX/ocre/._manifest.json', data: Buffer.from('x') },
      { name: 'ocre/.DS_Store', data: Buffer.from('x') },
    ];
    const r = await validateArchive(writeZip(entries));
    expect(r.report.errors).toEqual([]);
  }, 120_000);
});

// ─── Archive hostile ─────────────────────────────────────────────────────────

describe('archive ZIP hostile', () => {
  const limits = {
    maxEntries: 40,
    maxEntryBytes: 2 * 1024 * 1024,
    maxTotalBytes: 8 * 1024 * 1024,
    maxRatio: 200,
  };

  it('aller-retour écriture / lecture', () => {
    const z = writeZip([{ name: 'a.txt', data: text('bonjour') }]);
    const [e] = readZip(z, limits);
    expect(e!.data!.toString()).toBe('bonjour');
  });

  it('bombe de décompression : taux de compression anormal', () => {
    const z = writeZip([{ name: 'gabarit.html', data: Buffer.alloc(1_500_000, 0x20) }]);
    expect(() => readZip(z, limits)).toThrow(expect.objectContaining({ code: 'ZIP_BOMB' }));
  });

  it('bombe : une entrée qui ment sur sa taille ne décompresse pas un octet de plus', () => {
    const real = Buffer.alloc(100_000, 0x41);
    const z = writeZip([{ name: 'style.css', data: real }]);
    // On annonce 1 000 octets (dans l'en-tête local et central) : la
    // décompression est plafonnée à 1 000, l'archive est refusée.
    const cd = z.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    z.writeUInt32LE(1000, 22);
    z.writeUInt32LE(1000, cd + 24);
    const ratioOk = { ...limits, maxRatio: 1_000_000 };
    expect(() => readZip(z, ratioOk)).toThrow(expect.objectContaining({ code: 'ZIP_BOMB' }));
  });

  it('taille annoncée au-delà du plafond : refus AVANT décompression', () => {
    const z = writeZip([{ name: 'gabarit.html', data: Buffer.alloc(10, 0x41) }]);
    const cd = z.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    z.writeUInt32LE(3 * 1024 * 1024, cd + 24);
    expect(() => readZip(z, limits)).toThrow(
      expect.objectContaining({ code: 'ZIP_ENTRY_TOO_LARGE' }),
    );
  });

  it('chemins « .. », absolus, barre inverse : refusés', () => {
    for (const name of [
      '../manifest.json',
      '/etc/passwd',
      'images/../../x',
      'images\\x.png',
      'C:/x',
    ]) {
      const issues = new IssueList();
      filesFromArchive(zipOf(new Map([...exampleFiles(), [name, text('x')]])), issues);
      expect(codes(issues), name).toContain('PACKAGE_BAD_PATH');
    }
  });

  it('lien symbolique (attributs Unix) : refusé', () => {
    const z = writeZip([{ name: 'gabarit.html', data: text('/etc/passwd') }]);
    const cd = z.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    z.writeUInt16LE((3 << 8) | 20, cd + 4);
    z.writeUInt32LE((0o120777 << 16) >>> 0, cd + 38);
    expect(() => readZip(z, limits)).toThrow(expect.objectContaining({ code: 'ZIP_SYMLINK' }));
  });

  it('entrée chiffrée, méthode inconnue, CRC faux, archive tronquée, ZIP64 : refusés', () => {
    const base = () => writeZip([{ name: 'style.css', data: text('.a { color: red; }') }]);
    const cdOf = (z: Buffer) => z.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const enc = base();
    enc.writeUInt16LE(0x801, cdOf(enc) + 8);
    expect(() => readZip(enc, limits)).toThrow(expect.objectContaining({ code: 'ZIP_ENCRYPTED' }));
    const meth = base();
    meth.writeUInt16LE(12, cdOf(meth) + 10);
    expect(() => readZip(meth, limits)).toThrow(
      expect.objectContaining({ code: 'ZIP_UNSUPPORTED' }),
    );
    const crc = base();
    crc.writeUInt32LE(crc32(text('autre')) >>> 0 || 1, cdOf(crc) + 16);
    expect(() => readZip(crc, limits)).toThrow(expect.objectContaining({ code: 'ZIP_CRC' }));
    expect(() => readZip(base().subarray(0, 40), limits)).toThrow(
      expect.objectContaining({ code: 'ZIP_MALFORMED' }),
    );
    const z64 = base();
    z64.writeUInt16LE(0xffff, z64.length - 22 + 10);
    z64.writeUInt16LE(0xffff, z64.length - 22 + 8);
    expect(() => readZip(z64, limits)).toThrow(
      expect.objectContaining({ code: 'ZIP_UNSUPPORTED' }),
    );
    expect(() => readZip(Buffer.from('pas une archive du tout, vraiment pas'), limits)).toThrow(
      expect.objectContaining({ code: 'ZIP_MALFORMED' }),
    );
  });

  it('trop d’entrées, doublons (casse), fichiers inattendus, archive trop grosse', () => {
    const many = new Map(exampleFiles());
    for (let i = 0; i < 40; i += 1) many.set(`images/x${i}.png`, text('x'));
    const i1 = new IssueList();
    filesFromArchive(zipOf(many), i1);
    expect(codes(i1)).toContain('ZIP_TOO_MANY_ENTRIES');

    const dup = writeZip([
      ...[...exampleFiles()].map(([name, data]) => ({ name, data })),
      { name: 'STYLE.CSS', data: text('') },
    ]);
    const i2 = new IssueList();
    filesFromArchive(dup, i2);
    expect(codes(i2)).toContain('PACKAGE_DUPLICATE_FILE');

    for (const name of [
      'script.js',
      'images/logo.svg',
      'index.html',
      'polices/x.ttf',
      'a/b/c.png',
    ]) {
      const i3 = new IssueList();
      filesFromArchive(zipOf(new Map([...exampleFiles(), [name, text('x')]])), i3);
      expect(codes(i3), name).toContain('PACKAGE_UNEXPECTED_FILE');
    }

    const i4 = new IssueList();
    filesFromArchive(Buffer.alloc(3 * 1024 * 1024 + 1), i4);
    expect(codes(i4)).toEqual(['PACKAGE_TOO_LARGE']);
  });

  it('CSS énorme : refusé par le plafond de fichier', async () => {
    const huge = '.a { color: #111111; }\n'.repeat(4000);
    const r = await validate({ 'style.css': huge });
    expect(codes(r.report)).toContain('PACKAGE_FILE_TOO_LARGE');
  }, 60_000);

  it('fichiers obligatoires absents', async () => {
    const r = await validate({ 'gabarit.html': null });
    expect(r.report.errors).toContainEqual(
      expect.objectContaining({ code: 'PACKAGE_MISSING_FILE', file: 'gabarit.html' }),
    );
  });
});

// ─── Manifeste ───────────────────────────────────────────────────────────────

describe('manifeste', () => {
  const withManifest = (patch: Record<string, unknown>) =>
    validate({ 'manifest.json': JSON.stringify({ ...manifest(), ...patch }) });

  it.each([
    ['champ inconnu', { script: 'x' }],
    ['version non SemVer', { version: '1.0' }],
    ['version avec préfixe', { version: 'v1.0.0' }],
    ['identifiant sans éditeur', { id: 'ocre' }],
    ['contrat inconnu', { contract: 2 }],
    ['signature non vérifiable', { signature: 'abc' }],
    ['licence invalide', { license: 'tout <script>' }],
    ['prix mal formé', { price: { amount: '25', currency: 'USD' } }],
    ['nom avec balise', { name: '<b>Ocre</b>' }],
    ['format inconnu', { format: 'autre' }],
  ])('%s : refusé', async (_label, patch) => {
    const r = await withManifest(patch);
    expect(codes(r.report)).toContain('MANIFEST_INVALID');
  });

  it('police par défaut hors de la liste, police intégrée inconnue, famille réservée', async () => {
    const m = manifest();
    const a = await withManifest({ options: { ...m.options, font: 'manrope' } });
    expect(codes(a.report)).toContain('MANIFEST_INVALID');
    const b = await withManifest({
      options: { ...m.options, fonts: ['comic-sans'], font: 'comic-sans' },
    });
    expect(codes(b.report)).toContain('MANIFEST_INVALID');
    const c = await withManifest({ fonts: [{ ...m.fonts[0], family: 'Lalanda Inter' }] });
    expect(codes(c.report)).toContain('MANIFEST_INVALID');
  });

  it('police déclarée absente ou qui n’est pas un WOFF2', async () => {
    const m = manifest();
    const a = await withManifest({ fonts: [{ ...m.fonts[0], file: 'polices/absente.woff2' }] });
    expect(codes(a.report)).toContain('MANIFEST_FONT_MISSING');
    const b = await validate({ 'polices/ocre-titre-600.woff2': Buffer.alloc(4096, 0x41) });
    expect(codes(b.report)).toContain('FONT_NOT_WOFF2');
  });

  it('JSON illisible, encodage non UTF-8', async () => {
    expect(codes((await validate({ 'manifest.json': '{ id: ' })).report)).toContain(
      'MANIFEST_INVALID_JSON',
    );
    expect(
      codes((await validate({ 'manifest.json': Buffer.from([0xff, 0xfe, 0x00]) })).report),
    ).toContain('PACKAGE_NOT_UTF8');
  });

  it('les champs de la place de marché sont acceptés et restitués', async () => {
    const r = await withManifest({
      publisher: { id: 'atelier-kin', name: 'Atelier Kin', url: 'https://exemple.cd' },
      license: 'CC-BY-4.0',
      price: { amount: '25.00', currency: 'USD' },
    });
    expect(r.report.ok).toBe(true);
    expect(r.report.manifest?.publisher?.id).toBe('atelier-kin');
    expect(r.report.manifest?.price).toEqual({ amount: '25.00', currency: 'USD' });
  }, 120_000);
});

// ─── Images ──────────────────────────────────────────────────────────────────

describe('images du paquet', () => {
  it('SVG déguisé en PNG, image illisible : refusés', async () => {
    const svg = text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const r = await validate({ 'images/frise.png': svg });
    expect(codes(r.report)).toContain('IMAGE_UNSUPPORTED_TYPE');
  });
});

// ─── Mustache ────────────────────────────────────────────────────────────────

describe('sous-ensemble Mustache', () => {
  const check = (src: string) => {
    const issues = new IssueList();
    const nodes = parseTemplate(src, 'gabarit.html', issues);
    if (nodes) checkTemplate(nodes, DATA_SCHEMA, src, 'gabarit.html', issues);
    return codes(issues);
  };

  it.each([
    ['{{{document.title}}}', 'MUSTACHE_RAW_FORBIDDEN'],
    ['{{&document.title}}', 'MUSTACHE_RAW_FORBIDDEN'],
    ['{{> entete}}', 'MUSTACHE_TAG_FORBIDDEN'],
    ['{{=<% %>=}}', 'MUSTACHE_TAG_FORBIDDEN'],
    ['{{document.titre}}', 'TEMPLATE_UNKNOWN_VARIABLE'],
    ['{{constructor}}', 'TEMPLATE_UNKNOWN_VARIABLE'],
    ['{{document.constructor.name}}', 'TEMPLATE_UNKNOWN_VARIABLE'],
    ['{{__proto__}}', 'MUSTACHE_BAD_NAME'],
    ['{{document.lines}}', 'TEMPLATE_NOT_TEXT'],
    ['{{.}}', 'TEMPLATE_UNKNOWN_VARIABLE'],
    ['{{#document.lines}}', 'MUSTACHE_UNBALANCED'],
    ['{{#document.lines}}{{/document.groups}}', 'MUSTACHE_UNBALANCED'],
    ['{{document.title', 'MUSTACHE_UNCLOSED_TAG'],
    ['{{ document.title | upper }}', 'MUSTACHE_BAD_NAME'],
    [
      '{{#a}}{{#a}}{{#a}}{{#a}}{{#a}}{{#a}}{{#a}}{{#a}}{{#a}}x{{/a}}{{/a}}{{/a}}{{/a}}{{/a}}{{/a}}{{/a}}{{/a}}{{/a}}',
      'MUSTACHE_TOO_DEEP',
    ],
  ])('%s → %s', (src, code) => {
    expect(check(src)).toContain(code);
  });

  it('sections : listes, objets, textes facultatifs, booléens, élément courant', () => {
    expect(
      check(
        '{{#document.lines}}{{name}}{{#code}}{{.}}{{/code}}{{^code}}-{{/code}}{{/document.lines}}' +
          '{{#document.isProforma}}{{document.title}}{{/document.isProforma}}' +
          '{{#document.seller}}{{title}}{{#lines}}{{.}}{{/lines}}{{/document.seller}}{{! commentaire }}',
      ),
    ).toEqual([]);
  });

  it('échappe toute valeur ; ne lit aucune propriété héritée', () => {
    const issues = new IssueList();
    const nodes = parseTemplate('<b>{{a}}</b>{{#l}}[{{.}}]{{/l}}{{^vide}}ø{{/vide}}', 'x', issues)!;
    const out = renderTemplate(nodes, {
      a: '<script>alert("x")</script>',
      l: ['<i>', '&'],
      vide: [],
    });
    expect(out).toBe('<b>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</b>[&lt;i&gt;][&amp;]ø');
    const proto = parseTemplate('{{toString}}{{#constructor}}x{{/constructor}}', 'x', issues)!;
    expect(renderTemplate(proto, {})).toBe('');
  });

  it('sortie bornée pendant le rendu', () => {
    const issues = new IssueList();
    const nodes = parseTemplate(
      '{{#l}}{{#l}}{{#l}}{{#l}}xxxxxxxxxx{{/l}}{{/l}}{{/l}}{{/l}}',
      'x',
      issues,
    )!;
    const l = Array.from({ length: 40 }, () => 'a');
    expect(() => renderTemplate(nodes, { l })).toThrow(
      expect.objectContaining({ code: 'TEMPLATE_OUTPUT_TOO_LARGE' }),
    );
  });
});

// ─── HTML ────────────────────────────────────────────────────────────────────

describe('HTML hostile dans le gabarit', () => {
  const withBody = (html: string) =>
    validate({ 'gabarit.html': exampleTemplate().replace('</footer>', `</footer>${html}`) });

  it.each([
    ['<script>alert(1)</script>', 'TEMPLATE_TAG_FORBIDDEN'],
    ['<style>body{display:none}</style>', 'TEMPLATE_TAG_FORBIDDEN'],
    ['<link rel="stylesheet" href="https://evil.example/x.css" />', 'TEMPLATE_TAG_FORBIDDEN'],
    ['<iframe src="https://evil.example"></iframe>', 'TEMPLATE_TAG_FORBIDDEN'],
    ['<svg><script>alert(1)</script></svg>', 'TEMPLATE_TAG_FORBIDDEN'],
    ['<object data="x"></object>', 'TEMPLATE_TAG_FORBIDDEN'],
    ['<meta http-equiv="refresh" content="0" />', 'TEMPLATE_TAG_FORBIDDEN'],
    ['<div onclick="alert(1)">x</div>', 'TEMPLATE_ATTRIBUTE_FORBIDDEN'],
    ['<div style="display:none">x</div>', 'TEMPLATE_ATTRIBUTE_FORBIDDEN'],
    ['<img src="https://evil.example/pixel.png" alt="" />', 'TEMPLATE_BAD_SRC'],
    ['<img src="data:image/png;base64,AAAA" alt="" />', 'TEMPLATE_BAD_SRC'],
    ['<img src="images/absente.png" alt="" />', 'TEMPLATE_BAD_SRC'],
    ['<img src="{{document.customer.title}}" alt="" />', 'TEMPLATE_BAD_SRC'],
    ['<div class="lx-dgi-securite">x</div>', 'TEMPLATE_RESERVED_CLASS'],
    ['<!-- commentaire -->', 'TEMPLATE_HTML_COMMENT'],
    ['<div>&#x3C;script&#x3E;</div>', 'TEMPLATE_BAD_ENTITY'],
    ['<div>DUP\u200bLICATA</div>', 'TEMPLATE_INVISIBLE_CHAR'],
    ['<div>DUPLICATA n° 1</div>', 'TEMPLATE_RESERVED_TEXT'],
    ['<div>DUPLI<b>CATA</b></div>', 'TEMPLATE_RESERVED_TEXT'],
    ['<div>Code DEF/DGI : 0000</div>', 'TEMPLATE_RESERVED_TEXT'],
    ['<div>Éléments de sécurité DGI</div>', 'TEMPLATE_RESERVED_TEXT'],
    ['<div>Environnement de test</div>', 'TEMPLATE_RESERVED_TEXT'],
    ['<img src="images/frise.png" alt="ISF 123" />', 'TEMPLATE_RESERVED_TEXT'],
    ['</div></main><div>', 'TEMPLATE_HTML_UNBALANCED'],
    ['<div><span></div></span>', 'TEMPLATE_HTML_UNBALANCED'],
    ['<div class=nue>x</div>', 'TEMPLATE_HTML_SYNTAX'],
    ['<div/>', 'TEMPLATE_HTML_SYNTAX'],
    ['<td {{#document.isInvoice}}class="a"{{/document.isInvoice}}>x</td>', 'TEMPLATE_HTML_SYNTAX'],
  ])('%s → %s', async (html, code) => {
    const r = await withBody(html);
    expect(codes(r.report)).toContain(code);
    expect(r.template).toBeNull();
  });

  it('« Détester » ou « attestation » ne déclenchent pas la règle du mot TEST', () => {
    const issues = new IssueList();
    const src = '<p>Attestation : à ne pas détester.</p>';
    checkHtml(
      maskMustache(src),
      { mode: 'source', file: 'g', original: src, images: new Set(), allowedSrc: () => false },
      issues,
    );
    expect(issues.errors).toEqual([]);
  });

  it('la position des erreurs est donnée en ligne et colonne', async () => {
    const r = await validate({ 'gabarit.html': `${exampleTemplate()}\n<script></script>` });
    const e = r.report.errors.find((x) => x.code === 'TEMPLATE_TAG_FORBIDDEN')!;
    expect(e.file).toBe('gabarit.html');
    expect(e.line).toBe(exampleTemplate().split('\n').length + 1);
    expect(e.column).toBe(1);
  });
});

// ─── CSS ─────────────────────────────────────────────────────────────────────

describe('CSS hostile', () => {
  const ctx = {
    file: 'style.css',
    families: new Set(['ocre titre']),
    images: new Map([['images/frise.png', 'data:image/png;base64,AAAA']]),
  };
  const compile = (css: string) => {
    const issues = new IssueList();
    const out = compileCss(css, ctx, issues);
    return { out, codes: codes(issues), issues };
  };

  it.each([
    ['@import url("https://evil.example/x.css");', 'CSS_AT_RULE_FORBIDDEN'],
    [
      '@font-face { font-family: X; src: url(https://evil.example/f.woff2); }',
      'CSS_AT_RULE_FORBIDDEN',
    ],
    ['@page { margin: 0; }', 'CSS_AT_RULE_FORBIDDEN'],
    ['@media print { .a { color: red; } }', 'CSS_AT_RULE_FORBIDDEN'],
    ['.a { background: url(https://evil.example/pixel.png); }', 'CSS_VALUE_FORBIDDEN'],
    ['.a { background-image: url("//evil.example/p.png"); }', 'CSS_VALUE_FORBIDDEN'],
    ['.a { background: url(images/absente.png); }', 'CSS_VALUE_FORBIDDEN'],
    ['.a { border-image: url(images/frise.png); }', 'CSS_PROPERTY_FORBIDDEN'],
    ['.lx-dgi-securite { display: none; }', 'CSS_SELECTOR_FORBIDDEN'],
    ['body .lx-dgi { visibility: hidden; }', 'CSS_SELECTOR_FORBIDDEN'],
    ['html { opacity: 0; }', 'CSS_SELECTOR_FORBIDDEN'],
    ['body { display: none; }', 'CSS_SELECTOR_FORBIDDEN'],
    [':root { color: red; }', 'CSS_SELECTOR_FORBIDDEN'],
    ['main ~ section { display: none; }', 'CSS_SELECTOR_FORBIDDEN'],
    [':scope ~ section { display: none; }', 'CSS_SELECTOR_FORBIDDEN'],
    [':scope + .x { color: red; }', 'CSS_SELECTOR_FORBIDDEN'],
    ['.a::before { color: red; }', 'CSS_SELECTOR_FORBIDDEN'],
    ['.a { display: none; }', 'CSS_VALUE_FORBIDDEN'],
    ['.a { visibility: hidden; }', 'CSS_PROPERTY_FORBIDDEN'],
    ['.a { opacity: 0; }', 'CSS_PROPERTY_FORBIDDEN'],
    ['.a { position: fixed; top: 0; }', 'CSS_PROPERTY_FORBIDDEN'],
    ['.a { position: absolute; }', 'CSS_PROPERTY_FORBIDDEN'],
    ['.a { z-index: 9999; }', 'CSS_PROPERTY_FORBIDDEN'],
    ['.a { transform: scale(0); }', 'CSS_PROPERTY_FORBIDDEN'],
    ['.a { filter: opacity(0); }', 'CSS_PROPERTY_FORBIDDEN'],
    ['.a { clip-path: inset(50%); }', 'CSS_PROPERTY_FORBIDDEN'],
    ['.a { overflow: hidden; height: 0; }', 'CSS_PROPERTY_FORBIDDEN'],
    ['.a { content: "DUPLICATA"; }', 'CSS_PROPERTY_FORBIDDEN'],
    ['.a { grid-area: 1 / 1; }', 'CSS_PROPERTY_FORBIDDEN'],
    ['.a { mix-blend-mode: screen; }', 'CSS_PROPERTY_FORBIDDEN'],
    ['.a { color: transparent; }', 'CSS_VALUE_FORBIDDEN'],
    ['.a { color: rgba(0, 0, 0, 0); }', 'CSS_VALUE_FORBIDDEN'],
    ['.a { color: #0000; }', 'CSS_VALUE_FORBIDDEN'],
    ['.a { font-size: 0; }', 'CSS_VALUE_FORBIDDEN'],
    ['.a { font-size: 2px; }', 'CSS_VALUE_FORBIDDEN'],
    ['.a { font-size: 0.1em; }', 'CSS_VALUE_FORBIDDEN'],
    ['.a { text-indent: -9999px; }', 'CSS_PROPERTY_FORBIDDEN'],
    ['.a { margin-left: -5000px; }', 'CSS_VALUE_FORBIDDEN'],
    ['.a { margin-top: calc(0px - 900px); }', 'CSS_VALUE_FORBIDDEN'],
    ['.a { width: 99999px; }', 'CSS_VALUE_FORBIDDEN'],
    ['.a { padding-left: 50vw; }', 'CSS_VALUE_FORBIDDEN'],
    ['.a { letter-spacing: -10px; }', 'CSS_VALUE_FORBIDDEN'],
    ['.a { color: var(--x); }', 'CSS_VALUE_FORBIDDEN'],
    ['.a { color: var(--lalanda-accent, transparent); }', 'CSS_VALUE_FORBIDDEN'],
    ['.a { --x: transparent; }', 'CSS_PROPERTY_FORBIDDEN'],
    ['.a { color: re\\64; }', 'CSS_ESCAPE_FORBIDDEN'],
    ['.a { .b { color: red; } }', 'CSS_NESTING_FORBIDDEN'],
    ['.a { font-family: Arial; }', 'CSS_VALUE_FORBIDDEN'],
    ['.a { background: image-set("x.png" 1x); }', 'CSS_VALUE_FORBIDDEN'],
    ['.a { width: attr(data-x); }', 'CSS_VALUE_FORBIDDEN'],
    ['.a { color: red }</style><script>alert(1)</script>', 'CSS_SYNTAX'],
    ['.a { color: red; ', 'CSS_SYNTAX'],
    ['/* commentaire jamais fermé', 'CSS_SYNTAX'],
  ])('%s → %s', (css, code) => {
    const r = compile(css);
    expect(r.codes).toContain(code);
    expect(r.out).toBeNull();
  });

  it('confinement : chaque sélecteur est préfixé ET placé dans @scope', () => {
    const r = compile(
      ':scope { font-size: 10px; } .a, td > .b:not(.c) { color: #111111; } :scope > .d { padding: 4px; }',
    );
    expect(r.codes).toEqual([]);
    const css = r.out!.css;
    expect(css.startsWith('@scope (.lx-modele) {')).toBe(true);
    expect(css).toContain('.lx-modele:scope { font-size: 10px; }');
    expect(css).toContain(
      '.lx-modele:scope .a, .lx-modele:scope td > .b:not(.c) { color: #111111; }',
    );
    expect(css).toContain('.lx-modele:scope > .d { padding: 4px; }');
    // Hors de l'enveloppe @scope, aucune règle.
    expect(css.trim().endsWith('}')).toBe(true);
    for (const line of css.split('\n').slice(1, -1)) {
      expect(line.startsWith('.lx-modele:scope')).toBe(true);
    }
  });

  it('variables du moteur, polices déclarées, images du paquet intégrées en data:', () => {
    const r = compile(
      ".a { color: var(--lalanda-accent); font-family: 'Ocre Titre', var(--lalanda-font-display), serif; background: url(images/frise.png) no-repeat; letter-spacing: -0.5px; box-shadow: 0 -1px 0 #cccccc; }",
    );
    expect(r.codes).toEqual([]);
    expect(r.out!.css).toContain('url("data:image/png;base64,AAAA")');
  });

  it('feuille de l’exemple : valide', () => {
    expect(compile(exampleCss()).codes).toEqual([]);
  });
});

// ─── Batterie et zone DGI imposée ────────────────────────────────────────────

describe('zone DGI imposée', () => {
  it('une mention oubliée par le gabarit : refus, avec le cas et la mention', async () => {
    const r = await validate({
      'gabarit.html': exampleTemplate().replace('{{document.total}}', ''),
    });
    const missing = r.report.errors.filter((e) => e.code === 'TEMPLATE_MENTION_MISSING');
    expect(missing.length).toBeGreaterThan(0);
    expect(missing[0]!.message).toContain('total');
    expect(missing[0]!.case).toBeDefined();
    expect(r.template).toBeNull();
  }, 120_000);

  it('les zones du moteur sont HORS du conteneur du modèle, le CSS du modèle confiné', async () => {
    const { template } = await validate();
    const cases = validationCases({ label: template!.label, version: '1.0.0' });
    const c = cases.find((x) => x.name.startsWith('environnement de test'))!;
    const qr = await qrCodeSvg(c.model.security!.qrContent);
    const r = renderDocumentHtml(c.model, qr, {
      template: template!,
      options: template!.defaults,
      identity: SAMPLE_IDENTITY,
      logos: sampleLogos(true),
    });
    const html = r.html;
    const main = html.indexOf('<main class="lx-modele">');
    const mainEnd = html.indexOf('</main>');
    const security = html.indexOf('<section class="lx-dgi lx-dgi-securite">');
    const top = html.indexOf('<div class="lx-dgi lx-dgi-haut">');
    expect(main).toBeGreaterThan(-1);
    expect(top).toBeGreaterThan(-1);
    expect(top).toBeLessThan(main);
    expect(security).toBeGreaterThan(mainEnd);
    // Un seul conteneur ; le gabarit ne le referme pas.
    expect(html.split('</main>').length).toBe(2);
    // Le QR, le cadre DGI, DUPLICATA et le bandeau de test sont dans les zones du moteur.
    const inside = html.slice(main, mainEnd);
    expect(inside).not.toContain(qr);
    expect(inside).not.toContain('DUPLICATA');
    expect(inside).not.toContain('Éléments de sécurité DGI');
    expect(html.slice(security)).toContain(qr);
    expect(html.slice(top, main)).toContain('DUPLICATA n° 2');
    expect(html.slice(top, main)).toContain('Environnement de test DGI');
    // Filigrane du moteur et en-tête / pied Chromium : hors du HTML du modèle.
    expect(html).toContain('<div class="dgi-watermark">TEST</div>');
    expect(r.headerTemplate).toContain('DUPLICATA n° 2');
    expect(r.footerTemplate).toContain('modèle Ocre (sur mesure) 1.0.0');
    // CSP : aucun script, aucune ressource hors data:.
    expect(html).toContain("default-src 'none'");
    expect(html.replaceAll('xmlns="http://www.w3.org/2000/svg"', '')).not.toMatch(/https?:\/\//);
    expect(html).toContain('data-template="sur-mesure@' + CUSTOM_ENGINE_VERSION + '"');
    // Le CSS du paquet n'apparaît que dans l'enveloppe @scope.
    const scope = html.indexOf('@scope (.lx-modele) {');
    expect(scope).toBeGreaterThan(-1);
    expect(html.indexOf('.lx-modele:scope .tete')).toBeGreaterThan(scope);
  }, 120_000);

  it('rendu déterministe', async () => {
    const { template } = await validate();
    const c = validationCases({ label: template!.label, version: '1.0.0' })[0]!;
    const qr = await qrCodeSvg(c.model.security!.qrContent);
    const p = {
      template: template!,
      options: template!.defaults,
      identity: SAMPLE_IDENTITY,
      logos: sampleLogos(true),
    };
    expect(renderDocumentHtml(c.model, qr, p).html).toBe(renderDocumentHtml(c.model, qr, p).html);
  }, 120_000);

  it('défense en profondeur : une sortie de gabarit hors règles est refusée au rendu', async () => {
    const { template } = await validate();
    // Simule un trou du contrôle source : on force un arbre qui produit </main>.
    const issues = new IssueList();
    const nodes = parseTemplate(
      '<div>{{document.title}}</div></main><script>x</script>',
      'g',
      issues,
    )!;
    const bad = compileCustomTemplate({
      packageId: null,
      manifest: template!.manifest,
      digest: template!.digest,
      nodes,
      css: '',
      fontFaces: '',
      images: new Map(),
    });
    const c = validationCases({ label: bad.label, version: '1.0.0' }).find(
      (x) => x.name === 'pro forma',
    )!;
    expect(() =>
      renderDocumentHtml(c.model, null, {
        template: bad,
        options: bad.defaults,
        identity: SAMPLE_IDENTITY,
        logos: sampleLogos(false),
      }),
    ).toThrow(/Sortie du gabarit refusée/);
  }, 120_000);
});

// ─── Contrat de données et guide ─────────────────────────────────────────────

describe('contrat de données', () => {
  it('le guide des créateurs liste chaque variable du contrat', () => {
    const guide = readFileSync(GUIDE, 'utf8');
    for (const v of variableList()) {
      expect(guide, v.path).toContain(`\`${v.path}\``);
    }
  });

  it('le guide documente chaque code d’erreur émis par la validation', () => {
    const guide = readFileSync(GUIDE, 'utf8');
    const sources = readdirSync(HERE)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => readFileSync(join(HERE, f), 'utf8'))
      .join('\n');
    const emitted = new Set(
      [
        ...sources.matchAll(
          /'((?:ZIP|PACKAGE|MANIFEST|FONT|IMAGE|TEMPLATE|MUSTACHE|CSS)_[A-Z_0-9]+)'/g,
        ),
      ].map((m) => m[1]!),
    );
    for (const code of emitted) expect(guide, code).toContain(code);
  });

  it('une archive écrite par la commande locale se relit à l’identique', () => {
    const files = exampleFiles();
    const issues = new IssueList();
    const back = filesFromArchive(zipOf(files), issues);
    expect(issues.errors).toEqual([]);
    expect(packageDigest(back)).toBe(
      packageDigest(
        collectPackageFiles(
          [...files].map(([name, data]) => ({ name, directory: false, data, size: data.length })),
          new IssueList(),
        ),
      ),
    );
  });
});
