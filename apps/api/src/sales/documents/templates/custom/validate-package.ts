// Validation d'un paquet de modèle sur mesure — ADR-0029 § 5.
//
// UN SEUL chemin de validation, partagé par l'API (téléversement) et la
// commande locale (`pnpm --filter @lalanda/api modele:valider <dossier>`) :
// ce qui passe en local passe au téléversement, et inversement.
//
//   1. fichiers (chemins, plafonds)        — package-files.ts
//   2. manifeste (schéma strict)           — manifest.ts
//   3. polices WOFF2 et images assainies
//   4. gabarit : Mustache, variables contre le contrat, HTML admis, texte réservé
//   5. CSS : liste blanche, confinement
//   6. batterie de rendu : chaque sorte de document passe le vérificateur de
//      mentions DGI (le même qu'à l'impression).

import { deflateSync } from 'node:zlib';

import {
  validateAndSanitizeImage,
  type ImageRejectionCode,
} from '../../../../account/image-validation.js';
import { qrCodeSvg } from '../../invoice-qr.js';
import { TemplateDgiContentError } from '../dgi-content.js';
import { renderDocumentHtml } from '../template-engine.js';
import {
  LOGO_VARIANTS,
  type FrozenIdentity,
  type LogoVariant,
  type RenderLogo,
} from '../template.contract.js';
import { resolveCustomOptions } from './custom-options.js';
import {
  CustomTemplateOutputError,
  compileCustomTemplate,
  customLayoutLabel,
  type CompiledCustomTemplate,
} from './custom-template.js';
import { compileCss } from '../../../../security/template-css-policy.js';
import { DATA_SCHEMA } from './data-contract.js';
import { checkHtml, maskMustache } from './html-policy.js';
import { ManifestSchema, type TemplateManifest } from './manifest.js';
import { MustacheRenderError, checkTemplate, parseTemplate } from './mustache.js';
import { filesFromArchive, packageDigest, type PackageFiles } from './package-files.js';
import { IssueList, type PackageIssue } from './report.js';
import { validationCases } from './validation-cases.js';
import { crc32 } from '../../../../security/zip-reader.js';

export interface PackageSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  contract: number;
  author: TemplateManifest['author'];
  publisher: TemplateManifest['publisher'];
  license: string;
  price: TemplateManifest['price'];
}

export interface ValidationReport {
  ok: boolean;
  errors: PackageIssue[];
  warnings: PackageIssue[];
  truncated: boolean;
  /** Empreinte canonique (ADR-0029 § 1), si les fichiers ont pu être lus. */
  digest: string | null;
  manifest: PackageSummary | null;
  files: Array<{ path: string; bytes: number }>;
  /** Cas de la batterie rendus sans erreur. */
  cases: Array<{ name: string; ok: boolean }>;
}

export interface ValidatedPackage {
  report: ValidationReport;
  /** Présent si et seulement si `report.ok`. */
  template: CompiledCustomTemplate | null;
  files: PackageFiles;
}

function decodeUtf8(data: Buffer, file: string, issues: IssueList): string | null {
  try {
    const s = new TextDecoder('utf-8', { fatal: true }).decode(data);
    return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
  } catch {
    issues.error({ code: 'PACKAGE_NOT_UTF8', message: 'Fichier texte non encodé en UTF-8.', file });
    return null;
  }
}

function summaryOf(m: TemplateManifest): PackageSummary {
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    description: m.description,
    contract: m.contract,
    author: m.author,
    publisher: m.publisher,
    license: m.license,
    price: m.price,
  };
}

function parseManifest(files: PackageFiles, issues: IssueList): TemplateManifest | null {
  const f = files.get('manifest.json');
  if (!f) return null;
  const text = decodeUtf8(f.data, 'manifest.json', issues);
  if (text === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    issues.error({
      code: 'MANIFEST_INVALID_JSON',
      message: `JSON illisible : ${(err as Error).message}`,
      file: 'manifest.json',
    });
    return null;
  }
  const parsed = ManifestSchema.safeParse(json);
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      issues.error({
        code: 'MANIFEST_INVALID',
        message: `${i.path.length > 0 ? `« ${i.path.join('.')} » : ` : ''}${
          i.code === 'unrecognized_keys' ? `champ(s) inconnu(s) ${i.keys.join(', ')}` : i.message
        }`,
        file: 'manifest.json',
      });
    }
    return null;
  }
  return parsed.data;
}

/** `@font-face` des polices du paquet ; erreurs si un fichier manque ou n'est pas un WOFF2. */
function packageFonts(
  manifest: TemplateManifest,
  files: PackageFiles,
  issues: IssueList,
): { css: string; families: Set<string> } {
  const families = new Set<string>();
  const faces: string[] = [];
  const used = new Set<string>();
  for (const [n, f] of manifest.fonts.entries()) {
    const file = files.get(f.file);
    if (!file) {
      issues.error({
        code: 'MANIFEST_FONT_MISSING',
        message: `« fonts.${n}.file » : ${f.file} absent du paquet.`,
        file: 'manifest.json',
      });
      continue;
    }
    if (file.data.length < 48 || file.data.toString('latin1', 0, 4) !== 'wOF2') {
      issues.error({
        code: 'FONT_NOT_WOFF2',
        message: 'Ce fichier n’est pas une police WOFF2.',
        file: f.file,
      });
      continue;
    }
    used.add(f.file);
    families.add(f.family.toLowerCase());
    faces.push(
      `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:block;src:url(data:font/woff2;base64,${file.data.toString('base64')}) format('woff2');}`,
    );
  }
  for (const f of files.values()) {
    if (f.kind === 'font' && !used.has(f.path)) {
      issues.warn({
        code: 'FONT_UNUSED',
        message:
          'Police présente mais non déclarée dans « fonts » du manifeste : elle est ignorée.',
        file: f.path,
      });
    }
  }
  return { css: faces.join('\n'), families };
}

/** Codes de refus d'une image du paquet (porte de la photo de profil). */
const IMAGE_CODES: Record<ImageRejectionCode, string> = {
  EMPTY_FILE: 'IMAGE_EMPTY',
  FILE_TOO_LARGE: 'IMAGE_TOO_LARGE',
  UNSUPPORTED_IMAGE_TYPE: 'IMAGE_UNSUPPORTED_TYPE',
  IMAGE_DIMENSIONS_REJECTED: 'IMAGE_DIMENSIONS_REJECTED',
  MALFORMED_IMAGE: 'IMAGE_MALFORMED',
};

function packageImages(files: PackageFiles, issues: IssueList): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of files.values()) {
    if (f.kind !== 'image') continue;
    const v = validateAndSanitizeImage(f.data);
    if (!v.ok) {
      issues.error({ code: IMAGE_CODES[v.code], message: v.message, file: f.path });
      continue;
    }
    out.set(f.path, `data:${v.contentType};base64,${v.bytes.toString('base64')}`);
  }
  return out;
}

// ── Logos fictifs de la batterie (PNG valides, générés) ──────────────────────

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function solidPng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x += 1) row.set(rgb, 1 + x * 3);
  const rows = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const SAMPLE_LOGOS: Record<LogoVariant, RenderLogo> = (() => {
  const sizes: Record<LogoVariant, [number, number, [number, number, number]]> = {
    primary: [64, 64, [15, 81, 50]],
    horizontal: [160, 48, [29, 78, 216]],
    symbol: [48, 48, [154, 52, 18]],
    light: [64, 64, [240, 240, 240]],
  };
  const out = {} as Record<LogoVariant, RenderLogo>;
  for (const v of LOGO_VARIANTS) {
    const [w, h, rgb] = sizes[v];
    out[v] = {
      dataUri: `data:image/png;base64,${solidPng(w, h, rgb).toString('base64')}`,
      width: w,
      height: h,
    };
  }
  return out;
})();

const NO_LOGOS: Record<LogoVariant, RenderLogo | null> = {
  primary: null,
  horizontal: null,
  symbol: null,
  light: null,
};

/** Identité fictive de la batterie et de l'aperçu local. */
export const SAMPLE_IDENTITY: FrozenIdentity = {
  primaryColor: null,
  secondaryColor: '#9a3412',
  font: null,
  logos: { primary: null, horizontal: null, symbol: null, light: null },
};

export function sampleLogos(withLogos: boolean): Record<LogoVariant, RenderLogo | null> {
  return withLogos ? SAMPLE_LOGOS : NO_LOGOS;
}

/** Rend chaque cas de la batterie ; les défauts vont dans `issues`. */
async function runBattery(
  template: CompiledCustomTemplate,
  issues: IssueList,
): Promise<Array<{ name: string; ok: boolean }>> {
  const out: Array<{ name: string; ok: boolean }> = [];
  for (const c of validationCases({ label: template.label, version: template.manifest.version })) {
    const options = resolveCustomOptions(
      template,
      { palette: c.palette, accent: null, font: null },
      SAMPLE_IDENTITY,
    );
    const qr = c.model.security ? await qrCodeSvg(c.model.security.qrContent) : null;
    try {
      renderDocumentHtml(c.model, qr, {
        template,
        options,
        identity: SAMPLE_IDENTITY,
        logos: sampleLogos(c.withLogos),
      });
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false });
      if (err instanceof TemplateDgiContentError) {
        for (const miss of err.missing) {
          issues.error({
            code: 'TEMPLATE_MENTION_MISSING',
            message: `Mention obligatoire absente : ${miss.what} (« ${miss.text.slice(0, 80)} »). Le gabarit doit l’imprimer telle quelle, d’un seul tenant.`,
            file: 'gabarit.html',
            case: c.name,
          });
        }
      } else if (err instanceof MustacheRenderError || err instanceof CustomTemplateOutputError) {
        issues.error({
          code: err instanceof MustacheRenderError ? err.code : 'TEMPLATE_OUTPUT_REJECTED',
          message: err.message,
          file: 'gabarit.html',
          case: c.name,
        });
      } else {
        throw err;
      }
    }
  }
  return out;
}

/**
 * Valide des fichiers (archive déjà lue ou dossier). `packageId` : identifiant
 * de l'enregistrement installé, `null` pour une validation hors installation.
 */
export interface ValidateOptions {
  /**
   * Batterie de rendu (défaut : oui). Au RENDU d'une facture, le paquet — déjà
   * validé à l'installation et vérifié par son empreinte — est recompilé sans
   * la rejouer : mêmes règles d'analyse, coût d'un seul rendu.
   */
  battery?: boolean;
}

export async function validatePackageFiles(
  files: PackageFiles,
  issues: IssueList = new IssueList(),
  packageId: string | null = null,
  opts: ValidateOptions = {},
): Promise<ValidatedPackage> {
  const report = (
    manifest: TemplateManifest | null,
    digest: string | null,
    cases: ValidationReport['cases'] = [],
  ): ValidationReport => ({
    ok: issues.ok,
    errors: issues.errors,
    warnings: issues.warnings,
    truncated: issues.truncated,
    digest,
    manifest: manifest ? summaryOf(manifest) : null,
    files: [...files.values()]
      .map((f) => ({ path: f.path, bytes: f.data.length }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    cases,
  });
  const digest = files.size > 0 ? packageDigest(files) : null;
  const manifest = parseManifest(files, issues);

  const images = packageImages(files, issues);
  const fonts = manifest
    ? packageFonts(manifest, files, issues)
    : { css: '', families: new Set<string>() };

  const tpl = files.get('gabarit.html');
  const tplText = tpl ? decodeUtf8(tpl.data, 'gabarit.html', issues) : null;
  const nodes = tplText !== null ? parseTemplate(tplText, 'gabarit.html', issues) : null;
  if (tplText !== null && nodes) {
    checkTemplate(nodes, DATA_SCHEMA, tplText, 'gabarit.html', issues);
    const logoTags = /^\{\{\s*brand\.(logo|logos\.(primary|horizontal|symbol|light))\s*\}\}$/;
    checkHtml(
      maskMustache(tplText),
      {
        mode: 'source',
        file: 'gabarit.html',
        original: tplText,
        images: new Set(images.keys()),
        allowedSrc: (raw) => logoTags.test(raw),
      },
      issues,
    );
  }

  const style = files.get('style.css');
  const styleText = style ? decodeUtf8(style.data, 'style.css', issues) : null;
  const css =
    styleText !== null
      ? compileCss(styleText, { file: 'style.css', families: fonts.families, images }, issues)
      : null;

  if (!issues.ok || !manifest || !nodes || !css || digest === null) {
    return { report: report(manifest, digest), template: null, files };
  }

  const template = compileCustomTemplate({
    packageId,
    manifest,
    digest,
    nodes,
    css: css.css,
    fontFaces: fonts.css,
    images,
  });
  const cases = opts.battery === false ? [] : await runBattery(template, issues);
  return { report: report(manifest, digest, cases), template: issues.ok ? template : null, files };
}

/** Valide une archive téléversée. */
export async function validateArchive(
  archive: Buffer,
  packageId: string | null = null,
  opts: ValidateOptions = {},
): Promise<ValidatedPackage> {
  const issues = new IssueList();
  const files = filesFromArchive(archive, issues);
  if (!issues.ok) {
    return {
      report: {
        ok: false,
        errors: issues.errors,
        warnings: issues.warnings,
        truncated: issues.truncated,
        digest: null,
        manifest: null,
        files: [...files.values()].map((f) => ({ path: f.path, bytes: f.data.length })),
        cases: [],
      },
      template: null,
      files,
    };
  }
  return validatePackageFiles(files, issues, packageId, opts);
}
