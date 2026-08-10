// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION ET ASSAINISSEMENT D'UNE IMAGE TÉLÉVERSÉE — cœur sécurité du lot
//
// docs/17 § Menaces prioritaires nomme « injection par fichier importé ». Un
// endpoint d'upload est l'endroit où du contenu choisi par un tiers entre dans
// le produit, y est conservé, puis renvoyé à des navigateurs.
//
// ── Trois principes ──────────────────────────────────────────────────────────
//
// 1. RIEN DE CE QUE DIT LE CLIENT NE FAIT AUTORITÉ. Ni le nom du fichier, ni son
//    extension, ni l'en-tête `Content-Type` de la requête, ni le `type` d'un
//    champ multipart. Tous sont écrits par l'appelant. Le seul juge est le
//    contenu : nombres magiques, puis structure interne.
//
// 2. LISTE BLANCHE, ET ELLE SE LIMITE À CE QUE CE FICHIER SAIT ANALYSER. PNG,
//    JPEG, WebP. Un format qu'on ne sait pas parcourir est refusé — pas
//    « accepté avec prudence ». C'est ce qui rend la règle stable : elle ne
//    dépend pas de la liste des attaques connues au moment de l'écriture.
//
// 3. L'OCTET STOCKÉ N'EST JAMAIS L'OCTET REÇU. Le fichier est reconstruit à
//    partir des seules structures reconnues. Ce qui n'est pas reconnu ne
//    survit pas au passage : métadonnées EXIF (donc les coordonnées GPS que
//    presque tout téléphone inscrit dans une photo), XMP, commentaires,
//    charges utiles cachées après la fin de l'image.
//
// ── Le SVG, explicitement ────────────────────────────────────────────────────
//
// UN SVG N'EST PAS UNE IMAGE, C'EST UN DOCUMENT XML EXÉCUTABLE. Il porte
// `<script>`, `<foreignObject>`, des gestionnaires `onload`, des `xlink:href`
// distants. Servi depuis une origine, il s'exécute dans le contexte de cette
// origine : c'est un XSS stocké, à demeure, dans la photo de profil.
//
// Il est refusé de DEUX manières indépendantes, et c'est délibéré :
//   - par construction : il ne commence par aucun nombre magique de la liste
//     blanche, donc il n'y a aucun chemin d'acceptation à oublier ;
//   - par un test explicite en tête, dont le seul rôle est de rendre le REFUS
//     LISIBLE (`UNSUPPORTED_IMAGE_TYPE` avec mention du SVG) plutôt que de
//     laisser un utilisateur légitime face à un message énigmatique.
// La seconde barrière est du confort ; la première est la sécurité. Retirer le
// test explicite ne rouvrirait rien — c'est la propriété qu'on veut.
//
// ── Pourquoi ni `sharp` ni `multer` ──────────────────────────────────────────
//
// `sharp` (donc libvips) ré-encoderait l'image, ce qui est la défense de
// référence — mais c'est un binaire natif, et libvips/libpng/libwebp sont
// précisément la classe de bibliothèques où les corruptions de mémoire sur
// fichier hostile sont publiées chaque année. Lui donner à mâcher des octets
// choisis par un inconnu, dans le processus qui détient `SECRETS_MASTER_KEY`,
// se discute — et ADR-0013 §10 désigne déjà cette surface comme non couverte.
// Ici, AUCUN DÉCODAGE N'A LIEU : on lit des en-têtes et on recopie des blocs.
// Une bombe de décompression (une image de 50 000 × 50 000 déclarée dans 40 Kio)
// est refusée sur ses en-têtes, avant que quiconque n'alloue un pixel.
//
// Ce que cela coûte, honnêtement : pas de redimensionnement serveur, pas de
// normalisation, et une image malformée que notre analyseur accepterait mais
// qu'un décodeur de navigateur rejetterait resterait stockée. Voir le rapport.
// ─────────────────────────────────────────────────────────────────────────────

/** Types acceptés. La liste est celle des formats que ce fichier sait parcourir. */
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];

/**
 * 2 Mio. Une photo de profil s'affiche dans une pastille de quelques dizaines de
 * pixels ; la borne est déjà généreuse. Elle est appliquée AVANT toute analyse.
 */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** En deçà, ce n'est pas une photo : c'est un pixel-espion ou une erreur. */
export const MIN_IMAGE_DIMENSION = 32;

/**
 * 4096. Au-delà, aucun gain d'affichage, et c'est la borne qui rend une bombe de
 * décompression inoffensive : un PNG de 40 Kio peut déclarer 50 000 × 50 000,
 * soit 10 Gio une fois décodé côté navigateur.
 */
export const MAX_IMAGE_DIMENSION = 4096;

export type ImageRejectionCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_IMAGE_TYPE'
  | 'IMAGE_DIMENSIONS_REJECTED'
  | 'MALFORMED_IMAGE';

export interface ImageRejection {
  ok: false;
  code: ImageRejectionCode;
  message: string;
}

export interface ImageAcceptance {
  ok: true;
  /** Type DÉDUIT DU CONTENU. Jamais celui annoncé par le client. */
  contentType: AcceptedImageType;
  width: number;
  height: number;
  /** Octets reconstruits — ce sont EUX qui sont stockés, jamais l'entrée. */
  bytes: Buffer;
}

export type ImageValidation = ImageAcceptance | ImageRejection;

function rejet(code: ImageRejectionCode, message: string): ImageRejection {
  return { ok: false, code, message };
}

// ─── Nombres magiques ────────────────────────────────────────────────────────

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Type déduit des seuls premiers octets. `null` = hors liste blanche. */
export function sniffImageType(buf: Buffer): AcceptedImageType | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png';
  // JPEG : SOI (FFD8) suivi d'un marqueur (FFxx). `FFD8` seul ne suffit pas —
  // n'importe quel binaire peut commencer par ces deux octets.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Reconnaissance d'un SVG. N'A AUCUN RÔLE DE SÉCURITÉ (le SVG est déjà exclu
 * faute de nombre magique) : sert uniquement à rendre le refus explicite.
 */
function ressembleAUnSvg(buf: Buffer): boolean {
  const tete = buf.subarray(0, 1024).toString('latin1').trimStart().toLowerCase();
  return tete.startsWith('<?xml') || tete.startsWith('<svg') || tete.startsWith('<!doctype svg');
}

// ─── Point d'entrée ──────────────────────────────────────────────────────────

export function validateAndSanitizeImage(buf: Buffer): ImageValidation {
  if (buf.length === 0) {
    return rejet('EMPTY_FILE', 'Le fichier est vide.');
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    return rejet(
      'FILE_TOO_LARGE',
      `Le fichier dépasse la taille maximale de ${MAX_IMAGE_BYTES / 1024 / 1024} Mio.`,
    );
  }

  const type = sniffImageType(buf);
  if (type === null) {
    if (ressembleAUnSvg(buf)) {
      return rejet(
        'UNSUPPORTED_IMAGE_TYPE',
        'Le format SVG n’est pas accepté : c’est un document exécutable, pas une image. ' +
          'Formats acceptés : PNG, JPEG, WebP.',
      );
    }
    return rejet(
      'UNSUPPORTED_IMAGE_TYPE',
      'Le contenu du fichier ne correspond à aucun format accepté (PNG, JPEG, WebP).',
    );
  }

  let analyse: { width: number; height: number; bytes: Buffer };
  try {
    analyse =
      type === 'image/png'
        ? assainirPng(buf)
        : type === 'image/jpeg'
          ? assainirJpeg(buf)
          : assainirWebp(buf);
  } catch (cause) {
    return rejet('MALFORMED_IMAGE', (cause as Error).message);
  }

  const { width, height } = analyse;
  if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) {
    return rejet(
      'IMAGE_DIMENSIONS_REJECTED',
      `Image trop petite (${width}×${height}). Minimum ${MIN_IMAGE_DIMENSION}×${MIN_IMAGE_DIMENSION}.`,
    );
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    return rejet(
      'IMAGE_DIMENSIONS_REJECTED',
      `Image trop grande (${width}×${height}). Maximum ${MAX_IMAGE_DIMENSION}×${MAX_IMAGE_DIMENSION}.`,
    );
  }

  return { ok: true, contentType: type, width, height, bytes: analyse.bytes };
}

// ─── PNG ─────────────────────────────────────────────────────────────────────

/**
 * Chunks ancillaires conservés — apparence uniquement.
 *
 * Tout ce qui n'est pas ici est ABANDONNÉ : `tEXt`/`zTXt`/`iTXt` (texte
 * arbitraire, y compris du HTML), `eXIf` (géolocalisation), `tIME`, et tout
 * chunk privé inconnu. Un chunk CRITIQUE inconnu fait échouer l'analyse : on ne
 * peut pas prétendre avoir compris un fichier dont on ignore une partie
 * essentielle.
 */
const PNG_CHUNKS_CONSERVES = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'sBIT',
  'bKGD',
  'pHYs',
  'hIST',
  'sPLT',
]);

const PNG_CHUNKS_CRITIQUES = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);

function assainirPng(buf: Buffer): { width: number; height: number; bytes: Buffer } {
  const sortie: Buffer[] = [PNG_MAGIC];
  let offset = PNG_MAGIC.length;
  let width = 0;
  let height = 0;
  let vuIhdr = false;
  let vuIend = false;
  let vuIdat = false;

  while (offset < buf.length) {
    if (offset + 8 > buf.length) throw new Error('PNG tronqué : en-tête de bloc incomplet.');
    const longueur = buf.readUInt32BE(offset);
    // Borne du format (2³¹−1) ET borne de réalité : un bloc plus long que le
    // fichier signale une longueur forgée pour faire lire hors des octets reçus.
    if (longueur > 0x7fffffff) throw new Error('PNG invalide : longueur de bloc aberrante.');
    const type = buf.toString('latin1', offset + 4, offset + 8);
    const fin = offset + 12 + longueur;
    if (fin > buf.length) throw new Error(`PNG tronqué : bloc « ${type} » incomplet.`);

    if (!vuIhdr && type !== 'IHDR')
      throw new Error('PNG invalide : IHDR n’est pas le premier bloc.');

    if (type === 'IHDR') {
      if (longueur !== 13) throw new Error('PNG invalide : IHDR de taille incorrecte.');
      width = buf.readUInt32BE(offset + 8);
      height = buf.readUInt32BE(offset + 12);
      if (width === 0 || height === 0) throw new Error('PNG invalide : dimension nulle.');
      vuIhdr = true;
    }
    if (type === 'IDAT') vuIdat = true;

    const critique = type.charCodeAt(0) >= 0x41 && type.charCodeAt(0) <= 0x5a;
    if (critique && !PNG_CHUNKS_CRITIQUES.has(type)) {
      throw new Error(`PNG invalide : bloc critique inconnu « ${type} ».`);
    }
    if (PNG_CHUNKS_CONSERVES.has(type)) {
      sortie.push(buf.subarray(offset, fin));
    }

    offset = fin;
    if (type === 'IEND') {
      vuIend = true;
      // Ce qui suit IEND N'EST PAS RECOPIÉ. C'est là que se rangent les charges
      // utiles ajoutées à un PNG par ailleurs valide (archive concaténée,
      // polyglotte). La sortie s'arrête ici, quoi qu'il reste en entrée.
      break;
    }
  }

  if (!vuIhdr || !vuIdat || !vuIend)
    throw new Error('PNG incomplet : IHDR, IDAT ou IEND manquant.');
  return { width, height, bytes: Buffer.concat(sortie) };
}

// ─── JPEG ────────────────────────────────────────────────────────────────────

/** Marqueurs SOF portant les dimensions. DHT (C4), JPG (C8) et DAC (CC) exclus. */
const JPEG_SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/** Segments abandonnés : APP1 (EXIF/XMP — GPS compris) et COM (commentaire). */
const JPEG_SEGMENTS_ABANDONNES = new Set([0xe1, 0xfe]);

function assainirJpeg(buf: Buffer): { width: number; height: number; bytes: Buffer } {
  const sortie: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let offset = 2;
  let width = 0;
  let height = 0;

  while (offset < buf.length) {
    if (buf[offset] !== 0xff) throw new Error('JPEG invalide : marqueur attendu.');
    // Octets de remplissage `FF` autorisés entre segments.
    while (offset < buf.length && buf[offset] === 0xff) offset += 1;
    if (offset >= buf.length) throw new Error('JPEG tronqué : marqueur incomplet.');
    const marqueur = buf[offset]!;
    offset += 1;

    if (marqueur === 0xd9) throw new Error('JPEG invalide : fin d’image avant toute donnée.');
    if (marqueur >= 0xd0 && marqueur <= 0xd7) continue; // RSTn, sans charge utile

    if (offset + 2 > buf.length) throw new Error('JPEG tronqué : longueur de segment absente.');
    const longueur = buf.readUInt16BE(offset);
    if (longueur < 2) throw new Error('JPEG invalide : longueur de segment aberrante.');
    const fin = offset + longueur;
    if (fin > buf.length) throw new Error('JPEG tronqué : segment incomplet.');

    if (JPEG_SOF.has(marqueur)) {
      if (longueur < 7) throw new Error('JPEG invalide : segment SOF trop court.');
      height = buf.readUInt16BE(offset + 3);
      width = buf.readUInt16BE(offset + 5);
      if (width === 0 || height === 0) throw new Error('JPEG invalide : dimension nulle.');
    }

    if (marqueur === 0xda) {
      // SOS : l'en-tête de balayage, puis les données entropiques jusqu'à EOI.
      // Elles sont recopiées telles quelles — les segments de métadonnées vivent
      // avant le premier balayage, jamais dedans.
      if (width === 0) throw new Error('JPEG invalide : balayage avant toute déclaration SOF.');
      const eoi = trouverEoi(buf, fin);
      sortie.push(Buffer.from([0xff, 0xda]), buf.subarray(offset, eoi));
      return { width, height, bytes: Buffer.concat(sortie) };
    }

    if (!JPEG_SEGMENTS_ABANDONNES.has(marqueur)) {
      sortie.push(Buffer.from([0xff, marqueur]), buf.subarray(offset, fin));
    }
    offset = fin;
  }

  throw new Error('JPEG invalide : aucun balayage (SOS) trouvé.');
}

/**
 * Fin des données entropiques : le dernier `FFD9` du fichier.
 *
 * Ce qui suit n'est pas recopié — c'est la place traditionnelle d'une archive
 * concaténée à une image par ailleurs valide.
 */
function trouverEoi(buf: Buffer, depuis: number): number {
  for (let i = buf.length - 2; i >= depuis; i -= 1) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd9) return i + 2;
  }
  throw new Error('JPEG tronqué : marqueur de fin (EOI) absent.');
}

// ─── WebP ────────────────────────────────────────────────────────────────────

/** Blocs RIFF conservés. `EXIF` et `XMP ` sont abandonnés, `ANIM`/`ANMF` refusés. */
const WEBP_BLOCS_CONSERVES = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ICCP']);

function assainirWebp(buf: Buffer): { width: number; height: number; bytes: Buffer } {
  const taillleRiff = buf.readUInt32LE(4);
  if (taillleRiff + 8 > buf.length)
    throw new Error('WebP tronqué : taille RIFF au-delà du fichier.');

  const blocs: Buffer[] = [];
  let width = 0;
  let height = 0;
  let vp8x: Buffer | null = null;
  let offset = 12;
  const fichierFin = Math.min(buf.length, taillleRiff + 8);

  while (offset + 8 <= fichierFin) {
    const fourcc = buf.toString('latin1', offset, offset + 4);
    const taille = buf.readUInt32LE(offset + 4);
    const donneesFin = offset + 8 + taille;
    if (donneesFin > fichierFin) throw new Error(`WebP tronqué : bloc « ${fourcc} » incomplet.`);
    const donnees = buf.subarray(offset + 8, donneesFin);

    if (fourcc === 'ANIM' || fourcc === 'ANMF') {
      throw new Error('WebP animé refusé : une photo de profil est une image fixe.');
    }
    if (fourcc === 'VP8 ') ({ width, height } = dimensionsVp8(donnees));
    if (fourcc === 'VP8L') ({ width, height } = dimensionsVp8l(donnees));
    if (fourcc === 'VP8X') {
      if (donnees.length < 10) throw new Error('WebP invalide : bloc VP8X trop court.');
      // Copie : les drapeaux EXIF/XMP doivent être éteints puisque les blocs
      // correspondants sont abandonnés. Un drapeau menteur laisserait un
      // décodeur chercher un bloc absent.
      vp8x = Buffer.from(donnees);
      vp8x[0] = vp8x[0]! & ~0b0000_1100;
      // Le canevas fait autorité quand VP8X est présent (24 bits LE, moins un).
      width = (donnees.readUIntLE(4, 3) & 0xffffff) + 1;
      height = (donnees.readUIntLE(7, 3) & 0xffffff) + 1;
    }

    if (WEBP_BLOCS_CONSERVES.has(fourcc)) {
      const charge = fourcc === 'VP8X' ? vp8x! : donnees;
      const entete = Buffer.alloc(8);
      entete.write(fourcc, 0, 'latin1');
      entete.writeUInt32LE(charge.length, 4);
      // Bourrage RIFF : tout bloc de taille impaire est suivi d'un octet nul.
      blocs.push(entete, charge, ...(charge.length % 2 === 1 ? [Buffer.from([0])] : []));
    }

    offset = donneesFin + (taille % 2);
  }

  if (width === 0 || height === 0) throw new Error('WebP invalide : aucun bloc image exploitable.');

  const corps = Buffer.concat(blocs);
  const entete = Buffer.alloc(12);
  entete.write('RIFF', 0, 'latin1');
  entete.writeUInt32LE(corps.length + 4, 4); // « WEBP » + blocs
  entete.write('WEBP', 8, 'latin1');
  return { width, height, bytes: Buffer.concat([entete, corps]) };
}

function dimensionsVp8(d: Buffer): { width: number; height: number } {
  if (d.length < 10) throw new Error('WebP invalide : bloc VP8 trop court.');
  if (d[3] !== 0x9d || d[4] !== 0x01 || d[5] !== 0x2a) {
    throw new Error('WebP invalide : code de démarrage VP8 absent.');
  }
  return { width: d.readUInt16LE(6) & 0x3fff, height: d.readUInt16LE(8) & 0x3fff };
}

function dimensionsVp8l(d: Buffer): { width: number; height: number } {
  if (d.length < 5 || d[0] !== 0x2f) throw new Error('WebP invalide : signature VP8L absente.');
  const bits = d.readUInt32LE(1);
  return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
}
