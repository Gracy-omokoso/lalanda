// Lecture (et écriture) d'archives ZIP non fiables — paquets de modèle, ADR-0029 O3.
//
// Hors de `sales/documents` (mise en forme seule, ADR-0025) : ce module compte
// des OCTETS, jamais des montants.
//
// Pourquoi un lecteur écrit pour ce besoin plutôt qu'une bibliothèque : une
// archive téléversée est HOSTILE par hypothèse (bombe de décompression, chemins
// `..`, liens symboliques, en-têtes incohérents). Ce lecteur ne fait que ce dont
// un paquet a besoin et applique les plafonds AVANT de décompresser (tailles
// annoncées, nombre d'entrées) et PENDANT (`maxOutputLength` de zlib : une
// entrée qui ment sur sa taille ne peut pas produire un octet de plus que son
// plafond). Le CRC de chaque entrée est vérifié.
//
// Admis : méthodes « stocké » (0) et « deflate » (8), noms UTF-8 ou ASCII,
// descripteurs de données (tailles lues dans le répertoire central). Refusés :
// ZIP64, archives multi-volumes, entrées chiffrées, liens symboliques.

import { deflateRawSync, inflateRawSync } from 'node:zlib';

export class ZipError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly file?: string,
  ) {
    super(message);
    this.name = 'ZipError';
  }
}

export interface ZipLimits {
  maxEntries: number;
  /** Plafond d'une entrée décompressée. */
  maxEntryBytes: number;
  /** Plafond cumulé décompressé. */
  maxTotalBytes: number;
  /** Taux de compression maximal d'une entrée (décompressé / compressé). */
  maxRatio: number;
}

export interface ZipEntry {
  /** Nom brut, tel qu'écrit dans l'archive (contrôlé par l'appelant). */
  name: string;
  directory: boolean;
  /** Octets décompressés ; `null` si l'appelant a demandé de ne pas les lire. */
  data: Buffer | null;
  size: number;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;

function malformed(message: string, file?: string): never {
  throw new ZipError('ZIP_MALFORMED', message, file);
}

function findEndOfCentralDirectory(buf: Buffer): number {
  // L'EOCD fait 22 octets plus un commentaire d'au plus 65 535 octets.
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG && i + 22 + buf.readUInt16LE(i + 20) === buf.length) {
      return i;
    }
  }
  return malformed('Archive ZIP illisible : fin de répertoire central introuvable.');
}

/**
 * Lit une archive. `wanted(name)` décide si les octets d'une entrée sont
 * décompressés (les entrées ignorées — `__MACOSX/` — comptent quand même dans
 * les plafonds, par leur taille annoncée).
 */
export function readZip(
  buf: Buffer,
  limits: ZipLimits,
  wanted: (name: string) => boolean = () => true,
): ZipEntry[] {
  if (buf.length < 22) malformed('Fichier trop court pour être une archive ZIP.');
  const eocd = findEndOfCentralDirectory(buf);
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIG) {
    throw new ZipError('ZIP_UNSUPPORTED', 'Archive ZIP64 refusée.');
  }
  const disk = buf.readUInt16LE(eocd + 4);
  const cdDisk = buf.readUInt16LE(eocd + 6);
  const entriesOnDisk = buf.readUInt16LE(eocd + 8);
  const entries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (disk !== 0 || cdDisk !== 0 || entriesOnDisk !== entries) {
    throw new ZipError('ZIP_UNSUPPORTED', 'Archive en plusieurs volumes refusée.');
  }
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipError('ZIP_UNSUPPORTED', 'Archive ZIP64 refusée.');
  }
  if (entries > limits.maxEntries) {
    throw new ZipError(
      'ZIP_TOO_MANY_ENTRIES',
      `L’archive contient ${entries} entrées ; au plus ${limits.maxEntries}.`,
    );
  }
  if (cdOffset + cdSize > eocd) malformed('Répertoire central hors de l’archive.');

  const out: ZipEntry[] = [];
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < entries; n += 1) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== CEN_SIG) malformed('Répertoire central corrompu.');
    const madeBy = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const diskStart = buf.readUInt16LE(p + 34);
    const external = buf.readUInt32LE(p + 38);
    const localOffset = buf.readUInt32LE(p + 42);
    const nameEnd = p + 46 + nameLen;
    if (nameEnd + extraLen + commentLen > eocd) malformed('Entrée du répertoire central tronquée.');
    const rawName = buf.subarray(p + 46, nameEnd);
    // Bit 11 : nom en UTF-8 ; sinon, on n'admet que l'ASCII (pas de page de code devinée).
    const name = rawName.toString(flags & 0x800 ? 'utf8' : 'latin1');
    if (!(flags & 0x800) && /[^\x20-\x7e]/.test(name)) {
      throw new ZipError('ZIP_BAD_NAME', 'Nom de fichier non ASCII sans marque UTF-8.', name);
    }
    p = nameEnd + extraLen + commentLen;

    if (flags & 0x1 || flags & 0x40) {
      throw new ZipError('ZIP_ENCRYPTED', 'Entrée chiffrée refusée.', name);
    }
    if (diskStart !== 0) throw new ZipError('ZIP_UNSUPPORTED', 'Archive multi-volumes.', name);
    if (csize === 0xffffffff || usize === 0xffffffff || localOffset === 0xffffffff) {
      throw new ZipError('ZIP_UNSUPPORTED', 'Archive ZIP64 refusée.', name);
    }
    // Unix (hôte 3) : le type de fichier est dans les 16 bits hauts des attributs.
    if (madeBy >> 8 === 3 && ((external >>> 16) & 0o170000) === 0o120000) {
      throw new ZipError('ZIP_SYMLINK', 'Lien symbolique refusé.', name);
    }
    const directory = name.endsWith('/');
    if (directory) {
      if (usize !== 0) malformed('Dossier avec contenu.', name);
      out.push({ name, directory: true, data: null, size: 0 });
      continue;
    }
    if (method !== 0 && method !== 8) {
      throw new ZipError(
        'ZIP_UNSUPPORTED',
        `Méthode de compression ${method} refusée (attendu : stocké ou deflate).`,
        name,
      );
    }
    if (usize > limits.maxEntryBytes) {
      throw new ZipError(
        'ZIP_ENTRY_TOO_LARGE',
        `Fichier de ${usize} octets décompressés ; au plus ${limits.maxEntryBytes}.`,
        name,
      );
    }
    total += usize;
    if (total > limits.maxTotalBytes) {
      throw new ZipError(
        'ZIP_TOO_LARGE',
        `Contenu décompressé supérieur à ${limits.maxTotalBytes} octets.`,
      );
    }
    if (usize > 0 && usize / Math.max(1, csize) > limits.maxRatio) {
      throw new ZipError(
        'ZIP_BOMB',
        `Taux de compression anormal (${Math.round(usize / Math.max(1, csize))} pour 1).`,
        name,
      );
    }
    if (method === 0 && csize !== usize) malformed('Entrée stockée de taille incohérente.', name);

    // En-tête local : les tailles font foi dans le répertoire central, mais le
    // nom et la position des données se lisent ici.
    if (localOffset + 30 > cdOffset || buf.readUInt32LE(localOffset) !== LOC_SIG) {
      malformed('En-tête local introuvable.', name);
    }
    const localName = buf.subarray(
      localOffset + 30,
      localOffset + 30 + buf.readUInt16LE(localOffset + 26),
    );
    if (!localName.equals(rawName))
      malformed('Nom différent entre en-tête local et central.', name);
    const dataStart =
      localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    if (dataStart + csize > cdOffset) malformed('Données hors de l’archive.', name);

    if (!wanted(name)) {
      out.push({ name, directory: false, data: null, size: usize });
      continue;
    }
    const raw = buf.subarray(dataStart, dataStart + csize);
    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(raw);
    } else {
      try {
        // `maxOutputLength` : la décompression S'ARRÊTE au plafond, quoi que
        // l'entrée prétende. Une entrée qui ment sur sa taille lève ici.
        data = inflateRawSync(raw, { maxOutputLength: Math.max(1, usize) });
      } catch {
        throw new ZipError(
          'ZIP_BOMB',
          'Données compressées invalides ou plus grandes qu’annoncé.',
          name,
        );
      }
    }
    if (data.length !== usize) malformed('Taille décompressée différente de l’annonce.', name);
    if (crc32(data) !== crc) throw new ZipError('ZIP_CRC', 'Somme de contrôle (CRC) fausse.', name);
    out.push({ name, directory: false, data, size: usize });
  }
  return out;
}

/**
 * Écrit une archive (deflate) — commande locale `--paquet` et tests. Dates
 * fixes (1er janvier 1980) : deux archives du même dossier sont identiques.
 */
export function writeZip(files: ReadonlyArray<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const deflated = deflateRawSync(f.data);
    const stored = deflated.length >= f.data.length;
    const body = stored ? f.data : deflated;
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOC_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(0, 10); // heure
    local.writeUInt16LE(0x21, 12); // 1er janvier 1980
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CEN_SIG, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD_SIG, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
