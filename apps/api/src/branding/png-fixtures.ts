// PNG de test pour la vérification de transparence des motifs — ADR-0073 § 4.
// Hors de `sales/documents` : son prédicteur Paeth calcule sur des octets, et
// ce dossier ne fait que de la mise en forme (ADR-0025).

import { deflateSync } from 'node:zlib';

import { chunk } from '../sales/documents/testing/template-fixtures.js';

/**
 * PNG RVBA 8 bits VALIDE (ADR-0073, motifs) : alpha donné par `alphaAt`. Les
 * lignes sont filtrées tour à tour avec les cinq filtres PNG (0 à 4) pour
 * éprouver le défiltrage de `branding/png-alpha.ts`.
 */
export function rgbaPng(
  width: number,
  height: number,
  alphaAt: (x: number, y: number) => number,
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RVBA
  const stride = width * 4;
  let prev = Buffer.alloc(stride);
  const rows: Buffer[] = [];
  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y += 1) {
    const line = Buffer.alloc(stride);
    for (let x = 0; x < width; x += 1) {
      line[x * 4] = (x * 7) & 255;
      line[x * 4 + 1] = (y * 5) & 255;
      line[x * 4 + 2] = 90;
      line[x * 4 + 3] = alphaAt(x, y);
    }
    const f = y % 5;
    const row = Buffer.alloc(1 + stride);
    row[0] = f;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= 4 ? line[i - 4]! : 0;
      const b = prev[i]!;
      const c = i >= 4 ? prev[i - 4]! : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]!;
      row[1 + i] = (line[i]! - pred) & 255;
    }
    rows.push(row);
    prev = line;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
