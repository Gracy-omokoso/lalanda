// Paquets de carte sur mesure : validation et compilation — ADR-0069 § 6.
//
// Deux formats, une même archive ZIP (lecteur, plafonds, chemins et empreinte
// canonique d'ADR-0029 § 1) :
//
//   (1) `lalanda.modele-carte` — paquet CODE : `gabarit.html` (Mustache strict,
//       contrôlé contre le contrat de données) et `style.css` (confiné, liste
//       blanche). Contenu NON FIABLE : même confinement qu'ADR-0029.
//   (2) `lalanda.modele-carte-graphiste` — gabarit GRAPHISTE : fonds recto/verso
//       à 300 dpi au moins, zones nommées en mm ; Lalanda superpose les données.
//
// Dans les deux cas, le QR de vérification et sa mention sont posés par le
// MOTEUR, dans une couche hors du conteneur du gabarit (z-index, fond blanc) :
// le CSS du paquet ne peut ni les atteindre ni les recouvrir (pas de position,
// de z-index, de transform ni d'opacité dans la liste blanche).

import { z } from 'zod';

import { CARD_QR_MIN_MM, type CardFace, type CardKind } from '@lalanda/shared/hr';

import { validateAndSanitizeImage } from '../../../account/image-validation.js';
import { compileCss } from '../../../security/template-css-policy.js';
import { checkHtml, maskMustache } from '../../../sales/documents/templates/custom/html-policy.js';
import {
  FontDeclarationSchema,
  SEMVER,
  TEMPLATE_ID,
} from '../../../sales/documents/templates/custom/manifest.js';
import {
  checkTemplate,
  parseTemplate,
  renderTemplate,
} from '../../../sales/documents/templates/custom/mustache.js';
import {
  filesFromArchive,
  packageDigest,
  type PackageFiles,
} from '../../../sales/documents/templates/custom/package-files.js';
import { IssueList, type PackageIssue } from '../../../sales/documents/templates/custom/report.js';
import {
  FONT_IDS,
  fontStack,
  type FontId,
} from '../../../sales/documents/templates/invoice-fonts.js';
import { esc } from '../../../sales/documents/invoice-document-html.js';
import type { RenderedCard } from '../card-document.js';
import { bleedBox, cardFormat, mm, mmToPx, type CardFormat } from '../card-formats.js';
import type { CardData, CardTheme } from '../card-model.js';
import { CARD_DATA_SCHEMA, CARD_IMAGE_TOKENS, cardTemplateData } from './card-data-contract.js';

export const CODE_FORMAT = 'lalanda.modele-carte';
export const DESIGNER_FORMAT = 'lalanda.modele-carte-graphiste';
export const CARD_ENGINE_VERSION = '1.0.0';

const text = (max: number) => z.string().trim().min(1).max(max);
const Faces = z
  .array(z.enum(['recto', 'verso']))
  .min(1)
  .max(2)
  .refine((f) => f[0] === 'recto' && new Set(f).size === f.length, {
    message: 'Faces attendues : ["recto"] ou ["recto", "verso"].',
  });

const Common = {
  formatVersion: z.literal(1),
  id: z.string().min(3).max(64).regex(TEMPLATE_ID, 'Identifiant attendu : « editeur.nom ».'),
  name: text(60),
  description: text(240),
  version: z.string().regex(SEMVER, 'Version attendue : MAJEUR.MINEUR.CORRECTIF.'),
  kind: z.enum(['badge', 'business']),
  orientation: z.enum(['vertical', 'horizontal']),
  faces: Faces,
  author: z
    .object({
      name: text(120),
      email: z.string().email().nullable().optional(),
      url: z.string().url().nullable().optional(),
    })
    .strict(),
  license: text(64),
  fonts: z.array(FontDeclarationSchema).max(6).default([]),
};

const Mm = z.number().min(0).max(100);

export const CodeManifestSchema = z
  .object({
    format: z.literal(CODE_FORMAT),
    contract: z.literal(1),
    ...Common,
    /** Emplacement du QR imposé (carte de service), en mm depuis le coin de la COUPE. */
    qr: z
      .object({ face: z.enum(['recto', 'verso']), x: Mm, y: Mm, size: Mm })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();
export type CodeManifest = z.infer<typeof CodeManifestSchema>;

export const ZONE_NAMES = [
  'prenom',
  'nom',
  'nom-complet',
  'poste',
  'service',
  'matricule',
  'telephone',
  'email',
  'site',
  'adresse',
  'organisation',
  'slogan',
  'photo',
  'logo',
  'logo-clair',
  'qr',
  'qr-vcard',
] as const;
export type ZoneName = (typeof ZONE_NAMES)[number];
const IMAGE_ZONES: ReadonlySet<string> = new Set(['photo', 'logo', 'logo-clair']);

const ZoneSchema = z
  .object({
    name: z.enum(ZONE_NAMES),
    face: z.enum(['recto', 'verso']),
    x: Mm,
    y: Mm,
    width: z.number().min(1).max(100),
    height: z.number().min(1).max(100),
    font: z.string().min(1).max(64).optional(),
    size: z.number().min(6).max(48).optional(),
    weight: z
      .number()
      .int()
      .refine((n) => n >= 100 && n <= 900 && n % 100 === 0, 'Graisse : 100, 200… 900.')
      .optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Couleur opaque attendue : #rrggbb.')
      .optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    uppercase: z.boolean().optional(),
    fit: z.enum(['cover', 'contain']).optional(),
    radius: z.number().min(0).max(50).optional(),
  })
  .strict();
export type DesignerZone = z.infer<typeof ZoneSchema>;

export const DesignerManifestSchema = z
  .object({
    format: z.literal(DESIGNER_FORMAT),
    ...Common,
    backgrounds: z
      .object({
        recto: z.string().regex(/^images\/[a-z0-9][a-z0-9._-]*\.(png|jpe?g)$/),
        verso: z
          .string()
          .regex(/^images\/[a-z0-9][a-z0-9._-]*\.(png|jpe?g)$/)
          .optional(),
      })
      .strict(),
    zones: z.array(ZoneSchema).min(1).max(40),
  })
  .strict();
export type DesignerManifest = z.infer<typeof DesignerManifestSchema>;

export type CardPackageManifest = CodeManifest | DesignerManifest;

export interface CompiledCardPackage {
  format: 'code' | 'designer';
  manifest: CardPackageManifest;
  digest: string;
  kind: CardKind;
  cardFormat: CardFormat;
  faces: CardFace[];
  /** `@font-face` des polices du paquet (hors `@scope`). */
  fontFaces: string;
  /** Polices intégrées de Lalanda utilisées (thème + zones). */
  builtinFonts: FontId[];
  render(d: CardData, t: CardTheme, faces: readonly CardFace[]): RenderedCard;
}

export interface CardValidationReport {
  ok: boolean;
  errors: PackageIssue[];
  warnings: PackageIssue[];
  truncated: boolean;
  digest: string | null;
  manifest: {
    id: string;
    name: string;
    version: string;
    kind: string;
    orientation: string;
    format: string;
  } | null;
  cases: string[];
}

// ── Commun ──────────────────────────────────────────────────────────────────

function utf8(data: Buffer, file: string, issues: IssueList): string | null {
  try {
    const s = new TextDecoder('utf-8', { fatal: true }).decode(data);
    return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
  } catch {
    issues.error({ code: 'PACKAGE_NOT_UTF8', message: 'Fichier texte non encodé en UTF-8.', file });
    return null;
  }
}

function zodIssues(err: z.ZodError, issues: IssueList): void {
  for (const i of err.issues) {
    issues.error({
      code: 'MANIFEST_INVALID',
      message: `${i.path.length > 0 ? `« ${i.path.join('.')} » : ` : ''}${
        i.code === 'unrecognized_keys' ? `champ(s) inconnu(s) ${i.keys.join(', ')}` : i.message
      }`,
      file: 'manifest.json',
    });
  }
}

function images(files: PackageFiles, issues: IssueList) {
  const out = new Map<string, { dataUri: string; width: number; height: number }>();
  for (const f of files.values()) {
    if (f.kind !== 'image') continue;
    const v = validateAndSanitizeImage(f.data);
    if (!v.ok) {
      issues.error({ code: `IMAGE_${v.code}`, message: v.message, file: f.path });
      continue;
    }
    out.set(f.path, {
      dataUri: `data:${v.contentType};base64,${v.bytes.toString('base64')}`,
      width: v.width,
      height: v.height,
    });
  }
  return out;
}

function packageFonts(
  decl: CardPackageManifest['fonts'],
  files: PackageFiles,
  issues: IssueList,
): { css: string; families: Set<string> } {
  const families = new Set<string>();
  const faces: string[] = [];
  for (const [n, f] of decl.entries()) {
    const file = files.get(f.file);
    if (!file || file.data.length < 48 || file.data.toString('latin1', 0, 4) !== 'wOF2') {
      issues.error({
        code: file ? 'FONT_NOT_WOFF2' : 'MANIFEST_FONT_MISSING',
        message: file
          ? 'Ce fichier n’est pas une police WOFF2.'
          : `« fonts.${n}.file » : ${f.file} absent du paquet.`,
        file: file ? f.file : 'manifest.json',
      });
      continue;
    }
    families.add(f.family.toLowerCase());
    faces.push(
      `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:block;src:url(data:font/woff2;base64,${file.data.toString('base64')}) format('woff2');}`,
    );
  }
  return { css: faces.join('\n'), families };
}

/** Le carré du QR (et sa mention, 2,4 mm dessous) tient dans la zone de sécurité. */
function checkQrPlacement(
  q: { x: number; y: number; size: number },
  f: CardFormat,
  where: string,
  issues: IssueList,
): void {
  if (q.size < CARD_QR_MIN_MM) {
    issues.error({
      code: 'CARD_QR_TOO_SMALL',
      message: `${where} : le QR doit mesurer au moins ${CARD_QR_MIN_MM} mm de côté (${q.size} mm).`,
      file: 'manifest.json',
    });
  }
  if (
    q.x < f.safe ||
    q.y < f.safe ||
    q.x + q.size > f.width - f.safe ||
    q.y + q.size + 2.4 > f.height - f.safe
  ) {
    issues.error({
      code: 'CARD_QR_OUTSIDE_SAFE_ZONE',
      message: `${where} : le QR et sa mention (2,4 mm dessous) doivent tenir dans la zone de sécurité (${f.safe} mm des bords de coupe, carte ${f.width} × ${f.height} mm).`,
      file: 'manifest.json',
    });
  }
}

/** Couche du moteur : QR de vérification et mention, au-dessus du gabarit. */
function engineQrLayer(
  d: CardData,
  q: { x: number; y: number; size: number },
  f: CardFormat,
): string {
  if (!d.verifyQrSvg) return '';
  const x = q.x + f.bleed;
  const y = q.y + f.bleed;
  return `<div class="lx-moteur-qr" style="left:${mm(x)};top:${mm(y)};width:${mm(q.size)};height:${mm(q.size)}">${d.verifyQrSvg}</div><div class="lx-moteur-mention" style="left:${mm(x - 2)};top:${mm(y + q.size + 0.2)};width:${mm(q.size + 4)}">Vérifier : ${esc(d.verifyLabel)}</div>`;
}

const ENGINE_CSS = `
  .lx-moteur-qr { position: absolute; z-index: 20; background: #ffffff; }
  .lx-moteur-qr svg { display: block; width: 100%; height: 100%; }
  .lx-moteur-mention { position: absolute; z-index: 20; background: #ffffff; color: #111111; font: 600 1.6mm/2mm Arial, sans-serif; text-align: center; white-space: nowrap; }
`;

/** Texte qu'un gabarit ne peut pas contrefaire (couche du moteur). */
const RESERVED_CARD_TEXT: ReadonlyArray<[RegExp, string]> = [
  [/v[ée]rifi(er|cation)\s*:?\s*\S*lalanda/iu, 'Vérifier : lalanda.co/v'],
  [/carte\s+non\s+valide/iu, 'Carte non valide'],
  [/en\s+fonction/iu, 'En fonction'],
];

// ── (1) Paquet code ─────────────────────────────────────────────────────────

function compileCode(
  m: CodeManifest,
  files: PackageFiles,
  digest: string,
  issues: IssueList,
): CompiledCardPackage | null {
  const f = cardFormat(m.kind, m.orientation);
  if (m.kind === 'badge') {
    if (!m.qr) {
      issues.error({
        code: 'CARD_QR_REQUIRED',
        message: '« qr » : une carte de service déclare l’emplacement du QR de vérification.',
        file: 'manifest.json',
      });
    } else {
      if (!m.faces.includes(m.qr.face)) {
        issues.error({
          code: 'CARD_QR_FACE',
          message: '« qr.face » : face absente de « faces ».',
          file: 'manifest.json',
        });
      }
      checkQrPlacement(m.qr, f, '« qr »', issues);
    }
  } else if (m.qr) {
    issues.error({
      code: 'CARD_QR_NOT_ALLOWED',
      message: '« qr » : une carte de visite n’a pas de QR de vérification (mettre null).',
      file: 'manifest.json',
    });
  }
  const imgs = images(files, issues);
  const fonts = packageFonts(m.fonts, files, issues);
  const tpl = files.get('gabarit.html');
  if (!tpl) {
    issues.error({
      code: 'PACKAGE_MISSING_FILE',
      message: 'gabarit.html manquant.',
      file: 'gabarit.html',
    });
  }
  const src = tpl ? utf8(tpl.data, 'gabarit.html', issues) : null;
  const nodes = src !== null ? parseTemplate(src, 'gabarit.html', issues) : null;
  if (src !== null && nodes) {
    checkTemplate(nodes, CARD_DATA_SCHEMA, src, 'gabarit.html', issues);
    const imgTags = /^\{\{\s*(person\.photo|organization\.logo|organization\.logoLight)\s*\}\}$/;
    checkHtml(
      maskMustache(src),
      {
        mode: 'source',
        file: 'gabarit.html',
        original: src,
        images: new Set(imgs.keys()),
        allowedSrc: (raw) => imgTags.test(raw),
      },
      issues,
    );
    const plain = maskMustache(src).replace(/<[^>]*>/g, ' ');
    for (const [re, label] of RESERVED_CARD_TEXT) {
      if (re.test(plain)) {
        issues.error({
          code: 'TEMPLATE_RESERVED_TEXT',
          message: `Le texte « ${label} » est réservé au moteur (vérification de la carte).`,
          file: 'gabarit.html',
        });
      }
    }
  }
  const style = files.get('style.css');
  if (!style) {
    issues.error({
      code: 'PACKAGE_MISSING_FILE',
      message: 'style.css manquant.',
      file: 'style.css',
    });
  }
  const styleText = style ? utf8(style.data, 'style.css', issues) : null;
  const css =
    styleText !== null
      ? compileCss(
          styleText,
          {
            file: 'style.css',
            families: fonts.families,
            images: new Map([...imgs].map(([k, v]) => [k, v.dataUri])),
          },
          issues,
        )
      : null;
  if (!issues.ok || !nodes || !css) return null;

  const imagePaths = new Set(imgs.keys());
  const box = bleedBox(f);
  return {
    format: 'code',
    manifest: m,
    digest,
    kind: m.kind,
    cardFormat: f,
    faces: m.faces,
    fontFaces: fonts.css,
    builtinFonts: [],
    render(d, t, faces) {
      const vars = `.lx-modele { --lalanda-accent: ${t.accent}; --lalanda-on-accent: ${t.onAccent}; --lalanda-soft: ${t.soft}; --lalanda-line: ${t.line}; --lalanda-side: ${t.dark}; --lalanda-on-side: ${t.onDark}; --lalanda-font-body: ${t.body}; --lalanda-font-display: ${t.display}; --lalanda-font-code: ${t.body}; font-family: ${t.body}; }`;
      const present = new Set<string>();
      if (d.photo) present.add(CARD_IMAGE_TOKENS.photo);
      if (d.org.logo) present.add(CARD_IMAGE_TOKENS.logo);
      if (d.org.logoLight) present.add(CARD_IMAGE_TOKENS.logoLight);
      const out = faces
        .filter((face) => m.faces.includes(face))
        .map((face) => {
          const html = renderTemplate(nodes, cardTemplateData(d, face));
          const scratch = new IssueList();
          const ok = checkHtml(
            html,
            {
              mode: 'output',
              file: 'gabarit.html',
              images: imagePaths,
              allowedSrc: (s) => present.has(s),
            },
            scratch,
          );
          if (!ok) {
            throw new Error(
              `Sortie du gabarit refusée : ${scratch.errors[0]?.message ?? 'HTML inattendu'}`,
            );
          }
          const body = html.replace(/ src="([^"]*)"/g, (_all, s: string) => {
            if (s === CARD_IMAGE_TOKENS.photo) return ` src="${d.photo!.dataUri}"`;
            if (s === CARD_IMAGE_TOKENS.logo) return ` src="${d.org.logo!.dataUri}"`;
            if (s === CARD_IMAGE_TOKENS.logoLight) return ` src="${d.org.logoLight!.dataUri}"`;
            return ` src="${imgs.get(s)!.dataUri}"`;
          });
          const qr = m.qr && m.qr.face === face ? engineQrLayer(d, m.qr, f) : '';
          return {
            face,
            html: `<main class="lx-modele" style="width:${mm(box.width)};height:${mm(box.height)}">${body}</main>${qr}`,
          };
        });
      return {
        css: `.lx-modele { position: absolute; left: 0; top: 0; overflow: hidden; isolation: isolate; z-index: 0; display: flow-root; color: #111827; font-size: 2.4mm; line-height: 1.25; }\n${vars}\n${ENGINE_CSS}\n${css.css}`,
        faces: out,
        paper: '#ffffff',
        sample: d.sample,
      };
    },
  };
}

// ── (2) Gabarit graphiste ───────────────────────────────────────────────────

function zoneText(d: CardData, name: ZoneName): string | null {
  switch (name) {
    case 'prenom':
      return d.firstName;
    case 'nom':
      return d.lastName;
    case 'nom-complet':
      return d.displayName;
    case 'poste':
      return d.jobTitle;
    case 'service':
      return d.department;
    case 'matricule':
      return d.employeeNumber;
    case 'telephone':
      return d.workPhone ?? d.org.phone;
    case 'email':
      return d.workEmail;
    case 'site':
      return d.org.website;
    case 'adresse':
      return d.org.address;
    case 'organisation':
      return d.org.name;
    case 'slogan':
      return d.org.slogan;
    default:
      return null;
  }
}

function compileDesigner(
  m: DesignerManifest,
  files: PackageFiles,
  digest: string,
  issues: IssueList,
): CompiledCardPackage | null {
  const f = cardFormat(m.kind, m.orientation);
  const box = bleedBox(f);
  const imgs = images(files, issues);
  const fonts = packageFonts(m.fonts, files, issues);
  if (files.has('gabarit.html') || files.has('style.css')) {
    issues.error({
      code: 'DESIGNER_NO_CODE',
      message:
        'Un gabarit graphiste ne contient ni gabarit.html ni style.css (format « lalanda.modele-carte » pour un paquet code).',
    });
  }
  // Fonds : présents, aux proportions de la boîte (fond perdu compris), ≥ 300 dpi.
  for (const face of m.faces) {
    const path = m.backgrounds[face];
    if (!path) {
      issues.error({
        code: 'DESIGNER_BACKGROUND_MISSING',
        message: `« backgrounds.${face} » : fond attendu pour la face ${face}.`,
        file: 'manifest.json',
      });
      continue;
    }
    const img = imgs.get(path);
    if (!img) {
      if (!files.has(path)) {
        issues.error({
          code: 'DESIGNER_BACKGROUND_MISSING',
          message: `${path} absent du paquet.`,
          file: 'manifest.json',
        });
      }
      continue;
    }
    const minW = mmToPx(box.width) - 1;
    const minH = mmToPx(box.height) - 1;
    const ratio = img.width / img.height;
    const want = box.width / box.height;
    if (Math.abs(ratio - want) / want > 0.01) {
      issues.error({
        code: 'DESIGNER_BACKGROUND_RATIO',
        message: `${path} : ${img.width} × ${img.height} px n’a pas les proportions de la carte ${f.bleed > 0 ? 'avec fond perdu ' : ''}(${Number(box.width.toFixed(2))} × ${Number(box.height.toFixed(2))} mm, soit ${mmToPx(box.width)} × ${mmToPx(box.height)} px à 300 dpi).`,
        file: path,
      });
    } else if (img.width < minW || img.height < minH) {
      issues.error({
        code: 'DESIGNER_BACKGROUND_LOW_RES',
        message: `${path} : ${img.width} × ${img.height} px, moins de 300 dpi (attendu au moins ${mmToPx(box.width)} × ${mmToPx(box.height)} px).`,
        file: path,
      });
    }
  }
  const builtin = new Set<FontId>();
  for (const [n, z] of m.zones.entries()) {
    const at = `« zones.${n} » (${z.name})`;
    if (!m.faces.includes(z.face)) {
      issues.error({
        code: 'DESIGNER_ZONE_FACE',
        message: `${at} : face absente de « faces ».`,
        file: 'manifest.json',
      });
    }
    if (z.x + z.width > f.width + f.bleed || z.y + z.height > f.height + f.bleed) {
      issues.error({
        code: 'DESIGNER_ZONE_OUTSIDE',
        message: `${at} : la zone sort de la carte (${f.width} × ${f.height} mm, coordonnées depuis le coin de coupe).`,
        file: 'manifest.json',
      });
    } else if (
      !IMAGE_ZONES.has(z.name) &&
      (z.x < f.safe ||
        z.y < f.safe ||
        z.x + z.width > f.width - f.safe ||
        z.y + z.height > f.height - f.safe)
    ) {
      issues.warn({
        code: 'DESIGNER_ZONE_OUTSIDE_SAFE',
        message: `${at} : du texte hors de la zone de sécurité (${f.safe} mm) risque d’être coupé.`,
        file: 'manifest.json',
      });
    }
    if (z.name === 'qr') {
      if (m.kind !== 'badge') {
        issues.error({
          code: 'CARD_QR_NOT_ALLOWED',
          message: `${at} : « qr » est réservé à la carte de service (utiliser « qr-vcard »).`,
          file: 'manifest.json',
        });
      }
      checkQrPlacement({ x: z.x, y: z.y, size: Math.min(z.width, z.height) }, f, at, issues);
    }
    if (z.name === 'qr-vcard' && m.kind !== 'business') {
      issues.error({
        code: 'CARD_QR_NOT_ALLOWED',
        message: `${at} : « qr-vcard » est réservé à la carte de visite.`,
        file: 'manifest.json',
      });
    }
    if (z.font) {
      const lower = z.font.toLowerCase();
      if ((FONT_IDS as readonly string[]).includes(z.font)) builtin.add(z.font as FontId);
      else if (!fonts.families.has(lower)) {
        issues.error({
          code: 'DESIGNER_FONT_UNKNOWN',
          message: `${at} : police « ${z.font} » inconnue (polices Lalanda : ${FONT_IDS.join(', ')}, ou une police déclarée dans « fonts »).`,
          file: 'manifest.json',
        });
      }
    }
  }
  if (m.kind === 'badge' && !m.zones.some((z) => z.name === 'qr')) {
    issues.error({
      code: 'CARD_QR_REQUIRED',
      message: 'Une carte de service déclare une zone « qr » (QR de vérification, ≥ 15 mm).',
      file: 'manifest.json',
    });
  }
  if (!issues.ok) return null;

  const familyOf = (font: string | undefined, t: CardTheme): string => {
    if (!font) return t.body;
    if ((FONT_IDS as readonly string[]).includes(font)) return fontStack(font as FontId);
    return `'${font.replace(/'/g, '')}', sans-serif`;
  };
  return {
    format: 'designer',
    manifest: m,
    digest,
    kind: m.kind,
    cardFormat: f,
    faces: m.faces,
    fontFaces: fonts.css,
    builtinFonts: [...builtin],
    render(d, t, faces) {
      const out = faces
        .filter((face) => m.faces.includes(face))
        .map((face) => {
          const bg = imgs.get(m.backgrounds[face]!)!;
          const parts: string[] = [
            `<img class="lx-fond" src="${bg.dataUri}" alt="" style="width:${mm(box.width)};height:${mm(box.height)}" />`,
          ];
          for (const z of m.zones.filter((x) => x.face === face)) {
            const pos = `left:${mm(z.x + f.bleed)};top:${mm(z.y + f.bleed)};width:${mm(z.width)};height:${mm(z.height)}`;
            if (z.name === 'qr') {
              const s = Math.min(z.width, z.height);
              parts.push(engineQrLayer(d, { x: z.x, y: z.y, size: s }, f));
              continue;
            }
            if (z.name === 'qr-vcard') {
              if (d.vcardQrSvg)
                parts.push(`<div class="lx-zone lx-qr" style="${pos}">${d.vcardQrSvg}</div>`);
              continue;
            }
            if (IMAGE_ZONES.has(z.name)) {
              const im =
                z.name === 'photo'
                  ? d.photo
                  : z.name === 'logo'
                    ? d.org.logo
                    : (d.org.logoLight ?? d.org.logo);
              if (!im) continue;
              parts.push(
                `<div class="lx-zone" style="${pos};border-radius:${mm(z.radius ?? 0)};overflow:hidden"><img src="${esc(im.dataUri)}" alt="" style="width:100%;height:100%;object-fit:${z.fit ?? (z.name === 'photo' ? 'cover' : 'contain')};display:block" /></div>`,
              );
              continue;
            }
            const value = zoneText(d, z.name);
            if (!value) continue;
            const style = `${pos};font-family:${familyOf(z.font, t)};font-size:${z.size ?? 9}pt;font-weight:${z.weight ?? 400};color:${(z.color ?? '#111111').toLowerCase()};text-align:${z.align ?? 'left'};${z.uppercase ? 'text-transform:uppercase;' : ''}`;
            parts.push(`<div class="lx-zone lx-texte" style="${style}">${esc(value)}</div>`);
          }
          return { face, html: parts.join('') };
        });
      return {
        css: `.lx-fond { position: absolute; left: 0; top: 0; display: block; }
        .lx-zone { position: absolute; z-index: 5; }
        .lx-texte { line-height: 1.15; overflow: hidden; overflow-wrap: anywhere; }
        .lx-qr { background: #ffffff; } .lx-qr svg { display: block; width: 100%; height: 100%; }
        ${ENGINE_CSS}`,
        faces: out,
        paper: '#ffffff',
        sample: d.sample,
      };
    },
  };
}

// ── Point d'entrée ──────────────────────────────────────────────────────────

/** Valide une archive et compile le paquet. `battery` : rendus d'essai (installation). */
export function validateCardPackage(
  archive: Buffer,
  sample: ((variant: number) => CardData) | null,
): { report: CardValidationReport; compiled: CompiledCardPackage | null } {
  const issues = new IssueList();
  const files = filesFromArchive(archive, issues);
  // Le lecteur commun exige gabarit.html et style.css (paquet de facture) : chaque
  // format de carte vérifie lui-même ses fichiers obligatoires.
  for (let i = issues.errors.length - 1; i >= 0; i -= 1) {
    if (issues.errors[i]!.code === 'PACKAGE_MISSING_FILE') issues.errors.splice(i, 1);
  }
  const digest = files.size > 0 ? packageDigest(files) : null;
  let compiled: CompiledCardPackage | null = null;
  let summary: CardValidationReport['manifest'] = null;
  const cases: string[] = [];
  const mf = files.get('manifest.json');
  if (issues.ok && !mf) {
    issues.error({
      code: 'PACKAGE_MISSING_FILE',
      message: 'manifest.json manquant.',
      file: 'manifest.json',
    });
  }
  if (issues.ok && mf && digest) {
    const t = utf8(mf.data, 'manifest.json', issues);
    let json: unknown = null;
    if (t !== null) {
      try {
        json = JSON.parse(t);
      } catch (err) {
        issues.error({
          code: 'MANIFEST_INVALID_JSON',
          message: `JSON illisible : ${(err as Error).message}`,
          file: 'manifest.json',
        });
      }
    }
    const format = (json as { format?: unknown } | null)?.format;
    if (json !== null && format === CODE_FORMAT) {
      const p = CodeManifestSchema.safeParse(json);
      if (!p.success) zodIssues(p.error, issues);
      else compiled = compileCode(p.data, files, digest, issues);
    } else if (json !== null && format === DESIGNER_FORMAT) {
      const p = DesignerManifestSchema.safeParse(json);
      if (!p.success) zodIssues(p.error, issues);
      else compiled = compileDesigner(p.data, files, digest, issues);
    } else if (json !== null) {
      issues.error({
        code: 'MANIFEST_FORMAT_UNKNOWN',
        message: `« format » attendu : « ${CODE_FORMAT} » (paquet code) ou « ${DESIGNER_FORMAT} » (gabarit graphiste). Les fonds SVG et PDF ne sont pas encore acceptés.`,
        file: 'manifest.json',
      });
    }
    if (compiled) {
      const m = compiled.manifest;
      summary = {
        id: m.id,
        name: m.name,
        version: m.version,
        kind: m.kind,
        orientation: m.orientation,
        format: compiled.format,
      };
    }
  }
  // Batterie de rendu (sans Chromium) : chaque cas doit produire une sortie admise.
  if (compiled && sample) {
    const labels = [
      'collaborateur complet',
      'sans photo ni logo',
      'noms longs et caractères à échapper',
    ];
    for (const [i, label] of labels.entries()) {
      try {
        compiled.render(sample(i), SAMPLE_THEME, compiled.faces);
        cases.push(label);
      } catch (err) {
        issues.error({
          code: 'TEMPLATE_RENDER_FAILED',
          message: (err as Error).message,
          case: label,
        });
      }
    }
    if (!issues.ok) compiled = null;
  }
  return {
    report: {
      ok: issues.ok,
      errors: issues.errors,
      warnings: issues.warnings,
      truncated: issues.truncated,
      digest,
      manifest: summary,
      cases,
    },
    compiled: issues.ok ? compiled : null,
  };
}

/** Thème neutre de la batterie (aucune donnée d'organisation). */
const SAMPLE_THEME: CardTheme = {
  variant: 'brand',
  accent: '#1f4e79',
  onAccent: '#ffffff',
  accentInk: '#1f4e79',
  second: '#1f4e79',
  onSecond: '#ffffff',
  soft: '#e9eef3',
  line: '#a5b8c9',
  dark: '#112b43',
  onDark: '#ffffff',
  ink: '#111827',
  muted: '#4b5563',
  paper: '#ffffff',
  body: fontStack('inter'),
  display: fontStack('inter'),
  fonts: ['inter'],
  logoFilter: 'none',
};
