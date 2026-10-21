// Fichiers d'un paquet de modèle : chemins admis, plafonds, empreinte — ADR-0029 § 1.
//
// Un paquet arrive en archive (téléversement) ou en dossier (validation
// locale) ; les deux passent par `collectPackageFiles`, qui applique LES MÊMES
// règles : un dossier qui passe la commande locale passe le téléversement.

import { createHash } from 'node:crypto';

import { IssueList } from './report.js';
import { ZipError, readZip } from './zip.js';

export const PACKAGE_LIMITS = {
  /** Archive téléversée. */
  maxArchiveBytes: 3 * 1024 * 1024,
  maxEntries: 40,
  maxTotalBytes: 8 * 1024 * 1024,
  maxRatio: 200,
  manifestBytes: 16 * 1024,
  templateBytes: 128 * 1024,
  styleBytes: 64 * 1024,
  /** Une image passe ensuite la porte de la photo de profil (2 Mio, 32 à 4 096 px). */
  imageBytes: 2 * 1024 * 1024,
  maxImages: 8,
  fontBytes: 256 * 1024,
  maxFonts: 6,
  textBytes: 64 * 1024,
} as const;

export type PackageFileKind = 'manifest' | 'template' | 'style' | 'image' | 'font' | 'text';

export interface PackageFile {
  path: string;
  kind: PackageFileKind;
  data: Buffer;
}

/** Fichiers retenus, par chemin normalisé (minuscules, `/`). */
export type PackageFiles = ReadonlyMap<string, PackageFile>;

const NAME = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const IMAGE_EXT = /\.(png|jpe?g|webp)$/;
const TEXT_ROOT = new Set(['licence.txt', 'license.txt', 'lisezmoi.md', 'readme.md']);

/** Fichiers du système (macOS, Windows) : ignorés, mais comptés dans les plafonds. */
function ignored(path: string): boolean {
  const base = path.split('/').pop() ?? '';
  return (
    path.startsWith('__MACOSX/') ||
    path.includes('/__MACOSX/') ||
    base === '.DS_Store' ||
    base === 'Thumbs.db' ||
    base === 'desktop.ini'
  );
}

/** Rôle d'un chemin admis, ou `null` (fichier refusé). */
export function kindOf(path: string): PackageFileKind | null {
  const parts = path.split('/');
  if (parts.length === 1) {
    if (path === 'manifest.json') return 'manifest';
    if (path === 'gabarit.html') return 'template';
    if (path === 'style.css') return 'style';
    if (TEXT_ROOT.has(path)) return 'text';
    return null;
  }
  if (parts.length !== 2 || !NAME.test(parts[1]!)) return null;
  if (parts[0] === 'images' && IMAGE_EXT.test(parts[1]!)) return 'image';
  if (parts[0] === 'polices' && parts[1]!.endsWith('.woff2')) return 'font';
  if (parts[0] === 'polices' && parts[1]!.endsWith('.txt')) return 'text';
  return null;
}

const MAX_BYTES: Record<PackageFileKind, number> = {
  manifest: PACKAGE_LIMITS.manifestBytes,
  template: PACKAGE_LIMITS.templateBytes,
  style: PACKAGE_LIMITS.styleBytes,
  image: PACKAGE_LIMITS.imageBytes,
  font: PACKAGE_LIMITS.fontBytes,
  text: PACKAGE_LIMITS.textBytes,
};

/**
 * Chemin brut → chemin relatif sûr, ou message d'erreur. Aucune
 * « réparation » : un chemin douteux est refusé, jamais normalisé en silence.
 */
export function checkPath(raw: string): { path: string } | { error: string } {
  if (raw === '' || raw.length > 160) return { error: 'Chemin vide ou trop long.' };
  if (/[\u0000-\u001f\u007f]/.test(raw)) return { error: 'Caractère de contrôle dans le chemin.' };
  if (raw.includes('\\')) return { error: 'Barre oblique inverse « \\ » interdite.' };
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) return { error: 'Chemin absolu interdit.' };
  const parts = raw.replace(/\/$/, '').split('/');
  if (parts.some((s) => s === '' || s === '.' || s === '..')) {
    return { error: 'Segment « . », « .. » ou vide interdit dans le chemin.' };
  }
  return { path: parts.join('/') };
}

interface RawEntry {
  name: string;
  directory: boolean;
  data: Buffer | null;
  size: number;
}

/**
 * Retire un dossier racine unique (« Compresser » de macOS ou Windows emballe
 * le dossier) : `ocre/manifest.json` → `manifest.json`.
 */
function stripSingleRoot(paths: string[]): string | null {
  const meaningful = paths.filter((p) => !ignored(p));
  if (meaningful.length === 0) return null;
  const first = meaningful[0]!.split('/')[0]!;
  if (meaningful.every((p) => p.startsWith(`${first}/`) || p === first)) {
    return meaningful.includes('manifest.json') ? null : first;
  }
  return null;
}

/**
 * Applique les règles de chemin et de taille à des entrées (archive ou
 * dossier). Les erreurs vont dans `issues` ; le résultat ne contient que les
 * fichiers admis.
 */
export function collectPackageFiles(entries: readonly RawEntry[], issues: IssueList): PackageFiles {
  const files = new Map<string, PackageFile>();
  const checked: Array<{ path: string; entry: RawEntry }> = [];
  for (const e of entries) {
    const c = checkPath(e.name);
    if ('error' in c) {
      issues.error({ code: 'PACKAGE_BAD_PATH', message: c.error, file: e.name });
      continue;
    }
    checked.push({ path: c.path, entry: e });
  }
  const root = stripSingleRoot(checked.map((c) => c.path));
  const seen = new Set<string>();
  let images = 0;
  let fonts = 0;
  for (const { path: full, entry } of checked) {
    if (ignored(full)) continue;
    if (root !== null && full === root) continue;
    const path = root !== null ? full.slice(root.length + 1) : full;
    if (entry.directory) {
      if (path !== 'images' && path !== 'polices') {
        issues.error({
          code: 'PACKAGE_UNEXPECTED_FILE',
          message: 'Dossier non prévu : seuls « images/ » et « polices/ » sont admis.',
          file: path,
        });
      }
      continue;
    }
    const lower = path.toLowerCase();
    if (seen.has(lower)) {
      issues.error({ code: 'PACKAGE_DUPLICATE_FILE', message: 'Fichier en double.', file: path });
      continue;
    }
    seen.add(lower);
    if (path !== lower) {
      issues.error({
        code: 'PACKAGE_BAD_PATH',
        message: 'Les noms de fichiers s’écrivent en minuscules (a-z, 0-9, « . », « - », « _ »).',
        file: path,
      });
      continue;
    }
    const kind = kindOf(path);
    if (kind === null) {
      issues.error({
        code: 'PACKAGE_UNEXPECTED_FILE',
        message:
          'Fichier non admis. Attendus : manifest.json, gabarit.html, style.css, images/*.png|jpg|webp, polices/*.woff2 (et leurs licences .txt), LICENCE.txt, LISEZMOI.md.',
        file: path,
      });
      continue;
    }
    if (entry.size > MAX_BYTES[kind]) {
      issues.error({
        code: 'PACKAGE_FILE_TOO_LARGE',
        message: `Fichier trop gros (${entry.size} octets) ; au plus ${MAX_BYTES[kind]}.`,
        file: path,
      });
      continue;
    }
    if (kind === 'image' && ++images > PACKAGE_LIMITS.maxImages) {
      issues.error({
        code: 'PACKAGE_TOO_MANY_FILES',
        message: `Au plus ${PACKAGE_LIMITS.maxImages} images.`,
        file: path,
      });
      continue;
    }
    if (kind === 'font' && ++fonts > PACKAGE_LIMITS.maxFonts) {
      issues.error({
        code: 'PACKAGE_TOO_MANY_FILES',
        message: `Au plus ${PACKAGE_LIMITS.maxFonts} polices.`,
        file: path,
      });
      continue;
    }
    files.set(path, { path, kind, data: entry.data ?? Buffer.alloc(0) });
  }
  for (const required of ['manifest.json', 'gabarit.html', 'style.css']) {
    if (!files.has(required)) {
      issues.error({
        code: 'PACKAGE_MISSING_FILE',
        message: 'Fichier obligatoire absent.',
        file: required,
      });
    }
  }
  return files;
}

/** Archive téléversée → fichiers admis (erreurs dans `issues`). */
export function filesFromArchive(archive: Buffer, issues: IssueList): PackageFiles {
  if (archive.length > PACKAGE_LIMITS.maxArchiveBytes) {
    issues.error({
      code: 'PACKAGE_TOO_LARGE',
      message: `L’archive dépasse ${PACKAGE_LIMITS.maxArchiveBytes / 1024 / 1024} Mio.`,
    });
    return new Map();
  }
  let entries;
  try {
    entries = readZip(
      archive,
      {
        maxEntries: PACKAGE_LIMITS.maxEntries,
        maxEntryBytes: PACKAGE_LIMITS.imageBytes,
        maxTotalBytes: PACKAGE_LIMITS.maxTotalBytes,
        maxRatio: PACKAGE_LIMITS.maxRatio,
      },
      // Les fichiers système ignorés ne sont pas décompressés (taille comptée).
      (name) => !ignored(name),
    );
  } catch (err) {
    if (err instanceof ZipError) {
      issues.error({
        code: err.code,
        message: err.message,
        ...(err.file ? { file: err.file } : {}),
      });
      return new Map();
    }
    throw err;
  }
  return collectPackageFiles(entries, issues);
}

/**
 * Empreinte CANONIQUE (ADR-0029 § 1) : SHA-256 de `chemin NUL sha256 LF` par
 * fichier retenu, triés par chemin. Indépendante de l'outil de compression et
 * des dates ; c'est elle qui est figée au gel et qui sera signée.
 */
export function packageDigest(files: PackageFiles): string {
  const h = createHash('sha256');
  for (const path of [...files.keys()].sort()) {
    const sum = createHash('sha256').update(files.get(path)!.data).digest('hex');
    h.update(`${path}\u0000${sum}\n`);
  }
  return h.digest('hex');
}
