// Contrôle de la TRANSPARENCE d'un PNG déjà assaini — ADR-0073 § 4.
//
// Un motif de fond téléversé doit être transparent : un aplat opaque posé sous
// une facture la rendrait illisible quelle que soit l'intensité. Le type de
// couleur déclaré ne suffit pas (un PNG RVBA peut être entièrement opaque) : on
// DÉCOMPRESSE les données d'image (`node:zlib`, sortie bornée AVANT
// l'allocation par les dimensions déjà contrôlées) et on compte les pixels dont
// l'alpha est inférieur à 255. Aucun décodeur natif, aucune dépendance : la
// règle de `account/image-validation.ts` (pas de libpng/sharp sur des octets
// choisis par un tiers) est respectée — on ne fait que défiltrer des octets.
//
// Formes admises : RVBA (type 6) et niveaux de gris + alpha (type 4), 8 bits,
// non entrelacé — ce qu'exportent Figma, Illustrator, Photoshop, Canva et
// Inkscape. Le reste est refusé avec un message qui dit quoi exporter.

import { inflateSync } from 'node:zlib';

export type PngAlphaVerdict =
  | { ok: true; transparentShare: number }
  | { ok: false; code: 'PATTERN_NOT_PNG' | 'PATTERN_NOT_TRANSPARENT'; message: string };

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function refus(
  code: 'PATTERN_NOT_PNG' | 'PATTERN_NOT_TRANSPARENT',
  message: string,
): PngAlphaVerdict {
  return { ok: false, code, message };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Part des pixels non opaques d'un PNG. `bytes` : octets ASSAINIS (structure déjà
 * vérifiée par `validateAndSanitizeImage`, dimensions déjà bornées).
 */
export function pngAlpha(bytes: Buffer): PngAlphaVerdict {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(SIGNATURE)) {
    return refus('PATTERN_NOT_PNG', 'Le motif doit être un PNG transparent.');
  }
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = -1;
  let interlace = 0;
  const idat: Buffer[] = [];
  let off = 8;
  while (off + 8 <= bytes.length) {
    const len = bytes.readUInt32BE(off);
    const type = bytes.toString('latin1', off + 4, off + 8);
    const data = bytes.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 4 ? 2 : 0;
  if (channels === 0 || depth !== 8) {
    return refus(
      'PATTERN_NOT_TRANSPARENT',
      'Le motif doit être un PNG avec canal alpha (RVBA 8 bits) : exportez-le en « PNG transparent ».',
    );
  }
  if (interlace !== 0) {
    return refus('PATTERN_NOT_PNG', 'PNG entrelacé non accepté : exportez-le sans entrelacement.');
  }
  const stride = width * channels;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * height });
  } catch {
    return refus('PATTERN_NOT_PNG', 'Données d’image illisibles.');
  }
  if (raw.length !== (stride + 1) * height) {
    return refus('PATTERN_NOT_PNG', 'Données d’image incomplètes.');
  }
  let prev = Buffer.alloc(stride);
  let cur = Buffer.alloc(stride);
  let transparent = 0;
  for (let y = 0; y < height; y++) {
    const base = y * (stride + 1);
    const filter = raw[base]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[base + 1 + x]!;
      const a = x >= channels ? cur[x - channels]! : 0;
      const b = prev[x]!;
      const c = x >= channels ? prev[x - channels]! : 0;
      let out: number;
      switch (filter) {
        case 0:
          out = v;
          break;
        case 1:
          out = v + a;
          break;
        case 2:
          out = v + b;
          break;
        case 3:
          out = v + ((a + b) >> 1);
          break;
        case 4:
          out = v + paeth(a, b, c);
          break;
        default:
          return refus('PATTERN_NOT_PNG', 'Données d’image invalides.');
      }
      cur[x] = out & 0xff;
    }
    for (let x = channels - 1; x < stride; x += channels) if (cur[x]! < 255) transparent++;
    [prev, cur] = [cur, prev];
  }
  return { ok: true, transparentShare: transparent / (width * height) };
}
